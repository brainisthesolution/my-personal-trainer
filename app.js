const app = document.querySelector("#app");

const STORAGE_KEYS = {
  settings: "fitTimer.settings",
  overrides: "fitTimer.routineOverrides",
  lastRoutine: "fitTimer.lastRoutine",
  sessions: "fitTimer.sessions",
  sessionsBackup: "fitTimer.sessionsBackup"
};

const DEFAULT_SETTINGS = {
  warmupDurationSec: 30,
  workoutDurationSec: 30,
  cooldownDurationSec: 30,
  prepareDurationSec: 10,
  restEveryExercises: 2,
  restDurationSec: 30,
  roundRestDurationSec: 30,
  workoutRounds: 2,
  voiceEnabled: true,
  countdownEnabled: true,
  nextEnabled: true,
  exerciseCueEnabled: true,
  speechRate: 1,
  speechPitch: 1,
  voiceURI: "",
  englishVoiceURI: "",
  intensity: "advanced",
  faceIntensity: "advanced",
  intensityModelVersion: 2
};

const LEVELS = {
  beginner: { label: "Principiante", exerciseRatio: 0.7, durationRatio: 2 / 3, note: "Circa il 30% di esercizi in meno nella parte centrale e durata ridotta a due terzi." },
  advanced: { label: "Avanzato", exerciseRatio: 1, durationRatio: 1, note: "La routine attuale: tutti gli esercizi e i tempi di riferimento." },
  expert: { label: "Esperto", exerciseRatio: 1.3, durationRatio: 4 / 3, note: "Circa il 30% di esercizi in più nella parte centrale e durata aumentata di un terzo." }
};

const PHASE_LABELS = {
  warmup: "Riscaldamento",
  workout: "Allenamento",
  cooldown: "Defaticamento"
};

const FINISH_MESSAGES = [
  "Allenamento concluso: ottimo lavoro! La costanza è la chiave per raggiungere l'obiettivo, ci vediamo domani!",
  "Sessione completata: grande lavoro! Un passo alla volta, stai costruendo il risultato.",
  "Allenamento finito: bravo! Recupera, respira e porta con te questa energia."
];

const DEFAULT_EXERCISE_GUIDE = {
  summary: "Esercizio generale a corpo libero: mantieni controllo, postura e respirazione costante.",
  steps: ["Prendi posizione con calma.", "Esegui il movimento nel range che controlli bene.", "Torna alla posizione iniziale senza scatti."],
  focus: ["Controllo prima della velocita.", "Allineamento comodo.", "Respiro regolare."],
  avoid: ["Compensare con slanci.", "Ignorare dolore o fastidio articolare.", "Perdere postura per fare piu ripetizioni."],
  easier: ["Riduci ampiezza, velocita o durata."],
  cue: "Controlla il movimento e mantieni il respiro regolare."
};

let sourceData = null;
let exerciseData = null;
let exerciseGuideData = null;
let faceData = null;
let selectedPractice = "fitness";
let storageWarning = "";
let sessionMemory = null;
let historyDatabase = null;
let historyWrite = Promise.resolve();
let settings = normalizeSettings(loadJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS));
let overrides = loadJson(STORAGE_KEYS.overrides, {});
if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) overrides = {};
let routines = [];
let exerciseLibrary = [];
let exerciseCategories = [];
let selected = { week: 1, day: 1 };
let calendarMonth = startOfMonth(new Date());
let editorPhase = "workout";
let editorCategory = "Tutti";
let libraryCategory = "Tutti";
let exerciseDetailBack = { screen: "library" };
let speechGeneration = 0;
let currentUtterance = null;
let guidanceSpeaking = false;

let player = {
  active: false,
  paused: true,
  routine: null,
  timeline: [],
  index: 0,
  segmentStartedAt: 0,
  elapsedBeforePause: 0,
  tickId: null,
  spokenSegment: "",
  spokenCountdown: "",
  wakeLock: null
};

init();

async function init() {
  try {
    const [routinePayload, exercisePayload, guidePayload, facePayload] = await Promise.all([
      fetch("data/routines.json").then((response) => response.json()),
      fetch("data/exercise-library.json").then((response) => response.json()),
      fetch("data/exercise-guides.json").then((response) => response.json()),
      fetch("data/face-yoga.json").then((response) => response.json())
    ]);
    sourceData = routinePayload;
    exerciseData = exercisePayload;
    exerciseGuideData = guidePayload;
    faceData = facePayload;
    rebuildRoutines();
    exerciseLibrary = buildExerciseLibrary(routines);
    exerciseCategories = ["Tutti", ...exerciseData.categories];
    selected = loadJson(STORAGE_KEYS.lastRoutine, selected);
    if (!selected || !findRoutine(selected.week, selected.day)) selected = { week: 1, day: 1 };
    await restoreHistory();
    registerServiceWorker();
    window.speechSynthesis?.addEventListener("voiceschanged", updateVoiceOptions);
    renderHome();
  } catch {
    app.innerHTML = `<main class="screen"><h1>L’app non si è caricata</h1><p>Controlla la connessione e riapri l’app per completare l’aggiornamento. I dati del diario restano sul dispositivo.</p><button class="primary" data-action="reload">Riprova</button></main>`;
    bindAction("reload", () => window.location.reload());
  }
}

function rebuildRoutines() {
  routines = [...flattenRoutines(sourceData), ...(faceData?.routines || [])];
  applyRoutineOverrides();
}

function flattenRoutines(data) {
  return data.weeks.flatMap((week) =>
    week.days.map((day) => ({
      ...day,
      practice: "fitness",
      week: week.week,
      key: routineKey(week.week, day.day),
      warmup: [...day.warmup],
      workout: [...day.workout],
      cooldown: [...day.cooldown]
    }))
  );
}

function applyRoutineOverrides() {
  routines = routines.map((routine) => {
    const override = overrides[routine.key];
    return override ? { ...routine, ...clone(override), hasLocalChanges: true } : routine;
  });
}

function buildExerciseLibrary(items) {
  const metaByName = new Map([...(exerciseData?.exercises || []), ...(faceData?.exercises || [])].map((exercise) => [exercise.name, exercise]));
  const names = new Set(metaByName.keys());
  items.forEach((routine) => {
    ["warmup", "workout", "cooldown"].forEach((phase) => {
      routine[phase].forEach((name) => names.add(name));
    });
  });
  return [...names]
    .sort((a, b) => a.localeCompare(b, "it"))
    .map((name) => metaByName.get(name) || { name, category: "Full body", image: "" });
}

function renderHome() {
  stopPlayer();
  const sessions = getSessions();
  const last = loadJson(STORAGE_KEYS.lastRoutine, null);
  const lastRoutine = last && findRoutine(last.week, last.day);
  app.innerHTML = `
    <main class="screen home-screen practice-home">
      <header class="topbar">
        <div><p class="eyebrow">My Personal Trainer</p><h1>Il tuo spazio.<br>La tua <em>pratica.</em></h1></div>
        <div class="top-actions">
          <button class="icon-button" data-action="calendar" aria-label="Calendario">${iconCalendar()}</button>
          <button class="icon-button" data-action="settings" aria-label="Impostazioni">${iconGear()}</button>
        </div>
      </header>
      ${storageNotice()}
      <p class="home-intro">Come vuoi prenderti cura di te, oggi?</p>
      <section class="practice-choices" aria-label="Scegli la pratica">
        <button class="practice-choice fitness-choice" data-action="fitness">
          <span class="eyebrow">01 / Corpo e movimento</span><span class="practice-symbol" aria-hidden="true">${iconMovement()}</span>
          <strong>Fitness</strong><span>Forza, mobilità e postura.<br>Il tuo programma di quattro settimane.</span>
          <span class="practice-cta">Scegli l’allenamento ${iconForward()}</span>
        </button>
        <button class="practice-choice face-choice" data-action="face">
          <span class="eyebrow">02 / Viso e rilassamento</span><span class="practice-symbol" aria-hidden="true">${iconFace()}</span>
          <strong>Yoga facciale</strong><span>Scalpo, fronte, occhi e guance.<br>Gesti lenti, allo specchio.</span>
          <span class="practice-cta">Scegli la routine ${iconForward()}</span>
        </button>
      </section>
      ${lastRoutine ? `<button class="last-practice secondary" data-action="last">Ultima routine: ${escapeHtml(lastRoutine.title)} ${iconForward()}</button>` : ""}
      <button class="journal-link" data-action="calendar">${iconCalendar()}<span><strong>Il tuo diario</strong><small>${sessions.length} ${sessions.length === 1 ? "sessione salvata" : "sessioni salvate"} · Fitness e yoga facciale</small></span>${iconForward()}</button>
      <p class="section-note">Una pratica alla volta. Scegli un livello che ti permetta di mantenere un gesto comodo e preciso.</p>
    </main>`;
  bindAction("fitness", () => renderPractice("fitness"));
  bindAction("face", () => renderPractice("face"));
  bindAction("last", () => renderRoutine(lastRoutine));
  bindAction("calendar", renderCalendar);
  bindAction("settings", renderSettings);
}

function renderPractice(practice = selectedPractice) {
  selectedPractice = practice;
  libraryCategory = "Tutti";
  if (practice === "face") return renderFaceHome();
  renderFitness();
}

function renderFitness() {
  stopPlayer();
  const last = loadJson(STORAGE_KEYS.lastRoutine, null);
  const currentWeek = selected.week || 1;
  const weekRoutines = routines.filter((routine) => routine.week === currentWeek);
  const lastRoutine = last?.week > 0 && findRoutine(last.week, last.day);

  app.innerHTML = `
    <main class="screen home-screen">
      <header class="topbar">
        <div>
          <p class="eyebrow">My Personal Trainer</p>
          <h1>Corpo in movimento.<br>Al tuo <em>ritmo.</em></h1>
        </div>
        <div class="top-actions">
          <button class="icon-button" data-action="calendar" aria-label="Storico sessioni" title="Storico sessioni">
            ${iconCalendar()}
          </button>
          <button class="icon-button" data-action="library" aria-label="Libreria esercizi" title="Libreria esercizi">
            ${iconBook()}
          </button>
          <button class="icon-button" data-action="settings" aria-label="Impostazioni" title="Impostazioni">
            ${iconGear()}
          </button>
        </div>
      </header>
      <button class="text-link" data-action="home">${iconBack()} Tutte le pratiche</button>
      ${levelSelector("fitness")}

      ${lastRoutine ? `
        <section class="resume-band">
          <div>
            <p class="eyebrow">Ultima routine</p>
            <h2>${escapeHtml(lastRoutine.title)}</h2>
            <p>Settimana ${lastRoutine.week}, giorno ${lastRoutine.day}</p>
          </div>
          <button class="primary compact" data-action="open-last">Riprendi</button>
        </section>
      ` : ""}

      <div class="program-heading"><span>IL PROGRAMMA</span><span>4 SETTIMANE / CORPO LIBERO</span></div>
      <nav class="week-tabs" aria-label="Settimane">
        ${[1, 2, 3, 4].map((week) => `
          <button class="${week === currentWeek ? "active" : ""}" data-week="${week}" aria-pressed="${week === currentWeek}"><small>SETTIMANA</small><span>0${week}</span></button>
        `).join("")}
      </nav>

      <div class="section-heading"><h2>Una sessione alla volta.</h2><span>SETT. 0${currentWeek}</span></div>
      <section class="routine-list">
        ${weekRoutines.map((routine) => routineCard(routine)).join("")}
      </section>
    </main>
  `;

  bind("[data-week]", "click", (event) => {
    selected.week = Number(event.currentTarget.dataset.week);
    renderFitness();
  });
  bind("[data-routine]", "click", (event) => {
    const [week, day] = event.currentTarget.dataset.routine.split("-").map(Number);
    selected = { week, day };
    renderRoutine(findRoutine(week, day));
  });
  bindAction("calendar", renderCalendar);
  bindAction("library", renderExerciseLibrary);
  bindAction("settings", renderSettings);
  bindAction("open-last", () => renderRoutine(lastRoutine));
  bindAction("home", renderHome);
  bindLevels("fitness", renderFitness);
}

