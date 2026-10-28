/* =========================================================
   Bracelet d'allure Loopace : bande à imprimer + fond d'écran téléphone
   Partagé par le calculateur d'allure et le planificateur triathlon.
   Utilise $ et fmtTime de la page, et ACCENT / BRAND / svgImage de script.js.
   plan = { name, time, info: [lignes], paceHead, splits: [
     { label, cum, paceTxt, grade, finish }   ← une ligne de passage
     { section: "VÉLO" }                      ← un intertitre (triathlon)
   ] }
   ========================================================= */
const PINK = "#B7E532";  // citron Loopace (sur fond sombre)
const INK = "#4d7c0f";   // citron assombri, pour le texte sur le papier blanc
const BAND_DPI = 300;
const MM = BAND_DPI / 25.4; // pixels par millimètre à 300 dpi
const BAND_WIDTH_MM = 35;

// Logo Loopace (version texte clair : toujours posé sur un bandeau vert sombre)
let bandLogo = null;
const bandLogoReady = dataImage(LOGO_ON_DARK).then((img) => (bandLogo = img));

// Dessine le logo centré sur cx ; baseline = bas des lettres ; fs = hauteur des lettres
function drawLogo(ctx, cx, baseline, fs) {
  if (!bandLogo) {
    ctx.save();
    ctx.font = `800 ${fs}px Syne`;
    ctx.fillStyle = "#F7FAEF";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(BRAND, cx, baseline);
    ctx.restore();
    return;
  }
  const h = fs * 1.3; // l'image comprend la jambe du « p »
  const w = h * (bandLogo.width / bandLogo.height);
  ctx.drawImage(bandLogo, cx - w / 2, baseline - fs * 1.05, w, h);
}

