const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function appContext(saved = {}) {
  const spoken = [];
  const storage = new Map(Object.entries(saved));
  let cancelled = 0;
  let tick;
  const root = { innerHTML: '' };
  const context = vm.createContext({
    console, Date, Intl,
    document: { querySelector: (s) => s === '#app' ? root : null, querySelectorAll: () => [] },
    localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    navigator: {},
    window: {
      clearInterval() {}, setInterval(fn) { tick = fn; return 1; },
      speechSynthesis: {
        cancel() { cancelled++; },
        speak(u) { spoken.push(u); },
        getVoices() { return [{ lang: 'it-IT', voiceURI: 'it', name: 'Italiano' }, { lang: 'en-GB', voiceURI: 'en', name: 'English' }]; }
      }
    },
    SpeechSynthesisUtterance: function(text) { this.text = text; }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../app.js'), 'utf8').replace('\ninit();', '\n'), context);
  const run = (code) => vm.runInContext(code, context);
  const json = (code) => JSON.parse(run(`JSON.stringify(${code})`));
  return { run, json, spoken, root, storage, tick: () => tick(), cancelled: () => cancelled };
}

const routine = { key: '1-1', week: 1, day: 1, title: 'Prova', warmup: ['Gatto-mucca'], workout: ['Air squat', 'Bird dog', 'Dead bug'], cooldown: ['90/90'] };
function configure(c, extra = {}) {
  c.run(`settings = {...DEFAULT_SETTINGS, ...${JSON.stringify(extra)}}; player.routine = ${JSON.stringify(routine)}; player.timeline = buildTimeline(player.routine); player.active = true; player.paused = false; player.segmentStartedAt = Date.now();`);
}

test('migration preserves old durations and validates stored values', () => {
  const c = appContext({ 'fitTimer.settings': JSON.stringify({ exerciseDurationSec: 45, restDurationSec: 60 }) });
  for (const phase of ['warmup', 'workout', 'cooldown']) assert.equal(c.run(`settings.${phase}DurationSec`), 45);
  assert.equal(c.run('settings.roundRestDurationSec'), 60);
  const settings = c.json('normalizeSettings({workoutRounds: 0, warmupDurationSec: "bad", cooldownDurationSec: 900, prepareDurationSec: 0})');
  assert.equal(settings.workoutRounds, 1);
  assert.equal(settings.warmupDurationSec, 30);
  assert.equal(settings.cooldownDurationSec, 300);
  assert.equal(settings.prepareDurationSec, 0);
});

test('phase durations, odd-length round recovery and summary use the same timeline', () => {
  const c = appContext();
  configure(c, { warmupDurationSec: 15, workoutDurationSec: 45, cooldownDurationSec: 60, roundRestDurationSec: 90 });
  const timeline = c.json('player.timeline');
  for (const item of timeline.filter(x => x.kind === 'exercise')) assert.equal(item.duration, {warmup: 15, workout: 45, cooldown: 60}[item.phase]);
  const recovery = timeline.filter(x => x.betweenRounds);
  assert.equal(recovery.length, 1);
  assert.equal(recovery[0].duration, 90);
  const boundary = timeline.findIndex(x => x.betweenRounds);
  assert.equal(timeline[boundary - 1].name, 'Dead bug');
  assert.equal(timeline[boundary + 1].round, 2);
  assert.equal(timeline[boundary + 1].kind, 'prepare');
  assert.equal(c.run('routineSummary(player.routine).totalSeconds'), timeline.reduce((s, x) => s + x.duration, 0));
  assert.equal(c.run('exerciseCounter(0).total'), 8);
});

test('round announcement follows recovery, before preparation countdown, without repetition', () => {
  const c = appContext(); configure(c);
  c.run('player.index = player.timeline.findIndex(s => s.betweenRounds); speakCurrentSegment();');
  assert.equal(c.spoken[0].text, 'Giro completato. Recupera. Dopo la pausa:');
  c.run('nextSegment();');
  assert.match(c.spoken.at(-1).text, /^Secondo giro\. Allenamento\. Preparati:/);
  c.run('nextSegment();');
  assert.equal(c.spoken.at(-1).text, 'Via.');
});

test('zero preparation and recovery still announce each round once', () => {
  const c = appContext(); configure(c, { prepareDurationSec: 0, roundRestDurationSec: 0, restDurationSec: 0 });
  assert.equal(c.run('player.timeline.some(s => s.kind !== "exercise")'), false);
  c.run('player.index = player.timeline.findIndex(s => s.round === 2); speakCurrentSegment();');
  assert.match(c.spoken.at(-1).text, /^Secondo giro/);
});

test('speech switches language and ignores stale callbacks after skip or pause', () => {
  const c = appContext(); configure(c);
  c.run('speak("Preparati: Push-up sulle ginocchia. 90/90, seconda variante.");');
  assert.equal(c.spoken[0].lang, 'it-IT');
  c.spoken[0].onend();
  assert.equal(c.spoken[1].text, 'Push-up');
  assert.equal(c.spoken[1].lang, 'en-GB');
  const stale = c.spoken[1];
  const beforeCancel = c.cancelled();
  c.run('nextSegment();');
  assert.ok(c.cancelled() > beforeCancel);
  const count = c.spoken.length;
  stale.onend();
  assert.equal(c.spoken.length, count);
  c.run('togglePlayer();');
  assert.equal(c.run('player.paused'), true);
  const pausedCount = c.spoken.length;
  c.run('nextSegment();');
  assert.equal(c.spoken.length, pausedCount);
  c.run('togglePlayer();');
  assert.ok(c.spoken.length > pausedCount);
});

test('skip final segment completes instead of getting stuck', () => {
  const c = appContext(); configure(c);
  c.run('player.index = player.timeline.length - 1; nextSegment();');
  assert.equal(c.run('player.active'), false);
  assert.equal(JSON.parse(c.storage.get('fitTimer.sessions')).length, 1);
});

test('pause captures elapsed time before switching to paused state', () => {
  const c = appContext(); configure(c);
  c.run('player.segmentStartedAt = Date.now() - 7000; togglePlayer();');
  assert.equal(c.run('player.elapsedBeforePause'), 7);
  assert.equal(c.run('remainingSeconds(player.timeline[0])'), 3);
  c.run('togglePlayer();');
  assert.equal(c.run('remainingSeconds(player.timeline[0])'), 3);
});

test('natural timer transition cancels the previous announcement', () => {
  const c = appContext(); configure(c);
  c.run('startTick(); player.segmentStartedAt = Date.now() - 20000;');
  const previous = c.spoken.at(-1);
  c.tick();
  assert.equal(c.run('player.index'), 1);
  const count = c.spoken.length;
  previous.onend();
  assert.equal(c.spoken.length, count);
});
