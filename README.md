# My Personal Trainer

PWA personale per seguire fitness e yoga facciale con timer, voce, guide illustrate e modifica locale delle routine. La homepage permette di scegliere la pratica; il calendario raccoglie entrambe.

Ogni esercizio ha istruzioni specifiche con posizione iniziale, esecuzione numerata, respirazione ed errori da evitare. I tre livelli cambiano il carico concreto della sessione: l’avanzato mantiene la routine originale e i tempi impostati; il principiante usa circa il 30% di esercizi centrali in meno e 2/3 del tempo per esercizio; l’esperto aggiunge circa il 30% di esercizi centrali e usa 4/3 del tempo. Con la base di 30 secondi i tempi sono 20/30/40 secondi. Riscaldamento, defaticamento, giri e recuperi fitness non vengono tagliati; le coppie destra/sinistra restano complete. Il confronto prima dell’avvio mostra conteggi e tempi totali effettivi, compresi passaggi e recuperi. Le modifiche personali della routine restano la base avanzata e non vengono sovrascritte cambiando livello.

Lo yoga facciale segue lo stesso criterio di numero di gesti e tempo complessivo, con una sola sequenza e un conteggio gesto/rilascio. Il tempo cambia attraverso la durata dei massaggi e il numero di ripetizioni, senza aumentare le tenute oculari, ridurre i rilasci o aumentare la pressione. Nel player si può mettere in pausa e leggere la guida completa. I vecchi livelli basati sulle varianti migrano una volta all’avanzato, conservando tempi e storico.

Le due routine facciali sono adattate dalle schede fornite: gli esercizi intorno agli occhi usano contatti leggeri sui bordi ossei, senza pressione sul bulbo o trazione delle palpebre; il bacio mantiene il collo neutro. Non sono trattamenti della ptosi. Provenienza, adattamenti e riferimenti sono registrati in `data/face-yoga.json`.

## Conservazione dello storico

La chiave originale `fitTimer.sessions` è mantenuta tra le versioni. Non esiste più il limite di 500 sessioni. All’avvio si uniscono e deduplicano lo storico originale, `fitTimer.sessionsBackup` e la copia in IndexedDB (`fitTimer.history`, archivio `sessions`). Gli errori di salvataggio vengono segnalati; il service worker aggiorna soltanto le cache dell’app, senza cancellare dati personali.

La precache forza anche il rinnovo della cache HTTP: cambiare soltanto il nome della cache PWA poteva conservare file JS/JSON della release precedente. Le letture usano soltanto la cache della release attiva; tutte le immagini di entrambe le pratiche vengono precaricate per l’uso offline. Le navigazioni a pagine diverse dalla home non sovrascrivono la shell offline.

Da **Calendario → Backup e ripristino** si esportano e importano storico, impostazioni, livelli e routine personalizzate. Il ripristino unisce le sessioni per ID e conserva quelle già presenti; mostra un’anteprima prima di applicare impostazioni e routine. La versione dello schema del backup è indipendente dalla versione della PWA.

Un aggiornamento sullo stesso indirizzo e browser conserva i dati. Passare da localhost a GitHub Pages, cambiare browser/telefono o usare una diversa installazione può mostrare archivi separati: esportare prima dalla vecchia installazione e importare nella nuova. La cancellazione dei dati del sito rimuove anche le copie locali: serve un backup esterno. La richiesta di storage persistente aiuta quando supportata, ma non sostituisce il backup. La sincronizzazione cloud non è inclusa.

Le impostazioni permettono di distinguere la durata degli esercizi di riscaldamento, allenamento e defaticamento, la preparazione, le pause tra esercizi e il recupero tra giri. Le vecchie durate salvate vengono migrate automaticamente.

La guida vocale supporta scelta della voce italiana e inglese, velocità e tonalità, con un esempio da ascoltare. Skip, indietro, pausa e uscita interrompono la lettura corrente. Il nuovo giro viene annunciato dopo il recupero, all'inizio della preparazione del primo esercizio; con preparazione a zero, all'inizio dell'esercizio. Pronuncia e qualità dipendono dalle voci del dispositivo.

Le 62 guide fitness sono state riviste il 25/10/2026: appoggi, traiettoria, ritorno, respirazione e compensi specifici. Il JSON include 41 riferimenti consultabili nelle schede e note esplicite per i nomi non standard e le combinazioni adattate. Le fonti sostengono la tecnica, non le dosi del programma. Lo stretching dei bicipiti femorali da seduto usa entrambe le gambe davanti e un’inclinazione dalle anche; la variante a una gamba non viene più mescolata alla figura bilaterale. La mobilità dei gomiti distingue piegamento/distensione dalla rotazione degli avambracci.

Con **Guida vocale esercizi** attiva, la voce dà gli appoggi nella preparazione e il movimento al via. La preparazione si allunga quando necessario, includendo la stima nel totale; il lavoro conserva i secondi del livello. Una voce lenta o un intervallo breve anticipa la spiegazione lunga nella preparazione e usa una frase breve durante il lavoro. Un piccolo margine gestisce voci più lente della stima; il countdown non interrompe le indicazioni. I cambi lato/direzione sono annunciati a metà negli esercizi che li richiedono; quelli già divisi in destra/sinistra restano sul lato indicato. La guida è attiva nelle nuove impostazioni, mentre le scelte vocali già salvate restano rispettate. Dalla routine si può attivarla o disattivarla direttamente. Con preparazione a zero non vengono aggiunti passaggi: ascoltare prima la scheda.

**Ascolta la guida completa** legge posizione, tutti i passaggi e respirazione dalla scheda o dalla guida in pausa del player; **Ferma voce** interrompe. Le spiegazioni restano disponibili offline; i link alle fonti richiedono rete. La qualità della tecnica descritta non equivale a una valutazione individuale da parte di un professionista.

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

I test coprono sequenza delle fasi e dei giri, durate, migrazione delle impostazioni e dello storico, recupero da IndexedDB/copia locale, import senza duplicati, errori di spazio, dosi facciali, separazione delle pratiche, guide per i tre livelli e cache offline di tutti gli asset. L'ascolto effettivo va verificato anche sul telefono.

Le immagini restano nello stile fumetto PNG originale, comprese le illustrazioni della home. Le pose prone corrette sono salvate in file `*-corrected.png`, separati dagli originali. I nuovi gesti facciali sono in `assets/exercises/face-*.png`. Le immagini vengono create con ImageGen usando i PNG originali come riferimento; prompt, file scelti e controllo visivo sono documentati in `data/illustration-artwork.json`.

## Pubblicazione con GitHub Pages

Questo progetto è statico: `index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`, `data/`, `assets/` e `icons/` bastano per pubblicarlo.

Non pubblicare il video originale, i frame estratti o il JSON OCR grezzo: sono esclusi da `.gitignore`.
