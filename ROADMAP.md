# My Personal Trainer - Roadmap

## 1. Stabilizzazione player

- Contatore esercizi basato solo sugli esercizi reali.
- Fase preliminare da 10 secondi prima di ogni esercizio successivo.
- Messaggi finali motivazionali.
- Aggiornamento cache PWA a ogni modifica critica.

## 2. Libreria esercizi e guida esecuzione

- Libreria consultabile dalla home.
- Scheda dettaglio per ogni esercizio.
- Guide brevi con esecuzione, focus, errori da evitare, variante facile e cue vocale.
- Testi guida salvati in `data/exercise-guides.json`, separati dalla logica dell'app.
- Player mantenuto pulito: niente testi lunghi durante il timer.
- Rimando discreto alla guida dalle liste routine.

## 3. Cue vocali opzionali

- Impostazione separata per attivare/disattivare i suggerimenti vocali.
- Default disattivato, per evitare ripetitivita con la pratica.
- Possibile modalita futura: solo prime volte.

## 4. Storico sessioni e calendario locale

- Salvare allenamenti completati in localStorage.
- Vista calendario mensile.
- Dati minimi: data, routine, settimana, giorno, durata, esercizi completati.
- Primo MVP locale implementato con chiave `fitTimer.sessions`.
- Struttura pronta per futura sincronizzazione cloud.

## 5. Profilo e dati fisici locali

- Profilo base.
- Peso, misure, note giornaliere, energia o percezione dello sforzo.

## 6. Supabase, multiutente e sync

- Auth utente.
- Tabelle per profilo, routine personalizzate, sessioni, metriche e note.
- Row Level Security per isolare i dati per utente.
- Migrazione da localStorage a cloud/sync.

## 7. Grafici e trend

- Frequenza allenamenti.
- Completamenti settimanali e mensili.
- Andamento peso e misure.
- Trend e riepiloghi progressivi.
