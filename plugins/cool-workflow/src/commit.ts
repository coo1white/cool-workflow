import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { StateCommit, StateEvidence, StateNode, StateNodeError, WorkflowRun } from "./types";
import { safeFileName, writeJson } from "./state";
import { createDefaultPipelineContract, DEFAULT_PIPELINE_CONTRACT_ID } from "./pipeline-contract";
import { appendRunNode, createStateNode, linkStateNodes, recordNodeError, upsertRunContract } from "./state-node";
import { createPipelineRunner } from "./pipeline-runner";
import { recordFeedback } from "./error-feedback";
import { buildAcceptanceRationale, normalizeEvidence, recordTrustAuditEvent, validateAcceptanceRationale } from "./trust-audit";
import { commitReviewProvenance, reviewGateErrors, selfActorIdsForCandidate } from "./collaboration";
import { hasGroundedEvidence, requireResolvableEvidence, unresolvedFileEvidence } from "./evidence-grounding";
import { taskRequiresEvidence } from "./verifier";

export interface CommitStateOptions {
  reason: string;
  verifierNodeId?: string;
  candidateId?: string;
  selectionId?: string;
  verifierGated?: boolean;
  allowUnverifiedCheckpoint?: boolean;
  source?: "runtime" | "cli" | "manual";
  /** Registered verifier ids to run before the commit gate (v0.1.58). */
  verifierIds?: string[];
  /** When set, only these taskIds are committed; other tasks remain active
   *  for later retry (v0.1.59). The commit carries `partial: true`. */
  partialTaskIds?: string[];
  metadata?: Record<string, unknown>;
}

interface CommitGate {
  verifierGated: boolean;
  verifierNodeId?: string;
  candidateId?: string;
  selectionId?: string;
  selectionNodeId?: string;
  evidence: StateEvidence[];
  errors: StateNodeError[];
  rationale?: ReturnType<typeof buildAcceptanceRationale>;
  review?: ReturnType<typeof commitReviewProvenance>;
  metadata: Record<string, unknown>;
}

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

export function commitState(run: WorkflowRun, input: string | CommitStateOptions): StateCommit {
  const options = normalizeCommitOptions(input);
  const gate = resolveCommitGate(run, options);
  if (gate.errors.length) {
    throw recordCommitGateFailure(run, options, gate);
  }

  fs.mkdirSync(run.paths.commitsDir, { recursive: true });
  const id = createCommitId();
  const snapshotPath = path.join(run.paths.commitsDir, `${id}.json`);
  const audit = gate.verifierGated
    ? recordTrustAuditEvent(run, {
        kind: "commit.gate",
        decision: "accepted",
        source: "cw-validated",
        workerId: gate.rationale?.workerId,
        nodeId: gate.verifierNodeId,
        candidateId: gate.candidateId,
        selectionId: gate.selectionId,
        commitId: id,
        sandboxProfileId: gate.rationale?.sandboxProfileId,
        evidence: gate.evidence,
        metadata: gate.rationale as unknown as Record<string, unknown> | undefined
      })
    : undefined;
  const evidence = normalizeEvidence(run, gate.evidence, {
    source: gate.verifierGated ? "cw-validated" : "runtime-derived",
    workerId: gate.rationale?.workerId,
    verifierNodeId: gate.verifierNodeId,
    candidateId: gate.candidateId,
    selectionId: gate.selectionId,
    commitId: id,
    auditEventIds: audit ? [audit.id] : []
  });
  const commit: StateCommit = {
    id,
    createdAt: new Date().toISOString(),
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
    // Partial commit (v0.1.59): operator commits only specified tasks.
    // Failed/pending tasks remain active for later retry. The verifier gate
    // still applies per-task; partial is about scope, not about skipping gates.
    partial: Array.isArray(options.partialTaskIds) && options.partialTaskIds.length > 0 || undefined,
    partialTaskIds: options.partialTaskIds?.length ? options.partialTaskIds : undefined,
    acceptanceRationale: gate.rationale
      ? {
          ...gate.rationale,
          commitGateResult: gate.verifierGated ? "passed" : "checkpoint",
          auditEventIds: audit ? [...(gate.rationale.auditEventIds || []), audit.id] : gate.rationale.auditEventIds
        }
      : undefined,
    review: gate.review,
    metadata: {
      ...(options.metadata || {}),
      ...gate.metadata
    }
  };
  const commitNodeId = recordCommitNode(run, commit, options, gate);
  if (commitNodeId) commit.stateNodeId = commitNodeId;
  writeJson(snapshotPath, {
    commit,
    run
  });
  run.commits.push(commit);
  return commit;
}

