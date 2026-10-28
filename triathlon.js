/* =========================================================
   Planificateur triathlon Loopace
   Natation + T1 + vélo + T2 + course → temps de chaque étape,
   temps total et heure d'arrivée.
   Pour chaque discipline, l'allure et le temps sont liés : on remplit
   l'un, l'autre se calcule. Les parcours enregistrés dans l'outil
   Parcours peuvent servir pour le vélo et la course (distance reprise,
   dénivelé pris en compte dans les deux sens).
   ========================================================= */
const $ = (id) => document.getElementById(id);

const FORMATS = [
  { id: "xs", name: "XS", label: "Découverte", swim: 400, bike: 10, run: 2.5 },
  { id: "s", name: "S", label: "Sprint", swim: 750, bike: 20, run: 5 },
  { id: "m", name: "M", label: "Olympique", swim: 1500, bike: 40, run: 10 },
  { id: "l", name: "L", label: "70.3", swim: 1900, bike: 90, run: 21.1 },
  { id: "xl", name: "XL", label: "Ironman", swim: 3800, bike: 180, run: 42.2 },
];
const DEFAULTS = { format: "m", swimPace: "2:00", t1Time: "2:00", bikeSpeed: "30", t2Time: "1:00", runPace: "5:00", startTime: "09:00" };
const STORE_KEY = "rotiby-triathlon";
const ROUTES_KEY = "rotiby-parcours"; // parcours enregistrés par l'outil Parcours

/* ---------- Lecture / écriture ---------- */
const num = (v) => Number(String(v).replace(",", ".").replace(/\s/g, ""));
const pad = (n) => String(n).padStart(2, "0");
const fmtNum = (v, d = 1) => v.toLocaleString("fr-FR", { maximumFractionDigits: d });

