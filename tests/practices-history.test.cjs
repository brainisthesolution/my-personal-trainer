const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const fitness = JSON.parse(read('data/exercise-library.json'));
const face = JSON.parse(read('data/face-yoga.json'));
const guides = JSON.parse(read('data/exercise-guides.json'));
const program = JSON.parse(read('data/routines.json'));
const original = { id: 'old-session', completedAt: '2026-10-01T21:30:00.000Z', date: '2026-10-01', routineKey: '1-1', week: 1, day: 1, title: 'Routine precedente', totalExercises: 26, totalSeconds: 1310, workoutRounds: 2 };

function fakeDatabase(rows = [], fail = false) {
  const data = new Map(rows.map(row => [row.id, row]));
  return {
    objectStoreNames: { contains: () => true }, close() {},
    transaction(_name, mode) {
      const tx = {
        objectStore() {
          return {
            put(row) { if (!fail) data.set(row.id, JSON.parse(JSON.stringify(row))); },
            getAll() { const req = {}; queueMicrotask(() => { req.result = [...data.values()]; req.onsuccess(); }); return req; }
          };
        }
      };
      if (mode === 'readwrite') queueMicrotask(() => fail ? tx.onerror() : tx.oncomplete());
      return tx;
    }
  };
}

function context(saved = {}, options = {}) {
  const root = { innerHTML: '' };
  const storage = new Map(Object.entries(saved));
  const window = { clearInterval() {}, setInterval() {}, setTimeout, clearTimeout };
  if (options.database) window.indexedDB = {
    open() { const request = { result: options.database }; queueMicrotask(() => request.onsuccess()); return request; }
  };
  const c = vm.createContext({ console, Date, Intl, setTimeout, clearTimeout,
    document: { querySelector: s => s === '#app' ? root : null, querySelectorAll: () => [] },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => { if (options.quota) throw Error('QuotaExceeded'); storage.set(k, v); } },
    navigator: {}, window
  });
  vm.runInContext(read('app.js').replace('\ninit();', '\n'), c);
  const run = code => vm.runInContext(code, c);
  const json = code => JSON.parse(run(`JSON.stringify(${code})`));
  run(`sourceData=${JSON.stringify(program)}; exerciseData=${JSON.stringify(fitness)}; exerciseGuideData=${JSON.stringify(guides)}; faceData=${JSON.stringify(face)}; rebuildRoutines(); exerciseLibrary=buildExerciseLibrary(routines);`);
  return { run, json, root, storage };
}

test('previous sessions and local date survive startup and a second app version', async () => {
  const c = context({ 'fitTimer.sessions': JSON.stringify([original]) });
  await c.run('restoreHistory()');
  assert.equal(c.run('getSessions().length'), 1);
  assert.equal(c.run('getSessions()[0].date'), '2026-10-01');
  assert.equal(c.run('getSessions()[0].practice'), 'fitness');
  const next = context(Object.fromEntries(c.storage));
  await next.run('restoreHistory()');
  assert.equal(next.run('getSessions()[0].id'), original.id);
  assert.equal(JSON.parse(next.storage.get('fitTimer.sessionsBackup')).length, 1);
});

test('a missing or corrupt primary history is recovered from its local copy', async () => {
  const c = context({ 'fitTimer.sessions': '{broken', 'fitTimer.sessionsBackup': JSON.stringify([original]) });
  await c.run('restoreHistory()');
  assert.equal(c.run('getSessions()[0].id'), original.id);
  assert.equal(JSON.parse(c.storage.get('fitTimer.sessions'))[0].id, original.id);
});

test('IndexedDB restores history even after both localStorage copies are missing', async () => {
  const c = context({}, { database: fakeDatabase([original]) });
  await c.run('restoreHistory();');
  await c.run('historyWrite');
  assert.equal(c.run('getSessions().length'), 1);
  assert.equal(JSON.parse(c.storage.get('fitTimer.sessions'))[0].id, original.id);
});

test('a browser that blocks IndexedDB can still load its original journal', async () => {
  const c = context({ 'fitTimer.sessions': JSON.stringify([original]) });
  c.run('window.indexedDB={open(){throw Error("SecurityError")}};');
  await c.run('restoreHistory()');
  assert.equal(c.run('getSessions()[0].id'), original.id);
});

test('completion does not trim the journal at 500 sessions and records the level', async () => {
  const history = Array.from({ length: 505 }, (_, i) => ({ ...original, id: `legacy-${i}` }));
  const c = context({ 'fitTimer.sessions': JSON.stringify(history) });
  c.run('player.routine=routines[0]; player.timeline=buildTimeline(player.routine); player.level="expert"; recordCompletedSession(player.routine); recordCompletedSession(player.routine);');
  assert.equal(c.run('getSessions().length'), 506);
  assert.equal(c.run('getSessions().find(s=>s.intensity).intensity'), 'expert');
  assert.equal(JSON.parse(c.storage.get('fitTimer.sessions')).length, 506);
});