function renderFaceHome() {
  stopPlayer();
  app.innerHTML = `<main class="screen face-screen">
    <header class="topbar"><button class="icon-button" data-action="home" aria-label="Tutte le pratiche">${iconBack()}</button><div><p class="eyebrow">Viso e rilassamento</p><h1>Yoga facciale</h1></div></header>
    <p class="home-intro">Qualche minuto per rallentare.<br>Mani pulite, spalle morbide, uno specchio.</p>
    ${levelSelector("face")}
    <section class="routine-list">${routines.filter(r => r.practice === "face").map(routineCard).join("")}</section>
    <aside class="practice-note"><strong>Delicatezza, a ogni livello.</strong><p>${escapeHtml(faceData.note)}</p></aside>
    <button class="secondary last-practice" data-action="library">${iconBook()} Guide dei gesti</button>
    <button class="journal-link" data-action="calendar">${iconCalendar()} Calendario delle pratiche ${iconForward()}</button>
  </main>`;
  bindAction("home", renderHome);
  bindAction("calendar", renderCalendar);
  bindAction("library", renderExerciseLibrary);
  bindLevels("face", renderFaceHome);
  bind("[data-routine]", "click", e => {
    const [week, day] = e.currentTarget.dataset.routine.split("-").map(Number);
    renderRoutine(findRoutine(week, day));
  });
}

function practiceLevel(practice = selectedPractice) {
  return settings[practice === "face" ? "faceIntensity" : "intensity"];
}

function levelSelector(practice, routine = null) {
  const level = practiceLevel(practice);
  return `<section class="level-picker"><p class="eyebrow">Il tuo livello</p><div class="level-buttons" role="group" aria-label="Livello della pratica">${Object.entries(LEVELS).map(([key, value]) => `<button data-level="${key}" aria-pressed="${level === key}" class="${level === key ? "active" : ""}">${value.label}</button>`).join("")}</div><p class="section-note">${LEVELS[level].note}${practice === "face" ? " I tempi cambiano con durata dei massaggi e ripetizioni; tenute, rilasci e pressione restano delicati." : " Riscaldamento, defaticamento, giri e recuperi restano quelli impostati."}</p>${routine ? levelComparison(routine) : practice === "fitness" ? `<p class="level-example">Durata di ogni esercizio centrale: ${Object.keys(LEVELS).map(key => `${LEVELS[key].label} ${workoutDuration(key)} s`).join(" · ")}. I tempi nelle impostazioni sono il riferimento avanzato.</p>` : ""}</section>`;
}

function workoutDuration(level = practiceLevel("fitness")) {
  return Math.max(1, Math.round(settings.workoutDurationSec * LEVELS[level].durationRatio));
}

function bilateralKey(name) {
  return name.replace(/\((sinistra|destra)\)/g, "(lato)");
}

function exerciseGroups(names) {
  const groups = [];
  const used = new Set();
  names.forEach((name, index) => {
    if (used.has(index)) return;
    used.add(index);
    const group = [name];
    if (/\((sinistra|destra)\)/.test(name)) {
      const other = names.findIndex((candidate, i) => !used.has(i) && candidate !== name && bilateralKey(candidate) === bilateralKey(name));
      if (other >= 0) { used.add(other); group.push(names[other]); }
    }
    groups.push(group);
  });
  return groups;
}

function routineForLevel(routine, level = practiceLevel(routine.practice || "fitness")) {
  const base = { ...routine, warmup: [...routine.warmup], workout: [...routine.workout], cooldown: [...routine.cooldown] };
  if (level === "advanced" || !base.workout.length) return base;
  const groups = exerciseGroups(base.workout);
  if (level === "beginner") {
    const count = Math.max(1, Math.floor(groups.length * LEVELS.beginner.exerciseRatio));
    const indexes = new Set(Array.from({ length: count }, (_, i) => count === 1 ? 0 : Math.round(i * (groups.length - 1) / (count - 1))));
    base.workout = groups.filter((_, index) => indexes.has(index)).flat();
    return base;
  }
  const practice = routine.practice || "fitness";
  const all = practice === "face" ? faceData?.exercises || [] : exerciseData?.exercises || [];
  const present = new Set([...base.warmup, ...base.workout, ...base.cooldown]);
  const categories = new Set(base.workout.map(name => exerciseMeta(name).category));
  const pool = all.filter(e => e.phases?.includes("workout") && !present.has(e.name) && (practice === "face" || categories.has(e.category)));
  const extraGroups = exerciseGroups(pool.map(e => e.name));
  const target = Math.max(1, Math.round(routine.workout.length * LEVELS.expert.exerciseRatio) - routine.workout.length);
  let added = 0;
  for (const group of extraGroups) {
    // A left/right exercise is added only with its matching side.
    if (group.some(name => /\((sinistra|destra)\)/.test(name)) && group.length !== 2) continue;
    if (added >= target) break;
    base.workout.push(...group);
    added += group.length;
  }
  // Very small custom routines may exhaust compatible exercises. Repeat a
  // complete existing group rather than adding an unrelated movement or side.
  for (let i = 0; added < target; i += 1) {
    const group = groups[i % groups.length];
    base.workout.push(...group);
    added += group.length;
  }
  return base;
}

function levelComparison(routine) {
  return `<div class="level-comparison" role="table" aria-label="Confronto dei livelli"><div class="level-comparison-row" role="row"><span>Livello</span><span>Esercizi</span><span>Durata totale</span></div>${Object.entries(LEVELS).map(([key, level]) => {
    const summary = routineSummary(routine, key);
    return `<div class="level-comparison-row ${practiceLevel(routine.practice) === key ? "selected" : ""}" role="row"><strong>${level.label}</strong><span>${summary.totalExercises}</span><span>${formatTime(summary.totalSeconds)}</span></div>`;
  }).join("")}<p class="section-note">Esercizi conteggiati su tutti i giri. Il tempo totale comprende preparazione e recuperi. Le coppie destra/sinistra restano complete.</p></div>`;
}

function bindLevels(practice, render) {
  bind("[data-level]", "click", e => {
    settings[practice === "face" ? "faceIntensity" : "intensity"] = e.currentTarget.dataset.level;
    saveJson(STORAGE_KEYS.settings, settings);
    render();
  });
}

function renderCalendar() {
  const sessions = getSessions();
  const monthStart = startOfMonth(calendarMonth);
  const monthDays = daysInMonth(monthStart);
  const leadingDays = (monthStart.getDay() + 6) % 7;
  const cells = [
    ...Array.from({ length: leadingDays }, () => null),
    ...Array.from({ length: monthDays }, (_, index) => new Date(monthStart.getFullYear(), monthStart.getMonth(), index + 1))
  ];
  const monthSessions = sessionsForMonth(sessions, monthStart);
  const completedDays = new Set(monthSessions.map((session) => session.date));

  app.innerHTML = `
    <main class="screen">
      <header class="topbar">
        <button class="icon-button" data-action="home" aria-label="Indietro" title="Indietro">${iconBack()}</button>
        <div>
          <p class="eyebrow">Storico sessioni</p>
          <h1>Calendario</h1>
        </div>
      </header>
      ${storageNotice()}
      <button class="routine-timing-link" data-action="backup">Backup e ripristino dello storico ${iconForward()}</button>

      <section class="calendar-summary">
        <div><span>${monthSessions.length}</span><small>Sessioni</small></div>
        <div><span>${completedDays.size}</span><small>Giorni attivi</small></div>
        <div><span>${formatTime(monthSessions.reduce((sum, session) => sum + session.totalSeconds, 0))}</span><small>Tempo</small></div>
      </section>

      <section class="calendar-toolbar">
        <button class="icon-button" data-action="prev-month" aria-label="Mese precedente" title="Mese precedente">${iconBack()}</button>
        <strong>${monthLabel(monthStart)}</strong>
        <button class="icon-button" data-action="next-month" aria-label="Mese successivo" title="Mese successivo">${iconForward()}</button>
      </section>

      <section class="calendar-grid" aria-label="Calendario allenamenti">
        ${["L", "M", "M", "G", "V", "S", "D"].map((day) => `<span class="calendar-weekday">${day}</span>`).join("")}
        ${cells.map((date) => calendarCell(date, sessions)).join("")}
      </section>

      <section class="session-list">
        <h2>Sessioni del mese</h2>
        ${monthSessions.length ? monthSessions.map(sessionCard).join("") : `<p class="empty-state">Nessun allenamento completato in questo mese.</p>`}
      </section>
    </main>
  `;

  bindAction("home", renderHome);
  bindAction("backup", renderBackup);
  bindAction("prev-month", () => {
    calendarMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);
    renderCalendar();
  });
  bindAction("next-month", () => {
    calendarMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    renderCalendar();
  });
  bind("[data-session-routine]", "click", (event) => {
    const [week, day] = event.currentTarget.dataset.sessionRoutine.split("-").map(Number);
    const routine = findRoutine(week, day);
    if (routine) renderRoutine(routine);
  });
}

function calendarCell(date, sessions) {
  if (!date) return `<span class="calendar-cell empty" aria-hidden="true"></span>`;
  const key = localDateKey(date);
  const daySessions = sessions.filter((session) => session.date === key);
  const isToday = key === localDateKey(new Date());
  return `
    <span class="calendar-cell ${daySessions.length ? "completed" : ""} ${isToday ? "today" : ""}">
      <span>${date.getDate()}</span>
      ${daySessions.length ? `<small>${daySessions.length}</small>` : ""}
    </span>
  `;
}

