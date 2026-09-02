// shell/run-store.ts — loadRunFromCwd, saveCheckpoint, compactCheckpoint.
//
// MILESTONE 3. The ONLY place state.json is read or written. Byte-exact
// port of the old build's state module load/save/compact functions, now
// split so the migration DECISION logic lives in core/state/migrations.ts
// and this file is the thin impure shell around it (disk read, lock,
// durable write).
//
// Evidence: SPEC/state-core.md "state module — persistence kernel",
// "Write ordering and atomic rules", "compactCheckpoint on a run with no
// empty optional arrays writes nothing".

import * as fs from "node:fs";
import * as path from "node:path";
import { assertSafeRunId, readJson, withFileLock, writeJson } from "./fs-atomic";
import { createRunPaths } from "../core/state/run-paths";
import { migrateRunState, StateMigrationResult } from "../core/state/migrations";
import { WorkflowRun, StateArtifact, RunPaths } from "../core/state/types";
import { sha256 } from "../core/hash";

export { createRunPaths };

/** `mkdirSync` (recursive) every always-written directory. `artifacts`,
 *  `feedback`, `candidates`, `multi-agent`, `blackboard`, and `topologies`
 *  are made on first use instead, each by its own writer in shell/. */
export function ensureRunDirs(paths: RunPaths): void {
  const dirs = [
    paths.runDir,
    paths.tasksDir,
    paths.resultsDir,
    paths.dispatchesDir,
    paths.commitsDir,
    paths.stateNodesDir,
    paths.auditDir || path.join(paths.runDir, "audit"),
    paths.workersDir || path.join(paths.runDir, "workers"),
  ];
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
}

/** Read the file at artifact.path and stamp sha256 (the core `sha256:`+hex
 *  form) + sizeBytes onto the StateArtifact. A missing/unreadable file is
 *  silently skipped so hashing an absent artifact never throws. Byte-exact
 *  port of the old flat state module:hashArtifactFile. */
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

/** ONLY tasksDir/commitsDir (plus the audit event log, checked separately
 *  below) — deliberately NOT every directory a run's `paths` can carry.
 *  Verified empirically (via test/run-fixture-compat-smoke.js's real
 *  fixtures) that several other candidate directories are unsafe signals:
 *  a plain `cw status`/`cw graph` READ already writes cache/derived files
 *  as a side effect — `audit/summary.json` + `audit/index.json`
 *  (summarizeTrustAudit, called from the status/report path) are non-empty
 *  the moment ANY read touches the run, and `blackboard/`/`candidates/`/
 *  `topologies/` subdirectories get created (though left empty) the same
 *  way. Using those as "real content" signals would refuse to load a
 *  perfectly healthy, merely-already-viewed-once run — report.md is the
 *  same story (a derived rendering of state, not independent evidence).
 *  tasksDir/commitsDir are the two directories confirmed to hold content
 *  ONLY from genuine task-dispatch/commit actions, never from an
 *  otherwise-read-only command. */
function contentDirs(paths: WorkflowRun["paths"]): string[] {
  return [paths.tasksDir, paths.commitsDir];
}

/** True when the run directory already holds real task/commit files, or a
 *  non-empty audit event log — i.e. this was NOT a brand-new run dir. Used
 *  only to corroborate `report.suspectedDataLoss`: a bare
 *  `{workflow, paths}`-less state.json is unremarkable for a run dir that
 *  has nothing else in it either (e.g. a run whose creation crashed before
 *  anything else was written), but is a strong corruption signal when real
 *  content already sits next to it. A directory entry must not START WITH
 *  "." to count — cw never writes dot-prefixed names into these
 *  directories, so incidental filesystem debris (a stray `.DS_Store`) never
 *  by itself makes a genuinely fresh run look corrupted. */
function hasPreexistingRunContent(run: WorkflowRun): boolean {
  for (const dir of contentDirs(run.paths)) {
    try {
      if (fs.readdirSync(dir).some((name) => !name.startsWith("."))) return true;
    } catch {
      /* missing dir — not a signal either way */
    }
  }
  try {
    const eventLogPath = run.audit?.eventLogPath;
    if (eventLogPath && fs.statSync(eventLogPath).size > 0) return true;
  } catch {
    /* missing/empty audit log — not a signal */
  }
  return false;
}

/** Throws when `result.report.suspectedDataLoss` is true AND the run
 *  directory already has real content on disk — see
 *  `hasPreexistingRunContent`. Shared by every state.json reader
 *  (`loadRunFromCwd` here, `RunRegistry.loadRun` in run-registry-io.ts) so
 *  a corrupted/wiped state.json is refused the same way regardless of
 *  which entry point reached it. */
