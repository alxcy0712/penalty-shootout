// Audit snapshot reproduction: these assertions describe e1dcc3a behavior,
// including defects. They are not desired-behavior release acceptance tests.
// Run from the repository root:
// node docs/research/evidence/reproduce-product-probes.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gestureInput, clamp } from '../../../src/engine.js';
import { mainHarness } from '../../../tests/helpers/main-harness.js';

const expected = JSON.parse(await readFile(new URL('./product-probes.json', import.meta.url), 'utf8'));
const outputs = [];
const plain = value => JSON.parse(JSON.stringify(value));
function record(id, result) {
  const reference = expected.probes.find(probe => probe.id === id);
  assert.ok(reference, `Missing evidence case: ${id}`);
  for (const [key, value] of Object.entries(result)) {
    assert.deepEqual(plain(value), reference[key], `${id}.${key}`);
  }
  outputs.push({ id, ...plain(result) });
}

const points = [{ x: 195, y: 150, t: 0 }, { x: 195, y: 30, t: 200 }];
const calibration = gestureInput(points, 348, 185, 2, true);
const threshold = Math.round(clamp(calibration.distance / 0.85, 0.5, 4) * 10) / 10;
record('calibration_reference_height_mismatch', { output: {
  calibratedThreshold: threshold,
  calibrationPower: gestureInput(points, 348, 185, threshold, true).power,
  game390x844Power: gestureInput(points, 390, 509, threshold, true).power,
  game390x700Power: gestureInput(points, 390, 365, threshold, true).power,
} });

const held = mainHarness();
held.click('ready');
held.gesture.emit('pointerdown');
for (let i = 0; i < 60; i++) held.tick(0.25);
const outputBeforeRelease = plain({ phase: held.context.state.phase, turnTime: held.context.state.turnTime, shot: held.context.state.shot });
held.gesture.emit('pointerup', { clientX: 195, clientY: 30 });
record('held_pointer_past_deadline', {
  outputBeforeRelease,
  outputAfterRelease: { phase: held.context.state.phase, aim: held.context.state.aim },
});

const shifted = mainHarness();
shifted.click('ready');
const element = shifted.gesture;
element.emit('pointerdown', { clientX: 195, clientY: 260, timeStamp: 0 });
element.getBoundingClientRect = () => ({ left: 0, top: 80, width: 390, height: 300 });
element.emit('pointerup', { clientX: 195, clientY: 260, timeStamp: 100 });
record('layout_shift_without_finger_movement', { output: {
  phase: shifted.context.state.phase,
  aim: shifted.context.state.aim,
} });

const overwrite = mainHarness();
overwrite.click('ready');
overwrite.tick(0.25);
overwrite.emitWindow('pagehide');
const oldSavedSeed = overwrite.saved.state.match.seed;
overwrite.click('home');
overwrite.click('new');
record('new_match_replaces_only_save', { output: {
  oldSavedSeed,
  newSavedSeed: overwrite.saved.state.match.seed,
  phase: overwrite.context.state.phase,
} });

const storage = mainHarness();
let pauseSheet;
storage.context.sheet = (title, body, type) => { pauseSheet = { title, body, type }; };
storage.context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
storage.click('pause');
record('failed_save_success_copy', { output: {
  storageOk: storage.context.storageOk,
  pauseText: pauseSheet.body.match(/<p[^>]*>(.*?)<\/p>/)?.[1],
} });

assert.equal(outputs.length, 5);
console.log(JSON.stringify({ baselineCommit: expected.baselineCommit, assertions: '5/5 evidence cases matched', outputs }, null, 2));
