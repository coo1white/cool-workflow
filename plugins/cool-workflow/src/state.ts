import fs from "node:fs";
import path from "node:path";
import { RunPaths, WorkflowRun } from "./types";
import { migrateRunState, StateMigrationResult } from "./state-migrations";
import { CURRENT_RUN_STATE_SCHEMA_VERSION } from "./version";

export { CURRENT_RUN_STATE_SCHEMA_VERSION };

export function createRunPaths(runDir: string): RunPaths {
  return {
    runDir,
    state: path.join(runDir, "state.json"),
    report: path.join(runDir, "report.md"),
    tasksDir: path.join(runDir, "tasks"),
    resultsDir: path.join(runDir, "results"),
    dispatchesDir: path.join(runDir, "dispatches"),
    artifactsDir: path.join(runDir, "artifacts"),
    commitsDir: path.join(runDir, "commits"),
    stateNodesDir: path.join(runDir, "nodes"),
    feedbackDir: path.join(runDir, "feedback"),
    auditDir: path.join(runDir, "audit"),
    workersDir: path.join(runDir, "workers"),
    candidatesDir: path.join(runDir, "candidates"),
    multiAgentDir: path.join(runDir, "multi-agent"),
    blackboardDir: path.join(runDir, "blackboard"),
    topologiesDir: path.join(runDir, "topologies")
  };
}

