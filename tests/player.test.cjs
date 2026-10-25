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
  c.run(`settings = {...DEFAULT_SETTINGS, exerciseCueEnabled:false, ...${JSON.stringify(extra)}}; player.routine = ${JSON.stringify(routine)}; player.timeline = buildTimeline(player.routine); player.active = true; player.paused = false; player.segmentStartedAt = Date.now();`);
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

const guides = JSON.parse(fs.readFileSync(require.resolve('../data/exercise-guides.json')));
const library = JSON.parse(fs.readFileSync(require.resolve('../data/exercise-library.json')));
function guided(extra = {}) {
  const c = appContext();
  c.run(`exerciseGuideData=${JSON.stringify(guides)}; exerciseData=${JSON.stringify(library)};`);
  configure(c, { exerciseCueEnabled: true, ...extra });
  return c;
}
function drainSpeech(c) {
  let i = c.spoken.length - 1;
  for (let guard = 0; guard < 100 && i < c.spoken.length; guard++, i++) c.spoken[i].onend();
}

test('spoken fitness setup and movement are separate and preserve the work dose', () => {
  const c = guided({workoutDurationSec:20});
  c.run('speakCurrentSegment()');
  drainSpeech(c);
  const setup = c.spoken.map(u => u.text).join(' ');
  assert.match(setup, /quattro appoggi/);
  assert.match(setup, /mani sotto le spalle/);
  const timeline = c.json('player.timeline');
  assert.ok(timeline[0].duration > 10);
  assert.equal(timeline.find(x => x.phase === 'workout' && x.kind === 'exercise').duration, 20);
  const before = c.spoken.length;
  c.run('nextSegment()'); drainSpeech(c);
  assert.match(c.spoken.slice(before).map(u => u.text).join(' '), /Inspira.*Espira/);
});

test('a slow voice moves long instructions into preparation using the actual level dose', () => {
  const c = guided({speechRate:0.6,workoutDurationSec:30,intensity:'beginner'});
  c.run('player.routine.workout=["Bird dog"];');
  const timeline = c.json('buildTimeline(player.routine, "beginner")');
  const exercise = timeline.findIndex(s => s.name === 'Bird dog');
  assert.equal(timeline[exercise].duration, 20);
  const narration = c.json('fitnessNarration("Bird dog", "workout", 20)');
  assert.equal(narration.move, guides.exercises['Bird dog'].voice.short);
  assert.ok(narration.prepare.includes(guides.exercises['Bird dog'].voice.move));
  assert.equal(timeline[exercise-1].duration, c.run('Math.max(settings.prepareDurationSec, estimatedSpeechSeconds("Preparati: Bird dog. " + fitnessNarration("Bird dog", "workout", 20).prepare) + 5)'));
  c.run('settings.voiceEnabled=false;');
  assert.equal(c.json('buildTimeline(player.routine, "beginner")')[0].duration, 10);
});

test('zero preparation stays zero and saved voice choices remain respected', () => {
  const c = guided({prepareDurationSec:0});
  assert.equal(c.run('player.timeline.some(s=>s.kind === "prepare")'), false);
  const saved = appContext({'fitTimer.settings':JSON.stringify({exerciseCueEnabled:false,voiceEnabled:false})});
  assert.equal(saved.run('settings.exerciseCueEnabled'),false);
  assert.equal(saved.run('settings.voiceEnabled'),false);
  assert.equal(appContext().run('settings.exerciseCueEnabled'),true);
});

test('countdown does not interrupt a movement instruction and speech errors release it', () => {
  const c = guided();
  c.run('player.index=1; speakCurrentSegment(); player.segmentStartedAt=Date.now()-28000; maybeSpeakCountdown(player.timeline[1]);');
  const count = c.spoken.length;
  assert.equal(c.run('guidanceSpeaking'),true);
  assert.equal(c.spoken.length,count);
  c.spoken.at(-1).onerror({error:'not-allowed'});
  assert.equal(c.run('guidanceSpeaking'),false);
  c.run('maybeSpeakCountdown(player.timeline[1])');
  assert.equal(c.spoken.at(-1).text,'2');
});

test('preparation can finish a slower device utterance before work, with a bounded fallback', () => {
  const c = guided();
  c.run('startTick(); player.segmentStartedAt=Date.now()-(player.timeline[0].duration+1)*1000;');
  c.tick();
  assert.equal(c.run('player.index'),0);
  drainSpeech(c); c.tick();
  assert.equal(c.run('player.index'),1);
  const stuck = guided();
  stuck.run('startTick(); player.segmentStartedAt=Date.now()-(player.timeline[0].duration+16)*1000;');
  stuck.tick();
  assert.equal(stuck.run('player.index'),1);
});

test('side changes are announced once halfway through an exercise, after the short cue', () => {
  const c = guided();
  c.run('player.index=player.timeline.findIndex(s=>s.name === "90/90"); speakCurrentSegment();');
  drainSpeech(c);
  c.run('player.segmentStartedAt=Date.now()-14000; maybeSpeakMidpoint(player.timeline[player.index]);');
  let before = c.spoken.length;
  c.run('player.segmentStartedAt=Date.now()-15000; maybeSpeakMidpoint(player.timeline[player.index]);');
  assert.ok(c.spoken.length>before);
  assert.match(c.spoken.at(-1).text,/Inverti le gambe aiutandoti/);
  before=c.spoken.length;
  c.run('maybeSpeakMidpoint(player.timeline[player.index]);');
  assert.equal(c.spoken.length,before);
});

test('pause, skip and resume cancel long guidance without letting stale callbacks restart it', () => {
  const c = guided();
  c.run('startTick(); player.segmentStartedAt=Date.now()-5000; togglePlayer();');
  const stale=c.spoken.at(-1);
  assert.equal(c.run('guidanceSpeaking'),false);
  let before=c.spoken.length; stale.onend(); assert.equal(c.spoken.length,before);
  c.run('nextSegment();');
  before=c.spoken.length;
  c.run('togglePlayer();');
  assert.ok(c.spoken.length>before);
  c.run('player.segmentStartedAt=Date.now()-20000; togglePlayer(); togglePlayer();');
  drainSpeech(c);
  assert.match(c.spoken.slice(before).map(u=>u.text).join(' '),new RegExp(guides.exercises['Gatto-mucca'].voice.short.split('.')[0]));
});
