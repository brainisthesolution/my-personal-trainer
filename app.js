const app = document.querySelector("#app");

const STORAGE_KEYS = {
  settings: "fitTimer.settings",
  overrides: "fitTimer.routineOverrides",
  lastRoutine: "fitTimer.lastRoutine"
};

const DEFAULT_SETTINGS = {
  exerciseDurationSec: 30,
  changeDurationSec: 10,
  restEveryExercises: 2,
  restDurationSec: 30,
  workoutRounds: 2,
  voiceEnabled: true,
  countdownEnabled: true,
  nextEnabled: true,
  speechRate: 1
};

const PHASE_LABELS = {
  warmup: "Riscaldamento",
  workout: "Allenamento",
  cooldown: "Defaticamento"
};

let sourceData = null;
let exerciseData = null;
let settings = loadJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
let overrides = loadJson(STORAGE_KEYS.overrides, {});
let routines = [];
let exerciseLibrary = [];
let exerciseCategories = [];
let selected = { week: 1, day: 1 };
let editorPhase = "workout";
let editorCategory = "Tutti";

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
  const [routinePayload, exercisePayload] = await Promise.all([
    fetch("data/routines.json").then((response) => response.json()),
    fetch("data/exercise-library.json").then((response) => response.json())
  ]);
  sourceData = routinePayload;
  exerciseData = exercisePayload;
  routines = flattenRoutines(sourceData);
  applyRoutineOverrides();
  exerciseLibrary = buildExerciseLibrary(routines);
  exerciseCategories = ["Tutti", ...exerciseData.categories];
  selected = loadJson(STORAGE_KEYS.lastRoutine, selected);
  if (!findRoutine(selected.week, selected.day)) selected = { week: 1, day: 1 };
  registerServiceWorker();
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
    <main class="screen">
      <header class="topbar">
        <div>
          <p class="eyebrow">My Personal Trainer</p>
          <h1>Allenamenti</h1>
        </div>
        <button class="icon-button" data-action="settings" aria-label="Impostazioni" title="Impostazioni">
          ${iconGear()}
        </button>
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

      <nav class="week-tabs" aria-label="Settimane">
        ${[1, 2, 3, 4].map((week) => `
          <button class="${week === currentWeek ? "active" : ""}" data-week="${week}">S${week}</button>
        `).join("")}
      </nav>

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
  bindAction("settings", renderSettings);
  bindAction("open-last", () => renderRoutine(lastRoutine));
}

function routineCard(routine) {
  const counts = `${routine.warmup.length} / ${routine.workout.length} / ${routine.cooldown.length}`;
  return `
    <button class="routine-card" data-routine="${routine.week}-${routine.day}">
      <span class="day-pill">Giorno ${routine.day}</span>
      <span class="routine-title">${escapeHtml(routine.title)}</span>
      <span class="routine-meta">${counts}</span>
      ${routine.extractionStatus === "generated-from-week-4-pattern" ? `<span class="status-pill">Generata</span>` : ""}
      ${routine.hasLocalChanges ? `<span class="status-pill local">Modificata</span>` : ""}
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

      ${phasePreview("Riscaldamento", routine.warmup)}
      ${phasePreview("Allenamento", routine.workout)}
      ${phasePreview("Defaticamento", routine.cooldown)}
    </main>
  `;

  bindAction("home", renderHome);
  bindAction("start", () => startRoutine(routine));
  bindAction("edit", () => renderEditor(routine));
}

function phasePreview(label, items) {
  return `
    <section class="phase-block">
      <header>
        <h2>${label}</h2>
        <span>${items.length}</span>
      </header>
      <ol>
        ${items.map((name) => `
          <li>
            ${exerciseThumb(name)}
            <span>${escapeHtml(name)}</span>
          </li>
        `).join("")}
      </ol>
    </section>
  `;
}

