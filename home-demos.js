// =========================================================
// Mini-démos animées des cartes outils de l'accueil.
// Chaque carte montre l'outil comme si on l'utilisait : un petit
// écran, un curseur qui clique, et une phrase par étape.
// Les animations ne tournent que quand la carte est visible ;
// avec « réduire les animations », on affiche une image fixe.
// =========================================================
(function homeDemos() {
  const visuals = document.querySelectorAll("[data-demo]");
  if (!visuals.length) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";

  // ---------- Outils communs ----------
  const L = (a, b, t) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  const show = (el, v) => { el.style.opacity = v; };
  const at = (el, x, y) => { el.style.left = x / 3.2 + "%"; el.style.top = y / 2 + "%"; };
  const dash = (p, f) => { const n = p.getTotalLength(); p.style.strokeDasharray = n; p.style.strokeDashoffset = n * (1 - f); };
  const fadeOut = (t) => 1 - L(0.94, 1, t);
  const fmt = (s) => {
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0");
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + x : m + ":" + x;
  };
  const CURSOR = `<svg class="h-demo__cur" data-k="cur" viewBox="0 0 16 22"><path d="M1 1 L1 17 L5 13 L8 20 L11 19 L8 12 L14 12 Z" fill="#fff" stroke="#15291F" stroke-width="1.2"/></svg><div class="h-demo__ripple" data-k="rip"></div>`;

  // Curseur : liste de [t, x, y] dans le repère 320 × 200, déplacement doux d'une étape à l'autre
  function cursor(el, way, t) {
    let i = 0;
    while (i < way.length - 1 && t > way[i + 1][0]) i++;
    const a = way[i], b = way[Math.min(i + 1, way.length - 1)];
    const k = b === a ? 0 : ease(L(a[0], b[0], t));
    at(el, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
  }
  // Cercle qui s'agrandit à chaque clic
  function ripple(el, clicks, t, per) {
    let hit = null;
    for (const c of clicks) { const d = (t - c[0]) * per; if (d >= 0 && d < 500) hit = [c, d]; }
    if (!hit) { el.style.opacity = 0; return; }
    const k = hit[1] / 500;
    at(el, hit[0][1], hit[0][2]);
    el.style.opacity = 1 - k;
    el.style.transform = "scale(" + (0.4 + k) + ")";
  }
  // Phrase d'explication de l'étape en cours
  function caption(root, steps, t) {
    let i = 0;
    steps.forEach((st, j) => { if (t >= st[0]) i = j; });
    root.step.textContent = i + 1 + "/" + steps.length;
    if (root.txt.textContent !== steps[i][1]) root.txt.textContent = steps[i][1];
  }
  // Position d'un élément dans le repère 320 × 200 de la scène
  const spot = (el, scene) => {
    const r = el.getBoundingClientRect(), s = scene.getBoundingClientRect();
    return [((r.left + r.width / 2 - s.left) / s.width) * 320, ((r.top + r.height / 2 - s.top) / s.height) * 200];
  };

  // ---------- Parcours ----------
  const parcours = {
    period: 11000,
    still: 0.86,
    html: `
      <svg class="h-demo__bg" viewBox="0 0 320 200">
        <path d="M200 130 h70 v60 h-70z" class="h-demo__park"/>
        <path class="h-demo__road" d="M0 140H320M90 0V200M0 90H320M210 0V200M250 0V200"/>
        <path class="h-demo__street" d="M0 40H320M0 175H200M150 0V200M40 0V200M290 0V200"/>
        <path data-k="route" class="h-demo__route" d="M50 140 H90 V90 H210 V140 H250" stroke-linejoin="round"/>
        <g data-k="pts" class="h-demo__pt"></g>
      </svg>
      <div class="h-demo__abs" data-k="stats" style="left:3%;top:5%;display:flex;gap:6px">
        <div class="h-demo__chip">Distance<b data-k="km">0,0 km</b></div><div class="h-demo__chip">Dénivelé<b>186 m</b></div><div class="h-demo__chip">Durée<b>1 h 02</b></div>
      </div>
      <div class="h-demo__abs h-demo__btn" data-k="btn" style="right:3%;bottom:6%">⬇ Export GPX</div>
      <div class="h-demo__abs h-demo__chip h-demo__ok" data-k="ok" style="right:3%;bottom:24%">✓ Fichier prêt pour ta montre</div>`,
    setup(q) {
      this.P = [[50, 140], [90, 90], [210, 90], [250, 140]];
      this.cum = [0, 90, 210, 300]; // longueur du tracé jusqu'à chaque point
      this.P.forEach((p) => {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", p[0]); c.setAttribute("cy", p[1]); c.setAttribute("r", 5);
        q("pts").appendChild(c);
      });
    },
    update(q, root, t, per) {
      const f = fadeOut(t);
      const clicks = [[0.08, 50, 140], [0.18, 90, 90], [0.28, 210, 90], [0.38, 250, 140], [0.78, 282, 182]];
      cursor(q("cur"), [[0, 160, 40], [0.07, 50, 140], [0.17, 90, 90], [0.27, 210, 90], [0.37, 250, 140], [0.5, 250, 140], [0.72, 282, 182], [0.9, 282, 182], [1, 160, 40]], t);
      ripple(q("rip"), clicks, t, per);
      let k = -1;
      clicks.slice(0, 4).forEach((c, i) => { if (t >= c[0]) k = i; });
      [...q("pts").children].forEach((c, i) => show(c, i <= k ? f : 0));
      let len = 0;
      if (k >= 1) len = this.cum[k - 1] + (this.cum[k] - this.cum[k - 1]) * L(clicks[k][0], clicks[k][0] + 0.04, t);
      dash(q("route"), len / 300);
      show(q("route"), f);
      show(q("stats"), L(0.44, 0.48, t) * f);
      q("km").textContent = (12.4 * L(0.45, 0.6, t)).toFixed(1).replace(".", ",") + " km";
      show(q("btn"), L(0.6, 0.64, t) * f);
      q("btn").style.transform = t > 0.78 && t < 0.8 ? "scale(.92)" : "none";
      show(q("ok"), L(0.8, 0.83, t) * f);
      show(q("cur"), f);
      caption(root, [[0, "Clique sur la carte : le tracé suit les rues"], [0.44, "La distance, le dénivelé et la durée se calculent seuls"], [0.6, "Télécharge le parcours pour ta montre (GPX)"]], t);
    },
  };

  // ---------- Séance → boucle ----------
  const seance = {
    period: 12000,
    still: 0.9,
    text: "15' échauffement\n6 × 400 m, récup 1'30\n10' retour au calme",
    html: `
      <svg class="h-demo__bg" viewBox="0 0 320 200">
        <g data-k="map">
          <path class="h-demo__road" d="M0 60H320M0 150H320M70 0V200M180 0V200M270 0V200"/>
          <path data-k="route" class="h-demo__route" d="M180 172 C120 172 96 140 112 108 S100 52 160 44 S262 40 268 96 S258 172 180 172Z"/>
          <circle cx="180" cy="172" r="7" class="h-demo__pt" data-k="start"/>
        </g>
      </svg>
      <div class="h-demo__abs" data-k="form" style="left:5%;top:7%;right:5%">
        <div class="h-demo__lab">Colle ta séance ici</div>
        <div class="h-demo__field h-demo__ta" data-k="ta"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px">
          <div data-k="blocks" style="display:flex;gap:2px;flex:1"></div>
          <div class="h-demo__btn" data-k="btn">Créer ma boucle</div>
        </div>
        <div class="h-demo__res" data-k="res">Total : <b>7,1 km</b> · environ <b>52 min</b></div>
      </div>
      <div class="h-demo__abs h-demo__chip" data-k="lab" style="left:4%;top:6%">Boucle<b>7,1 km</b></div>
      <div class="h-demo__abs h-demo__chip h-demo__ok" data-k="dep" style="left:40%;top:72%">Départ et arrivée chez toi</div>`,
    setup(q) {
      // échauffement, 6 efforts et 6 récups, retour au calme
      const kinds = ["warm", ..."he".repeat(6).split("").map((c) => (c === "h" ? "hard" : "easy")), "warm"];
      kinds.forEach((kind, i) => {
        const d = document.createElement("div");
        d.className = "h-demo__blk h-demo__blk--" + kind;
        d.style.flex = i === 0 ? 30 : i === kinds.length - 1 ? 22 : kind === "hard" ? 9 : 7;
        q("blocks").appendChild(d);
      });
    },
    update(q, root, t, per) {
      const f = fadeOut(t);
      q("ta").textContent = this.text.slice(0, Math.round(this.text.length * L(0.02, 0.3, t)));
      show(q("btn"), L(0.3, 0.33, t));
      q("btn").style.transform = t > 0.4 && t < 0.42 ? "scale(.92)" : "none";
      const pb = spot(q("btn"), root.scene);
      cursor(q("cur"), [[0, 160, 190], [0.32, 160, 190], [0.39, pb[0], pb[1]], [0.5, pb[0], pb[1]], [0.56, 330, 210], [1, 330, 210]], t);
      ripple(q("rip"), [[0.4, pb[0], pb[1]]], t, per);
      [...q("blocks").children].forEach((d, i) => show(d, L(0.43 + i * 0.006, 0.45 + i * 0.006, t)));
      show(q("res"), L(0.5, 0.53, t));
      show(q("form"), 1 - L(0.6, 0.64, t));
      show(q("map"), L(0.62, 0.66, t) * f);
      dash(q("route"), L(0.65, 0.88, t));
      show(q("lab"), L(0.7, 0.73, t) * f);
      show(q("dep"), L(0.86, 0.89, t) * f);
      show(q("cur"), 1 - L(0.5, 0.55, t));
      caption(root, [[0, "Colle la séance donnée par ta montre, ton appli ou ton coach"], [0.43, "Loopace la comprend : distance totale et durée"], [0.62, "Il trace une boucle de la bonne longueur, qui revient chez toi"]], t);
    },
  };

  // ---------- Allure ----------
  const allure = {
    period: 13000,
    still: 0.36,
    rows: [["1 km", 1], ["5 km", 5], ["10 km", 10], ["Semi", 21.0975]],
    html: `
      <div class="h-demo__abs" style="left:5%;right:5%;top:7%">
        <div style="display:flex;gap:8px;align-items:flex-end">
          <div style="flex:1"><div class="h-demo__lab">Distance</div><div class="h-demo__field" data-k="d">&nbsp;</div></div>
          <div style="flex:1"><div class="h-demo__lab">Temps visé</div><div class="h-demo__field" data-k="t">&nbsp;</div></div>
          <div class="h-demo__btn" data-k="btn">Calculer</div>
        </div>
        <div class="h-demo__slider" data-k="sl"><i></i><i data-k="fill"></i><span data-k="thumb"></span></div>
        <div class="h-demo__allure" data-k="res">
          <div><div class="h-demo__lab">Ton allure</div><b data-k="pace">4:30</b> <span class="h-demo__lab">/km</span></div>
          <div class="h-demo__tab" data-k="tab"></div>
        </div>
      </div>`,
    setup(q) {
      this.rows.forEach(([n]) => {
        const a = document.createElement("span"); a.textContent = n;
        q("tab").append(a, document.createElement("b"));
      });
    },
    update(q, root, t, per) {
      const ds = "10 km";
      q("d").textContent = ds.slice(0, Math.round(ds.length * L(0.04, 0.1, t))) || " ";
      // temps visé : 45:00 tapé, puis glissé vers 40:00, 50:00 et retour
      let T = 2700;
      if (t > 0.5) T = 2700 - 300 * ease(L(0.5, 0.62, t)) + 600 * ease(L(0.64, 0.78, t)) - 300 * ease(L(0.8, 0.9, t));
      q("t").textContent = t < 0.12 ? " " : t < 0.2 ? "45:00".slice(0, Math.round(5 * L(0.12, 0.2, t))) || " " : fmt(T);
      const k = (T - 2100) / 1200;
      q("thumb").style.left = k * 100 + "%";
      q("fill").style.width = k * 100 + "%";
      show(q("sl"), L(0.42, 0.46, t));
      show(q("btn"), 1 - L(0.42, 0.46, t));
      q("btn").style.transform = t > 0.24 && t < 0.26 ? "scale(.92)" : "none";
      show(q("res"), L(0.26, 0.29, t));
      q("pace").textContent = fmt(T / 10);
      [...q("tab").children].forEach((el, i) => {
        const row = Math.floor(i / 2);
        show(el, L(0.28 + row * 0.03, 0.3 + row * 0.03, t));
        if (i % 2) el.textContent = fmt((T / 10) * this.rows[row][1]);
      });
      const sc = root.scene, pd = spot(q("d"), sc), pt = spot(q("t"), sc), pb = spot(q("btn"), sc), ph = spot(q("thumb"), sc);
      let way = [[0, 200, 195], [0.03, pd[0], pd[1]], [0.1, pd[0], pd[1]], [0.12, pt[0], pt[1]], [0.2, pt[0], pt[1]], [0.23, pb[0], pb[1]], [0.3, pb[0], pb[1]], [0.4, 250, 190], [0.47, ph[0], ph[1] + 4]];
      if (t > 0.47) way = [[0, ph[0], ph[1] + 4], [1, ph[0], ph[1] + 4]];
      if (t > 0.92) way = [[0.92, ph[0], ph[1] + 4], [1, 200, 195]];
      cursor(q("cur"), way, t);
      ripple(q("rip"), [[0.04, pd[0], pd[1]], [0.12, pt[0], pt[1]], [0.24, pb[0], pb[1]]], t, per);
      caption(root, [[0, "Entre ta distance et ton temps visé : ton allure et tes temps de passage s’affichent"], [0.44, "Change ton objectif : tout se recalcule en direct"]], t);
    },
  };

  // ---------- Bracelet et vidéo 3D, sur téléphone ----------
  const partage = {
    period: 12000,
    still: 0.3,
    html: `
      <svg class="h-demo__bg" viewBox="0 0 320 200">
        <defs><clipPath id="hDemoPhone"><rect x="40" y="16" width="92" height="168" rx="10"/></clipPath></defs>
        <rect x="34" y="6" width="104" height="188" rx="16" fill="#0b1510" stroke="rgba(127,140,130,.5)"/>
        <g clip-path="url(#hDemoPhone)" font-family="inherit">
          <g data-k="s1">
            <rect x="40" y="16" width="92" height="168" fill="#e9efdd"/>
            <rect x="50" y="24" width="72" height="152" rx="4" fill="#fff" stroke="#c9d3bd"/>
            <text x="86" y="37" text-anchor="middle" font-size="7" font-weight="700" fill="#15291F">10 km · 45:00</text>
            <g data-k="rows" font-size="7" fill="#15291F"></g>
          </g>
          <g data-k="s2">
            <rect x="40" y="16" width="92" height="168" fill="#15291F"/>
            <rect x="46" y="22" width="38" height="2" rx="1" fill="#B7E532"/><rect x="88" y="22" width="38" height="2" rx="1" fill="rgba(247,250,239,.3)"/>
            <rect data-k="bar2" x="88" y="22" width="0" height="2" rx="1" fill="#B7E532"/>
            <path d="M40 120 L60 104 L80 112 L100 92 L120 106 L132 100 L132 184 L40 184Z" fill="rgba(247,250,239,.06)"/>
            <path data-k="vr" fill="none" stroke="#B7E532" stroke-width="2.5" stroke-linecap="round"/>
            <circle data-k="vdot" r="3.5" fill="#F7FAEF"/>
            <text x="48" y="44" font-size="13" font-weight="700" fill="#F7FAEF" data-k="vkm">0,0 km</text>
            <text x="48" y="56" font-size="8" fill="#a9b7a6" data-k="vdp">D+ 0 m</text>
            <text x="86" y="176" text-anchor="middle" font-size="8" font-weight="700" fill="#B7E532">Loopace</text>
          </g>
        </g>
        <circle data-k="touch" r="9" fill="rgba(247,250,239,.35)" stroke="#F7FAEF" stroke-width="1.5"/>
      </svg>
      <div class="h-demo__abs h-demo__side" data-k="l1">
        <strong>Bracelet d'allure</strong>
        <p>Tes temps de passage, à imprimer ou à garder en image sur ton téléphone.</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><span class="h-demo__btn">Imprimer</span><span class="h-demo__btn h-demo__btn--ghost">Enregistrer</span></div>
      </div>
      <div class="h-demo__abs h-demo__side" data-k="l2">
        <strong>Vidéo 3D</strong>
        <p>Ta sortie survolée en 3D, au format story, avec la distance et le dénivelé.</p>
        <span class="h-demo__btn">Partager en story ↗</span>
      </div>`,
    setup(q) {
      for (let i = 1; i <= 10; i++) {
        const y = 52 + (i - 1) * 12.2;
        const g = document.createElementNS(NS, "g");
        const a = document.createElementNS(NS, "text");
        a.setAttribute("x", 57); a.setAttribute("y", y); a.textContent = "km " + i;
        const b = document.createElementNS(NS, "text");
        b.setAttribute("x", 115); b.setAttribute("y", y); b.setAttribute("text-anchor", "end"); b.setAttribute("font-weight", "700");
        b.textContent = fmt(270 * i);
        g.append(a, b);
        q("rows").appendChild(g);
      }
      let d = "";
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * Math.PI * 2, k = 1 + 0.15 * Math.sin(3 * a + 0.5);
        d += (i ? " L" : "M") + (86 + 36 * k * Math.cos(a)).toFixed(1) + " " + (132 + 16 * k * Math.sin(a)).toFixed(1);
      }
      q("vr").setAttribute("d", d + "Z");
      q("cur").remove();
      q("rip").remove();
    },
    update(q, root, t) {
      const f = fadeOut(t);
      [...q("rows").children].forEach((g, i) => show(g, L(0.04 + i * 0.025, 0.06 + i * 0.025, t)));
      const sw = ease(L(0.44, 0.52, t));
      q("s1").setAttribute("transform", "translate(" + -92 * sw + " 0)");
      q("s2").setAttribute("transform", "translate(" + 92 * (1 - sw) + " 0)");
      show(q("touch"), t > 0.4 && t < 0.53 ? 1 : 0);
      q("touch").setAttribute("cx", 120 - 60 * L(0.42, 0.52, t));
      q("touch").setAttribute("cy", 110);
      const v = L(0.54, 0.92, t), p = q("vr");
      q("bar2").setAttribute("width", 38 * v);
      dash(p, v);
      const pt = p.getPointAtLength(p.getTotalLength() * v);
      q("vdot").setAttribute("cx", pt.x); q("vdot").setAttribute("cy", pt.y);
      q("vkm").textContent = (12.4 * v).toFixed(1).replace(".", ",") + " km";
      q("vdp").textContent = "D+ " + Math.round(186 * v) + " m";
      show(q("l1"), 1 - L(0.44, 0.48, t));
      show(q("l2"), L(0.5, 0.54, t) * f);
      caption(root, [[0, "Ton bracelet avec tes temps au km, à imprimer ou en image sur ton téléphone"], [0.46, "La vidéo 3D de ta sortie, prête à partager en story"]], t);
    },
  };

  const DEMOS = { parcours, seance, allure, partage };

  // ---------- Mise en place ----------
  const live = [];
  visuals.forEach((vis) => {
    const demo = DEMOS[vis.dataset.demo];
    if (!demo) return;
    vis.classList.add("h-demo");
    vis.innerHTML = `<div class="h-demo__screen"><div class="h-demo__scene">${demo.html}${CURSOR}</div>
      <div class="h-demo__bar"><span class="h-demo__step">1/1</span><span class="h-demo__txt"></span></div></div>`;
    const scene = vis.querySelector(".h-demo__scene");
    const q = (k) => scene.querySelector(`[data-k="${k}"]`);
    const root = { scene, step: vis.querySelector(".h-demo__step"), txt: vis.querySelector(".h-demo__txt"), visible: false };
    demo.setup(q);
    const item = { demo, q, root };
    live.push(item);
    if (reduce) {
      if (q("cur")) q("cur").style.display = "none";
      demo.update(q, root, demo.still, demo.period);
    }
  });
  if (reduce) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const item = live.find((it) => it.root.scene.closest("[data-demo]") === e.target);
      if (item) item.root.visible = e.isIntersecting;
    });
  }, { threshold: 0.15 });
  visuals.forEach((v) => io.observe(v));

  function frame(now) {
    if (!document.hidden) {
      live.forEach(({ demo, q, root }) => {
        if (root.visible) demo.update(q, root, (now % demo.period) / demo.period, demo.period);
      });
    }
    requestAnimationFrame(frame);
  }
  // Première image tout de suite, avant même que la carte soit visible
  live.forEach(({ demo, q, root }) => demo.update(q, root, 0, demo.period));
  requestAnimationFrame(frame);
})();
