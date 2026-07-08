// shell/fs-atomic.ts — atomic/durable JSON file IO and the cross-process
// advisory file lock. Impure by nature (fs calls); this is the shell layer,
// not core. Every writer in core/+shell/ that touches disk goes through
// `writeJson` here, so the write bytes stay exactly one place.
//
// Evidence: SPEC/state-core.md "Write ordering and atomic rules", "Lock
// protocol"; docs/rebuild/PLAN.md byte-compat items 1 and 6.

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// writeJson — the ONE JSON-on-disk byte format: JSON.stringify(value, null, 2)
// + "\n", written via temp-file + optional fsync + rename (atomic).
// ---------------------------------------------------------------------------

let atomicWriteCounter = 0;

export interface WriteJsonOptions {
  /** fsync the file (and best-effort the parent dir) so bytes survive a
   *  crash/power loss. Used for AUTHORITATIVE state (state.json, registry
   *  overlays, reclaimed.json). Skipped for high-frequency derived/
   *  rebuildable writes so the atomic rename itself stays cheap. */
  durable?: boolean;
}

/** Atomic, optionally-durable JSON write. ORDER IS THE SAFETY PROPERTY: write
 *  the full bytes to a unique temp file, optionally fsync it, close, then
 *  rename over the target. `rename(2)` is atomic on POSIX, so a reader always
 *  sees either the old bytes or the new bytes, never a torn file. On a rename
 *  failure the temp file is removed (best-effort) and the error is rethrown —
 *  the old bytes at `file` are never touched. */
