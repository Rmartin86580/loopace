/* =========================================================
   Calculateur d'allure Loopace
   Distance + temps → allure, temps + allure → distance, etc.
   Calculs internes : distance en mètres, temps en secondes,
   « rythme » en secondes par mètre.
   ========================================================= */
const $ = (id) => document.getElementById(id);

const SPORTS = {
  run: {
    distUnit: "km", distFactor: 1000,
    paceLabel: "Allure", paceUnit: "/km", paceHint: "ex : 5:30", paceBase: 1000,
    presets: [["5 km", 5], ["10 km", 10], ["Semi", 21.0975], ["Marathon", 42.195]],
    defaults: { dist: "10", time: "50:00", pace: "5:00" },
    splitEvery: 1000,
  },
  swim: {
    distUnit: "m", distFactor: 1,
    paceLabel: "Allure", paceUnit: "/100 m", paceHint: "ex : 1:45", paceBase: 100,
    presets: [["400 m", 400], ["750 m", 750], ["1 500 m", 1500], ["1 900 m", 1900], ["3 800 m", 3800]],
    defaults: { dist: "1500", time: "30:00", pace: "2:00" },
    splitEvery: 100,
  },
  bike: {
    distUnit: "km", distFactor: 1000,
    paceLabel: "Vitesse", paceUnit: "km/h", paceHint: "ex : 30", speed: true,
    presets: [["20 km", 20], ["40 km", 40], ["90 km", 90], ["180 km", 180]],
    defaults: { dist: "40", time: "1:20:00", pace: "30" },
    splitEvery: 10000,
  },
};

const state = { sport: "run", target: "time", step: {} }; // step : intervalle de passage choisi par sport (mètres)

// Raccourcis « passage tous les … » (en mètres)
const STEP_PRESETS = {
  run: [400, 500, 1000, 2000, 5000],
  swim: [50, 100, 200, 500],
  bike: [5000, 10000, 20000],
};
const sport = () => SPORTS[state.sport];

/* ---------- Lecture / écriture des valeurs ---------- */
const num = (v) => Number(String(v).replace(",", ".").replace(/\s/g, ""));

