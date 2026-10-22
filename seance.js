/* =========================================================
   Séance → boucle Loopace
   1. On colle une séance (format Garmin Connect, Nolio, coach…) :
      on lit les étapes, les répétitions et les allures, puis on calcule
      la durée et la distance de la séance.
   2. On choisit un point de départ : on crée une boucle de cette longueur
      qui revient au départ, colorée selon les étapes de la séance.
   Services gratuits : OSRM (routing.openstreetmap.de), Photon, Open-Meteo.
   ========================================================= */
const $ = (id) => document.getElementById(id);
const ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/driving/";
const SEARCH_URL = "https://photon.komoot.io/api/";
const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";
const ROUTES_KEY = "rotiby-parcours"; // parcours de l'outil Parcours
const STORE_KEY = "rotiby-seance";

const EXAMPLE = `Warm up
21 min @ 06:19-07:22 min/km
Endurance 1
15' + 5' gammes

1. Répéter 12 fois
   1. Hard
1 min @ 03:57-04:08 min/km
VMA
   2. Easy
1 min @ 07:22-08:50 min/km
Endurance 1
2. Recovery
15 min @ 06:19-07:22 min/km
Endurance 1`;

const pad = (n) => String(n).padStart(2, "0");
const fmtNum = (v, d = 1) => v.toLocaleString("fr-FR", { maximumFractionDigits: d });
const fmtPace = (s) => `${Math.floor(Math.round(s) / 60)}:${pad(Math.round(s) % 60)}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function fmtDuration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h} h ${pad(m)}`;
  return s ? `${m} min ${pad(s)}` : `${m} min`;
}

/* =========================================================
   1. Lecture de la séance
   Formats acceptés, copiés depuis les applis ou écrits à la main :
   - Garmin Connect, Coros, Polar, Suunto : une étape par ligne,
     « Répéter 12 fois » / « Repeat 5 times », « 21 min @ 06:19-07:22 min/km »
   - TrainingPeaks : « Warm up · 15 min @ 65-75% Threshold Pace »
   - intervals.icu : « Main Set 6x » puis « - 800mtr 3:50/km Pace » (m = minutes, mtr = mètres)
   - Runna : « 1.2km warm-up → Set: 3× (300m @ 6:15/km + 300m recovery @ 7:00/km) »
   - Notation des coachs : « 20' + 3x(6x30''/30'' r=3') + 10' RAC », « 10x400 en 1'30 r=1' »
   Les zones et pourcentages (VMA, seuil, Z2, % VMA…) sont convertis en allure avec ta VMA.
   ========================================================= */
const MILE = 1609.34;
const vma = () => {
  const v = Number(String($("vma").value).replace(",", "."));
  return v >= 6 && v <= 30 ? v : 15;
};

// Intensités repères, en part de la VMA (ou « marche » / « sur place »)
const INTENSITIES = [
  [/\b(?:marche|march[ée]e|walk(?:ing)?)\b/i, "walk"],
  [/\b(?:statique|passive?|sur place|standing|repos complet|arr[eê]t)\b/i, "static"],
  [/\bz(?:one)?\s*1\b/i, [0.6, 0.65]],
  [/\bz(?:one)?\s*2\b/i, [0.65, 0.75]],
  [/\bz(?:one)?\s*3\b/i, [0.75, 0.84]],
  [/\bz(?:one)?\s*4\b/i, [0.85, 0.92]],
  [/\bz(?:one)?\s*5\b/i, [0.95, 1.02]],
  [/\b(?:vma|mas|vo2 ?max)\b/i, [0.95, 1]],
  [/\b(?:as ?5|allure ?5 ?km|5 ?k(?:m)? pace)\b/i, [0.92, 0.95]],
  [/\b(?:as ?10|allure ?10 ?km|10 ?k(?:m)? pace)\b/i, [0.88, 0.9]],
  [/\b(?:seuil|threshold|tempo|lactate)\b/i, [0.84, 0.88]],
  [/\b(?:as ?21|semi|half)\b/i, [0.82, 0.85]],
  [/\b(?:as ?42|marathon)\b/i, [0.78, 0.81]],
  [/\b(?:hard|fast|rapide|vite|sprint|c[ôo]tes?|hill|interval|fractionn[ée]|effort|work|run)\b/i, [0.9, 0.95]],
  [/\b(?:endurance|ef|footing|easy|facile|recovery|r[ée]cup\w*|cool ?down|warm ?up|warmup|[ée]chauffement|retour au calme|rac|jog(?:ging)?|trot|rest|repos|lent)\b/i, [0.65, 0.72]],
];

const num = (s) => Number(String(s).replace(",", "."));

// Allure, vitesse, % ou zone → { pace: [rapide, lente] s/km } | { pct: [bas, haut] } | { walk } | { static }
function parseTarget(txt) {
  if (!txt) return null;
  const t = String(txt).toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");
  let m;
  // Vitesse en km/h : « 16 km/h », « 10-11 km/h »
  if ((m = t.match(/(\d+(?:[.,]\d+)?)(?:\s*[-–à]\s*(\d+(?:[.,]\d+)?))?\s*km\s*\/?\s*h/))) {
    const a = num(m[1]);
    const b = m[2] ? num(m[2]) : a;
    return { pace: [3600 / Math.max(a, b), 3600 / Math.min(a, b)] };
  }
  // Allure : « 06:19-07:22 min/km », « 4'30/km », « 7:15-7:00/km », « 8:00/mi »
  const paces = [...t.matchAll(/(\d{1,2})\s*[:']\s*(\d{2})(?!\d)\s*(?:''|")?\s*(?:min)?\s*(\/\s*(?:km|mi|mile))?/g)];
  if (paces.length && (paces.some((p) => p[3]) || /\/ ?(km|mi)|min\/|pace|allure|@/.test(t))) {
    const perMile = /\/\s*mi/.test(t);
    const vals = paces.map((p) => (Number(p[1]) * 60 + Number(p[2])) / (perMile ? MILE / 1000 : 1));
    return { pace: [Math.min(...vals), Math.max(...vals)] };
  }
  // Pourcentages : « 100% VMA », « 95-100% », « 75-80% Pace » (seuil), « 70% HR »
  if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:%\s*)?(?:[-–à]\s*(\d+(?:[.,]\d+)?))?\s*%\s*(\w+)?(?:\s+(\w+))?/))) {
    const a = num(m[1]) / 100;
    const b = m[2] ? num(m[2]) / 100 : a;
    const unit = `${m[3] || ""} ${m[4] || ""}`;
    if (/\b(?:hr|fc|lthr|bpm)\b|heart|cardiaque/.test(unit)) {
      const hr = (a + b) / 2; // fréquence cardiaque : correspondance approximative avec les zones
      return { pct: hr <= 0.75 ? [0.65, 0.72] : hr <= 0.85 ? [0.75, 0.84] : hr <= 0.92 ? [0.85, 0.9] : [0.95, 1] };
    }
    const k = /threshold|seuil|pace|allure|ftp|lt\b/.test(unit) ? 0.86 : 1; // % d'allure seuil (TrainingPeaks, intervals.icu)
    return { pct: [Math.min(a, b) * k, Math.max(a, b) * k] };
  }
  for (const [re, val] of INTENSITIES) {
    if (re.test(t)) return val === "walk" ? { walk: true } : val === "static" ? { static: true } : { pct: val };
  }
  return null;
}

