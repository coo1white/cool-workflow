// shell/node-store.ts — writeRunNode, node-snapshot/replay disk persistence
// and reads.
//
// The disk half of core/state/state-node.ts (writeRunNode) and
// core/state/node-snapshot.ts (persist callbacks + readNodeSnapshot/
// readNodeReplay's directory scans).
import * as fs from "node:fs";
import * as path from "node:path";
import { safeFileName, writeJson } from "./fs-atomic.js";
import { appendRunNode as pureAppendRunNode } from "../core/state/state-node.js";
import { snapshotNode as pureSnapshotNode, replayNodeSnapshot as pureReplayNodeSnapshot } from "../core/state/node-snapshot.js";
import { validateNodeReplayRun, validateNodeSnapshot } from "../core/state/validation.js";
import { NodeSnapshotError } from "../core/state/node-snapshot.js";
/** Writes the node JSON to `<stateNodesDir>/<safeFileName(node.id)>.json`
 *  with `writeJson` (NOT durable) and returns the file path. */
export function writeRunNode(run, node) {
    const dir = run.paths.stateNodesDir || path.join(run.paths.runDir, "nodes");
    const file = path.join(dir, `${safeFileName(node.id)}.json`);
    writeJson(file, node);
    return file;
}
/** Upserts `node` into `run.nodes` in place, then writes it to disk. */
export function appendRunNode(run, node) {
    return pureAppendRunNode(run, node, writeRunNode);
}
function snapshotsRoot(run) {
    const base = run.paths.stateNodesDir || path.join(run.paths.runDir, "nodes");
    return path.join(base, "snapshots");
}
function snapshotDir(run, nodeId) {
    return path.join(snapshotsRoot(run), safeFileName(nodeId));
}
/** Snapshot one StateNode by id, persisting by default under
 *  `nodes/snapshots/<safeFileName(nodeId)>/<snapshotId>.json`. */
export function snapshotNode(run, nodeId, options = {}) {
    return pureSnapshotNode(run, nodeId, {
        now: options.now,
        persist: options.persist === false
            ? false
            : (snapshot) => writeJson(path.join(snapshotDir(run, nodeId), `${snapshot.snapshotId}.json`), snapshot),
    });
}
/** Deterministically replay one node from a snapshot, persisting by
 *  default under `.../replays/<replayId>.json`. `pathExists` defaults to
 *  the real filesystem. */
export function replayNodeSnapshot(run, snapshot, options = {}) {
    return pureReplayNodeSnapshot(run, snapshot, {
        now: options.now,
        pathExists: fs.existsSync,
        persist: options.persist === false
            ? false
            : (replay) => writeJson(path.join(snapshotDir(run, snapshot.nodeId), "replays", `${replay.replayId}.json`), replay),
    });
}
/** Scans every dir under `nodes/snapshots/` for `<snapshotId>.json`. Runs
 *  `snapshotId` through `safeFileName` first (matching every write-side path
 *  segment in this file) so a traversal-shaped id can never escape `nodeDir`
 *  into an arbitrary file elsewhere on disk. */
export function readNodeSnapshot(run, snapshotId) {
    const root = snapshotsRoot(run);
    const safeId = safeFileName(snapshotId);
    if (fs.existsSync(root)) {
        for (const nodeDir of fs.readdirSync(root)) {
            const file = path.join(root, nodeDir, `${safeId}.json`);
            if (fs.existsSync(file))
                return validateNodeSnapshot(JSON.parse(fs.readFileSync(file, "utf8")));
        }
    }
    throw new NodeSnapshotError("snapshot-not-found", `Node snapshot ${snapshotId} not found in run ${run.id}`, {
        freshness: "absent",
    });
}
/** Scans every dir under `nodes/snapshots/<nodeDir>/replays/` for
 *  `<replayId>.json`. Same `safeFileName` guard as `readNodeSnapshot`. */
export function readNodeReplay(run, replayId) {
    const root = snapshotsRoot(run);
    const safeId = safeFileName(replayId);
    if (fs.existsSync(root)) {
        for (const nodeDir of fs.readdirSync(root)) {
            const file = path.join(root, nodeDir, "replays", `${safeId}.json`);
            if (fs.existsSync(file))
                return validateNodeReplayRun(JSON.parse(fs.readFileSync(file, "utf8")));
        }
    }
    throw new NodeSnapshotError("replay-not-found", `Node replay ${replayId} not found in run ${run.id}`, {
        freshness: "absent",
    });
}