test('backup import merges both practices, is repeatable and preserves existing sessions', async () => {
  const c = context({ 'fitTimer.sessions': JSON.stringify([original]) });
  const yoga = { ...original, id: 'face-session', week: 0, day: 2, routineKey: '0-2', practice: 'face', title: 'Scalpo e contorno occhi', intensity: 'advanced' };
  const backup = { app: 'my-personal-trainer', schemaVersion: 1, sessions: [original, yoga], settings: { faceIntensity: 'expert', workoutRounds: 3 }, overrides: {} };
  c.run(`const backup = parseBackup(${JSON.stringify(backup)});`);
  assert.equal(await c.run('applyBackup(backup)'), 1);
  assert.equal(await c.run('applyBackup(backup)'), 0);
  assert.equal(c.run('getSessions().length'), 2);
  assert.equal(c.run('settings.faceIntensity'), 'expert');
  assert.equal(c.run('createBackup().sessions.find(s=>s.id==="old-session").date'), '2026-10-01');
  assert.match(c.run('sessionCard(getSessions().find(s=>s.practice==="face"))'), /Yoga facciale/);
});

test('invalid or future backups are rejected before changing storage', () => {
  const c = context({ 'fitTimer.sessions': JSON.stringify([original]) });
  const before = [...c.storage];
  assert.throws(() => c.run('parseBackup({app:"my-personal-trainer",schemaVersion:2,sessions:[]})'), /compatibile/);
  assert.throws(() => c.run('parseBackup({app:"my-personal-trainer",schemaVersion:1,sessions:[{completedAt:"bad"}]})'), /non valide/);
  assert.throws(() => c.run('parseBackup({app:"my-personal-trainer",schemaVersion:1,sessions:[],overrides:{"1-1":{warmup:["Not real"],workout:[],cooldown:[]}}})'), /non valida/);
  assert.deepEqual([...c.storage], before);
});

test('quota failures are visible and the in-memory journal can still be exported', async () => {
  const c = context({}, { quota: true });
  c.run(`persistSessions([${JSON.stringify(original)}]);`);
  assert.match(c.run('storageNotice()'), /non riesce a salvare/);
  assert.equal(c.run('createBackup().sessions.length'), 1);
});

test('each fitness exercise has an exact guide and three distinct levels', () => {
  for (const exercise of fitness.exercises) {
    const guide = guides.exercises[exercise.name];
    assert.ok(guide, exercise.name);
    assert.ok(guide.setup && guide.breath && guide.cue, exercise.name);
    assert.ok(guide.steps.length >= 3 && guide.avoid.length >= 2, exercise.name);
    assert.equal(new Set(Object.values(guide.levels)).size, 3, exercise.name);
  }
});

