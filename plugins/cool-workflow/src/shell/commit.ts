// shell/commit.ts — commitState: the imperative wrapper around
// core/pipeline/commit-gate.ts's pure gate resolution.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// commit module's IO half (snapshot write, git-head read, the commit
// node's disk write via the pipeline runner).
//
// Evidence: SPEC/pipeline-run.md "Commit gate — commit module".

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { StateCommit, StateNode, StateNodeError, WorkflowRun } from "../core/state/types";
import { writeJson } from "./fs-atomic";
import { formatCommitId, gateFailureSeq, resolveCommitGate } from "../core/pipeline/commit-gate";
import type { CommitStateOptions } from "../core/pipeline/commit-gate";
import type { ErrorFeedbackRecord } from "../core/pipeline/error-feedback";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "../core/pipeline/contract";
import { runPipelineStage } from "../core/pipeline/runner";
import { appendRunNode, writeRunNode } from "./node-store";
import { createStateNode, linkStateNodes, recordNodeError } from "../core/state/state-node";
import { ResultEnvelope } from "../core/pipeline/result-normalize";
import { normalizeEvidence, recordTrustAuditEvent } from "./trust-audit";
import { unresolvedFileEvidence as pureUnresolvedFileEvidence, requireResolvableEvidence } from "../core/trust/evidence-grounding";
import { recordFeedback } from "./error-feedback-io";

export class CommitGateError extends Error {
  structured: StateNodeError;
  feedbackId?: string;
  stateNodeId?: string;

  constructor(error: StateNodeError, options: { feedbackId?: string; stateNodeId?: string } = {}) {
    super(error.message);
    this.name = "CommitGateError";
    this.structured = error;
    this.feedbackId = options.feedbackId;
    this.stateNodeId = options.stateNodeId;
  }
}

function normalizeCommitOptions(input: string | CommitStateOptions): CommitStateOptions {
  if (typeof input === "string") return { reason: input || "manual", source: "runtime" };
  // Fold facade-style bare nouns (verifier/verifierNode) into verifierNodeId
  // so a host/MCP-shaped payload gates the same as a CLI-shaped one. When a
  // verifier is supplied, the commit is verifier-gated by construction —
  // mirrors commitRun()'s hasGateOption.
  const verifierNodeId = input.verifierNodeId || input.verifier || input.verifierNode;
  const hasGateOption = Boolean(verifierNodeId);
  return {
    ...input,
    reason: input.reason || "manual",
    source: input.source || "runtime",
    verifierNodeId,
    verifierGated: input.verifierGated || (hasGateOption && !input.allowUnverifiedCheckpoint),
  };
}

// HEAD's sha as `git rev-parse HEAD` gives it, read from the files on the
// plain layout (a `.git` dir; HEAD a sha or a loose refs/heads ref). Every
// other layout (worktree/submodule `.git` file, packed or reftable ref, GIT_*
// discovery env, bare repo, other owner, mount boundary, no getuid) asks git.
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const GIT_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_CEILING_DIRECTORIES", "GIT_DISCOVERY_ACROSS_FILESYSTEM", "GIT_OBJECT_DIRECTORY", "GIT_NAMESPACE"];

export function readGitHead(cwd: string): string | undefined {
  const fast = readHeadFromFiles(cwd);
  if (fast !== undefined) return fast;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
  } catch {
    return undefined;
  }
}

/** The sha from the files, or undefined for "ask git". */
export function readHeadFromFiles(cwd: string): string | undefined {
  if (GIT_ENV.some((name) => process.env[name] !== undefined) || typeof process.getuid !== "function") return undefined;
  try {
    const uid = process.getuid();
    let dir = path.resolve(cwd);
    const device = fs.statSync(dir).dev;
    for (let top = fs.statSync(dir); top.dev === device; dir = path.dirname(dir), top = fs.statSync(dir)) {
      const dotGit = fs.lstatSync(path.join(dir, ".git"), { throwIfNoEntry: false });
      if (dotGit) return dotGit.isDirectory() && dotGit.uid === uid && top.uid === uid ? shaFromHead(path.join(dir, ".git")) : undefined;
      if (path.dirname(dir) === dir || ["HEAD", "objects", "refs"].every((name) => fs.existsSync(path.join(dir, name)))) return undefined;
    }
  } catch {
    // any read error: ask git
  }
  return undefined;
}

function shaFromHead(gitDir: string): string | undefined {
  const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
  const ref = /^ref: (refs\/heads\/\S+)$/.exec(head)?.[1];
  const sha = ref && !ref.split("/").some((part) => part === "" || part === "." || part === "..") ? fs.readFileSync(path.join(gitDir, ref), "utf8").trim() : head;
  return SHA.test(sha) ? sha : undefined;
}

function findNode(run: WorkflowRun, nodeId: string): StateNode | undefined {
  return (run.nodes || []).find((n) => n.id === nodeId);
}

