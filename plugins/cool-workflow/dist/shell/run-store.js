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
/** Refuses an empty id with `Missing run id`; loads
 *  `<cwd>/.cw/runs/<runId>/state.json` (dry-run — never writes); throws
 *  `Unsupported CW run state: <errors joined by "; ">` on an unsupported
 *  verdict; else returns the migrated WorkflowRun in memory. */
function loadRunFromCwd(runId, cwd = process.cwd()) {
    if (!runId)
        throw new Error("Missing run id");
    (0, fs_atomic_1.assertSafeRunId)(runId);
    const statePath = path.join(cwd, ".cw", "runs", runId, "state.json");
    const result = loadRunStateFile(statePath, { dryRun: true });
    if (result.report.status === "unsupported") {
        throw new Error(`Unsupported CW run state: ${result.report.errors.join("; ")}`);
    }
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
