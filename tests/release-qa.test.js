// Tiny synthetic subprocess/receipt fixtures test failure handling; these tests
// never claim to be production geometry evidence and never launch heavy gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CONFIG, GATES, AUDIT_SCRIPTS, runRelease, snapshotInputs, loadContract, executeGate} from '../tools/qa/release-qa.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const fixtureBytes = await readFile(new URL('../validation/model-motion-ten/union-fixtures.json', import.meta.url));
const fixtures = JSON.parse(fixtureBytes);
const originalConfig = JSON.parse(await readFile(new URL('../tools/qa/release-qa.v1.json', import.meta.url)));
const put = async (path, value) => {await mkdir(dirname(path), {recursive: true}); await writeFile(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));};

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), 'release-qa-unit-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const config = structuredClone(originalConfig);
  for (const path of [...AUDIT_SCRIPTS, ...Object.keys(config.assets)]) {
    const content = 'synthetic test input: ' + path;
    await put(join(root, path), content);
    (config.assets[path] ? config.assets : config.auditScripts)[path] = sha(content);
  }
  for (const path of ['package.json', 'package-lock.json', 'vite.config.js', 'index.html', 'motion-lab.html', 'src/runtime.js', 'tests/example.test.js', 'public/readme.txt']) await put(join(root, path), 'synthetic input');
  const lockedPackages = {};
  for (const [name, version] of Object.entries({three: '0.180.0', vite: '7.3.6'})) {
    lockedPackages['node_modules/' + name] = {version};
    await put(join(root, 'node_modules/' + name + '/package.json'), {name, version});
  }
  await put(join(root, 'package-lock.json'), {lockfileVersion: 3, packages: lockedPackages});
  await put(join(root, config.fixture.path), fixtureBytes);
  await put(join(root, 'validation/ten-rounds/union-fixtures.json'), fixtureBytes);
  await put(join(root, CONFIG), config);
  return {root, config, out: join(root, 'evidence')};
}
async function syntheticReceipts(root, out, config) {
  const inputs = await snapshotInputs(root), captures = fixtures.fixtures.filter(row => row.expectedCaught);
  const sourceHashes = {'runtime.js': inputs['src/runtime.js']};
  const receipts = [], shards = [];
  for (let index = 0; index < 4; index++) {
    const wanted = fixtures.fixtures.filter((_, i) => i % 4 === index), caught = wanted.filter(row => row.expectedCaught).length;
    const prefix = join(out, 'union/shard-' + index);
    await put(join(prefix, 'fixtures.json'), {...fixtures, fixtures: wanted, expectedCaptures: caught});
    await put(join(prefix, 'body/held-body-summary.json'), {failures: [], captures: caught, candidateFixtures: wanted.length, baseHz: 10, denseHz: 120});
    const files = {};
    for (const [gate, file] of Object.entries({body: 'body/held-body-audit.json', hold: 'hold/actual-holding-240hz.json', trajectory: 'trajectory/near-keeper-trajectory.json'})) {
      const path = join(prefix, file), content = JSON.stringify({synthetic: true, stage: gate, index});
      await put(path, content); files[gate] = {path, sha256: sha(content)};
    }
    receipts.push({shard: index, shots: wanted.length, captures: caught, files});
    shards.push({index, fixtureIds: wanted.map(row => row.id), expectedCaptures: caught, results: Object.fromEntries(['body', 'hold', 'trajectory'].map(gate => [gate, {exitCode: 0, signal: null}]))});
  }
  const common = {manifestSha256: config.fixture.sha256, shots: 669, captures: 223};
  await put(join(out, 'union/union-report.json'), {...common, jobs: 4, concurrency: 1, sourceHashes, shards, failures: []});
  await put(join(out, 'union-summary.json'), {...common, status: 'passed', testedFiles: Object.fromEntries(['src/runtime.js', 'assets/characters/keeper-prototype.glb', 'tests/helpers/load-character.js', 'assets/characters/striker-mocap.glb', 'tools/qa/audit-held-body.mjs', 'tools/qa/audit-character.mjs', 'tools/qa/read-audit-fixtures.mjs'].map(path => [path, inputs[path]])), receipts});
  const commonKeys = ['src/runtime.js', 'assets/characters/keeper-prototype.glb', 'tests/helpers/load-character.js'];
  const pick = keys => Object.fromEntries(keys.map(key => [key, inputs[key]]));
  const fixtureHash = {['fixtures:' + join(root, config.fixture.path)]: config.fixture.sha256};
  const fingerHashes = {...pick([...commonKeys, 'tools/qa/audit-finger-grip.mjs', 'tools/qa/read-audit-fixtures.mjs', 'validation/ten-rounds/union-fixtures.json']), ...fixtureHash};
  const thumbHashes = {...pick([...commonKeys, 'tests/helpers/keeper-finger-grip-baseline.js', 'tools/qa/read-audit-fixtures.mjs', 'tools/qa/audit-thumb-body-differential.mjs']), ...fixtureHash};
  const provenance = {path: join(root, config.fixture.path), sha256: config.fixture.sha256, shots: 669, expectedCaptures: 223};
  await put(join(out, 'finger-grip/finger-grip-audit.json'), {hashesBefore: fingerHashes, hashesAfter: fingerHashes, summary: {fixtureInput: provenance, failures: [], captures: 223, closedFinal: 223, samples: 33450, selfSamples: 82}, selfRecords: Array(82).fill({}), records: captures.map(row => ({id: row.id, times: Array(150).fill(0), amounts: Array(150).fill(1)}))});
  const summary = {fixture: provenance, failures: [], mode: 'full-caught-manifest', matchPlayback: true, caught: 223, initialTimes: Array(38).fill(0), samples: 223 * 38, denseSamples: 0};
  await put(join(out, 'thumb-body/thumb-body-differential.json'), {hashesBefore: thumbHashes, hashesAfter: thumbHashes, summary, captures: captures.map(row => ({id: row.id, initialSamples: 38, denseSamples: 0})), records: captures.flatMap(row => Array.from({length: 38}, () => ({id: row.id})))});
  await put(join(out, 'thumb-body/thumb-body-summary.json'), summary);
  await put(join(out, 'build/index.html'), 'synthetic build'); await put(join(out, 'build/motion-lab.html'), 'synthetic build');
}
function fakeExecution(config, mutate) {
  return async (gate, {root, out, log}) => {
    await put(log, 'synthetic unit test gate ' + gate.id);
    if (gate.id === 'thumb-body') {await syntheticReceipts(root, out, config); if (mutate) await mutate(out);}
    return {exitCode: 0, signal: null};
  };
}
async function saved(out) {return JSON.parse(await readFile(join(out, 'release-report.json')));}

