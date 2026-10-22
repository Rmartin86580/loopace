/* =========================================================
   Vidéo de survol 3D du parcours (façon Relive)
   - Carte 3D : MapLibre GL + relief AWS Terrain Tiles + satellite Esri
   - Rendu image par image (on attend que la carte soit chargée à chaque image),
     encodé en MP4 directement dans le navigateur (WebCodecs + mp4-muxer).
   Rien n'est envoyé sur un serveur : la vidéo est fabriquée sur l'ordinateur.
   Dépend de parcours.js (route, elevation, routeName, fmtKm, paceSeconds…).
   ========================================================= */
const VIDEO_FPS = 30;
const VIDEO_FORMATS = { landscape: [1920, 1080], portrait: [1080, 1920] };
const VIDEO_PINK = ACCENT;

const vm = {
  choice: "landscape", // ce que l'utilisateur veut : landscape, portrait ou both
  format: "landscape", // format en cours de rendu
  map3d: null,
  ready: null,
  logo: null,
  busy: false,
  cancelled: false,
  url: null,
};

/* ---------- Chargement des bibliothèques (à la première ouverture) ---------- */
function loadJs(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
}
let videoLibs;
function loadVideoLibs() {
  videoLibs ??= (() => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
    document.head.append(css);
    return Promise.all([
      loadJs("https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"),
      loadJs("https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.js"),
      document.fonts.load("800 64px Syne"),
      document.fonts.load('italic 900 40px "Exo 2"'),
      document.fonts.load("600 30px Inter"),
    ]);
  })();
  return videoLibs;
}

/* ---------- Géométrie du parcours ---------- */
function buildTrack() {
  const cum = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + map.distance(route[i - 1], route[i]));
  // D+ cumulé à partir des échantillons d'altitude (s'ils sont disponibles)
  const ele = elevation?.samples || null;
  const gain = [0];
  if (ele) for (let i = 1; i < ele.length; i++) gain.push(gain[i - 1] + Math.max(0, ele[i].ele - ele[i - 1].ele));
  return { cum, total: cum[cum.length - 1], ele, gain };
}

function indexAt(track, s) {
  let lo = 1;
  let hi = track.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track.cum[mid] < s) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function pointAt(track, s) {
  s = Math.max(0, Math.min(track.total, s));
  const i = indexAt(track, s);
  const span = track.cum[i] - track.cum[i - 1] || 1;
  const t = (s - track.cum[i - 1]) / span;
  return {
    lat: route[i - 1][0] + (route[i][0] - route[i - 1][0]) * t,
    lng: route[i - 1][1] + (route[i][1] - route[i - 1][1]) * t,
    i,
  };
}

function lineUpTo(track, s) {
  const p = pointAt(track, s);
  const coords = route.slice(0, p.i).map(([lat, lng]) => [lng, lat]);
  coords.push([p.lng, p.lat]);
  return coords;
}

function elevationAt(track, s) {
  const e = track.ele;
  if (!e) return null;
  let k = e.findIndex((x) => x.d >= s);
  if (k <= 0) k = k === 0 ? 1 : e.length - 1;
  const t = Math.min(1, Math.max(0, (s - e[k - 1].d) / ((e[k].d - e[k - 1].d) || 1)));
  return {
    ele: e[k - 1].ele + (e[k].ele - e[k - 1].ele) * t,
    gain: track.gain[k - 1] + Math.max(0, e[k].ele - e[k - 1].ele) * t,
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ---------- Carte 3D ---------- */
function create3dMap() {
  const [W, H] = VIDEO_FORMATS[vm.format];
  const box = $("vmMap");
  box.style.width = `${W}px`;
  box.style.height = `${H}px`;
  const empty = { type: "FeatureCollection", features: [] };
  vm.map3d = new maplibregl.Map({
    container: box,
    interactive: false,
    attributionControl: false,
    // Démarre directement sur le parcours (sinon chargement du relief du monde entier)
    center: [route[0][1], route[0][0]],
    zoom: 14,
    preserveDrawingBuffer: true, // nécessaire pour recopier chaque image dans la vidéo
    antialias: true, // bords du tracé et du relief lissés
    pixelRatio: 1,
    fadeDuration: 0,
    maxPitch: 75,
    style: {
      version: 8,
      sources: {
        sat: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          // Tuiles de 256 px déclarées en 128 : la carte prend le niveau de détail au-dessus (image 2× plus nette)
          tileSize: 128,
          maxzoom: 19,
        },
        dem: {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          encoding: "terrarium",
          tileSize: 256,
          maxzoom: 14,
        },
        full: { type: "geojson", data: empty },
        done: { type: "geojson", data: empty, lineMetrics: true }, // lineMetrics : nécessaire au dégradé
        runner: { type: "geojson", data: empty },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#0b0b0c" } },
        { id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.2, "raster-brightness-max": 0.85 } },
        { id: "full", type: "line", source: "full", layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#ffffff", "line-opacity": 0.5, "line-width": 4 } },
        { id: "done-glow", type: "line", source: "done", layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": VIDEO_PINK, "line-width": 16, "line-opacity": 0.35, "line-blur": 6 } },
        { id: "done", type: "line", source: "done", layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-gradient": routeGradient(VIDEO_PINK), "line-width": 6 } },
        { id: "runner-halo", type: "circle", source: "runner",
          paint: { "circle-radius": 18, "circle-color": VIDEO_PINK, "circle-opacity": 0.35, "circle-pitch-alignment": "map" } },
        { id: "runner", type: "circle", source: "runner",
          paint: { "circle-radius": 9, "circle-color": VIDEO_PINK, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } },
      ],
      terrain: { source: "dem", exaggeration: 1.4 },
      // (exagération et couleur ensuite réglables, voir applyMapStyle)
    },
  });
  vm.relief = 1.4;
  vm.color = VIDEO_PINK;
  // Prête dès que le style est chargé et la première vue dessinée (sans dépendre de l'écran)
  vm.ready = new Promise((resolve) => {
    const check = () => (vm.map3d.isStyleLoaded() ? resolve() : setTimeout(check, 30));
    check();
  }).then(() => waitIdle(15000));
  return vm.ready;
}

function setLine(source, coords) {
  vm.map3d.getSource(source).setData({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} });
}
function setRunner(p) {
  vm.map3d.getSource("runner").setData({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: {} });
}

// Le relief se charge en tâche de fond et MapLibre recale alors la caméra (zoom) :
// on réapplique la caméra voulue jusqu'à ce qu'elle soit stable.
function moveCamera(camera) {
  vm.camera = camera;
  vm.map3d.jumpTo(camera);
}
async function settle(timeout = 5000) {
  for (let k = 0; k < 4; k++) {
    await waitIdle(timeout);
    if (!vm.camera || Math.abs(vm.map3d.getZoom() - vm.camera.zoom) < 0.01) return;
    vm.map3d.jumpTo(vm.camera);
  }
}

// Attend que la carte ait fini de charger (images satellite + relief) puis la dessine.
// On force le dessin nous-mêmes (redraw) au lieu d'attendre le rafraîchissement de
// l'écran : la création continue même si la fenêtre n'est pas affichée en continu.
// Petite pause entre deux vérifications. Onglet masqué : Chrome ralentit fortement les
// minuteries (setTimeout), mais pas les messages (MessageChannel) → la création continue.
const tick = () => (document.hidden
  ? new Promise((r) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => r();
    c.port2.postMessage(0);
  })
  : new Promise((r) => setTimeout(r, 15)));

async function waitIdle(timeout = 5000) {
  const map3d = vm.map3d;
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    map3d.redraw();
    if (map3d.loaded() && map3d.areTilesLoaded()) {
      map3d.redraw();
      return;
    }
    await tick();
  }
}

