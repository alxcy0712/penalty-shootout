import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {atomicJson, assertRows, checkedPath, checkRows, exactKeys, fingerprint, freshWorkspace, jsonBytes, readRegular, requireThat, sha256} from './files.mjs';
import {checkBlend, checkGlb, parseCache} from './structure.mjs';
import {replaceFiles, rollback} from './transaction.mjs';

export const MODEL_NAMES = ['keeper-prototype', 'striker-mocap'];
export const ARTIFACTS = [...MODEL_NAMES.flatMap(n => ['glb', 'blend', 'json'].map(e => `assets/characters/${n}.${e}`)), 'assets/characters/model-refinement.json', 'src/keeper-contact-data.js'].sort();
const decoderFile = fileURLToPath(import.meta.resolve('three/addons/libs/meshopt_decoder.module.js'));
const decoderHash = async () => sha256(await fs.readFile(decoderFile));
const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function inputPaths(root) {
  const src = (await fs.readdir(path.join(root, 'src'))).filter(n => n.endsWith('.js')).map(n => `src/${n}`);
  return [...new Set([...ARTIFACTS, ...src, 'package.json', 'package-lock.json'])].sort();
}
async function toolPaths() {
  return [...(await fs.readdir(path.join(codeRoot, 'tools/model-build'))).filter(n => /\.(mjs|py)$/.test(n)).map(n => `tools/model-build/${n}`), 'tools/blender/refine_football_model.py', 'tools/blender/repair_keeper_skin.py'].sort();
}
const fingerprints = (root, paths) => Promise.all(paths.map(p => fingerprint(root, p)));
function samePaths(rows, paths) { return JSON.stringify(rows.map(r => r.path).sort()) === JSON.stringify([...paths].sort()); }
export function checkManifest(m) {
  exactKeys(m, ['schemaVersion', 'adapter', 'createdAt', 'repositoryRoot', 'toolRoot', 'importRoot', 'baseCommit', 'nodeVersion', 'meshoptDecoderSha256', 'sourceKind', 'inputs', 'tools', 'externalInputs', 'artifacts'], 'manifest');
  requireThat(m.schemaVersion === 1 && ['snapshot-v1', 'import-v1'].includes(m.adapter), 'Unsupported candidate schema/adapter');
  requireThat(m.sourceKind === 'published-editable-reconstruction', 'Unsupported source classification');
  requireThat(typeof m.createdAt === 'string' && !Number.isNaN(Date.parse(m.createdAt)) && /^v\d+\./.test(m.nodeVersion), 'Invalid provenance');
  requireThat(/^[0-9a-f]{64}$/.test(m.meshoptDecoderSha256), 'Invalid decoder fingerprint');
  requireThat(m.baseCommit === null || /^[0-9a-f]{40}$/.test(m.baseCommit), 'Invalid source revision');
  for (const name of ['repositoryRoot', 'toolRoot']) requireThat(typeof m[name] === 'string' && path.isAbsolute(m[name]), `Invalid ${name}`);
  for (const name of ['inputs', 'tools', 'artifacts']) checkRows(m[name], name);
  requireThat(samePaths(m.artifacts, ARTIFACTS), 'Candidate must contain the complete fixed artifact set');
  if (m.adapter === 'import-v1') {
    requireThat(typeof m.importRoot === 'string' && path.isAbsolute(m.importRoot), 'Missing import root'); checkRows(m.externalInputs, 'externalInputs');
    requireThat(samePaths(m.externalInputs, ARTIFACTS), 'Incomplete import provenance');
  } else requireThat(m.importRoot === null && Array.isArray(m.externalInputs) && m.externalInputs.length === 0, 'Unexpected snapshot import');
}
export async function preflight(repo) {
  const root = await fs.realpath(repo);
  const inputs = await fingerprints(root, await inputPaths(root));
  const tools = await fingerprints(codeRoot, await toolPaths());
  // Snapshot/import uses no Blender, exporter, Python authoring script, or user command.
  return {root, inputs, tools, sourceKind: 'published-editable-reconstruction', blender: 'not invoked; no generating adapter is enabled'};
}
export async function assemble({repo, workspace, from = null}) {
  const baseline = await preflight(repo), importRoot = from ? await fs.realpath(from) : null;
  const target = await freshWorkspace(workspace, [baseline.root, ...(importRoot ? [importRoot] : [])]);
  const source = importRoot ?? baseline.root;
  const artifacts = await fingerprints(source, ARTIFACTS);
  // All required reads and path checks happen before the first output directory is created.
  let baseCommit = null;
  try { baseCommit = execFileSync('git', ['-C', baseline.root, 'rev-parse', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch {}
  const manifest = {schemaVersion: 1, adapter: from ? 'import-v1' : 'snapshot-v1', createdAt: new Date().toISOString(), repositoryRoot: baseline.root, toolRoot: codeRoot, importRoot, baseCommit, nodeVersion: process.version, meshoptDecoderSha256: await decoderHash(), sourceKind: baseline.sourceKind, inputs: baseline.inputs, tools: baseline.tools, externalInputs: from ? artifacts : [], artifacts};
  checkManifest(manifest);
  await fs.mkdir(target); await fs.mkdir(path.join(target, 'candidate'));
  try {
    for (const entry of artifacts) {
      const destination = await checkedPath(path.join(target, 'candidate'), entry.path, {missing: true});
      await fs.mkdir(path.dirname(destination), {recursive: true});
      await fs.writeFile(destination, await readRegular(source, entry.path), {flag: 'wx'});
    }
    await assertRows(baseline.root, baseline.inputs); await assertRows(source, artifacts);
    await assertRows(codeRoot, baseline.tools); await assertRows(path.join(target, 'candidate'), artifacts);
    await atomicJson(path.join(target, 'manifest.json'), manifest);
  } catch (error) {
    await atomicJson(path.join(target, 'failed.json'), {stage: 'assembly', message: error.message});
    throw error;
  }
  return {workspace: target, manifestSha256: sha256(jsonBytes(manifest)), adapter: manifest.adapter};
}
export async function inspect(workspace, {writeReport = true} = {}) {
  const root = await fs.realpath(workspace), bytes = await readRegular(root, 'manifest.json'), manifest = JSON.parse(bytes);
  checkManifest(manifest);
  requireThat(manifest.meshoptDecoderSha256 === await decoderHash(), 'Installed Meshopt decoder changed');
  requireThat(manifest.toolRoot === codeRoot && manifest.nodeVersion === process.version, 'Tool root or Node version changed; assemble a fresh candidate');
  requireThat(samePaths(manifest.inputs, await inputPaths(manifest.repositoryRoot)) && samePaths(manifest.tools, await toolPaths()), 'Input/tool inventory changed');
  await assertRows(manifest.repositoryRoot, manifest.inputs); await assertRows(codeRoot, manifest.tools);
  if (manifest.importRoot) await assertRows(manifest.importRoot, manifest.externalInputs);
  const candidate = await fs.realpath(path.join(root, 'candidate'));
  requireThat(candidate === path.join(root, 'candidate'), 'Symlinked candidate directory');
  await assertRows(candidate, manifest.artifacts);
  const identity = JSON.parse(await readRegular(candidate, 'assets/characters/model-refinement.json')), models = {};
  for (const name of MODEL_NAMES) {
    const file = `assets/characters/${name}`;
    models[name] = {glb: await checkGlb(await readRegular(candidate, file + '.glb'), JSON.parse(await readRegular(candidate, file + '.json')), identity.models[name]), blend: checkBlend(await readRegular(candidate, file + '.blend'))};
  }
  const cache = parseCache(await readRegular(candidate, 'src/keeper-contact-data.js'));
  const expectedCache = {asset: 'keeper-prototype.glb', sha256: manifest.artifacts.find(r => r.path === 'assets/characters/keeper-prototype.glb').sha256, skinPoseSha256: manifest.inputs.find(r => r.path === 'src/keeper-skin-pose.js').sha256, keeperTorsoSha256: manifest.inputs.find(r => r.path === 'src/keeper-torso.js').sha256, skinWeightsSha256: manifest.inputs.find(r => r.path === 'src/keeper-skin-weights.js').sha256};
  for (const [key, value] of Object.entries(expectedCache)) requireThat(cache.source[key] === value, `Contact cache provenance mismatch: ${key}`);
  const changed = manifest.artifacts.filter(a => a.sha256 !== manifest.inputs.find(i => i.path === a.path)?.sha256).map(a => a.path);
  requireThat(manifest.adapter !== 'snapshot-v1' || changed.length === 0, 'Snapshot adapter cannot contain changed artifacts');
  const report = {schemaVersion: 1, manifestSha256: sha256(bytes), basicChecks: 'passed', models, cacheProvenance: 'matched', changed, deepGates: changed.length ? 'not-run; candidate-scoped runner is not implemented' : 'not-rerun; all artifacts byte-identical to baseline', visualReview: changed.length ? 'required; no accepted review adapter exists' : 'not-rerun; all artifacts byte-identical to baseline', promotable: changed.length === 0, scope: 'Structural/budget/source/cache checks only. No full collision, Blender structural equivalence, visual, WebGL or device proof.'};
  // Ensure source and staged bytes did not change while structural validation ran.
  await assertRows(manifest.repositoryRoot, manifest.inputs); await assertRows(codeRoot, manifest.tools); await assertRows(candidate, manifest.artifacts);
  if (writeReport) await atomicJson(path.join(root, 'validation.json'), report);
  return {root, candidate, manifest, report};
}
export async function promote(workspace) {
  const state = await inspect(workspace, {writeReport: false});
  const saved = JSON.parse(await readRegular(state.root, 'validation.json'));
  requireThat(JSON.stringify(saved) === JSON.stringify(state.report), 'Run check again: validation record missing, changed, or stale');
  requireThat(state.report.promotable, 'Changed candidates cannot be promoted in A1: fixed deep gates and visual review are not implemented');
  const before = state.manifest.artifacts.map(a => state.manifest.inputs.find(i => i.path === a.path));
  return replaceFiles({root: state.manifest.repositoryRoot, candidateRoot: state.candidate, directory: path.join(state.root, 'transaction'), manifestSha256: state.report.manifestSha256, before, after: state.manifest.artifacts});
}

export async function rollbackCandidate(workspace) {
  const root = await fs.realpath(workspace), bytes = await readRegular(root, 'manifest.json'), manifest = JSON.parse(bytes);
  checkManifest(manifest);
  const directory = path.join(root, 'transaction');
  const journal = JSON.parse(await readRegular(directory, 'journal.json'));
  requireThat(journal.root === manifest.repositoryRoot && journal.manifestSha256 === sha256(bytes), 'Rollback journal does not match workspace manifest/root');
  const expectedBefore = manifest.artifacts.map(a => manifest.inputs.find(i => i.path === a.path));
  requireThat(JSON.stringify(journal.entries.map(e => e.before)) === JSON.stringify(expectedBefore) && JSON.stringify(journal.entries.map(e => e.after)) === JSON.stringify(manifest.artifacts), 'Rollback journal artifact fingerprints do not match workspace');
  return rollback(directory);
}