/** A verifier node is held to the grounded-evidence bar when its backing task
 *  requires evidence, or when it backs an explicit candidate/selection commit
 *  (no 1:1 task — these are the higher-stakes commits the gate exists for). */
function verifierNodeRequiresEvidence(run: WorkflowRun, verifierNode: StateNode): boolean {
  const marker = ":verifier:";
  const idx = verifierNode.id.indexOf(marker);
  const taskId = idx >= 0 ? verifierNode.id.slice(idx + marker.length) : undefined;
  const task = taskId ? run.tasks.find((candidate) => candidate.id === taskId) : undefined;
  if (task) return taskRequiresEvidence(task);
  return true; // candidate/selection verifier with no 1:1 task — enforce grounding.
}

/** The HARD no-false-green gate (DIRECTION.md "ambiguity is a visible state").
 *  A verifier node is built FROM a result node; when that result captured no
 *  structured signal at all the result node carries an `metadata.captureWarning`
 *  marker (set in worker-isolation / lifecycle ingest via isEmptyCapture). The
 *  worker output is still ACCEPTED (a recorded warning, never a silent pass), but
 *  a verifier-GATED commit must NOT be able to present that zero-evidence result
 *  as clean/green. We detect it here, reading ONLY persisted state (the source
 *  result node's metadata) — purely functional, no clock/ordering — so snapshot
 *  replay reaches the same gate decision. Returns the marker string, or undefined.
 *
 *  Resolution trail: verifier node -> its input/parent result node. We look at
 *  `inputs.inputNodeId` (set by runPipelineStage) first, then fall back to the
 *  first parent, so it works regardless of which ingest path produced the node. */
function emptyCaptureWarning(run: WorkflowRun, verifierNode: StateNode): string | undefined {
  const resultNodeId =
    (typeof verifierNode.inputs?.inputNodeId === "string" ? (verifierNode.inputs.inputNodeId as string) : undefined) ||
    verifierNode.parents[0];
  const resultNode = resultNodeId ? findNode(run, resultNodeId) : undefined;
  const warning = resultNode?.metadata?.captureWarning;
  return typeof warning === "string" && warning ? warning : undefined;
}

function evidenceLocatorString(entry: StateEvidence): string | undefined {
  const ref = entry.locator || entry.path || entry.summary || entry.id;
  return ref ? String(ref) : undefined;
}

/** Base dirs used to resolve file-style evidence locators in strict mode. */
function commitEvidenceBaseDirs(run: WorkflowRun): string[] {
  return Array.from(new Set([run.cwd, process.cwd(), run.paths.runDir].filter(Boolean)));
}

function normalizeCommitOptions(input: string | CommitStateOptions): CommitStateOptions {
  if (typeof input === "string") return { reason: input || "manual", source: "runtime" };
  return {
    ...input,
    reason: input.reason || "manual",
    source: input.source || "runtime"
  };
}