test('plan validates exact cohort and lists all gates without executing or claiming acceptance', async t => {
  const {root, out} = await sandbox(t);
  const report = await runRelease({root, out, mode: 'plan', execute: () => {throw Error('must not execute');}});
  assert.equal(report.status, 'planned'); assert.equal(report.acceptance, false);
  assert.equal(report.fixture.shots, 669); assert.equal(report.fixture.captures, 223);
  assert.deepEqual(report.gates.map(row => row.id), GATES);
  assert.ok(report.gates.every(row => row.status === 'not_run'));
  assert.ok(report.gates.find(row => row.id === 'thumb-body').args.includes('--match-playback'));
  assert.equal((await saved(out)).status, 'planned');
});

test('list is read-only and rejects command fields / omitted deformation gates', async t => {
  const {root, out, config} = await sandbox(t);
  const planned = await runRelease({root, out, mode: 'list'});
  assert.equal(planned.status, 'planned'); await assert.rejects(readFile(join(out, 'release-report.json')), {code: 'ENOENT'});
  config.command = 'echo bypass'; await put(join(root, CONFIG), config);
  await assert.rejects(loadContract(root), /unknown release config fields/);
  delete config.command; config.requiredGates.pop(); await put(join(root, CONFIG), config);
  await assert.rejects(loadContract(root), /cannot be omitted/);
});

test('invalid version fails before any gate, retaining a failure receipt', async t => {
  const {root, out, config} = await sandbox(t); config.schemaVersion = 2; await put(join(root, CONFIG), config);
  const report = await runRelease({root, out, execute: () => {throw Error('must not execute');}});
  assert.equal(report.status, 'failed'); assert.equal(report.acceptance, false); assert.match(report.failures[0], /unsupported release config version/);
  assert.equal((await saved(out)).status, 'failed');
});

test('tampered fixture digest and pinned audit script fail before execution', async t => {
  const {root, out, config} = await sandbox(t);
  await put(join(root, config.fixture.path), Buffer.concat([fixtureBytes, Buffer.from('\n')]));
  assert.match((await runRelease({root, out})).failures[0], /fixture digest changed/);
  await put(join(root, config.fixture.path), fixtureBytes);
  await put(join(root, AUDIT_SCRIPTS[0]), 'changed audit');
  assert.match((await runRelease({root, out: out + '-2'})).failures[0], /pinned input changed/);
});

