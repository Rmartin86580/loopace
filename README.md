# Loopace

Outils gratuits pour les coureurs et triathlètes : parcours, allure, séance → boucle, triathlon. Site 100 % statique en HTML/CSS/JS (aucune installation, aucun serveur).

| Fichier | Rôle |
|---|---|
| `index.html` | Page d'accueil : présentation de l'outil, fonctionnalités, « Bientôt » |
| `parcours.html` / `parcours.js` / `parcours.css` | Créateur de parcours de course à pied (carte) |
| `video.js` | Vidéo de survol 3D du parcours (MP4) |
| `allure.html` / `allure.js` / `allure.css` | Calculateur d'allure (course, natation, vélo) + prédiction de chronos |
| `triathlon.html` / `triathlon.js` / `triathlon.css` | Planificateur triathlon (objectif global, passages au km, ravitaillement, fiche jour de course, lien de partage) |
| `seance.html` / `seance.js` / `seance.css` | Séance → boucle : lit une séance (Garmin, Coros, Polar, TrainingPeaks, intervals.icu, Runna…) et trace une boucle de la bonne longueur |
| `band.js` | Bracelet d'allure à imprimer et fond d'écran (pages Allure et Triathlon) |
| `styles.css` | DA noir & rose commune |
| `assets/` | Logo, favicon |

## Mettre le site en ligne (GitHub Pages)

Dépôt public → Settings → Pages → « Deploy from a branch » → branche `main`, dossier `/ (root)`.
Le site est alors disponible sur `https://<ton-pseudo>.github.io/<nom-du-depot>/`.

## Voir le site en local

```bash
python -m http.server 5500
```

Puis ouvrir http://localhost:5500

## Vidéo de survol 3D

Le bouton « Créer la vidéo du parcours » fabrique un MP4 (1920×1080 ou vertical
1080×1920) : survol 3D satellite avec relief, tracé rose qui se dessine, distance,
altitude et D+ qui défilent, puis une carte de fin avec les stats.

- Tout est calculé dans le navigateur, rien n'est envoyé en ligne. Gratuit, sans clé.
- Nécessite **Chrome ou Edge** à jour (encodage vidéo WebCodecs).
- Compter environ 10 s de calcul par seconde de vidéo ; garder la fenêtre au premier plan.
- Données : imagerie © Esri, relief © AWS Terrain Tiles (crédits incrustés dans la vidéo).
