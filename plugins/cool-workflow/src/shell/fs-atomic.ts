// shell/fs-atomic.ts — atomic JSON writes (temp file, then rename) and
// file locks made with link(2), single-winner where O_EXCL was seen not to be.

import * as fs from "node:fs";
import * as path from "node:path";

export function writeJson(file: string, value: unknown, options: { durable?: boolean } = {}): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, options);
}

export function writeFileAtomic(file: string, text: string, options: { durable?: boolean } = {}): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, text);
    if (options.durable) fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/** One file-name segment from a task id; `:` stays (worker-map:x). */
export function safeFileName(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}

/** A run id names one folder under .cw/runs: one safe segment, never `.`/`..`. */
export function assertSafeRunId(value: unknown, context = "run id"): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${context}: expected a non-empty string`);
  if (!/^[A-Za-z0-9._:-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`Unsafe ${context}: ${JSON.stringify(value)} must be a single path segment ([A-Za-z0-9._:-], not '.' or '..')`);
  }
  return value;
}

function realResolve(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    const parent = path.dirname(abs);
    return parent === abs ? abs : path.join(realResolve(parent), path.basename(abs));
  }
}

/** True when `candidate` is `allowed` or inside it, after symlinks. */
export function isContainedPath(candidate: string, allowed: string): boolean {
  const c = realResolve(candidate);
  const a = realResolve(allowed);
  return c === a || c.startsWith(a + path.sep);
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Take `lock` once; a lock whose holder pid is gone is taken over. */
export function tryLock(lock: string): boolean {
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const tmp = `${lock}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, `${process.pid}\n`);
  try {
    fs.linkSync(tmp, lock);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const holder = lockPid(lock);
    if (Number.isNaN(holder) || pidAlive(holder)) return false;
    // A dead holder: one stealer at a time (a guard taken by link), so two
    // processes can never both remove the stale lock and both win.
    const guard = `${lock}.steal`;
    try {
      fs.linkSync(tmp, guard);
    } catch {
      try {
        if (Date.now() - fs.statSync(guard).mtimeMs > 10_000) fs.rmSync(guard, { force: true });
      } catch {
        /* gone */
      }
      return false;
    }
    try {
      if (lockPid(lock) !== holder) return false;
      fs.renameSync(tmp, lock);
      return true;
    } finally {
      fs.rmSync(guard, { force: true });
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function lockPid(lock: string): number {
  try {
    return Number(fs.readFileSync(lock, "utf8").trim());
  } catch {
    return NaN;
  }
}

export function lockHolder(lock: string): number | undefined {
  const pid = lockPid(lock);
  return pidAlive(pid) ? pid : undefined;
}

export function unlock(lock: string): void {
  if (lockPid(lock) === process.pid) fs.rmSync(lock, { force: true });
}

const HELD = new Set<string>();

/** Run `fn` under `<target>.lock`, waiting up to ~6s. Re-entrant in-process. */
export function withFileLock<T>(target: string, fn: () => T): T {
  const lock = path.resolve(`${target}.lock`);
  if (HELD.has(lock)) return fn();
  const deadline = Date.now() + 6000;
  let wait = 5;
  while (!tryLock(lock)) {
    if (Date.now() >= deadline) throw new Error(`could not acquire file lock for ${target}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait + Math.floor(Math.random() * wait));
    wait = Math.min(wait * 2, 200);
  }
  HELD.add(lock);
  try {
    return fn();
  } finally {
    HELD.delete(lock);
    unlock(lock);
  }
}
