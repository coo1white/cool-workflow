"use strict";
// shell/fs-atomic.ts — atomic/durable JSON file IO and the cross-process
// advisory file lock. Impure by nature (fs calls); this is the shell layer,
// not core. Every writer in core/+shell/ that touches disk goes through
// `writeJson` here, so the write bytes stay exactly one place.
//
// Evidence: SPEC/state-core.md "Write ordering and atomic rules", "Lock
// protocol"; docs/rebuild/PLAN.md byte-compat items 1 and 6.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeJson = writeJson;
exports.writeTextDurable = writeTextDurable;
exports.readJson = readJson;
exports.safeFileName = safeFileName;
exports.assertSafeRunId = assertSafeRunId;
exports.realResolve = realResolve;
exports.isContainedPath = isContainedPath;
exports.durableAppendFileSync = durableAppendFileSync;
exports.logEndsWithNewline = logEndsWithNewline;
exports.nextBackoffMs = nextBackoffMs;
exports.withFileLock = withFileLock;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
// ---------------------------------------------------------------------------
// writeJson — the ONE JSON-on-disk byte format: JSON.stringify(value, null, 2)
// + "\n", written via temp-file + optional fsync + rename (atomic).
// ---------------------------------------------------------------------------
let atomicWriteCounter = 0;
/** Shared core of `writeJson`/`writeTextDurable`: write `contents` to a
 *  unique temp file, optionally fsync it, close, then rename over `file`.
 *  ORDER IS THE SAFETY PROPERTY — `rename(2)` is atomic on POSIX, so a
 *  reader always sees either the old bytes or the new bytes, never a torn
 *  file. On a rename failure the temp file is removed (best-effort) and
 *  the error is rethrown — the old bytes at `file` are never touched. */
