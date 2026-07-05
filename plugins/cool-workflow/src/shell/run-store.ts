// shell/run-store.ts — loadRunFromCwd, saveCheckpoint, compactCheckpoint.
//
// MILESTONE 3. The ONLY place state.json is read or written. Byte-exact
// port of the old build's src/state.ts load/save/compact functions, now
// split so the migration DECISION logic lives in core/state/migrations.ts
// and this file is the thin impure shell around it (disk read, lock,
// durable write).
//
// Evidence: SPEC/state-core.md "src/state.ts — persistence kernel",
// "Write ordering and atomic rules", "compactCheckpoint on a run with no
// empty optional arrays writes nothing".

import * as fs from "node:fs";
import * as path from "node:path";
import { assertSafeRunId, readJson, withFileLock, writeJson } from "./fs-atomic";
import { createRunPaths, ensureRunDirs } from "../core/state/run-paths";
import { migrateRunState, StateMigrationResult } from "../core/state/migrations";
import { WorkflowRun, StateArtifact } from "../core/state/types";
import { sha256 } from "../core/hash";

export { createRunPaths, ensureRunDirs };

/** Read the file at artifact.path and stamp sha256 (the core `sha256:`+hex
 *  form) + sizeBytes onto the StateArtifact. A missing/unreadable file is
 *  silently skipped so hashing an absent artifact never throws. Byte-exact
 *  port of the old flat src/state.ts:hashArtifactFile. */
export function hashArtifactFile(artifact: StateArtifact): StateArtifact {
  try {
    const content = fs.readFileSync(artifact.path, "utf8");
    artifact.sha256 = sha256(content);
    artifact.sizeBytes = Buffer.byteLength(content, "utf8");
  } catch {
    /* file missing — silently skip */
  }
  return artifact;
}

/** Dry-run load + migrate a state.json at an explicit path. */
export function loadRunStateFile(statePath: string, options: { dryRun?: boolean } = {}): StateMigrationResult {
  return migrateRunState(readJson(statePath), {
    statePath,
    dryRun: options.dryRun === undefined ? true : options.dryRun,
  });
}

/** Same as `loadRunStateFile` with `dryRun: true`. */
export function checkRunStateFile(statePath: string): StateMigrationResult {
  return loadRunStateFile(statePath, { dryRun: true });
}

/** Dry-run unless `write: true`; writes the migrated state back with
 *  `writeJson` ONLY when status is not `unsupported` AND `write` AND
 *  `report.writeRequired`. */
export function migrateRunStateFile(statePath: string, options: { write?: boolean } = {}): StateMigrationResult {
  const result = loadRunStateFile(statePath, { dryRun: !options.write });
  if (result.report.status !== "unsupported" && options.write && result.report.writeRequired) {
    writeJson(statePath, result.run);
  }
  return result;
}

/** Refuses an empty id with `Missing run id`; loads
 *  `<cwd>/.cw/runs/<runId>/state.json` (dry-run — never writes); throws
 *  `Unsupported CW run state: <errors joined by "; ">` on an unsupported
 *  verdict; else returns the migrated WorkflowRun in memory. */
export function loadRunFromCwd(runId: string, cwd = process.cwd()): WorkflowRun {
  if (!runId) throw new Error("Missing run id");
  assertSafeRunId(runId);
  const statePath = path.join(cwd, ".cw", "runs", runId, "state.json");
  const result = loadRunStateFile(statePath, { dryRun: true });
  if (result.report.status === "unsupported") {
    throw new Error(`Unsupported CW run state: ${result.report.errors.join("; ")}`);
  }
  return result.run;
}

/** state.json is the single source of truth — set `updatedAt`, then write
 *  it DURABLY with a lock so concurrent processes never lose an update. */
export function saveCheckpoint(run: WorkflowRun): void {
  run.updatedAt = new Date().toISOString();
  withFileLock(run.paths.state, () => {
    writeJson(run.paths.state, run, { durable: true });
  });
}

const OPTIONAL_EMPTY_ARRAY_KEYS = ["nodes", "contracts", "feedback", "workers", "sandboxProfiles", "candidates", "candidateSelections"];

/** Strip the 7 top-level optional-array keys when each is an empty array
 *  (normalizeRunState backfills these on load, so stripping saves disk
 *  without losing information). Returns the count stripped; writes nothing
 *  (and calls `saveCheckpoint` zero times) when nothing was stripped. */
export function compactCheckpoint(run: WorkflowRun): number {
  let stripped = 0;
  const state = run as unknown as Record<string, unknown>;
  for (const key of OPTIONAL_EMPTY_ARRAY_KEYS) {
    if (Array.isArray(state[key]) && (state[key] as unknown[]).length === 0) {
      delete state[key];
      stripped++;
    }
  }
  if (stripped > 0) saveCheckpoint(run);
  return stripped;
}

/** Creates a brand-new run's initial `state.json` on disk: makes the run
 *  directory tree, migrates `{}` through `normalizeRunState` (so every
 *  default lands exactly like a real legacy-run migration would), stamps
 *  `id`/`workflow.id`/`workflow.title`, and durably writes `state.json`.
 *  This is the minimal "create a run" mechanism this milestone needs to
 *  drive the state kernel end to end; the real `plan`/`quickstart`
 *  pipeline (later milestones) layers phases/tasks/inputs on top of this
 *  same primitive. */
export function createRun(runDir: string, runId: string, workflowId: string, cwd: string): WorkflowRun {
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);
  const seed: Record<string, unknown> = {
    id: runId,
    cwd,
    workflowId,
    paths: paths as unknown as Record<string, unknown>,
  };
  const { run, report } = migrateRunState(seed, { statePath: paths.state, dryRun: false });
  if (report.status === "unsupported") {
    throw new Error(`Unsupported CW run state: ${report.errors.join("; ")}`);
  }
  writeJson(paths.state, run, { durable: true });
  return run;
}