function resolveCommitGate(run: WorkflowRun, options: CommitStateOptions): CommitGate {
  const metadata: Record<string, unknown> = {
    verifierGated: false,
    checkpoint: true
  };
  const errors: StateNodeError[] = [];
  const taskVerifierNodeId = taskVerifierFromReason(run, options.reason);
  const explicitGate = Boolean(options.verifierNodeId || options.candidateId || options.selectionId || options.verifierGated);
  const verifierGated = explicitGate || Boolean(taskVerifierNodeId);
  let verifierNodeId = options.verifierNodeId || taskVerifierNodeId;
  let candidateId = options.candidateId;
  let selectionId = options.selectionId;
  let selectionNodeId: string | undefined;

  if (!verifierGated) {
    return {
      verifierGated: false,
      evidence: [],
      errors,
      metadata
    };
  }

  metadata.verifierGated = true;
  metadata.checkpoint = false;

  if (selectionId) {
    const selection = findSelection(run, selectionId);
    if (!selection) {
      errors.push(error("commit-selection-not-found", `Commit selection not found: ${selectionId}`, { details: { selectionId } }));
    } else {
      candidateId = candidateId || selection.candidateId;
      verifierNodeId = resolveLinkedVerifier(verifierNodeId, selection.verifierNodeId, errors, "selection", selection.id);
      const selectionNode = findSelectionNode(run, selection.id);
      selectionNodeId = selectionNode?.id;
      if (!selectionNode) {
        errors.push(error("commit-selection-node-missing", `Selection ${selection.id} has no state node`, {
          details: { selectionId: selection.id, candidateId: selection.candidateId }
        }));
      } else if (selectionNode.kind !== "candidate" || selectionNode.status !== "verified") {
        errors.push(error("commit-selection-not-verified", `Selection ${selection.id} is not a verified candidate selection`, {
          nodeId: selectionNode.id,
          details: { selectionId: selection.id, status: selectionNode.status, kind: selectionNode.kind }
        }));
      }
      if (!selection.scoreId) {
        errors.push(error("commit-candidate-unscored", `Selection ${selection.id} has no score evidence`, {
          details: { selectionId: selection.id, candidateId: selection.candidateId }
        }));
      }
    }
  }

  if (candidateId) {
    const candidate = findCandidate(run, candidateId);
    if (!candidate) {
      errors.push(error("commit-candidate-not-found", `Commit candidate not found: ${candidateId}`, { details: { candidateId } }));
    } else {
      if (candidate.status === "rejected" || candidate.status === "failed") {
        errors.push(error("commit-candidate-not-selectable", `Candidate ${candidateId} is ${candidate.status}`, {
          details: { candidateId, status: candidate.status }
        }));
      }
      if (!candidate.scores.length) {
        errors.push(error("commit-candidate-unscored", `Candidate ${candidateId} has no score evidence`, {
          details: { candidateId }
        }));
      }
      if (candidate.status !== "verified") {
        errors.push(error("commit-candidate-not-verified", `Candidate ${candidateId} is not verifier-gated`, {
          details: { candidateId, status: candidate.status }
        }));
      }
      const selection = selectionId ? findSelection(run, selectionId) : latestSelectionForCandidate(run, candidateId);
      if (!selection) {
        errors.push(error("commit-candidate-selection-missing", `Candidate ${candidateId} has no verified selection`, {
          details: { candidateId }
        }));
      } else {
        selectionId = selection.id;
        verifierNodeId = resolveLinkedVerifier(verifierNodeId, selection.verifierNodeId || candidate.verifierNodeId, errors, "candidate", candidateId);
        const selectionNode = findSelectionNode(run, selection.id);
        selectionNodeId = selectionNode?.id;
        if (!selectionNode || selectionNode.status !== "verified") {
          errors.push(error("commit-selection-not-verified", `Candidate ${candidateId} selection ${selection.id} is not verified`, {
            nodeId: selectionNode?.id,
            details: { candidateId, selectionId: selection.id, status: selectionNode?.status || "missing" }
          }));
        }
        if (!selection.scoreId) {
          errors.push(error("commit-candidate-unscored", `Candidate ${candidateId} selection ${selection.id} has no score evidence`, {
            details: { candidateId, selectionId: selection.id }
          }));
        }
      }
    }
  }

  if (!verifierNodeId) {
    errors.push(error("commit-verifier-required", "Verifier-gated commit requires --verifier, --candidate, or --selection", {
      details: {
        hint: "Use --allow-unverified-checkpoint to write a non-gated checkpoint."
      }
    }));
  }

  const verifierNode = verifierNodeId ? findNode(run, verifierNodeId) : undefined;
  if (verifierNodeId && !verifierNode) {
    errors.push(error("commit-verifier-not-found", `Verifier node not found: ${verifierNodeId}`, { details: { verifierNodeId } }));
  }
  if (verifierNode) {
    if (verifierNode.kind !== "verifier") {
      errors.push(error("commit-verifier-wrong-kind", `Node ${verifierNode.id} is not a verifier node`, {
        nodeId: verifierNode.id,
        details: { verifierNodeId: verifierNode.id, kind: verifierNode.kind }
      }));
    }
    if (verifierNode.status !== "verified") {
      errors.push(error("commit-verifier-not-verified", `Verifier node ${verifierNode.id} is ${verifierNode.status}`, {
        nodeId: verifierNode.id,
        details: { verifierNodeId: verifierNode.id, status: verifierNode.status }
      }));
    }
    // HARD no-false-green gate (v0.1.43): if the backing result was an
    // empty-capture (no findings AND no evidence even after robust
    // normalization), the verifier node only carries a non-grounded summary
    // fallback. That can otherwise pass the length-only path for
    // optional-evidence tasks and present a 0-real-evidence review as
    // clean/green. Block it BEFORE the rationale is built so the commit fails
    // visibly (commit-gate-failed node + feedback) instead of silently passing.
    const captureWarning = emptyCaptureWarning(run, verifierNode);
    if (captureWarning) {
      errors.push(error("commit-rationale-empty-capture", `Verifier node ${verifierNode.id} cannot back a commit: ${captureWarning}`, {
        nodeId: verifierNode.id,
        details: { verifierNodeId: verifierNode.id, reason: captureWarning }
      }));
    }
    if (!verifierNode.evidence.length) {
      errors.push(error("commit-verifier-missing-evidence", `Verifier node ${verifierNode.id} has no evidence`, {
        nodeId: verifierNode.id,
        details: { verifierNodeId: verifierNode.id }
      }));
    } else if (verifierNodeRequiresEvidence(run, verifierNode)) {
      // Evidence grounding (v0.1.40 self-audit P1/P2): for verifier nodes whose
      // task REQUIRES evidence (verify/verdict/requiresEvidence, and explicit
      // candidate/selection commits), the gate must not accept unverifiable free
      // text. Require at least one GROUNDED locator (path-like / URL /
      // namespace:value), and — when the operator opts in via
      // CW_REQUIRE_RESOLVABLE_EVIDENCE — that file-style locators actually resolve
      // on disk. Closes the "presence != existence" gap. Optional-evidence tasks
      // (e.g. map/assess) keep the length-only check so the gate is never stricter
      // than result acceptance was.
      const locators = verifierNode.evidence.map(evidenceLocatorString).filter(Boolean) as string[];
      if (!hasGroundedEvidence(locators)) {
        errors.push(error("commit-verifier-evidence-ungrounded", `Verifier node ${verifierNode.id} evidence is not grounded (needs a path-like locator, URL, or namespace:value token)`, {
          nodeId: verifierNode.id,
          details: { verifierNodeId: verifierNode.id, evidence: locators }
        }));
      }
      if (requireResolvableEvidence()) {
        const unresolved = unresolvedFileEvidence(locators, commitEvidenceBaseDirs(run));
        if (unresolved.length) {
          errors.push(error("commit-verifier-evidence-unresolvable", `Verifier node ${verifierNode.id} cites file evidence that does not resolve on disk: ${unresolved.join(", ")}`, {
            nodeId: verifierNode.id,
            details: { verifierNodeId: verifierNode.id, unresolved }
          }));
        }
      }
    }
  }

  let rationale: ReturnType<typeof buildAcceptanceRationale> | undefined;
  if (verifierGated && candidateId && selectionId) {
    const candidate = findCandidate(run, candidateId);
    const selection = findSelection(run, selectionId);
    const score = selection?.scoreId ? findScore(run, candidateId, selection.scoreId) : undefined;
    rationale = selection?.acceptanceRationale || buildAcceptanceRationale({
      selectedCandidateId: candidateId,
      scoreId: selection?.scoreId,
      scoreCriteria: score?.criteria,
      verifierNodeId,
      evidenceCount: verifierNode?.evidence.length || 0,
      sandboxProfileId: sandboxProfileForCandidate(run, candidate),
      workerId: candidate?.workerId,
      commitGateResult: "passed"
    });
    for (const failure of validateAcceptanceRationale(rationale)) {
      errors.push(error("commit-rationale-incomplete", `Verifier-gated commit cannot explain acceptance: ${failure}`, {
        details: { candidateId, selectionId, verifierNodeId }
      }));
    }
  }

  // REVIEW GATE — POLICY layered ON TOP of the verifier MECHANISM. These errors
  // can only ADD constraints (required approvals from authorized roles); they
  // never relax verifier acceptance. Empty unless a policy applies to commits.
  // Fail closed: a commit lacking its required approvals is BLOCKED here.
  const reviewErrors = reviewGateErrors(run, {
    targetKind: "commit",
    candidateId,
    selectionId,
    selfActorIds: selfActorIdsForCandidate(run, candidateId, selectionId)
  });
  errors.push(...reviewErrors);
  const review = errors.length
    ? undefined
    : commitReviewProvenance(run, {
        targetKind: "commit",
        candidateId,
        selectionId,
        selfActorIds: selfActorIdsForCandidate(run, candidateId, selectionId)
      });

  return {
    verifierGated: true,
    verifierNodeId,
    candidateId,
    selectionId,
    selectionNodeId,
    evidence: verifierNode?.evidence || [],
    errors,
    rationale,
    review,
    metadata: {
      ...metadata,
      verifierNodeId,
      candidateId,
      selectionId,
      selectionNodeId
    }
  };
}

