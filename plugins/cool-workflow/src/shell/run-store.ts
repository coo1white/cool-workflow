// shell/run-store.ts — loadRunFromCwd, saveCheckpoint, compactCheckpoint.
//
// The ONLY place state.json is read or written. The migration DECISION
// logic lives in core/state/migrations.ts; this file is the thin impure
// shell around it (disk read, lock, durable write).
//
// Evidence: SPEC/state-core.md "state module — persistence kernel",
// "Write ordering and atomic rules", "compactCheckpoint on a run with no
// empty optional arrays writes nothing".

import * as fs from "node:fs";
import * as path from "node:path";
import { acquireOwnerLock, assertSafeRunId, readJson, withFileLock, writeJson, writePartsDurable } from "./fs-atomic.js";
import { createRunPaths, rebindRunPaths as rebindRunPathsCore } from "../core/state/run-paths.js";
import { migrateRunState, StateMigrationResult } from "../core/state/migrations.js";
import { WorkflowRun, StateArtifact, RunPaths } from "../core/state/types.js";
import { sha256 } from "../core/hash.js";
import { flushPendingTrustAudit } from "./trust-audit.js";

export { createRunPaths };

/** The real place an absolute, normalized path names: realpath of the path
 *  when it is there, else realpath of its nearest existing parent plus the
 *  rest of the segments. undefined for a relative or not-normalized path
 *  (a `..` cannot be followed lexically across a symlink) or on any error. */
function realLocation(value: string): string | undefined {
  if (!path.isAbsolute(value) || path.normalize(value) !== value) return undefined;
  try {
    let existing = value;
    const rest: string[] = [];
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) return undefined;
      rest.unshift(path.basename(existing));
      existing = parent;
    }
    return path.join(fs.realpathSync.native(existing), ...rest);
  } catch {
    return undefined;
  }
}

/** SameLocation for rebindRunPaths: the two paths name one real place
 *  (the same file or folder through a symlink). Fails closed: a path whose
 *  real place cannot be found is never the same. */
export function sameRealLocation(stored: string, rebuilt: string): boolean {
  const a = realLocation(stored);
  return a !== undefined && a === realLocation(rebuilt);
}

/** rebindRunPaths with the symlink-aware sameRealLocation: stored paths
 *  that name the run's real folder are kept byte for byte (POLA for
 *  printed paths); any other stored path is replaced. */
