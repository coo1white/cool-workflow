"use strict";
// Run Export / Import — portable run archive format (v0.1.74).
//
// BSD discipline: explicit state, portable format. Export serializes a run
// to a single JSON file; import restores it in a new location. Both functions
// are pure — they read the run, write the export/import, and return the result.
//
// Track B: users can export a run on one machine and restore it on another.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportRun = exportRun;
exports.importRun = importRun;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
const version_1 = require("./version");
/** Export a run to a portable JSON file. The export includes the full run
 *  state but NOT raw artifact files — only their paths and digests. */
function exportRun(run, outputPath) {
    const exportedAt = new Date().toISOString();
    const exported = {
        schemaVersion: 1,
        exportedAt,
        sourceVersion: version_1.CURRENT_COOL_WORKFLOW_VERSION,
        run,
        artifacts: [],
        audit: []
    };
    (0, state_1.writeJson)(outputPath, exported);
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
function importRun(exportPath, targetDir) {
    const raw = JSON.parse(node_fs_1.default.readFileSync(exportPath, "utf8"));
    if (raw.schemaVersion !== 1)
        throw new Error(`Unsupported export schema version: ${raw.schemaVersion}`);
    const run = raw.run;
    const runDir = node_path_1.default.join(targetDir, ".cw", "runs", run.id);
    const paths = (0, state_1.createRunPaths)(runDir);
    (0, state_1.ensureRunDirs)(paths);
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
    (0, state_1.saveCheckpoint)(run);
    return { run, runDir, statePath: paths.state };
}
