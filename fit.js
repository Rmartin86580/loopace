/* =========================================================
   Fichiers .fit (format Garmin, utilisé par toutes les montres)
   Lecture et écriture dans le navigateur, sans rien envoyer en ligne.

   Lecture :
   readFit(arrayBuffer) → { [numéro de message global]: [ { numéro de champ: valeur } ] }
   Messages utiles ici : 0 file_id, 26 workout (séance), 27 workout_step (étapes).
   ========================================================= */
function readFit(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 12) throw new Error("Fichier trop court");
  const headerSize = view.getUint8(0);
  const sig = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (sig !== ".FIT") throw new Error("Ce n'est pas un fichier .fit");
  const dataSize = view.getUint32(4, true);
  const end = Math.min(view.byteLength, headerSize + dataSize);

  // Valeurs « absentes » selon le type de base
  const INVALID = { 0x00: 0xff, 0x01: 0x7f, 0x02: 0xff, 0x83: 0x7fff, 0x84: 0xffff, 0x85: 0x7fffffff, 0x86: 0xffffffff, 0x0a: 0, 0x8b: 0, 0x8c: 0 };
  const SIZES = { 0x00: 1, 0x01: 1, 0x02: 1, 0x83: 2, 0x84: 2, 0x85: 4, 0x86: 4, 0x07: 1, 0x88: 4, 0x89: 8, 0x0a: 1, 0x8b: 2, 0x8c: 4, 0x0d: 1, 0x8e: 8, 0x8f: 8, 0x90: 8 };

  function readValue(pos, size, baseType, little) {
    if (baseType === 0x07) {
      // Texte UTF-8 terminé par un zéro
      const bytes = new Uint8Array(buffer, pos, size);
      const zero = bytes.indexOf(0);
      return new TextDecoder().decode(zero >= 0 ? bytes.subarray(0, zero) : bytes) || null;
    }
    const el = SIZES[baseType] || size;
    if (size < el) return null;
    let v;
    switch (baseType) {
      case 0x00: case 0x02: case 0x0a: case 0x0d: v = view.getUint8(pos); break;
      case 0x01: v = view.getInt8(pos); break;
      case 0x83: v = view.getInt16(pos, little); break;
      case 0x84: case 0x8b: v = view.getUint16(pos, little); break;
      case 0x85: v = view.getInt32(pos, little); break;
      case 0x86: case 0x8c: v = view.getUint32(pos, little); break;
      case 0x88: v = view.getFloat32(pos, little); break;
      case 0x89: v = view.getFloat64(pos, little); break;
      default: return null; // entiers 64 bits : inutiles ici
    }
    if (baseType in INVALID && v === INVALID[baseType]) return null;
    return v;
  }

  const defs = {}; // définitions par type de message local (0 à 15)
  const out = {};
  let pos = headerSize;
  while (pos < end) {
    const header = view.getUint8(pos++);
    if (header & 0x80) {
      // En-tête compressé (horodatage) : message de données, type local sur 2 bits
      pos = readData(defs[(header >> 5) & 0x03], pos);
      continue;
    }
    const local = header & 0x0f;
    if (header & 0x40) {
      // Message de définition
      const hasDev = header & 0x20;
      const little = view.getUint8(pos + 1) === 0;
      const global = view.getUint16(pos + 2, little);
      const n = view.getUint8(pos + 4);
      pos += 5;
      const fields = [];
      for (let i = 0; i < n; i++, pos += 3) fields.push({ num: view.getUint8(pos), size: view.getUint8(pos + 1), type: view.getUint8(pos + 2) });
      let devSize = 0;
      if (hasDev) {
        const nd = view.getUint8(pos++);
        for (let i = 0; i < nd; i++, pos += 3) devSize += view.getUint8(pos + 1);
      }
      defs[local] = { global, little, fields, devSize };
    } else {
      pos = readData(defs[local], pos);
    }
  }
  return out;

  function readData(def, p) {
    if (!def) throw new Error("Fichier .fit illisible (définition manquante)");
    const msg = {};
    for (const f of def.fields) {
      const v = readValue(p, f.size, f.type, def.little);
      if (v !== null) msg[f.num] = v;
      p += f.size;
    }
    p += def.devSize;
    (out[def.global] ||= []).push(msg);
    return p;
  }
}

/* ---------- Écriture ----------
   writeFit(messages) → Uint8Array, messages = [{ global, fields: [[numéro, type de base, taille, valeur], …] }]
   Types de base : 0x00 enum, 0x02 uint8, 0x84 uint16, 0x85 sint32, 0x86 uint32, 0x8c uint32z, 0x07 texte.
   Une valeur null est écrite comme « absente ». */
const FIT_EPOCH = 631065600; // 31/12/1989 en secondes Unix : origine des dates .fit
const fitNow = () => Math.round(Date.now() / 1000) - FIT_EPOCH;
const fitSemicircles = (deg) => Math.round(deg * (2 ** 31 / 180));

