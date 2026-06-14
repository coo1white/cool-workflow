"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.multiAgentRoot = multiAgentRoot;
exports.recordPath = recordPath;
// Filesystem path resolution for multi-agent records (god-module carve, FreeBSD
// router pattern). BEHAVIOR-PRESERVING — pure code movement, zero logic change.
// These two free functions derive paths from run.paths only; they are shared by
// the persistence, node-append, and graph clusters, so they live in their own
// leaf module to keep those clusters free of a circular import back to
// multi-agent.ts. Re-exported there is unnecessary (both are private), but the
// derivation is byte-identical to the originals.
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("../state");
function multiAgentRoot(run) {
    return run.paths.multiAgentDir || node_path_1.default.join(run.paths.runDir, "multi-agent");
}
function recordPath(run, kind, id) {
    return node_path_1.default.join(multiAgentRoot(run), kind, `${(0, state_1.safeFileName)(id)}.json`);
}