// Durée ou distance en tête d'étape. « m » = mètres, sauf petit nombre (intervals.icu : 10m = 10 min)
const QTY_RE = new RegExp([
  String.raw`(?<h>\d+)\s*h\s*(?<hm>\d{1,2})?(?:\s*(?:min|mn|'))?(?![a-z])`,
  String.raw`(?<mm>\d+)\s*'\s*(?<ms>\d{1,2})(?:\s*(?:''|"))?`,
  String.raw`(?<sec>\d+(?:[.,]\d+)?)\s*(?:''|"|s(?:ec(?:onde)?s?)?)(?![a-z])`,
  String.raw`(?<min>\d+(?:[.,]\d+)?)\s*(?:min(?:ute)?s?|mn|')(?![a-z'])`,
  String.raw`(?<km>\d+(?:[.,]\d+)?)\s*km(?![a-z/])`,
  String.raw`(?<mi>\d+(?:[.,]\d+)?)\s*mi(?:les?)?(?![a-z])`,
  String.raw`(?<mtr>\d+(?:[.,]\d+)?)\s*(?:mtr|m[eè]tres?|m)(?![a-z/])`,
  String.raw`(?<clk>\d{1,2}:\d{2}(?::\d{2})?)(?!\d)(?!\s*[-–]\s*\d)(?!\s*(?:min)?\s*\/)`,
].join("|"), "i");

function quantityOf(g) {
  if (g.h) return { sec: Number(g.h) * 3600 + Number(g.hm || 0) * 60 };
  if (g.mm) return { sec: Number(g.mm) * 60 + Number(g.ms) };
  if (g.sec) return { sec: num(g.sec) };
  if (g.min) return { sec: num(g.min) * 60 };
  if (g.km) return { dist: num(g.km) * 1000 };
  if (g.mi) return { dist: num(g.mi) * MILE };
  if (g.mtr) return num(g.mtr) < 50 && !/mtr|m[eè]tre/i.test(g.mtr) ? { sec: num(g.mtr) * 60 } : { dist: num(g.mtr) };
  if (g.clk) {
    const p = g.clk.split(":").map(Number);
    return { sec: p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1] };
  }
  return null;
}

