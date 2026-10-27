/* =========================================================
   Créateur de parcours Loopace
   - Carte : Leaflet + fonds OpenStreetMap / Esri
   - Itinéraire piéton : OSRM (routing.openstreetmap.de, profil « foot »)
   - Altitude : Open-Meteo Elevation API
   - Recherche de lieu : Photon (komoot, données OpenStreetMap)
   Tous ces services sont gratuits.
   ========================================================= */
// Itinéraires : à pied pour la course (et « autre »), routes cyclables pour le vélo
const ROUTERS = {
  run: "https://routing.openstreetmap.de/routed-foot/route/v1/driving/",
  bike: "https://routing.openstreetmap.de/routed-bike/route/v1/driving/",
  other: "https://routing.openstreetmap.de/routed-foot/route/v1/driving/",
};
let sport = "run";
const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";
const SEARCH_URL = "https://photon.komoot.io/api/";
const STORAGE_KEY = "rotiby-parcours";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtKm = (m, digits = 2) => (m / 1000).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 3500);
}

/* ---------- Mise en page : la carte occupe l'espace sous la barre de navigation ---------- */
const navEl = $("nav");
function fitLayout() {
  document.documentElement.style.setProperty("--nav-h", `${navEl.offsetHeight}px`);
  map?.invalidateSize();
}

/* ---------- Carte ---------- */
const map = L.map("map", { zoomControl: false, doubleClickZoom: false }).setView([46.6, 2.4], 6);
L.control.zoom({ position: "bottomright" }).addTo(map);

// Les tuiles d'openstreetmap.org sont refusées sans en-tête Referer, ce qui arrive quand
// la page est ouverte en double-cliquant le fichier (file://) : on passe alors sur les
// serveurs d'OpenStreetMap France, au rendu quasi identique.
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const streetUrl = location.protocol.startsWith("http")
  ? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
  : "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png";
const baseLayers = {
  // Plan passé en mode sombre par un filtre CSS (voir .tiles-dark)
  Sombre: L.tileLayer(streetUrl, { maxZoom: 19, subdomains: "abc", attribution: OSM, className: "tiles-dark" }),
  Plan: L.tileLayer(streetUrl, { maxZoom: 19, subdomains: "abc", attribution: OSM }),
  // CyclOSM : met en avant chemins, sentiers et relief, idéal pour le trail
  Sentiers: L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", {
    maxZoom: 20, subdomains: "abc", attribution: `${OSM} · <a href="https://www.cyclosm.org">CyclOSM</a>`,
  }),
  Satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, attribution: "Imagerie &copy; Esri",
  }),
};
baseLayers.Sombre.addTo(map);
L.control.layers(baseLayers, null, { position: "topright" }).addTo(map);

const routeGlow = L.polyline([], { color: ACCENT, weight: 12, opacity: 0.25, interactive: false }).addTo(map);
const routeLine = L.polyline([], { color: ACCENT, weight: 4, opacity: 1, interactive: false }).addTo(map);

// Tracé en dégradé rose → violet (du départ vers l'arrivée, sur la largeur du tracé)
function applyRouteGradient() {
  const path = routeLine.getElement();
  const svg = path?.ownerSVGElement;
  if (!svg || ACCENT2.toLowerCase() === ACCENT.toLowerCase()) return;
  if (!svg.querySelector("#routeGrad")) {
    const ns = "http://www.w3.org/2000/svg";
    const defs = svg.querySelector("defs") || svg.insertBefore(document.createElementNS(ns, "defs"), svg.firstChild);
    const grad = document.createElementNS(ns, "linearGradient");
    grad.id = "routeGrad";
    grad.innerHTML = `<stop offset="0" stop-color="${ACCENT}"/><stop offset="1" stop-color="${ACCENT2}"/>`;
    defs.append(grad);
  }
  // Sens du dégradé : du départ vers l'arrivée
  const pts = routeLine.getLatLngs();
  if (pts.length > 1) {
    const a = map.latLngToLayerPoint(pts[0]);
    const b = map.latLngToLayerPoint(pts[pts.length - 1]);
    const loop = a.distanceTo(b) < 30; // boucle : départ ≈ arrivée, dégradé de gauche à droite
    const g = svg.querySelector("#routeGrad");
    g.setAttribute("x1", loop || a.x <= b.x ? "0" : "1");
    g.setAttribute("x2", loop || a.x <= b.x ? "1" : "0");
  }
  path.setAttribute("stroke", "url(#routeGrad)");
}
map.on("zoomend moveend", applyRouteGradient);
const kmLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);
const hoverDot = L.circleMarker([0, 0], { radius: 7, color: "#fff", weight: 2, fillColor: ACCENT, fillOpacity: 1, interactive: false });

