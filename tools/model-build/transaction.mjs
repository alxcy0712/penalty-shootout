// Recoverable multi-file replacement, not a claim of atomic visibility across files.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJson, assertRows, checkedPath, checkRows, exactKeys, fingerprint, readRegular, requireThat, sha256} from './files.mjs';

async function loadJournal(directory) {
  const journal = JSON.parse(await readRegular(directory, 'journal.json'));
  exactKeys(journal, ['schemaVersion', 'id', 'root', 'manifestSha256', 'state', 'entries'], 'journal');
  requireThat(journal.schemaVersion === 1 && /^[0-9a-f-]{36}$/.test(journal.id) && path.isAbsolute(journal.root), 'Invalid journal identity');
  requireThat(['preparing', 'prepared', 'promoting', 'promoted', 'rolling-back', 'rolled-back', 'needs-recovery'].includes(journal.state), 'Invalid journal state');
  requireThat(journal.manifestSha256 === null || /^[0-9a-f]{64}$/.test(journal.manifestSha256), 'Invalid journal manifest hash');
  requireThat(Array.isArray(journal.entries) && journal.entries.length > 0, 'Empty journal');
  for (const entry of journal.entries) {
    exactKeys(entry, ['path', 'before', 'after', 'intent'], 'journal entry');
    requireThat(typeof entry.intent === 'boolean', 'Invalid write intent');
    for (const row of [entry.before, entry.after]) { checkRows([row], 'journal fingerprint'); requireThat(row.path === entry.path, 'Mismatched journal paths'); }
  }
  requireThat(new Set(journal.entries.map(e => e.path)).size === journal.entries.length, 'Duplicate journal paths');
  requireThat(await fs.realpath(journal.root) === journal.root, 'Repository moved or symlinked');
  return journal;
}
const lockPath = root => path.join(root, '.model-build.lock');
async function checkLock(root, id) {
  const lock = JSON.parse(await readRegular(root, '.model-build.lock'));
  requireThat(lock.id === id, 'A different model transaction owns the repository lock');
}
async function acquireLock(root, id, directory) {
  // Hard-link complete lock content atomically on the repository filesystem.
  // A killed process can leave an unused private file, never an empty shared lock.
  const temporary = path.join(root, `.model-build-lock-${id}.tmp`);
  const file = await fs.open(temporary, 'wx');
  try { await file.writeFile(JSON.stringify({id, directory})); await file.sync(); }
  finally { await file.close(); }
  try { await fs.link(temporary, lockPath(root)); }
  finally { await fs.unlink(temporary); }
}
async function release(root, id) { await checkLock(root, id); await fs.unlink(lockPath(root)); }