function sessionCard(session) {
  return `
    <button class="session-card" data-session-routine="${session.week}-${session.day}">
      <span>
        <strong>${escapeHtml(session.title)}</strong>
        <small>${formatSessionDate(session.completedAt)} · ${session.practice === "face" || session.week === 0 ? "Yoga facciale" : `Fitness · Settimana ${session.week}, giorno ${session.day}`} ${session.intensity ? `· ${LEVELS[session.intensity]?.label || ""}` : ""}</small>
      </span>
      <span class="session-metrics">${session.totalExercises} es. · ${formatTime(session.totalSeconds)}</span>
    </button>
  `;
}

function routineCard(routine) {
  const summary = routineSummary(routine);
  return `
    <button class="routine-card" data-routine="${routine.week}-${routine.day}">
      <span class="day-index"><small>${routine.practice === "face" ? "RITUALE" : "GIORNO"}</small>${String(routine.day).padStart(2, "0")}</span>
      <span class="routine-body">
        <span class="routine-title">${escapeHtml(routine.title)}</span>
        <span class="routine-meta">${summary.totalExercises} esercizi <i>·</i> ${formatTime(summary.totalSeconds)} min <i>·</i> ${routine.practice === "face" ? "1 sequenza" : `${settings.workoutRounds} giri`}<br>${LEVELS[practiceLevel(routine.practice)].label}</span>
        ${routine.description ? `<span class="routine-description">${escapeHtml(routine.description)}</span>` : ""}
        ${routine.extractionStatus === "generated-from-week-4-pattern" ? `<span class="status-pill">Generata</span>` : ""}
        ${routine.hasLocalChanges ? `<span class="status-pill local">Modificata</span>` : ""}
      </span>
      <span class="routine-arrow" aria-hidden="true">${iconForward()}</span>
    </button>
  `;
}

function renderRoutine(routine) {
  if (!routine) return renderHome();
  selectedPractice = routine.practice || "fitness";
  const summary = routineSummary(routine);
  const effective = routineForLevel(routine);
  app.innerHTML = `
    <main class="screen">
      <header class="topbar">
        <button class="icon-button" data-action="home" aria-label="Indietro" title="Indietro">${iconBack()}</button>
        <div>
          <p class="eyebrow">${routineContext(routine)}</p>
          <h1>${escapeHtml(routine.title)}</h1>
        </div>
      </header>

      <section class="stats-grid">
        <div><span>${summary.totalExercises}</span><small>Esercizi</small></div>
        <div><span>${formatTime(summary.totalSeconds)}</span><small>Stimati</small></div>
        <div><span>${routine.practice === "face" ? 1 : settings.workoutRounds}</span><small>${routine.practice === "face" ? "Sequenza" : "Giri"}</small></div>
      </section>

      <section class="action-row">
        <button class="primary" data-action="start" ${summary.totalExercises ? "" : "disabled"}>Avvia</button>
        <button class="secondary" data-action="edit">Modifica</button>
      </section>

      <button class="routine-timing-link" data-action="timing">Tempi e voce ${iconForward()}</button>
      ${routine.practice !== "face" ? `<section class="routine-guidance"><button class="secondary" data-action="toggle-guidance" aria-pressed="${settings.exerciseCueEnabled}">Guida vocale esercizi: ${settings.exerciseCueEnabled ? "attiva" : "disattivata"}</button><p class="section-note">${settings.voiceEnabled && settings.exerciseCueEnabled ? "Durante la preparazione senti solo il nome dell’esercizio; le indicazioni del movimento arrivano al via. La preparazione dura sempre i secondi impostati." : "Attiva la guida e la voce in “Tempi e voce” per ascoltare le indicazioni del movimento all’inizio dell’esercizio."}${settings.prepareDurationSec === 0 ? " Con preparazione a zero, ascolta prima la guida dalla scheda: durante il lavoro sentirai solo le indicazioni che entrano nel tempo disponibile." : ""}</p></section>` : ""}
      ${levelSelector(selectedPractice, routine)}
      ${routine.practice === "face" ? `<p class="section-note">${escapeHtml(faceData.note)}</p>` : ""}
      ${phasePreview("Riscaldamento", effective.warmup, "warmup", routine)}
      ${phasePreview(routine.practice === "face" ? "La sequenza" : "Allenamento", effective.workout, "workout", routine)}
      ${phasePreview("Defaticamento", effective.cooldown, "cooldown", routine)}
    </main>
  `;

  bindAction("home", () => renderPractice(routine.practice));
  bindLevels(selectedPractice, () => renderRoutine(routine));
  bindAction("start", () => startRoutine(routine));
  bindAction("edit", () => renderEditor(routine));
  bindAction("timing", () => renderSettings(routine));
  bindAction("toggle-guidance", () => {
    settings.exerciseCueEnabled = !settings.exerciseCueEnabled;
    saveJson(STORAGE_KEYS.settings, settings);
    renderRoutine(routine);
  });
  bind("[data-guide]", "click", (event) => {
    openExerciseDetail(decodeURIComponent(event.currentTarget.dataset.guide), {
      screen: "routine",
      week: routine.week,
      day: routine.day
    });
  });
}

function phasePreview(label, items, phase, routine) {
  if (!items.length) return "";
  return `
    <section class="phase-block">
      <header>
        <h2>${label}</h2>
        <span>${items.length} es. ${routine.practice === "face" ? "· dosi guidate" : `· ${phase === "workout" ? workoutDuration() : settings[`${phase}DurationSec`]} s${phase === "workout" ? ` · ${settings.workoutRounds} giri` : ""}`}</span>
      </header>
      <ol>
        ${items.map((name) => `
          <li>
            ${exerciseThumb(name)}
            <span>${escapeHtml(name)}<small class="exercise-dose">${escapeHtml(levelInstruction(name, routine.practice, phase))}</small></span>
            <button class="icon-button mini" data-guide="${encodeURIComponent(name)}" aria-label="Guida ${escapeHtml(name)}" title="Guida esercizio">${iconInfo()}</button>
          </li>
        `).join("")}
      </ol>
    </section>
  `;
}