const gradeMark = (g) => (g >= 3 ? "▲" : g <= -3 ? "▼" : "");
const gradeColor = (g, onLight) => (g >= 3 ? (onLight ? "#c2410c" : "#ff9a8a") : g <= -3 ? (onLight ? "#0f766e" : "#7dd3c0") : null);

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/* ---------- Bracelet à imprimer (fond blanc, 35 mm de large) ---------- */
function drawBand(plan) {
  const rows = plan.splits;
  const cols = rows.length > 45 ? 2 : 1;
  const perCol = Math.ceil(rows.length / cols);
  const colW = BAND_WIDTH_MM * MM;
  const rowH = 5.2 * MM;
  const headH = 27 * MM;
  const footH = 7 * MM;
  const W = Math.round(colW * cols);
  const H = Math.round(headH + (perCol + 1) * rowH + footH);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const pad = 2.5 * MM;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  // Bandeau du haut
  ctx.fillStyle = "#15291F";
  ctx.fillRect(0, 0, W, headH);
  ctx.fillStyle = PINK;
  ctx.fillRect(0, headH - 1.2 * MM, W, 1.2 * MM);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${3.6 * MM}px Inter`;
  ctx.fillText(fitText(ctx, plan.name, W - 2 * pad), pad, 2.4 * MM);
  // Temps visé : le plus grand possible sans dépasser la largeur
  let size = 8.5 * MM;
  do {
    ctx.font = `800 ${size}px Syne`;
    size -= 0.2 * MM;
  } while (ctx.measureText(fmtTime(plan.time)).width > colW - 2 * pad && size > 4 * MM);
  ctx.fillStyle = PINK;
  ctx.fillText(fmtTime(plan.time), pad, 7.2 * MM);
  ctx.font = `500 ${2.7 * MM}px Inter`;
  ctx.fillStyle = "rgba(255,255,255,.85)";
  plan.info.forEach((line, i) => ctx.fillText(fitText(ctx, line, W - 2 * pad), pad, (17 + i * 3.6) * MM));

  for (let col = 0; col < cols; col++) {
    const x0 = col * colW;
    const slice = rows.slice(col * perCol, (col + 1) * perCol);
    // Colonnes : km | repère de pente | allure (alignée à droite) | passage (aligné à droite)
    const markX = pad + 7.6 * MM;
    const paceX = colW * 0.52;
    // En-tête des colonnes
    let y = headH;
    ctx.font = `700 ${2.3 * MM}px Inter`;
    ctx.fillStyle = "#5b6b60";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(plan.labelHead || "KM", x0 + pad, y + rowH / 2);
    ctx.textAlign = "right";
    ctx.fillText(plan.paceHead, x0 + paceX, y + rowH / 2);
    ctx.fillText("PASSAGE", x0 + colW - pad, y + rowH / 2);
    y += rowH;
    slice.forEach((s, i) => {
      if (s.section) {
        ctx.fillStyle = "#15291F";
        ctx.fillRect(x0, y, colW, rowH);
        ctx.textAlign = "left";
        ctx.font = `800 ${2.5 * MM}px Inter`;
        ctx.fillStyle = PINK;
        ctx.fillText(s.section, x0 + pad, y + rowH / 2);
        y += rowH;
        return;
      }
      if (i % 2 === 0) {
        ctx.fillStyle = "#eef3e2";
        ctx.fillRect(x0, y, colW, rowH);
      }
      const color = gradeColor(s.grade, true);
      ctx.textAlign = "left";
      ctx.font = `700 ${3 * MM}px Inter`;
      ctx.fillStyle = s.finish ? INK : "#15291F";
      ctx.fillText(s.label, x0 + pad, y + rowH / 2);
      const mark = gradeMark(s.grade);
      if (mark) {
        ctx.font = `700 ${2 * MM}px Inter`;
        ctx.fillStyle = color;
        ctx.fillText(mark, x0 + markX, y + rowH / 2);
      }
      ctx.textAlign = "right";
      ctx.font = `500 ${2.6 * MM}px Inter`;
      ctx.fillStyle = color || "#4a5a50";
      ctx.fillText(s.paceTxt, x0 + paceX, y + rowH / 2);
      // Passage : police réduite si le temps dépasse l'heure (h:mm:ss)
      ctx.font = `800 ${(s.cum >= 3600 ? 2.9 : 3.3) * MM}px Inter`;
      ctx.fillStyle = s.finish ? INK : "#15291F";
      ctx.fillText(fmtTime(s.cum), x0 + colW - pad, y + rowH / 2);
      y += rowH;
    });
    if (col > 0) {
      ctx.fillStyle = "#d5ddc8";
      ctx.fillRect(x0, headH, 1, H - headH - footH);
    }
  }
  // Pied
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#15291F";
  ctx.fillRect(0, H - footH, W, footH);
  drawLogo(ctx, W / 2, H - footH / 2 + 3.2 * MM * 0.36, 3.2 * MM);
  // Trait de découpe
  ctx.strokeStyle = "#bbb";
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 10]);
  ctx.strokeRect(1, 1, W - 2, H - 2);
  return c;
}

/* ---------- Fond d'écran (écran de verrouillage) ---------- */
function drawWallpaper(plan) {
  const W = 1170;
  const H = 2532;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  // Fond noir avec halo rose
  ctx.fillStyle = "#15291F";
  ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(W * 0.8, H * 0.1, 0, W * 0.8, H * 0.1, W);
  g.addColorStop(0, accentRgba(0.35));
  g.addColorStop(1, accentRgba(0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W * 0.1, H * 0.95, 0, W * 0.1, H * 0.95, W * 0.9);
  g.addColorStop(0, accentRgba(0.22, ACCENT2));
  g.addColorStop(1, accentRgba(0, ACCENT2));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Le haut reste libre pour l'heure de l'écran de verrouillage
  const m = 80;
  let y = 860;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = "700 46px Inter";
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.fillText(fitText(ctx, plan.name, W - 2 * m), m, y);
  y += 70;
  ctx.font = "800 150px Syne";
  const tg = ctx.createLinearGradient(m, 0, m + 700, 0);
  tg.addColorStop(0, PINK);
  tg.addColorStop(1, ACCENT2);
  ctx.fillStyle = tg;
  ctx.fillText(fmtTime(plan.time), m, y);
  y += 180;
  ctx.font = "500 38px Inter";
  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.fillText(plan.info.join(" · "), m, y, W - 2 * m);
  y += 90;

  // Passages en colonnes
  const rows = plan.splits;
  const cols = rows.length <= 14 ? 1 : rows.length <= 30 ? 2 : rows.length <= 48 ? 3 : 4;
  const perCol = Math.ceil(rows.length / cols);
  const gap = 28;
  const colW = (W - 2 * m - gap * (cols - 1)) / cols;
  const rowH = Math.min(72, (H - y - 200) / perCol);
  const size = Math.min(40, rowH * 0.56);
  for (let col = 0; col < cols; col++) {
    const x0 = m + col * (colW + gap);
    rows.slice(col * perCol, (col + 1) * perCol).forEach((s, i) => {
      const ry = y + i * rowH;
      if (s.section) {
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.font = `800 ${size * 0.8}px Inter`;
        ctx.fillStyle = PINK;
        ctx.fillText(s.section, x0 + 6, ry + rowH / 2);
        return;
      }
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,.03)" : "rgba(255,255,255,.07)";
      ctx.beginPath();
      ctx.roundRect(x0, ry + 2, colW, rowH - 4, 12);
      ctx.fill();
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.font = `700 ${size}px Inter`;
      ctx.fillStyle = s.finish ? PINK : "rgba(255,255,255,.65)";
      ctx.fillText(s.label, x0 + 18, ry + rowH / 2);
      const mark = gradeMark(s.grade);
      if (mark) {
        ctx.font = `700 ${size * 0.6}px Inter`;
        ctx.fillStyle = gradeColor(s.grade, false);
        ctx.fillText(mark, x0 + 18 + size * 2.1, ry + rowH / 2);
      }
      ctx.textAlign = "right";
      ctx.font = `800 ${size}px Inter`;
      ctx.fillStyle = s.finish ? PINK : "#ffffff";
      ctx.fillText(fmtTime(s.cum), x0 + colW - 18, ry + rowH / 2);
    });
  }

  // Logo en bas
  drawLogo(ctx, W / 2, H - 110, 56);
  return c;
}

/* ---------- Fenêtre ---------- */
const slug = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "parcours";
const bandFiles = {};

let bandPlan = null;
async function openBand(plan) {
  if (!plan) return;
  await Promise.all([document.fonts.load('italic 900 44px "Exo 2"'), bandLogoReady]); // police et boucle du logo, avant de dessiner
  bandPlan = plan;
  const band = drawBand(plan);
  const wall = drawWallpaper(plan);
  for (const [key, canvas] of [["band", band], ["wall", wall]]) {
    const prev = $(key === "band" ? "bandPreview" : "wallPreview");
    prev.innerHTML = "";
    canvas.className = "band-canvas";
    prev.append(canvas);
    bandFiles[key] = canvas;
  }
  $("bandSize").textContent = `${BAND_WIDTH_MM * (band.width > BAND_WIDTH_MM * MM + 1 ? 2 : 1)} × ${Math.round(band.height / MM)} mm`;
  if (!$("bandModal").open) $("bandModal").showModal(); // déjà ouverte : on redessine seulement
}

function downloadCanvas(canvas, name) {
  canvas.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/png");
}

// Impression à la taille réelle (35 mm de large) via une page invisible
function printBand() {
  const canvas = bandFiles.band;
  const widthMm = canvas.width / MM;
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><title>Bracelet d'allure</title><style>
    @page { margin: 10mm; } body { margin: 0; }
    img { width: ${widthMm.toFixed(1)}mm; display: block; }
    p { font: 9pt sans-serif; color: #666; }
  </style></head><body><img src="${canvas.toDataURL("image/png")}"><p>Imprimer à 100 % (taille réelle), découper le long des pointillés.</p></body></html>`);
  doc.close();
  frame.contentWindow.onafterprint = () => frame.remove();
  doc.querySelector("img").onload = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
}

$("bandClose").addEventListener("click", () => $("bandModal").close());
$("bandModal").addEventListener("click", (e) => { if (e.target === $("bandModal")) $("bandModal").close(); });
$("bandDownload").addEventListener("click", () => downloadCanvas(bandFiles.band, `bracelet-${slug(bandPlan.name)}.png`));
$("bandPrint").addEventListener("click", printBand);
$("wallDownload").addEventListener("click", () => downloadCanvas(bandFiles.wall, `fond-ecran-${slug(bandPlan.name)}.png`));