export async function rollback(directory) {
  const journal = await loadJournal(directory);
  if (journal.state === 'rolled-back') {
    // A process may have stopped after the terminal journal write but before unlock.
    try { const lock = JSON.parse(await readRegular(journal.root, '.model-build.lock')); if (lock.id === journal.id) await release(journal.root, journal.id); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return journal;
  }
  try { await checkLock(journal.root, journal.id); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await acquireLock(journal.root, journal.id, directory);
  }
  const preparing = journal.state === 'preparing';
  try {
    if (preparing) {
      requireThat(journal.entries.every(e => !e.intent), 'Preparing journal contains write intents');
      await assertRows(journal.root, journal.entries.map(e => e.before));
      journal.state = 'rolled-back'; await atomicJson(path.join(directory, 'journal.json'), journal);
      await release(journal.root, journal.id); return journal;
    }
    // Inspect everything first; never clobber an unrelated later edit or a corrupt backup.
    for (const entry of journal.entries) {
      await assertRows(path.join(directory, 'backup'), [entry.before]);
      const current = await fingerprint(journal.root, entry.path);
      requireThat([entry.before.sha256, entry.after.sha256].includes(current.sha256), `Rollback conflict: ${entry.path}; backups retained`);
    }
    journal.state = 'rolling-back'; await atomicJson(path.join(directory, 'journal.json'), journal);
    for (const entry of [...journal.entries].reverse()) {
      const destination = await checkedPath(journal.root, entry.path);
      const current = await fingerprint(journal.root, entry.path);
      requireThat([entry.before.sha256, entry.after.sha256].includes(current.sha256), `Rollback conflict: ${entry.path}; backups retained`);
      const bytes = await readRegular(path.join(directory, 'backup'), entry.path);
      const temporary = `${destination}.model-build-${journal.id}`;
      // A killed process may leave its private, partially written staging file.
      try { requireThat(!(await fs.lstat(temporary)).isSymbolicLink(), 'Symlinked transaction staging file'); await fs.unlink(temporary); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const file = await fs.open(temporary, 'wx');
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      await fs.rename(temporary, destination);
    }
    await assertRows(journal.root, journal.entries.map(e => e.before));
    journal.state = 'rolled-back'; await atomicJson(path.join(directory, 'journal.json'), journal);
    await release(journal.root, journal.id);
    return journal;
  } catch (error) {
    journal.state = preparing ? 'preparing' : 'needs-recovery'; await atomicJson(path.join(directory, 'journal.json'), journal);
    throw error; // Keep this transaction's lock and backups until an explicit retry.
  }
}

export async function replaceFiles({root, candidateRoot, directory, before, after, afterSwap, manifestSha256 = null}) {
  // This primitive is deliberately separate from the CLI's release policy.
  checkRows(before, 'destinations'); checkRows(after, 'candidates');
  requireThat(JSON.stringify(before.map(e => e.path)) === JSON.stringify(after.map(e => e.path)), 'Transaction file sets differ');
  root = await fs.realpath(root); candidateRoot = await fs.realpath(candidateRoot);
  await assertRows(root, before); await assertRows(candidateRoot, after);
  const id = randomUUID();
  await fs.mkdir(directory); await fs.mkdir(path.join(directory, 'backup'));
  const journal = {schemaVersion: 1, id, root, manifestSha256, state: 'preparing', entries: before.map((entry, i) => ({path: entry.path, before: entry, after: after[i], intent: false}))};
  // The journal exists before any shared lock or destination write.
  await atomicJson(path.join(directory, 'journal.json'), journal);
  await acquireLock(root, id, directory);
  try {
    for (const entry of before) {
      const destination = await checkedPath(path.join(directory, 'backup'), entry.path, {missing: true});
      await fs.mkdir(path.dirname(destination), {recursive: true});
      const backup = await fs.open(destination, 'wx');
      try { await backup.writeFile(await readRegular(root, entry.path)); await backup.sync(); }
      finally { await backup.close(); }
    }
    await assertRows(path.join(directory, 'backup'), before);
    journal.state = 'prepared';
    await atomicJson(path.join(directory, 'journal.json'), journal);
    // Recheck after backups and before the first destination write.
    await assertRows(root, before); await assertRows(candidateRoot, after);
    for (const [index, entry] of journal.entries.entries()) {
      await assertRows(root, [entry.before]);
      const bytes = await readRegular(candidateRoot, entry.path);
      requireThat(sha256(bytes) === entry.after.sha256, 'Candidate changed during promotion');
      journal.state = 'promoting'; entry.intent = true;
      await atomicJson(path.join(directory, 'journal.json'), journal);
      const destination = await checkedPath(root, entry.path), temporary = `${destination}.model-build-${id}`;
      const file = await fs.open(temporary, 'wx');
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      await fs.rename(temporary, destination);
      if (afterSwap) await afterSwap(index); // Internal failure injection; never manifest/CLI executable input.
    }
    await assertRows(root, after);
    journal.state = 'promoted'; await atomicJson(path.join(directory, 'journal.json'), journal);
    await release(root, id);
    return journal;
  } catch (error) {
    try { await rollback(directory); }
    catch (recovery) { throw new AggregateError([error, recovery], `Promotion failed; recovery required at ${directory}`); }
    throw error;
  }
}
