// core/pipeline/commit-gate.ts — commitState's gate resolution + the
// ~25 error codes.
//
// MILESTONE 6+7 (combined). Byte-exact port of the DECISION half of the
// old build's src/commit.ts (calls into core/state/state-node.ts's
// transition matrix + commit-without-verifier gate from milestone 3). The
// actual snapshot/audit writes are shell/drive.ts + shell/report.ts.
//
// Evidence: SPEC/pipeline-run.md "Commit gate — src/commit.ts",
// "Commit-gate error codes (fixed strings)".

import { StateEvidence, StateNode, StateNodeError, WorkflowRun } from "../state/types";
import { hasGroundedEvidence } from "../trust/evidence-grounding";
import { isEmptyCapture, ResultEnvelope } from "./result-normalize";

export interface CommitStateOptions {
  reason: string;
  verifierNodeId?: string;
  candidateId?: string;
  selectionId?: string;
  verifierGated?: boolean;
  allowUnverifiedCheckpoint?: boolean;
  source?: "runtime" | "cli" | "manual";
  metadata?: Record<string, unknown>;
}

export interface CommitCandidate {
  id: string;
  status: string;
  scores: unknown[];
  verifierNodeId?: string;
}

export interface CommitSelection {
  id: string;
  candidateId: string;
  verifierNodeId?: string;
  scoreId?: string;
  selectedAt?: string;
  acceptanceRationale?: Record<string, unknown>;
}

export interface CommitGateResolution {
  verifierGated: boolean;
  verifierNodeId?: string;
  candidateId?: string;
  selectionId?: string;
  selectionNodeId?: string;
  evidence: StateEvidence[];
  errors: StateNodeError[];
  metadata: Record<string, unknown>;
}

function error(code: string, message: string, options: Partial<Pick<StateNodeError, "nodeId" | "path" | "retryable" | "details">> = {}, now: string): StateNodeError {
  return { code, message, at: now, retryable: false, ...options };
}

/** Whether the reason has the form `result:<task-id>` and that task has a
 *  verifierNodeId (auto-gate). */
function taskVerifierFromReason(run: WorkflowRun, reason: string): string | undefined {
  const taskId = reason.startsWith("result:") ? reason.slice("result:".length) : "";
  if (!taskId) return undefined;
  return (run.tasks.find((t) => t.id === taskId)?.verifierNodeId as string | undefined) || undefined;
}

function findNode(run: WorkflowRun, nodeId: string): StateNode | undefined {
  return (run.nodes || []).find((n) => n.id === nodeId);
}

function findCandidate(run: WorkflowRun, candidateId: string): CommitCandidate | undefined {
  return ((run.candidates || []) as unknown as CommitCandidate[]).find((c) => c.id === candidateId);
}

function findSelection(run: WorkflowRun, selectionId: string): CommitSelection | undefined {
  return ((run.candidateSelections || []) as unknown as CommitSelection[]).find((s) => s.id === selectionId);
}

function findSelectionNode(run: WorkflowRun, selectionId: string): StateNode | undefined {
  return (run.nodes || []).find((n) => n.kind === "candidate" && (n.metadata as Record<string, unknown> | undefined)?.selectionId === selectionId);
}

function latestSelectionForCandidate(run: WorkflowRun, candidateId: string): CommitSelection | undefined {
  return [...((run.candidateSelections || []) as unknown as CommitSelection[])]
    .filter((s) => s.candidateId === candidateId)
    .sort((a, b) => (b.selectedAt || "").localeCompare(a.selectedAt || ""))[0];
}

function evidenceLocatorString(entry: StateEvidence): string | undefined {
  const ref = entry.locator || entry.path || entry.summary || entry.id;
  return ref ? String(ref) : undefined;
}

/** The node must be kind verifier and status verified and have evidence.
 *  The HARD no-false-green gate: a verifier whose backing result was an
 *  empty capture fails with commit-rationale-empty-capture. `backingResult`
 *  is the parsed cw:result envelope of the task the verifier node backs
 *  (undefined for an explicit candidate/selection commit with no 1:1
 *  task). */
export function emptyCaptureWarning(backingResult: ResultEnvelope | undefined): string | undefined {
  if (!backingResult) return undefined;
  return isEmptyCapture(backingResult) ? "no findings or evidence captured from result.md" : undefined;
}

/** Whether a verifier node is held to the grounded-evidence bar: its
 *  backing task requires evidence, or there is no 1:1 task (explicit
 *  candidate/selection commit — always enforced). */
export function verifierNodeRequiresEvidence(taskRequiresEvidence: boolean | undefined): boolean {
  return taskRequiresEvidence === undefined ? true : taskRequiresEvidence;
}