export function writeJson(file: string, value: unknown, options: WriteJsonOptions = {}): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${atomicWriteCounter++}`;
  // 0o600: this is run/ledger/registry state, not a file meant to be shared
  // with other local users. rename(2) preserves the mode set at creation, so
  // this covers the final file too.
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    if (options.durable) fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best-effort temp cleanup */
    }
    throw error;
  }
  if (options.durable) {
    try {
      const dirFd = fs.openSync(path.dirname(file), "r");
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      /* directory fsync is best-effort (not supported on every platform) */
    }
  }
}

/** Read + JSON.parse a file. Throws `File not found: <file>` when absent,
 *  `Invalid JSON in <file>: <message>` on a parse error. */
export function readJson(file: string): unknown {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${file}: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Safe ids / names — src/state.ts:310-334 in the old build.
// ---------------------------------------------------------------------------

/** Replaces every run of chars outside `[a-zA-Z0-9_.:-]` with a single `_`. */
export function safeFileName(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}

/** Refuse a run id that is not a single safe path segment, so an id taken
 *  from an untrusted source (an imported run archive/bundle) can never
 *  escape the runs directory via a separator or a `..`/`.` component. The
 *  charset already forbids any separator, so the whole id is ONE path
 *  component; only the exact components `.` and `..` are refused — an
 *  EMBEDDED `..` (e.g. `v1..2`) is a safe directory name and is allowed. */
export function assertSafeRunId(value: unknown, context = "run id"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${context}: expected a non-empty string`);
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(
      `Unsafe ${context}: ${JSON.stringify(value)} must be a single path segment ([A-Za-z0-9._:-], not '.' or '..')`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Symlink-hardened path containment — src/state.ts:195-227 in the old build.
// ---------------------------------------------------------------------------

/** Realpath the deepest EXISTING ancestor (follows symlinks), then re-join
 *  the not-yet-created tail. If nothing exists up to the root, returns
 *  plain `path.resolve(target)`. */
export function realResolve(target: string): string {
  let current = path.resolve(target);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/** True when `realResolve(candidate)` equals `realResolve(allowed)` or
 *  starts with it plus `path.sep`. Realpaths BOTH sides so a symlinked temp
 *  root (macOS `/tmp` -> `/private/tmp`) compares right. */
export function isContainedPath(candidate: string, allowed: string): boolean {
  const realCandidate = realResolve(candidate);
  const realAllowed = realResolve(allowed);
  return realCandidate === realAllowed || realCandidate.startsWith(realAllowed + path.sep);
}

// ---------------------------------------------------------------------------
// durableAppendFileSync — append a line and fsync it before returning. Used
// by the trust-audit event log, whose loss breaks audit-completeness.
// ---------------------------------------------------------------------------

export function durableAppendFileSync(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "a", 0o600);
  try {
    fs.writeFileSync(fd, data, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// withFileLock — portable advisory cross-process lock.
//
// Lock file: `<targetPath>.lock`, created with O_EXCL (`wx`), body
// `"<pid>@<ISO>\n"`. Up to 240 tries; on EEXIST, a lock whose mtime is older
// than FILE_LOCK_STALE_MS (30_000) is stolen (deleted) and retried AT ONCE;
// else sleep 25ms (Atomics.wait busy-safe sleep) and retry. Any non-EEXIST
// open error is rethrown. No lock after 240 tries throws
// `could not acquire file lock for <targetPath>`.
//
// Right before fn() the lock mtime is refreshed (utimesSync, best-effort).
// After fn() returns, the lock body is re-read: if it no longer starts with
// "<pid>@", the lock was stolen mid-operation -> throw the "stolen" error and
// do NOT delete the thief's lock. On the release path the lock is removed
// only when still owned by this pid.
// ---------------------------------------------------------------------------

const FILE_LOCK_STALE_MS = 30_000;

// Lock paths this process holds right now. A nested withFileLock on the
// SAME target runs its fn directly (re-entrant) instead of waiting on its
// own lock file until the 240 tries run out — that lets a whole
// load -> change -> save cycle hold one lock while the save path inside
// it keeps its own withFileLock call unchanged.
const HELD_LOCKS = new Set<string>();

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run `fn` while holding an advisory lock for `targetPath`; always released
 *  (unless the lock was stolen mid-operation, in which case releasing would
 *  corrupt the thief's critical section, so it is deliberately NOT released).
 *  Re-entrant inside one process: a nested call on the same target runs
 *  `fn` under the already-held lock. */
export function withFileLock<T>(targetPath: string, fn: () => T): T {
  const lock = `${targetPath}.lock`;
  const heldKey = path.resolve(lock);
  if (HELD_LOCKS.has(heldKey)) return fn();
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const pid = String(process.pid);
  let acquired = false;
  for (let attempt = 0; attempt < 240 && !acquired; attempt++) {
    try {
      const fd = fs.openSync(lock, "wx", 0o600);
      fs.writeFileSync(fd, `${pid}@${new Date().toISOString()}\n`, "utf8");
      fs.closeSync(fd);
      acquired = true;
    } catch (error) {
      if (!(error && typeof error === "object" && (error as { code?: string }).code === "EEXIST")) {
        throw error;
      }
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > FILE_LOCK_STALE_MS) {
          fs.rmSync(lock, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      sleepSync(25);
    }
  }
  if (!acquired) throw new Error(`could not acquire file lock for ${targetPath}`);
  HELD_LOCKS.add(heldKey);

  // Refresh mtime right before the critical section.
  try {
    fs.utimesSync(lock, new Date(), new Date());
  } catch {
    /* best-effort */
  }

  try {
    const result = fn();
    // Verify the lock was not stolen during fn(). If our pid is no longer at
    // the front of the lock body, another process's stale-steal fired mid-
    // operation and now owns the lock — do NOT release it (that would corrupt
    // the thief's critical section).
    try {
      const current = fs.readFileSync(lock, "utf8");
      if (!current.startsWith(pid + "@")) {
        throw new Error(
          `File lock for ${targetPath} was stolen during the critical section ` +
            `(lock now owned by another process). The operation may have lost ` +
            `cross-process isolation — increase FILE_LOCK_STALE_MS or split the work.`
        );
      }
    } catch (checkError) {
      if (checkError instanceof Error && checkError.message.includes("stolen")) throw checkError;
      /* lock vanished — another process already released it, nothing to clean up */
    }
    return result;
  } finally {
    HELD_LOCKS.delete(heldKey);
    try {
      // Only release if we still own the lock.
      const current = fs.readFileSync(lock, "utf8");
      if (current.startsWith(pid + "@")) fs.rmSync(lock, { force: true });
    } catch {
      /* releasing a missing lock is fine */
    }
  }
}