function recordCommitNode(run: WorkflowRun, commit: StateCommit, options: CommitStateOptions, gate: CommitGate): string | undefined {
  const contract = upsertRunContract(run, createDefaultPipelineContract());
  const verifierNode = gate.verifierNodeId ? findNode(run, gate.verifierNodeId) : undefined;

  if (commit.verifierGated && verifierNode) {
    const commitResult = createPipelineRunner({ contractId: contract.id, persist: false }).runPipelineStage(
      run,
      "commit",
      verifierNode.id,
      {
        outputNodeId: `${run.id}:commit:${commit.id}`,
        outputStatus: "committed",
        loopStage: "checkpoint",
        outputs: {
          snapshotPath: commit.snapshotPath,
          gitHead: commit.gitHead,
          verifierGated: true,
          verifierNodeId: verifierNode.id,
          candidateId: gate.candidateId,
          selectionId: gate.selectionId
        },
        artifacts: [{ id: "snapshot", kind: "json", path: commit.snapshotPath }],
        evidence: commit.evidence || verifierNode.evidence,
        metadata: {
          ...(options.metadata || {}),
          reason: options.reason,
          commitId: commit.id,
          verifierGated: true,
          checkpoint: false,
          verifierNodeId: verifierNode.id,
          candidateId: gate.candidateId,
          selectionId: gate.selectionId,
          selectionNodeId: gate.selectionNodeId,
          acceptanceRationale: commit.acceptanceRationale
        }
      }
    );
    if (gate.selectionNodeId && commitResult.outputNodeId) {
      linkAdditionalParent(run, gate.selectionNodeId, commitResult.outputNodeId);
    }
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
    metadata: {
      ...(options.metadata || {}),
      verifierGated: false,
      checkpoint: true
    }
  });
  appendRunNode(run, checkpointNode);
  return checkpointNode.id;
}

