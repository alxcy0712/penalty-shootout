import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {assemble, ARTIFACTS, checkManifest, inspect, promote, rollbackCandidate} from './candidate.mjs';
import {fingerprint, sha256} from './files.mjs';
import {replaceFiles, rollback} from './transaction.mjs';
import {parseCache, checkGlb} from './structure.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-build-test-')); t.after(() => fs.rm(root, {recursive: true, force: true}));
  const repo = path.join(root, 'repo'); await fs.mkdir(repo);
  const files = [...new Set([...ARTIFACTS, 'package.json', 'package-lock.json', ...(await fs.readdir(path.join(project, 'src'))).filter(n => n.endsWith('.js')).map(n => `src/${n}`)])];
  for (const file of files) { await fs.mkdir(path.dirname(path.join(repo, file)), {recursive: true}); await fs.copyFile(path.join(project, file), path.join(repo, file)); }
  return {root, repo, workspace: path.join(root, 'candidate'), files};
}
const hashes = (root, files) => Promise.all(files.map(p => fingerprint(root, p)));

test('snapshot/check/promote/rollback preserves every source byte and records honest gate scope', async t => {
  const f = await fixture(t), before = await hashes(f.repo, f.files);
  await assemble(f); const {report} = await inspect(f.workspace);
  assert.equal(report.promotable, true); assert.match(report.deepGates, /not-rerun/); assert.equal(report.changed.length, 0);
  assert.equal((await promote(f.workspace)).state, 'promoted');
  assert.equal((await rollback(path.join(f.workspace, 'transaction'))).state, 'rolled-back');
  assert.deepEqual(await hashes(f.repo, f.files), before);
  assert.ok((await fs.stat(path.join(f.workspace, 'transaction/backup/assets/characters/keeper-prototype.glb'))).isFile());
});
test('preflight rejects missing inputs, nested output, and symlink sources before candidate writes', async t => {
  const f = await fixture(t);
  await assert.rejects(assemble({...f, workspace: path.join(f.repo, 'candidate')}), /outside/);
  const file = path.join(f.repo, ARTIFACTS[0]); await fs.unlink(file); await fs.symlink(path.join(project, ARTIFACTS[0]), file);
  await assert.rejects(assemble(f), /Symlink/);
  await assert.rejects(fs.stat(f.workspace), {code: 'ENOENT'});
});
test('changed input, candidate bytes, and validation record cannot authorize promotion', async t => {
  const f = await fixture(t); await assemble(f); await inspect(f.workspace);
  const input = path.join(f.repo, 'src/keeper-skin-pose.js'); await fs.appendFile(input, '\n// changed\n');
  await assert.rejects(promote(f.workspace), /Changed file/); await fs.copyFile(path.join(project, 'src/keeper-skin-pose.js'), input);
  const candidate = path.join(f.workspace, 'candidate', ARTIFACTS[0]); const original = await fs.readFile(candidate); await fs.appendFile(candidate, 'x');
  await assert.rejects(promote(f.workspace), /Changed file/); await fs.writeFile(candidate, original);
  const validation = path.join(f.workspace, 'validation.json'); const report = JSON.parse(await fs.readFile(validation)); report.visualReview = 'passed'; await fs.writeFile(validation, JSON.stringify(report));
  await assert.rejects(promote(f.workspace), /validation record/);
});
test('complete changed import is inspectable but cannot bypass unavailable deep gates', async t => {
  const f = await fixture(t), bundle = path.join(f.root, 'import'); await fs.mkdir(bundle);
  for (const file of ARTIFACTS) { await fs.mkdir(path.dirname(path.join(bundle, file)), {recursive: true}); await fs.copyFile(path.join(f.repo, file), path.join(bundle, file)); }
  const metadata = path.join(bundle, 'assets/characters/keeper-prototype.json'); const meta = JSON.parse(await fs.readFile(metadata)); meta.candidateNote = 'External candidate; review pending'; await fs.writeFile(metadata, JSON.stringify(meta));
  await assemble({...f, from: bundle}); const {report} = await inspect(f.workspace);
  assert.equal(report.promotable, false); assert.match(report.visualReview, /required/);
  await assert.rejects(promote(f.workspace), /Changed candidates cannot/);
  await fs.appendFile(metadata, '\n'); await assert.rejects(inspect(f.workspace), /Changed file/);
});
test('schema rejects extra executable fields, duplicate artifacts, and path traversal', async t => {
  const f = await fixture(t); await assemble(f); const manifest = JSON.parse(await fs.readFile(path.join(f.workspace, 'manifest.json')));
  assert.throws(() => checkManifest({...manifest, command: 'echo unsafe'}), /fields/);
  assert.throws(() => checkManifest({...manifest, schemaVersion: 2}), /schema/);
  const duplicate = structuredClone(manifest); duplicate.artifacts.push(duplicate.artifacts[0]); assert.throws(() => checkManifest(duplicate), /duplicate/);
  const traversal = structuredClone(manifest); traversal.artifacts[0].path = '../outside'; assert.throws(() => checkManifest(traversal), /Unsafe/);
});
test('cache text is parsed as JSON without executing imported code', () => {
  assert.throws(() => parseCache(Buffer.from('globalThis.compromised = true;')), /JSON-only/);
  assert.throws(() => parseCache(Buffer.from('// Generated by tools/generate-keeper-contact.mjs from keeper-prototype.glb.\nexport const keeperContactData={};\nprocess.exit();')), /JSON-only/);
});
async function transactionFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-transaction-test-')); t.after(() => fs.rm(root, {recursive: true, force: true}));
  const repo = path.join(root, 'repo'), candidate = path.join(root, 'candidate'); await fs.mkdir(repo); await fs.mkdir(candidate);
  for (const name of ['one', 'two']) { await fs.writeFile(path.join(repo, name), 'old-' + name); await fs.writeFile(path.join(candidate, name), 'new-' + name); }
  return {root: repo, candidateRoot: candidate, directory: path.join(root, 'transaction'), before: await hashes(repo, ['one', 'two']), after: await hashes(candidate, ['one', 'two'])};
}
test('failure after the first swap restores all originals and retains hashed backups', async t => {
  const f = await transactionFixture(t);
  await assert.rejects(replaceFiles({...f, afterSwap: i => { if (i === 0) throw Error('injected failure'); }}), /injected failure/);
  assert.deepEqual(await hashes(f.root, ['one', 'two']), f.before);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory, 'journal.json'))).state, 'rolled-back');
  assert.deepEqual(await hashes(path.join(f.directory, 'backup'), ['one', 'two']), f.before);
});
test('interrupted promotion can recover and rollback refuses unrelated edits', async t => {
  const f = await transactionFixture(t);
  await replaceFiles(f);
  // A process dying after a swap can leave the durable intent journal in promoting.
  const journalPath = path.join(f.directory, 'journal.json'), journal = JSON.parse(await fs.readFile(journalPath)); journal.state = 'promoting'; await fs.writeFile(journalPath, JSON.stringify(journal));
  await fs.writeFile(path.join(f.root, 'two'), 'other-user-edit');
  await assert.rejects(rollback(f.directory), /Rollback conflict/);
  assert.equal(await fs.readFile(path.join(f.root, 'one'), 'utf8'), 'new-one');
  await fs.writeFile(path.join(f.root, 'two'), 'new-two');
  await rollback(f.directory); assert.deepEqual(await hashes(f.root, ['one', 'two']), f.before);
});
test('corrupt recovery backup prevents any destination writes', async t => {
  const f = await transactionFixture(t); await replaceFiles(f);
  await fs.writeFile(path.join(f.directory, 'backup/two'), 'corrupt');
  await assert.rejects(rollback(f.directory), /Changed file/); assert.deepEqual(await hashes(f.root, ['one', 'two']), f.after);
});
test('both legacy rebuilds and unsupported capabilities fail before any Blender write', () => {
  const code = `import ast, pathlib, runpy
class Forbidden:
 def __getattr__(self, name): raise AssertionError('Blender accessed before guard: '+name)
for script, helper in [('refine_football_model.py', 'refine_character'), ('repair_keeper_skin.py', 'repair_jersey')]:
 p=pathlib.Path('tools/blender')/script
 tree=ast.parse(p.read_text())
 assert any(isinstance(n, ast.FunctionDef) and n.name == helper for n in tree.body)
 fn=next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'rebuild')
 ns={'bpy':Forbidden()}
 exec(compile(ast.Module(body=[fn], type_ignores=[]), str(p), 'exec'), ns)
 try: ns['rebuild']()
 except RuntimeError as e: assert 'before any source write' in str(e)
 else: raise AssertionError('unsafe rebuild enabled: '+script)
probe=runpy.run_path('tools/model-build/blender_capabilities.py')
try: probe['require_capabilities']({'actionLayers':False,'actionSlots':False,'meshoptModule':False})
except RuntimeError as e: assert 'before authoring' in str(e)
else: raise AssertionError('missing APIs accepted')
`;
  execFileSync('python3', ['-B', '-c', code], {cwd: project});
});
test('tool fingerprint change and forged cache provenance fail checks without source writes', async t => {
  const f = await fixture(t); await assemble(f);
  const manifestPath = path.join(f.workspace, 'manifest.json'), manifest = JSON.parse(await fs.readFile(manifestPath));
  const original = structuredClone(manifest); manifest.tools[0].sha256 = '0'.repeat(64); await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(inspect(f.workspace), /Changed file/);
  await fs.writeFile(manifestPath, JSON.stringify(original));
  const before = await hashes(f.repo, f.files), cacheFile = path.join(f.workspace, 'candidate/src/keeper-contact-data.js');
  const cacheText = (await fs.readFile(cacheFile, 'utf8')).replace(/"skinPoseSha256":"[a-f0-9]+"/, '"skinPoseSha256":"' + '0'.repeat(64) + '"');
  await fs.writeFile(cacheFile, cacheText);
  const row = original.artifacts.find(a => a.path === 'src/keeper-contact-data.js'); row.sha256 = sha256(Buffer.from(cacheText)); row.bytes = Buffer.byteLength(cacheText);
  await fs.writeFile(manifestPath, JSON.stringify(original)); await assert.rejects(inspect(f.workspace), /cache provenance mismatch/);
  assert.deepEqual(await hashes(f.repo, f.files), before);
});
test('recovery removes only its own interrupted staging file before restoring originals', async t => {
  const f = await transactionFixture(t); await replaceFiles(f);
  const journal = JSON.parse(await fs.readFile(path.join(f.directory, 'journal.json')));
  await fs.writeFile(path.join(f.root, 'one.model-build-' + journal.id), 'partial');
  await rollback(f.directory); assert.deepEqual(await hashes(f.root, ['one', 'two']), f.before);
});

