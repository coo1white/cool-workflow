"use strict";
// core/state/run-paths.ts — createRunPaths, ensureRunDirs.
//
// MILESTONE 3. Byte-exact port of the old build's src/state.ts:10-50.
// `createRunPaths` is pure path math (core/); `ensureRunDirs` touches disk
// (mkdirSync) so it lives here but is called from shell/run-store.ts, the
// only place that actually creates a run directory tree.
//
// Evidence: SPEC/state-core.md "src/state.ts — persistence kernel" and "The
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
exports.ensureRunDirs = ensureRunDirs;
const fs = __importStar(require("node:fs"));
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
/** `mkdirSync` (recursive) every dir this run needs. Missing optional dir
 *  fields fall back to `path.join(runDir, "<name>")`, matching the old
 *  build's defensive default (a RunPaths loaded from an old/partial
 *  state.json may be missing an optional key). */
function ensureRunDirs(paths) {
    const dirs = [
        paths.runDir,
        paths.tasksDir,
        paths.resultsDir,
        paths.dispatchesDir,
        paths.artifactsDir,
        paths.commitsDir,
        paths.stateNodesDir,
        paths.feedbackDir,
        paths.auditDir || path.join(paths.runDir, "audit"),
        paths.workersDir || path.join(paths.runDir, "workers"),
        paths.candidatesDir || path.join(paths.runDir, "candidates"),
        paths.multiAgentDir || path.join(paths.runDir, "multi-agent"),
        paths.blackboardDir || path.join(paths.runDir, "blackboard"),
        paths.topologiesDir || path.join(paths.runDir, "topologies"),
    ];
    for (const dir of dirs)
        fs.mkdirSync(dir, { recursive: true });
}
