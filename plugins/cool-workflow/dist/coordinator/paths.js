"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.boardPaths = boardPaths;
exports.blackboardRoot = blackboardRoot;
exports.messagesPath = messagesPath;
exports.recordPath = recordPath;
// Filesystem path derivation for the coordinator/blackboard layer
// (FreeBSD-audit R-carve). Carved out of coordinator.ts so the module no longer
// bundles the per-run path computation alongside the stateful blackboard
// operations. Re-exported from coordinator.ts to keep the public surface
// byte-identical.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Each function is a
// function of a WorkflowRun's paths only: it reads run.paths and joins names; it
// never mutates run, never touches the blackboard state, never writes the disk.
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("../state");
function boardPaths(run) {
    const root = blackboardRoot(run);
    return {
        root,
        index: node_path_1.default.join(root, "index.json"),
        messages: messagesPath(run),
        topicsDir: node_path_1.default.join(root, "topics"),
        contextsDir: node_path_1.default.join(root, "contexts"),
        artifactsDir: node_path_1.default.join(root, "artifacts"),
        snapshotsDir: node_path_1.default.join(root, "snapshots"),
        decisionsDir: node_path_1.default.join(root, "decisions")
    };
}
function blackboardRoot(run) {
    return run.paths.blackboardDir || node_path_1.default.join(run.paths.runDir, "blackboard");
}
function messagesPath(run) {
    return node_path_1.default.join(blackboardRoot(run), "messages.jsonl");
}
function recordPath(run, kind, id) {
    return node_path_1.default.join(blackboardRoot(run), kind, `${(0, state_1.safeFileName)(id)}.json`);
}