function renderSettings() {
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
        ${numberSetting("exerciseDurationSec", "Durata esercizio", 5, 300, 5)}
        ${numberSetting("changeDurationSec", "Cambio esercizio", 0, 120, 5)}
        ${numberSetting("restEveryExercises", "Pausa ogni", 1, 10, 1)}
        ${numberSetting("restDurationSec", "Durata pausa", 0, 300, 5)}
        ${numberSetting("workoutRounds", "Ripetizioni routine", 1, 6, 1)}
        ${numberSetting("speechRate", "Velocità voce", 0.6, 1.4, 0.1)}
      </section>

      <section class="settings-panel toggles">
        ${toggleSetting("voiceEnabled", "Voce")}
        ${toggleSetting("countdownEnabled", "Countdown")}
        ${toggleSetting("nextEnabled", "Prossimo esercizio")}
      </section>

      <section class="action-row">
        <button class="secondary" data-action="reset-settings">Ripristina</button>
      </section>
    </main>
  `;

  bindAction("home", renderHome);
  bind("[data-setting]", "input", (event) => {
    const key = event.currentTarget.dataset.setting;
    const value = event.currentTarget.type === "checkbox"
      ? event.currentTarget.checked
      : Number(event.currentTarget.value);
    settings = { ...settings, [key]: value };
    saveJson(STORAGE_KEYS.settings, settings);
    const output = document.querySelector(`[data-output="${key}"]`);
    if (output) output.textContent = settingDisplay(key, value);
  });
  bindAction("reset-settings", () => {
    settings = { ...DEFAULT_SETTINGS };
    saveJson(STORAGE_KEYS.settings, settings);
    renderSettings();
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
  const nextExercise = nextExerciseName(player.index);
  const visualName = segment.kind === "exercise" ? segment.name : segment.nextName;

  app.innerHTML = `
    <main class="player-screen ${segment.kind}">
      <header class="player-top">
        <button class="icon-button ghost" data-action="close-player" aria-label="Chiudi" title="Chiudi">${iconBack()}</button>
        <div>
          <p>${segment.phaseLabel}${segment.round ? `, giro ${segment.round} di ${settings.workoutRounds}` : ""}</p>
          <strong>${Math.min(player.index + 1, player.timeline.length)} / ${player.timeline.length}</strong>
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
      timeline.push(exerciseSegment(name, "workout", round));
      const isLastWorkout = round === settings.workoutRounds && index === routine.workout.length - 1;
      if (!isLastWorkout) {
        const shouldRest = (index + 1) % settings.restEveryExercises === 0;
        timeline.push({
          kind: shouldRest ? "rest" : "change",
          phase: "workout",
          phaseLabel: PHASE_LABELS.workout,
          duration: shouldRest ? settings.restDurationSec : settings.changeDurationSec,
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
  exercises.forEach((name, index) => {
    timeline.push(exerciseSegment(name, phase, null));
    if (index < exercises.length - 1 && settings.changeDurationSec > 0) {
      timeline.push({
        kind: "change",
        phase,
        phaseLabel: PHASE_LABELS[phase],
        duration: settings.changeDurationSec,
        nextName: exercises[index + 1]
      });
    }
  });
}

function exerciseSegment(name, phase, round) {
  return {
    kind: "exercise",
    phase,
    phaseLabel: PHASE_LABELS[phase],
    name,
    duration: settings.exerciseDurationSec,
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
  if (!segment || !settings.voiceEnabled) return;
  const key = `${player.index}:${segment.kind}:${segment.name || ""}`;
  if (player.spokenSegment === key) return;
  player.spokenSegment = key;
  const parts = [];
  if (segment.kind === "exercise" && isFirstExerciseOfPhase(player.index)) {
    parts.push(segment.round ? `Allenamento, giro ${segment.round} di ${settings.workoutRounds}` : segment.phaseLabel);
  }
  parts.push(segmentTitle(segment));
  if (settings.nextEnabled && segment.nextName) parts.push(`Prossimo: ${segment.nextName}`);
  speak(parts.join(". "));
}

function maybeSpeakCountdown(segment) {
  if (!settings.voiceEnabled || !settings.countdownEnabled) return;
  const remaining = remainingSeconds(segment);
  if (remaining > 3 || remaining < 1) return;
  const key = `${player.index}:${remaining}`;
  if (player.spokenCountdown === key) return;
  player.spokenCountdown = key;
  speak(String(remaining), true);
}

function speak(text, interrupt = false) {
  if (!("speechSynthesis" in window)) return;
  if (interrupt) window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "it-IT";
  utterance.rate = settings.speechRate;
  window.speechSynthesis.speak(utterance);
}

function togglePlayer() {
  if (player.paused) {
    player.paused = false;
    player.segmentStartedAt = Date.now() - player.elapsedBeforePause * 1000;
    requestWakeLock();
  } else {
    player.paused = true;
    player.elapsedBeforePause = Math.max(elapsedCurrentSegmentSeconds(), displayedElapsedSeconds());
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
  player.index = Math.min(player.timeline.length - 1, player.index + 1);
  player.segmentStartedAt = Date.now();
  player.elapsedBeforePause = 0;
  player.spokenSegment = "";
  player.spokenCountdown = "";
  speakCurrentSegment();
  renderPlayer();
}

function previousSegment() {
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
  window.speechSynthesis?.cancel();
  releaseWakeLock();
  player.active = false;
}

function finishRoutine() {
  const routine = player.routine;
  stopPlayer();
  saveJson(STORAGE_KEYS.lastRoutine, { week: routine.week, day: routine.day });
  app.innerHTML = `
    <main class="screen done-screen">
      <section>
        <p class="eyebrow">Completata</p>
        <h1>${escapeHtml(routine.title)}</h1>
        <p>Settimana ${routine.week}, giorno ${routine.day}</p>
      </section>
      <div class="action-row">
        <button class="primary" data-action="again">Ripeti</button>
        <button class="secondary" data-action="home">Routine</button>
      </div>
    </main>
  `;
  bindAction("again", () => startRoutine(routine));
  bindAction("home", renderHome);
}

function segmentTitle(segment) {
  if (segment.kind === "rest") return "Pausa";
  if (segment.kind === "change") return "Cambio esercizio";
  return segment.name;
}

function segmentKindLabel(segment) {
  if (segment.kind === "rest") return "Pausa";
  if (segment.kind === "change") return "Cambio";
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

function isFirstExerciseOfPhase(index) {
  const segment = player.timeline[index];
  if (!segment || segment.kind !== "exercise") return false;
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

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? clone(fallback);
  } catch {
    return clone(fallback);
  }
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

function iconTrash() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg>`;
}
