// Fixed release contract. Configuration contains data, never executable commands.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {readFile, writeFile, mkdir, readdir, rename, lstat, realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve, dirname, basename, isAbsolute, sep} from 'node:path';

export const CONFIG = 'tools/qa/release-qa.v1.json';
export const GATES = ['tests', 'build', 'union', 'union-summary', 'finger-grip', 'thumb-body'];
export const AUDIT_SCRIPTS = [
  'tools/qa/run-union-gates.mjs', 'tools/qa/summarize-union-results.mjs',
  'tools/qa/audit-held-body.mjs', 'tools/qa/audit-character.mjs',
  'tools/qa/audit-finger-grip.mjs', 'tools/qa/audit-thumb-body-differential.mjs',
  'tools/qa/read-audit-fixtures.mjs', 'tests/helpers/load-character.js',
  'tests/helpers/keeper-finger-grip-baseline.js',
];
const INSTALLED_PACKAGES = ['three', 'vite'];
const ASSETS = ['assets/characters/keeper-prototype.glb', 'assets/characters/striker-mocap.glb', 'assets/characters/mocap-variants/cmu-10_03-kick.glb'];
const sha = value => createHash('sha256').update(value).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const ids = rows => rows.map(row => row.id).sort();
const noFailures = value => assert.deepEqual(value, [], 'receipt contains failures or omits failures');