// "1:45:30", "45:30", "45", "1h45", "1h45m30", "1 h 05" → secondes
function parseTime(v) {
  const s = String(v).trim().toLowerCase().replace(/\s/g, "").replace(/min$/, "");
  if (!s) return NaN;
  const h = s.match(/^(\d+)h(\d+)?(?:m|:)?(\d+)?s?$/);
  if (h) return Number(h[1]) * 3600 + Number(h[2] || 0) * 60 + Number(h[3] || 0);
  const parts = s.replace(/['"]/g, ":").split(":").filter((p) => p !== "");
  if (!parts.length || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  const n = parts.map(Number);
  if (n.length === 1) return n[0] * 60; // un seul nombre = des minutes
  if (n.length === 2) return n[0] * 60 + n[1];
  if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
  return NaN;
}

// Allure "5:30" ou "5'30" ou "5" → secondes
function parsePace(v) {
  const s = String(v).trim().replace(/['"]/g, ":").replace(/\s/g, "");
  if (!s) return NaN;
  const n = s.split(":").filter((p) => p !== "").map(Number);
  if (n.some(Number.isNaN)) return NaN;
  if (n.length === 1) return n[0] * 60;
  if (n.length === 2) return n[0] * 60 + n[1];
  return NaN;
}

const pad = (n) => String(n).padStart(2, "0");
function fmtTime(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function fmtPace(sec) {
  sec = Math.round(sec);
  return `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
}
const fmtNum = (v, d = 2) => v.toLocaleString("fr-FR", { maximumFractionDigits: d });
function fmtDist(m) {
  const sp = sport();
  return sp.distUnit === "m" ? `${fmtNum(m, 0)} m` : `${fmtNum(m / 1000)} km`;
}

/* ---------- Conversions rythme (s/m) ↔ champ allure/vitesse ---------- */
function readRate() {
  const sp = sport();
  if (sp.speed) {
    const kmh = num($("pace").value);
    return kmh > 0 ? 3.6 / kmh : NaN;
  }
  const p = parsePace($("pace").value);
  return p > 0 ? p / sp.paceBase : NaN;
}
function rateToField(spm) {
  const sp = sport();
  return sp.speed ? fmtNum(3.6 / spm, 1) : fmtPace(spm * sp.paceBase);
}
function readDist() {
  const d = num($("dist").value) * sport().distFactor;
  return d > 0 ? d : NaN;
}
function distToField(m) {
  const sp = sport();
  return sp.distUnit === "m" ? String(Math.round(m)) : fmtNum(m / 1000, 3);
}

/* ---------- Calcul principal ---------- */
function compute() {
  let d = state.target === "dist" ? NaN : readDist();
  let t = state.target === "time" ? NaN : parseTime($("time").value);
  let r = state.target === "pace" ? NaN : readRate();

  if (state.target === "time" && d > 0 && r > 0) t = d * r;
  else if (state.target === "pace" && d > 0 && t > 0) r = t / d;
  else if (state.target === "dist" && t > 0 && r > 0) d = t / r;

  const ok = d > 0 && t > 0 && r > 0;
  // Le champ calculé affiche le résultat
  if (state.target === "time") $("time").value = ok ? fmtTime(t) : "";
  if (state.target === "pace") $("pace").value = ok ? rateToField(r) : "";
  if (state.target === "dist") $("dist").value = ok ? distToField(d) : "";

  renderResult(ok, d, t, r);
  renderSplits(ok, d, t, r);
  saveState();
}

function renderResult(ok, d, t, r) {
  const sp = sport();
  const labels = { time: "Ton temps", pace: sp.speed ? "Ta vitesse" : "Ton allure", dist: "Ta distance" };
  $("resLabel").textContent = labels[state.target];
  if (!ok) {
    $("resMain").textContent = "—";
    $("resExtra").textContent = "Remplis les deux autres champs.";
    $("result").classList.add("is-empty");
    return;
  }
  $("result").classList.remove("is-empty");
  const main = {
    time: fmtTime(t),
    pace: sp.speed ? `${fmtNum(3.6 / r, 1)} km/h` : `${fmtPace(r * sp.paceBase)} ${sp.paceUnit}`,
    dist: fmtDist(d),
  };
  $("resMain").textContent = main[state.target];
  // Équivalences utiles selon le sport
  const extra = [];
  if (state.sport === "run") extra.push(`${fmtNum(3.6 / r, 1)} km/h`, `${fmtPace(r * 1000)} /km`);
  if (state.sport === "swim") extra.push(`${fmtPace(r * 100)} /100 m`, `${fmtNum(3.6 / r, 2)} km/h`);
  if (state.sport === "bike") extra.push(`${fmtNum(3.6 / r, 1)} km/h`, `${fmtPace(r * 1000)} /km`);
  if (state.target !== "time") extra.push(fmtTime(t));
  if (state.target !== "dist") extra.push(fmtDist(d));
  $("resExtra").innerHTML = [...new Set(extra)].filter((x) => x !== main[state.target]).map((x) => `<span>${x}</span>`).join("");
}

// Plan du calculateur classique, pour le bracelet d'allure
let calcPlan = null;
const SPORT_NAMES = { run: "Course", swim: "Natation", bike: "Vélo" };

function renderSplits(ok, d, t, r) {
  const sp = sport();
  const body = $("splits").querySelector("tbody");
  $("calcBandBtn").disabled = !ok;
  if (!ok) {
    calcPlan = null;
    body.innerHTML = "";
    $("splitsHint").textContent = "Les temps de passage s'affichent une fois le calcul fait.";
    return;
  }
  // Intervalle choisi, sinon automatique (60 lignes maximum)
  let step = state.step[state.sport];
  if (!(step > 0)) {
    step = sp.splitEvery;
    while (d / step > 60) step *= state.sport === "swim" ? 5 : 2;
    if (state.sport === "bike" && d < 30000) step = 5000;
  }
  step = Math.max(step, d / 500); // garde-fou : 500 lignes au plus
  renderStepField(step);
  const rows = [];
  for (let m = step; m < d - 1; m += step) rows.push(m);
  rows.push(d);
  const unit = sp.speed ? "/km" : sp.paceUnit;
  const paceTxt = sp.speed ? `${fmtNum(3.6 / r, 1)} km/h` : `${fmtPace(r * (sp.paceBase))} ${unit}`;
  $("splitsHint").textContent = `Allure régulière de ${paceTxt}, passage tous les ${fmtDist(step)}.`;
  const paceCell = sp.speed ? `${fmtNum(3.6 / r, 1)}` : fmtPace(r * sp.paceBase);
  const label = (m) => (sp.distUnit === "m" ? String(Math.round(m)) : fmtNum(m / 1000, 2));
  calcPlan = {
    name: `${SPORT_NAMES[state.sport]} · ${fmtDist(d)}`,
    time: t,
    info: [`${fmtDist(d)} · ${sp.speed ? `${paceCell} km/h` : `${paceCell} ${sp.paceUnit}`}`, "Allure régulière"],
    paceHead: sp.speed ? "KM/H" : sp.paceUnit === "/km" ? "ALLURE" : "/100 M",
    splits: rows.map((m, i) => ({ label: label(m), cum: m * r, paceTxt: paceCell, grade: 0, finish: i === rows.length - 1 })),
  };
  body.innerHTML = rows.map((m, i) => `<tr class="${i === rows.length - 1 ? "is-finish" : ""}">
      <td>${i === rows.length - 1 ? `Arrivée · ${fmtDist(m)}` : fmtDist(m)}</td>
      <td>${fmtTime(m * r)}</td>
      <td>${sp.speed ? `${fmtNum(3.6 / r, 1)} km/h` : fmtPace(r * sp.paceBase)}</td>
    </tr>`).join("");
}

/* ---------- « Passage tous les … » ---------- */
const stepLabel = (m) => (sport().distUnit === "m" ? `${m} m` : m < 1000 ? `${m} m` : `${fmtNum(m / 1000)} km`);

function renderStepField(step) {
  const sp = sport();
  $("stepUnit").textContent = sp.distUnit;
  // Valeur personnalisée = pas un des raccourcis : la pastille « Autre » est alors active
  const custom = !STEP_PRESETS[state.sport].some((m) => Math.abs(m - step) < 1);
  $("stepCustom").classList.toggle("is-active", custom);
  // Ne réécrit pas la pastille pendant que l'utilisateur tape dedans
  if (document.activeElement !== $("stepInput")) {
    $("stepInput").value = custom ? (sp.distUnit === "m" ? String(Math.round(step)) : fmtNum(step / 1000, 3)) : "";
  }
  fitStepInput();
  $("stepChips").innerHTML = STEP_PRESETS[state.sport]
    .map((m) => `<button type="button" data-step="${m}" aria-pressed="${Math.abs(m - step) < 1}">${stepLabel(m)}</button>`)
    .join("");
}

// La pastille « Autre » s'ajuste à la longueur de ce qui est tapé
const fitStepInput = () => ($("stepInput").style.width = $("stepInput").value ? `${$("stepInput").value.length + 0.6}ch` : "");
$("stepInput").addEventListener("input", fitStepInput);
$("stepInput").addEventListener("input", () => {
  const v = num($("stepInput").value) * sport().distFactor;
  if (v > 0) {
    state.step[state.sport] = v;
    compute();
  }
});
$("stepChips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-step]");
  if (!b) return;
  state.step[state.sport] = Number(b.dataset.step);
  compute();
});

/* ---------- Interface ---------- */
function renderPresets() {
  const sp = sport();
  $("presets").innerHTML = sp.presets.map(([label, v]) => `<button type="button" data-preset="${v}">${label}</button>`).join("");
}

function applySport(keepValues) {
  const sp = sport();
  document.querySelectorAll("[data-sport]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sport === state.sport)));
  $("distUnit").textContent = sp.distUnit;
  $("paceLabel").textContent = sp.paceLabel;
  $("paceUnit").textContent = sp.paceUnit;
  $("paceHint").textContent = sp.paceHint;
  $("pace").inputMode = sp.speed ? "decimal" : "numeric";
  $("targetPaceBtn").textContent = sp.speed ? "ma vitesse" : "mon allure";
  $("routeSection").hidden = state.sport === "swim"; // course et vélo : prédiction sur un parcours
  renderPresets();
  if (!keepValues) {
    $("dist").value = sp.defaults.dist;
    $("time").value = sp.defaults.time;
    $("pace").value = sp.defaults.pace;
  }
}

function applyTarget() {
  document.querySelectorAll("[data-target]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.target === state.target)));
  document.querySelectorAll("[data-field]").forEach((f) => {
    const out = f.dataset.field === state.target;
    f.classList.toggle("is-output", out);
    f.querySelector("input").readOnly = out;
    f.querySelector("input").tabIndex = out ? -1 : 0;
  });
}

document.querySelectorAll("[data-sport]").forEach((b) => b.addEventListener("click", () => {
  if (state.sport === b.dataset.sport) return;
  state.sport = b.dataset.sport;
  applySport(false);
  compute();
  if (state.sport !== "swim") renderRoutePredict(); // parcours du sport choisi
}));
document.querySelectorAll("[data-target]").forEach((b) => b.addEventListener("click", () => {
  state.target = b.dataset.target;
  applyTarget();
  compute();
}));
$("presets").addEventListener("click", (e) => {
  const b = e.target.closest("[data-preset]");
  if (!b) return;
  $("dist").value = sport().distUnit === "m" ? b.dataset.preset : fmtNum(Number(b.dataset.preset), 4);
  // Si on calculait la distance, une distance choisie fait plutôt calculer le temps
  if (state.target === "dist") {
    state.target = "time";
    applyTarget();
  }
  compute();
});
["dist", "time", "pace"].forEach((id) => $(id).addEventListener("input", compute));

/* ---------- Mémorise les dernières valeurs (dans ce navigateur) ---------- */
const STORE_KEY = "rotiby-allure";
function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      ...state, dist: $("dist").value, time: $("time").value, pace: $("pace").value,
      step: state.step,
    }));
  } catch { /* stockage indisponible */ }
}
function loadState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { /* stockage indisponible */ }
  if (saved && SPORTS[saved.sport]) {
    state.sport = saved.sport;
    state.target = ["time", "pace", "dist"].includes(saved.target) ? saved.target : "time";
    applySport(false);
    $("dist").value = saved.dist ?? $("dist").value;
    $("time").value = saved.time ?? $("time").value;
    $("pace").value = saved.pace ?? $("pace").value;
    if (saved.step && typeof saved.step === "object") state.step = saved.step;
  } else {
    applySport(false);
  }
}

loadState();
applyTarget();
compute();

/* =========================================================
   Prédiction sur un parcours enregistré (avec dénivelé)
   Les parcours viennent de l'outil Parcours (même navigateur).
   ========================================================= */
const ROUTES_KEY = "rotiby-parcours";
const ROUTER_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/driving/";
const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";
// Objectifs gardés séparément pour la course (time, pace) et le vélo (btime, speed)
const rp = { goal: "time", req: 0, goals: { time: "", pace: "5:30", btime: "", speed: "28" }, touched: { time: false, pace: false, btime: false, speed: false } };
const isBike = () => state.sport === "bike";
const goalKey = () => (isBike() ? (rp.goal === "pace" ? "speed" : "btime") : rp.goal);
// Parcours du bon sport : vélo (et « autre ») pour le vélo ; course (et « autre », anciens parcours) pour la course
const routesForSport = (list) => list.filter((r) => (isBike() ? r.sport === "bike" || r.sport === "other" : r.sport !== "bike"));

function readRoutes() {
  try { return JSON.parse(localStorage.getItem(ROUTES_KEY)) || []; } catch { return []; }
}
function writeRoutes(list) {
  try { localStorage.setItem(ROUTES_KEY, JSON.stringify(list)); } catch { /* stockage indisponible */ }
}

// Effet de la pente (en %) sur le temps : 1 = comme sur le plat
function gradeFactor(g) {
  g = Math.max(-35, Math.min(35, g));
  if (g >= 0) return 1 + 0.033 * g; // montée : +3,3 % par % de pente
  if (g >= -10) return 1 + 0.018 * g; // descente douce : on va plus vite
  return 0.82 + 0.02 * (-g - 10); // descente raide : le gain diminue
}

/* ---------- Profil des anciens parcours (enregistrés sans altitude) ---------- */
function haversine(a, b) {
  const r = Math.PI / 180;
  const x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(x));
}

// Tracé du parcours : enregistré avec le parcours (récent), sinon redemandé en UNE requête
async function routeLine(route) {
  if (route.line?.length > 1) return { line: route.line, approx: false };
  const straight = { line: route.waypoints.map((p) => [p.lat, p.lng]), approx: false };
  if (!route.snap) return straight;
  try {
    const coords = route.waypoints.map((p) => `${p.lng},${p.lat}`).join(";");
    const res = await fetch(`${ROUTER_URL}${coords}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    if (json.code === "Ok") return { line: json.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]), approx: false };
  } catch { /* service lent ou indisponible : ligne droite entre les points */ }
  return { ...straight, approx: true };
}

// Renvoie { profile, approx } ; approx = tracé estimé en ligne droite (service indisponible)
async function buildProfile(route) {
  const { line, approx } = await routeLine(route);
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversine(line[i - 1], line[i]));
  const total = cum[cum.length - 1];
  const n = Math.min(100, Math.max(2, Math.round(total / 50)));
  const samples = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < line.length - 1 && cum[j] < target) j++;
    const t = Math.min(1, Math.max(0, (target - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1)));
    samples.push([target, line[j - 1][0] + (line[j][0] - line[j - 1][0]) * t, line[j - 1][1] + (line[j][1] - line[j - 1][1]) * t]);
  }
  const res = await fetch(`${ELEVATION_URL}?latitude=${samples.map((s) => s[1].toFixed(5)).join(",")}&longitude=${samples.map((s) => s[2].toFixed(5)).join(",")}`, { signal: AbortSignal.timeout(15000) });
  const json = await res.json();
  return { profile: samples.map((s, i) => [Math.round(s[0]), Math.round(json.elevation[i])]), approx };
}

