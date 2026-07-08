"use strict";
// shell/node-store.ts — writeRunNode, node-snapshot/replay disk persistence
// and reads.
//
// MILESTONE 3. The disk half of core/state/state-node.ts (writeRunNode)
// and core/state/node-snapshot.ts (persist callbacks + readNodeSnapshot/
// readNodeReplay's directory scans). Byte-exact port of the old build's
// src/state-node.ts:226-231 and src/node-snapshot.ts:96-127.
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
exports.writeRunNode = writeRunNode;
exports.appendRunNode = appendRunNode;
exports.snapshotNode = snapshotNode;
exports.replayNodeSnapshot = replayNodeSnapshot;
exports.readNodeSnapshot = readNodeSnapshot;
exports.readNodeReplay = readNodeReplay;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const state_node_1 = require("../core/state/state-node");
const node_snapshot_1 = require("../core/state/node-snapshot");
const validation_1 = require("../core/state/validation");
const node_snapshot_2 = require("../core/state/node-snapshot");
/** Writes the node JSON to `<stateNodesDir>/<safeFileName(node.id)>.json`
 *  with `writeJson` (NOT durable) and returns the file path. */
function writeRunNode(run, node) {
    const dir = run.paths.stateNodesDir || path.join(run.paths.runDir, "nodes");
    const file = path.join(dir, `${(0, fs_atomic_1.safeFileName)(node.id)}.json`);
    (0, fs_atomic_1.writeJson)(file, node);
    return file;
}
/** Upserts `node` into `run.nodes` in place, then writes it to disk. */
function appendRunNode(run, node) {
    return (0, state_node_1.appendRunNode)(run, node, writeRunNode);
}
function snapshotsRoot(run) {
    const base = run.paths.stateNodesDir || path.join(run.paths.runDir, "nodes");
    return path.join(base, "snapshots");
}
function snapshotDir(run, nodeId) {
    return path.join(snapshotsRoot(run), (0, fs_atomic_1.safeFileName)(nodeId));
}
/** Snapshot one StateNode by id, persisting by default under
 *  `nodes/snapshots/<safeFileName(nodeId)>/<snapshotId>.json`. */
function snapshotNode(run, nodeId, options = {}) {
    return (0, node_snapshot_1.snapshotNode)(run, nodeId, {
        now: options.now,
        persist: options.persist === false
            ? false
            : (snapshot) => (0, fs_atomic_1.writeJson)(path.join(snapshotDir(run, nodeId), `${snapshot.snapshotId}.json`), snapshot),
    });
}
/** Deterministically replay one node from a snapshot, persisting by
 *  default under `.../replays/<replayId>.json`. `pathExists` defaults to
 *  the real filesystem. */
function replayNodeSnapshot(run, snapshot, options = {}) {
    return (0, node_snapshot_1.replayNodeSnapshot)(run, snapshot, {
        now: options.now,
        pathExists: fs.existsSync,
        persist: options.persist === false
            ? false
            : (replay) => (0, fs_atomic_1.writeJson)(path.join(snapshotDir(run, snapshot.nodeId), "replays", `${replay.replayId}.json`), replay),
    });
}
/** Scans every dir under `nodes/snapshots/` for `<snapshotId>.json`. Runs
 *  `snapshotId` through `safeFileName` first (matching every write-side path
 *  segment in this file) so a traversal-shaped id can never escape `nodeDir`
 *  into an arbitrary file elsewhere on disk. */
function readNodeSnapshot(run, snapshotId) {
    const root = snapshotsRoot(run);
    const safeId = (0, fs_atomic_1.safeFileName)(snapshotId);
    if (fs.existsSync(root)) {
        for (const nodeDir of fs.readdirSync(root)) {
            const file = path.join(root, nodeDir, `${safeId}.json`);
            if (fs.existsSync(file))
                return (0, validation_1.validateNodeSnapshot)(JSON.parse(fs.readFileSync(file, "utf8")));
        }
    }
    throw new node_snapshot_2.NodeSnapshotError("snapshot-not-found", `Node snapshot ${snapshotId} not found in run ${run.id}`, {
        freshness: "absent",
    });
}
/** Scans every dir under `nodes/snapshots/<nodeDir>/replays/` for
 *  `<replayId>.json`. Same `safeFileName` guard as `readNodeSnapshot`. */
function readNodeReplay(run, replayId) {
    const root = snapshotsRoot(run);
    const safeId = (0, fs_atomic_1.safeFileName)(replayId);
    if (fs.existsSync(root)) {
        for (const nodeDir of fs.readdirSync(root)) {
            const file = path.join(root, nodeDir, "replays", `${safeId}.json`);
            if (fs.existsSync(file))
                return (0, validation_1.validateNodeReplayRun)(JSON.parse(fs.readFileSync(file, "utf8")));
        }
    }
    throw new node_snapshot_2.NodeSnapshotError("replay-not-found", `Node replay ${replayId} not found in run ${run.id}`, {
        freshness: "absent",
    });
}