test('workspace rollback rejects copied or mismatched repository journals', async t => {
  const f = await fixture(t); await assemble(f); await inspect(f.workspace); await promote(f.workspace);
  const journalPath = path.join(f.workspace, 'transaction/journal.json'), original = JSON.parse(await fs.readFile(journalPath));
  const copied = {...original, root: project}; await fs.writeFile(journalPath, JSON.stringify(copied));
  await assert.rejects(rollbackCandidate(f.workspace), /manifest\/root/);
  await fs.writeFile(journalPath, JSON.stringify({...original, manifestSha256: '0'.repeat(64)}));
  await assert.rejects(rollbackCandidate(f.workspace), /manifest\/root/);
  await fs.writeFile(journalPath, JSON.stringify(original)); await rollbackCandidate(f.workspace);
});
test('preparing recovery needs no completed backups and makes no destination writes', async t => {
  const f = await transactionFixture(t); await replaceFiles(f); await rollback(f.directory);
  const journalPath = path.join(f.directory, 'journal.json'), journal = JSON.parse(await fs.readFile(journalPath));
  journal.state = 'preparing'; journal.entries.forEach(e => e.intent = false);
  await fs.writeFile(journalPath, JSON.stringify(journal)); await fs.rm(path.join(f.directory, 'backup'), {recursive: true});
  await rollback(f.directory); assert.deepEqual(await hashes(f.root, ['one', 'two']), f.before);
});