/* ---------- Réglages (panneau de la fenêtre vidéo) ---------- */
const OPTS_KEY = "rotiby-video-opts";
const OPT_DEFAULTS = {
  zoomOffset: 0, pitch: 60, relief: 1.4, color: VIDEO_PINK,
  intro: true, outro: true, card: true,
  logo: true, title: true, subtitle: "", distance: true, profile: true, gain: true, time: true,
};

function optInputs() {
  return [...$("vmOptions").querySelectorAll("[name]")];
}

function vmOpts() {
  const o = {};
  for (const el of optInputs()) {
    o[el.name] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value.trim();
  }
  return o;
}

function loadOpts() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(OPTS_KEY)) || {}; } catch { /* stockage indisponible */ }
  // L'ancienne couleur par défaut suit le thème du site
  if (saved.color && saved.color.toLowerCase() === "#d885cc") delete saved.color;
  const o = { ...OPT_DEFAULTS, ...saved };
  for (const el of optInputs()) {
    if (!(el.name in o)) continue;
    if (el.type === "checkbox") el.checked = Boolean(o[el.name]);
    else el.value = o[el.name];
  }
}

function saveOpts() {
  const { duration, ...rest } = vmOpts(); // la durée dépend du parcours : on ne la garde pas
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(rest)); } catch { /* stockage indisponible */ }
}

const optEl = (name) => $("vmOptions").querySelector(`[name=${name}]`);

// Styles prêts à l'emploi : réglent caméra, angle, relief et durée
const PRESETS = {
  classic: { zoomOffset: 0, pitch: 60, relief: 1.4, duration: 1 },
  dynamic: { zoomOffset: -0.6, pitch: 65, relief: 1.6, duration: 0.75 },
  cinema: { zoomOffset: 0.4, pitch: 55, relief: 1.4, duration: 1.3 },
  top: { zoomOffset: 1, pitch: 15, relief: 1.2, duration: 1 },
};

function updateOptLabels() {
  optEl("duration").closest("label").querySelector("output").textContent = `${optEl("duration").value} s`;
  // Style actif : celui dont les réglages correspondent aux curseurs
  const o = vmOpts();
  for (const b of document.querySelectorAll("[data-preset]")) {
    const p = PRESETS[b.dataset.preset];
    const match = p.zoomOffset === o.zoomOffset && p.pitch === o.pitch && p.relief === o.relief;
    b.setAttribute("aria-pressed", String(match));
  }
  // Couleur active
  let preset = false;
  for (const b of document.querySelectorAll("[data-color]")) {
    const on = b.dataset.color === o.color.toLowerCase();
    preset ||= on;
    b.setAttribute("aria-pressed", String(on));
  }
  document.querySelector(".swatch-custom").classList.toggle("is-active", !preset);
  // Moment de l'aperçu
  const v = Number($("vmScrub").value);
  for (const b of document.querySelectorAll("[data-moment]")) {
    b.setAttribute("aria-pressed", String(Math.abs(Number(b.dataset.moment) - v) < 1));
  }
}

