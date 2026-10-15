const app = document.querySelector("#app");

const STORAGE_KEYS = {
  settings: "fitTimer.settings",
  overrides: "fitTimer.routineOverrides",
  lastRoutine: "fitTimer.lastRoutine",
  sessions: "fitTimer.sessions"
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
  exerciseCueEnabled: false,
  speechRate: 1,
  speechPitch: 1,
  voiceURI: "",
  englishVoiceURI: ""
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
let settings = normalizeSettings(loadJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS));
let overrides = loadJson(STORAGE_KEYS.overrides, {});
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
  const [routinePayload, exercisePayload, guidePayload] = await Promise.all([
    fetch("data/routines.json").then((response) => response.json()),
    fetch("data/exercise-library.json").then((response) => response.json()),
    fetch("data/exercise-guides.json").then((response) => response.json())
  ]);
  sourceData = routinePayload;
  exerciseData = exercisePayload;
  exerciseGuideData = guidePayload;
  routines = flattenRoutines(sourceData);
  applyRoutineOverrides();
  exerciseLibrary = buildExerciseLibrary(routines);
  exerciseCategories = ["Tutti", ...exerciseData.categories];
  selected = loadJson(STORAGE_KEYS.lastRoutine, selected);
  if (!findRoutine(selected.week, selected.day)) selected = { week: 1, day: 1 };
  registerServiceWorker();
  window.speechSynthesis?.addEventListener("voiceschanged", updateVoiceOptions);
  renderHome();
}

