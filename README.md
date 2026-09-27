# My Personal Trainer

PWA personale per seguire routine fitness con timer, voce, immagini esercizio e modifica locale delle routine.

## Avvio locale

```bash
python3 -m http.server 5173
```

Poi apri:

```text
http://127.0.0.1:5173/
```

## Pubblicazione con GitHub Pages

Questo progetto è statico: `index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`, `data/`, `assets/` e `icons/` bastano per pubblicarlo.

Non pubblicare il video originale, i frame estratti o il JSON OCR grezzo: sono esclusi da `.gitignore`.