function renderExerciseLibrary() {
  const practiceExercises = exerciseLibrary.filter(e => (e.practice || "fitness") === selectedPractice);
  const categories = ["Tutti", ...new Set(practiceExercises.map(e => e.category))];
  const filteredExercises = practiceExercises.filter((exercise) => libraryCategory === "Tutti" || exercise.category === libraryCategory);

  app.innerHTML = `
    <main class="screen">
      <header class="topbar">
        <button class="icon-button" data-action="home" aria-label="Indietro" title="Indietro">${iconBack()}</button>
        <div>
          <p class="eyebrow">Guida esecuzione · ${selectedPractice === "face" ? "Yoga facciale" : "Fitness"}</p>
          <h1>Libreria esercizi</h1>
        </div>
      </header>

      <section class="library-filter">
        <select id="libraryCategory" aria-label="Categoria esercizi">
          ${categories.map((category) => `<option value="${escapeHtml(category)}" ${category === libraryCategory ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
        </select>
      </section>

      <section class="exercise-library-list">
        ${filteredExercises.map((exercise) => `
          <button class="exercise-card" data-exercise="${encodeURIComponent(exercise.name)}">
            ${exerciseThumb(exercise.name)}
            <span>
              <strong>${escapeHtml(exercise.name)}</strong>
              <small>${escapeHtml(exercise.category)} · ${LEVELS[practiceLevel()].label}</small>
            </span>
            ${iconForward()}
          </button>
        `).join("")}
      </section>
    </main>
  `;

  bindAction("home", () => renderPractice());
  bind("#libraryCategory", "change", (event) => {
    libraryCategory = event.currentTarget.value;
    renderExerciseLibrary();
  });
  bind("[data-exercise]", "click", (event) => {
    openExerciseDetail(decodeURIComponent(event.currentTarget.dataset.exercise), { screen: "library" });
  });
}

function openExerciseDetail(name, backTarget = { screen: "library" }) {
  exerciseDetailBack = backTarget;
  renderExerciseDetail(name);
}

function renderExerciseDetail(name) {
  const meta = exerciseMeta(name);
  const guide = exerciseGuide(meta);

  app.innerHTML = `
    <main class="screen">
      <header class="topbar">
        <button class="icon-button" data-action="back" aria-label="Indietro" title="Indietro">${iconBack()}</button>
        <div>
          <p class="eyebrow">${escapeHtml(meta.category)}</p>
          <h1>${escapeHtml(meta.name)}</h1>
        </div>
      </header>

      <section class="exercise-detail-hero">
        ${exerciseHero(meta.name)}
      </section>
      ${guide.imageNote ? `<p class="section-note">${escapeHtml(guide.imageNote)}</p>` : ""}

      <section class="guide-panel">
        <p>${escapeHtml(guide.summary)}</p>
      </section>

      ${guideAudio(meta.name)}

      <section class="guide-grid">
        ${guide.setup ? guideBlock("Posizione di partenza", [guide.setup]) : ""}
        ${guideBlock("Esecuzione", guide.steps)}
        ${guide.breath ? guideBlock("Respirazione e ritmo", [guide.breath]) : ""}
        ${guideBlock("Focus", guide.focus)}
        ${guideBlock("Evita", guide.avoid)}
        ${guideBlock("Variante facile", guide.easier)}
      </section>
      ${renderGuideLevels(meta.name)}
      ${guideSources(guide)}
    </main>
  `;

  bindAction("back", () => {
    cancelSpeech();
    if (exerciseDetailBack.screen === "routine") {
      renderRoutine(findRoutine(exerciseDetailBack.week, exerciseDetailBack.day));
      return;
    }
    renderExerciseLibrary();
  });
  bindLevels(meta.practice || "fitness", () => renderExerciseDetail(name));
  bindGuideAudio(meta.name);
}

function guideAudio(name) {
  const guide = exerciseGuide(exerciseMeta(name));
  return `<section class="voice-cue"><span>Guida da ascoltare</span><p>${escapeHtml(guide.voice?.move || guide.cue)}</p><div class="action-row"><button class="secondary" data-action="listen-guide" ${!("speechSynthesis" in window) ? "disabled" : ""}>Ascolta la guida completa</button><button class="secondary" data-action="stop-guide">Ferma voce</button></div><p class="section-note" data-voice-status role="status">${!("speechSynthesis" in window) ? "La lettura vocale non è disponibile in questo browser." : "Posizione iniziale, movimento e respirazione, con la velocità di voce impostata."}</p></section>`;
}

function bindGuideAudio(name) {
  bindAction("listen-guide", () => {
    const guide = exerciseGuide(exerciseMeta(name));
    const status = document.querySelector("[data-voice-status]");
    if (status) status.textContent = "Ascolto della guida completa…";
    speak(speechSentences([name, guide.setup || guide.summary, ...guide.steps, guide.breath]), {
      onDone: () => { if (status) status.textContent = "Guida terminata. Puoi riascoltarla quando vuoi."; }
    });
  });
  bindAction("stop-guide", () => {
    cancelSpeech();
    const status = document.querySelector("[data-voice-status]");
    if (status) status.textContent = "Lettura fermata.";
  });
}

function guideSources(guide) {
  if (!guide.sources.length) return "";
  return `<details class="guide-sources"><summary>Fonti e variante descritta</summary>${guide.sourceNote ? `<p>${escapeHtml(guide.sourceNote)}</p>` : ""}<ul>${guide.sources.map(source => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a></li>`).join("")}</ul><p class="section-note">Tecnica confrontata con queste fonti il ${escapeHtml(guide.reviewedOn.split("-").reverse().join("/"))}. I tempi di lavoro sono quelli del tuo programma. Le fonti online richiedono una connessione.</p></details>`;
}

function routineContext(routine) {
  return routine.practice === "face" ? "Yoga facciale · Viso e scalpo" : `Fitness · Settimana ${routine.week}, giorno ${routine.day}`;
}

function levelInstruction(name, practice = selectedPractice, phase = "workout") {
  const guide = exerciseGuide(exerciseMeta(name));
  const level = practiceLevel(practice);
  const dose = faceDose(name, level);
  return dose ? `${doseLabel(dose)}` : `${phase === "workout" ? workoutDuration(level) : settings[`${phase}DurationSec`]} s di lavoro`;
}

function renderGuideLevels(name) {
  const meta = exerciseMeta(name);
  const guide = exerciseGuide(meta);
  const practice = meta.practice || "fitness";
  return `${levelSelector(practice)}<section class="guide-levels" aria-label="Dosi per livello">${Object.entries(LEVELS).map(([key, value]) => `<article class="guide-block ${practiceLevel(practice) === key ? "selected-level" : ""}"><h2>${value.label}</h2><p>${escapeHtml(value.note)}</p><small>${escapeHtml(faceDose(name, key) ? doseLabel(faceDose(name, key)) : `${workoutDuration(key)} s quando l’esercizio è nella fase centrale. Riscaldamento e defaticamento seguono i tempi impostati.`)}</small></article>`).join("")}</section>`;
}

function guideBlock(title, items) {
  const list = title === "Esecuzione" ? "ol" : "ul";
  return `
    <article class="guide-block">
      <h2>${title}</h2>
      <${list}>
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </${list}>
    </article>
  `;
}

function renderSettings(routine = null) {
  const back = routine?.key ? () => renderRoutine(routine) : renderHome;
  app.innerHTML = `
    <main class="screen">
      <header class="topbar">
        <button class="icon-button" data-action="home" aria-label="Indietro" title="Indietro">${iconBack()}</button>
        <div>
          <p class="eyebrow">My Personal Trainer</p>
          <h1>Impostazioni</h1>
        </div>
      </header>

      ${routine?.practice === "face" ? `<section class="settings-panel"><p class="section-note">Lo yoga facciale segue le ripetizioni e le tenute del livello scelto, in una sola sequenza. I tempi fitness non modificano questa pratica.</p></section>` : `<section class="settings-panel">
        <h2 class="section-title"><span>01</span> Il tuo ritmo</h2>
        <p class="section-note">Questi sono i tempi di riferimento del livello avanzato. Principiante ed esperto riducono o aumentano il tempo della fase centrale; riscaldamento e defaticamento restano completi.</p>
        ${numberSetting("warmupDurationSec", "Riscaldamento", 5, 300, 5)}
        ${numberSetting("workoutDurationSec", "Allenamento", 5, 300, 5)}
        ${numberSetting("cooldownDurationSec", "Defaticamento", 5, 300, 5)}
      </section>
      <section class="settings-panel">
        <h2 class="section-title"><span>02</span> Passaggi e recupero</h2>
        ${numberSetting("prepareDurationSec", "Preparazione esercizio", 0, 120, 5)}
        <p class="section-note">La preparazione dura sempre i secondi impostati, anche con la guida vocale attiva. La voce annuncia solo il nome; le indicazioni del movimento arrivano al via. Con preparazione a zero, l’esercizio inizia subito.</p>
        ${numberSetting("restEveryExercises", "Pausa ogni", 1, 10, 1)}
        ${numberSetting("restDurationSec", "Pausa tra esercizi", 0, 300, 5)}
        ${numberSetting("roundRestDurationSec", "Recupero tra giri", 0, 300, 5)}
        ${numberSetting("workoutRounds", "Giri di allenamento", 1, 6, 1)}
        <p class="section-note">Il recupero tra giri sostituisce la pausa tra esercizi. Riscaldamento e defaticamento non hanno pause di recupero.</p>
      </section>`}
      <section class="settings-panel">
        <h2 class="section-title"><span>03</span> La voce che ti guida</h2>
        ${voiceSetting("voiceURI", "Voce italiana", "it")}
        ${voiceSetting("englishVoiceURI", "Pronuncia inglese", "en")}
        ${numberSetting("speechRate", "Velocità", 0.6, 1.4, 0.1)}
        ${numberSetting("speechPitch", "Tonalità", 0.7, 1.3, 0.1)}
        <p class="section-note">I termini inglesi della libreria usano la lingua originale. Le voci disponibili e la loro naturalezza dipendono dal dispositivo.</p>
        <button class="secondary" data-action="test-voice" ${!("speechSynthesis" in window) ? "disabled" : ""}>Ascolta un esempio</button>
        <p class="section-note" data-voice-status role="status">${!("speechSynthesis" in window) ? "La lettura vocale non è disponibile in questo browser." : ""}</p>
      </section>
      <section class="settings-panel toggles">
        ${toggleSetting("voiceEnabled", "Voce")}
        ${toggleSetting("countdownEnabled", "Countdown")}
        ${toggleSetting("nextEnabled", "Prossimo esercizio")}
        ${toggleSetting("exerciseCueEnabled", "Guida vocale degli esercizi")}
      </section>

      <section class="action-row">
        <button class="secondary" data-action="reset-settings">Ripristina</button>
      </section>
      <button class="routine-timing-link" data-action="backup">Backup e ripristino dei dati ${iconForward()}</button>
    </main>
  `;

  bindAction("home", () => { cancelSpeech(); back(); });
  bindAction("backup", renderBackup);
  bind("[data-setting]", "input", (event) => {
    const key = event.currentTarget.dataset.setting;
    const value = event.currentTarget.type === "checkbox"
      ? event.currentTarget.checked
      : event.currentTarget.tagName === "SELECT" ? event.currentTarget.value : Number(event.currentTarget.value);
    settings = { ...settings, [key]: value };
    saveJson(STORAGE_KEYS.settings, settings);
    const output = document.querySelector(`[data-output="${key}"]`);
    if (output) output.textContent = settingDisplay(key, value);
    cancelSpeech();
  });
  bindAction("test-voice", () => {
    const status = document.querySelector("[data-voice-status]");
    if (status) status.textContent = "Esempio: inizio giro, nome esercizio e indicazione di movimento.";
    speak("Secondo giro. Preparati: Push-up sulle ginocchia. Mantieni il controllo e respira.");
  });
  bindAction("reset-settings", () => {
    settings = { ...DEFAULT_SETTINGS };
    saveJson(STORAGE_KEYS.settings, settings);
    cancelSpeech();
    renderSettings(routine);
  });
}

function numberSetting(key, label, min, max, step) {
  return `
    <label class="setting-row">
      <span>${label}</span>
      <output data-output="${key}">${settingDisplay(key, settings[key])}</output>
      <input data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${settings[key]}">
    </label>
  `;
}

function toggleSetting(key, label) {
  return `
    <label class="toggle-row">
      <span>${label}</span>
      <input data-setting="${key}" type="checkbox" ${settings[key] ? "checked" : ""}>
    </label>
  `;
}

function settingDisplay(key, value) {
  if (key === "restEveryExercises") return `${value} esercizi`;
  if (key === "workoutRounds") return `${value}x`;
  if (key === "speechPitch") return `${Number(value).toFixed(1)}`;
  if (key === "speechRate") return `${Number(value).toFixed(1)}x`;
  return `${value}s`;
}

function renderEditor(routine) {
  const phases = ["warmup", "workout", "cooldown"];
  const phaseExercises = exerciseLibrary.filter((exercise) => (exercise.practice || "fitness") === (routine.practice || "fitness") && exercise.phases?.includes(editorPhase));
  const availableCategories = ["Tutti", ...new Set(phaseExercises.map((exercise) => exercise.category))];
  if (!availableCategories.includes(editorCategory)) editorCategory = "Tutti";
  const filteredExercises = phaseExercises.filter((exercise) => editorCategory === "Tutti" || exercise.category === editorCategory);
  app.innerHTML = `
    <main class="screen">
      <header class="topbar">
        <button class="icon-button" data-action="back-routine" aria-label="Indietro" title="Indietro">${iconBack()}</button>
        <div>
          <p class="eyebrow">${routineContext(routine)}</p>
          <h1>Modifica</h1>
        </div>
      </header>

      <nav class="week-tabs phase-tabs" aria-label="Fasi">
        ${phases.map((phase) => `
          <button class="${phase === editorPhase ? "active" : ""}" data-phase="${phase}">${PHASE_LABELS[phase]}</button>
        `).join("")}
      </nav>

      <section class="editor-list">
        ${routine[editorPhase].map((name, index) => `
          <div class="editor-item">
            ${exerciseThumb(name)}
            <div>
              <span>${escapeHtml(name)}</span>
              <small>${escapeHtml(exerciseMeta(name).category)}</small>
            </div>
            <button class="icon-button danger" data-remove="${index}" aria-label="Rimuovi" title="Rimuovi">${iconTrash()}</button>
          </div>
        `).join("")}
      </section>

      <section class="add-panel">
        <select id="categoryPicker" aria-label="Categoria esercizi">
          ${availableCategories.map((category) => `<option value="${escapeHtml(category)}" ${category === editorCategory ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
        </select>
        <select id="exercisePicker">
          ${filteredExercises.map((exercise) => `<option value="${escapeHtml(exercise.name)}">${escapeHtml(exercise.name)}</option>`).join("")}
        </select>
        <p class="add-hint">${filteredExercises.length} esercizi disponibili per ${PHASE_LABELS[editorPhase].toLowerCase()}</p>
        <button class="primary compact" data-action="add-exercise">Aggiungi</button>
      </section>

      <section class="action-row">
        <button class="secondary" data-action="reset-routine">Ripristina routine</button>
      </section>
    </main>
  `;

  bindAction("back-routine", () => renderRoutine(findRoutine(routine.week, routine.day)));
  bind("[data-phase]", "click", (event) => {
    editorPhase = event.currentTarget.dataset.phase;
    renderEditor(findRoutine(routine.week, routine.day));
  });
  bind("[data-remove]", "click", (event) => {
    const current = findRoutine(routine.week, routine.day);
    current[editorPhase].splice(Number(event.currentTarget.dataset.remove), 1);
    persistRoutineOverride(current);
    renderEditor(current);
  });
  bind("#categoryPicker", "change", (event) => {
    editorCategory = event.currentTarget.value;
    renderEditor(findRoutine(routine.week, routine.day));
  });
  bindAction("add-exercise", () => {
    const current = findRoutine(routine.week, routine.day);
    const picker = document.querySelector("#exercisePicker");
    if (!picker?.value) return;
    current[editorPhase].push(picker.value);
    persistRoutineOverride(current);
    renderEditor(current);
  });
  bindAction("reset-routine", () => {
    delete overrides[routine.key];
    saveJson(STORAGE_KEYS.overrides, overrides);
    rebuildRoutines();
    exerciseLibrary = buildExerciseLibrary(routines);
    renderRoutine(findRoutine(routine.week, routine.day));
  });
}

function startRoutine(routine) {
  if (!routine || !routineSummary(routine).totalExercises) return;
  selectedPractice = routine.practice || "fitness";
  player.routine = routine;
  player.timeline = buildTimeline(routine);
  player.index = 0;
  player.paused = false;
  player.active = true;
  player.elapsedBeforePause = 0;
  player.segmentStartedAt = Date.now();
  player.spokenSegment = "";
  player.spokenCountdown = "";
  player.spokenMidpoint = -1;
  player.showGuide = false;
  player.level = practiceLevel(selectedPractice);
  player.sessionRecorded = false;
  saveJson(STORAGE_KEYS.lastRoutine, { week: routine.week, day: routine.day });
  requestWakeLock();
  renderPlayer();
  startTick();
}

function renderPlayer() {
  const segment = player.timeline[player.index];
  if (!segment) return finishRoutine();
  const total = player.timeline.reduce((sum, item) => sum + item.duration, 0);
  const elapsed = elapsedTimelineSeconds();
  const segmentElapsed = elapsedCurrentSegmentSeconds();
  const remaining = remainingSeconds(segment);
  const nextExercise = segment.kind === "prepare" ? "" : nextExerciseName(player.index);
  const visualName = segment.kind === "exercise" ? segment.name : segment.nextName;
  const exerciseProgress = exerciseCounter(player.index);

  app.innerHTML = `
    <main class="player-screen ${segment.kind}">
      <header class="player-top">
        <button class="icon-button ghost" data-action="close-player" aria-label="Chiudi" title="Chiudi">${iconBack()}</button>
        <div>
          <p>${segment.phaseLabel}${segment.round ? `, giro ${segment.round} di ${settings.workoutRounds}` : ""}</p>
          <strong>${exerciseProgress.current} / ${exerciseProgress.total}</strong>
        </div>
      </header>

      <section class="timer-stage">
        ${visualName ? exerciseHero(visualName) : ""}
        <div class="ring" data-player-ring style="--progress:${segmentProgress(segment)}">
          <span data-player-time data-player-elapsed="${segmentElapsed}">${remaining}</span>
        </div>
        <p class="segment-kind">${segmentKindLabel(segment)}</p>
        <h1>${escapeHtml(segmentTitle(segment))}</h1>
        ${visualName ? `<p class="player-instruction">${escapeHtml(segment.kind === "prepare" ? (exerciseGuide(exerciseMeta(visualName)).voice?.prepare || exerciseGuide(exerciseMeta(visualName)).setup) : exerciseGuide(exerciseMeta(visualName)).cue)}</p><p class="player-level">${LEVELS[player.level || practiceLevel()].label} · ${escapeHtml(levelInstruction(visualName, player.routine?.practice, segment.phase))}</p>` : ""}
        ${segment.dose ? `<p class="face-repetition" data-face-repetition aria-live="off">${faceRepetitionLabel(segment, segmentElapsed)}</p>` : ""}
        ${visualName ? `<button class="player-guide-button" data-action="player-guide">${player.paused && player.showGuide ? "Chiudi guida" : "Pausa e leggi la guida"}</button>` : ""}
        ${player.paused && player.showGuide && visualName ? `<section class="player-guide">${guideBlock("Posizione", [exerciseGuide(exerciseMeta(visualName)).setup || exerciseGuide(exerciseMeta(visualName)).summary])}${guideBlock("Esecuzione", exerciseGuide(exerciseMeta(visualName)).steps)}${guideBlock("Respirazione", [exerciseGuide(exerciseMeta(visualName)).breath])}${guideBlock("Evita", exerciseGuide(exerciseMeta(visualName)).avoid)}${guideAudio(visualName)}${guideSources(exerciseGuide(exerciseMeta(visualName)))}</section>` : ""}
        ${nextExercise ? `<p class="next-line">Prossimo: ${escapeHtml(nextExercise)}</p>` : ""}
      </section>

      <progress class="total-progress" data-player-progress max="${total}" value="${elapsed}"></progress>

      <footer class="player-controls">
        <button class="secondary" data-action="previous">${iconBack()}<span>Indietro</span></button>
        <button class="primary" data-action="toggle">${player.paused ? "Riprendi" : "Pausa"}</button>
        <button class="secondary" data-action="next"><span>Salta</span>${iconForward()}</button>
      </footer>
    </main>
  `;

  bindAction("close-player", () => {
    stopPlayer();
    renderRoutine(player.routine);
  });
  bindAction("toggle", togglePlayer);
  bindAction("next", nextSegment);
  bindAction("previous", previousSegment);
  bindAction("player-guide", () => {
    if (!player.paused) togglePlayer();
    else cancelSpeech();
    player.showGuide = !player.showGuide;
    renderPlayer();
  });
  if (player.paused && player.showGuide && visualName) bindGuideAudio(visualName);
}

function buildTimeline(source, level = practiceLevel(source.practice || "fitness")) {
  const routine = routineForLevel(source, level);
  if (routine.practice === "face") return buildFaceTimeline(routine, level);
  const timeline = [];
  addExercisePhase(timeline, routine.warmup, "warmup");

  for (let round = 1; round <= settings.workoutRounds; round += 1) {
    routine.workout.forEach((name, index) => {
      appendExercise(timeline, name, "workout", round, workoutDuration(level));
      const isRoundEnd = index === routine.workout.length - 1;
      const isLastWorkout = round === settings.workoutRounds && isRoundEnd;
      const shouldRest = isRoundEnd || (index + 1) % settings.restEveryExercises === 0;
      if (!isLastWorkout && shouldRest) {
        timeline.push({
          kind: "rest",
          phase: "workout",
          phaseLabel: PHASE_LABELS.workout,
          duration: isRoundEnd ? settings.roundRestDurationSec : settings.restDurationSec,
          betweenRounds: isRoundEnd,
          round,
          nextName: nextWorkoutName(routine.workout, round, index)
        });
      }
    });
  }

  addExercisePhase(timeline, routine.cooldown, "cooldown");
  return timeline.filter((segment) => segment.duration > 0);
}

function faceDose(name, level = practiceLevel("face")) {
  const base = faceData?.exercises?.find(e => e.name === name)?.doses?.advanced;
  if (!base) return null;
  const ratio = LEVELS[level].durationRatio;
  // Change total work through massage time/repetition count, without longer
  // ocular holds, shorter releases or stronger pressure.
  return base.seconds ? { seconds: Math.max(1, Math.round(base.seconds * ratio)) } : { ...base, reps: Math.max(1, Math.round(base.reps * ratio)) };
}

function doseLabel(dose) {
  return dose.seconds ? `${dose.seconds} s · massaggio lento` : `${dose.reps} rip. · ${dose.hold} s gesto / ${dose.release} s rilascio`;
}

function buildFaceTimeline(routine, level = practiceLevel("face")) {
  const timeline = [];
  for (const phase of ["warmup", "workout", "cooldown"]) {
    for (const name of routine[phase]) {
      const dose = faceDose(name, level);
      if (!dose) continue;
      const phaseLabel = exerciseMeta(name).category;
      if (settings.prepareDurationSec > 0) timeline.push({ kind: "prepare", phase, phaseLabel, duration: settings.prepareDurationSec, nextName: name });
      timeline.push({ kind: "exercise", phase, phaseLabel, name, duration: dose.seconds || dose.reps * (dose.hold + dose.release), dose });
    }
  }
  return timeline;
}

function faceRepetitionLabel(segment, elapsed) {
  const dose = segment.dose;
  if (dose.seconds) return "Massaggia lentamente · pressione leggera";
  const cycle = dose.hold + dose.release;
  const rep = Math.min(dose.reps, Math.floor(elapsed / cycle) + 1);
  const inHold = elapsed % cycle < dose.hold;
  return `${rep} / ${dose.reps} · ${inHold ? "Esegui con delicatezza" : "Rilascia e respira"}`;
}

function addExercisePhase(timeline, exercises, phase) {
  exercises.forEach((name) => appendExercise(timeline, name, phase, null));
}

function appendExercise(timeline, name, phase, round, duration = settings[`${phase}DurationSec`]) {
  timeline.push(prepareSegment(name, phase, round));
  timeline.push({ ...exerciseSegment(name, phase, round), duration });
}

function prepareSegment(name, phase, round) {
  return {
    kind: "prepare",
    phase,
    phaseLabel: PHASE_LABELS[phase],
    duration: settings.prepareDurationSec,
    round,
    nextName: name
  };
}

// Choose movement guidance to fit the work interval. Speech never changes timing;
// preparation announces only the name and the complete guide remains available.
function estimatedSpeechSeconds(text) {
  const words = speechParts(text).map(part => part.text).join(" ").trim().split(/\s+/).length;
  return Math.ceil(words / (2 * settings.speechRate));
}

function fitnessNarration(name, phase, duration = settings[`${phase}DurationSec`]) {
  const meta = exerciseMeta(name);
  const guide = exerciseGuide(meta);
  if (meta.practice === "face" || !guide.voice) return null;
  // Use the actual workout dose for the selected level, including custom timing.
  const moveFits = !guide.midpointCue && estimatedSpeechSeconds(guide.voice.move) + 4 <= duration;
  return {
    move: moveFits ? guide.voice.move : guide.voice.short
  };
}

function exerciseSegment(name, phase, round) {
  return {
    kind: "exercise",
    phase,
    phaseLabel: PHASE_LABELS[phase],
    name,
    duration: settings[`${phase}DurationSec`],
    round
  };
}

function startTick() {
  window.clearInterval(player.tickId);
  speakCurrentSegment();
  renderPlayer();
  player.tickId = window.setInterval(() => {
    if (!player.active || player.paused) return;
    const segment = player.timeline[player.index];
    if (!segment) return finishRoutine();
    maybeSpeakCountdown(segment);
    maybeSpeakMidpoint(segment);
    if (remainingSeconds(segment) <= 0) {
      player.index += 1;
      player.segmentStartedAt = Date.now();
      player.elapsedBeforePause = 0;
      player.spokenCountdown = "";
      if (player.index >= player.timeline.length) return finishRoutine();
      speakCurrentSegment();
      renderPlayer();
      return;
    }
    updatePlayerClock(segment);
  }, 250);
}

function updatePlayerClock(segment = player.timeline[player.index]) {
  if (!segment) return;
  const time = document.querySelector("[data-player-time]");
  const ring = document.querySelector("[data-player-ring]");
  const progress = document.querySelector("[data-player-progress]");
  const elapsed = elapsedCurrentSegmentSeconds();
  if (time) {
    time.textContent = String(remainingSeconds(segment));
    time.dataset.playerElapsed = String(elapsed);
  }
  if (ring) ring.style.setProperty("--progress", segmentProgress(segment));
  if (progress) progress.value = elapsedTimelineSeconds();
  const repetition = document.querySelector("[data-face-repetition]");
  if (repetition && segment.dose) repetition.textContent = faceRepetitionLabel(segment, elapsed);
}

function speakCurrentSegment() {
  const segment = player.timeline[player.index];
  if (!segment || player.paused || !settings.voiceEnabled) return;
  const key = `${player.index}:${segment.kind}:${segment.name || segment.nextName || ""}`;
  if (player.spokenSegment === key) return;
  player.spokenSegment = key;
  const parts = [];
  const prepared = segment.kind === "exercise" && player.timeline[player.index - 1]?.kind === "prepare";
  if (segment.kind === "exercise" && elapsedCurrentSegmentSeconds() === 0 && isFirstExerciseOfPhase(player.index)) {
    parts.push(segment.round ? `${roundAnnouncement(segment.round)}. Allenamento` : segment.phaseLabel);
  }
  if (segment.kind === "prepare") {
    parts.push(segment.nextName);
  } else if (segment.kind === "rest") {
    parts.push(segment.betweenRounds ? "Giro completato. Recupera" : "Pausa. Recupera");
    if (settings.nextEnabled && segment.nextName) parts.push(`Dopo la pausa: ${segment.nextName}`);
  } else {
    parts.push(prepared ? "Via" : segment.name);
    if (settings.exerciseCueEnabled) {
      const guide = exerciseGuide(exerciseMeta(segment.name));
      // On resume avoid repeating a long instruction over a nearly finished timer.
      const narration = fitnessNarration(segment.name, segment.phase, segment.duration);
      parts.push(narration ? (elapsedCurrentSegmentSeconds() > 0 ? guide.voice.short : narration.move) : guide.cue);
    }
  }
  speak(speechSentences(parts), { guidance: settings.exerciseCueEnabled && segment.kind === "exercise" });
}

function speechSentences(parts) {
  return parts.filter(Boolean).map(part => part.trim().replace(/[.!?]+$/, "")).join(". ") + ".";
}

function maybeSpeakMidpoint(segment) {
  if (!settings.voiceEnabled || !settings.exerciseCueEnabled || segment.kind !== "exercise") return;
  const cue = exerciseGuide(exerciseMeta(segment.name)).midpointCue;
  if (!cue || player.spokenMidpoint === player.index || elapsedCurrentSegmentSeconds() < segment.duration / 2) return;
  // Never deliver a late side change in the closing countdown, or cut the main guide.
  if (guidanceSpeaking || remainingSeconds(segment) <= 3) return;
  player.spokenMidpoint = player.index;
  speak(cue, { guidance: true });
}

function roundAnnouncement(round) {
  return `${["Primo", "Secondo", "Terzo", "Quarto", "Quinto", "Sesto"][round - 1] || round} giro`;
}

function maybeSpeakCountdown(segment) {
  if (!settings.voiceEnabled || !settings.countdownEnabled) return;
  if (guidanceSpeaking) return;
  const remaining = remainingSeconds(segment);
  if (remaining > 3 || remaining < 1) return;
  const key = `${player.index}:${remaining}`;
  if (player.spokenCountdown === key) return;
  player.spokenCountdown = key;
  speak(String(remaining));
}

// Match complete terms, longest first, so mixed-language exercise names retain
// their Italian directions while the English movement uses an English voice.
const ENGLISH_TERMS = /\b(cossack stretch|plank lean flow|shadow boxing|snow angels|floor angels|back widows|donkey kick|sumo squat|air squat|push[- ]up|bird dog|dead bug|roll down|wall sit|stretching|burpee|crunch|squat|plank)\b/gi;

function speechParts(text) {
  const normalized = text.replace(/90\/90/g, "novanta novanta").replace(/\b2v\b/gi, "seconda variante").replace(/[()]/g, ", ");
  const parts = [];
  let offset = 0;
  for (const match of normalized.matchAll(ENGLISH_TERMS)) {
    if (match.index > offset) parts.push({ text: normalized.slice(offset, match.index), lang: "it-IT" });
    parts.push({ text: match[0].replace(/push up/i, "push-up"), lang: "en-GB" });
    offset = match.index + match[0].length;
  }
  if (offset < normalized.length) parts.push({ text: normalized.slice(offset), lang: "it-IT" });
  return parts.filter((part) => /[\p{L}\p{N}]/u.test(part.text));
}

function availableVoices(language) {
  return (window.speechSynthesis?.getVoices() || []).filter((voice) => voice.lang.toLowerCase().replace("_", "-").startsWith(language));
}

function voiceOptions(key, language) {
  return `<option value="">Automatica · ${language === "it" ? "italiano" : "inglese"}</option>` + availableVoices(language).map((voice) =>
    `<option value="${escapeHtml(voice.voiceURI)}" ${settings[key] === voice.voiceURI ? "selected" : ""}>${escapeHtml(voice.name)} · ${escapeHtml(voice.lang)}</option>`
  ).join("");
}

function voiceSetting(key, label, language) {
  return `<label class="voice-select"><span>${label}</span><select data-setting="${key}" data-voice-language="${language}">${voiceOptions(key, language)}</select></label>`;
}

function updateVoiceOptions() {
  document.querySelectorAll("[data-voice-language]").forEach((select) => {
    select.innerHTML = voiceOptions(select.dataset.setting, select.dataset.voiceLanguage);
  });
}

function cancelSpeech() {
  speechGeneration += 1;
  currentUtterance = null;
  guidanceSpeaking = false;
  window.speechSynthesis?.cancel();
}

function speak(text, { onDone, guidance = false } = {}) {
  cancelSpeech();
  if (!("speechSynthesis" in window)) return;
  guidanceSpeaking = guidance;
  const generation = speechGeneration;
  const parts = speechParts(text);
  const playNext = () => {
    if (generation !== speechGeneration) return;
    const part = parts.shift();
    if (!part) { currentUtterance = null; guidanceSpeaking = false; onDone?.(); return; }
    const utterance = new SpeechSynthesisUtterance(part.text.trim());
    const voices = availableVoices(part.lang.slice(0, 2));
    const preferredURI = part.lang.startsWith("it") ? settings.voiceURI : settings.englishVoiceURI;
    const voice = voices.find((item) => item.voiceURI === preferredURI)
      || voices.find((item) => item.lang === part.lang) || voices[0];
    utterance.lang = voice?.lang || part.lang;
    if (voice) utterance.voice = voice;
    utterance.rate = settings.speechRate;
    utterance.pitch = /^\d+$/.test(part.text.trim()) ? 1 : settings.speechPitch;
    utterance.onend = playNext;
    utterance.onerror = (event) => {
      if (generation !== speechGeneration) return;
      parts.length = 0;
      currentUtterance = null;
      guidanceSpeaking = false;
      const status = document.querySelector("[data-voice-status]");
      if (status) status.textContent = `Lettura non disponibile (${event.error}). Prova un'altra voce del dispositivo.`;
    };
    // Retain a reference for WebKit until speech completes.
    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  };
  playNext();
}

function togglePlayer() {
  if (player.paused) {
    player.showGuide = false;
    player.paused = false;
    player.segmentStartedAt = Date.now() - player.elapsedBeforePause * 1000;
    requestWakeLock();
    player.spokenSegment = "";
    speakCurrentSegment();
  } else {
    cancelSpeech();
    player.elapsedBeforePause = Math.max(elapsedCurrentSegmentSeconds(), displayedElapsedSeconds());
    player.paused = true;
    releaseWakeLock();
  }
  renderPlayer();
}

function displayedElapsedSeconds() {
  const value = Number(document.querySelector("[data-player-time]")?.dataset.playerElapsed);
  const segment = player.timeline[player.index];
  if (!Number.isFinite(value) || !segment) return 0;
  return Math.min(segment.duration, Math.max(0, value));
}

function nextSegment() {
  cancelSpeech();
  player.showGuide = false;
  if (player.index + 1 >= player.timeline.length) return finishRoutine();
  player.index += 1;
  player.segmentStartedAt = Date.now();
  player.elapsedBeforePause = 0;
  player.spokenSegment = "";
  player.spokenCountdown = "";
  player.spokenMidpoint = -1;
  speakCurrentSegment();
  renderPlayer();
}

function previousSegment() {
  cancelSpeech();
  player.showGuide = false;
  player.index = Math.max(0, player.index - 1);
  player.segmentStartedAt = Date.now();
  player.elapsedBeforePause = 0;
  player.spokenSegment = "";
  player.spokenCountdown = "";
  player.spokenMidpoint = -1;
  speakCurrentSegment();
  renderPlayer();
}

function stopPlayer() {
  window.clearInterval(player.tickId);
  cancelSpeech();
  releaseWakeLock();
  player.active = false;
}

function finishRoutine() {
  const routine = player.routine;
  const finishMessage = randomFinishMessage();
  recordCompletedSession(routine);
  stopPlayer();
  saveJson(STORAGE_KEYS.lastRoutine, { week: routine.week, day: routine.day });
  app.innerHTML = `
    <main class="screen done-screen">
      <section>
        <p class="eyebrow">Completata</p>
        <h1>${escapeHtml(routine.title)}</h1>
        <p class="finish-message">${escapeHtml(finishMessage)}</p>
        <p>${routineContext(routine)}</p>
        ${storageNotice()}
      </section>
      <div class="action-row">
        <button class="primary" data-action="again">Ripeti</button>
        <button class="secondary" data-action="home">Routine</button>
      </div>
    </main>
  `;
  if (settings.voiceEnabled) speak(finishMessage);
  bindAction("again", () => startRoutine(routine));
  bindAction("home", renderHome);
}

function segmentTitle(segment) {
  if (segment.kind === "rest") return segment.betweenRounds ? "Recupero tra giri" : "Pausa";
  if (segment.kind === "prepare") return segment.nextName;
  return segment.name;
}

function segmentKindLabel(segment) {
  if (segment.kind === "rest") return segment.betweenRounds ? "Recupero tra giri" : "Pausa";
  if (segment.kind === "prepare") return "Preparazione";
  return "Esercizio";
}

function nextWorkoutName(workout, round, index) {
  if (index + 1 < workout.length) return workout[index + 1];
  if (round < settings.workoutRounds) return workout[0];
  return null;
}

function nextExerciseName(fromIndex) {
  for (let index = fromIndex + 1; index < player.timeline.length; index += 1) {
    const segment = player.timeline[index];
    if (segment.kind === "exercise") return segment.name;
  }
  return "";
}

function exerciseCounter(index) {
  const total = player.timeline.filter((segment) => segment.kind === "exercise").length;
  const segment = player.timeline[index];
  const completedOrCurrent = player.timeline
    .slice(0, index + 1)
    .filter((item) => item.kind === "exercise").length;
  const current = segment?.kind === "prepare" ? completedOrCurrent + 1 : completedOrCurrent;
  return {
    current: Math.min(total, Math.max(1, current)),
    total
  };
}

function isFirstExerciseOfPhase(index) {
  const segment = player.timeline[index];
  if (!segment || segment.kind === "rest") return false;
  for (let i = index - 1; i >= 0; i -= 1) {
    const previous = player.timeline[i];
    if (previous.kind === "exercise") return previous.phase !== segment.phase || previous.round !== segment.round;
  }
  return true;
}

function elapsedCurrentSegmentSeconds() {
  if (player.paused) return player.elapsedBeforePause;
  return Math.floor((Date.now() - player.segmentStartedAt) / 1000);
}

function remainingSeconds(segment) {
  return Math.max(0, segment.duration - elapsedCurrentSegmentSeconds());
}

function segmentProgress(segment) {
  const elapsed = Math.min(segment.duration, elapsedCurrentSegmentSeconds());
  return `${Math.round((elapsed / segment.duration) * 100)}%`;
}

function elapsedTimelineSeconds() {
  const before = player.timeline.slice(0, player.index).reduce((sum, item) => sum + item.duration, 0);
  const current = player.timeline[player.index] || { duration: 0 };
  return before + Math.min(current.duration, elapsedCurrentSegmentSeconds());
}

function routineSummary(routine, level = practiceLevel(routine.practice || "fitness")) {
  const timeline = buildTimeline(routine, level);
  const totalExercises = timeline.filter(s => s.kind === "exercise").length;
  const totalSeconds = timeline.reduce((sum, item) => sum + item.duration, 0);
  return { totalExercises, totalSeconds };
}

function recordCompletedSession(routine) {
  if (!routine || player.sessionRecorded) return;
  const completedAt = new Date();
  const summary = { totalExercises: player.timeline.filter(s => s.kind === "exercise").length, totalSeconds: player.timeline.reduce((sum, s) => sum + s.duration, 0) };
  const sessions = getSessions();
  const session = {
    id: `${completedAt.toISOString()}-${routine.key}`,
    completedAt: completedAt.toISOString(),
    date: localDateKey(completedAt),
    routineKey: routine.key,
    week: routine.week,
    day: routine.day,
    title: routine.title,
    totalExercises: summary.totalExercises,
    totalSeconds: summary.totalSeconds,
    workoutRounds: routine.practice === "face" ? 1 : settings.workoutRounds,
    practice: routine.practice || "fitness",
    intensity: player.level || practiceLevel(routine.practice)
  };
  persistSessions([session, ...sessions]);
  player.sessionRecorded = true;
  calendarMonth = startOfMonth(completedAt);
}

function randomFinishMessage() {
  return FINISH_MESSAGES[Math.floor(Math.random() * FINISH_MESSAGES.length)];
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || player.wakeLock) return;
  try {
    player.wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    player.wakeLock = null;
  }
}

function releaseWakeLock() {
  if (!player.wakeLock) return;
  player.wakeLock.release();
  player.wakeLock = null;
}

function persistRoutineOverride(routine) {
  overrides[routine.key] = {
    warmup: [...routine.warmup],
    workout: [...routine.workout],
    cooldown: [...routine.cooldown]
  };
  routine.hasLocalChanges = true;
  saveJson(STORAGE_KEYS.overrides, overrides);
  exerciseLibrary = buildExerciseLibrary(routines);
}

function exerciseMeta(name) {
  return exerciseLibrary.find((exercise) => exercise.name === name)
    || exerciseData?.exercises?.find((exercise) => exercise.name === name)
    || faceData?.exercises?.find((exercise) => exercise.name === name)
    || { name, category: "Full body", image: "" };
}

function exerciseGuide(exercise) {
  if (exercise.guide) return normalizeGuide(exercise.guide);
  const exactGuide = exerciseGuideData?.exercises?.[exercise.name];
  if (exactGuide) return normalizeGuide(exactGuide);

  const normalizedName = exercise.name.toLowerCase();
  const rule = exerciseGuideData?.rules?.find((item) =>
    item.match?.some((term) => normalizedName.includes(String(term).toLowerCase()))
  );
  if (rule?.guide) return normalizeGuide(rule.guide);

  const categoryGuide = exerciseGuideData?.categories?.[exercise.category];
  if (categoryGuide) return normalizeGuide(categoryGuide);

  return normalizeGuide(exerciseGuideData?.fallback || DEFAULT_EXERCISE_GUIDE);
}

function normalizeGuide(guide) {
  return {
    setup: guide?.setup || "",
    voice: guide?.voice || null,
    midpointCue: guide?.midpointCue || "",
    sourceNote: guide?.sourceNote || "",
    reviewedOn: guide?.reviewedOn || "",
    sources: (guide?.sourceIds || []).map(id => exerciseGuideData?.sources?.[id]).filter(source => source && /^https:\/\//.test(source.url)),
    breath: guide?.breath || "",
    levels: guide?.levels || {},
    imageNote: guide?.imageNote || "",
    summary: guide?.summary || DEFAULT_EXERCISE_GUIDE.summary,
    steps: listOrFallback(guide?.steps, DEFAULT_EXERCISE_GUIDE.steps),
    focus: listOrFallback(guide?.focus, DEFAULT_EXERCISE_GUIDE.focus),
    avoid: listOrFallback(guide?.avoid, DEFAULT_EXERCISE_GUIDE.avoid),
    easier: listOrFallback(guide?.easier, DEFAULT_EXERCISE_GUIDE.easier),
    cue: guide?.cue || DEFAULT_EXERCISE_GUIDE.cue
  };
}

function listOrFallback(value, fallback) {
  return Array.isArray(value) && value.length > 0 ? value : fallback;
}

function exerciseThumb(name) {
  const meta = exerciseMeta(name);
  if (!meta.image) return `<span class="exercise-thumb placeholder"></span>`;
  return `<img class="exercise-thumb" src="${escapeHtml(meta.image)}" alt="">`;
}

function exerciseHero(name) {
  const meta = exerciseMeta(name);
  if (!meta.image) return "";
  return `
    <figure class="exercise-hero">
      <img src="${escapeHtml(meta.image)}" alt="${escapeHtml(meta.imageAlt || meta.name)}">
    </figure>
  `;
}

function findRoutine(week, day) {
  return routines.find((routine) => routine.week === Number(week) && routine.day === Number(day));
}

function routineKey(week, day) {
  return `${week}-${day}`;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthLabel(date) {
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(date);
}

function sessionsForMonth(sessions, date) {
  const prefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return sessions
    .filter((session) => session.date?.startsWith(prefix))
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
}

function formatSessionDate(value) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? clone(fallback);
  } catch {
    return clone(fallback);
  }
}

function normalizeSession(value) {
  if (!value || typeof value !== "object" || typeof value.completedAt !== "string") return null;
  const date = new Date(value.completedAt);
  if (!Number.isFinite(date.getTime()) || typeof value.title !== "string" || value.title.length > 300) return null;
  if (!Number.isInteger(value.week) || !Number.isInteger(value.day) || value.day < 1) return null;
  if (!Number.isFinite(value.totalSeconds) || value.totalSeconds < 0 || !Number.isInteger(value.totalExercises) || value.totalExercises < 0) return null;
  const key = typeof value.routineKey === "string" ? value.routineKey : routineKey(value.week, value.day);
  return {
    id: typeof value.id === "string" && value.id ? value.id : `${value.completedAt}-${key}`,
    completedAt: value.completedAt,
    date: typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : localDateKey(date),
    routineKey: key, week: value.week, day: value.day, title: value.title,
    totalExercises: value.totalExercises, totalSeconds: value.totalSeconds,
    workoutRounds: Number.isInteger(value.workoutRounds) && value.workoutRounds > 0 ? value.workoutRounds : 1,
    practice: value.practice === "face" || value.week === 0 ? "face" : "fitness",
    ...(typeof value.intensity === "string" && Object.hasOwn(LEVELS, value.intensity) ? { intensity: value.intensity } : {})
  };
}

function mergeSessions(...sources) {
  const byId = new Map();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const value of source) {
      const session = normalizeSession(value);
      if (session && !byId.has(session.id)) byId.set(session.id, session);
    }
  }
  return [...byId.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

function getSessions() {
  sessionMemory = mergeSessions(sessionMemory, loadJson(STORAGE_KEYS.sessions, []), loadJson(STORAGE_KEYS.sessionsBackup, []));
  return sessionMemory;
}

async function openHistoryDatabase() {
  if (!("indexedDB" in window)) return null;
  return new Promise(resolve => {
    let request;
    try { request = window.indexedDB.open("fitTimer.history", 1); }
    catch { resolve(null); return; }
    let settled = false;
    const finish = db => {
      if (settled) { db?.close(); return; }
      settled = true;
      window.clearTimeout(timeout);
      resolve(db);
    };
    const timeout = window.setTimeout(() => finish(null), 3000);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("sessions")) request.result.createObjectStore("sessions", { keyPath: "id" });
    };
    request.onsuccess = () => finish(request.result);
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
  });
}