export interface ResolveCommitGateDeps {
  now: string;
  /** The backing task's parsed result envelope, for the empty-capture
   *  gate (undefined when no 1:1 task backs this verifier). */
  backingResult?: ResultEnvelope;
  /** Whether the backing task requires evidence (drives the grounding
   *  gate's strictness). Defaults to `true` (enforced) when there is no
   *  1:1 task. */
  taskRequiresEvidence?: boolean;
  /** Opt-in strict evidence resolution (CW_REQUIRE_RESOLVABLE_EVIDENCE). */
  unresolvedFileEvidence?: (evidence: string[]) => string[];
}

/** commitState's gate resolution. Pure decision function; the caller
 *  (shell/) performs the actual snapshot/audit writes on success and the
 *  error-node/feedback write on failure. Error order matches the old
 *  build byte-for-byte. */
export function resolveCommitGate(run: WorkflowRun, options: CommitStateOptions, deps: ResolveCommitGateDeps): CommitGateResolution {
  const metadata: Record<string, unknown> = { verifierGated: false, checkpoint: true };
  const errors: StateNodeError[] = [];
  const now = deps.now;
  const taskVerifierNodeId = taskVerifierFromReason(run, options.reason);
  const explicitGate = Boolean(options.verifierNodeId || options.candidateId || options.selectionId || options.verifierGated);
  const verifierGated = explicitGate || Boolean(taskVerifierNodeId);

  if (!verifierGated) {
    return { verifierGated: false, evidence: [], errors, metadata };
  }

  metadata.verifierGated = true;
  metadata.checkpoint = false;

  let verifierNodeId = options.verifierNodeId || taskVerifierNodeId;
  let candidateId = options.candidateId;
  let selectionId = options.selectionId;
  let selectionNodeId: string | undefined;

  // Selection pass.
  if (selectionId) {
    const selection = findSelection(run, selectionId);
    if (!selection) {
      errors.push(error("commit-selection-not-found", `Commit selection not found: ${selectionId}`, { details: { selectionId } }, now));
    } else {
      candidateId = candidateId || selection.candidateId;
      if (verifierNodeId && selection.verifierNodeId && verifierNodeId !== selection.verifierNodeId) {
        errors.push(
          error("commit-verifier-linkage-mismatch", `Requested verifier ${verifierNodeId} is not linked to selection ${selection.id}`, {
            details: { requestedVerifierNodeId: verifierNodeId, linkedVerifierNodeId: selection.verifierNodeId },
          }, now)
        );
      } else {
        verifierNodeId = verifierNodeId || selection.verifierNodeId;
      }
      const selectionNode = findSelectionNode(run, selection.id);
      selectionNodeId = selectionNode?.id;
      if (!selectionNode) {
        errors.push(
          error("commit-selection-node-missing", `Selection ${selection.id} has no state node`, { details: { selectionId: selection.id, candidateId: selection.candidateId } }, now)
        );
      } else if (selectionNode.kind !== "candidate" || selectionNode.status !== "verified") {
        errors.push(
          error("commit-selection-not-verified", `Selection ${selection.id} is not a verified candidate selection`, {
            nodeId: selectionNode.id,
            details: { selectionId: selection.id, status: selectionNode.status, kind: selectionNode.kind },
          }, now)
        );
      }
      if (!selection.scoreId) {
        errors.push(error("commit-candidate-unscored", `Selection ${selection.id} has no score evidence`, { details: { selectionId: selection.id, candidateId: selection.candidateId } }, now));
      }
    }
  }

  // Candidate pass.
  if (candidateId) {
    const candidate = findCandidate(run, candidateId);
    if (!candidate) {
      errors.push(error("commit-candidate-not-found", `Commit candidate not found: ${candidateId}`, { details: { candidateId } }, now));
    } else {
      if (candidate.status === "rejected" || candidate.status === "failed") {
        errors.push(error("commit-candidate-not-selectable", `Candidate ${candidateId} is ${candidate.status}`, { details: { candidateId, status: candidate.status } }, now));
      }
      if (!candidate.scores.length) {
        errors.push(error("commit-candidate-unscored", `Candidate ${candidateId} has no score evidence`, { details: { candidateId } }, now));
      }
      if (candidate.status !== "verified") {
        errors.push(error("commit-candidate-not-verified", `Candidate ${candidateId} is not verifier-gated`, { details: { candidateId, status: candidate.status } }, now));
      }
      const selection = selectionId ? findSelection(run, selectionId) : latestSelectionForCandidate(run, candidateId);
      if (!selection) {
        errors.push(error("commit-candidate-selection-missing", `Candidate ${candidateId} has no verified selection`, { details: { candidateId } }, now));
      } else {
        selectionId = selection.id;
        const linked = selection.verifierNodeId || candidate.verifierNodeId;
        if (verifierNodeId && linked && verifierNodeId !== linked) {
          errors.push(
            error("commit-verifier-linkage-mismatch", `Requested verifier ${verifierNodeId} is not linked to candidate ${candidateId}`, {
              details: { requestedVerifierNodeId: verifierNodeId, linkedVerifierNodeId: linked },
            }, now)
          );
        } else {
          verifierNodeId = verifierNodeId || linked;
        }
        const selectionNode = findSelectionNode(run, selection.id);
        selectionNodeId = selectionNode?.id;
        if (!selectionNode || selectionNode.status !== "verified") {
          errors.push(
            error("commit-selection-not-verified", `Candidate ${candidateId} selection ${selection.id} is not verified`, {
              nodeId: selectionNode?.id,
              details: { candidateId, selectionId: selection.id, status: selectionNode?.status || "missing" },
            }, now)
          );
        }
        if (!selection.scoreId) {
          errors.push(
            error("commit-candidate-unscored", `Candidate ${candidateId} selection ${selection.id} has no score evidence`, { details: { candidateId, selectionId: selection.id } }, now)
          );
        }
      }
    }
  }

  if (!verifierNodeId) {
    errors.push(
      error("commit-verifier-required", "Verifier-gated commit requires --verifier, --candidate, or --selection", {
        details: { hint: "Use --allow-unverified-checkpoint to write a non-gated checkpoint." },
      }, now)
    );
  }

  const verifierNode = verifierNodeId ? findNode(run, verifierNodeId) : undefined;
  if (verifierNodeId && !verifierNode) {
    errors.push(error("commit-verifier-not-found", `Verifier node not found: ${verifierNodeId}`, { details: { verifierNodeId } }, now));
  }
  if (verifierNode) {
    groundVerifierEvidence(run, verifierNode, errors, deps, now);
  }

  return {
    verifierGated: true,
    verifierNodeId,
    candidateId,
    selectionId,
    selectionNodeId,
    evidence: verifierNode?.evidence || [],
    errors,
    metadata: { ...metadata, verifierNodeId, candidateId, selectionId, selectionNodeId },
  };
}

