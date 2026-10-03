// Verify the complete v1 save schema against real prepared-shot recipes.
// No physics or rendering data is rewritten. By default the receipt is printed;
// pass --out to preserve it, and --fixtures to select an explicit recipe file.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Match, Shot} from '../../src/engine.js';
import {serializeMatchSave, inspectMatchSave, restoreMatchSave} from '../../src/persistence.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--fixtures', '--out'].includes(args[i]), `Unknown option: ${args[i]}`);
  assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), `Missing value for ${args[i]}`);
  options[args[i]] = args[i + 1];
}
const fixtures = resolve(options['--fixtures'] ?? resolve(root, 'validation/model-motion-ten/union-fixtures.json'));
const output = options['--out'] ? resolve(options['--out']) : null;
const bytes = await readFile(fixtures), data = JSON.parse(bytes);
const hash = value => createHash('sha256').update(value).digest('hex');
const enginePath = resolve(root, 'src/engine.js'), persistencePath = resolve(root, 'src/persistence.js');
const engineSha256 = hash(await readFile(enginePath)), persistenceSha256 = hash(await readFile(persistencePath));
const keys = new Set(), digest = createHash('sha256');
let samples = 0, steps = 0, catches = 0, goals = 0;

for (const recipe of data.fixtures) {
  const match = new Match('advanced', 73);
  match.start(0);
  const shot = new Shot(recipe.aim, recipe.stats, recipe.stats, recipe.direction, recipe.seed);
  const state = {phase: 'flight', match, shot, turnTime: 0, lockedX: 0, dir: 0, runup: 0, aim: {...recipe.aim}};
  const sample = () => {
    for (const key of Object.keys(shot)) keys.add(key);
    const payload = JSON.parse(serializeMatchSave(state)), inspection = inspectMatchSave(payload);
    assert.equal(inspection.ok, true, `${recipe.id} @ ${shot.t}: ${JSON.stringify(inspection)}`);
    const restored = restoreMatchSave(payload, {
      restoreMatch: raw => Match.restore(raw), restoreShot: raw => Shot.restore(raw),
    });
    assert.equal(restored.ok, true, `${recipe.id} @ ${shot.t}: restoration rejected ${restored.reason ?? restored.error}`);
    assert.equal(JSON.stringify(restored.state), JSON.stringify(state), `${recipe.id} @ ${shot.t}: restore changed serialized data`);
    samples++;
  };
  sample();
  let count = 0;
  for (; count < 3600 && !shot.result; count++) {
    shot.step(1 / 120, shot.playbackRate());
    if (!shot.result && (count + 1) % 30 === 0) sample();
  }
  assert.ok(shot.result, `${recipe.id} did not finish`);
  match.record(shot.result);
  state.phase = 'result';
  sample();
  assert.equal(!!shot.caught, recipe.expectedCaught, `${recipe.id} pinned catch changed`);
  catches += !!shot.caught;
  goals += !!shot.result.goal;
  steps += count;
  digest.update(`${recipe.id}\n${JSON.stringify(shot)}\n`);
}
assert.equal(catches, data.expectedCaptures);
assert.equal(hash(await readFile(fixtures)), hash(bytes), 'Fixture changed during audit');
assert.equal(hash(await readFile(enginePath)), engineSha256, 'Engine changed during audit');
assert.equal(hash(await readFile(persistencePath)), persistenceSha256, 'Persistence changed during audit');
const report = {
  status: 'pass', fixtures, fixtureSha256: hash(bytes), engineSha256, persistenceSha256,
  auditSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  shots: data.fixtures.length, samples, steps, catches, goals, shotFields: [...keys].sort(),
  terminalStateSha256: digest.digest('hex'),
  scope: 'Every recipe sampled before flight, every 30 physical steps, and terminal result. Full v1 JSON inspected and restored byte-for-byte; all pinned catch outcomes retained.',
};
if (output) {
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