function flattenRoutines(data) {
  return data.weeks.flatMap((week) =>
    week.days.map((day) => ({
      ...day,
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
  const metaByName = new Map((exerciseData?.exercises || []).map((exercise) => [exercise.name, exercise]));
  const names = new Set();
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
  const last = loadJson(STORAGE_KEYS.lastRoutine, null);
  const currentWeek = selected.week;
  const weekRoutines = routines.filter((routine) => routine.week === currentWeek);
  const lastRoutine = last && findRoutine(last.week, last.day);

  app.innerHTML = `
    <main class="screen home-screen">
      <header class="topbar">
        <div>
          <p class="eyebrow">My Personal Trainer</p>
          <h1>Il tuo spazio.<br>Il tuo <em>ritmo.</em></h1>
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
    renderHome();
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
}

function renderCalendar() {
  const sessions = loadJson(STORAGE_KEYS.sessions, []);
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
        <small>${formatSessionDate(session.completedAt)} · Settimana ${session.week}, giorno ${session.day}</small>
      </span>
      <span class="session-metrics">${session.totalExercises} es. · ${formatTime(session.totalSeconds)}</span>
    </button>
  `;
}

function routineCard(routine) {
  const summary = routineSummary(routine);
  return `
    <button class="routine-card" data-routine="${routine.week}-${routine.day}">
      <span class="day-index"><small>GIORNO</small>${String(routine.day).padStart(2, "0")}</span>
      <span class="routine-body">
        <span class="routine-title">${escapeHtml(routine.title)}</span>
        <span class="routine-meta">${summary.totalExercises} esercizi <i>·</i> ${formatTime(summary.totalSeconds)} min <i>·</i> ${settings.workoutRounds} giri</span>
        ${routine.extractionStatus === "generated-from-week-4-pattern" ? `<span class="status-pill">Generata</span>` : ""}
        ${routine.hasLocalChanges ? `<span class="status-pill local">Modificata</span>` : ""}
      </span>
      <span class="routine-arrow" aria-hidden="true">${iconForward()}</span>
    </button>
  `;
}

function renderRoutine(routine) {
  if (!routine) return renderHome();
  const summary = routineSummary(routine);
  app.innerHTML = `
    <main class="screen">
      <header class="topbar">
        <button class="icon-button" data-action="home" aria-label="Indietro" title="Indietro">${iconBack()}</button>
        <div>
          <p class="eyebrow">Settimana ${routine.week}, giorno ${routine.day}</p>
          <h1>${escapeHtml(routine.title)}</h1>
        </div>
      </header>

      <section class="stats-grid">
        <div><span>${summary.totalExercises}</span><small>Esercizi</small></div>
        <div><span>${formatTime(summary.totalSeconds)}</span><small>Stimati</small></div>
        <div><span>${settings.workoutRounds}</span><small>Giri</small></div>
      </section>

      <section class="action-row">
        <button class="primary" data-action="start">Avvia</button>
        <button class="secondary" data-action="edit">Modifica</button>
      </section>

      <button class="routine-timing-link" data-action="timing">Tempi e voce ${iconForward()}</button>
      ${phasePreview("Riscaldamento", routine.warmup, "warmup")}
      ${phasePreview("Allenamento", routine.workout, "workout")}
      ${phasePreview("Defaticamento", routine.cooldown, "cooldown")}
    </main>
  `;

  bindAction("home", renderHome);
  bindAction("start", () => startRoutine(routine));
  bindAction("edit", () => renderEditor(routine));
  bindAction("timing", () => renderSettings(routine));
  bind("[data-guide]", "click", (event) => {
    openExerciseDetail(decodeURIComponent(event.currentTarget.dataset.guide), {
      screen: "routine",
      week: routine.week,
      day: routine.day
    });
  });
}

function phasePreview(label, items, phase) {
  return `
    <section class="phase-block">
      <header>
        <h2>${label}</h2>
        <span>${items.length} es. · ${settings[`${phase}DurationSec`]} s${phase === "workout" ? ` · ${settings.workoutRounds} giri` : ""}</span>
      </header>
      <ol>
        ${items.map((name) => `
          <li>
            ${exerciseThumb(name)}
            <span>${escapeHtml(name)}</span>
            <button class="icon-button mini" data-guide="${encodeURIComponent(name)}" aria-label="Guida ${escapeHtml(name)}" title="Guida esercizio">${iconInfo()}</button>
          </li>
        `).join("")}
      </ol>
    </section>
  `;
}

function renderExerciseLibrary() {
  const filteredExercises = exerciseLibrary.filter((exercise) => libraryCategory === "Tutti" || exercise.category === libraryCategory);

  app.innerHTML = `
    <main class="screen">
      <header class="topbar">
        <button class="icon-button" data-action="home" aria-label="Indietro" title="Indietro">${iconBack()}</button>
        <div>
          <p class="eyebrow">Guida esecuzione</p>
          <h1>Libreria esercizi</h1>
        </div>
      </header>

      <section class="library-filter">
        <select id="libraryCategory" aria-label="Categoria esercizi">
          ${exerciseCategories.map((category) => `<option value="${escapeHtml(category)}" ${category === libraryCategory ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
        </select>
      </section>

      <section class="exercise-library-list">
        ${filteredExercises.map((exercise) => `
          <button class="exercise-card" data-exercise="${encodeURIComponent(exercise.name)}">
            ${exerciseThumb(exercise.name)}
            <span>
              <strong>${escapeHtml(exercise.name)}</strong>
              <small>${escapeHtml(exercise.category)}</small>
            </span>
            ${iconForward()}
          </button>
        `).join("")}
      </section>
    </main>
  `;

  bindAction("home", renderHome);
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

      <section class="guide-panel">
        <p>${escapeHtml(guide.summary)}</p>
      </section>

      <section class="guide-grid">
        ${guideBlock("Esecuzione", guide.steps)}
        ${guideBlock("Focus", guide.focus)}
        ${guideBlock("Evita", guide.avoid)}
        ${guideBlock("Variante facile", guide.easier)}
      </section>

      <section class="voice-cue">
        <span>Suggerimento vocale</span>
        <p>${escapeHtml(guide.cue)}</p>
      </section>
    </main>
  `;

  bindAction("back", () => {
    if (exerciseDetailBack.screen === "routine") {
      renderRoutine(findRoutine(exerciseDetailBack.week, exerciseDetailBack.day));
      return;
    }
    renderExerciseLibrary();
  });
}

function guideBlock(title, items) {
  return `
    <article class="guide-block">
      <h2>${title}</h2>
      <ul>
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
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

      <section class="settings-panel">
        <h2 class="section-title"><span>01</span> Il tuo ritmo</h2>
        <p class="section-note">Durata di ogni esercizio, distinta per fase.</p>
        ${numberSetting("warmupDurationSec", "Riscaldamento", 5, 300, 5)}
        ${numberSetting("workoutDurationSec", "Allenamento", 5, 300, 5)}
        ${numberSetting("cooldownDurationSec", "Defaticamento", 5, 300, 5)}
      </section>
      <section class="settings-panel">
        <h2 class="section-title"><span>02</span> Passaggi e recupero</h2>
        ${numberSetting("prepareDurationSec", "Preparazione esercizio", 0, 120, 5)}
        ${numberSetting("restEveryExercises", "Pausa ogni", 1, 10, 1)}
        ${numberSetting("restDurationSec", "Pausa tra esercizi", 0, 300, 5)}
        ${numberSetting("roundRestDurationSec", "Recupero tra giri", 0, 300, 5)}
        ${numberSetting("workoutRounds", "Giri di allenamento", 1, 6, 1)}
        <p class="section-note">Il recupero tra giri sostituisce la pausa tra esercizi. Riscaldamento e defaticamento non hanno pause di recupero.</p>
      </section>
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
        ${toggleSetting("exerciseCueEnabled", "Suggerimenti vocali esercizio")}
      </section>

      <section class="action-row">
        <button class="secondary" data-action="reset-settings">Ripristina</button>
      </section>
    </main>
  `;

  bindAction("home", () => { cancelSpeech(); back(); });
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
  const phaseExercises = exerciseLibrary.filter((exercise) => exercise.phases?.includes(editorPhase));
  const availableCategories = ["Tutti", ...new Set(phaseExercises.map((exercise) => exercise.category))];
  if (!availableCategories.includes(editorCategory)) editorCategory = "Tutti";
  const filteredExercises = phaseExercises.filter((exercise) => editorCategory === "Tutti" || exercise.category === editorCategory);
  app.innerHTML = `
    <main class="screen">
      <header class="topbar">
        <button class="icon-button" data-action="back-routine" aria-label="Indietro" title="Indietro">${iconBack()}</button>
        <div>
          <p class="eyebrow">Settimana ${routine.week}, giorno ${routine.day}</p>
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
    routines = flattenRoutines(sourceData);
    applyRoutineOverrides();
    exerciseLibrary = buildExerciseLibrary(routines);
    renderRoutine(findRoutine(routine.week, routine.day));
  });
}

function startRoutine(routine) {
  player.routine = routine;
  player.timeline = buildTimeline(routine);
  player.index = 0;
  player.paused = false;
  player.active = true;
  player.elapsedBeforePause = 0;
  player.segmentStartedAt = Date.now();
  player.spokenSegment = "";
  player.spokenCountdown = "";
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
}

function buildTimeline(routine) {
  const timeline = [];
  addExercisePhase(timeline, routine.warmup, "warmup");

  for (let round = 1; round <= settings.workoutRounds; round += 1) {
    routine.workout.forEach((name, index) => {
      appendExercise(timeline, name, "workout", round);
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

function addExercisePhase(timeline, exercises, phase) {
  exercises.forEach((name) => appendExercise(timeline, name, phase, null));
}

function appendExercise(timeline, name, phase, round) {
  timeline.push(prepareSegment(name, phase, round));
  timeline.push(exerciseSegment(name, phase, round));
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
}

function speakCurrentSegment() {
  const segment = player.timeline[player.index];
  if (!segment || player.paused || !settings.voiceEnabled) return;
  const key = `${player.index}:${segment.kind}:${segment.name || segment.nextName || ""}`;
  if (player.spokenSegment === key) return;
  player.spokenSegment = key;
  const parts = [];
  const prepared = segment.kind === "exercise" && player.timeline[player.index - 1]?.kind === "prepare";
  if (segment.kind !== "rest" && !prepared && isFirstExerciseOfPhase(player.index)) {
    parts.push(segment.round ? `${roundAnnouncement(segment.round)}. Allenamento` : segment.phaseLabel);
  }
  if (segment.kind === "prepare") {
    parts.push(`Preparati: ${segment.nextName}`);
  } else if (segment.kind === "rest") {
    parts.push(segment.betweenRounds ? "Giro completato. Recupera" : "Pausa. Recupera");
    if (settings.nextEnabled && segment.nextName) parts.push(`Dopo la pausa: ${segment.nextName}`);
  } else {
    parts.push(prepared ? "Via" : segment.name);
    if (settings.exerciseCueEnabled) parts.push(exerciseGuide(exerciseMeta(segment.name)).cue);
  }
  speak(parts.join(". ") + ".");
}

function roundAnnouncement(round) {
  return `${["Primo", "Secondo", "Terzo", "Quarto", "Quinto", "Sesto"][round - 1] || round} giro`;
}

function maybeSpeakCountdown(segment) {
  if (!settings.voiceEnabled || !settings.countdownEnabled) return;
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
  window.speechSynthesis?.cancel();
}

function speak(text) {
  cancelSpeech();
  if (!("speechSynthesis" in window)) return;
  const generation = speechGeneration;
  const parts = speechParts(text);
  const playNext = () => {
    if (generation !== speechGeneration) return;
    const part = parts.shift();
    if (!part) { currentUtterance = null; return; }
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
  if (player.index + 1 >= player.timeline.length) return finishRoutine();
  player.index += 1;
  player.segmentStartedAt = Date.now();
  player.elapsedBeforePause = 0;
  player.spokenSegment = "";
  player.spokenCountdown = "";
  speakCurrentSegment();
  renderPlayer();
}

function previousSegment() {
  cancelSpeech();
  player.index = Math.max(0, player.index - 1);
  player.segmentStartedAt = Date.now();
  player.elapsedBeforePause = 0;
  player.spokenSegment = "";
  player.spokenCountdown = "";
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
        <p>Settimana ${routine.week}, giorno ${routine.day}</p>
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

function routineSummary(routine) {
  const totalExercises = routine.warmup.length + routine.workout.length * settings.workoutRounds + routine.cooldown.length;
  const totalSeconds = buildTimeline(routine).reduce((sum, item) => sum + item.duration, 0);
  return { totalExercises, totalSeconds };
}

function recordCompletedSession(routine) {
  if (!routine) return;
  const completedAt = new Date();
  const summary = routineSummary(routine);
  const sessions = loadJson(STORAGE_KEYS.sessions, []);
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
    workoutRounds: settings.workoutRounds
  };
  saveJson(STORAGE_KEYS.sessions, [session, ...sessions].slice(0, 500));
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
    || { name, category: "Full body", image: "" };
}

function exerciseGuide(exercise) {
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
      <img src="${escapeHtml(meta.image)}" alt="">
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
  delete next.exerciseDurationSec;
  delete next.changeDurationSec;
  saveJson(STORAGE_KEYS.settings, next);
  return next;
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
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