function writeBytesAtomic(file, contents, durable) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}.${atomicWriteCounter++}`;
    // 0o600: this is run/ledger/registry state, not a file meant to be shared
    // with other local users. rename(2) preserves the mode set at creation, so
    // this covers the final file too.
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
        fs.writeFileSync(fd, contents, "utf8");
        if (durable)
            fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    try {
        fs.renameSync(tmp, file);
    }
    catch (error) {
        try {
            fs.rmSync(tmp, { force: true });
        }
        catch {
            /* best-effort temp cleanup */
        }
        throw error;
    }
    if (durable) {
        try {
            const dirFd = fs.openSync(path.dirname(file), "r");
            try {
                fs.fsyncSync(dirFd);
            }
            finally {
                fs.closeSync(dirFd);
            }
        }
        catch {
            /* directory fsync is best-effort (not supported on every platform) */
        }
    }
}
/** Atomic, optionally-durable JSON write — see `writeBytesAtomic`. */
function writeJson(file, value, options = {}) {
    writeBytesAtomic(file, `${JSON.stringify(value, null, 2)}\n`, Boolean(options.durable));
}
/** Same atomic-write contract as `writeJson` (temp file + optional fsync +
 *  rename), but for exact pre-built text instead of a value to serialize —
 *  used by callers replacing an NDJSON-style file (e.g. a repaired
 *  trust-audit event log) where the caller already has the final bytes. */
function writeTextDurable(file, text, options = {}) {
    writeBytesAtomic(file, text, Boolean(options.durable));
}
/** Read + JSON.parse a file. Throws `File not found: <file>` when absent,
 *  `Invalid JSON in <file>: <message>` on a parse error. */
function readJson(file) {
    if (!fs.existsSync(file))
        throw new Error(`File not found: ${file}`);
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON in ${file}: ${message}`);
    }
}
// ---------------------------------------------------------------------------
// Safe ids / names — src/state.ts:310-334 in the old build.
// ---------------------------------------------------------------------------
/** Replaces every run of chars outside `[a-zA-Z0-9_.:-]` with a single `_`. */
function safeFileName(value) {
    return String(value).replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
/** Refuse a run id that is not a single safe path segment, so an id taken
 *  from an untrusted source (an imported run archive/bundle) can never
 *  escape the runs directory via a separator or a `..`/`.` component. The
 *  charset already forbids any separator, so the whole id is ONE path
 *  component; only the exact components `.` and `..` are refused — an
 *  EMBEDDED `..` (e.g. `v1..2`) is a safe directory name and is allowed. */
function assertSafeRunId(value, context = "run id") {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Invalid ${context}: expected a non-empty string`);
    }
    if (!/^[A-Za-z0-9._:-]+$/.test(value) || value === "." || value === "..") {
        throw new Error(`Unsafe ${context}: ${JSON.stringify(value)} must be a single path segment ([A-Za-z0-9._:-], not '.' or '..')`);
    }
    return value;
}
// ---------------------------------------------------------------------------
// Symlink-hardened path containment — src/state.ts:195-227 in the old build.
// ---------------------------------------------------------------------------
/** Realpath the deepest EXISTING ancestor (follows symlinks), then re-join
 *  the not-yet-created tail. If nothing exists up to the root, returns
 *  plain `path.resolve(target)`. */
function realResolve(target) {
    let current = path.resolve(target);
    const tail = [];
    for (;;) {
        try {
            const real = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current);
            return tail.length ? path.join(real, ...tail.reverse()) : real;
        }
        catch {
            const parent = path.dirname(current);
            if (parent === current)
                return path.resolve(target);
            tail.push(path.basename(current));
            current = parent;
        }
    }
}
/** True when `realResolve(candidate)` equals `realResolve(allowed)` or
 *  starts with it plus `path.sep`. Realpaths BOTH sides so a symlinked temp
 *  root (macOS `/tmp` -> `/private/tmp`) compares right. */
function isContainedPath(candidate, allowed) {
    const realCandidate = realResolve(candidate);
    const realAllowed = realResolve(allowed);
    return realCandidate === realAllowed || realCandidate.startsWith(realAllowed + path.sep);
}
// ---------------------------------------------------------------------------
// durableAppendFileSync — append a line and fsync it before returning. Used
// by the trust-audit event log, whose loss breaks audit-completeness.
// ---------------------------------------------------------------------------
function durableAppendFileSync(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, "a", 0o600);
    try {
        fs.writeFileSync(fd, data, "utf8");
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
}
/** True when `file`'s final byte is "\n", given its already-known `size`.
 *  A COMPLETED `durableAppendFileSync` always leaves the file ending in
 *  "\n" (every append is `<line>\n`), so a non-newline last byte means the
 *  previous append was torn by a crash — its bytes were never a confirmed
 *  record. Reads ONLY the last byte at `size-1`, so callers on an append
 *  hot path stay O(1) and never re-read the whole file. A read failure
 *  returns false (treat as "not newline-terminated") — the safe side: an
 *  extra leading newline is harmless for an NDJSON reader that skips blank
 *  lines, while a MISSED torn boundary would merge two records into one
 *  unparseable line. Shared by trust-audit's events.jsonl and the
 *  blackboard's messages.jsonl append paths — same file shape, same
 *  torn-tail risk, one implementation. */
function logEndsWithNewline(file, size) {
    if (size <= 0)
        return false;
    let fd;
    try {
        fd = fs.openSync(file, "r");
        const buf = Buffer.alloc(1);
        fs.readSync(fd, buf, 0, 1, size - 1);
        return buf[0] === 0x0a; // "\n"
    }
    catch {
        return false;
    }
    finally {
        if (fd !== undefined)
            fs.closeSync(fd);
    }
}
// ---------------------------------------------------------------------------
// withFileLock — portable advisory cross-process lock.
//
// Lock file: `<targetPath>.lock`, created by hard-linking a per-attempt temp
// file onto the lock path (single-winner `link(2)`), body `"<pid>@<ISO>\n"`.
// On EEXIST, a lock whose mtime is older than FILE_LOCK_STALE_MS (30_000) is
// stolen — judged and deleted only while holding the single-winner
// `<lock>.steal` guard (see stealStaleLockUnderGuard) — and retried AT ONCE
// (so is a lock that vanished between the EEXIST and the stat). Otherwise the
// thread sleeps a short, growing backoff (Atomics.wait busy-safe sleep:
// FILE_LOCK_BACKOFF_BASE_MS doubling toward FILE_LOCK_BACKOFF_MAX_MS, with
// jitter so many processes contending on ONE lock do not retry in lock-step)
// and tries again. The WHOLE acquire is bounded by wall-clock, not a try
// count: after FILE_LOCK_ACQUIRE_BUDGET_MS (~6s, kept well under the 30s steal
// window so a fresh orphan lock fails fast rather than being waited out) with
// no lock, it throws `could not acquire file lock for <targetPath>`. The tiny
// early sleeps re-grab a briefly-held lock in a few ms; the wall-clock bound
// (not the try count) is what keeps the worst case at ~6s. Any non-EEXIST
// link error is rethrown.
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
// A steal guard older than this belongs to a stealer that crashed inside the
// guarded window (which is a handful of syscalls, microseconds for any live
// process) — remove it so stealing cannot wedge forever.
const FILE_LOCK_STEAL_GUARD_STALE_MS = FILE_LOCK_STALE_MS;
// Acquire-retry pacing (all internal to withFileLock — no wire/protocol
// meaning). The wall-clock BUDGET, not a fixed try count, bounds how long a
// contended acquire blocks the calling thread; kept at ~6s so it stays well
// under the 30s steal window (a fresh orphan lock is failed fast, not waited
// out — a later command past 30s steals it). Between misses the thread sleeps
// a backoff that starts at BASE and doubles to MAX, so a briefly-held lock is
// re-grabbed in a few ms while a genuinely busy one is not hot-spun. Jitter on
// each sleep (applied at the call site) de-syncs many contenders on one lock.
// MAX_ATTEMPTS is only a loop-termination backstop for the (never-observed)
// case of a clock that fails to advance; the budget is the real bound.
const FILE_LOCK_ACQUIRE_BUDGET_MS = 6_000;
const FILE_LOCK_BACKOFF_BASE_MS = 1;
const FILE_LOCK_BACKOFF_MAX_MS = 50;
const FILE_LOCK_MAX_ATTEMPTS = 10_000;
// Lock paths this process holds right now. A nested withFileLock on the
// SAME target runs its fn directly (re-entrant) instead of waiting on its
// own lock file until the acquire budget runs out — that lets a whole
// load -> change -> save cycle hold one lock while the save path inside
// it keeps its own withFileLock call unchanged.
const HELD_LOCKS = new Set();
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/** Next backoff ceiling (ms) given the previous one: double it, capped at
 *  FILE_LOCK_BACKOFF_MAX_MS. Pure and deterministic (the per-sleep jitter is
 *  applied separately at the call site), so the retry schedule is
 *  unit-testable without any timing. Exported for that test only — fs-atomic
 *  is not part of the public index.ts surface. */
function nextBackoffMs(previous) {
    return Math.min(previous * 2, FILE_LOCK_BACKOFF_MAX_MS);
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
function isLockOwnerAlive(lockBody) {
    const match = /^(\d+)@/.exec(lockBody);
    if (!match)
        return false;
    const pid = Number(match[1]);
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return Boolean(error && typeof error === "object" && error.code === "EPERM");
    }
}
/** Steal a stale lock, serialized through a single-winner guard file.
 *
 *  Every earlier steal design judged the lock and then deleted it as two
 *  separate steps with no exclusion around them, and every narrowing of
 *  that gap (content-equality re-read, liveness gate, unlinkSync over
 *  rmSync) still lost a CI run eventually: under load, the judging
 *  process can be preempted between its last read and its unlink, a
 *  concurrent stealer completes the whole steal-and-reacquire in that
 *  gap, and the sleeper's unlink then removes the NEW owner's lock —
 *  two processes end up inside the critical section (reproduced in PR
 *  #420's CI on arm64 Node 22, trial 10, after the linkSync acquire fix
 *  landed). The gap cannot be closed from the judging side; POSIX has no
 *  compare-and-delete.
 *
 *  So close it by exclusion instead: only the holder of `<lock>.steal`
 *  (acquired with the same single-winner linkSync used for the lock
 *  itself) may judge and delete. While the judged lock file still
 *  exists, no waiter can link-acquire the lock path, so nothing can
 *  replace the lock between a guard-held verdict and the unlink; and no
 *  second stealer exists to double-delete. Before the unlink, the
 *  verdict is additionally pinned to the exact file it judged (same
 *  inode, same mtime) — insurance for the force-stale path, where an
 *  owner release + fresh re-acquire between the guard's stat and read
 *  could otherwise slip through.
 *
 *  A guard whose holder crashed inside the guarded window (microseconds
 *  of syscalls for any live process) is removed after
 *  FILE_LOCK_STEAL_GUARD_STALE_MS so stealing cannot wedge; that cleanup
 *  is itself a plain stat-and-unlink, but reintroducing the original
 *  race through it needs a crashed stealer AND two cleaners AND a fresh
 *  guard all colliding inside one syscall-wide window — compounded odds
 *  the hot path never sees.
 *
 *  Returns true when this process held the guard and rendered a verdict
 *  (steal done or judged-not-stale) — the caller should retry the
 *  acquire at once. Returns false when the guard was busy — the caller
 *  should back off like ordinary contention. */
function stealStaleLockUnderGuard(lock, pid, attempt) {
    const guard = `${lock}.steal`;
    try {
        const guardAge = Date.now() - fs.statSync(guard).mtimeMs;
        if (guardAge > FILE_LOCK_STEAL_GUARD_STALE_MS)
            fs.unlinkSync(guard);
    }
    catch {
        /* no guard, or another cleaner beat us to it */
    }
    const tmp = `${guard}.${pid}.${attempt}.tmp`;
    let haveGuard = false;
    try {
        fs.writeFileSync(tmp, `${pid}@${new Date().toISOString()}\n`, { mode: 0o600 });
        fs.linkSync(tmp, guard);
        haveGuard = true;
    }
    catch {
        /* EEXIST — another stealer holds the guard */
    }
    finally {
        try {
            fs.unlinkSync(tmp);
        }
        catch {
            /* already gone */
        }
    }
    if (!haveGuard)
        return false;
    try {
        // Re-judge INSIDE the guard: only what is verified here counts.
        const judged = fs.statSync(lock);
        const age = Date.now() - judged.mtimeMs;
        if (age <= FILE_LOCK_STALE_MS)
            return true;
        const body = fs.readFileSync(lock, "utf8");
        if (!(age > FILE_LOCK_FORCE_STALE_MS || !isLockOwnerAlive(body)))
            return true;
        // Pin the verdict to the exact file it judged: a lock re-acquired in
        // the stat->read gap is a NEW inode (every acquire links a fresh tmp
        // file) with a fresh mtime, so either check catches it.
        const current = fs.statSync(lock);
        if (current.ino === judged.ino && current.mtimeMs === judged.mtimeMs) {
            fs.unlinkSync(lock);
        }
    }
    catch {
        /* lock vanished — nothing left to steal */
    }
    finally {
        try {
            fs.unlinkSync(guard);
        }
        catch {
            /* guard already cleaned up */
        }
    }
    return true;
}
/** Run `fn` while holding an advisory lock for `targetPath`; always released
 *  (unless the lock was stolen mid-operation, in which case releasing would
 *  corrupt the thief's critical section, so it is deliberately NOT released).
 *  Re-entrant inside one process: a nested call on the same target runs
 *  `fn` under the already-held lock. */
function withFileLock(targetPath, fn) {
    const lock = `${targetPath}.lock`;
    const heldKey = path.resolve(lock);
    if (HELD_LOCKS.has(heldKey))
        return fn();
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const pid = String(process.pid);
    let acquired = false;
    const deadline = Date.now() + FILE_LOCK_ACQUIRE_BUDGET_MS;
    let backoff = FILE_LOCK_BACKOFF_BASE_MS;
    for (let attempt = 0; attempt < FILE_LOCK_MAX_ATTEMPTS && !acquired; attempt++) {
        // Acquire via `linkSync`, not `open(lock, "wx")`: directly testing the
        // retry loop under contention showed `open(O_CREAT|O_EXCL)` is NOT
        // reliably single-winner on every Node version this runs on — under
        // CI load (reproduced on Node 18, both x64 and arm64), two separate
        // processes could each `open(wx)` + write + read back and each see
        // ONLY ITS OWN content, meaning the OS was not actually serializing
        // the two creates against each other (see
        // test/fs-atomic-lock-steal-race-smoke.js for the reproduction). A
        // readback-verification pass added on top of `open(wx)` still could
        // not close this, because the underlying create itself was the
        // unreliable step, not just the later unlink. `link(2)`'s exclusivity
        // guarantee is the older, more battle-tested primitive precisely for
        // this class of lockfile race (classic Unix "lock via link" idiom) —
        // stress-tested directly (24-process contention, 15/15 trials) with
        // zero double-winners where the same rig reproduced `open(wx)`
        // double-winners within a handful of trials.
        const tmp = `${lock}.${pid}.${attempt}.tmp`;
        let linkError = null;
        try {
            fs.writeFileSync(tmp, `${pid}@${new Date().toISOString()}\n`, { mode: 0o600 });
            fs.linkSync(tmp, lock);
            acquired = true;
        }
        catch (error) {
            linkError = error;
        }
        finally {
            try {
                fs.unlinkSync(tmp);
            }
            catch {
                /* already gone, or the link consumed it — either is fine */
            }
        }
        if (acquired)
            break;
        if (!(linkError && typeof linkError === "object" && linkError.code === "EEXIST")) {
            throw linkError;
        }
        try {
            const age = Date.now() - fs.statSync(lock).mtimeMs;
            if (age > FILE_LOCK_STALE_MS) {
                // The steal itself runs under a single-winner guard lock — see
                // stealStaleLockUnderGuard for why judging staleness and deleting
                // the lock without one can never be made safe from here.
                if (stealStaleLockUnderGuard(lock, pid, attempt)) {
                    // Verdict rendered and the lock likely just freed — retry AT ONCE
                    // and reset the backoff so we grab it before another waiter does.
                    backoff = FILE_LOCK_BACKOFF_BASE_MS;
                    continue;
                }
                // Guard was busy — another process is mid-steal. Back off like
                // ordinary contention instead of hot-spinning.
            }
        }
        catch {
            // The lock vanished between the EEXIST and the stat — it is likely free
            // now, so retry AT ONCE (no sleep) with a reset backoff.
            backoff = FILE_LOCK_BACKOFF_BASE_MS;
            continue;
        }
        // Give up on wall-clock, never on a raw try count: this keeps the worst-
        // case block at ~6s even though the per-sleep backoff grew. Bounding by a
        // fixed try count instead (as the old flat-25ms loop's 240 tries did)
        // would have let the growing backoff roughly double that worst case.
        if (Date.now() >= deadline)
            break;
        // Sleep a jittered span in [BASE, backoff] — never 0, so never a busy
        // spin — then grow the backoff toward the cap. The jitter de-syncs many
        // processes contending on the SAME lock so they do not retry in lock-step.
        const span = backoff - FILE_LOCK_BACKOFF_BASE_MS;
        sleepSync(FILE_LOCK_BACKOFF_BASE_MS + Math.floor(Math.random() * (span + 1)));
        backoff = nextBackoffMs(backoff);
    }
    if (!acquired)
        throw new Error(`could not acquire file lock for ${targetPath}`);
    HELD_LOCKS.add(heldKey);
    // Refresh mtime right before the critical section.
    try {
        fs.utimesSync(lock, new Date(), new Date());
    }
    catch {
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
                throw new Error(`File lock for ${targetPath} was stolen during the critical section ` +
                    `(lock now owned by another process). The operation may have lost ` +
                    `cross-process isolation — increase FILE_LOCK_STALE_MS or split the work.`);
            }
        }
        catch (checkError) {
            if (checkError instanceof Error && checkError.message.includes("stolen"))
                throw checkError;
            /* lock vanished — another process already released it, nothing to clean up */
        }
        return result;
    }
    finally {
        HELD_LOCKS.delete(heldKey);
        try {
            // Only release if we still own the lock.
            const current = fs.readFileSync(lock, "utf8");
            if (current.startsWith(pid + "@"))
                fs.rmSync(lock, { force: true });
        }
        catch {
            /* releasing a missing lock is fine */
        }
    }
}
