"use strict";
// shell/run-store.ts — loadRunFromCwd, saveCheckpoint, compactCheckpoint.
//
// MILESTONE 3. The ONLY place state.json is read or written. Byte-exact
// port of the old build's src/state.ts load/save/compact functions, now
// split so the migration DECISION logic lives in core/state/migrations.ts
// and this file is the thin impure shell around it (disk read, lock,
// durable write).
//
// Evidence: SPEC/state-core.md "src/state.ts — persistence kernel",
// "Write ordering and atomic rules", "compactCheckpoint on a run with no
// empty optional arrays writes nothing".
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
exports.ensureRunDirs = exports.createRunPaths = void 0;
exports.hashArtifactFile = hashArtifactFile;
exports.loadRunStateFile = loadRunStateFile;
exports.checkRunStateFile = checkRunStateFile;
exports.migrateRunStateFile = migrateRunStateFile;
exports.assertNotSuspectedDataLoss = assertNotSuspectedDataLoss;
exports.loadRunFromCwd = loadRunFromCwd;
exports.withRunStateLock = withRunStateLock;
exports.saveCheckpoint = saveCheckpoint;
exports.compactCheckpoint = compactCheckpoint;
exports.createRun = createRun;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const run_paths_1 = require("../core/state/run-paths");
Object.defineProperty(exports, "createRunPaths", { enumerable: true, get: function () { return run_paths_1.createRunPaths; } });
Object.defineProperty(exports, "ensureRunDirs", { enumerable: true, get: function () { return run_paths_1.ensureRunDirs; } });
const migrations_1 = require("../core/state/migrations");
const hash_1 = require("../core/hash");
/** Read the file at artifact.path and stamp sha256 (the core `sha256:`+hex
 *  form) + sizeBytes onto the StateArtifact. A missing/unreadable file is
 *  silently skipped so hashing an absent artifact never throws. Byte-exact
 *  port of the old flat src/state.ts:hashArtifactFile. */
function hashArtifactFile(artifact) {
    try {
        const content = fs.readFileSync(artifact.path, "utf8");
        artifact.sha256 = (0, hash_1.sha256)(content);
        artifact.sizeBytes = Buffer.byteLength(content, "utf8");
    }
    catch {
        /* file missing — silently skip */
    }
    return artifact;
}
/** Dry-run load + migrate a state.json at an explicit path. */
function loadRunStateFile(statePath, options = {}) {
    return (0, migrations_1.migrateRunState)((0, fs_atomic_1.readJson)(statePath), {
        statePath,
        dryRun: options.dryRun === undefined ? true : options.dryRun,
    });
}
/** Same as `loadRunStateFile` with `dryRun: true`. */
function checkRunStateFile(statePath) {
    return loadRunStateFile(statePath, { dryRun: true });
}
/** Dry-run unless `write: true`; writes the migrated state back with
 *  `writeJson` ONLY when status is not `unsupported` AND `write` AND
 *  `report.writeRequired`. */
function migrateRunStateFile(statePath, options = {}) {
    const result = loadRunStateFile(statePath, { dryRun: !options.write });
    if (result.report.status !== "unsupported" && options.write && result.report.writeRequired) {
        (0, fs_atomic_1.writeJson)(statePath, result.run);
    }
    return result;
}
/** ONLY tasksDir/commitsDir (plus the audit event log, checked separately
 *  below) — deliberately NOT every directory a run's `paths` can carry.
 *  Verified empirically (via test/run-fixture-compat-smoke.js's real
 *  fixtures) that several other candidate directories are unsafe signals:
 *  a plain `cw status`/`cw graph` READ already writes cache/derived files
 *  as a side effect — `audit/summary.json` + `audit/index.json`
 *  (summarizeTrustAudit, called from the status/report path) are non-empty
 *  the moment ANY read touches the run, and `blackboard/`/`candidates/`/
 *  `topologies/` subdirectories get created (though left empty) the same
 *  way. Using those as "real content" signals would refuse to load a
 *  perfectly healthy, merely-already-viewed-once run — report.md is the
 *  same story (a derived rendering of state, not independent evidence).
 *  tasksDir/commitsDir are the two directories confirmed to hold content
 *  ONLY from genuine task-dispatch/commit actions, never from an
 *  otherwise-read-only command. */
function contentDirs(paths) {
    return [paths.tasksDir, paths.commitsDir];
}
/** True when the run directory already holds real task/commit files, or a
 *  non-empty audit event log — i.e. this was NOT a brand-new run dir. Used
 *  only to corroborate `report.suspectedDataLoss`: a bare
 *  `{workflow, paths}`-less state.json is unremarkable for a run dir that
 *  has nothing else in it either (e.g. a run whose creation crashed before
 *  anything else was written), but is a strong corruption signal when real
 *  content already sits next to it. A directory entry must not START WITH
 *  "." to count — cw never writes dot-prefixed names into these
 *  directories, so incidental filesystem debris (a stray `.DS_Store`) never
 *  by itself makes a genuinely fresh run look corrupted. */