// « 3'45 », « 3:45 », « 1'30'' » → secondes
function clockish(s) {
  const m = String(s).match(/(\d+)\s*[:']\s*(\d{1,2})|(\d+)\s*(?:''|")/);
  if (!m) return NaN;
  return m[3] ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
}

const tidy = (s) => s.replace(/[@:=→>()\[\]*_]+/g, " ").replace(/\s+/g, " ").replace(/^[\s,.;–-]+|[\s,.;–-]+$/g, "").trim()
  .replace(/^(?:à|a|at|en|in|de)(?:\s+|$)|\s+(?:à|a|at|en|in|de)$/i, "").trim();

// Une étape : « Warm up 10 min @ 5:30/km », « 15' échauffement », « 1000 en 3'45 », « - 800mtr 3:50/km Pace »
function parseStep(text, fallbackName = "") {
  const t = String(text).replace(/[’`]/g, "'").replace(/″/g, '"').replace(/′/g, "'");
  let m = t.match(QTY_RE);
  let q = m && quantityOf(m.groups);
  let before = m ? t.slice(0, m.index) : "";
  let after = m ? t.slice(m.index + m[0].length) : "";
  // Nombre seul (« 10x400 », « 200/200 ») : des mètres
  if (!q) {
    const bare = t.match(/(?:^|\s)(\d{2,5})(?=\s|$|\/|r\b)/i);
    if (!bare) return null;
    const v = Number(bare[1]);
    q = v >= 100 ? { dist: v } : { sec: v };
    before = t.slice(0, bare.index);
    after = t.slice(bare.index + bare[0].length);
  }
  const effort = { sec: q.sec ?? null, dist: q.dist ?? null };
  // « 1000 en 3'45 » : temps visé pour la distance
  const en = after.match(/\b(?:en|in)\s+(\d+\s*(?:[:']\s*\d{1,2})?\s*(?:''|")?)/i);
  if (effort.dist && en && clockish(en[1]) > 0) {
    const p = clockish(en[1]) / (effort.dist / 1000);
    Object.assign(effort, { pace: [p, p] });
    after = after.replace(en[0], " ");
  }
  const [beforeAt, atPart = ""] = after.split("@");
  if (!effort.pace) Object.assign(effort, parseTarget(atPart) || parseTarget(beforeAt) || {});
  // Nom : le texte autour de la durée, sans les allures et pourcentages
  const name = tidy(`${before} ${beforeAt}`
    .replace(/\d{1,2}\s*[:']\s*\d{2}(?:\s*[-–]\s*\d{1,2}\s*[:']\s*\d{2})?\s*(?:min)?\s*(?:\/\s*(?:km|mi))?/gi, " ")
    .replace(/\d+(?:[.,]\d+)?\s*(?:[-–]\s*\d+(?:[.,]\d+)?)?\s*(?:%|km\s*\/\s*h)\s*(?:vma|mas|pace|threshold|seuil|hr|fc|lthr)?/gi, " ")
    .replace(/\bz\d(?:\s*-\s*z\d)?\b/gi, " ")
    .replace(/\b(?:pace|hr|lthr)\b/gi, " ")
    .replace(/^\s*(?:step|étape)\s*\d*\s*/i, ""));
  if (!effort.pace && !effort.pct && !effort.walk && !effort.static) Object.assign(effort, parseTarget(name) || {});
  return { name: name || fallbackName, zone: "", notes: [], effort };
}

// Découpe au premier niveau (hors parenthèses) : « a + b → c »
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    const rest = s.slice(i);
    const sep = depth === 0 && (/^(?:\+|→|->|>|;|,(?!\d))/.test(rest) || /^\s(?:puis|then)\s/i.test(rest));
    if (sep) {
      out.push(cur);
      cur = "";
      const len = rest.match(/^(?:\s(?:puis|then)\s|->|\+|→|>|;|,)/i)[0].length;
      i += len - 1;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const REC_RE = /\s(?:r|rec|r[ée]cup(?:[ée]ration)?|recovery)\s*[:=]?\s*(?=\d)/i;
const recoveryStep = (txt) => {
  const s = parseStep(txt, "Récup");
  if (s && !s.effort.pace && !s.effort.pct && !s.effort.walk && !s.effort.static) s.effort.pct = [0.6, 0.68];
  if (s && s.name === "Récup" && /trot|footing|jog/i.test(txt)) s.name = "Récup trottinée";
  return s;
};

// Morceau sans « + » : « 10x400m r=1' », « 3x(6x30''/30'') r=3' », « 30/30 », « 15' échauffement »
function parsePart(part) {
  let p = part.trim().replace(/^(?:main set|set|s[ée]rie|bloc|block|corps(?: de s[ée]ance)?)\s*\d*\s*:\s*/i, "");
  let m = p.match(/^(\d+)\s*(?:[x×]|fois)\s*(.+)$/i) || p.match(/^(?:repeat|r[ée]p[ée]ter)\s*[x×]?\s*(\d+)\s*(?:fois|times|x)?\s*:?\s*(.+)$/i);
  let n = m && Number(m[1]);
  let body = m ? m[2].trim() : p;
  // « (…) x3 »
  const post = !m && p.match(/^\((.+)\)\s*[x×]\s*(\d+)(.*)$/);
  if (post) {
    n = Number(post[2]);
    body = `(${post[1]})${post[3]}`;
  }
  if (!n) return parseSegment(p);
  if (body.startsWith("(") || body.startsWith("[")) {
    let depth = 0;
    let end = 0;
    for (; end < body.length; end++) {
      if ("([".includes(body[end])) depth++;
      if (")]".includes(body[end])) depth--;
      if (depth === 0) break;
    }
    const inner = body.slice(1, end);
    const rest = body.slice(end + 1);
    const children = parseExpr(inner);
    const rec = REC_RE.test(` ${rest}`) ? recoveryStep(rest.replace(/^\s*(?:r|rec|r[ée]cup\w*|recovery)\s*[:=]?\s*/i, "")) : null;
    return [{ repeat: n, children: rec ? [...children, rec] : children }];
  }
  return [{ repeat: n, children: parseSegment(body) }];
}

// Une étape, éventuellement « effort/récup » (30/30) ou avec sa récup (r=1')
function parseSegment(str) {
  const s = ` ${str.trim()} `;
  const slash = str.trim().match(/^([^/]+?)\s*\/\s*([^/]+?)$/);
  if (slash && !/\/\s*(?:km|mi|h)\b/i.test(str)) {
    const a = parseStep(slash[1], "Effort");
    const b = recoveryStep(slash[2]);
    if (a && b) {
      if (!a.effort.pace && !a.effort.pct) a.effort.pct = [0.95, 1]; // 30/30 : effort à VMA
      return [a, b];
    }
  }
  const r = s.match(REC_RE);
  if (r) {
    const main = parseStep(s.slice(0, r.index), "Effort");
    const rec = recoveryStep(s.slice(r.index + r[0].length));
    return [main, rec].filter(Boolean);
  }
  const one = parseStep(str);
  return one ? [one] : [];
}

function parseExpr(s) {
  return splitTop(s).flatMap(parsePart);
}

// Ligne à lire comme une notation compacte (« 10x400 r=1' », « 15' + 20' + 10' », Runna…)
const looksCompact = (line) => /\d\s*[x×]\s*[\d([]/i.test(line) || /\([^)]*\d[^)]*\)\s*[x×]\s*\d/.test(line)
  || ((line.match(/\+|→|->/g) || []).length >= 1 && (line.match(new RegExp(QTY_RE.source, "gi")) || []).length >= 2)
  || /^\s*\d+(?:''|"|'|s)?\s*\/\s*\d+(?:''|"|'|s)?\s*$/.test(line);

// En-tête de répétition sur sa propre ligne
const REPEAT_LINE = [
  /^(?:r[ée]p[ée]t(?:er|ez|ition)s?|repeat)\s*:?\s*[x×]?\s*(\d+)\s*(?:fois|times|x|[×])?\s*:?$/i,
  /^(?:.*?\s)?(\d+)\s*[x×]\s*:?$/i, // « 4x », « Main Set 4x »
  /^[x×]\s*(\d+)\s*:?$/i,
  /^(?:.*?\s)?[x×]\s*(\d+)\s*:?$/i, // « Training x6 », « Repeat x3 »
  /^(\d+)\s*(?:fois|times|r[ée]p[ée]titions?|reps?)\s*:?$/i,
];
const repeatCount = (t) => {
  for (const re of REPEAT_LINE) {
    const m = t.match(re);
    if (m) return Number(m[1]);
  }
  return 0;
};

// Noms qui commencent une étape même sans numéro
const STEP_NAMES = /^(travail|warm ?up|warmup|cool ?down|cooldown|recovery|récup|recup|repos|rest|échauffement|echauffement|retour au calme|hard|easy|run|course|marche|walk|interval|fractionné|footing|active recovery|other|work|effort)\b/i;
// Étapes « hors répétition » quand le texte a perdu son retrait
const TOP_LEVEL_NAMES = /^(warm ?up|warmup|cool ?down|cooldown|échauffement|echauffement|retour au calme)\b/i;

function parseWorkout(text) {
  const root = { children: [] };
  const stack = [{ node: root, indent: -1 }];
  let current = null;
  let blankBefore = false;
  const top = () => stack[stack.length - 1];
  const closeBlocks = (indent) => {
    while (stack.length > 1 && top().indent >= indent) stack.pop();
  };
  // Texte collé sans aucun retrait : on devine ce qui est dans une répétition
  const flat = !/^[ ]+\S/m.test(text);

  for (const raw of text.replace(/\t/g, "    ").replace(/ /g, " ").split(/\r?\n/)) {
    if (!raw.trim()) {
      blankBefore = true;
      // intervals.icu : une ligne vide termine le bloc de « - étapes »
      if (stack.length > 1 && top().node.dash) stack.pop();
      continue;
    }
    const indent = raw.match(/^\s*/)[0].length;
    const dash = /^\s*[-•*–]\s+/.test(raw);
    const numbered = raw.trim().match(/^(\d+)[.)]\s+/);
    const line = raw.trim().replace(/^\d+[.)]\s+/, "").replace(/^[-•*–]\s+/, "").replace(/\*\*/g, "").trim();
    if (!line) continue;

    const n = repeatCount(line);
    if (n && !QTY_RE.test(line.replace(/\d+\s*[x×]/i, ""))) {
      closeBlocks(indent);
      const block = { repeat: n, children: [], indent };
      top().node.children.push(block);
      stack.push({ node: block, indent });
      current = null;
      blankBefore = false;
      continue;
    }
    if (dash && stack.length > 1 && !top().node.children.length) top().node.dash = true;

    // Notation compacte sur une ligne : on la lit en entier…
    // …sauf si elle détaille l'étape juste au-dessus (« 21 min » puis « 15' + 5' gammes »)
    if (looksCompact(line) && !/\d\s*[x×]/i.test(line) && current?.effort?.sec && !blankBefore) {
      const total = flatten(parseExpr(line)).reduce((a, x) => a + (x.effort.sec || 0), 0);
      if (total > 0 && total <= current.effort.sec * 1.1) {
        current.notes.push(line);
        continue;
      }
    }
    if (looksCompact(line)) {
      if (!dash) closeBlocks(indent);
      const nodes = parseExpr(line);
      top().node.children.push(...nodes);
      current = null;
      blankBefore = false;
      continue;
    }

    const step = QTY_RE.test(line) || /^\d{3,5}\b/.test(line) ? parseStep(line) : null;
    if (step) {
      // Le nom était sur la ligne d'avant (Garmin, TrainingPeaks) : on complète l'étape
      if (current && !current.effort) {
        current.effort = step.effort;
        if (step.name && step.name !== current.name) current.notes.push(step.name);
        if (!current.effort.pace && !current.effort.pct && !current.effort.walk && !current.effort.static) Object.assign(current.effort, parseTarget(current.name) || {});
      } else {
        if (!dash && !(stack.length > 1 && indent > top().indent)) {
          const stayInside = stack.length > 1 && indent <= top().indent && !TOP_LEVEL_NAMES.test(step.name)
            && (top().node.children.length === 0 || (flat && !blankBefore));
          if (!stayInside && step.name) closeBlocks(indent); // une durée seule reste dans le bloc en cours
        }
        current = step;
        top().node.children.push(current);
      }
    } else {
      const startsStep = numbered || !current || (current.effort && (blankBefore || STEP_NAMES.test(line)));
      if (startsStep) {
        const stayInside = stack.length > 1 && indent <= top().indent && !TOP_LEVEL_NAMES.test(line)
          && (top().node.children.length === 0 || (flat && !blankBefore));
        if (!stayInside) closeBlocks(indent);
        current = { name: line, zone: "", notes: [], effort: null };
        top().node.children.push(current);
      } else if (current.effort && !current.zone) {
        current.zone = line;
        // Zone sans allure (« VMA », « Endurance 1 », « Z2 ») : elle donne l'intensité
        if (!current.effort.pace && !current.effort.pct && !current.effort.walk && !current.effort.static) Object.assign(current.effort, parseTarget(line) || {});
      } else {
        current.notes.push(line);
      }
    }
    blankBefore = false;
  }
  return root.children;
}

// Séance « à plat » : les répétitions sont déroulées
function flatten(items, out = []) {
  for (const it of items) {
    if (it.repeat) {
      for (let i = 0; i < it.repeat; i++) flatten(it.children, out);
    } else if (it.effort) {
      out.push(it);
    }
  }
  return out;
}

const WARM_WORDS = /warm|échauff|echauff/i;
const EASY_WORDS = /recover|récup|recup|cool|retour|easy|footing|endurance|\bef\b|\brac\b|jog|trot|\brest\b|repos|marche|walk|\bz[12]\b/i;
const HARD_WORDS = /travail|vma|seuil|tempo|hard|fast|rapide|sprint|c[ôo]te|threshold|interval|fractionn|race|allure sp|\bas ?\d|\bz[45]\b|effort|work/i;

// Allure de chaque étape (s/km) : donnée, ou calculée depuis la VMA
function stepPace(e) {
  if (e.static) return null;
  if (e.walk) return [600, 720];
  if (e.pace) return e.pace;
  const pct = e.pct || [0.65, 0.72];
  return [3600 / (vma() * pct[1]), 3600 / (vma() * pct[0])];
}

// Durée, distance (fourchette), intensité et libellé de l'allure de chaque étape
function measure(steps) {
  const mids = steps.filter((s) => !s.effort.walk && !s.effort.static).map((s) => stepPace(s.effort)).map((p) => (p[0] + p[1]) / 2);
  const fastest = mids.length ? Math.min(...mids) : 300;
  const slowest = mids.length ? Math.max(...mids) : 360;
  return steps.map((s) => {
    const e = s.effort;
    const pace = stepPace(e);
    const mid = pace ? (pace[0] + pace[1]) / 2 : null;
    const sec = e.sec ?? (pace ? (e.dist * mid) / 1000 : 0);
    const dist = e.dist ?? (pace ? (sec / mid) * 1000 : 0);
    const distMin = e.dist ?? (pace ? (sec / pace[1]) * 1000 : 0);
    const distMax = e.dist ?? (pace ? (sec / pace[0]) * 1000 : 0);
    const label = `${s.name} ${s.zone}`;
    const ratio = mid ? 3600 / mid / vma() : 0;
    const kind = !mid || e.walk ? "easy"
      : WARM_WORDS.test(label) ? "warm"
      : EASY_WORDS.test(label) && !HARD_WORDS.test(label) ? "easy"
      : HARD_WORDS.test(label) || ratio >= 0.82 || (slowest - fastest > 20 && mid <= fastest + 0.35 * (slowest - fastest)) ? "hard"
      : "easy";
    const range = pace && Math.round(pace[0]) !== Math.round(pace[1]) ? `${fmtPace(pace[0])}–${fmtPace(pace[1])} /km` : pace ? `${fmtPace(pace[0])} /km` : "";
    const target = e.static ? "récup sur place"
      : e.walk ? "marche"
      : e.pace ? range
      : e.pct ? `${Math.round(e.pct[0] * 100)}${e.pct[1] !== e.pct[0] ? `–${Math.round(e.pct[1] * 100)}` : ""} % VMA → ${range}`
      : `allure footing → ${range}`;
    const title = s.name || (kind === "hard" ? "Effort" : kind === "warm" ? "Échauffement" : "Facile");
    return { ...s, title, sec, dist, distMin, distMax, mid, kind, target, guessed: !e.pace && !e.pct && !e.walk && !e.static, fromVma: Boolean(e.pct) };
  });
}

/* ---------- Affichage de la séance ---------- */
let workout = null; // { steps (déroulées), sec, dist, distMin, distMax }
let measured = new Map(); // effort → étape mesurée (pour l'affichage de l'arbre)

function stepLine(s) {
  const e = s.effort;
  const m = measured.get(e);
  const what = e.sec != null ? fmtDuration(e.sec) : e.dist >= 1000 ? `${fmtNum(e.dist / 1000, 2)} km` : `${Math.round(e.dist)} m`;
  return `<strong>${esc(m?.title || s.name || "Étape")}</strong>
    <span>${what} · ${m ? m.target : ""}${s.zone ? ` · ${esc(s.zone)}` : ""}</span>
    ${s.notes.length ? `<em>${s.notes.map(esc).join(" · ")}</em>` : ""}`;
}

function renderTree(items) {
  return items.map((it) => {
    if (it.repeat) {
      const inner = flatten(it.children).map((s) => measured.get(s.effort)).filter(Boolean);
      const sec = inner.reduce((a, s) => a + s.sec, 0) * it.repeat;
      const dist = inner.reduce((a, s) => a + s.dist, 0) * it.repeat;
      return `<li class="se-repeat">
        <div class="se-repeat__head"><b>${it.repeat} ×</b><span>${fmtDuration(sec)} · ≈ ${fmtNum(dist / 1000, 1)} km</span></div>
        <ol>${renderTree(it.children)}</ol>
      </li>`;
    }
    if (!it.effort) return "";
    return `<li class="se-step se-step--${measured.get(it.effort)?.kind || "easy"}">${stepLine(it)}</li>`;
  }).join("");
}

function readWorkout() {
  const tree = parseWorkout($("workoutText").value);
  const steps = measure(flatten(tree));
  measured = new Map(steps.map((s) => [s.effort, s]));
  if (!steps.length) {
    workout = null;
    $("workoutSteps").innerHTML = "";
    $("workoutBar").innerHTML = "";
    $("workoutTotals").innerHTML = `<p class="card__hint">Colle ta séance ci-dessus, par exemple « 21 min @ 06:19-07:22 min/km » ou « 20' + 10x400 r=1' + 10' ».</p>`;
    $("loopKm").value = "";
    updateLoopButton();
    return;
  }
  const sum = (k) => steps.reduce((a, s) => a + s[k], 0);
  workout = { steps, sec: sum("sec"), dist: sum("dist"), distMin: sum("distMin"), distMax: sum("distMax") };
  $("workoutSteps").innerHTML = renderTree(tree);

  const notes = [];
  if (steps.some((s) => s.fromVma)) notes.push(`Allures calculées avec ta VMA de ${fmtNum(vma(), 1)} km/h.`);
  if (steps.some((s) => s.guessed)) notes.push("Étapes sans allure : comptées à ton allure de footing.");
  $("workoutTotals").innerHTML = `
    <div class="se-total"><span>Durée</span><strong>${fmtDuration(workout.sec)}</strong></div>
    <div class="se-total"><span>Distance</span><strong>≈ ${fmtNum(workout.dist / 1000, 1)} km</strong>
      <small>entre ${fmtNum(workout.distMin / 1000, 1)} et ${fmtNum(workout.distMax / 1000, 1)} km selon ton allure</small></div>
    ${notes.length ? `<p class="card__hint">${notes.join(" ")}</p>` : ""}`;
  // Frise : largeur proportionnelle à la durée de chaque étape
  $("workoutBar").innerHTML = steps.map((s) => `<i class="se-bar__seg se-bar__seg--${s.kind}" style="flex-grow:${s.sec}" title="${esc(s.title)} · ${fmtDuration(s.sec)}"></i>`).join("");
  if (!loopKmTouched) $("loopKm").value = fmtNum(workout.dist / 1000, 1);
  updateLoopButton();
  // Le parcours déjà tracé reprend les couleurs de la nouvelle séance
  if (loop) drawLoop();
}

/* ---------- Ton appli : comment récupérer la séance + un exemple dans son format ---------- */
const APPS = {
  garmin: {
    how: "Sur <b>connect.garmin.com</b>, ouvre l'entraînement, sélectionne les étapes à la souris et copie-les. Depuis l'appli du téléphone, recopie-les : une étape par ligne, « Répéter X fois » au-dessus des étapes répétées.",
    example: EXAMPLE,
  },
  coros: {
    how: "Dans <b>Training Hub</b> (site web Coros) ou l'appli, ouvre l'entraînement et copie ou recopie les étapes. « Training x6 » ou « Répéter 6 fois » marquent les répétitions.",
    example: `Warm Up
10:00 @ 6:00-6:30 /km
Training x6
  Run
  400 m @ 3:50-4:00 /km
  Rest
  1:30 @ 7:00-7:30 /km
Cool Down
10:00 @ 6:00-6:30 /km`,
  },
  polar: {
    how: "Dans <b>Polar Flow</b> (site web), ouvre ton objectif d'entraînement par phases et copie les phases. Les zones (« Zone 2 ») sont converties en allure avec ta VMA.",
    example: `Échauffement
10 min · Zone 2
Répéter 5 fois
  Travail
  3 min · Zone 4
  Récupération
  2 min · Zone 1
Retour au calme
10 min · Zone 2`,
  },
  suunto: {
    how: "Dans l'appli <b>Suunto</b>, ouvre l'entraînement guidé et recopie ses étapes, une par ligne.",
    example: `Warm up 15 min
Interval 6 x
  Work 1 km @ 4:00/km
  Recovery 2 min
Cool down 10 min`,
  },
  apple: {
    how: "Dans l'app <b>Exercice</b> de la montre (entraînement personnalisé), recopie les étapes : échauffement, séries de travail et récupération, retour au calme.",
    example: `Échauffement : 10 min
4 x
  Effort : 4 min @ 4:30/km
  Récupération : 2 min
Retour au calme : 10 min`,
  },
  trainingpeaks: {
    how: "Ouvre la séance et copie sa <b>description</b> (Warm up… Repeat… Cool Down). Les % d'allure seuil (« Threshold Pace ») sont convertis avec ta VMA.",
    example: `Warm up
15 min @ 65-75% Threshold Pace
Repeat 5 times
  Hard
  3 min @ 95-100% Threshold Pace
  Easy
  2 min @ 70% Threshold Pace
Cool Down
10 min @ 65% Threshold Pace`,
  },
  intervals: {
    how: "Dans l'<b>éditeur de séance</b>, copie tout le texte. Attention : ici « m » veut dire minutes et « mtr » mètres.",
    example: `Warmup 15m Z2 Pace

Main Set 6x
- 800mtr 3:50/km Pace
- 2m Z1 Pace

Cooldown 10m Z2 Pace`,
  },
  nolio: {
    how: "Copie la <b>description de la séance</b> écrite par ton coach. La notation compacte est comprise : « 2 x (5 x 1000 à AS10 r=1'30) r=3' ».",
    example: `20' EF + 2 x (5 x 1000 m à AS10 r=1'30) r=3' + 10' RAC`,
  },
  runna: {
    how: "Recopie la séance comme elle est écrite dans <b>Runna</b>, sur une ou plusieurs lignes : « 1.2km warm-up → Set: 3× (…) → 1km cool-down ».",
    example: `1.2km warm-up → Set: 3× (300m @ 6:15/km + 300m recovery @ 7:00/km) → Rest: 90s walking rest → 1km cool-down`,
  },
  strava: {
    how: "<b>Strava</b> n'a pas de séances structurées : écris ta séance en notation compacte, comme dans l'exemple.",
    example: `15' échauffement + 6 x 800 m en 3'10 r 2' + 10' retour au calme`,
  },
  other: {
    how: "Écris ta séance comme tu veux : « 20' + 10x400 r=1' + 10' », « 3x(6x30''/30'') », « 1000 en 3'45 », « 2x15' allure semi ». Allures en min/km, min/mi ou km/h ; zones et % (VMA, seuil, AS10, Z1 à Z5…) convertis avec ta VMA.",
    example: `20' footing + 3x(6x30''/30'') r=3' + 10' retour au calme`,
  },
};

function showApp() {
  const app = APPS[$("appSelect").value] || APPS.garmin;
  $("appHow").innerHTML = app.how;
}
$("appSelect").addEventListener("change", () => {
  showApp();
  save();
});
$("appExampleBtn").addEventListener("click", () => {
  $("workoutText").value = (APPS[$("appSelect").value] || APPS.garmin).example;
  loopKmTouched = false;
  readWorkout();
  save();
});

let loopKmTouched = false;
$("workoutText").addEventListener("input", () => {
  readWorkout();
  save();
});
$("vma").addEventListener("input", () => {
  readWorkout();
  save();
});
$("loopKm").addEventListener("input", () => {
  loopKmTouched = true;
  updateLoopButton();
});

/* =========================================================
   2. Carte et point de départ
   ========================================================= */
const map = L.map("map", { zoomControl: false }).setView([46.6, 2.4], 6);
L.control.zoom({ position: "bottomright" }).addTo(map);
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const streetUrl = location.protocol.startsWith("http")
  ? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
  : "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png";
const baseLayers = {
  Sombre: L.tileLayer(streetUrl, { maxZoom: 19, subdomains: "abc", attribution: OSM, className: "tiles-dark" }),
  Plan: L.tileLayer(streetUrl, { maxZoom: 19, subdomains: "abc", attribution: OSM }),
  Satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagerie &copy; Esri" }),
};
baseLayers.Sombre.addTo(map);
L.control.layers(baseLayers, null, { position: "topright" }).addTo(map);

const loopLayer = L.layerGroup().addTo(map);
let start = null; // { lat, lng }
let startMarker = null;
let loop = null; // { line: [[lat, lng]], distance, waypoints, profile, gain, loss }

function setStart(latlng, pan = false) {
  start = { lat: latlng.lat, lng: latlng.lng };
  if (!startMarker) {
    startMarker = L.marker(start, {
      draggable: true,
      zIndexOffset: 1000,
      icon: L.divIcon({ className: "", html: `<div class="wp wp--start">D</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
    }).addTo(map);
    startMarker.bindTooltip("Départ et arrivée", { direction: "top", offset: [0, -14] });
    startMarker.on("dragend", () => setStart(startMarker.getLatLng()));
  } else {
    startMarker.setLatLng(start);
  }
  if (pan) map.setView(start, Math.max(map.getZoom(), 14));
  $("mapHint").hidden = true;
  updateLoopButton();
  save();
}

map.on("click", (e) => setStart(e.latlng));

$("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("searchInput").value.trim();
  if (!q) return;
  try {
    const res = await fetch(`${SEARCH_URL}?limit=1&lang=fr&q=${encodeURIComponent(q)}`);
    const [place] = (await res.json()).features;
    if (!place) return status("Lieu introuvable.", true);
    const [lng, lat] = place.geometry.coordinates;
    setStart({ lat, lng }, true);
    status("");
  } catch {
    status("Recherche indisponible pour le moment.", true);
  }
});

$("locateBtn").addEventListener("click", () => {
  if (!navigator.geolocation) return status("La géolocalisation n'est pas disponible.", true);
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => setStart({ lat: coords.latitude, lng: coords.longitude }, true),
    () => status("Impossible d'obtenir ta position.", true),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

function status(text, error = false) {
  $("loopStatus").textContent = text;
  $("loopStatus").hidden = !text;
  $("loopStatus").classList.toggle("is-error", error);
}

const targetMeters = () => Number(String($("loopKm").value).replace(",", ".")) * 1000;
function updateLoopButton() {
  const ok = start && targetMeters() >= 500;
  $("loopBtn").disabled = !ok;
  $("loopBtn").textContent = loop ? "Une autre boucle" : "Créer ma boucle";
  if (!start) $("loopHelp").textContent = "Clique sur la carte, cherche un lieu ou utilise ta position pour choisir le départ.";
  else if (!(targetMeters() >= 500)) $("loopHelp").textContent = "Indique la longueur de la boucle (au moins 0,5 km).";
  else $("loopHelp").textContent = "";
}

/* =========================================================
   3. Création de la boucle
   On pose 3 points sur un cercle qui passe par le départ, on demande
   l'itinéraire départ → 3 points → départ, puis on ajuste la taille
   du cercle jusqu'à tomber sur la bonne distance (± 4 %).
   Pas d'allers-retours : demi-tours interdits aux points de passage,
   impasses retirées du tracé, et si trop de chemin est parcouru deux
   fois, on essaie une autre direction.
   ========================================================= */
const R_EARTH = 6371000;
function destination(p, dist, bearingDeg) {
  const b = (bearingDeg * Math.PI) / 180;
  const d = dist / R_EARTH;
  const la1 = (p.lat * Math.PI) / 180;
  const lo1 = (p.lng * Math.PI) / 180;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: (la2 * 180) / Math.PI, lng: (lo2 * 180) / Math.PI };
}
function haversine(a, b) {
  const r = Math.PI / 180;
  const x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(x));
}

function cumDist(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversine(line[i - 1], line[i]));
  return cum;
}
// Point situé à d mètres du début du tracé
function pointAt(line, cum, d) {
  let i = 1;
  while (i < line.length - 1 && cum[i] < d) i++;
  const t = Math.min(1, Math.max(0, (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)));
  return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
}

// Tri rapide avant le calcul exact : à plus de ~30 m d'écart en latitude ou longitude, inutile d'aller plus loin
const near = (a, b) => Math.abs(a[0] - b[0]) < 0.0003 && Math.abs(a[1] - b[1]) < 0.0004;

// Retire les impasses : on part de A, on va au bout, et on revient à A par le même chemin
function removeSpurs(line) {
  let pts = line;
  for (let pass = 0; pass < 20; pass++) {
    const cum = cumDist(pts);
    const total = cum[cum.length - 1];
    let cut = null;
    search: for (let i = 1; i < pts.length - 2; i++) {
      for (let j = pts.length - 2; j > i + 1; j--) {
        const len = cum[j] - cum[i];
        if (len > total * 0.3) continue; // la boucle elle-même n'est pas une impasse
        if (len < 20) break;
        if (!near(pts[i], pts[j]) || haversine(pts[i], pts[j]) > 12) continue;
        // Même chemin à l'envers : à mi-parcours, l'aller et le retour se superposent
        const same = [0.2, 0.4, 0.5, 0.6, 0.8].every((f) => haversine(pointAt(pts, cum, cum[i] + len * f), pointAt(pts, cum, cum[j] - len * f)) < 20);
        if (same) {
          cut = [i, j];
          break search;
        }
      }
    }
    if (!cut) break;
    pts = [...pts.slice(0, cut[0] + 1), ...pts.slice(cut[1] + 1)];
  }
  return pts;
}

// Part du tracé empruntée deux fois (0 = aucune rue reprise, 1 = tout en aller-retour)
function reusedShare(line) {
  const cum = cumDist(line);
  const total = cum[cum.length - 1];
  const samples = [];
  for (let d = 0; d <= total; d += 25) samples.push([d, pointAt(line, cum, d)]);
  let reused = 0;
  for (const [d, p] of samples) {
    if (samples.some(([d2, p2]) => Math.abs(d2 - d) > 150 && Math.abs(total - Math.abs(d2 - d)) > 150 && near(p, p2) && haversine(p, p2) < 15)) reused++;
  }
  return samples.length ? reused / samples.length : 0;
}

async function routeThrough(points) {
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  // continue_straight : pas de demi-tour pour « toucher » un point de passage
  const res = await fetch(`${ROUTER}${coords}?overview=full&geometries=geojson&continue_straight=true`, { signal: AbortSignal.timeout(12000) });
  const json = await res.json();
  if (json.code !== "Ok") throw new Error(json.code);
  const line = removeSpurs(json.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]));
  const cum = cumDist(line);
  return { line, distance: cum[cum.length - 1], reused: reusedShare(line) };
}

let busy = false;
async function makeLoop() {
  if (busy || !start) return;
  const target = targetMeters();
  if (!(target >= 500)) return;
  busy = true;
  $("loopBtn").disabled = true;
  status("Recherche d'une boucle…");
  // Note d'une boucle : écart à la distance visée + pénalité pour les rues reprises (au-delà de 3 %)
  const score = (r) => Math.abs(r.distance / target - 1) + 3 * Math.max(0, r.reused - 0.03);
  let best = null;
  let calls = 0;
  try {
    // Jusqu'à 3 directions (une nouvelle à chaque clic) ; on garde la meilleure
    const first = Math.random() * 360;
    for (let k = 0; k < 3 && calls < 10; k++) {
      const bearing = first + k * 120;
      let radius = target / (2 * Math.PI) / 1.3; // les chemins font ≈ 30 % de plus qu'un cercle parfait
      for (let i = 0; i < 4 && calls < 10; i++) {
        const center = destination(start, radius, bearing);
        const pts = [-90, 0, 90].map((a) => destination(center, radius, bearing + a));
        const r = await routeThrough([start, ...pts, start]);
        calls++;
        if (!best || score(r) < score(best)) best = { ...r, waypoints: [start, ...pts, start] };
        const err = r.distance / target;
        if (Math.abs(err - 1) < 0.04) break;
        radius /= err;
      }
      // Bonne distance et presque pas de rue reprise : inutile d'essayer d'autres directions
      if (Math.abs(best.distance / target - 1) < 0.04 && best.reused < 0.05) break;
      status("Recherche d'une boucle sans aller-retour…");
    }
    loop = { ...best, profile: null, gain: null, loss: null };
    drawLoop(true);
    status("");
    loadElevation();
  } catch {
    status("Le service d'itinéraire ne répond pas : réessaie dans un instant.", true);
  } finally {
    busy = false;
    updateLoopButton();
  }
}
$("loopBtn").addEventListener("click", makeLoop);

// Tracé coloré : chaque étape de la séance à l'endroit où tu seras
const KIND_COLORS = () => ({ warm: getCss("--se-warm"), easy: getCss("--lilac"), hard: getCss("--pink") });
const getCss = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#999";

function drawLoop(fit = false) {
  loopLayer.clearLayers();
  if (!loop) return;
  const line = loop.line;
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversine(line[i - 1], line[i]));
  const total = cum[cum.length - 1];
  L.polyline(line, { color: "#000", weight: 9, opacity: 0.35, interactive: false }).addTo(loopLayer);

  const colors = KIND_COLORS();
  if (workout) {
    // Les étapes sont posées sur la boucle proportionnellement à leur distance
    const k = total / workout.dist;
    let from = 0;
    let j = 0;
    for (const s of workout.steps) {
      const to = from + s.dist * k;
      const seg = [];
      while (j < line.length - 1 && cum[j + 1] <= from) j++;
      const at = (d) => {
        let i = j;
        while (i < line.length - 1 && cum[i + 1] < d) i++;
        const t = (d - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
        return [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t];
      };
      seg.push(at(from));
      for (let i = j + 1; i < line.length && cum[i] < to; i++) seg.push(line[i]);
      seg.push(at(Math.min(to, total)));
      L.polyline(seg, { color: colors[s.kind], weight: 5, opacity: 1, interactive: false }).addTo(loopLayer);
      from = to;
    }
  } else {
    L.polyline(line, { color: colors.easy, weight: 5 }).addTo(loopLayer);
  }
  // Repères tous les km
  const step = total > 25000 ? 5000 : 1000;
  for (let next = step, i = 1; next < total - 100; next += step) {
    while (i < line.length - 1 && cum[i] < next) i++;
    const t = (next - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    L.marker([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t], {
      interactive: false,
      icon: L.divIcon({ className: "", html: `<span class="km-mark">${next / 1000}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(loopLayer);
  }
  if (fit) map.fitBounds(L.latLngBounds(line), { padding: [40, 40] });
  renderLoopStats();
}

function renderLoopStats() {
  $("loopResult").hidden = !loop;
  if (!loop) return;
  const diff = workout ? loop.distance - workout.dist : 0;
  $("loopDist").textContent = `${fmtNum(loop.distance / 1000, 2)} km`;
  $("loopGain").textContent = loop.gain != null ? `${loop.gain} m` : "…";
  $("loopLoss").textContent = loop.loss != null ? `${loop.loss} m` : "…";
  $("loopNote").textContent = workout
    ? Math.abs(diff) < 150
      ? "La boucle colle à la distance de ta séance."
      : `${fmtNum(Math.abs(diff) / 1000, 2)} km de ${diff > 0 ? "plus" : "moins"} que la séance : ${diff > 0 ? "finis en marchant ou en trottinant" : "ajoute un petit aller-retour à la fin"}.`
    : "";
  if (!$("loopName").value) $("loopName").value = `Séance ${workout ? fmtDuration(workout.sec) : ""} · ${fmtNum(loop.distance / 1000, 1)} km`.replace("  ", " ");
}

// Altitude : 100 points le long de la boucle (Open-Meteo, gratuit)
async function loadElevation() {
  const current = loop;
  const line = current.line;
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversine(line[i - 1], line[i]));
  const total = cum[cum.length - 1];
  const n = 100;
  const samples = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < line.length - 1 && cum[j] < target) j++;
    const t = Math.min(1, Math.max(0, (target - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1)));
    samples.push([target, line[j - 1][0] + (line[j][0] - line[j - 1][0]) * t, line[j - 1][1] + (line[j][1] - line[j - 1][1]) * t]);
  }
  try {
    const res = await fetch(`${ELEVATION_URL}?latitude=${samples.map((s) => s[1].toFixed(5)).join(",")}&longitude=${samples.map((s) => s[2].toFixed(5)).join(",")}`, { signal: AbortSignal.timeout(15000) });
    const json = await res.json();
    if (current !== loop) return;
    loop.profile = samples.map((s, i) => [Math.round(s[0]), Math.round(json.elevation[i])]);
    // Dénivelé sur l'altitude lissée (± 100 m) : le « bruit » des données n'invente pas de côtes
    const smooth = loop.profile.map(([d]) => {
      const near = loop.profile.filter(([d2]) => Math.abs(d2 - d) <= 100);
      return near.reduce((a, p) => a + p[1], 0) / near.length;
    });
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < smooth.length; i++) {
      const dz = smooth[i] - smooth[i - 1];
      if (dz > 0) gain += dz; else loss -= dz;
    }
    loop.gain = Math.round(gain);
    loop.loss = Math.round(loss);
  } catch {
    if (current === loop) loop.gain = loop.loss = null;
  }
  renderLoopStats();
}

/* =========================================================
   4. Garder la boucle : Mes parcours ou GPX
   ========================================================= */
$("saveLoopBtn").addEventListener("click", () => {
  if (!loop) return;
  const name = $("loopName").value.trim() || "Boucle de séance";
  let list = [];
  try { list = JSON.parse(localStorage.getItem(ROUTES_KEY)) || []; } catch { /* vide */ }
  list = list.filter((r) => r.name !== name);
  list.unshift({
    id: Date.now().toString(36),
    name,
    sport: "run",
    waypoints: loop.waypoints,
    snap: true,
    distance: loop.distance,
    gain: loop.gain,
    loss: loop.loss,
    profile: loop.profile,
    line: loop.line.filter((_, i) => i % Math.ceil(loop.line.length / 1500) === 0 || i === loop.line.length - 1).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]),
  });
  try {
    localStorage.setItem(ROUTES_KEY, JSON.stringify(list));
    status(`« ${name} » est dans tes parcours : retrouve-le dans l'outil Parcours, le calculateur d'allure et le triathlon.`);
  } catch {
    status("Impossible d'enregistrer dans ce navigateur.", true);
  }
});

$("gpxLoopBtn").addEventListener("click", () => {
  if (!loop) return;
  const name = $("loopName").value.trim() || "Boucle de séance";
  const ele = (i) => {
    if (!loop.profile) return "";
    const d = (i / (loop.line.length - 1)) * loop.distance;
    const p = loop.profile.reduce((best, x) => (Math.abs(x[0] - d) < Math.abs(best[0] - d) ? x : best));
    return `<ele>${p[1]}</ele>`;
  };
  const pts = loop.line.map((p, i) => `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}">${ele(i)}</trkpt>`).join("\n      ");
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${BRAND}" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
  <trk>
    <name>${esc(name)}</name>
    <type>running</type>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
  a.download = `${name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "boucle"}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

/* ---------- Mémorise la séance et le départ (dans ce navigateur) ---------- */
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ text: $("workoutText").value, start, vma: $("vma").value, app: $("appSelect").value, loopKm: loopKmTouched ? $("loopKm").value : "" }));
  } catch { /* stockage indisponible */ }
}
(function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { /* stockage indisponible */ }
  $("workoutText").value = saved?.text ?? EXAMPLE;
  if (saved?.vma) $("vma").value = saved.vma;
  if (saved?.app && APPS[saved.app]) $("appSelect").value = saved.app;
  showApp();
  if (saved?.loopKm) {
    $("loopKm").value = saved.loopKm;
    loopKmTouched = true;
  }
  readWorkout();
  if (saved?.start) setStart(saved.start, true);
  updateLoopButton();
})();