export function assertNotSuspectedDataLoss(runId: string, result: StateMigrationResult): void {
  if (result.report.suspectedDataLoss && hasPreexistingRunContent(result.run)) {
    throw new Error(
      `Refusing to load run ${runId}: state.json is missing its core fields (workflow, paths), but the run directory already has task, commit, or other content on disk. This looks like state.json was corrupted, truncated, or replaced by something outside cw, not a new run. Restore state.json from a backup, or remove the run directory to start over.`
    );
  }
}

/** Refuses an empty id with `Missing run id`; loads
 *  `<cwd>/.cw/runs/<runId>/state.json` (dry-run — never writes); throws
 *  `Run not found: <runId>` when no such run directory has a state.json
 *  (every caller — report, status, audit, eval snapshot, and more — used
 *  to leak the raw `readJson` message, "File not found: <absolute
 *  path>/state.json", which named neither the run nor a next step, and
 *  didn't contain any of the words `cli/entry.ts`'s `recoveryHint` scans
 *  for, so no `Try: cw run list` line ever appeared); throws `Unsupported
 *  CW run state: <errors joined by "; ">` on an unsupported verdict;
 *  refuses a state.json that lost its core fields (workflow, paths) while
 *  the run dir still has real content next to it, rather than silently
 *  returning it as a fresh empty run; else returns the migrated
 *  WorkflowRun in memory. */
export function loadRunFromCwd(runId: string, cwd = process.cwd()): WorkflowRun {
  if (!runId) throw new Error("Missing run id");
  assertSafeRunId(runId);
  const statePath = path.join(cwd, ".cw", "runs", runId, "state.json");
  if (!fs.existsSync(statePath)) throw new Error(`Run not found: ${runId}`);
  const result = loadRunStateFile(statePath, { dryRun: true });
  if (result.report.status === "unsupported") {
    throw new Error(`Unsupported CW run state: ${result.report.errors.join("; ")}`);
  }
  assertNotSuspectedDataLoss(runId, result);
  return result.run;
}

/** The canonical run directory for `runId` under `cwd` — the SAME
 *  deterministic location loadRunFromCwd resolves `state.json` in (it too
 *  ignores any stored `paths.runDir`). Guards an empty/unsafe id and throws
 *  the exact `Run not found: <runId>` loadRunFromCwd throws, but via a plain
 *  `existsSync` so it adds no `state.json` READ and never creates the run dir
 *  for a nonexistent run. Used by the drive mutex, which needs the directory
 *  before it can acquire, without perturbing read accounting. */
export function resolveRunDir(runId: string, cwd = process.cwd()): string {
  if (!runId) throw new Error("Missing run id");
  assertSafeRunId(runId);
  const runDir = path.join(cwd, ".cw", "runs", runId);
  if (!fs.existsSync(path.join(runDir, "state.json"))) throw new Error(`Run not found: ${runId}`);
  return runDir;
}

/** Hold the state.json lock over a WHOLE load -> change -> save cycle.
 *  A bare loadRunFromCwd + saveCheckpoint pair leaves a window where two
 *  processes both load the same state and the later save silently drops
 *  the earlier change (the same lost-update class PR #339 fixed for
 *  queue.json / triggers.json). `fn` gets the run loaded UNDER the lock;
 *  saveCheckpoint calls inside `fn` re-enter the same lock (withFileLock
 *  is re-entrant in-process) and write exactly as before. The probe load
 *  runs BEFORE the lock so an unknown run id throws the exact
 *  loadRunFromCwd error without first creating the run directory as a
 *  lock-file side effect — and it supplies `paths.state`, the same lock
 *  target saveCheckpoint uses. Keep `fn` short: a critical section past
 *  30s can be stolen as a stale lock. */
export function withRunStateLock<T>(runId: string, cwd: string, fn: (run: WorkflowRun) => T): T {
  const probe = loadRunFromCwd(runId, cwd);
  return withFileLock(probe.paths.state, () => fn(loadRunFromCwd(runId, cwd)));
}

// ---------------------------------------------------------------------------
// withDriveLock — a run-scoped DRIVE mutex, held across a WHOLE drive() call.
//
// The state.json write lock (withFileLock) covers only the instant of a
// write; a concurrent round loads the run once, spawns agents for MINUTES,
// then flushes the object it loaded at round start. A second drive on the
// same run therefore clobbers this one's flush (lost update) and both drives
// mint the same worker id from an in-memory count (double dispatch). This
// mutex closes both: only one process advances a run at a time.
//
// It is held far too long for withFileLock's 30s stale-steal window, so it is
// NEVER time-stale-stolen. A lock whose recorded pid is a LIVE process refuses
// (fail closed — never a silent double-drive); a lock whose owner is GONE (a
// crashed prior drive) or this process's own leaked lock is stolen so a crash
// can never wedge the run. Lock body is `"<pid>@<ISO>\n"`, the same shape as
// the fs-atomic lock, acquired with the same single-winner `link(2)` idiom.
// ---------------------------------------------------------------------------