function hasPreexistingRunContent(run) {
    for (const dir of contentDirs(run.paths)) {
        try {
            if (fs.readdirSync(dir).some((name) => !name.startsWith(".")))
                return true;
        }
        catch {
            /* missing dir — not a signal either way */
        }
    }
    try {
        const eventLogPath = run.audit?.eventLogPath;
        if (eventLogPath && fs.statSync(eventLogPath).size > 0)
            return true;
    }
    catch {
        /* missing/empty audit log — not a signal */
    }
    return false;
}
/** Throws when `result.report.suspectedDataLoss` is true AND the run
 *  directory already has real content on disk — see
 *  `hasPreexistingRunContent`. Shared by every state.json reader
 *  (`loadRunFromCwd` here, `RunRegistry.loadRun` in run-registry-io.ts) so
 *  a corrupted/wiped state.json is refused the same way regardless of
 *  which entry point reached it. */
function assertNotSuspectedDataLoss(runId, result) {
    if (result.report.suspectedDataLoss && hasPreexistingRunContent(result.run)) {
        throw new Error(`Refusing to load run ${runId}: state.json is missing its core fields (workflow, paths), but the run directory already has task, commit, or other content on disk. This looks like state.json was corrupted, truncated, or replaced by something outside cw, not a new run. Restore state.json from a backup, or remove the run directory to start over.`);
    }
}
/** Refuses an empty id with `Missing run id`; loads
 *  `<cwd>/.cw/runs/<runId>/state.json` (dry-run — never writes); throws
 *  `Unsupported CW run state: <errors joined by "; ">` on an unsupported
 *  verdict; refuses a state.json that lost its core fields (workflow,
 *  paths) while the run dir still has real content next to it, rather than
 *  silently returning it as a fresh empty run; else returns the migrated
 *  WorkflowRun in memory. */
function loadRunFromCwd(runId, cwd = process.cwd()) {
    if (!runId)
        throw new Error("Missing run id");
    (0, fs_atomic_1.assertSafeRunId)(runId);
    const statePath = path.join(cwd, ".cw", "runs", runId, "state.json");
    const result = loadRunStateFile(statePath, { dryRun: true });
    if (result.report.status === "unsupported") {
        throw new Error(`Unsupported CW run state: ${result.report.errors.join("; ")}`);
    }
    assertNotSuspectedDataLoss(runId, result);
    return result.run;
}
/** Hold the state.json lock over a WHOLE load -> change -> save cycle.
 *  A bare loadRunFromCwd + saveCheckpoint pair leaves a window where two
 *  processes both load the same state and the later save silently drops
 *  the earlier change (the same lost-update class PR #339 fixed for
 *  queue.json / triggers.json). `fn` gets the run loaded UNDER the lock;
 *  saveCheckpoint calls inside `fn` re-enter the same lock (withFileLock
 *  is re-entrant in-process) and write exactly as before. The probe load
 *  runs BEFORE the lock so an unknown run id throws the exact
 *  loadRunFromCwd error without first creating the run directory as a
 *  lock-file side effect — and it supplies `paths.state`, the same lock
 *  target saveCheckpoint uses. Keep `fn` short: a critical section past
 *  30s can be stolen as a stale lock. */
function withRunStateLock(runId, cwd, fn) {
    const probe = loadRunFromCwd(runId, cwd);
    return (0, fs_atomic_1.withFileLock)(probe.paths.state, () => fn(loadRunFromCwd(runId, cwd)));
}
/** state.json is the single source of truth — set `updatedAt`, then write
 *  it DURABLY with a lock so concurrent processes never lose an update. */
function saveCheckpoint(run) {
    run.updatedAt = new Date().toISOString();
    (0, fs_atomic_1.withFileLock)(run.paths.state, () => {
        (0, fs_atomic_1.writeJson)(run.paths.state, run, { durable: true });
    });
}
const OPTIONAL_EMPTY_ARRAY_KEYS = ["nodes", "contracts", "feedback", "workers", "sandboxProfiles", "candidates", "candidateSelections"];
/** Strip the 7 top-level optional-array keys when each is an empty array
 *  (normalizeRunState backfills these on load, so stripping saves disk
 *  without losing information). Returns the count stripped; writes nothing
 *  (and calls `saveCheckpoint` zero times) when nothing was stripped. */
function compactCheckpoint(run) {
    let stripped = 0;
    const state = run;
    for (const key of OPTIONAL_EMPTY_ARRAY_KEYS) {
        if (Array.isArray(state[key]) && state[key].length === 0) {
            delete state[key];
            stripped++;
        }
    }
    if (stripped > 0)
        saveCheckpoint(run);
    return stripped;
}
/** Creates a brand-new run's initial `state.json` on disk: makes the run
 *  directory tree, migrates `{}` through `normalizeRunState` (so every
 *  default lands exactly like a real legacy-run migration would), stamps
 *  `id`/`workflow.id`/`workflow.title`, and durably writes `state.json`.
 *  This is the minimal "create a run" mechanism this milestone needs to
 *  drive the state kernel end to end; the real `plan`/`quickstart`
 *  pipeline (later milestones) layers phases/tasks/inputs on top of this
 *  same primitive. */
function createRun(runDir, runId, workflowId, cwd) {
    const paths = (0, run_paths_1.createRunPaths)(runDir);
    (0, run_paths_1.ensureRunDirs)(paths);
    const seed = {
        id: runId,
        cwd,
        workflowId,
        paths: paths,
    };
    const { run, report } = (0, migrations_1.migrateRunState)(seed, { statePath: paths.state, dryRun: false });
    if (report.status === "unsupported") {
        throw new Error(`Unsupported CW run state: ${report.errors.join("; ")}`);
    }
    (0, fs_atomic_1.writeJson)(paths.state, run, { durable: true });
    return run;
}
