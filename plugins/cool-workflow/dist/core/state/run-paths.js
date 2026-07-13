"use strict";
// core/state/run-paths.ts — pure RunPaths construction.
//
// MILESTONE 3. Byte-exact port of the old build's src/state.ts:10-50.
// `createRunPaths` is pure path math. The directory write mechanism lives in
// shell/run-store.ts.
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