/** Drive-lock paths this process holds right now. A nested drive() on the
 *  SAME run id (sub-workflows use a DIFFERENT run id, so this should not
 *  happen — defensive) re-enters instead of self-refusing. */
const HELD_DRIVE_LOCKS = new Set<string>();

function driveLockPath(runDir: string): string {
  return path.join(runDir, "drive.lock");
}

/** True when `pid` names a live process on this machine. `process.kill(pid,
 *  0)` delivers no signal — it only probes existence/permission. `EPERM` (the
 *  pid exists but is not signalable by us) counts as ALIVE, the conservative
 *  never-wrongly-steal direction; a malformed/absent pid is "not alive". */
function driveLockOwnerAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "EPERM");
  }
}

function readDriveLockPid(lock: string): number {
  try {
    const match = /^(\d+)@/.exec(fs.readFileSync(lock, "utf8"));
    return match ? Number(match[1]) : 0;
  } catch {
    return 0; // vanished or unreadable — treat as no owner
  }
}

/** Acquire the drive mutex for `runId`'s run directory. Returns a release
 *  function (a no-op when this call re-entered a lock already held in-process).
 *  Throws a fail-closed refusal — naming the resume command — when another
 *  LIVE process holds it. */
function acquireDriveLock(runDir: string, runId: string): () => void {
  const lock = driveLockPath(runDir);
  const key = path.resolve(lock);
  if (HELD_DRIVE_LOCKS.has(key)) return () => {};
  fs.mkdirSync(runDir, { recursive: true });
  const pid = process.pid;
  const body = `${pid}@${new Date().toISOString()}\n`;
  const refuse = (ownerPid: number): Error =>
    new Error(
      `Run ${runId} is already being driven by another process (pid ${ownerPid || "unknown"}). ` +
        `Wait for it to finish, or if it has crashed remove ${lock}, then resume: cw run resume ${runId} --drive`
    );

  let acquired = false;
  // A live owner refuses at once; only a stealable (dead-owner / own-leak) lock
  // loops to re-acquire, so this never hot-spins for a genuinely busy run.
  for (let attempt = 0; attempt < 3 && !acquired; attempt++) {
    const tmp = `${lock}.${pid}.${attempt}.tmp`;
    try {
      fs.writeFileSync(tmp, body, { mode: 0o600 });
      fs.linkSync(tmp, lock);
      acquired = true;
    } catch (error) {
      if (!(error && typeof error === "object" && (error as { code?: string }).code === "EEXIST")) {
        throw error;
      }
      const ownerPid = readDriveLockPid(lock);
      // Stealable: our own leaked lock, or an owner that is no longer alive.
      if (ownerPid === pid || !driveLockOwnerAlive(ownerPid)) {
        try {
          fs.unlinkSync(lock);
        } catch {
          /* another process took it first — the next attempt re-judges */
        }
        continue;
      }
      throw refuse(ownerPid);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* the link consumed it, or it is already gone */
      }
    }
  }
  if (!acquired) throw refuse(readDriveLockPid(lock));

  HELD_DRIVE_LOCKS.add(key);
  return () => {
    HELD_DRIVE_LOCKS.delete(key);
    try {
      // Release only while we still own it (a force-stale steal by a later
      // process must not have its lock removed by us).
      if (fs.readFileSync(lock, "utf8").startsWith(`${pid}@`)) fs.rmSync(lock, { force: true });
    } catch {
      /* already released/removed */
    }
  };
}

/** Run `fn` while holding the run-scoped drive mutex (see the block comment
 *  above); always released, even on throw. Synchronous callers (drive()). */
export function withDriveLock<T>(runDir: string, runId: string, fn: () => T): T {
  const release = acquireDriveLock(runDir, runId);
  try {
    return fn();
  } finally {
    release();
  }
}

/** Async form of `withDriveLock` — releases only AFTER `fn`'s promise
 *  settles, so driveAsync()'s awaited multi-round loop stays inside the lock
 *  for its whole lifetime. */
export async function withDriveLockAsync<T>(runDir: string, runId: string, fn: () => Promise<T>): Promise<T> {
  const release = acquireDriveLock(runDir, runId);
  try {
    return await fn();
  } finally {
    release();
  }
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