export function ensureRunDirs(paths: RunPaths): void {
  for (const dir of [
    paths.runDir,
    paths.tasksDir,
    paths.resultsDir,
    paths.dispatchesDir,
    paths.artifactsDir,
    paths.commitsDir,
    paths.stateNodesDir,
    paths.feedbackDir,
    paths.auditDir || path.join(paths.runDir, "audit"),
    paths.workersDir || path.join(paths.runDir, "workers"),
    paths.candidatesDir || path.join(paths.runDir, "candidates"),
    paths.multiAgentDir || path.join(paths.runDir, "multi-agent"),
    paths.blackboardDir || path.join(paths.runDir, "blackboard"),
    paths.topologiesDir || path.join(paths.runDir, "topologies")
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadRunFromCwd(runId: string, cwd = process.cwd()): WorkflowRun {
  if (!runId) throw new Error("Missing run id");
  const statePath = path.join(cwd, ".cw", "runs", runId, "state.json");
  const result = loadRunStateFile(statePath, { dryRun: true });
  if (result.report.status === "unsupported") {
    throw new Error(`Unsupported CW run state: ${result.report.errors.join("; ")}`);
  }
  return result.run;
}

export function loadRunStateFile(statePath: string, options: { dryRun?: boolean } = {}): StateMigrationResult {
  const result = migrateRunState(readJson(statePath), {
    statePath,
    dryRun: options.dryRun === undefined ? true : options.dryRun
  });
  if (result.report.status === "unsupported") return result;
  return result;
}

export function checkRunStateFile(statePath: string): StateMigrationResult {
  return loadRunStateFile(statePath, { dryRun: true });
}

export function migrateRunStateFile(statePath: string, options: { write?: boolean } = {}): StateMigrationResult {
  const result = loadRunStateFile(statePath, { dryRun: !options.write });
  if (result.report.status !== "unsupported" && options.write && result.report.writeRequired) {
    writeJson(statePath, result.run);
  }
  return result;
}

export function saveCheckpoint(run: WorkflowRun): void {
  run.updatedAt = new Date().toISOString();
  // state.json is the single source of truth — write it DURABLY (v0.1.40).
  writeJson(run.paths.state, run, { durable: true });
  // Auto-compaction hook (v0.1.48, P2-4): optional post-save callback set by
  // the orchestrator to check state size and auto-trigger compaction when
  // thresholds are exceeded. Mechanism in state.ts; policy in the caller.
  if (_postSaveCallback) _postSaveCallback(run);
}

let _postSaveCallback: ((run: WorkflowRun) => void) | null = null;

/** Set an optional post-save hook called after every saveCheckpoint().
 *  Used by the orchestrator for automatic state-compaction (v0.1.48). */
export function setPostSaveCallback(cb: ((run: WorkflowRun) => void) | null): void {
  _postSaveCallback = cb;
}

export function readJson(file: string): unknown {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${file}: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Atomic, optionally-durable JSON write (v0.1.40, closes the prior P1).
//
// ORDER IS THE SAFETY PROPERTY: write to a unique temp file, then rename over the
// target. `rename(2)` is atomic on POSIX, so a crash/`ENOSPC` mid-write can never
// leave a truncated `state.json` that throws `Invalid JSON` on reload — a reader
// always sees EITHER the old bytes OR the new bytes, never a torn file. With
// `{ durable: true }` we additionally fsync the file (and best-effort the dir)
// before/after the rename so the bytes survive power loss — used for AUTHORITATIVE
// state (state.json, registry overlays, the scheduler store, reclaimed.json). The
// fsync is skipped for high-frequency derived/rebuildable writes so the atomic
// rename (the actual torn-write fix) stays cheap everywhere.
// ---------------------------------------------------------------------------

let atomicWriteCounter = 0;

export function writeJson(file: string, value: unknown, options: { durable?: boolean } = {}): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${atomicWriteCounter++}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    if (options.durable) fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best-effort temp cleanup */
    }
    throw error;
  }
  if (options.durable) {
    try {
      const dirFd = fs.openSync(path.dirname(file), "r");
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      /* directory fsync is best-effort (not supported on every platform) */
    }
  }
}

// ---------------------------------------------------------------------------
// Durable append (v0.1.40 self-audit P1) — append a line and fsync it before
// returning. The trust-audit event log is the ONE artifact whose loss breaks
// audit-completeness/non-repudiation, so unlike high-frequency derived writes it
// must survive power loss. `appendFileSync` alone does NOT fsync, so a crash
// after it returns could drop the most recent event while durable state.json
// advanced past it. We open O_APPEND, write, fsync the fd, then close.
// ---------------------------------------------------------------------------

export function durableAppendFileSync(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "a");
  try {
    fs.writeFileSync(fd, data, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Symlink-hardened path containment (v0.1.40 self-audit P1) — `path.resolve()`
// only normalizes `.`/`..` textually; it does NOT follow symlinks, so a planted
// symlink whose textual path sits "inside" an allowed root but whose real target
// escapes it would pass a `startsWith` containment check. `realResolve` resolves
// the deepest EXISTING ancestor with `realpathSync` (which follows symlinks) and
// re-joins the not-yet-created remainder, so a not-yet-created file is still
// pinned to its real parent. `isContainedPath` realpaths BOTH sides so the
// comparison stays consistent on platforms where the temp root itself is a
// symlink (e.g. macOS /tmp -> /private/tmp).
// ---------------------------------------------------------------------------

export function realResolve(target: string): string {
  let current = path.resolve(target);
  const tail: string[] = [];
  // Walk up to the deepest existing ancestor, realpath it, then re-append the tail.
  for (;;) {
    try {
      const real = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target); // reached root; nothing existed
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

export function isContainedPath(candidate: string, allowed: string): boolean {
  const realCandidate = realResolve(candidate);
  const realAllowed = realResolve(allowed);
  return realCandidate === realAllowed || realCandidate.startsWith(realAllowed + path.sep);
}

// ---------------------------------------------------------------------------
// Portable advisory file lock (v0.1.40) — serialize cross-process read-modify-
// write on shared stores (home queue, scheduler store, archive overlay, the
// per-run reclamation chain) so a concurrent writer can never lose a record.
// O_EXCL (`wx`) is portable (no native flock); a stale holder is stolen so a
// crashed process can never wedge the store forever.
// ---------------------------------------------------------------------------

const FILE_LOCK_STALE_MS = 30_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run `fn` while holding an advisory lock for `targetPath`; always released. */
export function withFileLock<T>(targetPath: string, fn: () => T): T {
  const lock = `${targetPath}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 240 && !acquired; attempt++) {
    try {
      const fd = fs.openSync(lock, "wx");
      fs.writeFileSync(fd, `${process.pid}@${new Date().toISOString()}\n`, "utf8");
      fs.closeSync(fd);
      acquired = true;
    } catch (error) {
      if (!(error && typeof error === "object" && (error as { code?: string }).code === "EEXIST")) throw error;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > FILE_LOCK_STALE_MS) {
          fs.rmSync(lock, { force: true });
          continue;
        }
      } catch {
        continue; // lock vanished between open and stat — retry immediately
      }
      sleepSync(25);
    }
  }
  if (!acquired) throw new Error(`could not acquire file lock for ${targetPath}`);
  try {
    return fn();
  } finally {
    try {
      fs.rmSync(lock, { force: true });
    } catch {
      /* releasing a missing lock is fine */
    }
  }
}

export function safeFileName(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
