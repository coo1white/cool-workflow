// core/pipeline/commit-gate.ts — the final commit's gate. The verdict task's
// accepted result must carry evidence that is grounded, resolves on disk, cites
// no line past a file's end, and cites only receipts CW accepts. Pure: the
// shell hands in the disk checks.

import { RunTask, WorkflowRun } from "../state/types.js";
import { hasGroundedEvidence, isVerdictTaskId, LinePastEnd, receiptIdsIn } from "../trust/evidence-grounding.js";
import { isEmptyCapture, ResultEnvelope } from "./result-normalize.js";

export interface GateError {
  code: string;
  message: string;
}

export interface CommitGateDeps {
  unresolvedFileEvidence(evidence: string[]): string[];
  linePastEnd(evidence: string[]): LinePastEnd | null;
  refusedReceipts(ids: string[]): Array<{ reason: string; next: string }>;
}

/** The completed verdict/synthesis task that gates the final commit. */
export function verdictTask(run: WorkflowRun): RunTask | undefined {
  return run.tasks.find((task) => isVerdictTaskId(task.id) && task.status === "completed");
}

export function commitGateErrors(task: RunTask, result: ResultEnvelope | undefined, deps: CommitGateDeps): GateError[] {
  const errors: GateError[] = [];
  const name = `Verifier task ${task.id}`;
  if (!result || isEmptyCapture(result)) {
    errors.push({ code: "commit-rationale-empty-capture", message: `${name} cannot back a commit: its result has no findings and no evidence` });
    return errors;
  }
  const evidence = result.evidence.map(String);
  if (!evidence.length) {
    errors.push({ code: "commit-verifier-missing-evidence", message: `${name} has no evidence` });
  } else if (task.requiresEvidence) {
    if (!hasGroundedEvidence(evidence)) {
      errors.push({ code: "commit-verifier-evidence-ungrounded", message: `${name} evidence is not grounded (needs a path-like locator, URL, or namespace:value token)` });
    }
    const unresolved = deps.unresolvedFileEvidence(evidence);
    if (unresolved.length) {
      errors.push({ code: "commit-verifier-evidence-unresolvable", message: `${name} cites file evidence that does not resolve on disk: ${unresolved.join(", ")}` });
    }
    const pastEnd = deps.linePastEnd(evidence);
    if (pastEnd) {
      errors.push({ code: "commit-verifier-evidence-past-end", message: `${name} cites a line past the end of its file: ${pastEnd.path}:${pastEnd.line} (${pastEnd.path} has ${pastEnd.lines} lines)` });
    }
  }
  const receipts = receiptIdsIn(evidence);
  const refused = receipts.length ? deps.refusedReceipts(receipts) : [];
  if (refused.length) {
    errors.push({ code: "commit-verifier-receipt-refused", message: `${name} cites a receipt CW cannot accept: ${refused[0].reason}. Next: ${refused[0].next}` });
  }
  return errors;
}

/** Position in the run's append-only commit log, 1-based, 4 digits. */
export function formatCommitId(seq: number): string {
  return `state-${String(seq).padStart(4, "0")}`;
}