test('prone and facial assets retain the original raster comic illustration style', () => {
  const prone = fitness.exercises.filter(e => /prono|proni|Snow angels inversi/.test(e.name));
  assert.equal(prone.length, 5);
  for (const exercise of prone) {
    assert.ok(exercise.image.endsWith('.png'));
    assert.equal(fs.readFileSync(path.join(__dirname, '..', exercise.image)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.match(guides.exercises[exercise.name].setup, /pancia in giù/i);
    assert.match(exercise.imageAlt, /pancia sul tappetino/);
  }
  for (const exercise of face.exercises) assert.ok(exercise.image.endsWith('.png'));
});

test('facial timelines use their own dose and a single sequence regardless of fitness settings', () => {
  const c = context();
  for (const level of ['beginner', 'advanced', 'expert']) {
    c.run(`settings.faceIntensity="${level}"; settings.workoutRounds=6; settings.workoutDurationSec=300;`);
    for (const routine of face.routines) {
      const timeline = c.json(`buildTimeline(findRoutine(0,${routine.day}))`);
      const exercises = timeline.filter(s => s.kind === 'exercise');
      const effective = c.json(`routineForLevel(findRoutine(0,${routine.day}),"${level}")`);
      assert.equal(exercises.length, [...effective.warmup, ...effective.workout, ...effective.cooldown].length);
      assert.equal(timeline.some(s => s.betweenRounds), false);
      for (const segment of exercises) {
        const dose = face.exercises.find(e => e.name === segment.name).doses[level];
        assert.equal(segment.duration, dose.seconds || dose.reps * (dose.hold + dose.release));
      }
    }
  }
});

test('facial repetition clock alternates the gesture and full release', () => {
  const c = context();
  c.run('const segment={dose:{reps:10,hold:5,release:3}};');
  assert.match(c.run('faceRepetitionLabel(segment,0)'), /1 \/ 10.*Esegui/);
  assert.match(c.run('faceRepetitionLabel(segment,5)'), /1 \/ 10.*Rilascia/);
  assert.match(c.run('faceRepetitionLabel(segment,8)'), /2 \/ 10.*Esegui/);
  assert.match(c.run('faceRepetitionLabel(segment,80)'), /10 \/ 10/);
});

test('facial and fitness editors and guides stay separate and legacy overrides migrate', () => {
  const c = context({ 'fitTimer.routineOverrides': JSON.stringify({ '1-1': { warmup: ['Gatto-mucca'], workout: ['Air squat'], cooldown: [] } }) });
  assert.equal(c.run('findRoutine(1,1).hasLocalChanges'), true);
  c.run('selectedPractice="face"; renderExerciseLibrary();');
  assert.match(c.root.innerHTML, /Il binocolo delicato/);
  assert.doesNotMatch(c.root.innerHTML, /Air squat/);
  c.run('renderEditor(findRoutine(0,1));');
  assert.doesNotMatch(c.root.innerHTML, /Air squat/);
  c.run('renderSettings(findRoutine(0,1));');
  assert.doesNotMatch(c.root.innerHTML, /data-setting="workoutDurationSec"/);
  assert.match(c.root.innerHTML, /dosi|ripetizioni/);
});

test('every routine has unique identity and all exercise assets and metadata resolve', () => {
  const c = context();
  assert.equal(c.run('new Set(routines.map(r=>r.key)).size'), c.run('routines.length'));
  for (const exercise of [...fitness.exercises, ...face.exercises]) assert.ok(fs.existsSync(path.join(__dirname, '..', exercise.image)), exercise.image);
  for (const routine of c.json('routines')) {
    for (const name of [...routine.warmup, ...routine.workout, ...routine.cooldown]) assert.ok([...fitness.exercises, ...face.exercises].some(e => e.name === name), name);
  }
});

test('advanced retains every original exercise, duration and round; beginner and expert change both count and time', () => {
  const c = context();
  for (const routine of c.json('routines')) {
    const summaries = {};
    for (const level of ['beginner', 'advanced', 'expert']) {
      const effective = c.json(`routineForLevel(findRoutine(${routine.week},${routine.day}),"${level}")`);
      const timeline = c.json(`buildTimeline(findRoutine(${routine.week},${routine.day}),"${level}")`);
      const exerciseSteps = timeline.filter(s => s.kind === 'exercise');
      summaries[level] = { count: exerciseSteps.length, seconds: timeline.reduce((sum,s)=>sum+s.duration,0) };
      assert.deepEqual(effective.warmup, routine.warmup);
      assert.deepEqual(effective.cooldown, routine.cooldown);
      if (routine.practice !== 'face') {
        for (const step of exerciseSteps) assert.equal(step.duration, step.phase === 'workout' ? { beginner:20, advanced:30, expert:40 }[level] : 30);
        assert.equal(new Set(exerciseSteps.filter(s=>s.phase==='workout').map(s=>s.round)).size, 2);
      }
      if (level === 'advanced') assert.deepEqual(effective.workout, routine.workout);
      for (const name of effective.workout.filter(name=>/\((sinistra|destra)\)/.test(name))) {
        const opposite = name.includes('(sinistra)') ? name.replace('(sinistra)','(destra)') : name.replace('(destra)','(sinistra)');
        assert.ok(effective.workout.includes(opposite), `${routine.key}: ${level}: ${name}`);
      }
    }
    assert.ok(summaries.beginner.count < summaries.advanced.count, routine.key);
    assert.ok(summaries.advanced.count < summaries.expert.count, routine.key);
    assert.ok(summaries.beginner.seconds < summaries.advanced.seconds, routine.key);
    assert.ok(summaries.advanced.seconds < summaries.expert.seconds, routine.key);
  }
});

test('level selection preserves custom advanced timings and personal routine edits', () => {
  const c = context();
  c.run('settings.workoutDurationSec=45;');
  assert.equal(c.run('workoutDuration("beginner")'), 30);
  assert.equal(c.run('workoutDuration("advanced")'), 45);
  assert.equal(c.run('workoutDuration("expert")'), 60);
  const originalData = c.run('JSON.stringify(routines)');
  c.run('routineForLevel(routines[0],"beginner"); routineForLevel(routines[0],"expert");');
  assert.equal(c.run('JSON.stringify(routines)'), originalData);
  c.run('renderRoutine(routines[0]);');
  assert.match(c.root.innerHTML, /Confronto dei livelli/);
  assert.match(c.root.innerHTML, /Durata totale/);
  c.run('const tenExercises={...routines[0],workout:[...routines[0].workout,"Dead bug"]};');
  assert.equal(c.run('routineForLevel(tenExercises,"expert").workout.length'), 13);
});

test('the previous variant-based levels migrate to advanced without changing timings or history', () => {
  const c = context({ 'fitTimer.settings': JSON.stringify({intensity:'beginner',faceIntensity:'beginner',workoutDurationSec:45}), 'fitTimer.sessions': JSON.stringify([original]) });
  assert.equal(c.run('settings.intensity'), 'advanced');
  assert.equal(c.run('settings.faceIntensity'), 'advanced');
  assert.equal(c.run('settings.workoutDurationSec'), 45);
  assert.equal(c.run('getSessions()[0].id'), original.id);
  c.run('settings=normalizeSettings({...settings,intensity:"beginner",faceIntensity:"expert"});');
  assert.equal(c.run('settings.intensity'), 'beginner');
  assert.equal(c.run('settings.faceIntensity'), 'expert');
});