test('oversized files and decoded declarations fail before allocation or candidate writes', async t => {
  const f = await fixture(t), file = path.join(f.repo, 'assets/characters/keeper-prototype.glb');
  const source = await fs.readFile(file), jsonLength = source.readUInt32LE(12), doc = JSON.parse(source.subarray(20, 20 + jsonLength));
  doc.bufferViews[0].byteLength = 32 * 1024 * 1024;
  let json = Buffer.from(JSON.stringify(doc)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const tail = source.subarray(20 + jsonLength), header = Buffer.from(source.subarray(0, 20)); header.writeUInt32LE(20 + json.length + tail.length, 8); header.writeUInt32LE(json.length, 12);
  await assert.rejects(checkGlb(Buffer.concat([header, json, tail]), {}, {}), /before allocation/);
  const handle = await fs.open(file, 'w'); await handle.truncate(450001); await handle.close();
  await assert.rejects(assemble(f), /size limit before read/); await assert.rejects(fs.stat(f.workspace), {code: 'ENOENT'});
});

test('terminal rollback retry releases its own interrupted unlock only', async t => {
  const f = await transactionFixture(t); await replaceFiles(f); await rollback(f.directory);
  const journal = JSON.parse(await fs.readFile(path.join(f.directory, 'journal.json')));
  await fs.writeFile(path.join(f.root, '.model-build.lock'), JSON.stringify({id: journal.id, directory: f.directory}));
  await rollback(f.directory); await assert.rejects(fs.stat(path.join(f.root, '.model-build.lock')), {code: 'ENOENT'});
});
