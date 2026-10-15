# My Personal Trainer

PWA personale per seguire routine fitness con timer, voce, immagini esercizio e modifica locale delle routine.

Le impostazioni permettono di distinguere la durata degli esercizi di riscaldamento, allenamento e defaticamento, la preparazione, le pause tra esercizi e il recupero tra giri. Le vecchie durate salvate vengono migrate automaticamente.

La guida vocale supporta scelta della voce italiana e inglese, velocità e tonalità, con un esempio da ascoltare. Skip, indietro, pausa e uscita interrompono la lettura corrente. Il nuovo giro viene annunciato dopo il recupero, all'inizio della preparazione del primo esercizio; con preparazione a zero, all'inizio dell'esercizio. Pronuncia e qualità dipendono dalle voci del dispositivo.

## Avvio locale

```bash
python3 -m http.server 5173
```

Poi apri:

```text
http://127.0.0.1:5173/
```

## Verifiche

Non servono dipendenze aggiuntive; con Node.js:

```bash
node --check app.js
node --check sw.js
node --test tests/*.test.cjs
```

I test coprono sequenza delle fasi e dei giri, durate, migrazione delle impostazioni, pausa/ripresa, interruzione delle letture obsolete e cache offline. L'ascolto effettivo va verificato anche sul telefono.

## Pubblicazione con GitHub Pages

Questo progetto è statico: `index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`, `data/`, `assets/` e `icons/` bastano per pubblicarlo.

Non pubblicare il video originale, i frame estratti o il JSON OCR grezzo: sono esclusi da `.gitignore`.