function recordCommitGateFailure(run: WorkflowRun, options: CommitStateOptions, gate: CommitGate): CommitGateError {
  const first = gate.errors[0] || error("commit-gate-blocked", "Verifier-gated commit blocked");
  const node = recordNodeError(
    createStateNode({
      id: `${run.id}:commit-gate-failed:${createCommitId()}`,
      kind: "error",
      status: "pending",
      loopStage: "checkpoint",
      inputs: {
        reason: options.reason,
        verifierNodeId: gate.verifierNodeId,
        candidateId: gate.candidateId,
        selectionId: gate.selectionId
      },
      evidence: gate.evidence,
      contractId: DEFAULT_PIPELINE_CONTRACT_ID,
      metadata: {
        ...(options.metadata || {}),
        verifierGated: true,
        checkpoint: false,
        failureCount: gate.errors.length,
        failures: gate.errors.map((entry) => ({ code: entry.code, message: entry.message, nodeId: entry.nodeId })),
        gate: gate.metadata
      }
    }),
    first
  );
  const persisted = appendRunNode(run, node);
  for (const parentId of [gate.selectionNodeId, gate.verifierNodeId].filter(Boolean) as string[]) {
    linkAdditionalParent(run, parentId, persisted.id);
  }
  const feedback = recordFeedback(
    run,
    {
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
        failures: gate.errors.map((entry) => ({ code: entry.code, message: entry.message, nodeId: entry.nodeId }))
      }
    },
    { persist: false }
  );
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

