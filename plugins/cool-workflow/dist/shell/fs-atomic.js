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
const HELD_LOCKS = new Set();
function sleepSync(ms) {
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
    for (let attempt = 0; attempt < 240 && !acquired; attempt++) {
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
                }
                catch {
                    continue; // vanished — another waiter/the owner beat us to it
                }
                if (age > FILE_LOCK_FORCE_STALE_MS || !isLockOwnerAlive(body)) {
                    // Confirming the owner dead still leaves one gap: between that
                    // read and the delete, a brand-new legitimate owner can appear
                    // (different pid, different timestamp) and this would delete
                    // THEIRS. Close it with a content-equality check immediately
                    // before the delete — only proceed if the file's bytes are
                    // still EXACTLY what was just read (same pid, same instant of
                    // creation); any real new owner's body necessarily differs, so
                    // an exact match is strong evidence nothing has touched this
                    // file since. Delete via `unlinkSync`, not `fs.rmSync` —
                    // `rmSync`'s generic file-or-directory handling is measurably
                    // heavier than the direct syscall, and that extra time IS a
                    // TOCTOU window in its own right: an 8-process contention
                    // repro (see test/fs-atomic-lock-steal-race-smoke.js)
                    // reproduced the double-acquire far more often with `rmSync`
                    // than with `unlinkSync`, all else unchanged. A rename-based
                    // "capture, verify, restore-if-wrong" version was also tried
                    // and measured WORSE than plain `rmSync` — the extra
                    // directory-entry churn it introduces widens the window
                    // rather than closing it.
                    try {
                        if (fs.readFileSync(lock, "utf8") === body) {
                            fs.unlinkSync(lock);
                        }
                    }
                    catch {
                        /* vanished or changed between the checks */
                    }
                    continue;
                }
                // Owner confirmed alive despite an old mtime (e.g. a long-running
                // fn() that has not refreshed it) — do not steal; fall through to
                // the same backoff as ordinary contention.
            }
        }
        catch {
            continue;
        }
        sleepSync(25);
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