function backingResultFor(run: WorkflowRun, verifierNodeId: string | undefined): { result: ResultEnvelope | undefined; requiresEvidence: boolean | undefined } {
  if (!verifierNodeId) return { result: undefined, requiresEvidence: undefined };
  const marker = ":verifier:";
  const idx = verifierNodeId.indexOf(marker);
  const taskId = idx >= 0 ? verifierNodeId.slice(idx + marker.length) : undefined;
  const task = taskId ? run.tasks.find((t) => t.id === taskId) : undefined;
  if (!task) return { result: undefined, requiresEvidence: undefined };
  return { result: task.result as unknown as ResultEnvelope | undefined, requiresEvidence: Boolean(task.requiresEvidence) };
}

/** The file-style evidence locators that do not resolve on disk for this run,
 *  in strict mode (CW_REQUIRE_RESOLVABLE_EVIDENCE, on by default); [] when
 *  strict mode is off. One base-dir set (run cwd, process cwd, run dir) for
 *  the verdict accept check (worker-isolation.ts) and the commit gate below,
 *  so the two can not disagree on the same locator. */
export function unresolvedRunFileEvidence(run: WorkflowRun, evidence: string[]): string[] {
  return pureUnresolvedFileEvidence(
    evidence,
    Array.from(new Set([run.cwd, process.cwd(), run.paths.runDir])),
    { exists: fs.existsSync, isAbsolute: path.isAbsolute, resolve: (base, rel) => path.resolve(base, rel) }
  );
}

/** commitState(run, input) — resolves the gate, writes the failure node +
 *  throws on any error; on success writes the snapshot + commit node and
 *  pushes the commit. `reuseOpenGateFailure` (the drive's terminal commit
 *  only): when an open feedback record already holds the very same gate
 *  failures for the same verifier node, throw with that record and add no
 *  second failure node or feedback record — a resume that runs the same
 *  blocked commit again does not pile them up. */
export function commitState(run: WorkflowRun, input: string | CommitStateOptions, behavior: { reuseOpenGateFailure?: boolean } = {}): StateCommit {
  const options = normalizeCommitOptions(input);
  const now = new Date().toISOString();
  const { result: backingResult, requiresEvidence } = backingResultFor(run, options.verifierNodeId || (options.reason.startsWith("result:") ? run.tasks.find((t) => t.id === options.reason.slice(7))?.verifierNodeId as string | undefined : undefined));

  const gate = resolveCommitGate(run, options, {
    now,
    backingResult,
    taskRequiresEvidence: requiresEvidence,
    unresolvedFileEvidence: requireResolvableEvidence() ? (evidence: string[]) => unresolvedRunFileEvidence(run, evidence) : undefined,
  });

  if (gate.errors.length) {
    if (behavior.reuseOpenGateFailure) {
      const reused = openGateFailure(run, gate);
      if (reused) throw reused;
    }
    throw recordCommitGateFailure(run, options, gate);
  }

  fs.mkdirSync(run.paths.commitsDir, { recursive: true });
  const id = formatCommitId((run.commits || []).length + 1);
  const snapshotPath = path.join(run.paths.commitsDir, `${id}.json`);
  const audit = gate.verifierGated
    ? recordTrustAuditEvent(run, { kind: "commit.gate", decision: "accepted", source: "cw-validated", nodeId: gate.verifierNodeId, commitId: id, evidence: gate.evidence })
    : undefined;
  const evidence = normalizeEvidence(run, gate.evidence, { source: gate.verifierGated ? "cw-validated" : "runtime-derived", verifierNodeId: gate.verifierNodeId, commitId: id, auditEventIds: audit ? [audit.id] : [] });

  const commit: StateCommit = {
    id,
    createdAt: now,
    reason: options.reason,
    loopStage: run.loopStage,
    statePath: run.paths.state,
    reportPath: run.paths.report,
    snapshotPath,
    gitHead: readGitHead(run.cwd),
    verifierGated: gate.verifierGated,
    checkpoint: !gate.verifierGated,
    verifierNodeId: gate.verifierNodeId,
    evidence,
    metadata: { ...(options.metadata || {}), ...gate.metadata },
  };

  const commitNodeId = recordCommitNode(run, commit, options, gate);
  if (commitNodeId) commit.stateNodeId = commitNodeId;
  // A verifier-gated commit is the run's checkpoint — advance the run-level loop
  // stage. Guard on verifierGated so the initial plan/unverified checkpoint does
  // NOT prematurely move the run off "interpret".
  if (gate.verifierGated) run.loopStage = "checkpoint";
  // Only store the commit's own (small, bounded) record. The whole run
  // (all tasks, nodes, workers, feedback, and run.commits itself) used to
  // be embedded here too, but no reader anywhere ever parses a `run` key
  // back out of a commits/<id>.json file — see docs/run-retention-reclamation.7.md.
  // Embedding the growing run made total commit-dir bytes grow like N^2
  // in the number of commits.
  writeJson(snapshotPath, { commit });
  run.commits.push(commit);
  return commit;
}

