import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { load as parseYaml, dump as toYaml } from 'js-yaml';

type YamlEdit<T, R> = (data: T) => R | Promise<R>;
interface YamlEditOptions<R> {
  shouldWrite?: (result: R) => boolean;
}

// A process-local queue keyed by the canonical target path.  All read/modify/write
// operations for a given YAML file pass through this queue, so concurrent HTTP
// requests cannot overwrite each other's changes with stale snapshots.
const pathLocks = new Map<string, Promise<void>>();

async function withPathLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const absolute = resolve(path);
  // The route layer normally passes one spelling of each path, but callers may
  // use a symlink or a different relative spelling.  Share one queue for all
  // aliases that resolve to the same existing YAML target.
  const key = existsSync(absolute) ? realpathSync(absolute) : absolute;
  const previous = pathLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveRelease) => { release = resolveRelease; });
  pathLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (pathLocks.get(key) === current) pathLocks.delete(key);
  }
}

export function backupPath(original: string): string {
  return `${original}.bak`;
}

function writeYamlUnlocked(path: string, data: unknown): void {
  const target = resolve(path);
  const directory = dirname(target);
  mkdirSync(directory, { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const mode = existsSync(target) ? statSync(target).mode & 0o777 : 0o644;
  let temporaryExists = false;
  const yaml = toYaml(data, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false });
  try {
    // Write beside the target and rename on the same filesystem.  Readers see
    // either the old complete file or the new complete file, never a partial one.
    writeFileSync(temporary, yaml, { encoding: 'utf8', mode });
    temporaryExists = true;
    if (existsSync(target)) copyFileSync(target, backupPath(target));
    renameSync(temporary, target);
    temporaryExists = false;
  } finally {
    if (temporaryExists) {
      try { unlinkSync(temporary); } catch { /* preserve the original write error */ }
    }
  }
}

export async function writeYaml(path: string, data: unknown): Promise<void> {
  await withPathLock(path, async () => {
    writeYamlUnlocked(path, data);
  });
}

/**
 * Atomically load, edit, and persist one YAML document while holding the
 * per-path lock.  The edit callback runs inside the critical section.
 */
export async function editYaml<T, R>(path: string, edit: YamlEdit<T, R>, options?: YamlEditOptions<R>): Promise<R> {
  return withPathLock(path, async () => {
    const data = parseYaml(readFileSync(path, 'utf8')) as T;
    const result = await edit(data);
    if (options?.shouldWrite?.(result) ?? true) writeYamlUnlocked(path, data);
    return result;
  });
}
