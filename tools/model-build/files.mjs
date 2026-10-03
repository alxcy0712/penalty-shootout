import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export function requireThat(value, message) { if (!value) throw new Error(message); }
export function exactKeys(value, keys, label) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
  requireThat(Object.keys(value).sort().join(',') === [...keys].sort().join(','), `${label}: unexpected or missing fields`);
}
export function relativeFile(value) {
  requireThat(typeof value === 'string' && value.length > 0 && !value.includes('\\') && !path.isAbsolute(value) && value.split('/').every(p => p && p !== '.' && p !== '..'), 'Unsafe relative file path');
  return value;
}
export async function checkedPath(root, relative, {missing = false} = {}) {
  relativeFile(relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { requireThat(!(await fs.lstat(current)).isSymbolicLink(), `Symlink refused: ${current}`); }
    catch (error) { if (!(missing && error.code === 'ENOENT')) throw error; }
  }
  return current;
}
export async function readRegular(root, relative) {
  const file = await checkedPath(root, relative);
  const stat = await fs.stat(file);
  requireThat(stat.isFile(), `Not a regular file: ${relative}`);
  const limit = relative.endsWith('.glb') ? 450000 : relative.endsWith('.blend') ? 16 * 1024 * 1024 : 8 * 1024 * 1024;
  requireThat(stat.size <= limit, `Input file exceeds size limit before read: ${relative}`);
  return fs.readFile(file);
}
export async function fingerprint(root, relative) {
  const bytes = await readRegular(root, relative);
  return {path: relative, sha256: sha256(bytes), bytes: bytes.length};
}
export async function assertRows(root, rows) {
  for (const expected of rows) {
    const actual = await fingerprint(root, expected.path);
    requireThat(actual.sha256 === expected.sha256 && actual.bytes === expected.bytes, `Changed file: ${expected.path}`);
  }
}
export function checkRows(rows, label) {
  requireThat(Array.isArray(rows) && rows.length > 0, `${label}: expected nonempty array`);
  const paths = new Set();
  for (const row of rows) {
    exactKeys(row, ['path', 'sha256', 'bytes'], label);
    relativeFile(row.path);
    requireThat(!paths.has(row.path), `${label}: duplicate path`); paths.add(row.path);
    requireThat(/^[0-9a-f]{64}$/.test(row.sha256) && Number.isSafeInteger(row.bytes) && row.bytes >= 0, `${label}: invalid fingerprint`);
  }
}
export async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx');
  try { await handle.writeFile(jsonBytes(value)); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temporary, file);
}
export async function freshWorkspace(workspace, roots) {
  const parent = await fs.realpath(path.dirname(path.resolve(workspace)));
  const target = path.join(parent, path.basename(workspace));
  for (const root of roots) {
    const relation = path.relative(root, target);
    requireThat(relation && relation.startsWith('..' + path.sep), 'Workspace must be outside the repository and import directory');
    const reverse = path.relative(target, root);
    requireThat(reverse && reverse.startsWith('..' + path.sep), 'Workspace cannot contain input directories');
  }
  try { await fs.lstat(target); throw new Error('Workspace must not exist'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return target;
}
