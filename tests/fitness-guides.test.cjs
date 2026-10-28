const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const data = JSON.parse(fs.readFileSync(require.resolve('../data/exercise-guides.json')));
const library = JSON.parse(fs.readFileSync(require.resolve('../data/exercise-library.json')));

test('all 62 fitness movements have authored setup, movement narration and traceable references', () => {
  assert.equal(library.exercises.length,62);
  for (const {name} of library.exercises) {
    const g=data.exercises[name];
    assert.ok(g.steps.length>=3,name);
    assert.ok(g.voice.prepare && g.voice.move && g.voice.short,name);
    assert.ok(g.voice.move.length > g.voice.short.length,name);
    assert.ok(g.sourceIds.length,name);
    for (const id of g.sourceIds) {
      assert.ok(data.sources[id],`${name}: ${id}`);
      assert.equal(new URL(data.sources[id].url).protocol,'https:');
    }
  }
});

test('seated hamstrings uses both extended legs and a hip hinge, without a side-change cue', () => {
  const g=data.exercises['Stretching dei bicipiti femorali da seduto'];
  assert.match(g.setup,/entrambe le gambe distese/);
  assert.match(g.steps.join(' '),/dalla piega delle anche/);
  assert.match(g.voice.move,/dalle anche/);
  assert.match(g.steps.join(' '),/non è necessario raggiungere/i);
  assert.equal(g.midpointCue,undefined);
  assert.match(g.avoid.join(' '),/Arrotondare.*schiena/);
});

test('elbow mobility distinguishes flexion from forearm rotation and does not prescribe elbow circles', () => {
  const g=data.exercises['Rotazioni dei gomiti'];
  assert.match(g.voice.move,/Piega e distendi/);
  assert.match(g.voice.move,/palmi verso l’alto e verso il basso/);
  assert.match(g.steps.join(' '),/Non cercare cerchi forzati/);
});

test('quadruped weight shifts use hands and forefeet with knees hovering in written and spoken guidance', () => {
  const g=data.exercises['Spostamento del peso in quadrupedia'];
  assert.match(g.setup,/avampiedi/);
  assert.match(g.steps.join(' '),/solleva entrambe le ginocchia/);
  for (const text of [g.summary,g.cue,g.voice.move,g.voice.short]) {
    assert.match(text,/avampiedi/);
    assert.match(text,/ginocchia (sollevate|sospese)|solleva le ginocchia/);
    assert.doesNotMatch(text,/ginocchia.*restano a terra|ginocchia sempre appoggiate/);
  }
  assert.match(g.imageNote,/posizione di partenza/);
  assert.match(g.imageNote,/ginocchia sollevate/);
  assert.match(g.steps.join(' '),/appoggia le ginocchia per recuperare/);
  assert.notDeepEqual(g.sourceIds,['bird']);
});

test('side-specific exercises remain on their named side, bilateral stretches have no accidental switch', () => {
  for(const side of ['destra','sinistra']) {
    for(const name of [`Donkey kick (${side})`,`Crunch laterale in piedi (${side})`,`Crunch laterale in piedi (${side}) 2v`]) {
      assert.equal(data.exercises[name].midpointCue,undefined,name);
    }
  }
  for(const name of ['90/90','Ponte glutei (difficile)','Stretching della spalla incrociato']) {
    assert.ok(data.exercises[name].midpointCue,name);
  }
  for(const name of ['Stretching dei bicipiti femorali da seduto','Stretching a farfalla da seduti','Stretching ginocchia al petto']) {
    assert.equal(data.exercises[name].midpointCue,undefined,name);
  }
});

test('back widows load the elbows and protect the head; undocumented variants disclose their adaptation', () => {
  for(const name of ['Back widows (completi)','Back widows (ginocchia piegate)']) {
    assert.match(data.exercises[name].voice.move,/Premi i gomiti/);
    assert.match(data.exercises[name].voice.move,/senza spingere con la testa/);
  }
  for(const name of ['Plank lean flow','Floor angels','Snow angels inversi','Crunch laterale in piedi (destra) 2v']) {
    assert.ok(data.exercises[name].sourceNote,name);
  }
});
