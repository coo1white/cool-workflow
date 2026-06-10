"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURRENT_RUN_STATE_SCHEMA_VERSION = void 0;
exports.createRunPaths = createRunPaths;
exports.ensureRunDirs = ensureRunDirs;
exports.loadRunFromCwd = loadRunFromCwd;
exports.loadRunStateFile = loadRunStateFile;
exports.checkRunStateFile = checkRunStateFile;
exports.migrateRunStateFile = migrateRunStateFile;
exports.saveCheckpoint = saveCheckpoint;
exports.compactCheckpoint = compactCheckpoint;
exports.readJson = readJson;
exports.writeJson = writeJson;
exports.durableAppendFileSync = durableAppendFileSync;
exports.realResolve = realResolve;
exports.isContainedPath = isContainedPath;
exports.withFileLock = withFileLock;
exports.safeFileName = safeFileName;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_migrations_1 = require("./state-migrations");
const version_1 = require("./version");
Object.defineProperty(exports, "CURRENT_RUN_STATE_SCHEMA_VERSION", { enumerable: true, get: function () { return version_1.CURRENT_RUN_STATE_SCHEMA_VERSION; } });
function createRunPaths(runDir) {
    return {
        runDir,
        state: node_path_1.default.join(runDir, "state.json"),
        report: node_path_1.default.join(runDir, "report.md"),
        tasksDir: node_path_1.default.join(runDir, "tasks"),
        resultsDir: node_path_1.default.join(runDir, "results"),
        dispatchesDir: node_path_1.default.join(runDir, "dispatches"),
        artifactsDir: node_path_1.default.join(runDir, "artifacts"),
        commitsDir: node_path_1.default.join(runDir, "commits"),
        stateNodesDir: node_path_1.default.join(runDir, "nodes"),
        feedbackDir: node_path_1.default.join(runDir, "feedback"),
        auditDir: node_path_1.default.join(runDir, "audit"),
        workersDir: node_path_1.default.join(runDir, "workers"),
        candidatesDir: node_path_1.default.join(runDir, "candidates"),
        multiAgentDir: node_path_1.default.join(runDir, "multi-agent"),
        blackboardDir: node_path_1.default.join(runDir, "blackboard"),
        topologiesDir: node_path_1.default.join(runDir, "topologies")
    };
}
function ensureRunDirs(paths) {
    for (const dir of [
        paths.runDir,
        paths.tasksDir,
        paths.resultsDir,
        paths.dispatchesDir,
        paths.artifactsDir,
        paths.commitsDir,
        paths.stateNodesDir,
        paths.feedbackDir,
        paths.auditDir || node_path_1.default.join(paths.runDir, "audit"),
        paths.workersDir || node_path_1.default.join(paths.runDir, "workers"),
        paths.candidatesDir || node_path_1.default.join(paths.runDir, "candidates"),
        paths.multiAgentDir || node_path_1.default.join(paths.runDir, "multi-agent"),
        paths.blackboardDir || node_path_1.default.join(paths.runDir, "blackboard"),
        paths.topologiesDir || node_path_1.default.join(paths.runDir, "topologies")
    ]) {
        node_fs_1.default.mkdirSync(dir, { recursive: true });
    }
}
function loadRunFromCwd(runId, cwd = process.cwd()) {
    if (!runId)
        throw new Error("Missing run id");
    const statePath = node_path_1.default.join(cwd, ".cw", "runs", runId, "state.json");
    const result = loadRunStateFile(statePath, { dryRun: true });
    if (result.report.status === "unsupported") {
        throw new Error(`Unsupported CW run state: ${result.report.errors.join("; ")}`);
    }
    return result.run;
}
function loadRunStateFile(statePath, options = {}) {
    const result = (0, state_migrations_1.migrateRunState)(readJson(statePath), {
        statePath,
        dryRun: options.dryRun === undefined ? true : options.dryRun
    });
    if (result.report.status === "unsupported")
        return result;
    return result;
}
function checkRunStateFile(statePath) {
    return loadRunStateFile(statePath, { dryRun: true });
}
function migrateRunStateFile(statePath, options = {}) {
    const result = loadRunStateFile(statePath, { dryRun: !options.write });
    if (result.report.status !== "unsupported" && options.write && result.report.writeRequired) {
        writeJson(statePath, result.run);
    }
    return result;
}
function saveCheckpoint(run) {
    run.updatedAt = new Date().toISOString();
    // state.json is the single source of truth — write it DURABLY (v0.1.40).
    writeJson(run.paths.state, run, { durable: true });
}
/** Compact a run checkpoint by stripping empty optional arrays and null values
 *  that don't carry semantic meaning (v0.1.60). The normalization layer
 *  (normalizeRunState) backfills these on load, so stripping them saves disk
 *  without losing information. Returns the number of keys stripped. */