test('failed child and killed child never pass or run later gates', async t => {
  for (const result of [{exitCode: 1, signal: null}, {exitCode: null, signal: 'SIGKILL'}]) {
    const {root, out} = await sandbox(t), calls = [];
    const report = await runRelease({root, out, execute: async (gate, {log}) => {calls.push(gate.id); await put(log, 'failure retained'); return result;}});
    assert.equal(report.status, 'failed'); assert.equal(report.acceptance, false); assert.deepEqual(calls, ['tests']);
    assert.equal(report.gates[0].status, 'failed'); assert.ok(report.gates.slice(1).every(row => row.status === 'not_run'));
    assert.equal(await readFile(join(out, 'tests.log'), 'utf8'), 'failure retained');
    assert.equal((await saved(out)).status, 'failed');
  }
});

test('source mutation/addition during a successful child invalidates the run', async t => {
  const {root, out} = await sandbox(t);
  const report = await runRelease({root, out, execute: async (_, {log}) => {
    await put(log, 'exit zero but input changed'); await put(join(root, 'src/new-source.js'), 'changed'); return {exitCode: 0, signal: null};
  }});
  assert.equal(report.status, 'failed'); assert.match(report.failures[0], /source changed/); assert.equal(report.acceptance, false);
  assert.ok(report.inputHashesAfter['src/new-source.js']); assert.ok(report.artifactHashes['tests.log']);
});

test('complete synthetic receipts exercise the success branch only as a runner unit test', async t => {
  const {root, out, config} = await sandbox(t);
  const report = await runRelease({root, out, execute: fakeExecution(config)});
  assert.equal(report.status, 'passed', report.failures.join('\n')); assert.equal(report.acceptance, true);
  assert.ok(report.gates.every(row => row.status === 'passed')); assert.ok(report.artifactHashes['thumb-body/thumb-body-differential.json']);
  assert.deepEqual(report.inputHashesAfter, report.inputHashesBefore);
});

for (const [name, mutation, error] of [
  ['missing raw receipt', out => rm(join(out, 'union/shard-2/body/held-body-audit.json')), /ENOENT/],
  ['missing finger receipt', out => rm(join(out, 'finger-grip/finger-grip-audit.json')), /ENOENT/],
  ['missing thumb receipt', out => rm(join(out, 'thumb-body/thumb-body-differential.json')), /ENOENT/],
  ['stale source receipt', async out => {const p = join(out, 'union-summary.json'), data = JSON.parse(await readFile(p)); data.testedFiles['src/runtime.js'] = '0'.repeat(64); await put(p, data);}, /stale receipt source/],
  ['omitted union fixture', async out => {const p = join(out, 'union/union-report.json'), data = JSON.parse(await readFile(p)); data.shards[0].fixtureIds.pop(); await put(p, data);}, /omitted or duplicated shots/],
  ['replaced raw receipt', out => put(join(out, 'union/shard-1/hold/actual-holding-240hz.json'), '{}'), /altered raw receipt/],
  ['omitted summary hash', async out => {const p = join(out, 'union-summary.json'), data = JSON.parse(await readFile(p)); delete data.testedFiles['tools/qa/audit-held-body.mjs']; await put(p, data);}, /hash coverage/],
  ['omitted finger hash', async out => {const p = join(out, 'finger-grip/finger-grip-audit.json'), data = JSON.parse(await readFile(p)); delete data.hashesBefore['assets/characters/keeper-prototype.glb']; delete data.hashesAfter['assets/characters/keeper-prototype.glb']; await put(p, data);}, /hash coverage/],
  ['omitted thumb hash', async out => {const p = join(out, 'thumb-body/thumb-body-differential.json'), data = JSON.parse(await readFile(p)); delete data.hashesBefore['tests/helpers/keeper-finger-grip-baseline.js']; delete data.hashesAfter['tests/helpers/keeper-finger-grip-baseline.js']; await put(p, data);}, /hash coverage/],
  ['missing build', out => rm(join(out, 'build/motion-lab.html')), /missing build entry artifact/],
  ['omitted finger catch', async out => {const p = join(out, 'finger-grip/finger-grip-audit.json'), data = JSON.parse(await readFile(p)); data.records.pop(); await put(p, data);}, /finger audit omitted/],
  ['smoke thumb receipt', async out => {const p = join(out, 'thumb-body/thumb-body-differential.json'), data = JSON.parse(await readFile(p)); data.summary.mode = 'smoke-not-acceptance'; await put(p, data); await put(join(out, 'thumb-body/thumb-body-summary.json'), data.summary);}, /full-caught-manifest/],
]) test(name + ' cannot be accepted after all exit codes are zero', async t => {
  const {root, out, config} = await sandbox(t);
  const report = await runRelease({root, out, execute: fakeExecution(config, mutation)});
  assert.equal(report.status, 'failed'); assert.equal(report.acceptance, false); assert.match(report.failures[0], error);
  assert.equal((await saved(out)).status, 'failed');
});