/* ---------- Calcul ---------- */
// Allure « sur le plat » (secondes par mètre) qui donne l'objectif sur ce parcours.
// Le temps est proportionnel à cette allure : temps = allure plat × effort(parcours).
function flatPace(profile) {
  const total = profile[profile.length - 1][0];
  const effort = predictOnProfile(profile, 1).time; // mètres « équivalent plat »
  if (rp.goal === "time") {
    const t = parseTime($("rpGoal").value);
    return t > 0 ? t / effort : NaN;
  }
  if (rp.goal === "pace") {
    const p = parsePace($("rpGoal").value);
    return p > 0 ? (p / 1000) * total / effort : NaN;
  }
  return NaN;
}

// Lisse l'altitude (moyenne sur ±100 m) : les données d'altitude ont un petit « bruit »
// qui, sinon, inventerait des montées et descentes sur un parcours plat.
function smoothProfile(profile, radius = 100) {
  return profile.map(([d]) => {
    const near = profile.filter(([d2]) => Math.abs(d2 - d) <= radius);
    return [d, near.reduce((sum, p) => sum + p[1], 0) / near.length];
  });
}

function predictOnProfile(rawProfile, spm) {
  const profile = smoothProfile(rawProfile);
  const total = profile[profile.length - 1][0];
  const kms = [];
  let cur = { len: 0, time: 0, climb: 0 };
  let time = 0;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < profile.length; i++) {
    const [d0, e0] = profile[i - 1];
    const [d1, e1] = profile[i];
    const len = d1 - d0;
    if (len <= 0) continue;
    const dz = e1 - e0;
    if (dz > 0) gain += dz; else loss -= dz;
    const f = gradeFactor((dz / len) * 100);
    // Découpe le tronçon aux bornes de kilomètre
    let pos = d0;
    while (pos < d1 - 1e-6) {
      const kmEnd = (Math.floor(pos / 1000) + 1) * 1000;
      const end = Math.min(d1, kmEnd);
      const part = end - pos;
      const tPart = part * spm * f;
      cur.len += part;
      cur.time += tPart;
      cur.climb += dz * (part / len);
      time += tPart;
      pos = end;
      if (end === kmEnd) {
        kms.push(cur);
        cur = { len: 0, time: 0, climb: 0 };
      }
    }
  }
  if (cur.len > 1) kms.push(cur);
  return { total, time, gain: Math.round(gain), loss: Math.round(loss), kms, flat: total * spm };
}