// "1:45:30", "45:30", "45", "1h45", "4.30" → secondes
function parseTime(v) {
  // « 4.30 » ou « 1.20.00 » : le point sert de séparateur (4 min 30, pas 4,3 min)
  const s = String(v).trim().toLowerCase().replace(/\s/g, "").replace(/\.(\d{2})(?!\d)/g, ":$1");
  if (!s) return NaN;
  const h = s.match(/^(\d+)h(\d+)?$/);
  if (h) return Number(h[1]) * 3600 + Number(h[2] || 0) * 60;
  const n = s.replace(/['"]/g, ":").split(":").filter((p) => p !== "").map(Number);
  if (!n.length || n.some(Number.isNaN)) return NaN;
  if (n.length === 1) return n[0] * 60;
  if (n.length === 2) return n[0] * 60 + n[1];
  if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
  return NaN;
}

function fmtTime(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// withDay : ajoute « (+1 j) » si l'heure tombe le lendemain du départ
function fmtClock(startHHMM, plusSec, withDay = false) {
  const [h, m] = startHHMM.split(":").map(Number);
  if (Number.isNaN(h)) return "—";
  const abs = h * 3600 + m * 60 + Math.round(plusSec);
  const t = ((abs % 86400) + 86400) % 86400;
  const days = Math.floor(abs / 86400);
  return `${pad(Math.floor(t / 3600))}h${pad(Math.floor((t % 3600) / 60))}${withDay && days > 0 ? ` (+${days} j)` : ""}`;
}

/* ---------- Parcours enregistrés et dénivelé ---------- */
function readRoutes() {
  try { return JSON.parse(localStorage.getItem(ROUTES_KEY)) || []; } catch { return []; }
}

// Course à pied : effet de la pente (en %) sur le temps (même modèle que le calculateur d'allure)
function gradeFactor(g) {
  g = Math.max(-35, Math.min(35, g));
  if (g >= 0) return 1 + 0.033 * g;
  if (g >= -10) return 1 + 0.018 * g;
  return 0.82 + 0.02 * (-g - 10);
}

// Altitude lissée sur ±100 m (évite les fausses petites montées), recalée sur la distance du parcours
function routeProfile(route) {
  const p = route.profile;
  if (!p || p.length < 2) return null;
  const k = route.distance > 0 ? route.distance / p[p.length - 1][0] : 1;
  const scaled = p.map(([d, e]) => [d * k, e]);
  return scaled.map(([d]) => {
    const near = scaled.filter(([d2]) => Math.abs(d2 - d) <= 100);
    return [d, near.reduce((s, x) => s + x[1], 0) / near.length];
  });
}

function climb(profile) {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < profile.length; i++) {
    const dz = profile[i][1] - profile[i - 1][1];
    if (dz > 0) gain += dz; else loss -= dz;
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

// Course : « km équivalent plat » du parcours. Temps = allure du plat × cet effort (et inversement).
function runEffortKm(route) {
  const p = routeProfile(route);
  if (!p) return route.distance / 1000;
  let e = 0;
  for (let i = 1; i < p.length; i++) {
    const len = p[i][0] - p[i - 1][0];
    if (len > 0) e += (len / 1000) * gradeFactor(((p[i][1] - p[i - 1][1]) / len) * 100);
  }
  return e;
}

// Vélo : temps sur le plat + ≈ 2,4 s par mètre de montée − 0,8 s par mètre de descente
// (repère simple : ~ +4 min pour 100 m de D+ à allure amateur)
function bikeClimbSeconds(route) {
  const p = routeProfile(route);
  const c = p ? climb(p) : { gain: route.gain || 0, loss: route.loss ?? route.gain ?? 0 };
  return c.gain * 2.4 - c.loss * 0.8;
}

/* ---------- Allure ↔ temps, discipline par discipline ---------- */
// d = distance (m pour la natation, km sinon) ; route = parcours choisi (ou null)
const LEGS = {
  swim: {
    timeFrom: (d, pace) => (d / 100) * pace, // allure en s / 100 m
    paceFrom: (d, t) => t / (d / 100),
    readPace: (v) => parseTime(v),
    showPace: (p) => fmtTime(p),
  },
  bike: {
    timeFrom: (d, kmh, route) => {
      const base = (d / kmh) * 3600;
      // la descente ne fait jamais gagner plus de 15 % sur le temps du plat
      return route ? Math.max(base * 0.85, base + bikeClimbSeconds(route)) : base;
    },
    paceFrom: (d, t, route) => {
      // inverse du calcul ci-dessus : quelle vitesse sur le plat donne ce temps ?
      let base = t;
      if (route) {
        const c = bikeClimbSeconds(route);
        base = t - c > 0 && c >= -0.15 * (t - c) ? t - c : t / 0.85;
      }
      return d / (base / 3600);
    },
    readPace: (v) => num(v),
    showPace: (k) => fmtNum(k),
  },
  run: {
    timeFrom: (d, pace, route) => (route ? runEffortKm(route) : d) * pace, // allure en s / km
    paceFrom: (d, t, route) => t / (route ? runEffortKm(route) : d),
    readPace: (v) => parseTime(v),
    showPace: (p) => fmtTime(p),
  },
};
// Valeurs réalistes ; au-delà, on prévient (allure natation et course en s, vélo en km/h)
const RANGE = { swim: [60, 360], bike: [8, 60], run: [150, 900] };
const plausible = (leg, p) => p >= RANGE[leg][0] && p <= RANGE[leg][1];
const paceText = (leg, p) => (leg === "bike" ? `${fmtNum(p)} km/h` : `${fmtTime(p)} ${leg === "swim" ? "/100 m" : "/km"}`);

// « 1:20 » sur 40 km de vélo = 1 h 20, pas 1 min 20 : on garde la lecture réaliste
function readLegTime(leg, v, d, route) {
  const t = parseTime(v);
  const m = String(v).trim().match(/^(\d{1,2})[:'.](\d{2})$/);
  if (!m || !(d > 0) || !(t > 0)) return t;
  const asHours = Number(m[1]) * 3600 + Number(m[2]) * 60;
  const L = LEGS[leg];
  return !plausible(leg, L.paceFrom(d, t, route)) && plausible(leg, L.paceFrom(d, asHours, route)) ? asHours : t;
}

// Petit message sous un champ (vide = on l'enlève)
function setWarn(field, text) {
  let el = field.querySelector(".field__warn");
  field.classList.toggle("is-warn", Boolean(text));
  if (!text) return el?.remove();
  if (!el) {
    el = document.createElement("small");
    el.className = "field__warn";
    field.append(el);
  }
  el.textContent = text;
}

const IDS = {
  swim: { dist: "swimDist", pace: "swimPace", time: "swimTime" },
  bike: { dist: "bikeDist", pace: "bikeSpeed", time: "bikeTime", route: "bikeRoute", info: "bikeRouteInfo" },
  run: { dist: "runDist", pace: "runPace", time: "runTime", route: "runRoute", info: "runRouteInfo" },
};
// Le dernier champ rempli (allure ou temps) fait foi ; l'autre est recalculé
const source = { swim: "pace", bike: "pace", run: "pace" };

function fillRouteSelects() {
  const routes = readRoutes();
  for (const sel of [$("bikeRoute"), $("runRoute")]) {
    const keep = sel.value;
    // Vélo : parcours vélo (et « autre ») ; course : parcours course (et « autre », anciens parcours)
    const bike = sel.id === "bikeRoute";
    const list = routes.filter((r) => (bike ? r.sport === "bike" || r.sport === "other" : r.sport !== "bike"));
    sel.innerHTML = `<option value="">Plat (sans parcours)</option>` + list
      .map((r) => `<option value="${r.id}">${r.name.replace(/</g, "&lt;")} · ${fmtNum(r.distance / 1000)} km${r.gain != null ? ` · D+ ${r.gain} m` : ""}</option>`)
      .join("");
    if (list.some((r) => r.id === keep)) sel.value = keep;
  }
}

/* ---------- Format ---------- */
let format = DEFAULTS.format;

function renderFormats() {
  $("formats").innerHTML = FORMATS.map((f) => `
    <button type="button" class="tri-format" data-format="${f.id}" aria-pressed="${format === f.id}">
      <strong>${f.name} <em>${f.label}</em></strong>
      <span>${fmtNum(f.swim, 0)} m · ${fmtNum(f.bike)} km · ${fmtNum(f.run)} km</span>
    </button>`).join("") + `
    <button type="button" class="tri-format" data-format="custom" aria-pressed="${format === "custom"}">
      <strong>Perso</strong>
      <span>Tes propres distances</span>
    </button>`;
}

function applyFormat(id) {
  format = id;
  const f = FORMATS.find((x) => x.id === id);
  if (f) {
    const hadRoute = $("bikeRoute").value || $("runRoute").value;
    $("swimDist").value = f.swim;
    $("bikeDist").value = fmtNum(f.bike);
    $("runDist").value = fmtNum(f.run);
    $("bikeRoute").value = "";
    $("runRoute").value = "";
    // Nouvelles distances : on repart des allures (un temps tapé ne vaut que pour l'ancienne distance)
    for (const leg of ["swim", "bike", "run"]) source[leg] = "pace";
    // Passages détaillés : moins de lignes sur les longs formats (bracelet lisible)
    detail.step.bike = f.bike >= 90 ? 20 : f.bike >= 40 ? 10 : 5;
    detail.step.run = f.run >= 21 ? 2 : 1;
    formatNote(hadRoute ? `Parcours retiré : le format ${f.name} impose ses distances. Choisis « Perso » pour courir sur un de tes parcours.` : "");
  }
  renderFormats();
  compute();
}

let noteTimer = 0;
function formatNote(text) {
  clearTimeout(noteTimer);
  $("formatNote").textContent = text;
  $("formatNote").hidden = !text;
  if (text) noteTimer = setTimeout(() => ($("formatNote").hidden = true), 8000);
}

$("formats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-format]");
  if (b) applyFormat(b.dataset.format);
});

/* ---------- Calcul ---------- */
// Temps d'une discipline ; met à jour le champ calculé (allure ou temps) sans gêner la saisie en cours
function legTime(leg, routes) {
  const ids = IDS[leg];
  const route = ids.route ? routes.find((r) => r.id === $(ids.route).value) : null;

  // Un parcours choisi impose sa distance
  if (ids.route) {
    $(ids.dist).readOnly = Boolean(route);
    $(ids.dist).closest(".field").classList.toggle("is-locked", Boolean(route));
    if (route) {
      $(ids.dist).value = fmtNum(route.distance / 1000, 2);
      const p = routeProfile(route);
      const c = p ? climb(p) : null;
      $(ids.info).textContent = c ? `D+ ${c.gain} m · D− ${c.loss} m pris en compte` : "Profil d'altitude absent : ré-enregistre ce parcours";
    } else {
      $(ids.info).textContent = "";
    }
  }

  const d = num($(ids.dist).value);
  const L = LEGS[leg];
  const timeField = $(ids.time).closest(".field");
  $(ids.pace).closest(".field").classList.toggle("is-computed", source[leg] === "time");
  timeField.classList.toggle("is-computed", source[leg] === "pace");

  let p;
  let t;
  if (source[leg] === "pace") {
    p = L.readPace($(ids.pace).value);
    t = d > 0 && p > 0 ? L.timeFrom(d, p, route) : NaN;
    if (document.activeElement !== $(ids.time)) $(ids.time).value = Number.isFinite(t) ? fmtTime(t) : "";
  } else {
    t = readLegTime(leg, $(ids.time).value, d, route);
    p = d > 0 && t > 0 ? L.paceFrom(d, t, route) : NaN;
    if (document.activeElement !== $(ids.pace)) $(ids.pace).value = Number.isFinite(p) ? L.showPace(p) : "";
    // en quittant le champ, on réécrit le temps tel qu'il a été compris (« 1:20 » → « 1:20:00 »)
    if (document.activeElement !== $(ids.time) && Number.isFinite(t) && t > 0) $(ids.time).value = fmtTime(t);
  }

  // Champ à corriger (en rouge) et valeur étonnante (message sous le temps)
  const bad = !(d > 0) ? ids.dist : !(Number.isFinite(t) && t > 0) ? (source[leg] === "pace" ? ids.pace : ids.time) : null;
  for (const id of [ids.dist, ids.pace, ids.time]) $(id).closest(".field").classList.toggle("is-invalid", id === bad);
  const odd = !bad && Number.isFinite(p) && !plausible(leg, p);
  setWarn(timeField, odd ? `Vérifie : ça fait ${paceText(leg, p)}.${source[leg] === "time" ? " Pour des heures, tape 1:20:00 ou 1h20." : ""}` : "");
  return t;
}

function compute() {
  const routes = readRoutes();
  const legs = [
    { id: "swim", name: "Natation", time: legTime("swim", routes) },
    { id: "t1", name: "Transition 1", time: parseTime($("t1Time").value) },
    { id: "bike", name: "Vélo", time: legTime("bike", routes) },
    { id: "t2", name: "Transition 2", time: parseTime($("t2Time").value) },
    { id: "run", name: "Course à pied", time: legTime("run", routes) },
  ];

  for (const [i, id] of [[1, "t1Time"], [3, "t2Time"]]) {
    $(id).closest(".field").classList.toggle("is-invalid", !(Number.isFinite(legs[i].time) && legs[i].time >= 0));
  }
  const ok = legs.every((l) => Number.isFinite(l.time) && l.time >= 0) && [0, 2, 4].every((i) => legs[i].time > 0);
  const total = legs.reduce((s, l) => s + (l.time || 0), 0);
  $("totalTime").textContent = ok ? fmtTime(total) : "—";
  $("arrival").textContent = ok ? fmtClock($("startTime").value || "09:00", total, true) : "—";

  if (!ok) {
    $("totalExtra").innerHTML = "<span>Corrige les champs en rouge</span>";
    $("triSum").innerHTML = "";
    $("triBar").innerHTML = "";
    $("triSplits").innerHTML = "";
    race = null;
    renderDetail();
    renderFuel();
    save();
    return;
  }

  const swimM = num($("swimDist").value);
  const bikeKm = num($("bikeDist").value);
  const runKm = num($("runDist").value);
  $("totalExtra").innerHTML = `<span>${fmtNum(swimM / 1000 + bikeKm + runKm)} km au total</span>`;

  // Bilan par discipline : temps, allure moyenne et part de la course
  const pct = (t) => `${Math.round((t / total) * 100)} %`;
  const transitions = legs[1].time + legs[3].time;
  $("triSum").innerHTML = [
    ["swim", "Natation", legs[0].time, `${fmtTime(legs[0].time / (swimM / 100))} /100 m`],
    ["bike", "Vélo", legs[2].time, `${fmtNum(bikeKm / (legs[2].time / 3600))} km/h`],
    ["run", "Course", legs[4].time, `${fmtTime(legs[4].time / runKm)} /km`],
    ["t1", "Transitions", transitions, `T1 ${fmtTime(legs[1].time)} · T2 ${fmtTime(legs[3].time)}`],
  ].map(([id, name, t, sub]) => `<div class="tri-sum__item">
      <span><i class="tri-dot tri-dot--${id}"></i>${name}<em>${pct(t)}</em></span>
      <strong>${fmtTime(t)}</strong>
      <small>${sub}</small>
    </div>`).join("");

  // Frise : largeur proportionnelle au temps de chaque étape
  $("triBar").innerHTML = legs.map((l) => {
    const pct = (l.time / total) * 100;
    return `<div class="tri-bar__seg tri-bar__seg--${l.id}" style="flex-basis:${pct}%">
      ${pct > 9 ? `<span>${l.name.replace("Transition ", "T")}</span><b>${fmtTime(l.time)}</b>` : ""}
    </div>`;
  }).join("");

  let cum = 0;
  const start = $("startTime").value || "09:00";
  $("triSplits").innerHTML = legs.map((l, i) => {
    cum += l.time;
    const last = i === legs.length - 1;
    return `<tr class="${last ? "is-finish" : ""}">
      <td><i class="tri-dot tri-dot--${l.id}"></i>${last ? "Arrivée · " : ""}${l.name}</td>
      <td>${fmtTime(l.time)}</td>
      <td>${fmtTime(cum)}</td>
      <td>${fmtClock(start, cum, true)}</td>
    </tr>`;
  }).join("");

  race = {
    start,
    total,
    legs,
    swimM,
    bike: { km: bikeKm, time: legs[2].time, from: legs[0].time + legs[1].time, route: selectedRoute("bike", routes), kmh: num($("bikeSpeed").value) },
    run: { km: runKm, time: legs[4].time, from: total - legs[4].time, route: selectedRoute("run", routes) },
  };
  renderDetail();
  renderFuel();
  save();
}

/* =========================================================
   Passages détaillés (vélo et course), tous les X km
   Le temps de l'étape est réparti sur chaque tronçon selon le dénivelé
   du parcours choisi (ou à parts égales sur le plat).
   ========================================================= */
let race = null; // dernière course calculée
const STEPS = { bike: [5, 10, 20], run: [1, 2, 5] };
const detail = { leg: "bike", step: { bike: 10, run: 1 } };

function selectedRoute(leg, routes) {
  const id = $(IDS[leg].route).value;
  return id ? routes.find((r) => r.id === id) || null : null;
}

// Montée, descente, dénivelé net et effort de course entre a et b mètres d'un profil
function profileSlice(profile, a, b) {
  const out = { gain: 0, loss: 0, effort: 0, dz: 0 };
  for (let i = 1; i < profile.length; i++) {
    const [d0, e0] = profile[i - 1];
    const [d1, e1] = profile[i];
    const lo = Math.max(a, d0);
    const hi = Math.min(b, d1);
    if (hi <= lo || d1 <= d0) continue;
    const len = hi - lo;
    const dz = ((e1 - e0) * len) / (d1 - d0);
    if (dz > 0) out.gain += dz; else out.loss -= dz;
    out.dz += dz;
    out.effort += (len / 1000) * gradeFactor(((e1 - e0) / (d1 - d0)) * 100);
  }
  return out;
}

// Tronçons d'une discipline : [{ km, len, time, cum, grade }]
function legSplits(leg, step) {
  const L = race[leg];
  const marks = [];
  for (let k = step; k < L.km - 1e-6; k += step) marks.push(k);
  marks.push(L.km);
  const p = L.route ? routeProfile(L.route) : null;
  let prev = 0;
  const segs = marks.map((km) => {
    const len = km - prev;
    let w = len;
    let grade = 0;
    if (p) {
      const sl = profileSlice(p, prev * 1000, km * 1000);
      grade = (sl.dz / (len * 1000)) * 100;
      if (leg === "run") w = sl.effort;
      else {
        const base = (len / (L.kmh || 30)) * 3600;
        w = Math.max(base * 0.85, base + sl.gain * 2.4 - sl.loss * 0.8);
      }
    }
    prev = km;
    return { km, len, w, grade };
  });
  // La somme des tronçons = le temps de l'étape
  const sumW = segs.reduce((s, x) => s + x.w, 0) || 1;
  let cum = 0;
  return segs.map((x) => {
    const time = (x.w / sumW) * L.time;
    cum += time;
    return { ...x, time, cum };
  });
}

// Où en est-on (km) sur une discipline au bout de t secondes ?
function kmAt(leg, t) {
  let prevCum = 0;
  let prevKm = 0;
  for (const s of legSplits(leg, 1)) {
    if (t <= s.cum) return prevKm + ((t - prevCum) / (s.time || 1)) * s.len;
    prevCum = s.cum;
    prevKm = s.km;
  }
  return race[leg].km;
}

const gradeTag = (g) => (g >= 3 ? `<span class="tri-grade tri-grade--up">▲</span>` : g <= -3 ? `<span class="tri-grade tri-grade--down">▼</span>` : "");
const segPace = (leg, s) => (leg === "bike" ? `${fmtNum(s.len / (s.time / 3600))} km/h` : `${fmtTime(s.time / s.len)} /km`);

function renderDetail() {
  const leg = detail.leg;
  document.querySelectorAll("#detailLeg [data-leg]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.leg === leg)));
  $("detailStep").innerHTML = STEPS[leg].map((k) => `<button type="button" data-step="${k}" aria-pressed="${detail.step[leg] === k}">${k} km</button>`).join("");
  $("detailPaceHead").textContent = leg === "bike" ? "Vitesse" : "Allure";
  $("detailLegHead").textContent = leg === "bike" ? "Temps vélo" : "Temps course";
  for (const id of ["triBandBtn", "sheetBtn", "shareBtn"]) $(id).disabled = !race;
  if (!race) {
    $("detailRows").innerHTML = "";
    $("detailHint").textContent = "Renseigne toutes les étapes pour voir tes passages.";
    return;
  }
  const L = race[leg];
  $("detailHint").textContent = L.route
    ? `Sur « ${L.route.name} » : le temps est réparti selon le dénivelé (▲ montée, ▼ descente).`
    : "Sur le plat : allure régulière. Choisis un parcours plus haut pour tenir compte du dénivelé.";
  const rows = legSplits(leg, detail.step[leg]);
  $("detailRows").innerHTML = rows.map((s, i) => `<tr class="${i === rows.length - 1 ? "is-finish" : ""}">
      <td>${fmtNum(s.km, 2)} km</td>
      <td>${segPace(leg, s)}${gradeTag(s.grade)}</td>
      <td>${fmtTime(s.cum)}</td>
      <td>${fmtTime(L.from + s.cum)}</td>
      <td>${fmtClock(race.start, L.from + s.cum, true)}</td>
    </tr>`).join("");
}

$("detailLeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-leg]");
  if (!b) return;
  detail.leg = b.dataset.leg;
  renderDetail();
  save();
});
$("detailStep").addEventListener("click", (e) => {
  const b = e.target.closest("[data-step]");
  if (!b) return;
  detail.step[detail.leg] = Number(b.dataset.step);
  renderDetail();
  save();
});

/* =========================================================
   Ravitaillement : quoi boire et manger, et quand
   Repères courants en endurance : glucides selon la durée totale,
   eau et sel selon la chaleur. Le gros des apports se prend à vélo.
   ========================================================= */
let heat = "mild";
let lastFuel = null; // dernier plan de ravitaillement (repris par la fiche jour de course)
const HEAT = { cool: { ml: 500, na: 300 }, mild: { ml: 650, na: 500 }, hot: { ml: 800, na: 700 } };
const GEL = 25; // g de glucides dans un gel classique

function carbsPerHour(totalSec) {
  const h = totalSec / 3600;
  if (h < 1.25) return 0;
  if (h < 2.5) return 45;
  if (h < 4) return 60;
  return 75;
}

// 37 g → « 1 gel ½ », 50 g → « 2 gels »
function gels(g) {
  const n = Math.round((g / GEL) * 2) / 2;
  if (n <= 0) return "";
  if (n < 1) return "½ gel";
  const whole = Math.floor(n);
  return `${whole} gel${whole > 1 ? "s" : ""}${n % 1 ? " ½" : ""}`;
}

const DRINK = 60; // g de glucides par litre de boisson d'effort
const HALF_BAR = 20; // une demi-barre énergétique ≈ 20 g

function renderFuel() {
  document.querySelectorAll("#fuelHeat [data-heat]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.heat === heat)));
  if (!race) {
    $("fuelStats").innerHTML = "";
    $("fuelList").innerHTML = "";
    lastFuel = null;
    return;
  }
  const H = HEAT[heat];
  const rate = carbsPerHour(race.total);
  const runRate = Math.round(rate * 0.8); // en courant, l'estomac tolère moins
  // Course longue : boisson d'effort dans les bidons, complétée par des gels et des barres
  const mix = rate >= 60;
  const events = [];
  const add = (at, dot, where, what) => events.push({ at, dot, where, what });
  const tally = { carbs: 0, gels: 0, halfBars: 0, drinkMl: 0, waterMl: 0, bikeMl: 0 };

  if (rate) {
    tally.carbs += GEL;
    tally.gels += 1;
  }
  add(-15 * 60, "pre", "Avant le départ", rate ? "1 gel et quelques gorgées d'eau" : "Quelques gorgées d'eau, rien de nouveau");

  // Vélo : une prise toutes les 20 min
  const B = race.bike;
  if (B.time < 25 * 60) {
    add(B.from + 5 * 60, "bike", "Vélo · début", "Quelques gorgées d'eau dès que tu es calé");
    tally.waterMl += 200;
    tally.bikeMl += 200;
  } else {
    let missing = 0; // glucides encore à prendre en solide
    let k = 0;
    for (let t = 10 * 60; t < B.time - 5 * 60; t += 20 * 60, k++) {
      const g = rate / 3;
      const ml = Math.round(H.ml / 3 / 10) * 10;
      tally.bikeMl += ml;
      let what;
      if (mix) {
        const fromDrink = (ml / 1000) * DRINK;
        tally.drinkMl += ml;
        tally.carbs += fromDrink;
        missing += g - fromDrink;
        let food = "";
        if (missing >= 15) {
          // en alternance : une demi-barre (le solide passe mieux en début de vélo), puis un gel
          const bar = tally.halfBars <= tally.gels - 1;
          const gIn = bar ? HALF_BAR : GEL;
          food = bar ? " + ½ barre" : " + 1 gel";
          if (bar) tally.halfBars++; else tally.gels++;
          tally.carbs += gIn;
          missing -= gIn;
        }
        what = `${ml} ml de boisson d'effort${food}`;
      } else if (g) {
        const n = Math.round((g / GEL) * 2) / 2;
        tally.gels += n;
        tally.carbs += n * GEL;
        tally.waterMl += ml;
        what = `${gels(g)} + ${ml} ml d'eau`;
      } else {
        tally.waterMl += ml;
        what = `${ml} ml d'eau`;
      }
      add(B.from + t, "bike", `Vélo · km ${fmtNum(kmAt("bike", t), 0)}`, what);
    }
  }
  // Course : une prise toutes les 30 min (souvent aux ravitos)
  const R = race.run;
  if (R.time < 30 * 60) {
    add(R.from + 10 * 60, "run", "Course · ravito", "Quelques gorgées si tu as soif");
    tally.waterMl += 150;
  } else {
    for (let t = 15 * 60; t < R.time - 8 * 60; t += 30 * 60) {
      const g = runRate / 2;
      const ml = Math.round(H.ml / 2 / 10) * 10;
      tally.waterMl += ml;
      let what = `${ml} ml d'eau au ravito`;
      if (g) {
        const n = Math.max(0.5, Math.round((g / GEL) * 2) / 2);
        tally.gels += n;
        tally.carbs += n * GEL;
        what = `${gels(n * GEL)} + ${ml} ml ${mix ? "d'eau ou de boisson du ravito" : "au ravito"}`;
      }
      add(R.from + t, "run", `Course · km ${fmtNum(kmAt("run", t), 1)}`, what);
    }
  }
  const bottles = Math.max(1, Math.ceil(tally.bikeMl / 750));
  const bars = Math.ceil(tally.halfBars / 2);
  const shopping = [
    tally.drinkMl ? `${fmtNum(tally.drinkMl / 1000, 1)} L de boisson d'effort` : "",
    tally.gels ? gels(tally.gels * GEL) : "",
    bars ? `${bars} barre${bars > 1 ? "s" : ""}` : "",
  ].filter(Boolean).join(", ");

  $("fuelStats").innerHTML = [
    ["Glucides", rate ? `${rate} g/h` : "—", rate ? `≈ ${Math.round(tally.carbs)} g : ${shopping}` : "Course courte : l'eau suffit"],
    ["Eau", `${H.ml} ml/h`, `≈ ${fmtNum((tally.drinkMl + tally.waterMl) / 1000, 1)} L pendant la course`],
    ["Bidons vélo", `${bottles}`, mix ? "de 750 ml de boisson d'effort" : "de 750 ml"],
    ["Sel", `${H.na} mg/h`, heat === "hot" ? "Boisson ou pastilles d'électrolytes conseillées" : "Une boisson d'effort suffit"],
  ].map(([k, v, sub]) => `<div class="tri-fuel__stat"><span>${k}</span><strong>${v}</strong><small>${sub}</small></div>`).join("");

  lastFuel = {
    events,
    stats: [...$("fuelStats").querySelectorAll(".tri-fuel__stat")].map((el) => [...el.children].map((c) => c.textContent)),
  };
  $("fuelList").innerHTML = events.map((e) => `<li>
    <time>${fmtClock(race.start, e.at)}</time>
    <i class="tri-dot tri-dot--${e.dot}"></i>
    <div><strong>${e.where}</strong><span>${e.what}</span></div>
    <em>${e.at < 0 ? "−15 min" : fmtTime(e.at)}</em>
  </li>`).join("");
}

$("fuelHeat").addEventListener("click", (e) => {
  const b = e.target.closest("[data-heat]");
  if (!b) return;
  heat = b.dataset.heat;
  renderFuel();
  save();
});

/* =========================================================
   Bracelet triathlon (dessin et fenêtre : band.js)
   ========================================================= */
// part : "all" (toute la course), "bike" (à coller sur le vélo) ou "run" (au poignet pour la course)
let bandPart = "all";
const legRows = (leg) => {
  const L = race[leg];
  const rows = legSplits(leg, detail.step[leg]);
  return rows.map((s, i) => ({
    label: fmtNum(s.km, 1),
    cum: L.from + s.cum,
    paceTxt: leg === "bike" ? fmtNum(s.len / (s.time / 3600)) : fmtTime(s.time / s.len),
    grade: s.grade,
    finish: leg === "run" && i === rows.length - 1,
  }));
};

function triBandPlan(part) {
  if (!race) return null;
  const f = FORMATS.find((x) => x.id === format);
  const [swim, t1, , t2] = race.legs;

  // Une seule discipline : le temps de l'étape en grand, passages en temps de course
  if (part === "bike" || part === "run") {
    const L = race[part];
    const name = part === "bike" ? "Vélo" : "Course";
    return {
      name: `${name} · Tri ${f ? f.name : "perso"}`,
      time: L.time,
      info: [`${fmtNum(L.km)} km · départ ${fmtClock(race.start, L.from)}`, "Passage = chrono"],
      paceHead: part === "bike" ? "KM/H" : "ALLURE",
      splits: [
        { section: part === "bike" ? "VÉLO" : "COURSE" },
        { label: "0", cum: L.from, paceTxt: "", grade: 0 },
        ...legRows(part),
        ...(part === "bike" ? [{ label: "T2", cum: race.run.from, paceTxt: fmtTime(t2.time), grade: 0, finish: true }] : []),
      ],
    };
  }

  return {
    name: f ? `Triathlon ${f.name}` : "Mon triathlon",
    time: race.total,
    info: [
      `Départ ${fmtClock(race.start, 0)} → ${fmtClock(race.start, race.total)}`,
      `${fmtNum(race.swimM, 0)} m · ${fmtNum(race.bike.km)} km · ${fmtNum(race.run.km)} km`,
    ],
    paceHead: "ALLURE",
    splits: [
      { section: "NATATION" },
      { label: fmtNum(race.swimM / 1000, 2), cum: swim.time, paceTxt: fmtTime(swim.time / (race.swimM / 100)), grade: 0 },
      { label: "T1", cum: race.bike.from, paceTxt: fmtTime(t1.time), grade: 0 },
      { section: "VÉLO" },
      ...legRows("bike"),
      { label: "T2", cum: race.run.from, paceTxt: fmtTime(t2.time), grade: 0 },
      { section: "COURSE" },
      ...legRows("run"),
    ],
  };
}

function showTriBand() {
  document.querySelectorAll("#bandPart [data-part]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.part === bandPart)));
  openBand(triBandPlan(bandPart));
}
$("triBandBtn").addEventListener("click", showTriBand);
$("bandPart").addEventListener("click", (e) => {
  const b = e.target.closest("[data-part]");
  if (!b) return;
  bandPart = b.dataset.part;
  showTriBand();
});

/* =========================================================
   Objectif global : un temps total, réparti entre les 3 disciplines
   ========================================================= */
// Repères d'un triathlète amateur « équilibré » : 2:00 /100 m, 30 km/h, 5:00 /km
const GOAL_REF = { swim: 120, bike: 30, run: 300 };
// Discipline forte : environ 12 % plus rapide que les repères
const GOAL_PROFILES = { even: {}, swim: { swim: 0.88 }, bike: { bike: 0.88 }, run: { run: 0.88 } };
const LEG_INDEX = { swim: 0, bike: 2, run: 4 };

// « 2:45 » pour un triathlon = 2 h 45 (pas 2 min 45)
function readGoalTotal(v) {
  const t = parseTime(v);
  const m = String(v).trim().match(/^(\d{1,2})[:'.](\d{2})$/);
  return m && t < 15 * 60 ? Number(m[1]) * 3600 + Number(m[2]) * 60 : t;
}

function goalMsg(text, error = false) {
  $("goalMsg").textContent = text;
  $("goalMsg").classList.toggle("is-error", error);
}

function applyGoal() {
  const goal = readGoalTotal($("goalTotal").value);
  const trans = (parseTime($("t1Time").value) || 0) + (parseTime($("t2Time").value) || 0);
  if (!(goal > 0)) return goalMsg("Indique ton temps total visé, par exemple 2:45:00.", true);
  const rest = goal - trans;
  if (!(rest > 0)) return goalMsg("Ton temps visé doit être plus long que tes transitions.", true);

  const routes = readRoutes();
  const profile = $("goalProfile").value;
  const weights = {};
  for (const leg of ["swim", "bike", "run"]) {
    const ids = IDS[leg];
    const d = num($(ids.dist).value);
    if (!(d > 0)) return goalMsg("Renseigne d'abord les distances.", true);
    if (profile === "current" && race) {
      weights[leg] = race.legs[LEG_INDEX[leg]].time; // garde l'équilibre de tes allures actuelles
    } else {
      const route = ids.route ? selectedRoute(leg, routes) : null;
      const f = (GOAL_PROFILES[profile] || {})[leg] || 1;
      weights[leg] = LEGS[leg].timeFrom(d, GOAL_REF[leg], route) * f;
    }
  }
  const k = rest / (weights.swim + weights.bike + weights.run);
  // Arrondi à la seconde ; la course récupère l'écart pour tomber pile sur l'objectif
  const swim = Math.round(weights.swim * k);
  const bike = Math.round(weights.bike * k);
  const times = { swim, bike, run: Math.round(rest) - swim - bike };
  for (const leg of ["swim", "bike", "run"]) {
    source[leg] = "time";
    $(IDS[leg].time).value = fmtTime(times[leg]);
  }
  compute();
  goalMsg(`Réparti : natation ${$("swimTime").value} · vélo ${$("bikeTime").value} · course ${$("runTime").value} (+ transitions ${fmtTime(trans)}). Tu peux ajuster chaque temps ci-dessous.`);
}
$("goalBtn").addEventListener("click", applyGoal);
$("goalTotal").addEventListener("keydown", (e) => { if (e.key === "Enter") applyGoal(); });

/* =========================================================
   Fiche « jour de course » à imprimer (A4)
   ========================================================= */
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const CHECKLIST = {
  "Avant le départ": ["Dossard + épingles ou ceinture porte-dossard", "Puce de chronométrage (à la cheville)", "Pièce d'identité / licence", "Crème anti-frottements, crème solaire", "Gel d'avant-course + bouteille d'eau"],
  "Natation": ["Combinaison (si autorisée)", "Bonnet de l'organisation", "Lunettes de natation + une paire de secours", "Bouchons d'oreilles (si tu en utilises)"],
  "T1 · vélo": ["Casque (attaché AVANT de toucher le vélo)", "Lunettes de soleil", "Chaussures vélo (ou déjà clipsées)", "Bidons remplis", "Gels / barres scotchés ou dans la sacoche", "Pression des pneus vérifiée, vitesse facile engagée", "Chambre à air + démonte-pneus / CO2"],
  "T2 · course": ["Chaussures (lacets élastiques)", "Casquette / visière", "Dossard tourné devant", "Gels pour la course", "Montre réglée sur le mode multisport"],
  "Après l'arrivée": ["Vêtements chauds et secs", "Boisson de récupération / collation", "Sac pour la combinaison mouillée"],
};

function raceSheetHtml() {
  const f = FORMATS.find((x) => x.id === format);
  const [swim, t1, bike, t2, run] = race.legs;
  const at = (sec) => fmtClock(race.start, sec, true);
  const day = [
    [-210 * 60, "Réveil"],
    [-180 * 60, "Petit-déjeuner (ce que tu as testé à l'entraînement)"],
    [-90 * 60, "Arrivée sur place, retrait du dossard"],
    [-75 * 60, "Installation du parc à vélo (vérifie l'heure de fermeture sur le site de l'épreuve)"],
    [-30 * 60, "Combinaison, échauffement, repérage de la sortie de l'eau"],
    [-15 * 60, lastFuel?.events?.[0]?.what ? `Avant le départ : ${lastFuel.events[0].what.toLowerCase()}` : "Quelques gorgées d'eau"],
    [0, "Départ natation"],
    [swim.time, "Sortie de l'eau → T1"],
    [race.bike.from, "Départ vélo"],
    [race.run.from - t2.time, "Arrivée vélo → T2"],
    [race.run.from, "Départ course à pied"],
    [race.total, "Arrivée !"],
  ];
  const legRows = [
    ["Natation", swim.time, `${fmtTime(swim.time / (race.swimM / 100))} /100 m`],
    ["Transition 1", t1.time, ""],
    ["Vélo", bike.time, `${fmtNum(race.bike.km / (bike.time / 3600))} km/h`],
    ["Transition 2", t2.time, ""],
    ["Course à pied", run.time, `${fmtTime(run.time / race.run.km)} /km`],
  ];
  let cum = 0;
  const legsTable = legRows.map(([name, t, pace]) => {
    cum += t;
    return `<tr><td>${name}</td><td>${fmtTime(t)}</td><td>${pace}</td><td>${fmtTime(cum)}</td><td>${at(cum)}</td></tr>`;
  }).join("");
  const fuel = lastFuel
    ? `<p class="small">${lastFuel.stats.map(([k, v, sub]) => `<b>${esc(k)}</b> ${esc(v)} <span>(${esc(sub)})</span>`).join(" · ")}</p>
       <table class="fuel"><tbody>${lastFuel.events.map((e) => `<tr><td>${fmtClock(race.start, e.at)}</td><td>${esc(e.where)}</td><td>${esc(e.what)}</td></tr>`).join("")}</tbody></table>`
    : "";
  const logo = LOGO_ON_LIGHT;
  const ink = "#4d7c0f"; // citron assombri : lisible sur le papier
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fiche jour de course</title><style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 10pt/1.35 "Segoe UI", Arial, sans-serif; color: #1b1720; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid ${ACCENT}; padding-bottom: 6px; margin-bottom: 10px; }
    h1 { margin: 0; font-size: 18pt; }
    header p { margin: 2px 0 0; color: #555; }
    .big { font-size: 22pt; font-weight: 800; color: ${ink}; text-align: right; line-height: 1; }
    .big small { display: block; font-size: 9pt; color: #555; font-weight: 600; }
    h2 { font-size: 11pt; margin: 12px 0 5px; text-transform: uppercase; letter-spacing: .06em; color: ${ink}; }
    table { width: 100%; border-collapse: collapse; }
    td, th { padding: 3px 6px; border-bottom: 1px solid #e6e0e6; text-align: left; vertical-align: top; }
    th { font-size: 8pt; text-transform: uppercase; color: #777; }
    td:first-child { white-space: nowrap; font-weight: 700; width: 1%; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
    .check { columns: 2; column-gap: 18px; }
    .check div { break-inside: avoid; margin-bottom: 6px; }
    .check b { display: block; margin-bottom: 2px; }
    .check span { display: block; padding-left: 16px; position: relative; }
    .check span::before { content: ""; position: absolute; left: 0; top: 3px; width: 9px; height: 9px; border: 1.3px solid #444; border-radius: 2px; }
    .small { font-size: 8.5pt; color: #444; margin: 0 0 4px; }
    .small span { color: #777; }
    .nowrap td { white-space: nowrap; }
    .fuel td:nth-child(2) { white-space: nowrap; }
    footer { margin-top: 12px; display: flex; align-items: center; gap: 6px; color: #777; font-size: 8pt; }
    footer img { height: 14px; }
  </style></head><body>
    <header>
      <div>
        <h1>${esc(f ? `Triathlon ${f.name} · ${f.label}` : "Mon triathlon")}</h1>
        <p>${fmtNum(race.swimM, 0)} m · ${fmtNum(race.bike.km)} km · ${fmtNum(race.run.km)} km — départ ${at(0)}, arrivée prévue ${at(race.total)}</p>
      </div>
      <div class="big">${fmtTime(race.total)}<small>temps visé</small></div>
    </header>
    <div class="cols">
      <section>
        <h2>Ma journée</h2>
        <table><tbody>${day.map(([t, what]) => `<tr><td>${at(t)}</td><td>${esc(what)}</td></tr>`).join("")}</tbody></table>
      </section>
      <section>
        <h2>Mes temps</h2>
        <table class="nowrap"><thead><tr><th>Étape</th><th>Temps</th><th>Allure</th><th>Passage</th><th>Heure</th></tr></thead><tbody>${legsTable}</tbody></table>
        <h2>Ravitaillement</h2>
        ${fuel}
      </section>
    </div>
    <h2>Checklist</h2>
    <div class="check">${Object.entries(CHECKLIST).map(([title, items]) => `<div><b>${title}</b>${items.map((i) => `<span>${esc(i)}</span>`).join("")}</div>`).join("")}</div>
    <footer><img src="${logo}" alt=""> Préparé avec ${esc(BRAND)} · horaires indicatifs, vérifie ceux de l'organisation</footer>
  </body></html>`;
}

function printRaceSheet() {
  if (!race) return;
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(raceSheetHtml());
  doc.close();
  frame.contentWindow.onafterprint = () => frame.remove();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  }, 300); // laisse le temps au logo de s'afficher
}
$("sheetBtn").addEventListener("click", printRaceSheet);

/* =========================================================
   Lien de partage : tout le plan est rangé dans l'adresse (#plan=…)
   Pas de compte ni de serveur : les parcours choisis voyagent avec le lien.
   ========================================================= */
const toB64 = (str) => {
  let bin = "";
  new TextEncoder().encode(str).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

function shareLink() {
  const used = [$("bikeRoute").value, $("runRoute").value].filter(Boolean);
  const routes = readRoutes()
    .filter((r) => used.includes(r.id))
    .map(({ id, name, sport, distance, gain, loss, profile, waypoints, snap }) => ({ id, name, sport, distance, gain, loss, profile, waypoints, snap }));
  const data = { v: 1, state: currentState(), routes };
  return `${location.origin}${location.pathname}#plan=${toB64(JSON.stringify(data))}`;
}

function shareMsg(text) {
  $("shareMsg").textContent = text;
  $("shareMsg").hidden = !text;
}

$("shareBtn").addEventListener("click", async () => {
  if (!race) return;
  const url = shareLink();
  // Téléphone : feuille de partage du système ; ordinateur : copie dans le presse-papiers
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: "Mon plan de triathlon", text: `Mon plan : ${fmtTime(race.total)}`, url });
      return;
    } catch { /* partage annulé : on copie */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    shareMsg("Lien copié ! Envoie-le à ton club ou à ton coach : il ouvrira ton plan tel quel, parcours compris.");
  } catch {
    window.prompt("Copie ce lien :", url);
  }
});

// Ouverture d'un lien partagé : renvoie l'état, et ajoute ses parcours à ceux du navigateur
function readSharedPlan() {
  const m = location.hash.match(/^#plan=([\w-]+)$/);
  if (!m) return null;
  try {
    const data = JSON.parse(fromB64(m[1]));
    if (!data?.state) return null;
    const mine = readRoutes();
    const added = (data.routes || []).filter((r) => r?.id && Array.isArray(r.profile) && !mine.some((x) => x.id === r.id));
    if (added.length) localStorage.setItem(ROUTES_KEY, JSON.stringify([...mine, ...added]));
    return data.state;
  } catch {
    return null;
  } finally {
    history.replaceState(null, "", location.pathname); // l'adresse redevient propre
  }
}

/* ---------- Mémorise les réglages (dans ce navigateur) ---------- */
const FIELDS = ["swimDist", "swimPace", "swimTime", "t1Time", "bikeDist", "bikeSpeed", "bikeTime", "bikeRoute", "t2Time", "runDist", "runPace", "runTime", "runRoute", "startTime", "goalTotal", "goalProfile"];
const currentState = () => ({ format, source, detail, heat, ...Object.fromEntries(FIELDS.map((id) => [id, $(id).value])) });
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(currentState()));
  } catch { /* stockage indisponible */ }
}
function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { /* stockage indisponible */ }
  // Un lien partagé passe avant les réglages de ce navigateur
  const shared = readSharedPlan();
  if (shared) saved = shared;
  fillRouteSelects();
  if (shared) formatNote("Plan partagé ouvert : tu peux le modifier, il est maintenant enregistré dans ce navigateur.");
  if (saved) {
    format = saved.format || DEFAULTS.format;
    FIELDS.forEach((id) => { if (saved[id] != null) $(id).value = saved[id]; });
    if (saved.source) Object.assign(source, saved.source);
    if (saved.detail) {
      detail.leg = saved.detail.leg === "run" ? "run" : "bike";
      Object.assign(detail.step, saved.detail.step);
    }
    if (HEAT[saved.heat]) heat = saved.heat;
    renderFormats();
    compute();
  } else {
    for (const id of ["swimPace", "t1Time", "bikeSpeed", "t2Time", "runPace", "startTime"]) $(id).value = DEFAULTS[id];
    applyFormat(DEFAULTS.format);
  }
}

/* ---------- Événements ---------- */
// Modifier une distance à la main = format personnalisé
for (const id of ["swimDist", "bikeDist", "runDist"]) {
  $(id).addEventListener("input", () => {
    if (format !== "custom") {
      format = "custom";
      renderFormats();
    }
    compute();
  });
}
// Allure tapée → le temps se calcule ; temps tapé → l'allure se calcule
for (const leg of ["swim", "bike", "run"]) {
  $(IDS[leg].pace).addEventListener("input", () => { source[leg] = "pace"; compute(); });
  $(IDS[leg].time).addEventListener("input", () => { source[leg] = "time"; compute(); });
  // en quittant un champ, on réaffiche proprement la valeur calculée
  $(IDS[leg].pace).addEventListener("blur", compute);
  $(IDS[leg].time).addEventListener("blur", compute);
}
for (const id of ["t1Time", "t2Time", "startTime"]) $(id).addEventListener("input", compute);
for (const id of ["bikeRoute", "runRoute"]) {
  $(id).addEventListener("change", () => {
    if ($(id).value && format !== "custom") {
      format = "custom";
      renderFormats();
    }
    compute();
  });
}
// Un parcours enregistré dans un autre onglet apparaît tout de suite
window.addEventListener("storage", (e) => {
  if (e.key === ROUTES_KEY) {
    fillRouteSelects();
    compute();
  }
});

load();