function recordCommitNode(run: WorkflowRun, commit: StateCommit, options: CommitStateOptions, gate: ReturnType<typeof resolveCommitGate>): string | undefined {
  const verifierNode = gate.verifierNodeId ? findNode(run, gate.verifierNodeId) : undefined;
  if (commit.verifierGated && verifierNode) {
    const commitResult = runPipelineStage(
      run,
      "commit",
      verifierNode.id,
      {
        outputNodeId: `${run.id}:commit:${commit.id}`,
        outputStatus: "committed",
        loopStage: "checkpoint",
        outputs: { snapshotPath: commit.snapshotPath, gitHead: commit.gitHead, verifierGated: true, verifierNodeId: verifierNode.id },
        artifacts: [{ id: "snapshot", kind: "json", path: commit.snapshotPath }],
        evidence: commit.evidence || verifierNode.evidence,
        metadata: { ...(options.metadata || {}), reason: options.reason, commitId: commit.id, verifierGated: true, checkpoint: false, verifierNodeId: verifierNode.id },
      },
      { persist: false, persistNode: writeRunNode, pathExists: fs.existsSync }
    );
    return commitResult.outputNodeId;
  }

  const checkpointNode = createStateNode({
    id: `${run.id}:checkpoint:${commit.id}`,
    kind: "commit",
    status: "completed",
    loopStage: "checkpoint",
    inputs: { reason: options.reason, commitId: commit.id },
    outputs: { snapshotPath: commit.snapshotPath, gitHead: commit.gitHead, verifierGated: false, checkpoint: true },
    artifacts: [{ id: "snapshot", kind: "json", path: commit.snapshotPath }],
    contractId: DEFAULT_PIPELINE_CONTRACT_ID,
    metadata: { ...(options.metadata || {}), verifierGated: false, checkpoint: true },
  });
  appendRunNode(run, checkpointNode);
  return checkpointNode.id;
}

function gateFailureList(errors: StateNodeError[]): string {
  return JSON.stringify(errors.map((entry) => ({ code: entry.code, message: entry.message, nodeId: entry.nodeId })));
}

/** An open commit-stage feedback record for the same verifier node with the
 *  same failure list, as a CommitGateError; undefined when there is none. */
function openGateFailure(run: WorkflowRun, gate: ReturnType<typeof resolveCommitGate>): CommitGateError | undefined {
  const failures = gateFailureList(gate.errors);
  const record = ((run.feedback as ErrorFeedbackRecord[] | undefined) || []).find((entry) =>
    entry.status === "open" &&
    entry.stageId === "commit" &&
    entry.metadata?.verifierNodeId === gate.verifierNodeId &&
    JSON.stringify(entry.metadata?.failures || []) === failures
  );
  if (!record) return undefined;
  return new CommitGateError(gate.errors[0], { feedbackId: record.id, stateNodeId: record.nodeId });
}

function recordCommitGateFailure(run: WorkflowRun, options: CommitStateOptions, gate: ReturnType<typeof resolveCommitGate>): CommitGateError {
  const first = gate.errors[0] || { code: "commit-gate-blocked", message: "Verifier-gated commit blocked", at: new Date().toISOString(), retryable: false };
  const node = recordNodeError(
    createStateNode({
      id: `${run.id}:commit-gate-failed:${gateFailureSeq(run)}`,
      kind: "error",
      status: "pending",
      loopStage: "checkpoint",
      inputs: { reason: options.reason, verifierNodeId: gate.verifierNodeId },
      evidence: gate.evidence,
      contractId: DEFAULT_PIPELINE_CONTRACT_ID,
      metadata: {
        ...(options.metadata || {}),
        verifierGated: true,
        checkpoint: false,
        failureCount: gate.errors.length,
        failures: gate.errors.map((entry) => ({ code: entry.code, message: entry.message, nodeId: entry.nodeId })),
        gate: gate.metadata,
      },
    }),
    first
  );
  const persisted = appendRunNode(run, node);
  if (gate.verifierNodeId) linkAdditionalParent(run, gate.verifierNodeId, persisted.id);
  // Record the block as append-only operator feedback so the codes
  // (commit-verifier-not-found / missing-evidence / …) are not lost — the
  // old build did this and the commit gate's failure must surface visibly,
  // not silently.
  const feedback = recordFeedback(run, {
    source: options.source === "cli" ? "cli" : "verifier",
    error: first,
    nodeId: persisted.id,
    stageId: "commit",
    contractId: DEFAULT_PIPELINE_CONTRACT_ID,
    retryable: false,
    evidence: gate.evidence,
    artifacts: [],
    metadata: {
      reason: options.reason,
      verifierNodeId: gate.verifierNodeId,
      failures: gate.errors.map((entry) => ({ code: entry.code, message: entry.message, nodeId: entry.nodeId })),
    },
  });
  return new CommitGateError(first, { feedbackId: feedback.id, stateNodeId: persisted.id });
}

function linkAdditionalParent(run: WorkflowRun, parentId: string, childId: string): void {
  const parent = findNode(run, parentId);
  const child = findNode(run, childId);
  if (!parent || !child) return;
  const [linkedParent, linkedChild] = linkStateNodes(parent, child);
  appendRunNode(run, linkedParent);
  appendRunNode(run, linkedChild);
}