/* ---------- Vélo : temps selon la vitesse sur le plat et le dénivelé ---------- */
// Sur chaque tronçon : temps au plat + ≈ 2,4 s par mètre de montée − 0,8 s par mètre de descente
// (même repère que le planificateur triathlon), sans descendre sous la moitié du temps au plat.
function predictBike(profile, kmh, step) {
  const v = kmh / 3.6;
  const total = profile[profile.length - 1][0];
  const kms = [];
  let cur = { len: 0, time: 0, climb: 0 };
  let time = 0;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < profile.length; i++) {
    const [d0, e0] = profile[i - 1];
    const [d1, e1] = profile[i];
    const len = d1 - d0;
    if (len <= 0) continue;
    const dz = e1 - e0;
    if (dz > 0) gain += dz; else loss -= dz;
    let pos = d0;
    while (pos < d1 - 1e-6) {
      const stepEnd = (Math.floor(pos / step) + 1) * step;
      const end = Math.min(d1, stepEnd);
      const part = end - pos;
      const dzp = dz * (part / len);
      const base = part / v;
      const tPart = Math.max(base * 0.5, base + (dzp > 0 ? 2.4 * dzp : 0.8 * dzp));
      cur.len += part;
      cur.time += tPart;
      cur.climb += dzp;
      time += tPart;
      pos = end;
      if (end === stepEnd) {
        kms.push(cur);
        cur = { len: 0, time: 0, climb: 0 };
      }
    }
  }
  if (cur.len > 1) kms.push(cur);
  return { total, time, gain: Math.round(gain), loss: Math.round(loss), kms };
}