function compactCheckpoint(run) {
    const optionalArrays = [
        "nodes", "contracts", "feedback", "workers", "sandboxProfiles",
        "candidates", "candidateSelections"
    ];
    let stripped = 0;
    const state = run;
    for (const key of optionalArrays) {
        if (Array.isArray(state[key]) && state[key].length === 0) {
            delete state[key];
            stripped++;
        }
    }
    if (stripped > 0)
        saveCheckpoint(run);
    return stripped;
}
function readJson(file) {
    if (!node_fs_1.default.existsSync(file))
        throw new Error(`File not found: ${file}`);
    try {
        return JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON in ${file}: ${message}`);
    }
}
// ---------------------------------------------------------------------------
// Atomic, optionally-durable JSON write (v0.1.40, closes the prior P1).
//
// ORDER IS THE SAFETY PROPERTY: write to a unique temp file, then rename over the
// target. `rename(2)` is atomic on POSIX, so a crash/`ENOSPC` mid-write can never
// leave a truncated `state.json` that throws `Invalid JSON` on reload — a reader
// always sees EITHER the old bytes OR the new bytes, never a torn file. With
// `{ durable: true }` we additionally fsync the file (and best-effort the dir)
// before/after the rename so the bytes survive power loss — used for AUTHORITATIVE
// state (state.json, registry overlays, the scheduler store, reclaimed.json). The
// fsync is skipped for high-frequency derived/rebuildable writes so the atomic
// rename (the actual torn-write fix) stays cheap everywhere.
// ---------------------------------------------------------------------------
let atomicWriteCounter = 0;
function writeJson(file, value, options = {}) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}.${atomicWriteCounter++}`;
    const fd = node_fs_1.default.openSync(tmp, "w");
    try {
        node_fs_1.default.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        if (options.durable)
            node_fs_1.default.fsyncSync(fd);
    }
    finally {
        node_fs_1.default.closeSync(fd);
    }
    try {
        node_fs_1.default.renameSync(tmp, file);
    }
    catch (error) {
        try {
            node_fs_1.default.rmSync(tmp, { force: true });
        }
        catch {
            /* best-effort temp cleanup */
        }
        throw error;
    }
    if (options.durable) {
        try {
            const dirFd = node_fs_1.default.openSync(node_path_1.default.dirname(file), "r");
            try {
                node_fs_1.default.fsyncSync(dirFd);
            }
            finally {
                node_fs_1.default.closeSync(dirFd);
            }
        }
        catch {
            /* directory fsync is best-effort (not supported on every platform) */
        }
    }
}
// ---------------------------------------------------------------------------
// Durable append (v0.1.40 self-audit P1) — append a line and fsync it before
// returning. The trust-audit event log is the ONE artifact whose loss breaks
// audit-completeness/non-repudiation, so unlike high-frequency derived writes it
// must survive power loss. `appendFileSync` alone does NOT fsync, so a crash
// after it returns could drop the most recent event while durable state.json
// advanced past it. We open O_APPEND, write, fsync the fd, then close.
// ---------------------------------------------------------------------------
function durableAppendFileSync(file, data) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    const fd = node_fs_1.default.openSync(file, "a");
    try {
        node_fs_1.default.writeFileSync(fd, data, "utf8");
        node_fs_1.default.fsyncSync(fd);
    }
    finally {
        node_fs_1.default.closeSync(fd);
    }
}
// ---------------------------------------------------------------------------
// Symlink-hardened path containment (v0.1.40 self-audit P1) — `path.resolve()`
// only normalizes `.`/`..` textually; it does NOT follow symlinks, so a planted
// symlink whose textual path sits "inside" an allowed root but whose real target
// escapes it would pass a `startsWith` containment check. `realResolve` resolves
// the deepest EXISTING ancestor with `realpathSync` (which follows symlinks) and
// re-joins the not-yet-created remainder, so a not-yet-created file is still
// pinned to its real parent. `isContainedPath` realpaths BOTH sides so the
// comparison stays consistent on platforms where the temp root itself is a
// symlink (e.g. macOS /tmp -> /private/tmp).
// ---------------------------------------------------------------------------
function realResolve(target) {
    let current = node_path_1.default.resolve(target);
    const tail = [];
    // Walk up to the deepest existing ancestor, realpath it, then re-append the tail.
    for (;;) {
        try {
            const real = node_fs_1.default.realpathSync.native ? node_fs_1.default.realpathSync.native(current) : node_fs_1.default.realpathSync(current);
            return tail.length ? node_path_1.default.join(real, ...tail.reverse()) : real;
        }
        catch {
            const parent = node_path_1.default.dirname(current);
            if (parent === current)
                return node_path_1.default.resolve(target); // reached root; nothing existed
            tail.push(node_path_1.default.basename(current));
            current = parent;
        }
    }
}
function isContainedPath(candidate, allowed) {
    const realCandidate = realResolve(candidate);
    const realAllowed = realResolve(allowed);
    return realCandidate === realAllowed || realCandidate.startsWith(realAllowed + node_path_1.default.sep);
}
// ---------------------------------------------------------------------------
// Portable advisory file lock (v0.1.40) — serialize cross-process read-modify-
// write on shared stores (home queue, scheduler store, archive overlay, the
// per-run reclamation chain) so a concurrent writer can never lose a record.
// O_EXCL (`wx`) is portable (no native flock); a stale holder is stolen so a
// crashed process can never wedge the store forever.
// ---------------------------------------------------------------------------
const FILE_LOCK_STALE_MS = 30_000;
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/** Run `fn` while holding an advisory lock for `targetPath`; always released. */
function withFileLock(targetPath, fn) {
    const lock = `${targetPath}.lock`;
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(lock), { recursive: true });
    let acquired = false;
    for (let attempt = 0; attempt < 240 && !acquired; attempt++) {
        try {
            const fd = node_fs_1.default.openSync(lock, "wx");
            node_fs_1.default.writeFileSync(fd, `${process.pid}@${new Date().toISOString()}\n`, "utf8");
            node_fs_1.default.closeSync(fd);
            acquired = true;
        }
        catch (error) {
            if (!(error && typeof error === "object" && error.code === "EEXIST"))
                throw error;
            try {
                if (Date.now() - node_fs_1.default.statSync(lock).mtimeMs > FILE_LOCK_STALE_MS) {
                    node_fs_1.default.rmSync(lock, { force: true });
                    continue;
                }
            }
            catch {
                continue; // lock vanished between open and stat — retry immediately
            }
            sleepSync(25);
        }
    }
    if (!acquired)
        throw new Error(`could not acquire file lock for ${targetPath}`);
    try {
        return fn();
    }
    finally {
        try {
            node_fs_1.default.rmSync(lock, { force: true });
        }
        catch {
            /* releasing a missing lock is fine */
        }
    }
}
function safeFileName(value) {
    return String(value).replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
