// Nom du site, repris dans les vidéos, le bracelet, le GPX et les fichiers téléchargés
const BRAND = "Loopace";

// Logo en SVG intégré au code (copie de assets/logo-infinity.svg et assets/logo-loop.svg).
// Chargé en « data: », il peut être dessiné dans les vidéos et images exportées,
// même quand le site est ouvert en double-cliquant le fichier (file://).
const LOGO_INFINITY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 124 70" width="248" height="140"> <defs> <linearGradient id="infGrad" x1="0" y1="0" x2="1" y2="0"> <stop offset="0" stop-color="#fb0a72"/> <stop offset=".5" stop-color="#e805b7"/> <stop offset="1" stop-color="#8f01fb"/> </linearGradient> </defs> <path d="M62 36 C74 12 114 8 114 36 C114 64 74 60 62 36 C50 12 10 8 10 36 C10 64 50 60 62 36 Z" fill="none" stroke="url(#infGrad)" stroke-width="15" stroke-linejoin="round"/> <path d="M62 36 C74 12 114 8 114 36 C114 64 74 60 62 36 C50 12 10 8 10 36 C10 64 50 60 62 36 Z" fill="none" stroke="#ffffff" stroke-width="1.9" stroke-dasharray="4.2 3.6" stroke-linecap="round"/> <circle cx="100" cy="53" r="5.6" fill="#6c01d0" stroke="#ffffff" stroke-width="2"/> <path d="M21 2.5 C15.8 2.5 12 6.3 12 11.2 C12 17 21 25 21 25 C21 25 30 17 30 11.2 C30 6.3 26.2 2.5 21 2.5 Z" fill="#fc0c71" stroke="#ffffff" stroke-width="2"/> <circle cx="21" cy="11" r="3.4" fill="#ffffff"/> </svg>`;
const LOGO_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256"> <defs> <linearGradient id="icGrad" x1="0" y1="0" x2="1" y2="0"> <stop offset="0" stop-color="#fb0a72"/> <stop offset=".5" stop-color="#e805b7"/> <stop offset="1" stop-color="#8f01fb"/> </linearGradient> </defs> <rect width="64" height="64" rx="15" fill="#0b0b0c"/> <g transform="translate(4.5 15.5) scale(0.44)"> <path d="M62 36 C74 12 114 8 114 36 C114 64 74 60 62 36 C50 12 10 8 10 36 C10 64 50 60 62 36 Z" fill="none" stroke="url(#icGrad)" stroke-width="15" stroke-linejoin="round"/> <path d="M62 36 C74 12 114 8 114 36 C114 64 74 60 62 36 C50 12 10 8 10 36 C10 64 50 60 62 36 Z" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-dasharray="4.2 3.6" stroke-linecap="round"/> <circle cx="100" cy="53" r="5.6" fill="#6c01d0" stroke="#ffffff" stroke-width="2"/> <path d="M21 2.5 C15.8 2.5 12 6.3 12 11.2 C12 17 21 25 21 25 C21 25 30 17 30 11.2 C30 6.3 26.2 2.5 21 2.5 Z" fill="#fc0c71" stroke="#ffffff" stroke-width="2"/> <circle cx="21" cy="11" r="3.4" fill="#ffffff"/> </g> </svg>`;
function svgImage(svg) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

// Couleurs d'accent du thème (définies dans le CSS : styles.css, ou theme-logo.css s'il est chargé)
const rootStyle = getComputedStyle(document.documentElement);
const ACCENT = rootStyle.getPropertyValue("--pink").trim() || "#d885cc";
const ACCENT2 = rootStyle.getPropertyValue("--lilac").trim() || "#c98bef";
function accentRgba(alpha, hex = ACCENT) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Apparition des éléments au défilement
const observer = new IntersectionObserver(
  (entries) => entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add("is-visible");
      observer.unobserve(e.target);
    }
  }),
  { threshold: 0.15 }
);
document.querySelectorAll(".reveal").forEach((el, i) => {
  el.style.transitionDelay = `${(i % 4) * 80}ms`;
  observer.observe(el);
});

const year = document.getElementById("year");
if (year) year.textContent = new Date().getFullYear();

