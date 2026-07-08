// shell/node-store.ts — writeRunNode, node-snapshot/replay disk persistence
// and reads.
//
// MILESTONE 3. The disk half of core/state/state-node.ts (writeRunNode)
// and core/state/node-snapshot.ts (persist callbacks + readNodeSnapshot/
// readNodeReplay's directory scans). Byte-exact port of the old build's
// src/state-node.ts:226-231 and src/node-snapshot.ts:96-127.

import * as fs from "node:fs";
import * as path from "node:path";
import { safeFileName, writeJson } from "./fs-atomic";
import { appendRunNode as pureAppendRunNode } from "../core/state/state-node";
import { snapshotNode as pureSnapshotNode, replayNodeSnapshot as pureReplayNodeSnapshot, SnapshotOptions, ReplayOptions } from "../core/state/node-snapshot";
import { validateNodeReplayRun, validateNodeSnapshot } from "../core/state/validation";
import { NodeReplayRun, NodeSnapshot, StateNode, WorkflowRun } from "../core/state/types";
import { NodeSnapshotError } from "../core/state/node-snapshot";

/** Writes the node JSON to `<stateNodesDir>/<safeFileName(node.id)>.json`
 *  with `writeJson` (NOT durable) and returns the file path. */
export function writeRunNode(run: WorkflowRun, node: StateNode): string {
  const dir = run.paths.stateNodesDir || path.join(run.paths.runDir, "nodes");
  const file = path.join(dir, `${safeFileName(node.id)}.json`);
  writeJson(file, node);
  return file;
}

/** Upserts `node` into `run.nodes` in place, then writes it to disk. */
export function appendRunNode(run: WorkflowRun, node: StateNode): StateNode {
  return pureAppendRunNode(run, node, writeRunNode);
}

function snapshotsRoot(run: WorkflowRun): string {
  const base = run.paths.stateNodesDir || path.join(run.paths.runDir, "nodes");
  return path.join(base, "snapshots");
}

function snapshotDir(run: WorkflowRun, nodeId: string): string {
  return path.join(snapshotsRoot(run), safeFileName(nodeId));
}

/** Snapshot one StateNode by id, persisting by default under
 *  `nodes/snapshots/<safeFileName(nodeId)>/<snapshotId>.json`. */
export function snapshotNode(run: WorkflowRun, nodeId: string, options: Omit<SnapshotOptions, "persist"> & { persist?: boolean } = {}): NodeSnapshot {
  return pureSnapshotNode(run, nodeId, {
    now: options.now,
    persist:
      options.persist === false
        ? false
        : (snapshot: NodeSnapshot) => writeJson(path.join(snapshotDir(run, nodeId), `${snapshot.snapshotId}.json`), snapshot),
  });
}

/** Deterministically replay one node from a snapshot, persisting by
 *  default under `.../replays/<replayId>.json`. `pathExists` defaults to
 *  the real filesystem. */
export function replayNodeSnapshot(
  run: WorkflowRun,
  snapshot: NodeSnapshot,
  options: Omit<ReplayOptions, "persist" | "pathExists"> & { persist?: boolean } = {}
): NodeReplayRun {
  return pureReplayNodeSnapshot(run, snapshot, {
    now: options.now,
    pathExists: fs.existsSync,
    persist:
      options.persist === false
        ? false
        : (replay: NodeReplayRun) =>
            writeJson(path.join(snapshotDir(run, snapshot.nodeId), "replays", `${replay.replayId}.json`), replay),
  });
}

/** Scans every dir under `nodes/snapshots/` for `<snapshotId>.json`. Runs
 *  `snapshotId` through `safeFileName` first (matching every write-side path
 *  segment in this file) so a traversal-shaped id can never escape `nodeDir`
 *  into an arbitrary file elsewhere on disk. */
export function readNodeSnapshot(run: WorkflowRun, snapshotId: string): NodeSnapshot {
  const root = snapshotsRoot(run);
  const safeId = safeFileName(snapshotId);
  if (fs.existsSync(root)) {
    for (const nodeDir of fs.readdirSync(root)) {
      const file = path.join(root, nodeDir, `${safeId}.json`);
      if (fs.existsSync(file)) return validateNodeSnapshot(JSON.parse(fs.readFileSync(file, "utf8")));
    }
  }
  throw new NodeSnapshotError("snapshot-not-found", `Node snapshot ${snapshotId} not found in run ${run.id}`, {
    freshness: "absent",
  });
}

/** Scans every dir under `nodes/snapshots/<nodeDir>/replays/` for
 *  `<replayId>.json`. Same `safeFileName` guard as `readNodeSnapshot`. */
export function readNodeReplay(run: WorkflowRun, replayId: string): NodeReplayRun {
  const root = snapshotsRoot(run);
  const safeId = safeFileName(replayId);
  if (fs.existsSync(root)) {
    for (const nodeDir of fs.readdirSync(root)) {
      const file = path.join(root, nodeDir, "replays", `${safeId}.json`);
      if (fs.existsSync(file)) return validateNodeReplayRun(JSON.parse(fs.readFileSync(file, "utf8")));
    }
  }
  throw new NodeSnapshotError("replay-not-found", `Node replay ${replayId} not found in run ${run.id}`, {
    freshness: "absent",
  });
}