// Vitesse sur le plat qui donne le temps visé sur ce parcours (recherche par dichotomie)
function bikeFlatSpeed(profile, target, step) {
  let lo = 3;
  let hi = 120;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (predictBike(profile, mid, step).time > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Recale le profil sur la distance exacte du parcours enregistré : un profil reconstruit
// (ligne droite, tracé allégé) peut être un peu plus court ou plus long.
function fitProfile(route) {
  const p = route.profile;
  const len = p[p.length - 1][0];
  const k = route.distance > 0 && len > 0 ? route.distance / len : 1;
  return p.map(([d, e]) => [d * k, e]);
}

/* ---------- Affichage ---------- */
function drawRpProfile(profile) {
  const eles = profile.map((p) => p[1]);
  const min = Math.min(...eles);
  const max = Math.max(...eles);
  const range = Math.max(max - min, 20);
  const total = profile[profile.length - 1][0];
  const line = profile.map(([d, e], i) => `${i ? "L" : "M"}${((d / total) * 300).toFixed(1)},${(92 - ((e - min) / range) * 80).toFixed(1)}`).join("");
  $("rpProfile").innerHTML = `
    <defs><linearGradient id="rpFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${ACCENT}" stop-opacity=".45"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${line}L300,100L0,100Z" fill="url(#rpFill)"/>
    <path d="${line}" fill="none" stroke="${ACCENT}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  $("rpProfileInfo").textContent = `${Math.round(min)} – ${Math.round(max)} m`;
}

function rpStatus(text) {
  $("rpStatus").hidden = !text;
  $("rpStatus").textContent = text || "";
  $("rpResults").hidden = Boolean(text);
  document.querySelector(".rp-table").hidden = Boolean(text);
}

async function renderRoutePredict() {
  const routes = routesForSport(readRoutes());
  $("rpEmpty").hidden = routes.length > 0;
  $("rpBody").hidden = routes.length === 0;
  $("rpEmptyText").textContent = isBike()
    ? "Tu n'as pas encore de parcours vélo : dans l'outil Parcours, choisis « Vélo » avant d'enregistrer."
    : "Tu n'as pas encore de parcours enregistré dans ce navigateur.";
  if (!routes.length) return;

  // Liste des parcours (on garde la sélection)
  const selected = $("rpRoute").value;
  $("rpRoute").innerHTML = routes.map((r) => `<option value="${r.id}">${r.name.replace(/</g, "&lt;")} · ${fmtNum(r.distance / 1000, 1)} km${r.gain != null ? ` · D+ ${r.gain} m` : ""}</option>`).join("");
  if (routes.some((r) => r.id === selected)) $("rpRoute").value = selected;

  renderGoalField();

  const req = ++rp.req;
  const list = readRoutes();
  const route = list.find((r) => r.id === $("rpRoute").value);
  if (!route) return;

  // Anciens parcours sans profil : on le calcule une fois puis on le garde
  if (!route.profile || route.profile.length < 2) {
    rpStatus("Calcul du profil d'altitude de ce parcours…");
    try {
      // Un seul calcul par parcours, même si on tape pendant le chargement
      rp.pending ??= {};
      rp.pending[route.id] ??= buildProfile(route).finally(() => delete rp.pending[route.id]);
      const built = await rp.pending[route.id];
      route.profile = built.profile;
      route.profileApprox = built.approx;
      writeRoutes(list.map((r) => (r.id === route.id ? route : r)));
    } catch {
      if (req === rp.req) rpStatus("Impossible de récupérer l'altitude de ce parcours (vérifie ta connexion).");
      return;
    }
    if (req !== rp.req) return;
  }
  rpStatus("");
  // Distance de référence = celle du parcours enregistré (identique à l'outil Parcours)
  const profile = fitProfile(route);
  $("rpApprox").hidden = !route.profileApprox;
  drawRpProfile(profile);

  if (isBike()) return renderBikePredict(route, profile);

  // Tant que l'objectif n'a pas été saisi, on propose un temps adapté au parcours (≈ 5:30 /km)
  if (!rp.touched.time) {
    const total = profile[profile.length - 1][0];
    rp.goals.time = fmtTime(Math.max(60, Math.round(((total / 1000) * 330) / 60) * 60));
    if (rp.goal === "time") $("rpGoal").value = rp.goals.time;
  }

  const spm = flatPace(profile);
  if (!(spm > 0)) {
    $("rpTime").textContent = "—";
    $("rpExtra").innerHTML = "<span>Indique ton objectif</span>";
    $("rpSplits").innerHTML = "";
    $("bandBtn").disabled = true;
    return;
  }
  const r = predictOnProfile(profile, spm);
  $("rpTime").textContent = fmtTime(r.time);
  const extra = [
    `${fmtPace(r.time / (r.total / 1000))} /km de moyenne`,
    `${fmtNum(r.total / 1000)} km`,
    `D+ ${r.gain} m · D− ${r.loss} m`,
  ];
  // L'allure « sur le plat » équivalente dit quel niveau d'effort l'objectif demande
  extra.push(`effort ≈ ${fmtPace(spm * 1000)} /km sur le plat`);
  $("rpExtra").innerHTML = extra.map((x) => `<span>${x}</span>`).join("");

  let cum = 0;
  let dist = 0;
  // Plan mémorisé pour le bracelet d'allure
  rp.last = {
    name: route.name,
    time: r.time,
    info: [`${fmtNum(r.total / 1000)} km · ${fmtPace(r.time / (r.total / 1000))} /km moy.`, `D+ ${r.gain} m · D− ${r.loss} m`],
    paceHead: "ALLURE",
    splits: [],
  };
  $("bandBtn").disabled = false;
  $("rpSplits").innerHTML = r.kms.map((k, i) => {
    cum += k.time;
    dist += k.len;
    const grade = (k.climb / k.len) * 100;
    const last = i === r.kms.length - 1;
    const cls = grade >= 3 ? "up" : grade <= -3 ? "down" : "";
    rp.last.splits.push({
      label: last && Math.abs(dist / 1000 - Math.round(dist / 1000)) > 0.01 ? fmtNum(dist / 1000, 1) : String(Math.round(dist / 1000)),
      cum, paceTxt: fmtPace(k.time / (k.len / 1000)), grade, finish: last,
    });
    return `<tr class="${last ? "is-finish" : ""}">
      <td>${last ? `Arrivée · ${fmtNum(dist / 1000)} km` : `${Math.round(dist / 1000)} km`}</td>
      <td class="grade ${cls}">${grade > 0.05 ? "+" : ""}${fmtNum(grade, 1)} %</td>
      <td>${fmtPace(k.time / (k.len / 1000))} /km</td>
      <td>${fmtTime(cum)}</td>
    </tr>`;
  }).join("");
}

function renderBikePredict(route, rawProfile) {
  const profile = smoothProfile(rawProfile);
  const total = profile[profile.length - 1][0];
  const step = total > 20000 ? 5000 : 1000; // passages tous les 5 km (1 km sur les petits parcours)
  // Tant que l'objectif n'a pas été saisi, on propose un temps adapté au parcours (≈ 25 km/h)
  if (!rp.touched.btime) {
    rp.goals.btime = fmtTime(Math.max(60, Math.round(((total / 1000 / 25) * 3600) / 60) * 60));
    if (rp.goal === "time") $("rpGoal").value = rp.goals.btime;
  }
  const target = rp.goal === "pace" ? total / (num($("rpGoal").value) / 3.6) : parseTime($("rpGoal").value);
  if (!(target > 0) || !Number.isFinite(target)) {
    $("rpTime").textContent = "—";
    $("rpExtra").innerHTML = "<span>Indique ton objectif</span>";
    $("rpSplits").innerHTML = "";
    $("bandBtn").disabled = true;
    return;
  }
  const kmh = bikeFlatSpeed(profile, target, step);
  const r = predictBike(profile, kmh, step);
  const avg = (r.total / r.time) * 3.6;
  $("rpTime").textContent = fmtTime(r.time);
  $("rpExtra").innerHTML = [
    `${fmtNum(avg, 1)} km/h de moyenne`,
    `${fmtNum(r.total / 1000)} km`,
    `D+ ${r.gain} m · D− ${r.loss} m`,
    `effort ≈ ${fmtNum(kmh, 1)} km/h sur le plat`,
  ].map((x) => `<span>${x}</span>`).join("");

  let cum = 0;
  let dist = 0;
  rp.last = {
    name: route.name,
    time: r.time,
    info: [`${fmtNum(r.total / 1000)} km · ${fmtNum(avg, 1)} km/h moy.`, `D+ ${r.gain} m · D− ${r.loss} m`],
    paceHead: "KM/H",
    splits: [],
  };
  $("bandBtn").disabled = false;
  $("rpSplits").innerHTML = r.kms.map((k, i) => {
    cum += k.time;
    dist += k.len;
    const grade = (k.climb / k.len) * 100;
    const last = i === r.kms.length - 1;
    const cls = grade >= 3 ? "up" : grade <= -3 ? "down" : "";
    const speed = fmtNum((k.len / k.time) * 3.6, 1);
    rp.last.splits.push({ label: fmtNum(dist / 1000, last ? 1 : 0), cum, paceTxt: speed, grade, finish: last });
    return `<tr class="${last ? "is-finish" : ""}">
      <td>${last ? `Arrivée · ${fmtNum(dist / 1000)} km` : `${fmtNum(dist / 1000, 0)} km`}</td>
      <td class="grade ${cls}">${grade > 0.05 ? "+" : ""}${fmtNum(grade, 1)} %</td>
      <td>${speed} km/h</td>
      <td>${fmtTime(cum)}</td>
    </tr>`;
  }).join("");
}

// Champ objectif : temps visé, ou allure (vitesse à vélo) visée
function renderGoalField() {
  $("rpGoalPaceBtn").textContent = isBike() ? "une vitesse" : "une allure";
  $("rpPaceHead").textContent = isBike() ? "Vitesse à tenir" : "Allure à tenir";
  $("rpNote").textContent = isBike()
    ? "Vélo : environ +2,4 s par mètre de montée et −0,8 s par mètre de descente par rapport au plat (repère pour un cycliste amateur). Une estimation, pas une promesse !"
    : "L'effort est réparti selon la pente : environ +3,3 % de temps par % de pente en montée ; en descente on gagne jusqu'à −10 %, au-delà le gain diminue (descente trop raide). Une estimation, pas une promesse !";
  const g = rp.goal;
  document.querySelectorAll("[data-goal]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.goal === g)));
  $("rpResultLabel").textContent = "Temps visé";
  if (g === "time") {
    $("rpGoalLabel").textContent = "Temps visé";
    $("rpGoalUnit").textContent = "";
    $("rpGoal").placeholder = "h:mm:ss";
    $("rpGoalHint").textContent = "Le temps total que tu veux faire sur ce parcours.";
  } else if (g === "pace" && isBike()) {
    $("rpGoalLabel").textContent = "Vitesse moyenne visée";
    $("rpGoalUnit").textContent = "km/h";
    $("rpGoal").placeholder = "28";
    $("rpGoalHint").textContent = "Ta vitesse moyenne sur l'ensemble du parcours.";
  } else {
    $("rpGoalLabel").textContent = "Allure moyenne visée";
    $("rpGoalUnit").textContent = "/km";
    $("rpGoal").placeholder = "mm:ss";
    $("rpGoalHint").textContent = "Ton allure moyenne sur l'ensemble du parcours.";
  }
}

document.querySelectorAll("[data-goal]").forEach((b) => b.addEventListener("click", () => {
  rp.goals[goalKey()] = $("rpGoal").value; // garde la saisie de chaque mode
  rp.goal = b.dataset.goal;
  $("rpGoal").value = rp.goals[goalKey()];
  renderRoutePredict();
}));
$("rpRoute").addEventListener("change", renderRoutePredict);
$("rpGoal").addEventListener("input", () => {
  rp.goals[goalKey()] = $("rpGoal").value;
  rp.touched[goalKey()] = true;
  renderRoutePredict();
});
// Un parcours enregistré dans un autre onglet apparaît tout de suite
window.addEventListener("storage", (e) => {
  if (e.key === ROUTES_KEY) renderRoutePredict();
});

$("rpGoal").value = rp.goals.time;
renderRoutePredict();

// Ouvert depuis l'outil Parcours (« Prédire mes temps sur ce parcours ») : parcours et sport présélectionnés
(function openFromParcours() {
  const id = new URLSearchParams(location.search).get("route");
  const route = id && readRoutes().find((r) => r.id === id);
  if (!route) return;
  const want = route.sport === "bike" ? "bike" : "run";
  if (state.sport !== want) {
    state.sport = want;
    applySport(false);
    compute();
  }
  renderRoutePredict();
  $("rpRoute").value = id;
  renderRoutePredict();
  history.replaceState(null, "", `${location.pathname}#routeSection`);
  // Descend jusqu'à « Prédire sur mon parcours » une fois la page entièrement affichée (polices, mise en page)
  // (saut direct : le défilement « doux » du site est interrompu pendant le chargement)
  const go = () => $("routeSection").scrollIntoView({ block: "start", behavior: "instant" });
  if (document.readyState === "complete") setTimeout(go, 50);
  else window.addEventListener("load", () => setTimeout(go, 50), { once: true });
})();

/* ---------- Bracelet d'allure (dessin et fenêtre : band.js) ---------- */
$("bandBtn").addEventListener("click", () => openBand(rp.last));
$("calcBandBtn").addEventListener("click", () => openBand(calcPlan));