test('existing output is never reused as fresh evidence', async t => {
  const {root, out} = await sandbox(t); await mkdir(out); await put(join(out, 'release-report.json'), 'previous receipt');
  await assert.rejects(runRelease({root, out, mode: 'plan'}), {code: 'EEXIST'});
  assert.equal(await readFile(join(out, 'release-report.json'), 'utf8'), 'previous receipt');
});

test('actual child process failure writes its output and exit code without a shell', async t => {
  const {root} = await sandbox(t), log = join(root, 'child.log');
  const result = await executeGate({args: ['-e', 'console.error("expected fault"); process.exitCode=7;']}, {root, log});
  assert.deepEqual(result, {exitCode: 7, signal: null}); assert.match(await readFile(log, 'utf8'), /expected fault/);
});


test('a changed model-build tool invalidates the input snapshot', async t => {
  const {root, out} = await sandbox(t);
  const report = await runRelease({root, out, execute: async (_, {log}) => {
    await put(log, 'tool changed'); await put(join(root, 'tools/model-build/changed.js'), 'changed'); return {exitCode: 0, signal: null};
  }});
  assert.equal(report.status, 'failed'); assert.match(report.failures[0], /source changed/);
});

test('actual union summarizer rejects an omitted raw body source hash before reading geometry', async t => {
  const {root, out} = await sandbox(t), repository = fileURLToPath(new URL('../', import.meta.url));
  const sourceHashes = {};
  for (const file of (await readdir(join(repository, 'src'))).filter(file => file.endsWith('.js'))) sourceHashes[file] = sha(await readFile(join(repository, 'src', file)));
  const one = fixtures.fixtures[0], prefix = join(out, 'shard-0');
  await put(join(out, 'union-report.json'), {manifestSha256: originalConfig.fixture.sha256, failures: [], sourceHashes, shards: [{index: 0, fixtureIds: [one.id], results: {body: {exitCode: 0}, hold: {exitCode: 0}, trajectory: {exitCode: 0}}}]});
  await put(join(prefix, 'fixtures.json'), {fixtures: [one]});
  const bodyHashes = Object.fromEntries(Object.entries(sourceHashes).map(([file, digest]) => ['src/' + file, digest]));
  // Deliberately omit the required asset/script/helper keys while retaining every source hash.
  await put(join(prefix, 'body/held-body-audit.json'), {hashes: bodyHashes, hashesAfter: bodyHashes});
  await put(join(prefix, 'hold/actual-holding-240hz.json'), {});
  await put(join(prefix, 'trajectory/near-keeper-trajectory.json'), {});
  const log = join(root, 'summary-fault.log');
  const result = await executeGate({args: [join(repository, 'tools/qa/summarize-union-results.mjs'), out, join(out, 'summary.json'), join(repository, originalConfig.fixture.path)]}, {root, log});
  assert.equal(result.exitCode, 1); assert.match(await readFile(log, 'utf8'), /receipt omitted or added source hash keys/);
});


test('installed versions and resolved package paths are recorded from this checkout', async t => {
  const {root, out} = await sandbox(t);
  const report = await runRelease({root, out, mode: 'plan'});
  assert.equal(report.status, 'planned');
  for (const [name, version] of Object.entries({three: '0.180.0', vite: '7.3.6'})) {
    const dependency = report.environment.dependencies[name];
    assert.equal(dependency.version, version); assert.equal(dependency.lockedVersion, version);
    assert.equal(dependency.packageJsonPath, join(root, 'node_modules/' + name + '/package.json'));
    assert.equal(dependency.packageJsonSha256, report.inputHashesBefore['node_modules/' + name + '/package.json']);
  }
});

test('installed version mismatch fails before any gate and retains observed versions', async t => {
  const {root, out} = await sandbox(t);
  await put(join(root, 'node_modules/three/package.json'), {name: 'three', version: '0.179.0'});
  const report = await runRelease({root, out, execute: () => {throw Error('must not execute');}});
  assert.equal(report.status, 'failed'); assert.equal(report.acceptance, false); assert.equal(report.gates.length, 0);
  assert.match(report.failures[0], /installed three version differs from package-lock/);
  const receipt = await saved(out);
  assert.equal(receipt.environment.dependencies.three.version, '0.179.0');
  assert.equal(receipt.environment.dependencies.three.lockedVersion, '0.180.0');
});