const FIT_CRC = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
function fitCrc(bytes, from = 0, to = bytes.length) {
  let crc = 0;
  for (let i = from; i < to; i++) {
    const b = bytes[i];
    let tmp = FIT_CRC[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ FIT_CRC[b & 0xf];
    tmp = FIT_CRC[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ FIT_CRC[(b >> 4) & 0xf];
  }
  return crc;
}

function writeFit(messages) {
  const out = [];
  const tmp = new DataView(new ArrayBuffer(4));
  const NONE = { 0x00: 0xff, 0x02: 0xff, 0x84: 0xffff, 0x85: 0x7fffffff, 0x86: 0xffffffff, 0x8c: 0 };
  function value(type, size, v) {
    if (type === 0x07) {
      // Texte UTF-8 coupé à la taille du champ, sans couper un caractère, terminé par des zéros
      let bytes = new TextEncoder().encode(v || "");
      if (bytes.length > size - 1) {
        let cut = size - 1;
        while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
        bytes = bytes.subarray(0, cut);
      }
      for (let i = 0; i < size; i++) out.push(bytes[i] ?? 0);
      return;
    }
    if (v == null) v = NONE[type];
    if (size === 1) tmp.setUint8(0, v);
    else if (size === 2) tmp.setUint16(0, v, true);
    else if (type === 0x85) tmp.setInt32(0, v, true);
    else tmp.setUint32(0, v, true);
    for (let i = 0; i < size; i++) out.push(tmp.getUint8(i));
  }
  // Un type local (0 à 15) par forme de message ; on redéfinit quand la forme change
  const locals = new Map();
  let next = 0;
  for (const m of messages) {
    const sig = m.global + ":" + m.fields.map((f) => f[0] + "/" + f[2]).join(",");
    let local = locals.get(sig);
    if (local === undefined) {
      local = next++ % 16;
      for (const [k, v] of locals) if (v === local) locals.delete(k);
      locals.set(sig, local);
      out.push(0x40 | local, 0, 0, m.global & 0xff, m.global >> 8, m.fields.length);
      for (const [num, type, size] of m.fields) out.push(num, size, type);
    }
    out.push(local);
    for (const [, type, size, v] of m.fields) value(type, size, v);
  }
  const file = new Uint8Array(14 + out.length + 2);
  const head = new DataView(file.buffer);
  head.setUint8(0, 14);
  head.setUint8(1, 0x10); // protocole 1.0
  head.setUint16(2, 2132, true); // version du profil
  head.setUint32(4, out.length, true);
  file.set([0x2e, 0x46, 0x49, 0x54], 8); // « .FIT »
  head.setUint16(12, fitCrc(file, 0, 12), true);
  file.set(out, 14);
  head.setUint16(14 + out.length, fitCrc(file, 0, 14 + out.length), true);
  return file;
}

// Taille d'un champ texte : le texte en UTF-8 + le zéro final
const fitStrSize = (s, max = 64) => Math.min(max, new TextEncoder().encode(s || "").length + 1);
const fitFileId = (type) => ({ global: 0, fields: [[0, 0x00, 1, type], [1, 0x84, 2, 255], [2, 0x84, 2, 0], [3, 0x8c, 4, 1], [4, 0x86, 4, fitNow()]] });

/* Séance structurée (fichier « workout », lu par les montres comme entraînement guidé).
   steps : [{ name, duration: { type: "time"|"distance"|"open", value (s ou m) },
              speed: [lente, rapide] en m/s ou null, intensity: 0 effort, 1 repos, 2 échauffement, 3 retour au calme, 4 récup }
            ou { repeatFrom: index de la 1re étape répétée, count }]
   sport : 1 course à pied, 2 vélo ; subSport : 7 route, 8 VTT, 46 gravel */
function fitWorkoutFile({ name, sport = 1, subSport = 0, steps }) {
  const msgs = [fitFileId(5)];
  msgs.push({ global: 26, fields: [[4, 0x00, 1, sport], [11, 0x00, 1, subSport], [6, 0x84, 2, steps.length], [8, 0x07, fitStrSize(name, 40), name]] });
  steps.forEach((s, i) => {
    if (s.repeatFrom != null) {
      // « Répéter jusqu'à avoir fait les étapes N fois » : durée = 1re étape, cible = nombre de fois
      msgs.push({ global: 27, fields: [[254, 0x84, 2, i], [0, 0x07, 16, ""], [1, 0x00, 1, 6], [2, 0x86, 4, s.repeatFrom], [3, 0x00, 1, 2], [4, 0x86, 4, s.count], [5, 0x86, 4, null], [6, 0x86, 4, null], [7, 0x00, 1, null]] });
      return;
    }
    const d = s.duration;
    const durType = d.type === "time" ? 0 : d.type === "distance" ? 1 : 5;
    const durValue = d.type === "time" ? Math.round(d.value * 1000) : d.type === "distance" ? Math.round(d.value * 100) : null;
    const speed = s.speed ? s.speed.map((v) => Math.round(v * 1000)) : null; // mm/s
    msgs.push({ global: 27, fields: [
      [254, 0x84, 2, i], [0, 0x07, 16, s.name || ""], [1, 0x00, 1, durType], [2, 0x86, 4, durValue],
      [3, 0x00, 1, speed ? 0 : 2], [4, 0x86, 4, speed ? 0 : null], [5, 0x86, 4, speed ? speed[0] : null], [6, 0x86, 4, speed ? speed[1] : null],
      [7, 0x00, 1, s.intensity ?? 0],
    ] });
  });
  return writeFit(msgs);
}

// Téléchargement d'un fichier généré (nom sans accents ni espaces)
function downloadFile(bytes, name, ext, type = "application/octet-stream") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = `${String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "loopace"}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
