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

/** Shared core of `writeJson`/`writeTextDurable`: write `contents` to a
 *  unique temp file, optionally fsync it, close, then rename over `file`.
 *  ORDER IS THE SAFETY PROPERTY — `rename(2)` is atomic on POSIX, so a
 *  reader always sees either the old bytes or the new bytes, never a torn
 *  file. On a rename failure the temp file is removed (best-effort) and
 *  the error is rethrown — the old bytes at `file` are never touched. */
function writeBytesAtomic(file: string, contents: string, durable: boolean): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${atomicWriteCounter++}`;
  // 0o600: this is run/ledger/registry state, not a file meant to be shared
  // with other local users. rename(2) preserves the mode set at creation, so
  // this covers the final file too.
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, contents, "utf8");
    if (durable) fs.fsyncSync(fd);
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
  if (durable) {
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

/** Atomic, optionally-durable JSON write — see `writeBytesAtomic`. */
export function writeJson(file: string, value: unknown, options: WriteJsonOptions = {}): void {
  writeBytesAtomic(file, `${JSON.stringify(value, null, 2)}\n`, Boolean(options.durable));
}

/** Same atomic-write contract as `writeJson` (temp file + optional fsync +
 *  rename), but for exact pre-built text instead of a value to serialize —
 *  used by callers replacing an NDJSON-style file (e.g. a repaired
 *  trust-audit event log) where the caller already has the final bytes. */
export function writeTextDurable(file: string, text: string, options: WriteJsonOptions = {}): void {
  writeBytesAtomic(file, text, Boolean(options.durable));
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

// A lock stale for this long is stolen regardless of what `isLockOwnerAlive`
// says — the fallback for the one case a liveness check cannot resolve: the
// recorded pid has been recycled by an unrelated live process, which would
// otherwise make a dead owner's pid look "alive" forever and wedge the lock
// permanently. 10x the normal window keeps this astronomically unlikely to
// fire against a genuinely still-working holder.
const FILE_LOCK_FORCE_STALE_MS = FILE_LOCK_STALE_MS * 10;

// Lock paths this process holds right now. A nested withFileLock on the
// SAME target runs its fn directly (re-entrant) instead of waiting on its
// own lock file until the 240 tries run out — that lets a whole
// load -> change -> save cycle hold one lock while the save path inside
// it keeps its own withFileLock call unchanged.
const HELD_LOCKS = new Set<string>();

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Whether the pid recorded in a lock body ("<pid>@<ISO>\n") is still a
 *  live process on this machine. Locks here are local-advisory only (no
 *  network-shared run directories in this tool's model), so
 *  `process.kill(pid, 0)` — signal 0 delivers nothing, it just probes
 *  existence/permission — gives a direct, same-instant answer, unlike
 *  mtime, which is a snapshot a caller can act on after it is already
 *  outdated. This is the property that actually closes the steal race: a
 *  lock belonging to a currently running process can never pass this
 *  check, no matter how a mtime-based timing window lines up, because its
 *  owner really is alive right now. Malformed content or a missing pid is
 *  treated as "not verifiably alive" so the mtime-only path still applies.
 *  `EPERM` (a process with that pid exists but this process cannot signal
 *  it) is treated as alive — the conservative, never-wrongly-steal
 *  direction. */
function isLockOwnerAlive(lockBody: string): boolean {
  const match = /^(\d+)@/.exec(lockBody);
  if (!match) return false;
  const pid = Number(match[1]);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "EPERM");
  }
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
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (age > FILE_LOCK_STALE_MS) {
          // mtime alone is a snapshot: by the time anything here runs, the
          // real owner can already have finished and a brand-new legitimate
          // owner can already be in its place, so acting on "was stale a
          // moment ago" is how two processes end up in the critical section
          // at once. Gate the actual steal on the recorded pid being
          // confirmed DEAD — that cannot be true for a currently running
          // holder no matter how the timing lines up, which is what closes
          // the race rather than just narrowing it. Past
          // FILE_LOCK_FORCE_STALE_MS, steal regardless (see its doc
          // comment) — the one case liveness cannot resolve: a recycled
          // pid.
          let body = "";
          try {
            body = fs.readFileSync(lock, "utf8");
          } catch {
            continue; // vanished — another waiter/the owner beat us to it
          }
          if (age > FILE_LOCK_FORCE_STALE_MS || !isLockOwnerAlive(body)) {
            // Re-check staleness immediately before deleting, as close to
            // the delete as possible, and delete via `unlinkSync`, not
            // `fs.rmSync` — `rmSync`'s generic file-or-directory handling
            // is measurably heavier than the direct syscall, and that
            // extra time IS a TOCTOU window in its own right: an
            // 8-process contention repro (see
            // test/fs-atomic-lock-steal-race-smoke.js) reproduced the
            // double-acquire far more often with `rmSync` than with
            // `unlinkSync`, all else unchanged. A rename-based "capture,
            // verify, restore-if-wrong" version was also tried and
            // measured WORSE than plain `rmSync` — the extra directory-
            // entry churn it introduces widens the window rather than
            // closing it. Keeping this to the fewest, fastest syscalls is
            // what narrows the residual window down to the pid-liveness
            // gate above actually closing it.
            try {
              if (Date.now() - fs.statSync(lock).mtimeMs > FILE_LOCK_STALE_MS) {
                fs.unlinkSync(lock);
              }
            } catch {
              /* vanished between the checks, or already gone */
            }
            continue;
          }
          // Owner confirmed alive despite an old mtime (e.g. a long-running
          // fn() that has not refreshed it) — do not steal; fall through to
          // the same backoff as ordinary contention.
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