async function restoreHistory() {
  getSessions();
  historyDatabase = await openHistoryDatabase();
  if (historyDatabase) {
    historyDatabase.onversionchange = () => { historyDatabase.close(); historyDatabase = null; };
    try {
      const saved = await new Promise((resolve, reject) => {
        const tx = historyDatabase.transaction("sessions", "readonly");
        const request = tx.objectStore("sessions").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      sessionMemory = mergeSessions(sessionMemory, saved);
    } catch {
      reportStorageProblem("La copia di sicurezza del diario non è accessibile. Esporta un backup dei dati disponibili.");
    }
  }
  if (sessionMemory.length) persistSessions(sessionMemory);
}

function persistSessions(sessions) {
  sessionMemory = mergeSessions(sessions, getSessions());
  const primarySaved = saveJson(STORAGE_KEYS.sessions, sessionMemory);
  const backupSaved = saveJson(STORAGE_KEYS.sessionsBackup, sessionMemory);
  const snapshot = clone(sessionMemory);
  if (!historyDatabase) return Promise.resolve(primarySaved || backupSaved);
  historyWrite = historyWrite.catch(() => false).then(() => new Promise(resolve => {
    try {
      const tx = historyDatabase.transaction("sessions", "readwrite");
      for (const session of snapshot) tx.objectStore("sessions").put(session);
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => {
        reportStorageProblem("La copia di sicurezza del diario non è stata aggiornata. Esporta un backup.");
        resolve(primarySaved || backupSaved);
      };
    } catch {
      reportStorageProblem("La copia di sicurezza del diario non è disponibile. Esporta un backup.");
      resolve(primarySaved || backupSaved);
    }
  }));
  return historyWrite;
}

function storageNotice() {
  return storageWarning ? `<p class="storage-notice" data-storage-notice role="alert">${escapeHtml(storageWarning)}</p>` : "";
}

function reportStorageProblem(message) {
  storageWarning = message;
  const notice = document.querySelector("[data-storage-notice]");
  if (notice) notice.textContent = message;
  else app.insertAdjacentHTML?.("afterbegin", storageNotice());
}

function createBackup() {
  return {
    app: "my-personal-trainer", schemaVersion: 1, exportedAt: new Date().toISOString(),
    sessions: getSessions(), settings: { ...settings }, overrides: clone(overrides),
    lastRoutine: loadJson(STORAGE_KEYS.lastRoutine, null)
  };
}

function parseBackup(value) {
  if (!value || value.app !== "my-personal-trainer" || value.schemaVersion !== 1 || !Array.isArray(value.sessions)) throw new Error("Questo file non è un backup compatibile di My Personal Trainer.");
  if (value.sessions.some(session => !normalizeSession(session))) throw new Error("Il backup contiene sessioni non valide. Nessun dato è stato modificato.");
  const importedSettings = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (value.settings && Object.hasOwn(value.settings, key)) importedSettings[key] = value.settings[key];
  }
  const importedOverrides = {};
  for (const routine of routines) {
    const override = value.overrides?.[routine.key];
    if (!override) continue;
    const phases = {};
    for (const phase of ["warmup", "workout", "cooldown"]) {
      if (!Array.isArray(override[phase]) || override[phase].length > 200 || override[phase].some(name => typeof name !== "string" || !exerciseLibrary.some(e => e.name === name && (e.practice || "fitness") === (routine.practice || "fitness")))) throw new Error("Il backup contiene una routine non valida. Nessun dato è stato modificato.");
      phases[phase] = [...override[phase]];
    }
    importedOverrides[routine.key] = phases;
  }
  const last = value.lastRoutine;
  return {
    sessions: mergeSessions(value.sessions), settings: importedSettings, overrides: importedOverrides,
    lastRoutine: last && findRoutine(last.week, last.day) ? { week: Number(last.week), day: Number(last.day) } : null
  };
}

async function applyBackup(backup) {
  const before = getSessions().length;
  const stored = await persistSessions(mergeSessions(getSessions(), backup.sessions));
  if (!stored) throw new Error("Il dispositivo non riesce a salvare i dati. Conserva il file di backup e libera spazio prima di riprovare.");
  settings = normalizeSettings({ ...settings, ...backup.settings });
  overrides = { ...overrides, ...backup.overrides };
  saveJson(STORAGE_KEYS.overrides, overrides);
  if (backup.lastRoutine) { selected = backup.lastRoutine; saveJson(STORAGE_KEYS.lastRoutine, selected); }
  rebuildRoutines();
  exerciseLibrary = buildExerciseLibrary(routines);
  return getSessions().length - before;
}

function renderBackup() {
  let pending = null;
  app.innerHTML = `<main class="screen">
    <header class="topbar"><button class="icon-button" data-action="calendar" aria-label="Torna al calendario">${iconBack()}</button><div><p class="eyebrow">Il tuo diario, nel tempo</p><h1>Backup e ripristino</h1></div></header>
    ${storageNotice()}
    <section class="guide-panel"><h2>${getSessions().length} ${getSessions().length === 1 ? "sessione" : "sessioni"} da custodire</h2><p>Fitness e yoga facciale condividono lo stesso storico. Gli aggiornamenti mantengono i dati salvati e una copia locale di recupero.</p><p>I dati appartengono a questo browser e indirizzo dell’app. Per cambiare telefono, browser o indirizzo, esporta qui il backup e importalo nella nuova installazione. La cancellazione dei dati del sito elimina anche le copie locali.</p></section>
    <section class="backup-actions"><button class="primary" data-action="export">Esporta tutti i dati</button><label class="secondary import-label">Scegli un backup<input id="backup-file" type="file" accept="application/json,.json"></label></section>
    <p class="section-note">Il file contiene storico, livelli, impostazioni e routine personalizzate. Conservalo tra i tuoi file personali.</p>
    <p data-backup-status role="status" class="backup-status"></p>
    <button class="primary" data-action="apply-import" hidden>Unisci storico e ripristina impostazioni</button>
    <section class="guide-panel"><h2>Protezione sul dispositivo</h2><p>Puoi chiedere al browser di conservare i dati dell’app più a lungo. La disponibilità dipende dal dispositivo.</p><button class="secondary" data-action="persist">Proteggi i dati locali</button></section>
    <p class="section-note">Se lo storico manca, apri l’installazione precedente e prova a esportarlo. Un backup può recuperare i dati anche dopo un cambio di indirizzo; i dati già cancellati e privi di copie non sono ricostruibili.</p>
  </main>`;
  const status = () => document.querySelector("[data-backup-status]");
  bindAction("calendar", renderCalendar);
  bindAction("export", () => {
    const blob = new Blob([JSON.stringify(createBackup(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `my-personal-trainer-backup-${localDateKey(new Date())}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    status().textContent = "Backup preparato. Conserva il file scaricato prima di cambiare installazione.";
  });
  bind("#backup-file", "change", async event => {
    pending = null;
    const button = document.querySelector('[data-action="apply-import"]');
    button.hidden = true;
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("Il file è troppo grande (massimo 20 MB).");
      pending = parseBackup(JSON.parse(await file.text()));
      const additions = mergeSessions(getSessions(), pending.sessions).length - getSessions().length;
      status().textContent = `${pending.sessions.length} sessioni nel backup, ${additions} da aggiungere. Lo storico esistente viene conservato. Impostazioni e routine presenti nel backup verranno ripristinate.`;
      button.hidden = false;
    } catch (error) { status().textContent = error.message || "Impossibile leggere il backup."; }
  });
  bindAction("apply-import", async event => {
    if (!pending) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const count = await applyBackup(pending);
      pending = null;
      button.hidden = true;
      status().textContent = `Ripristino completato: ${count} sessioni aggiunte. Totale: ${getSessions().length}.`;
    } catch (error) { status().textContent = error.message; }
    finally { button.disabled = false; }
  });
  bindAction("persist", async () => {
    try {
      const granted = await navigator.storage?.persist?.();
      status().textContent = granted ? "Il browser ha attivato la conservazione persistente. Mantieni anche un backup esportato." : "Il browser non ha concesso la protezione persistente. Usa il backup esportato.";
    } catch { status().textContent = "Protezione non disponibile. Usa il backup esportato."; }
  });
}

function normalizeSettings(value) {
  const legacy = value && typeof value === "object" ? value : {};
  const next = { ...DEFAULT_SETTINGS, ...legacy };
  const limits = {
    warmupDurationSec: [5, 300, 5], workoutDurationSec: [5, 300, 5], cooldownDurationSec: [5, 300, 5],
    prepareDurationSec: [0, 120, 5], restEveryExercises: [1, 10, 1], restDurationSec: [0, 300, 5],
    roundRestDurationSec: [0, 300, 5], workoutRounds: [1, 6, 1], speechRate: [0.6, 1.4, 0.1], speechPitch: [0.7, 1.3, 0.1]
  };
  for (const phase of ["warmup", "workout", "cooldown"]) {
    const key = `${phase}DurationSec`;
    if (!(key in legacy) && legacy.exerciseDurationSec != null) next[key] = legacy.exerciseDurationSec;
  }
  if (!("roundRestDurationSec" in legacy) && legacy.restDurationSec != null) next.roundRestDurationSec = legacy.restDurationSec;
  for (const [key, [min, max, step]] of Object.entries(limits)) {
    const number = Number(next[key]);
    next[key] = Number.isFinite(number) ? Number((Math.round(Math.max(min, Math.min(max, number)) / step) * step).toFixed(1)) : DEFAULT_SETTINGS[key];
  }
  for (const key of ["voiceEnabled", "countdownEnabled", "nextEnabled", "exerciseCueEnabled"]) {
    if (typeof next[key] !== "boolean") next[key] = DEFAULT_SETTINGS[key];
  }
  for (const key of ["voiceURI", "englishVoiceURI"]) {
    if (typeof next[key] !== "string") next[key] = "";
  }
  for (const key of ["intensity", "faceIntensity"]) {
    if (legacy.intensityModelVersion !== 2 || typeof next[key] !== "string" || !Object.hasOwn(LEVELS, next[key])) next[key] = "advanced";
  }
  next.intensityModelVersion = 2;
  delete next.exerciseDurationSec;
  delete next.changeDurationSec;
  saveJson(STORAGE_KEYS.settings, next);
  return next;
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    reportStorageProblem("Il dispositivo non riesce a salvare tutti i dati. Non chiudere l’app: esporta un backup dal calendario.");
    return false;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function bind(selector, eventName, handler) {
  document.querySelectorAll(selector).forEach((element) => element.addEventListener(eventName, handler));
}

function bindAction(action, handler) {
  bind(`[data-action="${action}"]`, "click", handler);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function iconBack() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>`;
}

function iconMovement() {
  return `<img src="assets/exercises/air-squat.png" alt="" class="practice-art">`;
}

function iconFace() {
  return `<img src="assets/exercises/face-corona.png" alt="" class="practice-art">`;
}

function iconForward() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;
}

function iconGear() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.4-.2-.1a1.7 1.7 0 0 0-2 .1 7.2 7.2 0 0 1-1.7 1 1.7 1.7 0 0 0-1.2 1.6v.2H8.8V23a1.7 1.7 0 0 0-1.1-1.6 7.2 7.2 0 0 1-1.8-1 1.7 1.7 0 0 0-2-.1l-.2.1-2-3.4.1-.1A1.7 1.7 0 0 0 2.1 15a7.6 7.6 0 0 1 0-2 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3.4.2.1a1.7 1.7 0 0 0 2-.1 7.2 7.2 0 0 1 1.8-1A1.7 1.7 0 0 0 8.8 5V4.8h4.4V5a1.7 1.7 0 0 0 1.2 1.6 7.2 7.2 0 0 1 1.7 1 1.7 1.7 0 0 0 2 .1l.2-.1 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.9 7.6 7.6 0 0 1 0 2z"/></svg>`;
}

function iconCalendar() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 10h18"/><path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/></svg>`;
}

function iconBook() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/><path d="M8 6h8"/></svg>`;
}

function iconInfo() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v-6"/><path d="M12 7h.01"/><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"/></svg>`;
}

function iconTrash() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg>`;
}
