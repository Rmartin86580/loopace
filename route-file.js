/* =========================================================
   Import d'un parcours depuis un fichier : GPX, TCX ou FIT
   (parcours officiel d'une course, sortie enregistrée par ta montre…).
   Lecture dans le navigateur, rien n'est envoyé ; seule l'altitude manquante
   est demandée à Open-Meteo. Le lecteur .fit vient de fit.js.
   readRouteFile(file) → { name, points: [[lat, lng, altitude ou null], …], sport: "run" | "bike" | null }
   routeRecord(r, sport) → parcours au format « Mes parcours » (rotiby-parcours), pour le sport demandé
   ========================================================= */
const ROUTE_ACCEPT = ".gpx,.tcx,.fit";
const ROUTE_EXT = /\.(gpx|tcx|fit)$/i;
const ROUTE_STORE = "rotiby-parcours";
const ROUTE_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";

function geoDistance(a, b) {
  const rad = Math.PI / 180;
  const x = Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(((b[1] - a[1]) * rad) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}

// Sport écrit dans le fichier (« running », « Biking », « cycling »…) → "run" | "bike" | null
function sportFromText(t) {
  if (/bik|cycl|v[ée]lo|ride|gravel|vtt|mtb/i.test(t || "")) return "bike";
  if (/run|course|trail|hik|walk|marche|rando/i.test(t || "")) return "run";
  return null;
}

const tags = (doc, name) => [...doc.getElementsByTagNameNS("*", name)];
const childText = (el, name) => [...el.children].find((c) => c.localName === name)?.textContent.trim() || "";

function routeFromGpx(doc) {
  let pts = tags(doc, "trkpt");
  if (!pts.length) pts = tags(doc, "rtept"); // itinéraire (route) plutôt que trace
  const points = pts.map((p) => {
    const ele = childText(p, "ele");
    return [Number(p.getAttribute("lat")), Number(p.getAttribute("lon")), ele ? Number(ele) : null];
  });
  const owner = tags(doc, "trk")[0] || tags(doc, "rte")[0];
  const name = (owner && childText(owner, "name")) || (tags(doc, "metadata")[0] && childText(tags(doc, "metadata")[0], "name")) || "";
  return { name, points, sport: sportFromText(owner && childText(owner, "type")) };
}

function routeFromTcx(doc) {
  const points = tags(doc, "Trackpoint").map((tp) => {
    const pos = [...tp.children].find((c) => c.localName === "Position");
    if (!pos) return null;
    const alt = childText(tp, "AltitudeMeters");
    return [Number(childText(pos, "LatitudeDegrees")), Number(childText(pos, "LongitudeDegrees")), alt ? Number(alt) : null];
  }).filter(Boolean);
  const course = tags(doc, "Course")[0];
  const activity = tags(doc, "Activity")[0];
  return { name: course ? childText(course, "Name") : "", points, sport: sportFromText(activity?.getAttribute("Sport")) };
}

function routeFromFit(fit) {
  // Points (message 20) : 0 latitude, 1 longitude en semi-cercles ; altitude 78 (précise) ou 2, échelle 5, décalage 500
  const semi = 180 / 2 ** 31;
  const points = (fit[20] || [])
    .filter((r) => r[0] != null && r[1] != null)
    .map((r) => {
      const alt = r[78] ?? r[2];
      return [r[0] * semi, r[1] * semi, alt != null ? alt / 5 - 500 : null];
    });
  if (!points.length && (fit[27] || []).length) throw new Error("Ce fichier .fit est une séance, pas un parcours : importe-le dans l'outil Séance → boucle.");
  const sportCode = (fit[31] || [])[0]?.[4] ?? (fit[18] || [])[0]?.[5] ?? (fit[12] || [])[0]?.[0];
  return { name: (fit[31] || [])[0]?.[5] || "", points, sport: sportCode === 2 ? "bike" : [1, 11, 17].includes(sportCode) ? "run" : null };
}

async function readRouteFile(file) {
  const ext = (file.name.match(ROUTE_EXT)?.[1] || "").toLowerCase();
  if (!ext) throw new Error(`${file.name} : choisis un fichier .gpx, .tcx ou .fit.`);
  let r;
  if (ext === "fit") {
    r = routeFromFit(readFit(await file.arrayBuffer()));
  } else {
    const doc = new DOMParser().parseFromString(await file.text(), "application/xml");
    if (doc.querySelector("parsererror")) throw new Error(`${file.name} : fichier illisible.`);
    r = ext === "gpx" ? routeFromGpx(doc) : routeFromTcx(doc);
  }
  r.points = r.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
  if (r.points.length < 2) throw new Error(`Aucun tracé trouvé dans ${file.name}.`);
  r.name = r.name || file.name.replace(ROUTE_EXT, "");
  return r;
}

// Points de passage modifiables : le tracé simplifié (Douglas-Peucker), 40 points au plus
function routeWaypoints(points) {
  const keep = (tol) => {
    const flags = new Array(points.length).fill(false);
    flags[0] = flags[points.length - 1] = true;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let best = -1;
      let far = 0;
      for (let i = a + 1; i < b; i++) {
        // Écart au segment, en mètres (approximation locale suffisante ici)
        const k = Math.cos((points[a][0] * Math.PI) / 180);
        const ax = points[a][1] * k, ay = points[a][0], bx = points[b][1] * k, by = points[b][0];
        const px = points[i][1] * k, py = points[i][0];
        const len = (bx - ax) ** 2 + (by - ay) ** 2 || 1e-12;
        const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len));
        const d = Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))) * 111320;
        if (d > far) { far = d; best = i; }
      }
      if (best > 0 && far > tol) {
        flags[best] = true;
        stack.push([a, best], [best, b]);
      }
    }
    return points.filter((_, i) => flags[i]);
  };
  let tol = 10;
  let wps = keep(tol);
  while (wps.length > 40) wps = keep((tol *= 1.6));
  // Reliés en ligne droite : le tracé importé reste tel quel, même si on déplace un point
  return wps.map((p, i) => ({ lat: +p[0].toFixed(6), lng: +p[1].toFixed(6), ...(i ? { straight: true } : {}) }));
}

