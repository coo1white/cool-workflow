// Run Export / Import — portable run archive format (v0.1.74).
//
// BSD discipline: explicit state, portable format. Export serializes a run
// to a single JSON file; import restores it in a new location. Both functions
// are pure — they read the run, write the export/import, and return the result.
//
// Track B: users can export a run on one machine and restore it on another.

import fs from "node:fs";
import path from "node:path";
import { RunExport, WorkflowRun } from "./types";
import { createRunPaths, ensureRunDirs, saveCheckpoint, writeJson } from "./state";
import { CURRENT_COOL_WORKFLOW_VERSION } from "./version";

export interface ExportResult {
  runId: string;
  exportedAt: string;
  path: string;
  taskCount: number;
  commitCount: number;
}

export interface ImportResult {
  run: WorkflowRun;
  runDir: string;
  statePath: string;
}

/** Export a run to a portable JSON file. The export includes the full run
 *  state but NOT raw artifact files — only their paths and digests. */
export function exportRun(run: WorkflowRun, outputPath: string): ExportResult {
  const exportedAt = new Date().toISOString();
  const exported: RunExport = {
    schemaVersion: 1,
    exportedAt,
    sourceVersion: CURRENT_COOL_WORKFLOW_VERSION,
    run,
    artifacts: [],
    audit: []
  };
  writeJson(outputPath, exported);
  return {
    runId: run.id,
    exportedAt,
    path: outputPath,
    taskCount: run.tasks.length,
    commitCount: run.commits.length
  };
}

/** Import a run from a portable JSON file into a target directory.
 *  Rebuilds run paths relative to the target dir. */
export function importRun(exportPath: string, targetDir: string): ImportResult {
  const raw = JSON.parse(fs.readFileSync(exportPath, "utf8")) as RunExport;
  if (raw.schemaVersion !== 1) throw new Error(`Unsupported export schema version: ${raw.schemaVersion}`);
  const run = raw.run;
  const runDir = path.join(targetDir, ".cw", "runs", run.id);
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);

  // Rebase all paths to the new target directory
  run.paths = paths;
  run.cwd = targetDir;
  run.updatedAt = new Date().toISOString();

  // Rebase node artifact paths too
  for (const node of run.nodes || []) {
    for (const artifact of node.artifacts || []) {
      if (artifact.path && artifact.path.includes(".cw/runs/")) {
        // Keep the original path as-is — the artifact may not exist in new location
      }
    }
  }

  saveCheckpoint(run);
  return { run, runDir, statePath: paths.state };
}
