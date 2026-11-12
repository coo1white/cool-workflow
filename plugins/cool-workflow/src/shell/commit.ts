// shell/commit.ts — the run's final, verifier-gated state commit. The gate
// itself is pure (core/pipeline/commit-gate.ts); this file reads the disk
// and git for it and writes the commit snapshot.

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { StateCommit, WorkflowRun } from "../core/state/types.js";
import { commitGateErrors, formatCommitId, verdictTask } from "../core/pipeline/commit-gate.js";
import { lineCitedPastEnd, LinePastEnd, PathOps, unresolvedFileEvidence } from "../core/trust/evidence-grounding.js";
import { writeJson } from "./fs-atomic.js";

export function readGitHead(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const PATH_OPS: PathOps = { exists: fs.existsSync, isAbsolute: path.isAbsolute, resolve: (base, rel) => path.resolve(base, rel) };

/** One base-dir set (run cwd, process cwd, run dir) for the verdict accept
 *  check and the commit gate, so the two cannot disagree on a locator. */
function baseDirs(run: WorkflowRun): string[] {
  return Array.from(new Set([run.cwd, process.cwd(), run.paths.runDir]));
}

export function unresolvedRunFileEvidence(run: WorkflowRun, evidence: string[]): string[] {
  return unresolvedFileEvidence(evidence, baseDirs(run), PATH_OPS);
}

export function runLineCitedPastEnd(run: WorkflowRun, evidence: string[]): LinePastEnd | null {
  return lineCitedPastEnd(evidence, baseDirs(run), PATH_OPS, (p) => (fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : undefined));
}

export class CommitGateError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CommitGateError";
    this.code = code;
  }
}

/** Gate on the verdict task's accepted result, then write the snapshot and
 *  append the commit. Throws CommitGateError when the gate refuses. */
export function commitRun(run: WorkflowRun, reason: string, now: string = new Date().toISOString()): StateCommit {
  const verdict = verdictTask(run);
  if (verdict) {
    const errors = commitGateErrors(verdict, verdict.result, {
      unresolvedFileEvidence: (evidence) => unresolvedRunFileEvidence(run, evidence),
      linePastEnd: (evidence) => runLineCitedPastEnd(run, evidence),
      refusedReceipts: (ids) => {
        const receiptIo = createRequire(import.meta.url)("./receipt-io.js") as typeof import("./receipt-io.js");
        return receiptIo.checkCitedReceipts(run, ids);
      },
    });
    if (errors.length) throw new CommitGateError(errors[0].code, errors.map((e) => e.message).join("; "));
  }
  const id = formatCommitId(run.commits.length + 1);
  const snapshotPath = path.join(run.paths.commitsDir, `${id}.json`);
  const commit: StateCommit = {
    id,
    createdAt: now,
    reason,
    loopStage: "checkpoint",
    statePath: run.paths.state,
    reportPath: run.paths.report,
    snapshotPath,
    gitHead: readGitHead(run.cwd),
    verifierGated: Boolean(verdict),
    ...(verdict ? { verifierTaskId: verdict.id, evidence: (verdict.result?.evidence || []).map(String) } : {}),
  };
  fs.mkdirSync(run.paths.commitsDir, { recursive: true });
  run.loopStage = "checkpoint";
  writeJson(snapshotPath, { schemaVersion: 1, commit, tasks: run.tasks.map((t) => ({ id: t.id, status: t.status, resultPath: t.resultPath })) });
  run.commits.push(commit);
  return commit;
}
