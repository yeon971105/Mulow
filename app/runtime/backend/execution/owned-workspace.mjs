import {mkdtemp, mkdir, writeFile, rm, lstat, realpath} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {freezeFiles} from './policy.mjs';

// Materializes ONLY explicitly supplied text. Never scans, resets, writes or cleans a user repository.
// This is lifecycle isolation, not an OS sandbox for hostile code. No subprocess runner is provided.
export async function createOwnedWorkspace(baseline) {
  const files = freezeFiles(baseline);
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, 'musepilot-execution-'));
  const identity = await lstat(root);
  let closed = false;
  const candidates = new Map();
  async function assertOwned() {
    if (closed) throw Error('workspace_closed');
    const now = await lstat(root);
    if (now.isSymbolicLink() || !now.isDirectory() || now.dev !== identity.dev || now.ino !== identity.ino || await realpath(dirname(root)) !== parent) throw Error('workspace_identity_changed');
  }
  async function materialize(directory, entries, mode) {
    await mkdir(directory, {mode: 0o700});
    for (const file of entries) {
      const target = join(directory, file.path);
      await mkdir(dirname(target), {recursive: true, mode: 0o700});
      await writeFile(target, file.content, {flag: 'wx', mode});
    }
  }
  try { await materialize(join(root, 'baseline'), files, 0o400); }
  catch (error) { await rm(root, {recursive: true, force: true}); throw error; }
  return Object.freeze({
    async candidate(attempt, entries) {
      await assertOwned();
      if (!Number.isInteger(attempt) || attempt < 1 || attempt > 3 || candidates.has(attempt)) throw Error('invalid_attempt');
      const checked = freezeFiles(entries), path = join(root, `attempt-${attempt}`);
      await materialize(path, checked, 0o600);
      candidates.set(attempt, path);
      return path;
    },
    async discard(attempt) {
      await assertOwned();
      const path = candidates.get(attempt);
      if (path) { await rm(path, {recursive: true, force: true}); candidates.delete(attempt); }
    },
    async close() {
      if (closed) return;
      await assertOwned();
      await rm(root, {recursive: true, force: true});
      closed = true; candidates.clear();
    }
  });
}