function taskVerifierFromReason(run: WorkflowRun, reason: string): string | undefined {
  const taskId = reason.startsWith("result:") ? reason.slice("result:".length) : "";
  if (!taskId) return undefined;
  return run.tasks.find((task) => task.id === taskId)?.verifierNodeId;
}

function resolveLinkedVerifier(
  requested: string | undefined,
  linked: string | undefined,
  errors: StateNodeError[],
  ownerKind: "candidate" | "selection",
  ownerId: string
): string | undefined {
  if (requested && linked && requested !== linked) {
    errors.push(error("commit-verifier-linkage-mismatch", `Requested verifier ${requested} is not linked to ${ownerKind} ${ownerId}`, {
      details: { requestedVerifierNodeId: requested, linkedVerifierNodeId: linked, ownerKind, ownerId }
    }));
    return requested;
  }
  return requested || linked;
}

function latestSelectionForCandidate(run: WorkflowRun, candidateId: string) {
  return [...(run.candidateSelections || [])]
    .filter((selection) => selection.candidateId === candidateId)
    .sort((left, right) => right.selectedAt.localeCompare(left.selectedAt))[0];
}

function findSelection(run: WorkflowRun, selectionId: string) {
  return (run.candidateSelections || []).find((selection) => selection.id === selectionId);
}

function findSelectionNode(run: WorkflowRun, selectionId: string): StateNode | undefined {
  return (run.nodes || []).find((node) => node.kind === "candidate" && node.metadata?.selectionId === selectionId);
}

function findCandidate(run: WorkflowRun, candidateId: string) {
  return (run.candidates || []).find((candidate) => candidate.id === candidateId);
}

function findScore(run: WorkflowRun, candidateId: string, scoreId: string): { criteria: Record<string, number> } | undefined {
  const file = path.join(run.paths.candidatesDir || path.join(run.paths.runDir, "candidates"), safeFileName(candidateId), "scores", `${safeFileName(scoreId)}.json`);
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as { criteria: Record<string, number> };
  } catch {
    return undefined;
  }
}

function sandboxProfileForCandidate(run: WorkflowRun, candidate: ReturnType<typeof findCandidate>): string | undefined {
  const worker = candidate?.workerId ? (run.workers || []).find((entry) => entry.id === candidate.workerId) : undefined;
  if (worker?.sandboxProfileId) return worker.sandboxProfileId;
  const task = candidate?.taskId ? (run.tasks || []).find((entry) => entry.id === candidate.taskId) : undefined;
  return task?.sandboxProfileId;
}

function findNode(run: WorkflowRun, nodeId: string): StateNode | undefined {
  return (run.nodes || []).find((node) => node.id === nodeId);
}

function error(
  code: string,
  message: string,
  options: Partial<Pick<StateNodeError, "nodeId" | "path" | "retryable" | "details">> = {}
): StateNodeError {
  return {
    code,
    message,
    at: new Date().toISOString(),
    retryable: false,
    ...options
  };
}

function createCommitId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `state-${stamp}-${safeFileName(Math.random().toString(36).slice(2, 8))}`;
}

function readGitHead(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}