// These are paths from reviewed source, not command/path choices from the manifest.
function inside(root, path) {
  assert.equal(typeof path, 'string');
  assert.ok(path && !isAbsolute(path) && !path.split(/[\\/]/).includes('..'), 'expected a repository-relative path');
  const result = resolve(root, path);
  assert.ok(result.startsWith(resolve(root) + sep), 'path escapes repository');
  return result;
}
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function filesIn(root, path) {
  const entries = await readdir(inside(root, path), {withFileTypes: true});
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path + '/' + entry.name;
    assert.ok(!entry.isSymbolicLink(), 'source symlink is not a frozen input: ' + name);
    if (entry.isDirectory()) files.push(...await filesIn(root, name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}
export async function inspectInstalledPackages(root) {
  const lock = await json(inside(root, 'package-lock.json'));
  const dependencies = {};
  for (const name of INSTALLED_PACKAGES) {
    const packageJsonPath = await realpath(inside(root, 'node_modules/' + name + '/package.json'));
    const bytes = await readFile(packageJsonPath), installed = JSON.parse(bytes);
    const lockedVersion = lock.packages?.['node_modules/' + name]?.version;
    assert.equal(installed.name, name, 'unexpected installed package identity: ' + name);
    assert.equal(typeof installed.version, 'string', 'missing installed package version: ' + name);
    assert.equal(typeof lockedVersion, 'string', 'missing resolved package-lock version: ' + name);
    dependencies[name] = {version: installed.version, lockedVersion, packageJsonPath, packageJsonSha256: sha(bytes)};
  }
  return dependencies;
}
export async function snapshotInputs(root) {
  const paths = [CONFIG, 'package.json', 'package-lock.json', 'vite.config.js', 'index.html', 'motion-lab.html'];
  for (const directory of ['src', 'tests', 'tools', 'assets', 'public']) paths.push(...await filesIn(root, directory));
  paths.push('validation/model-motion-ten/union-fixtures.json', 'validation/ten-rounds/union-fixtures.json');
  paths.push(...INSTALLED_PACKAGES.map(name => 'node_modules/' + name + '/package.json'));
  const result = {};
  for (const path of [...new Set(paths)].sort()) result[path] = await hashFile(inside(root, path));
  return result;
}
export async function loadContract(root) {
  const bytes = await readFile(inside(root, CONFIG)), config = JSON.parse(bytes);
  assert.equal(config.schemaVersion, 1, 'unsupported release config version');
  assert.deepEqual(Object.keys(config).sort(), ['schemaVersion', 'releaseId', 'fixture', 'union', 'requiredGates', 'assets', 'auditScripts'].sort(), 'unknown release config fields');
  assert.equal(config.releaseId, 'model-motion-ten-669-v1');
  assert.deepEqual(Object.keys(config.fixture).sort(), ['path', 'sha256', 'shots', 'captures'].sort());
  assert.equal(config.fixture.path, 'validation/model-motion-ten/union-fixtures.json');
  assert.equal(config.fixture.shots, 669); assert.equal(config.fixture.captures, 223);
  assert.deepEqual(config.union, {jobs: 4, concurrency: 1}, 'release shard contract changed');
  assert.deepEqual(config.requiredGates, GATES, 'required release gates cannot be omitted or reordered');
  assert.deepEqual(Object.keys(config.assets).sort(), ASSETS.toSorted());
  assert.deepEqual(Object.keys(config.auditScripts).sort(), AUDIT_SCRIPTS.toSorted());
  for (const [path, digest] of Object.entries({...config.assets, ...config.auditScripts})) {
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(await hashFile(inside(root, path)), digest, 'pinned input changed: ' + path);
  }
  const fixtureBytes = await readFile(inside(root, config.fixture.path)), fixture = JSON.parse(fixtureBytes);
  assert.equal(sha(fixtureBytes), config.fixture.sha256, 'fixture digest changed; review a new contract');
  assert.equal(fixture.fixtures.length, config.fixture.shots, 'shot count changed');
  assert.equal(fixture.expectedCaptures, config.fixture.captures, 'catch count changed');
  assert.equal(fixture.fixtures.filter(row => row.expectedCaught).length, config.fixture.captures, 'catch labels changed');
  assert.equal(new Set(ids(fixture.fixtures)).size, config.fixture.shots, 'duplicate fixture IDs');
  for (const row of fixture.fixtures) {
    assert.equal(typeof row.id, 'string'); assert.ok(row.id.length); assert.equal(typeof row.expectedCaught, 'boolean');
  }
  return {config, fixture, configSha256: sha(bytes)};
}
export function gatePlan(root, out, contract, testFiles) {
  const fixtures = inside(root, contract.config.fixture.path), union = resolve(out, 'union');
  return [
    {id: 'tests', args: ['--test', '--test-concurrency=1', ...testFiles]},
    {id: 'build', args: ['node_modules/vite/bin/vite.js', 'build', '--outDir', resolve(out, 'build')]},
    {id: 'union', args: ['tools/qa/run-union-gates.mjs', '--fixtures', fixtures, '--out', union, '--jobs', '4', '--concurrency', '1']},
    {id: 'union-summary', args: ['tools/qa/summarize-union-results.mjs', union, resolve(out, 'union-summary.json'), fixtures]},
    {id: 'finger-grip', args: ['tools/qa/audit-finger-grip.mjs', '--fixtures', fixtures, '--check'], env: {ARTIFACT_DIR: resolve(out, 'finger-grip')}},
    {id: 'thumb-body', args: ['tools/qa/audit-thumb-body-differential.mjs', '--fixtures', fixtures, '--out', resolve(out, 'thumb-body'), '--match-playback', '--check']},
  ];
}
export function executeGate(gate, {root, log}) {
  return new Promise((accept, reject) => {
    const output = createWriteStream(log, {flags: 'wx'});
    const env = {...process.env};
    for (const key of ['ARTIFACT_DIR', 'BASE_HZ', 'DENSE_HZ', 'STAT', 'EXPORT_TIMES', 'OUT', 'FULL_DETAILS', 'NODE_OPTIONS']) delete env[key];
    Object.assign(env, {BASE_HZ: '10', DENSE_HZ: '120', STAT: '85'}, gate.env);
    const child = spawn(process.execPath, gate.args, {cwd: root, env, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    output.on('error', error => {child.kill(); reject(error);});
    child.stdout.pipe(output, {end: false}); child.stderr.pipe(output, {end: false});
    child.once('error', error => {output.end(); reject(error);});
    child.once('close', (exitCode, signal) => output.end(() => accept({exitCode, signal})));
  });
}
function verifyHashMap(map, expected, requiredKeys) {
  assert.ok(map && Object.keys(map).length > 0, 'missing receipt source hashes');
  assert.deepEqual(Object.keys(map).sort(), [...requiredKeys].sort(), 'receipt source hash coverage differs from required inputs');
  for (const [path, digest] of Object.entries(map)) assert.equal(digest, expected[path], 'stale receipt source: ' + path);
}
export async function verifyArtifacts(root, out, {config, fixture}, inputs) {
  const artifacts = {};
  const sourceKeys = Object.keys(inputs).filter(path => /^src\/[^/]+\.js$/.test(path));
  const commonKeys = [...sourceKeys, 'assets/characters/keeper-prototype.glb', 'tests/helpers/load-character.js'];
  const summaryKeys = [...commonKeys, 'assets/characters/striker-mocap.glb', 'tools/qa/audit-held-body.mjs', 'tools/qa/audit-character.mjs', 'tools/qa/read-audit-fixtures.mjs'];
  const fixtureKey = 'fixtures:' + inside(root, config.fixture.path);
  const fingerKeys = [...commonKeys, 'tools/qa/audit-finger-grip.mjs', 'tools/qa/read-audit-fixtures.mjs', 'validation/ten-rounds/union-fixtures.json', fixtureKey];
  const thumbKeys = [...commonKeys, 'tests/helpers/keeper-finger-grip-baseline.js', 'tools/qa/read-audit-fixtures.mjs', 'tools/qa/audit-thumb-body-differential.mjs', fixtureKey];
  const record = async path => {
    assert.ok((await lstat(resolve(out, path))).isFile(), 'missing/non-file artifact: ' + path);
    artifacts[path] = await hashFile(resolve(out, path));
    return resolve(out, path);
  };
  const read = async path => json(await record(path));
  const union = await read('union/union-report.json');
  assert.equal(union.manifestSha256, config.fixture.sha256); noFailures(union.failures);
  assert.equal(union.shots, config.fixture.shots); assert.equal(union.captures, config.fixture.captures);
  assert.equal(union.jobs, config.union.jobs); assert.equal(union.concurrency, 1);
  assert.equal(union.shards.length, config.union.jobs);
  assert.deepEqual(union.shards.map(shard => shard.index).sort(), [0, 1, 2, 3]);
  assert.deepEqual(union.shards.flatMap(shard => shard.fixtureIds).sort(), ids(fixture.fixtures), 'union omitted or duplicated shots');
  verifyHashMap(Object.fromEntries(Object.entries(union.sourceHashes).map(([path, value]) => ['src/' + path, value])), inputs, sourceKeys);
  const summary = await read('union-summary.json');
  assert.equal(summary.status, 'passed'); assert.equal(summary.manifestSha256, config.fixture.sha256);
  assert.equal(summary.shots, config.fixture.shots); assert.equal(summary.captures, config.fixture.captures);
  verifyHashMap(summary.testedFiles, inputs, summaryKeys);
  assert.equal(summary.receipts.length, config.union.jobs);
  assert.deepEqual(summary.receipts.map(row => row.shard).sort(), [0, 1, 2, 3]);
  for (const shard of union.shards) {
    const wanted = fixture.fixtures.filter((_, index) => index % config.union.jobs === shard.index);
    assert.deepEqual(shard.fixtureIds, wanted.map(row => row.id));
    const captures = wanted.filter(row => row.expectedCaught).length;
    assert.equal(shard.expectedCaptures, captures);
    for (const gate of ['body', 'hold', 'trajectory']) {
      assert.equal(shard.results[gate].exitCode, 0, 'failed union gate');
      assert.equal(shard.results[gate].signal, null, 'interrupted union gate');
    }
    const prefix = 'union/shard-' + shard.index;
    const input = await read(prefix + '/fixtures.json');
    assert.deepEqual(input.fixtures, wanted, 'shard changed fixture data'); assert.equal(input.expectedCaptures, captures);
    const body = await read(prefix + '/body/held-body-summary.json');
    noFailures(body.failures); assert.equal(body.captures, captures); assert.equal(body.candidateFixtures, wanted.length);
    assert.equal(body.baseHz, 10); assert.equal(body.denseHz, 120);
    const receipt = summary.receipts.find(row => row.shard === shard.index);
    assert.equal(receipt.shots, wanted.length); assert.equal(receipt.captures, captures);
    for (const [gate, suffix] of Object.entries({body: 'body/held-body-audit.json', hold: 'hold/actual-holding-240hz.json', trajectory: 'trajectory/near-keeper-trajectory.json'})) {
      const path = prefix + '/' + suffix;
      await record(path);
      assert.equal(receipt.files[gate].path, resolve(out, path), 'receipt artifact points elsewhere');
      assert.equal(receipt.files[gate].sha256, artifacts[path], 'missing or altered raw receipt');
    }
  }
  const expectedIds = ids(fixture.fixtures.filter(row => row.expectedCaught));
  const receiptInputs = {...inputs, ['fixtures:' + inside(root, config.fixture.path)]: config.fixture.sha256};
  const fingers = await read('finger-grip/finger-grip-audit.json'), fs = fingers.summary;
  verifyHashMap(fingers.hashesBefore, receiptInputs, fingerKeys); assert.deepEqual(fingers.hashesAfter, fingers.hashesBefore);
  assert.deepEqual(fs.fixtureInput, {path: inside(root, config.fixture.path), sha256: config.fixture.sha256, shots: 669, expectedCaptures: 223});
  noFailures(fs.failures); assert.equal(fs.captures, 223); assert.equal(fs.closedFinal, 223);
  assert.deepEqual(ids(fingers.records), expectedIds, 'finger audit omitted/duplicated catches');
  assert.equal(fs.samples, 223 * 150); assert.equal(fs.selfSamples, 82); assert.equal(fingers.selfRecords.length, 82);
  for (const row of fingers.records) {assert.equal(row.times.length, 150); assert.equal(row.amounts.length, 150);}
  const thumbs = await read('thumb-body/thumb-body-differential.json'), ts = thumbs.summary;
  assert.deepEqual(await read('thumb-body/thumb-body-summary.json'), ts);
  verifyHashMap(thumbs.hashesBefore, receiptInputs, thumbKeys); assert.deepEqual(thumbs.hashesAfter, thumbs.hashesBefore);
  assert.deepEqual(ts.fixture, {path: inside(root, config.fixture.path), sha256: config.fixture.sha256, shots: 669, expectedCaptures: 223});
  noFailures(ts.failures); assert.equal(ts.mode, 'full-caught-manifest'); assert.equal(ts.matchPlayback, true); assert.equal(ts.caught, 223);
  assert.deepEqual(ids(thumbs.captures), expectedIds, 'thumb audit omitted/duplicated catches');
  assert.equal(ts.initialTimes.length, 38); assert.equal(ts.samples, thumbs.records.length);
  assert.equal(ts.samples, 223 * 38 + ts.denseSamples);
  for (const row of thumbs.captures) {
    assert.equal(row.initialSamples, 38);
    assert.equal(thumbs.records.filter(record => record.id === row.id).length, 38 + row.denseSamples, 'thumb pose coverage missing');
  }
  return artifacts;
}

// Dependency injection is for fault tests only; CLI always uses executeGate.
export async function runRelease({root, out, mode = 'full', execute = executeGate}) {
  root = resolve(root);
  assert.ok(['full', 'plan', 'list'].includes(mode), 'unknown release mode');
  out = resolve(out ?? inside(root, 'validation/artifacts/release/' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8)));
  const report = {schemaVersion: 1, mode, status: 'running', acceptance: false, startedAt: new Date().toISOString(), out,
    environment: {node: process.version, platform: process.platform, arch: process.arch}, gates: [], failures: []};
  if (mode !== 'list') {await mkdir(dirname(out), {recursive: true}); await mkdir(out);}
  const save = async () => {
    if (mode === 'list') return;
    const temp = resolve(out, 'release-report.tmp');
    await writeFile(temp, JSON.stringify(report, null, 2) + '\n'); await rename(temp, resolve(out, 'release-report.json'));
  };
  try {
    const contract = await loadContract(root);
    Object.assign(report, {releaseId: contract.config.releaseId, configSha256: contract.configSha256, fixture: contract.config.fixture});
    report.environment.dependencies = await inspectInstalledPackages(root);
    for (const [name, dependency] of Object.entries(report.environment.dependencies)) {
      assert.equal(dependency.version, dependency.lockedVersion, 'installed ' + name + ' version differs from package-lock');
    }
    report.inputHashesBefore = await snapshotInputs(root);
    report.inputSnapshotSha256 = sha(JSON.stringify(report.inputHashesBefore));
    const testFiles = Object.keys(report.inputHashesBefore).filter(path => /^tests\/[^/]+\.test\.js$/.test(path));
    assert.ok(testFiles.length > 0, 'no unit tests discovered');
    report.gates = gatePlan(root, out, contract, testFiles).map(gate => ({...gate, status: 'not_run'}));
    await save();
    if (mode !== 'full') {report.status = 'planned'; return report;}
    for (const gate of report.gates) {
      gate.status = 'running'; gate.startedAt = new Date().toISOString(); gate.log = gate.id + '.log'; await save();
      const result = await execute(gate, {root, log: resolve(out, gate.log), out});
      Object.assign(gate, result, {completedAt: new Date().toISOString()});
      assert.equal(result.exitCode, 0, 'gate failed: ' + gate.id); assert.equal(result.signal, null, 'gate interrupted: ' + gate.id);
      assert.deepEqual(await snapshotInputs(root), report.inputHashesBefore, 'source changed during gate: ' + gate.id);
      gate.status = 'passed'; await save();
    }
    report.artifactHashes = await verifyArtifacts(root, out, contract, report.inputHashesBefore);
    for (const gate of report.gates) report.artifactHashes[gate.log] = await hashFile(resolve(out, gate.log));
    const buildFiles = await filesIn(out, 'build');
    assert.ok(buildFiles.includes('build/index.html') && buildFiles.includes('build/motion-lab.html'), 'missing build entry artifact');
    for (const path of buildFiles) report.artifactHashes[path] = await hashFile(resolve(out, path));
    report.environment.dependenciesAfter = await inspectInstalledPackages(root);
    assert.deepEqual(report.environment.dependenciesAfter, report.environment.dependencies, 'installed package resolution changed during release');
    report.inputHashesAfter = await snapshotInputs(root);
    assert.deepEqual(report.inputHashesAfter, report.inputHashesBefore, 'source changed before final receipt');
    report.status = 'passed'; report.acceptance = true;
  } catch (error) {
    report.status = 'failed'; report.failures.push(error.message);
    for (const gate of report.gates) if (gate.status === 'running') gate.status = 'failed';
  } finally {
    if (mode === 'full' && report.status === 'failed') {
      try {
        if (report.inputHashesBefore) report.inputHashesAfter = await snapshotInputs(root);
        // Preserve hashes of available logs and partial outputs as failure evidence.
        report.artifactHashes = {};
        for (const path of await filesIn(dirname(out), basename(out))) {
          const relativePath = path.slice(basename(out).length + 1);
          if (!['release-report.json', 'release-report.tmp'].includes(relativePath)) report.artifactHashes[relativePath] = await hashFile(resolve(out, relativePath));
        }
      } catch (error) {report.failures.push('Could not inventory all failure evidence: ' + error.message);}
    }
    report.completedAt = new Date().toISOString(); await save();
  }
  return report;
}