// Profil d'altitude [distance m, altitude m] (100 points au plus) et dénivelé, comme dans l'outil Parcours
async function importedProfile(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + geoDistance(points[i - 1], points[i]));
  const total = cum[cum.length - 1];
  const n = Math.min(100, Math.max(2, Math.round(total / 50)));
  const samples = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < points.length - 1 && cum[j] < target) j++;
    const t = Math.min(1, Math.max(0, (target - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1)));
    const a = points[j - 1];
    const b = points[j];
    samples.push({
      d: target,
      lat: a[0] + (b[0] - a[0]) * t,
      lng: a[1] + (b[1] - a[1]) * t,
      ele: a[2] != null && b[2] != null ? a[2] + (b[2] - a[2]) * t : null,
    });
  }
  // Altitude absente du fichier : on la demande à Open-Meteo
  if (samples.some((s) => s.ele == null)) {
    try {
      const res = await fetch(`${ROUTE_ELEVATION_URL}?latitude=${samples.map((s) => s.lat.toFixed(5)).join(",")}&longitude=${samples.map((s) => s.lng.toFixed(5)).join(",")}`, { signal: AbortSignal.timeout(15000) });
      const json = await res.json();
      samples.forEach((s, i) => { s.ele = json.elevation[i]; });
    } catch {
      return { distance: total, profile: null, gain: null, loss: null };
    }
  }
  const profile = samples.map((s) => [Math.round(s.d), Math.round(s.ele)]);
  // Dénivelé sur l'altitude lissée (± 100 m) : le « bruit » des données n'invente pas de côtes
  const smooth = profile.map(([d]) => {
    const near = profile.filter(([d2]) => Math.abs(d2 - d) <= 100);
    return near.reduce((sum, p) => sum + p[1], 0) / near.length;
  });
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < smooth.length; i++) {
    const dz = smooth[i] - smooth[i - 1];
    if (dz > 0) gain += dz; else loss -= dz;
  }
  return { distance: total, profile, gain: Math.round(gain), loss: Math.round(loss) };
}

// Parcours importé au format « Mes parcours » (sans l'enregistrer)
async function routeRecord(r, sport) {
  const { distance, profile, gain, loss } = await importedProfile(r.points);
  const step = Math.ceil(r.points.length / 1500); // tracé allégé, comme dans l'outil Parcours
  return {
    id: Date.now().toString(36),
    name: r.name,
    autoName: false,
    waypoints: routeWaypoints(r.points),
    sport: sport || r.sport || "run", // importé depuis Allure ou Triathlon : le sport de la page
    snap: true,
    distance,
    gain,
    loss,
    profile,
    line: r.points.filter((_, i) => i % step === 0 || i === r.points.length - 1).map(([lat, lng]) => [+lat.toFixed(5), +lng.toFixed(5)]),
  };
}

// Ajoute le parcours en tête de « Mes parcours » (un numéro s'ajoute au nom s'il est déjà pris)
function storeRoute(rec) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(ROUTE_STORE)) || []; } catch { /* vide */ }
  const taken = new Set(list.map((x) => x.name));
  if (taken.has(rec.name)) {
    let n = 2;
    while (taken.has(`${rec.name} (${n})`)) n++;
    rec.name = `${rec.name} (${n})`;
  }
  list.unshift(rec);
  localStorage.setItem(ROUTE_STORE, JSON.stringify(list)); // lève une erreur si le stockage est plein ou bloqué
  return rec;
}

// Importe un fichier dans « Mes parcours » : pour Allure et Triathlon. Renvoie le parcours enregistré.
async function importRouteFile(file, sport) {
  const rec = await routeRecord(await readRouteFile(file), sport);
  try {
    return storeRoute(rec);
  } catch {
    throw new Error("Impossible d'enregistrer le parcours dans ce navigateur.");
  }
}
