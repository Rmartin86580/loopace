@echo off
rem Lance le site Loopace en local puis l'ouvre dans le navigateur.
rem Ferme cette fenetre pour arreter le serveur.
cd /d "%~dp0"
start "" http://localhost:5500
python -m http.server 5500
