"use strict";
// shell/fs-atomic.ts — atomic/durable JSON file IO and the cross-process
// advisory file lock. Impure by nature (fs calls); this is the shell layer,
// not core. Every writer in core/+shell/ that touches disk goes through
// `writeJson` here, so the write bytes stay exactly one place.
//
// Evidence: SPEC/state-core.md "Write ordering and atomic rules", "Lock
// protocol"; v2/PLAN.md byte-compat items 1 and 6.
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
/** Atomic, optionally-durable JSON write. ORDER IS THE SAFETY PROPERTY: write
 *  the full bytes to a unique temp file, optionally fsync it, close, then
 *  rename over the target. `rename(2)` is atomic on POSIX, so a reader always
 *  sees either the old bytes or the new bytes, never a torn file. On a rename
 *  failure the temp file is removed (best-effort) and the error is rethrown —
 *  the old bytes at `file` are never touched. */
function writeJson(file, value, options = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}.${atomicWriteCounter++}`;
    const fd = fs.openSync(tmp, "w");
    try {
        fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        if (options.durable)
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
    if (options.durable) {
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
    const fd = fs.openSync(file, "a");
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
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/** Run `fn` while holding an advisory lock for `targetPath`; always released
 *  (unless the lock was stolen mid-operation, in which case releasing would
 *  corrupt the thief's critical section, so it is deliberately NOT released). */
function withFileLock(targetPath, fn) {
    const lock = `${targetPath}.lock`;
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const pid = String(process.pid);
    let acquired = false;
    for (let attempt = 0; attempt < 240 && !acquired; attempt++) {
        try {
            const fd = fs.openSync(lock, "wx");
            fs.writeFileSync(fd, `${pid}@${new Date().toISOString()}\n`, "utf8");
            fs.closeSync(fd);
            acquired = true;
        }
        catch (error) {
            if (!(error && typeof error === "object" && error.code === "EEXIST")) {
                throw error;
            }
            try {
                if (Date.now() - fs.statSync(lock).mtimeMs > FILE_LOCK_STALE_MS) {
                    fs.rmSync(lock, { force: true });
                    continue;
                }
            }
            catch {
                continue;
            }
            sleepSync(25);
        }
    }
    if (!acquired)
        throw new Error(`could not acquire file lock for ${targetPath}`);
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
