// shell/commit.ts — commitState: the imperative wrapper around
// core/pipeline/commit-gate.ts's pure gate resolution.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// src/commit.ts's IO half (snapshot write, git-head read, the commit
// node's disk write via the pipeline runner).
//
// Evidence: SPEC/pipeline-run.md "Commit gate — src/commit.ts".

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { StateCommit, StateNode, StateNodeError, WorkflowRun } from "../core/state/types";
import { writeJson } from "./fs-atomic";
import { formatCommitId, gateFailureSeq, resolveCommitGate } from "../core/pipeline/commit-gate";
import type { CommitStateOptions } from "../core/pipeline/commit-gate";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "../core/pipeline/contract";
import { runPipelineStage } from "../core/pipeline/runner";
import { appendRunNode, writeRunNode } from "./node-store";
import { createStateNode, linkStateNodes, recordNodeError } from "../core/state/state-node";
import { ResultEnvelope } from "../core/pipeline/result-normalize";
import { normalizeEvidence, recordTrustAuditEvent } from "./trust-audit";
import { unresolvedFileEvidence as pureUnresolvedFileEvidence, requireResolvableEvidence } from "../core/trust/evidence-grounding";
import { reviewGateErrors, commitReviewProvenance, selfActorIdsForCandidate } from "./collaboration-io";
import type { CommitReviewProvenance } from "../core/multi-agent/collaboration";
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
  return { ...input, reason: input.reason || "manual", source: input.source || "runtime" };
}

function readGitHead(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
  } catch {
    return undefined;
  }
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

/** commitState(run, input) — resolves the gate, writes the failure node +
 *  throws on any error; on success writes the snapshot + commit node and
 *  pushes the commit. */
export function commitState(run: WorkflowRun, input: string | CommitStateOptions): StateCommit {
  const options = normalizeCommitOptions(input);
  const now = new Date().toISOString();
  const { result: backingResult, requiresEvidence } = backingResultFor(run, options.verifierNodeId || (options.reason.startsWith("result:") ? run.tasks.find((t) => t.id === options.reason.slice(7))?.verifierNodeId as string | undefined : undefined));

  const gate = resolveCommitGate(run, options, {
    now,
    backingResult,
    taskRequiresEvidence: requiresEvidence,
    unresolvedFileEvidence: requireResolvableEvidence()
      ? (evidence: string[]) =>
          pureUnresolvedFileEvidence(
            evidence,
            Array.from(new Set([run.cwd, process.cwd(), run.paths.runDir])),
            { exists: fs.existsSync, isAbsolute: path.isAbsolute, resolve: (base, rel) => path.resolve(base, rel) }
          )
      : undefined,
  });

  // Stack the review gate ON TOP of the verifier gate. An applicable review
  // policy can only ADD required-approval constraints from authorized roles; it
  // never relaxes verifier acceptance. Fail closed: a verifier-passing but
  // un-approved commit is BLOCKED here. Provenance (who approved the shipped
  // commit) is stamped only when NO errors remain. The old build wired this
  // inside resolveVerifierGate; v2's resolver is pure, so it layers in the
  // shell where the run's approval state lives.
  let reviewProvenance: CommitReviewProvenance | undefined;
  if (gate.verifierGated) {
    const reviewInput = {
      targetKind: "commit" as const,
      candidateId: gate.candidateId,
      selectionId: gate.selectionId,
      selfActorIds: selfActorIdsForCandidate(run, gate.candidateId, gate.selectionId),
    };
    const reviewErrors = reviewGateErrors(run, reviewInput);
    if (reviewErrors.length) gate.errors.push(...reviewErrors);
    else reviewProvenance = commitReviewProvenance(run, reviewInput);
  }

  if (gate.errors.length) {
    throw recordCommitGateFailure(run, options, gate);
  }

  fs.mkdirSync(run.paths.commitsDir, { recursive: true });
  const id = formatCommitId((run.commits || []).length + 1);
  const snapshotPath = path.join(run.paths.commitsDir, `${id}.json`);
  const audit = gate.verifierGated
    ? recordTrustAuditEvent(run, { kind: "commit.gate", decision: "accepted", source: "cw-validated", nodeId: gate.verifierNodeId, candidateId: gate.candidateId, selectionId: gate.selectionId, commitId: id, evidence: gate.evidence })
    : undefined;
  const evidence = normalizeEvidence(run, gate.evidence, { source: gate.verifierGated ? "cw-validated" : "runtime-derived", verifierNodeId: gate.verifierNodeId, candidateId: gate.candidateId, selectionId: gate.selectionId, commitId: id, auditEventIds: audit ? [audit.id] : [] });

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
    candidateId: gate.candidateId,
    selectionId: gate.selectionId,
    evidence,
    metadata: { ...(options.metadata || {}), ...gate.metadata },
    ...(reviewProvenance ? { review: reviewProvenance as unknown as Record<string, unknown> } : {}),
  };

  const commitNodeId = recordCommitNode(run, commit, options, gate);
  if (commitNodeId) commit.stateNodeId = commitNodeId;
  // A verifier-gated commit is the run's checkpoint — advance the run-level loop
  // stage. Guard on verifierGated so the initial plan/unverified checkpoint does
  // NOT prematurely move the run off "interpret".
  if (gate.verifierGated) run.loopStage = "checkpoint";
  writeJson(snapshotPath, { commit, run });
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
        outputs: { snapshotPath: commit.snapshotPath, gitHead: commit.gitHead, verifierGated: true, verifierNodeId: verifierNode.id, candidateId: gate.candidateId, selectionId: gate.selectionId },
        artifacts: [{ id: "snapshot", kind: "json", path: commit.snapshotPath }],
        evidence: commit.evidence || verifierNode.evidence,
        metadata: { ...(options.metadata || {}), reason: options.reason, commitId: commit.id, verifierGated: true, checkpoint: false, verifierNodeId: verifierNode.id, candidateId: gate.candidateId, selectionId: gate.selectionId, selectionNodeId: gate.selectionNodeId },
      },
      { persist: false, persistNode: writeRunNode }
    );
    if (gate.selectionNodeId && commitResult.outputNodeId) linkAdditionalParent(run, gate.selectionNodeId, commitResult.outputNodeId);
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

function recordCommitGateFailure(run: WorkflowRun, options: CommitStateOptions, gate: ReturnType<typeof resolveCommitGate>): CommitGateError {
  const first = gate.errors[0] || { code: "commit-gate-blocked", message: "Verifier-gated commit blocked", at: new Date().toISOString(), retryable: false };
  const node = recordNodeError(
    createStateNode({
      id: `${run.id}:commit-gate-failed:${gateFailureSeq(run)}`,
      kind: "error",
      status: "pending",
      loopStage: "checkpoint",
      inputs: { reason: options.reason, verifierNodeId: gate.verifierNodeId, candidateId: gate.candidateId, selectionId: gate.selectionId },
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
  for (const parentId of [gate.selectionNodeId, gate.verifierNodeId].filter(Boolean) as string[]) {
    linkAdditionalParent(run, parentId, persisted.id);
  }
  // Record the block as append-only operator feedback so the codes
  // (commit-verifier-not-found / missing-evidence / review-gate-missing-
  // approvals / …) are not lost — the old build did this and the commit gate's
  // failure must surface visibly, not silently.
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
      candidateId: gate.candidateId,
      selectionId: gate.selectionId,
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