export function rebindRunPaths<T extends Parameters<typeof rebindRunPathsCore>[0]>(run: T, runDir: string): T {
  return rebindRunPathsCore(run, runDir, sameRealLocation);
}

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
 *  silently skipped so hashing an absent artifact never throws. */
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
  // readJson hands back a fresh parse nothing else holds, so the
  // migration works on it in place: one JSON pass per load, not three.
  return migrateRunState(readJson(statePath), {
    statePath,
    owned: true,
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
 *  (a message `cli/entry.ts`'s `recoveryHint` scans for, so a `Try: cw run
 *  list` line appears — never the raw `readJson` "File not found:
 *  <absolute path>/state.json", which names neither the run nor a next
 *  step); throws `Unsupported CW run state: <errors joined by "; ">` on an
 *  unsupported verdict; refuses a state.json that lost its core fields
 *  (workflow, paths) while the run dir still has real content next to it,
 *  rather than silently returning it as a fresh empty run; else returns
 *  the migrated WorkflowRun in memory, its `paths` and audit paths made
 *  again from the run dir it was found in (`rebindRunPaths`) — stored
 *  paths are never trusted as write targets. */
export function loadRunFromCwd(runId: string, cwd = process.cwd()): WorkflowRun {
  if (!runId) throw new Error("Missing run id");
  assertSafeRunId(runId);
  const statePath = path.join(cwd, ".cw", "runs", runId, "state.json");
  if (!fs.existsSync(statePath)) throw new Error(`Run not found: ${runId}`);
  // Stamp BEFORE the read: a write landing between the two leaves an older
  // stamp, so runStateIsCurrent errs to "changed" (a reload), never to
  // "unchanged" over a write this copy did not see.
  const stamp = stateFileStamp(statePath);
  const result = loadRunStateFile(statePath, { dryRun: true });
  if (result.report.status === "unsupported") {
    throw new Error(`Unsupported CW run state: ${result.report.errors.join("; ")}`);
  }
  rebindRunPaths(result.run, path.resolve(path.dirname(statePath)));
  assertNotSuspectedDataLoss(runId, result);
  if (stamp) RUN_STAMPS.set(result.run, stamp);
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
 *  the earlier change (lost update). `fn` gets the run loaded UNDER the lock;
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
// can never wedge the run. The lock itself is fs-atomic's acquireOwnerLock —
// the same `"<pid>@<ISO>\n"` body, single-winner `link(2)` acquire and
// owner-checked release as withFileLock; this file only names the lock path
// and words the refusal.
// ---------------------------------------------------------------------------

function driveLockPath(runDir: string): string {
  return path.join(runDir, "drive.lock");
}

/** Acquire the drive mutex for `runId`'s run directory. Returns a release
 *  function (a no-op when this call re-entered a lock already held in-process:
 *  a nested drive() on the SAME run id — sub-workflows use a DIFFERENT run id,
 *  so this should not happen — re-enters instead of self-refusing).
 *  Throws a fail-closed refusal — naming the resume command — when another
 *  LIVE process holds it. */
function acquireDriveLock(runDir: string, runId: string): () => void {
  const lock = driveLockPath(runDir);
  return acquireOwnerLock(lock, (ownerPid) =>
    new Error(
      `Run ${runId} is already being driven by another process (pid ${ownerPid || "unknown"}). ` +
        `Wait for it to finish, or if it has crashed remove ${lock}, then resume: cw --resume --run ${runId}`
    )
  );
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

/** Thrown by `saveCheckpoint(run, { ifUnchanged: true })` when another
 *  writer saved state.json after `run` was loaded or saved here. */
export class RunStateConflictError extends Error {
  constructor(runId: string) {
    super(`state.json of run ${runId} was changed by another writer (such as cw result or cw commit) while this drive held an older copy; refusing to overwrite it. Run the drive again to go on from the saved state.`);
    this.name = "RunStateConflictError";
  }
}

/** state.json is the single source of truth — set `updatedAt`, then write
 *  it DURABLY with a lock so concurrent processes never lose an update.
 *  `ifUnchanged` (the drive's saves): under the same lock, refuse with
 *  RunStateConflictError when state.json is no longer the file `run` was
 *  loaded from or last saved as (runStateIsCurrent), so a long-held copy
 *  never writes over a change it never saw. */
export function saveCheckpoint(run: WorkflowRun, options: { ifUnchanged?: boolean } = {}): void {
  flushPendingTrustAudit(run);
  run.updatedAt = new Date().toISOString();
  withFileLock(run.paths.state, () => {
    if (options.ifUnchanged && RUN_STAMPS.has(run) && !runStateIsCurrent(run)) throw new RunStateConflictError(run.id);
    const parts = runStateParts(run);
    if (process.env.CW_STATE_WRITE_VERIFY === "1" && Buffer.concat(parts).toString("utf8") !== `${JSON.stringify(run, null, 2)}\n`) {
      throw new Error(`state serialization differs from JSON.stringify for run ${run.id}`);
    }
    writePartsDurable(run.paths.state, parts, { durable: true });
    const stamp = stateFileStamp(run.paths.state);
    if (stamp) {
      LAST_SAVED.set(path.resolve(run.paths.state), { stamp, run });
      RUN_STAMPS.set(run, stamp);
    } else {
      LAST_SAVED.delete(path.resolve(run.paths.state));
      RUN_STAMPS.delete(run);
    }
  });
}

/** `JSON.stringify(run, null, 2)`, byte for byte (see runStateParts). */
export function serializeRunState(run: WorkflowRun): string {
  return Buffer.concat(runStateParts(run)).toString("utf8").slice(0, -1);
}

/** The bytes of state.json (`JSON.stringify(run, null, 2)` and a final
 *  newline) as parts in file order, so the save can write them without
 *  joining them first. Each element of the run's top-level arrays keeps its
 *  encoded JSON text, reused while the element is provably the same: the
 *  same object, the same keys in the same order, and every value the same
 *  (===) all the way down (unchangedShape). Any edit anywhere in an
 *  element, in place or not, makes it miss and be stringified again, so a
 *  kept text is never stale. Elements JSON would treat specially (a Date,
 *  NaN, a class instance, a hole) are never kept. CW_STATE_WRITE_VERIFY=1
 *  (tests only) makes saveCheckpoint compare with JSON.stringify and throw
 *  on any difference. */
function runStateParts(run: WorkflowRun): Buffer[] {
  const record = run as unknown as Record<string, unknown>;
  const proto = Object.getPrototypeOf(record);
  if (proto !== Object.prototype && proto !== null) return [Buffer.from(`${JSON.stringify(run, null, 2)}\n`, "utf8")];
  const parts: Buffer[] = [];
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (Array.isArray(value) && value.length > 0) {
      parts.push(Buffer.from(`${parts.length ? ",\n" : "{\n"}  ${JSON.stringify(key)}: [\n    `, "utf8"));
      for (let i = 0; i < value.length; i++) {
        if (i > 0) parts.push(ELEMENT_SEPARATOR);
        parts.push(elementBytes(value[i]));
      }
      parts.push(ARRAY_END);
      continue;
    }
    const text = JSON.stringify(value, null, 2);
    if (text !== undefined) parts.push(Buffer.from(`${parts.length ? ",\n" : "{\n"}  ${JSON.stringify(key)}: ${text.replace(/\n/g, "\n  ")}`, "utf8"));
  }
  parts.push(Buffer.from(parts.length ? "\n}\n" : "{}\n", "utf8"));
  return parts;
}

const ELEMENT_SEPARATOR = Buffer.from(",\n    ", "utf8");
const ARRAY_END = Buffer.from("\n  ]", "utf8");
const ELEMENT_BYTES = new WeakMap<object, { bytes: Buffer; shape: unknown[] }>();

function elementBytes(element: unknown): Buffer {
  if (element === null || typeof element !== "object") return Buffer.from(JSON.stringify(element) ?? "null", "utf8");
  const kept = ELEMENT_BYTES.get(element);
  if (kept && unchangedShape(element, kept.shape, { at: 0 })) return kept.bytes;
  const bytes = Buffer.from((JSON.stringify(element, null, 2) ?? "null").replace(/\n/g, "\n    "), "utf8");
  const shape: unknown[] = [];
  if (shapeOf(element, shape)) ELEMENT_BYTES.set(element, { bytes, shape });
  else ELEMENT_BYTES.delete(element);
  return bytes;
}

/** Records every object (by identity), key count, key and value of `value`
 *  in walk order; false when it holds anything JSON would change (such an
 *  element is never kept). */
function shapeOf(value: unknown, out: unknown[]): boolean {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") {
    out.push(value);
    return true;
  }
  if (typeof value === "number") {
    out.push(value);
    return Number.isFinite(value);
  }
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) {
    out.push(value, value.length);
    for (let i = 0; i < value.length; i++) if (!(i in value) || value[i] === undefined || !shapeOf(value[i], out)) return false;
    return true;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Object.keys(value);
  out.push(value, keys.length);
  for (const key of keys) {
    out.push(key);
    if (!shapeOf((value as Record<string, unknown>)[key], out)) return false;
  }
  return true;
}

/** True when `value` still matches `shape` exactly. `for...in` also sees
 *  inherited enumerable keys; any such key only makes the count differ, and
 *  so a miss, never a stale hit. */
function unchangedShape(value: unknown, shape: unknown[], pos: { at: number }): boolean {
  if (value === null || typeof value !== "object") return shape[pos.at++] === value;
  if (shape[pos.at++] !== value) return false;
  if (Array.isArray(value)) {
    if (shape[pos.at++] !== value.length) return false;
    for (let i = 0; i < value.length; i++) if (!unchangedShape(value[i], shape, pos)) return false;
    return true;
  }
  const countAt = pos.at++;
  let count = 0;
  for (const key in value) {
    count++;
    if (shape[pos.at++] !== key || !unchangedShape((value as Record<string, unknown>)[key], shape, pos)) return false;
  }
  return shape[countAt] === count;
}

/** The state.json this process last wrote, per state path: the file's
 *  stamp right after the save, and the run object it wrote. Any later
 *  write by anyone (another process, a hand edit, a restore) replaces the
 *  file by rename or rewrites it, so the stamp no longer matches. */
const LAST_SAVED = new Map<string, { stamp: string; run: WorkflowRun }>();

/** The state.json stamp each run object was loaded from (loadRunFromCwd)
 *  or last saved as (saveCheckpoint) in this process. */
const RUN_STAMPS = new WeakMap<WorkflowRun, string>();

/** True when state.json is still exactly the file `run` was loaded from or
 *  last saved as in this process; false when anyone wrote it since, or when
 *  nothing is known of `run`. A stat, never a read. */
export function runStateIsCurrent(run: WorkflowRun): boolean {
  const stamp = RUN_STAMPS.get(run);
  return stamp !== undefined && stateFileStamp(run.paths.state) === stamp;
}

function stateFileStamp(file: string): string | undefined {
  try {
    const s = fs.statSync(file, { bigint: true });
    return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  } catch {
    return undefined;
  }
}

/** The run object this process's last saveCheckpoint wrote to
 *  `statePath`, when the file on disk is still exactly the one it wrote
 *  and the object is in the shape a load gives back (jsonShaped); else
 *  undefined (the caller reads from disk). It is the caller's job to know
 *  the object has not changed since that save. */
export function savedRunIfCurrent(statePath: string): WorkflowRun | undefined {
  const saved = LAST_SAVED.get(path.resolve(statePath));
  return saved && stateFileStamp(statePath) === saved.stamp && jsonShaped(saved.run) ? saved.run : undefined;
}

/** True when `value` is already what `JSON.parse(JSON.stringify(value))`
 *  gives, once its undefined-valued keys are deleted (JSON drops them, so
 *  a load never has them; a spread over a present-but-undefined key acts
 *  differently from a missing one). Anything JSON would change instead
 *  (NaN, a Date, toJSON, a class instance, a hole or undefined in an
 *  array) is a false: read from disk. */
function jsonShaped(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (!(i in value) || value[i] === undefined || !jsonShaped(value[i])) return false;
    return true;
  }
  const proto = Object.getPrototypeOf(value);
  if ((proto !== Object.prototype && proto !== null) || typeof (value as { toJSON?: unknown }).toJSON === "function") return false;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
    else if (!jsonShaped(record[key])) return false;
  }
  return true;
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
 *  This is the minimal "create a run" mechanism; the `plan`/`quickstart`
 *  pipeline layers phases/tasks/inputs on top of this same primitive. */
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
