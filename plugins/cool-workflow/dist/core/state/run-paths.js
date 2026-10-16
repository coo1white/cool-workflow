"use strict";
// core/state/run-paths.ts — pure RunPaths construction.
//
// MILESTONE 3. Byte-exact port of the old build's state module.
// `createRunPaths` is pure path math. The directory write mechanism lives in
// shell/run-store.ts.
//
// Evidence: SPEC/state-core.md "state module — persistence kernel" and "The
// full .cw/runs/<run-id>/ layout".
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
exports.createRunPaths = createRunPaths;
exports.rebindRunPaths = rebindRunPaths;
const path = __importStar(require("node:path"));
/** The 16-key RunPaths object, all joined under `runDir`. */
function createRunPaths(runDir) {
    return {
        runDir,
        state: path.join(runDir, "state.json"),
        report: path.join(runDir, "report.md"),
        tasksDir: path.join(runDir, "tasks"),
        resultsDir: path.join(runDir, "results"),
        dispatchesDir: path.join(runDir, "dispatches"),
        artifactsDir: path.join(runDir, "artifacts"),
        commitsDir: path.join(runDir, "commits"),
        stateNodesDir: path.join(runDir, "nodes"),
        feedbackDir: path.join(runDir, "feedback"),
        auditDir: path.join(runDir, "audit"),
        workersDir: path.join(runDir, "workers"),
        candidatesDir: path.join(runDir, "candidates"),
        multiAgentDir: path.join(runDir, "multi-agent"),
        blackboardDir: path.join(runDir, "blackboard"),
        topologiesDir: path.join(runDir, "topologies"),
    };
}
const AUDIT_FILES = [
    ["eventLogPath", "events.jsonl"],
    ["summaryPath", "summary.json"],
    ["indexPath", "index.json"],
];
/** Make a loaded run's `paths` (and the audit paths under them) again from
 *  `runDir`, the folder the run's state.json was really found in. The
 *  stored values are never trusted as write targets: a state.json from a
 *  cloned repo can point them anywhere, and a repo that was moved keeps
 *  its old absolute paths. A stored value is kept, byte for byte, only when
 *  `sameLocation(stored, rebuilt)` says it names the same place as the
 *  rebuilt one (for one, the same folder seen through a symlink such as
 *  macOS /var -> /private/var); any other value is replaced. Keys keep
 *  their stored order, so a run whose stored paths were already right
 *  saves byte-identical; a stored key that is not one of createRunPaths'
 *  keys is dropped. Audit path keys are set only where the stored audit
 *  block has them. Changes `run` in place. */
function rebindRunPaths(run, runDir, sameLocation = (a, b) => a === b) {
    const fresh = createRunPaths(runDir);
    const stored = (run.paths && typeof run.paths === "object" ? run.paths : {});
    const pick = (value, rebuilt) => typeof value === "string" && (value === rebuilt || sameLocation(value, rebuilt)) ? value : rebuilt;
    const paths = {};
    for (const key of Object.keys(stored)) {
        if (Object.prototype.hasOwnProperty.call(fresh, key))
            paths[key] = pick(stored[key], fresh[key]);
    }
    for (const key of Object.keys(fresh)) {
        if (!Object.prototype.hasOwnProperty.call(paths, key))
            paths[key] = fresh[key];
    }
    run.paths = paths;
    if (run.audit && typeof run.audit === "object") {
        for (const [key, file] of AUDIT_FILES) {
            if (Object.prototype.hasOwnProperty.call(run.audit, key))
                run.audit[key] = pick(run.audit[key], path.join(fresh.auditDir, file));
        }
    }
    return run;
}