fitLayout();
window.addEventListener("resize", fitLayout);

/* ---------- État ---------- */
let waypoints = [];   // [{ lat, lng, straight }] — straight : on arrive à ce point en ligne droite
let history = [];     // états précédents pour « Annuler »
let route = [];       // tracé complet [[lat, lng], …]
let totalDist = 0;    // mètres
let elevation = null; // { samples: [{ lat, lng, d, ele }], gain, loss }
let version = 0;      // ignore les réponses d'un calcul périmé
const segmentCache = new Map();
// Parcours rouvert : on affiche le tracé enregistré tel quel, tant qu'on ne le modifie pas
let savedLine = null; // { waypoints, line }

function commit(next) {
  history.push(waypoints.map((p) => ({ ...p })));
  if (history.length > 100) history.shift();
  waypoints = next;
  update();
}

/* ---------- Itinéraire ---------- */
async function getSegment(a, b) {
  const straight = [[a.lat, a.lng], [b.lat, b.lng]];
  if (!$("snap").checked || b.straight) return straight; // point posé au clic droit : ligne droite
  const key = `${sport}:${a.lat.toFixed(6)},${a.lng.toFixed(6)};${b.lat.toFixed(6)},${b.lng.toFixed(6)}`;
  if (segmentCache.has(key)) return segmentCache.get(key);
  try {
    // Service gratuit parfois lent ou indisponible : au-delà de 8 s, ligne droite
    const res = await fetch(`${ROUTERS[sport]}${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    if (json.code !== "Ok") throw new Error(json.code);
    const seg = json.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    segmentCache.set(key, seg);
    return seg;
  } catch {
    toast("Pas de chemin trouvé sur ce tronçon : tracé en ligne droite.");
    return straight;
  }
}

async function update() {
  const v = ++version;
  updateStartPlace();
  renderMarkers();
  updateButtons();
  $("mapHint").hidden = waypoints.length > 0;

  const useSaved = savedLine && savedLine.waypoints === waypoints;
  if (!useSaved) savedLine = null;
  const needsRouting = !useSaved && waypoints.slice(1).some((p) => !p.straight) && $("snap").checked;
  $("mapBusy").hidden = !needsRouting;
  const segs = [];
  for (let i = 0; !useSaved && i < waypoints.length - 1; i++) {
    segs.push(await getSegment(waypoints[i], waypoints[i + 1]));
    if (v !== version) return;
  }
  $("mapBusy").hidden = true;

  route = useSaved ? savedLine.line : segs.flatMap((s, i) => (i === 0 ? s : s.slice(1)));
  routeLine.setLatLngs(route);
  applyRouteGradient();
  routeGlow.setLatLngs(route);
  totalDist = 0;
  for (let i = 1; i < route.length; i++) totalDist += map.distance(route[i - 1], route[i]);

  renderKmMarkers();
  renderStats();
  updateButtons();
  loadElevation(v);
}

/* ---------- Marqueurs ---------- */
function waypointIcon(i) {
  const last = waypoints.length - 1;
  if (i === 0) return L.divIcon({ className: "", html: `<div class="wp wp--start">D</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
  if (i === last) return L.divIcon({ className: "", html: `<div class="wp wp--end">A</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
  const straight = waypoints[i].straight ? " wp--straight" : "";
  return L.divIcon({ className: "", html: `<div class="wp wp--via${straight}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
}

function renderMarkers() {
  markerLayer.clearLayers();
  waypoints.forEach((p, i) => {
    const m = L.marker(p, { icon: waypointIcon(i), draggable: true, autoPan: true, zIndexOffset: i === 0 ? 1000 : 0 });
    const label = i === 0 ? "Départ" : i === waypoints.length - 1 ? "Arrivée" : `Point ${i}`;
    m.bindTooltip(i > 0 && p.straight ? `${label} · ligne droite` : label, { direction: "top", offset: [0, -14] });
    m.on("dragend", () => {
      const next = waypoints.map((w) => ({ ...w }));
      const { lat, lng } = m.getLatLng();
      next[i] = { ...next[i], lat, lng };
      commit(next);
    });
    m.on("click", () => commit(waypoints.filter((_, j) => j !== i)));
    // Clic droit sur un point : bascule entre « suit les chemins » et « ligne droite » pour y arriver
    m.on("contextmenu", (e) => {
      L.DomEvent.preventDefault(e.originalEvent);
      if (i === 0) return;
      commit(waypoints.map((w, j) => (j === i ? { ...w, straight: !w.straight } : { ...w })));
    });
    m.addTo(markerLayer);
  });
}

function renderKmMarkers() {
  kmLayer.clearLayers();
  if (route.length < 2) return;
  const step = totalDist > 30000 ? 5000 : 1000;
  let acc = 0;
  let next = step;
  for (let i = 1; i < route.length; i++) {
    const d = map.distance(route[i - 1], route[i]);
    while (acc + d >= next) {
      const t = (next - acc) / d;
      const lat = route[i - 1][0] + (route[i][0] - route[i - 1][0]) * t;
      const lng = route[i - 1][1] + (route[i][1] - route[i - 1][1]) * t;
      L.marker([lat, lng], {
        interactive: false,
        icon: L.divIcon({ className: "", html: `<span class="km-mark">${next / 1000}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).addTo(kmLayer);
      next += step;
    }
    acc += d;
  }
}

map.on("click", (e) => commit([...waypoints, { lat: e.latlng.lat, lng: e.latlng.lng }]));
// Clic droit (ou appui long sur mobile) : point relié en ligne droite, sans suivre les chemins
map.on("contextmenu", (e) => commit([...waypoints, { lat: e.latlng.lat, lng: e.latlng.lng, straight: true }]));

/* ---------- Statistiques ---------- */
// Pas de durée ici : le temps (avec le dénivelé) se calcule dans le calculateur d'allure (bouton « Prédire mes temps »)
function renderStats() {
  $("distance").textContent = fmtKm(totalDist);
  showAutoName();
  $("gain").textContent = elevation ? `${elevation.gain} m` : "—";
  $("loss").textContent = elevation ? `${elevation.loss} m` : "—";
}

/* ---------- Type de parcours : course, vélo ou autre ---------- */
const SPORT_NAMES = { run: "Course", bike: "Vélo", other: "Autre" };
function setSport(next, reroute = true) {
  sport = ROUTERS[next] ? next : "run";
  document.querySelectorAll("[data-rsport]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rsport === sport)));
  if (reroute) update(); // le vélo suit les routes cyclables : on recalcule le tracé
}
$("routeSport").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rsport]");
  if (b && b.dataset.rsport !== sport) setSport(b.dataset.rsport);
});
$("snap").addEventListener("change", update);

/* ---------- Altitude ---------- */
function sampleRoute(n) {
  const cum = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + map.distance(route[i - 1], route[i]));
  const out = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const target = (totalDist * k) / (n - 1);
    while (j < route.length - 1 && cum[j] < target) j++;
    const span = cum[j] - cum[j - 1] || 1;
    const t = Math.min(1, Math.max(0, (target - cum[j - 1]) / span));
    out.push({
      lat: route[j - 1][0] + (route[j][0] - route[j - 1][0]) * t,
      lng: route[j - 1][1] + (route[j][1] - route[j - 1][1]) * t,
      d: target,
    });
  }
  return out;
}

let elevationTimer;
function loadElevation(v) {
  clearTimeout(elevationTimer);
  elevation = null;
  renderStats();
  renderProfile();
  if (totalDist < 20) return;
  elevationTimer = setTimeout(async () => {
    // Un point tous les ~50 m, 100 points maximum (limite de l'API)
    const samples = sampleRoute(Math.min(100, Math.max(2, Math.round(totalDist / 50))));
    const lat = samples.map((s) => s.lat.toFixed(5)).join(",");
    const lng = samples.map((s) => s.lng.toFixed(5)).join(",");
    try {
      const res = await fetch(`${ELEVATION_URL}?latitude=${lat}&longitude=${lng}`);
      const json = await res.json();
      if (v !== version) return;
      samples.forEach((s, i) => (s.ele = json.elevation[i]));
      let gain = 0;
      let loss = 0;
      for (let i = 1; i < samples.length; i++) {
        const diff = samples[i].ele - samples[i - 1].ele;
        if (diff > 0) gain += diff; else loss -= diff;
      }
      elevation = { samples, gain: Math.round(gain), loss: Math.round(loss) };
      renderStats();
      renderProfile();
    } catch {
      if (v === version) $("profileEmpty").textContent = "Altitude indisponible pour le moment.";
    }
  }, 500);
}

function renderProfile() {
  const svg = $("profile");
  const empty = $("profileEmpty");
  if (!elevation) {
    svg.innerHTML = "";
    $("profileInfo").textContent = "";
    empty.hidden = false;
    empty.textContent = totalDist ? "Calcul de l'altitude…" : "Trace un parcours pour voir le dénivelé.";
    return;
  }
  empty.hidden = true;
  const { samples } = elevation;
  const eles = samples.map((s) => s.ele);
  const min = Math.min(...eles);
  const max = Math.max(...eles);
  const range = Math.max(max - min, 20); // évite un profil « en dents de scie » sur le plat
  const x = (s) => (s.d / totalDist) * 300;
  const y = (s) => 92 - ((s.ele - min) / range) * 80;
  const line = samples.map((s, i) => `${i ? "L" : "M"}${x(s).toFixed(1)},${y(s).toFixed(1)}`).join("");
  svg.innerHTML = `
    <defs><linearGradient id="profileFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${ACCENT}" stop-opacity=".45"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${line}L300,100L0,100Z" fill="url(#profileFill)"/>
    <path d="${line}" fill="none" stroke="${ACCENT}" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <line id="profileCursor" y1="0" y2="100" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>`;
  $("profileInfo").textContent = `${Math.round(min)} – ${Math.round(max)} m`;
}

function profileHover(e) {
  if (!elevation) return;
  const rect = $("profile").getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const { samples } = elevation;
  const s = samples[Math.round(ratio * (samples.length - 1))];
  const cursor = $("profileCursor");
  cursor.setAttribute("x1", ratio * 300);
  cursor.setAttribute("x2", ratio * 300);
  cursor.setAttribute("visibility", "visible");
  $("profileInfo").textContent = `km ${fmtKm(s.d, 1)} · ${Math.round(s.ele)} m`;
  hoverDot.setLatLng([s.lat, s.lng]).addTo(map);
}
function profileLeave() {
  hoverDot.remove();
  if (!elevation) return;
  $("profileCursor")?.setAttribute("visibility", "hidden");
  const eles = elevation.samples.map((s) => s.ele);
  $("profileInfo").textContent = `${Math.round(Math.min(...eles))} – ${Math.round(Math.max(...eles))} m`;
}
$("profile").addEventListener("pointermove", profileHover);
$("profile").addEventListener("pointerleave", profileLeave);

/* ---------- Outils ---------- */
function updateButtons() {
  const n = waypoints.length;
  $("undoBtn").disabled = history.length === 0;
  $("clearBtn").disabled = n === 0;
  $("loopBtn").disabled = n < 2;
  $("backBtn").disabled = n < 2;
  $("saveBtn").disabled = n < 2;
  $("gpxBtn").disabled = n < 2;
  $("videoBtn").disabled = n < 2;
  $("predictBtn").disabled = n < 2;
}

$("undoBtn").addEventListener("click", () => {
  if (!history.length) return;
  waypoints = history.pop();
  update();
});
$("clearBtn").addEventListener("click", () => {
  commit([]);
  currentId = null; // le prochain enregistrement sera un nouveau parcours
  $("routeName").value = "";
});
$("loopBtn").addEventListener("click", () => commit([...waypoints, { lat: waypoints[0].lat, lng: waypoints[0].lng }]));
// Retour par le même chemin : un tronçon fait en ligne droite à l'aller l'est aussi au retour
$("backBtn").addEventListener("click", () => commit([
  ...waypoints,
  ...waypoints.slice(0, -1).map((p, k) => ({ lat: p.lat, lng: p.lng, straight: Boolean(waypoints[k + 1].straight) })).reverse(),
]));

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.target.matches("input")) {
    e.preventDefault();
    $("undoBtn").click();
  }
});

/* ---------- Recherche & position ---------- */
$("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("searchInput").value.trim();
  if (!q) return;
  try {
    const res = await fetch(`${SEARCH_URL}?limit=1&lang=fr&q=${encodeURIComponent(q)}`);
    const [place] = (await res.json()).features;
    if (!place) return toast("Lieu introuvable.");
    const extent = place.properties.extent; // [ouest, nord, est, sud]
    if (extent) {
      const [w, n, est, s] = extent;
      map.fitBounds([[s, w], [n, est]], { maxZoom: 16 });
    } else {
      const [lng, lat] = place.geometry.coordinates;
      map.setView([lat, lng], 15);
    }
  } catch {
    toast("Recherche indisponible pour le moment.");
  }
});

$("locateBtn").addEventListener("click", () => {
  if (!navigator.geolocation) return toast("La géolocalisation n'est pas disponible.");
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => map.setView([coords.latitude, coords.longitude], 15),
    () => toast("Impossible d'obtenir ta position."),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

/* ---------- Export GPX ---------- */
/* ---------- Nom du parcours ----------
   Celui que tu tapes, sinon « Ville · 10,4 km · 27 oct. » (ville du départ, retrouvée par Photon). */
let startPlace = "";   // ville du point de départ
let placeFor = "";     // point de départ pour lequel la ville a été cherchée
const today = () => new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
function autoName() {
  return [startPlace, `${fmtKm(totalDist, 1)} km`, today()].filter(Boolean).join(" · ");
}
function routeName() {
  return $("routeName").value.trim() || autoName();
}
// Cherche la ville du départ quand il change (une seule requête par point)
async function updateStartPlace() {
  const p = waypoints[0];
  const key = p ? `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` : "";
  if (key === placeFor) return;
  placeFor = key;
  startPlace = "";
  if (p) {
    try {
      const j = await fetch(`${SEARCH_URL.replace("/api/", "/reverse")}?lon=${p.lng}&lat=${p.lat}&limit=1&lang=fr`, { signal: AbortSignal.timeout(6000) }).then((r) => r.json());
      const props = j.features?.[0]?.properties || {};
      if (placeFor === key) startPlace = props.city || props.town || props.village || props.county || "";
    } catch { /* pas de ville : le nom garde la distance et la date */ }
  }
  showAutoName();
}
function showAutoName() {
  $("routeName").placeholder = waypoints.length > 1 && totalDist > 0 ? `Nom du parcours (sinon « ${autoName()} »)` : "Nom du parcours";
}

$("gpxBtn").addEventListener("click", () => {
  const name = routeName();
  const ele = (p) => {
    // altitude approximative : point d'échantillon le plus proche
    if (!elevation) return "";
    let best = elevation.samples[0];
    for (const s of elevation.samples) if (map.distance(p, [s.lat, s.lng]) < map.distance(p, [best.lat, best.lng])) best = s;
    return `<ele>${Math.round(best.ele)}</ele>`;
  };
  const pts = route.map((p) => `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}">${ele(p)}</trkpt>`).join("\n      ");
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${BRAND}" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
  <trk>
    <name>${esc(name)}</name>
    <type>${sport === "bike" ? "cycling" : sport === "run" ? "running" : "other"}</type>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
  a.download = `${name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "parcours"}.gpx`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Fichier GPX téléchargé : importe-le dans Garmin Connect, Strava ou ta montre.");
});

/* ---------- Parcours enregistrés (dans ce navigateur) ---------- */
function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}
function writeSaved(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    toast("Impossible d'enregistrer dans ce navigateur.");
    return false;
  }
}

function renderSaved() {
  const list = readSaved();
  $("savedList").innerHTML = list.length
    ? list.map((r) => `<li>
        <button class="saved__item" data-load="${r.id}">
          <strong>${esc(r.name)}</strong>
          <span>${SPORT_NAMES[r.sport] || "Course"} · ${fmtKm(r.distance, 1)} km${r.gain != null ? ` · D+ ${r.gain} m` : ""}</span>
        </button>
        <button class="saved__delete" data-delete="${r.id}" aria-label="Supprimer ${esc(r.name)}">✕</button>
      </li>`).join("")
    : `<li class="saved__empty">Aucun parcours enregistré pour l'instant.</li>`;
}

// Parcours de « Mes parcours » actuellement ouvert (ou déjà enregistré) : on le met à jour au lieu d'en créer un autre
let currentId = null;
let lastSavedName = "";

// Nom libre dans la liste : « Lyon · 10,4 km · 27 oct. (2) » si un autre parcours porte déjà ce nom
function uniqueName(name, list, ownId) {
  const taken = new Set(list.filter((r) => r.id !== ownId).map((r) => r.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

// Enregistre le parcours dans « Mes parcours » ; renvoie son identifiant
function saveRoute() {
  const saved = readSaved();
  const updating = currentId && saved.some((r) => r.id === currentId);
  const id = updating ? currentId : Date.now().toString(36);
  const auto = !$("routeName").value.trim(); // pas de nom tapé : nom automatique
  const name = uniqueName(routeName(), saved, id);
  const list = saved.filter((r) => r.id !== id); // l'ancienne version de CE parcours seulement
  list.unshift({
    id,
    name,
    autoName: auto,
    waypoints,
    sport,
    snap: $("snap").checked,
    distance: totalDist,
    gain: elevation?.gain ?? null,
    loss: elevation?.loss ?? null,
    // Profil d'altitude [distance m, altitude m] : utilisé par le calculateur d'allure
    profile: elevation ? elevation.samples.map((x) => [Math.round(x.d), Math.round(x.ele)]) : null,
    // Tracé (allégé) : le calculateur d'allure n'a pas à le redemander au service d'itinéraire
    line: route.filter((_, i) => i % Math.ceil(route.length / 1500) === 0 || i === route.length - 1)
      .map(([lat, lng]) => [+lat.toFixed(5), +lng.toFixed(5)]),
  });
  if (!writeSaved(list)) return null;
  currentId = id;
  lastSavedName = name;
  $("routeName").value = auto ? "" : name; // nom automatique : il suivra les modifications du parcours
  renderSaved();
  return id;
}

$("saveBtn").addEventListener("click", () => {
  const updating = currentId && readSaved().some((r) => r.id === currentId);
  if (saveRoute()) toast(`« ${lastSavedName} » ${updating ? "mis à jour" : "enregistré"}.`);
});

// Prédire mes temps : le parcours est enregistré puis ouvert dans le calculateur d'allure (dénivelé compris)
$("predictBtn").addEventListener("click", () => {
  const id = saveRoute();
  if (id) location.href = `allure.html?route=${encodeURIComponent(id)}#routeSection`;
});

$("savedList").addEventListener("click", (e) => {
  const load = e.target.closest("[data-load]");
  const del = e.target.closest("[data-delete]");
  if (del) {
    writeSaved(readSaved().filter((r) => r.id !== del.dataset.delete));
    if (del.dataset.delete === currentId) currentId = null;
    renderSaved();
  } else if (load) {
    const r = readSaved().find((x) => x.id === load.dataset.load);
    if (!r) return;
    $("snap").checked = r.snap;
    $("routeName").value = r.autoName ? "" : r.name; // nom automatique : refait à l'enregistrement
    currentId = r.id;
    setSport(r.sport || "run", false);
    savedLine = r.line?.length > 1 ? { waypoints: r.waypoints, line: r.line } : null;
    commit(r.waypoints);
    map.fitBounds(L.latLngBounds(r.waypoints), { padding: [40, 40] });
  }
});

/* ---------- Démarrage ---------- */
setSport("run", false);
renderSaved();
update();
