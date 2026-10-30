# Manaen — interface (téléphone et ordinateur)

Assistant pro de Franck : génie climatique, froid, plomberie, bâtiment, enseignement.

- **Ordinateur** : https://manaen46.github.io/manaen-web/ puis « Installer » dans Chrome ou Edge.
- **Téléphone** : l'appli Android (dépôt privé `Manaen`) embarque exactement ces mêmes fichiers.

La clé API, la mémoire, les documents et les discussions restent sur l'appareil : rien n'est stocké sur GitHub.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `index.html`, `app.css` | Page et apparence |
| `js/markdown.js` | Affichage des réponses (Markdown) |
| `js/files.js` | Fabrication des fichiers Excel (avec formules), Word et PDF |
| `js/core.js` | Réglages fixes (modèles, catégories…), petits outils, accès au téléphone |
| `js/store.js` | Stockage : réglages, mémoire, documents et recherche, discussions, sauvegarde |
| `js/api.js` | Appels au cerveau (API Claude) et messages d'erreur |
| `js/brain.js` | Consignes de Manaen, outils, déroulé complet d'une réponse |
| `js/ingest.js` | Lecture des PDF, scans, photos et fichiers texte |
| `js/voice.js` | Dictée et lecture à voix haute |
| `js/ui.js` | Interface : discussion, mémoire, documents, réglages |
| `js/main.js` | Démarrage |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installation sur ordinateur et fonctionnement hors ligne |
