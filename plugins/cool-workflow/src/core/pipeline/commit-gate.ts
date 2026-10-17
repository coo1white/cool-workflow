// core/pipeline/commit-gate.ts — commitState's gate resolution + the
// ~25 error codes.
//
// The DECISION half of the commit gate (calls into core/state/
// state-node.ts's transition matrix + commit-without-verifier gate). The
// actual snapshot/audit writes are shell/drive.ts + shell/report.ts.
//
// Evidence: SPEC/pipeline-run.md "Commit gate — commit module",
// "Commit-gate error codes (fixed strings)".

import { StateEvidence, StateNode, StateNodeError, WorkflowRun } from "../state/types";
import { hasGroundedEvidence } from "../trust/evidence-grounding";
import { isEmptyCapture, ResultEnvelope } from "./result-normalize";

export interface CommitStateOptions {
  reason: string;
  verifierNodeId?: string;
  verifierGated?: boolean;
  allowUnverifiedCheckpoint?: boolean;
  source?: "runtime" | "cli" | "manual";
  metadata?: Record<string, unknown>;
  /** Facade-style aliases: the host/MCP surface passes `verifier`/
   *  `verifierNode` (bare nouns). commitState folds them into
   *  verifierNodeId, so a caller can hand commitState the same object the
   *  CLI/MCP layer received. */
  verifier?: string;
  verifierNode?: string;
}

export interface CommitGateResolution {
  verifierGated: boolean;
  verifierNodeId?: string;
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

function evidenceLocatorString(entry: StateEvidence): string | undefined {
  const ref = entry.locator || entry.path || entry.summary || entry.id;
  return ref ? String(ref) : undefined;
}

/** The node must be kind verifier and status verified and have evidence.
 *  The HARD no-false-green gate: a verifier whose backing result was an
 *  empty capture fails with commit-rationale-empty-capture. `backingResult`
 *  is the parsed cw:result envelope of the task the verifier node backs
 *  (undefined when no 1:1 task backs the verifier). */
export function emptyCaptureWarning(backingResult: ResultEnvelope | undefined): string | undefined {
  if (!backingResult) return undefined;
  return isEmptyCapture(backingResult) ? "no findings or evidence captured from result.md" : undefined;
}

/** Whether a verifier node is held to the grounded-evidence bar: its
 *  backing task requires evidence, or there is no 1:1 task (always
 *  enforced). */
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
 *  error-node/feedback write on failure. Error order is pinned. */
export function resolveCommitGate(run: WorkflowRun, options: CommitStateOptions, deps: ResolveCommitGateDeps): CommitGateResolution {
  const metadata: Record<string, unknown> = { verifierGated: false, checkpoint: true };
  const errors: StateNodeError[] = [];
  const now = deps.now;
  const taskVerifierNodeId = taskVerifierFromReason(run, options.reason);
  const explicitGate = Boolean(options.verifierNodeId || options.verifierGated);
  const verifierGated = explicitGate || Boolean(taskVerifierNodeId);

  if (!verifierGated) {
    return { verifierGated: false, evidence: [], errors, metadata };
  }

  metadata.verifierGated = true;
  metadata.checkpoint = false;

  const verifierNodeId = options.verifierNodeId || taskVerifierNodeId;

  if (!verifierNodeId) {
    errors.push(
      error("commit-verifier-required", "Verifier-gated commit requires --verifier", {
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
    evidence: verifierNode?.evidence || [],
    errors,
    metadata: { ...metadata, verifierNodeId },
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
