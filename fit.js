/* =========================================================
   Lecteur de fichiers .fit (format Garmin, utilisé par toutes les montres)
   Décode le fichier dans le navigateur, sans rien envoyer en ligne.
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