const autoDuration = (total) => Math.round(Math.min(55, Math.max(12, (total / 1000) * 4.5)));

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Tracé : dégradé rose → violet avec la couleur du thème, uni avec une couleur choisie
function routeGradient(color) {
  const end = color.toLowerCase() === VIDEO_PINK.toLowerCase() ? ACCENT2 : color;
  return ["interpolate", ["linear"], ["line-progress"], 0, color, 1, end];
}

function applyMapStyle(o) {
  // On ne touche à la carte que si le réglage a changé (recharger le relief est coûteux)
  if (vm.relief !== o.relief) {
    vm.map3d.setTerrain({ source: "dem", exaggeration: o.relief });
    vm.relief = o.relief;
  }
  if (vm.color !== o.color) {
    for (const id of ["done-glow", "runner", "runner-halo"]) {
      vm.map3d.setPaintProperty(id, id.startsWith("runner") ? "circle-color" : "line-color", o.color);
    }
    vm.map3d.setPaintProperty("done", "line-gradient", routeGradient(o.color));
    vm.color = o.color;
  }
}

/* ---------- Plan de caméra ---------- */
function bearingBetween(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

function makePlan(track, o) {
  const [W, H] = VIDEO_FORMATS[vm.format];
  const pad = Math.round(Math.min(W, H) * 0.14);
  const bounds = new maplibregl.LngLatBounds();
  route.forEach(([lat, lng]) => bounds.extend([lng, lat]));
  // cameraForBounds tient compte de la caméra courante (relief, inclinaison) : on la remet à plat d'abord
  vm.map3d.jumpTo({ center: bounds.getCenter(), zoom: 14, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  const overview = vm.map3d.cameraForBounds(bounds, { padding: { top: pad * 1.6, bottom: pad * 1.6, left: pad, right: pad } });
  const autoZoom = Math.min(16.3, Math.max(13.8, 16.3 - Math.log2(Math.max(1, track.total / 3000)) * 0.6)) - (vm.format === "portrait" ? 0.3 : 0);
  const outroMove = o.outro ? Math.round(2.5 * VIDEO_FPS) : 0;
  const outroCard = o.card ? Math.round(3 * VIDEO_FPS) : Math.round(0.5 * VIDEO_FPS);
  const frames = {
    intro: o.intro ? Math.round(2.5 * VIDEO_FPS) : 0,
    follow: Math.round(o.duration * VIDEO_FPS),
    outroMove,
    outro: outroMove + outroCard,
  };
  return {
    overview: { center: overview.center, zoom: overview.zoom },
    followZoom: autoZoom - o.zoomOffset,
    pitch: o.pitch,
    endPitch: Math.min(30, o.pitch),
    lookAhead: Math.min(600, Math.max(150, track.total * 0.03)),
    frames,
    total: frames.intro + frames.follow + frames.outro,
    followPad: Math.round(H * 0.28 * (o.pitch / 60)),
    card: o.card,
  };
}

/* ---------- Habillage (logo, textes, stats, barre de progression) ---------- */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/* Texte à chiffres de largeur fixe (évite que le compteur « tremble ») */
const isDigit = (c) => c >= "0" && c <= "9";
function tabularWidth(ctx, text, digitW) {
  return [...text].reduce((w, c) => w + (isDigit(c) ? digitW : ctx.measureText(c).width), 0);
}
function drawTabular(ctx, text, x, y, digitW) {
  ctx.textAlign = "center";
  for (const c of text) {
    const cw = isDigit(c) ? digitW : ctx.measureText(c).width;
    ctx.fillText(c, x + cw / 2, y);
    x += cw;
  }
  ctx.textAlign = "left";
}

/* Logo complet (« L » + boucle ∞ + « PACE ») dessiné dans la vidéo, à la taille de police fs.
   Le nom est coupé autour du « OO », remplacé par l'image de la boucle. */
function wordmarkParts() {
  const name = BRAND.toUpperCase();
  const i = name.indexOf("OO");
  return vm.inf && i >= 0 ? [name.slice(0, i), name.slice(i + 2)] : null;
}
function wordmarkWidth(ctx, fs) {
  ctx.font = `italic 900 ${fs}px "Exo 2"`;
  const parts = wordmarkParts();
  if (!parts) return ctx.measureText(BRAND.toUpperCase()).width;
  const infW = fs * 1.2 * (vm.inf.width / vm.inf.height);
  return ctx.measureText(parts[0]).width + fs * 0.03 + infW + ctx.measureText(parts[1]).width;
}
function drawWordmark(ctx, x, top, fs) {
  ctx.save();
  ctx.font = `italic 900 ${fs}px "Exo 2"`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const base = top + fs * 0.95; // ligne de base des lettres
  const parts = wordmarkParts();
  if (!parts) {
    ctx.fillText(BRAND.toUpperCase(), x, base);
  } else {
    ctx.fillText(parts[0], x, base);
    x += ctx.measureText(parts[0]).width + fs * 0.03;
    const ih = fs * 1.2;
    const iw = ih * (vm.inf.width / vm.inf.height);
    ctx.drawImage(vm.inf, x, base - fs * 0.36 - ih / 2, iw, ih); // centrée sur les majuscules
    x += iw;
    ctx.fillText(parts[1], x, base);
  }
  ctx.restore();
}

function drawOverlay(ctx, track, st, o) {
  const [W, H] = VIDEO_FORMATS[vm.format];
  const u = Math.min(W, H) / 1080;
  const m = 48 * u;
  const title = o.title ? $("vmTitleInput").value.trim() || routeName() : "";
  const logo = o.logo && vm.logo;
  const color2 = o.color.toLowerCase() === VIDEO_PINK.toLowerCase() ? ACCENT2 : o.color; // dégradé avec la couleur du thème

  // Dégradés haut/bas pour la lisibilité
  if (o.logo || title || o.subtitle) {
    const g = ctx.createLinearGradient(0, 0, 0, 260 * u);
    g.addColorStop(0, "rgba(0,0,0,.6)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 260 * u);
  }
  if (o.distance || o.profile) {
    const g = ctx.createLinearGradient(0, H - 380 * u, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,.75)");
    ctx.fillStyle = g;
    ctx.fillRect(0, H - 380 * u, W, 380 * u);
  }

  // En-tête : logo + nom, titre, sous-titre — sur un fond sombre pour rester lisible
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const maxW = W * (H > W ? 0.86 : 0.55);
  const tx = m + 20 * u; // colonne du texte
  const logoFs = 44 * u; // taille du logo complet
  const rows = [];
  if (o.logo) rows.push({ wordmark: true, h: logoFs * 1.3 });
  if (title) rows.push(o.logo
    ? { text: title, font: `600 ${28 * u}px Inter`, color: "rgba(255,255,255,.92)", h: 38 * u }
    : { text: title, font: `800 ${40 * u}px Syne`, color: "#ffffff", h: 52 * u });
  if (o.subtitle) rows.push({ text: o.subtitle, font: `600 ${25 * u}px Inter`, color: "#ffffff", h: 34 * u, accent: true });
  if (rows.length) {
    const accentW = 18 * u;
    let textW = 0;
    for (const r of rows) {
      if (r.wordmark) {
        textW = Math.max(textW, wordmarkWidth(ctx, logoFs));
        continue;
      }
      ctx.font = r.font;
      textW = Math.max(textW, ctx.measureText(r.text).width + (r.accent ? accentW : 0));
    }
    const textMax = maxW - (tx - m) - 20 * u;
    const boxW = tx - m + Math.min(textW, textMax) + 24 * u;
    const boxH = rows.reduce((h, r) => h + r.h, 0) + 28 * u;
    ctx.fillStyle = "rgba(11,11,12,.62)";
    roundRect(ctx, m, m, boxW, boxH, 20 * u);
    ctx.fill();
    let y = m + 14 * u;
    for (const r of rows) {
      if (r.wordmark) {
        drawWordmark(ctx, tx, y + 4 * u, logoFs);
        y += r.h;
        continue;
      }
      ctx.font = r.font;
      ctx.fillStyle = r.color;
      let x = tx;
      if (r.accent) {
        // petit trait de couleur devant le sous-titre (le texte reste blanc, donc lisible)
        ctx.fillStyle = o.color;
        ctx.fillRect(x, y + 4 * u, 5 * u, r.h - 12 * u);
        ctx.fillStyle = r.color;
        x += accentW;
      }
      ctx.fillText(r.text, x, y + 2 * u, textMax - (r.accent ? accentW : 0));
      y += r.h;
    }
  }

  // Crédits des données (obligatoires, toujours affichés)
  ctx.font = `400 ${15 * u}px Inter`;
  ctx.fillStyle = "rgba(255,255,255,.55)";
  ctx.textAlign = "right";
  ctx.fillText("Imagerie © Esri · Relief © AWS Terrain Tiles", W - m, m);
  ctx.textAlign = "left";

  // Bas de l'image : distance + profil de dénivelé avec curseur
  const done = Math.min(track.total, st.s);
  const portrait = H > W;
  const hasProfile = o.profile && track.ele;
  // Zone du graphique (pleine largeur en vertical, à droite de la distance en paysage)
  const ch = (portrait ? 190 : 150) * u;
  const cy = H - (portrait ? 64 : 44) * u - ch;
  // Distance : chiffres à chasse fixe (chaque chiffre dans une case de même largeur),
  // alignés à droite dans la place de la distance totale → le texte ne bouge pas
  let distWidth = 0;
  let numWidth = 0;
  let digitW = 0;
  if (o.distance) {
    ctx.font = `800 ${76 * u}px Syne`;
    digitW = Math.max(..."0123456789".split("").map((d) => ctx.measureText(d).width));
    numWidth = tabularWidth(ctx, fmtKm(track.total), digitW);
    ctx.font = `700 ${34 * u}px Syne`;
    distWidth = numWidth + ctx.measureText(` km / ${fmtKm(track.total)}`).width;
  }
  // En paysage, le graphique commence après la distance
  const cx = portrait || !o.distance ? m : m + distWidth + 40 * u;
  const cw = W - m - cx;

  if (o.distance) {
    ctx.textBaseline = "alphabetic";
    const baseY = hasProfile && portrait ? cy - 28 * u : H - 52 * u;
    ctx.font = `800 ${76 * u}px Syne`;
    ctx.fillStyle = "#ffffff";
    const dist = fmtKm(done);
    drawTabular(ctx, dist, m + numWidth - tabularWidth(ctx, dist, digitW), baseY, digitW);
    ctx.font = `700 ${34 * u}px Syne`;
    ctx.fillStyle = o.color;
    ctx.fillText(` km / ${fmtKm(track.total)}`, m + numWidth, baseY);
  }

  if (hasProfile) drawProfile(ctx, track, done, o, { x: cx, y: cy, w: cw, h: ch, u });

  // Carte de fin
  if (st.card > 0) {
    ctx.save();
    ctx.globalAlpha = st.card;
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0, 0, W, H);
    const lines = [];
    const cw = Math.min(W - 2 * m, 780 * u);
    const cardFs = 54 * u;
    let ch = 300 * u + (o.logo ? cardFs * 1.4 : 0) + (o.subtitle ? 40 * u : 0);
    const cx = (W - cw) / 2;
    const cy = (H - ch) / 2;
    ctx.fillStyle = "rgba(11,11,12,.9)";
    roundRect(ctx, cx, cy, cw, ch, 32 * u);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(o.color, 0.6);
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    let cyy = cy + 44 * u;
    if (o.logo) {
      drawWordmark(ctx, W / 2 - wordmarkWidth(ctx, cardFs) / 2, cyy, cardFs);
      cyy += cardFs * 1.4;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
    }
    const cardTitle = $("vmTitleInput").value.trim() || routeName();
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${34 * u}px Syne`;
    ctx.fillText(cardTitle, W / 2, cyy, cw - 60 * u);
    cyy += 50 * u;
    if (o.subtitle) {
      ctx.font = `600 ${25 * u}px Inter`;
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.fillText(o.subtitle, W / 2, cyy, cw - 60 * u);
      cyy += 40 * u;
    }
    ctx.font = `800 ${96 * u}px Syne`;
    ctx.fillStyle = o.color;
    ctx.fillText(`${fmtKm(track.total)} km`, W / 2, cyy);
    cyy += 120 * u;
    if (o.gain && track.ele) lines.push(`D+ ${Math.round(track.gain[track.gain.length - 1])} m`);
    if (o.time) lines.push(`≈ ${fmtDuration((track.total / 1000) * paceSeconds())} à ${paceText()}`);
    if (lines.length) {
      ctx.font = `600 ${28 * u}px Inter`;
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.fillText(lines.join("   ·   "), W / 2, cyy, cw - 60 * u);
    }
    ctx.restore();
  }
}

/* Graphique du dénivelé : partie parcourue en couleur, curseur qui suit le coureur */
function drawProfile(ctx, track, done, o, box) {
  const { x, y, w, h, u } = box;
  const e = track.ele;
  const eles = e.map((p) => p.ele);
  const min = Math.min(...eles);
  const max = Math.max(...eles);
  const range = Math.max(max - min, 30); // évite un profil « en dents de scie » sur le plat
  const pad = 14 * u;
  const top = y + 46 * u; // place pour les étiquettes
  const bottom = y + h - pad;
  const px = (d) => x + pad + (d / track.total) * (w - 2 * pad);
  const py = (ele) => bottom - ((ele - min) / range) * (bottom - top);

  // Fond
  ctx.fillStyle = "rgba(11,11,12,.55)";
  roundRect(ctx, x, y, w, h, 18 * u);
  ctx.fill();

  const path = () => {
    ctx.beginPath();
    ctx.moveTo(px(0), bottom);
    e.forEach((p) => ctx.lineTo(px(p.d), py(p.ele)));
    ctx.lineTo(px(track.total), bottom);
    ctx.closePath();
  };

  // Partie restante (grise)
  path();
  ctx.fillStyle = "rgba(255,255,255,.14)";
  ctx.fill();

  // Partie parcourue (couleur), découpée jusqu'au curseur
  const cxp = px(done);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, cxp - x, h);
  ctx.clip();
  path();
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, hexToRgba(o.color, 0.7));
  g.addColorStop(1, hexToRgba(o.color, 0.12));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  e.forEach((p, i) => (i ? ctx.lineTo(px(p.d), py(p.ele)) : ctx.moveTo(px(p.d), py(p.ele))));
  ctx.strokeStyle = o.color;
  ctx.lineWidth = 3 * u;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();

  // Curseur
  const cur = elevationAt(track, done);
  const cyp = py(cur.ele);
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  ctx.moveTo(cxp, top - 6 * u);
  ctx.lineTo(cxp, bottom);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cxp, cyp, 9 * u, 0, Math.PI * 2);
  ctx.fillStyle = o.color;
  ctx.fill();
  ctx.lineWidth = 3 * u;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  // Étiquette d'altitude au-dessus du curseur
  const label = `${Math.round(cur.ele)} m`;
  ctx.font = `700 ${24 * u}px Inter`;
  const lw = ctx.measureText(label).width + 20 * u;
  const lx = Math.min(x + w - lw - 8 * u, Math.max(x + 8 * u, cxp - lw / 2));
  const ly = y + 8 * u;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, lx, ly, lw, 32 * u, 16 * u);
  ctx.fill();
  ctx.fillStyle = "#0b0b0c";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, lx + lw / 2, ly + 16 * u);

  // D+ cumulé, dans le coin opposé au curseur pour ne pas le chevaucher
  if (o.gain) {
    const dplus = `D+ ${Math.round(cur.gain)} m`;
    ctx.font = `600 ${22 * u}px Inter`;
    ctx.fillStyle = "rgba(255,255,255,.85)";
    const rightSide = cxp < x + w / 2;
    ctx.textAlign = rightSide ? "right" : "left";
    ctx.fillText(dplus, rightSide ? x + w - pad : x + pad, ly + 16 * u);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/* ---------- Une image de la vidéo ---------- */
// cam.noSmooth : pour l'aperçu, la caméra prend directement l'orientation finale
function applyFrame(track, plan, f, cam) {
  const { intro, follow, outroMove } = plan.frames;
  const st = { s: 0, card: 0 };
  const start = pointAt(track, 0);
  const followCam = (s) => {
    const p = pointAt(track, s);
    const ahead = pointAt(track, Math.min(track.total, s + plan.lookAhead));
    return { p, bearing: bearingBetween(p, ahead) };
  };
  const pad = (k) => ({ top: plan.followPad * k, bottom: 0, left: 0, right: 0 });

  if (f < intro) {
    // Intro : vue d'ensemble puis plongée vers le départ
    const t = easeInOut(f / intro);
    if (cam.bearing == null) cam.bearing = followCam(0).bearing;
    moveCamera({
      center: [lerp(plan.overview.center.lng, start.lng, t), lerp(plan.overview.center.lat, start.lat, t)],
      zoom: lerp(plan.overview.zoom, plan.followZoom, t),
      pitch: lerp(0, plan.pitch, t),
      bearing: lerpAngle(0, cam.bearing, t),
      padding: pad(t),
    });
    setLine("done", lineUpTo(track, 0.1));
    setRunner(start);
  } else if (f < intro + follow) {
    // Suivi : la caméra accompagne le coureur
    const t = follow > 1 ? (f - intro) / (follow - 1) : 1;
    st.s = track.total * (0.5 - Math.cos(Math.PI * t) / 2);
    const { p, bearing } = followCam(st.s);
    cam.bearing = cam.noSmooth || cam.bearing == null ? bearing : lerpAngle(cam.bearing, bearing, 0.06);
    moveCamera({ center: [p.lng, p.lat], zoom: plan.followZoom, pitch: plan.pitch, bearing: cam.bearing, padding: pad(1) });
    setLine("done", lineUpTo(track, st.s));
    setRunner(p);
  } else {
    // Fin : retour (optionnel) à la vue d'ensemble, puis carte de stats (optionnelle)
    st.s = track.total;
    const k = f - intro - follow;
    const t = outroMove ? easeInOut(Math.min(1, k / outroMove)) : 0;
    const end = pointAt(track, track.total);
    if (cam.endBearing == null) {
      cam.endBearing = cam.noSmooth || cam.bearing == null ? followCam(Math.max(0, track.total - plan.lookAhead)).bearing : cam.bearing;
    }
    moveCamera({
      center: [lerp(end.lng, plan.overview.center.lng, t), lerp(end.lat, plan.overview.center.lat, t)],
      zoom: lerp(plan.followZoom, plan.overview.zoom, t),
      pitch: lerp(plan.pitch, plan.endPitch, t),
      bearing: lerpAngle(cam.endBearing, 0, t),
      padding: pad(1 - t),
    });
    setLine("done", lineUpTo(track, track.total));
    setRunner(end);
    if (plan.card) st.card = Math.min(1, Math.max(0, (k - outroMove) / (0.8 * VIDEO_FPS)));
  }
  return st;
}

function composite(track, st, o) {
  const canvas = $("vmCanvas");
  const ctx = canvas.getContext("2d");
  ctx.drawImage(vm.map3d.getCanvas(), 0, 0, canvas.width, canvas.height);
  drawOverlay(ctx, track, st, o);
}

/* ---------- Encodage MP4 ---------- */
async function pickEncoderConfig(W, H) {
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42e028"]) {
    const cfg = { codec, width: W, height: H, bitrate: 24_000_000, framerate: VIDEO_FPS };
    const res = await VideoEncoder.isConfigSupported(cfg).catch(() => null);
    if (res?.supported) return cfg;
  }
  return null;
}

const fmtWait = (sec) => (sec < 60 ? `${Math.round(sec)} s` : `${Math.ceil(sec / 60)} min`);

const FORMAT_NAMES = { landscape: "Paysage 16:9", portrait: "Vertical 9:16" };
const choiceFormats = () => (vm.choice === "both" ? ["landscape", "portrait"] : [vm.choice]);

// Format de rendu courant (taille de la carte 3D et de l'image)
function setRenderFormat(format) {
  vm.format = format;
  const [W, H] = VIDEO_FORMATS[format];
  $("vmMap").style.width = `${W}px`;
  $("vmMap").style.height = `${H}px`;
  vm.map3d?.resize();
  if ($("vmCanvas").width !== W || $("vmCanvas").height !== H) {
    $("vmCanvas").width = W;
    $("vmCanvas").height = H;
  }
  $("vmStage").dataset.format = format;
}

// Fabrique une vidéo dans un format ; renvoie null si annulée
async function renderVideo(format, config, index, count) {
  const [W, H] = VIDEO_FORMATS[format];
  setRenderFormat(format);
  const o = vmOpts();
  applyMapStyle(o);
  const track = buildTrack();
  const plan = makePlan(track, o);
  setLine("full", route.map(([lat, lng]) => [lng, lat]));

  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H, frameRate: VIDEO_FPS },
    fastStart: "in-memory",
  });
  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  encoder.configure(config);

  const label = count > 1 ? `Vidéo ${index + 1}/${count} · ${FORMAT_NAMES[format]} — ` : "";
  const cam = {};
  const t0 = performance.now();
  for (let f = 0; f < plan.total; f++) {
    if (vm.cancelled || encodeError) break;
    const st = applyFrame(track, plan, f, cam);
    await settle();
    composite(track, st, o);
    const frame = new VideoFrame($("vmCanvas"), { timestamp: Math.round((f * 1e6) / VIDEO_FPS), duration: Math.round(1e6 / VIDEO_FPS) });
    encoder.encode(frame, { keyFrame: f % (VIDEO_FPS * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 6) await tick();

    const pct = (f + 1) / plan.total;
    const overall = (index + pct) / count;
    $("vmBar").style.width = `${(overall * 100).toFixed(1)}%`;
    const elapsed = (performance.now() - t0) / 1000;
    // temps restant : fin de cette vidéo + les suivantes (même durée environ)
    const left = (elapsed / pct) * (1 - pct) + (elapsed / pct) * (count - index - 1);
    $("vmStatus").textContent = `${label}${Math.round(overall * 100)} % · encore ~${fmtWait(left)}`;
  }

  if (encodeError) {
    encoder.close();
    throw encodeError;
  }
  if (vm.cancelled) {
    encoder.close();
    return null;
  }
  await encoder.flush();
  muxer.finalize();
  return { format, blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), seconds: Math.round(plan.total / VIDEO_FPS) };
}

async function generateVideo() {
  if (vm.busy) return;
  if (!("VideoEncoder" in window)) {
    $("vmStatusSetup").textContent = "Ton navigateur ne sait pas créer de vidéo : utilise Chrome ou Edge à jour.";
    return;
  }
  const formats = choiceFormats();
  const configs = [];
  for (const f of formats) {
    const [W, H] = VIDEO_FORMATS[f];
    const config = await pickEncoderConfig(W, H);
    if (!config) {
      $("vmStatusSetup").textContent = "L'encodage MP4 n'est pas disponible sur ce navigateur.";
      return;
    }
    configs.push(config);
  }
  vm.busy = true;
  vm.cancelled = false;
  setStage("progress");
  $("vmBar").style.width = "0%";
  $("vmStatus").textContent = "Préparation de la carte 3D…";
  await vm.ready;

  const results = [];
  let error = null;
  try {
    for (let i = 0; i < formats.length; i++) {
      const r = await renderVideo(formats[i], configs[i], i, formats.length);
      if (!r) break;
      results.push(r);
    }
  } catch (e) {
    error = e;
  }
  vm.busy = false;
  setRenderFormat(formats[0]);

  if (error || vm.cancelled || !results.length) {
    setStage("setup");
    if (error) $("vmStatusSetup").textContent = `Erreur pendant la création : ${error.message}`;
    else refreshPreview();
    return;
  }
  showResults(results);
}

/* ---------- Vidéos prêtes : téléchargement(s) ---------- */
function showResults(results) {
  (vm.urls || []).forEach((u) => URL.revokeObjectURL(u));
  const title = $("vmTitleInput").value.trim() || routeName();
  const slug = title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "parcours";
  vm.results = results.map((r) => ({ ...r, url: URL.createObjectURL(r.blob) }));
  vm.urls = vm.results.map((r) => r.url);

  const two = vm.results.length > 1;
  $("vmDoneTitle").textContent = two ? "Tes deux vidéos sont prêtes !" : "Ta vidéo est prête !";
  $("vmSize").textContent = two
    ? `${vm.results[0].seconds} s chacune · une pour YouTube, une pour Insta/WhatsApp`
    : `${(vm.results[0].blob.size / 1e6).toFixed(1)} Mo · ${vm.results[0].seconds} s`;
  $("vmDownloads").innerHTML = vm.results.map((r) => `
    <a class="btn vm-cta__btn" href="${r.url}" download="${BRAND.toLowerCase()}-${slug}${two ? `-${r.format === "landscape" ? "paysage" : "vertical"}` : ""}.mp4">
      <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="url(#lpGrad)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
      Télécharger${two ? ` · ${FORMAT_NAMES[r.format]}` : ""} <small>${(r.blob.size / 1e6).toFixed(0)} Mo</small>
    </a>`).join("");
  $("vmViewSeg").hidden = !two;
  $("vmViewSeg").innerHTML = two
    ? vm.results.map((r, i) => `<button type="button" data-view="${i}" aria-pressed="${i === 0}">${FORMAT_NAMES[r.format]}</button>`).join("")
    : "";
  showResult(0);
  setStage("done");
}

function showResult(i) {
  const r = vm.results[i];
  $("vmStage").dataset.format = r.format;
  $("vmVideo").src = r.url;
  $("vmVideo").play().catch(() => {});
  $("vmViewSeg").querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.view) === i)));
}

/* ---------- Fenêtre « Vidéo du parcours » ---------- */
function setStage(stage) {
  $("vmSetup").hidden = stage !== "setup";
  $("vmProgress").hidden = stage !== "progress";
  $("vmDone").hidden = stage !== "done";
  $("vmPreviewBar").hidden = stage !== "setup";
  $("vmVideo").hidden = stage !== "done";
  $("vmCanvas").hidden = stage === "done";
  document.querySelectorAll("[data-format]").forEach((b) => (b.disabled = stage !== "setup"));
  if (stage === "done") $("vmVideo").play().catch(() => {});
}

// Aperçu : rend l'image correspondant à la position du curseur « Aperçu »
async function renderPreviewFrame() {
  await vm.ready;
  setRenderFormat(vm.format);
  const o = vmOpts();
  applyMapStyle(o);
  const track = buildTrack();
  const plan = makePlan(track, o);
  setLine("full", route.map(([lat, lng]) => [lng, lat]));
  const f = Math.round((Number($("vmScrub").value) / 100) * (plan.total - 1));
  const st = applyFrame(track, plan, f, { noSmooth: true });
  await settle(8000);
  composite(track, st, o);
  const sec = plan.total / VIDEO_FPS;
  $("vmStatusSetup").textContent = vm.choice === "both"
    ? `2 vidéos de ${Math.round(sec)} s (paysage + vertical) · prêtes en ≈ ${fmtWait(sec * 20)}`
    : `Vidéo de ${Math.round(sec)} s · prête en ≈ ${fmtWait(sec * 10)}`;
  $("vmLoading").hidden = true;
}

let previewRunning = false;
let previewAgain = false;
let previewTimer;
async function refreshPreview() {
  if (!vm.map3d || vm.busy) return;
  if (previewRunning) {
    previewAgain = true;
    return;
  }
  previewRunning = true;
  $("vmGenerate").disabled = true;
  try {
    do {
      previewAgain = false;
      await renderPreviewFrame();
    } while (previewAgain);
  } finally {
    previewRunning = false;
    $("vmGenerate").disabled = false;
  }
}
function schedulePreview() {
  updateOptLabels();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 250);
}

async function openVideoModal() {
  if (route.length < 2) return;
  $("videoModal").showModal();
  $("vmTitleInput").value ||= $("routeName").value.trim();
  optEl("duration").value = autoDuration(totalDist);
  updateOptLabels();
  setStage("setup");
  $("vmGenerate").disabled = true;
  $("vmLoading").hidden = false;
  $("vmStatusSetup").textContent = "Chargement de la vue 3D…";
  try {
    await loadVideoLibs();
    // Icône et boucle ∞ du logo (SVG intégré : fonctionne aussi en file://)
    if (!vm.logo) [vm.logo, vm.inf] = await Promise.all([svgImage(LOGO_ICON_SVG), svgImage(LOGO_INFINITY_SVG)]);
    if (!vm.map3d) await create3dMap();
    await refreshPreview();
  } catch (e) {
    console.error(e);
    $("vmStatusSetup").textContent = "Impossible de charger la vue 3D : vérifie ta connexion internet.";
    $("vmLoading").textContent = "Vue 3D indisponible";
  }
}

// Choix du format : paysage, vertical, ou les deux (l'aperçu montre alors le paysage)
function changeFormat(choice) {
  if (vm.busy || choice === vm.choice) return;
  vm.choice = choice;
  document.querySelectorAll("[data-format]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.format === choice)));
  $("vmBothHint").hidden = choice !== "both";
  if (!vm.map3d) return;
  setRenderFormat(choice === "both" ? "landscape" : choice);
  refreshPreview();
}

// 1re pastille de couleur = couleur du thème
const themeSwatch = document.querySelector("[data-color]");
themeSwatch.dataset.color = ACCENT.toLowerCase();
themeSwatch.style.setProperty("--c", ACCENT);
loadOpts();
updateOptLabels();
$("videoBtn").addEventListener("click", openVideoModal);
$("vmGenerate").addEventListener("click", generateVideo);
$("vmCancel").addEventListener("click", () => (vm.cancelled = true));
$("vmAgain").addEventListener("click", () => {
  setStage("setup");
  setRenderFormat(choiceFormats()[0]);
  refreshPreview();
});
$("vmViewSeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b) showResult(Number(b.dataset.view));
});
$("vmClose").addEventListener("click", () => {
  vm.cancelled = true;
  $("videoModal").close();
});
$("videoModal").addEventListener("cancel", () => (vm.cancelled = true));
document.querySelectorAll("[data-format]").forEach((b) => b.addEventListener("click", () => changeFormat(b.dataset.format)));
$("vmOptions").addEventListener("input", () => {
  saveOpts();
  schedulePreview();
});
$("vmTitleInput").addEventListener("input", schedulePreview);
$("vmScrub").addEventListener("input", schedulePreview);
$("vmDurationAuto").addEventListener("click", () => {
  optEl("duration").value = autoDuration(totalDist);
  schedulePreview();
});
$("vmReset").addEventListener("click", () => {
  try { localStorage.removeItem(OPTS_KEY); } catch { /* stockage indisponible */ }
  loadOpts();
  optEl("duration").value = autoDuration(totalDist);
  schedulePreview();
});
document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
  const p = PRESETS[b.dataset.preset];
  optEl("zoomOffset").value = p.zoomOffset;
  optEl("pitch").value = p.pitch;
  optEl("relief").value = p.relief;
  optEl("duration").value = Math.min(120, Math.max(8, Math.round(autoDuration(totalDist) * p.duration)));
  saveOpts();
  schedulePreview();
}));
document.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => {
  optEl("color").value = b.dataset.color;
  saveOpts();
  schedulePreview();
}));
document.querySelectorAll("[data-moment]").forEach((b) => b.addEventListener("click", () => {
  $("vmScrub").value = b.dataset.moment;
  schedulePreview();
}));