function groundVerifierEvidence(run: WorkflowRun, verifierNode: StateNode, errors: StateNodeError[], deps: ResolveCommitGateDeps, now: string): void {
  if (verifierNode.kind !== "verifier") {
    errors.push(error("commit-verifier-wrong-kind", `Node ${verifierNode.id} is not a verifier node`, { nodeId: verifierNode.id, details: { verifierNodeId: verifierNode.id, kind: verifierNode.kind } }, now));
  }
  if (verifierNode.status !== "verified") {
    errors.push(error("commit-verifier-not-verified", `Verifier node ${verifierNode.id} is ${verifierNode.status}`, { nodeId: verifierNode.id, details: { verifierNodeId: verifierNode.id, status: verifierNode.status } }, now));
  }
  const captureWarning = emptyCaptureWarning(deps.backingResult);
  if (captureWarning) {
    errors.push(
      error("commit-rationale-empty-capture", `Verifier node ${verifierNode.id} cannot back a commit: ${captureWarning}`, {
        nodeId: verifierNode.id,
        details: { verifierNodeId: verifierNode.id, reason: captureWarning },
      }, now)
    );
  }
  if (!verifierNode.evidence.length) {
    errors.push(error("commit-verifier-missing-evidence", `Verifier node ${verifierNode.id} has no evidence`, { nodeId: verifierNode.id, details: { verifierNodeId: verifierNode.id } }, now));
  } else if (verifierNodeRequiresEvidence(deps.taskRequiresEvidence)) {
    const locators = verifierNode.evidence.map(evidenceLocatorString).filter(Boolean) as string[];
    if (!hasGroundedEvidence(locators)) {
      errors.push(
        error("commit-verifier-evidence-ungrounded", `Verifier node ${verifierNode.id} evidence is not grounded (needs a path-like locator, URL, or namespace:value token)`, {
          nodeId: verifierNode.id,
          details: { verifierNodeId: verifierNode.id, evidence: locators },
        }, now)
      );
    }
    if (deps.unresolvedFileEvidence) {
      const unresolved = deps.unresolvedFileEvidence(locators);
      if (unresolved.length) {
        errors.push(
          error("commit-verifier-evidence-unresolvable", `Verifier node ${verifierNode.id} cites file evidence that does not resolve on disk: ${unresolved.join(", ")}`, {
            nodeId: verifierNode.id,
            details: { verifierNodeId: verifierNode.id, unresolved },
          }, now)
        );
      }
    }
  }
}

/** Deterministic commit id: position in the run's append-only commit log
 *  (1-based), 4 digits. */
export function formatCommitId(seq: number): string {
  return `state-${String(seq).padStart(4, "0")}`;
}

/** Deterministic blocked-commit node id sequence: counts the
 *  commit-gate-failed nodes already recorded on the run. */
export function gateFailureSeq(run: WorkflowRun): string {
  const marker = ":commit-gate-failed:";
  const seq = (run.nodes || []).filter((n) => n.id.includes(marker)).length + 1;
  return String(seq).padStart(4, "0");
}
