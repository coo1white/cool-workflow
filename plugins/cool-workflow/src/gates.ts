// Shared, drift-proof gate primitives (F4). These two helpers were previously
// duplicated "in sync by comment" in commit.ts and candidate-scoring.ts — the
// no-false-green gate and the sandbox-profile lookup. A by-comment sync is a
// structural drift hazard: nothing prevents one copy from changing without the
// other, and the two gates MUST agree (selection + commit must reach the same
// empty-capture verdict). Extracting ONE implementation each, imported by both
// call sites, makes that drift impossible.
//
// Pure functions over PERSISTED state only — no clock, no randomness, no fs —
// so both selection and commit replays reach the same gate decision. Keep them
// fail-closed: when in doubt the caller must BLOCK, never silently pass.

import type { CandidateRecord, StateNode, WorkflowRun } from "./types";

/** The HARD no-false-green gate (DIRECTION.md "ambiguity is a visible state").
 *  A verifier node is built FROM a result node; when that result captured no
 *  structured signal at all the result node carries a `metadata.captureWarning`
 *  marker (set in worker-isolation / lifecycle ingest via isEmptyCapture). The
 *  worker output is still ACCEPTED (a recorded warning, never a silent pass), but
 *  a verifier-GATED commit — and candidate SELECTION — must NOT be able to
 *  present that zero-evidence result as clean/green. We detect it here, reading
 *  ONLY persisted state (the source result node's metadata) — purely functional,
 *  no clock/ordering — so snapshot replay reaches the same gate decision.
 *  Returns the marker string, or undefined.
 *
 *  Resolution trail: verifier node -> its input/parent result node. We look at
 *  `inputs.inputNodeId` (set by runPipelineStage) first, then fall back to the
 *  first parent, so it works regardless of which ingest path produced the node. */
export function emptyCaptureWarning(run: WorkflowRun, verifierNode: StateNode): string | undefined {
  const resultNodeId =
    (typeof verifierNode.inputs?.inputNodeId === "string" ? (verifierNode.inputs.inputNodeId as string) : undefined) ||
    verifierNode.parents[0];
  const resultNode = resultNodeId ? (run.nodes || []).find((node) => node.id === resultNodeId) : undefined;
  const warning = resultNode?.metadata?.captureWarning;
  return typeof warning === "string" && warning ? warning : undefined;
}

/** Resolve the sandbox profile that backed a candidate's acceptance: the
 *  worker's profile if the candidate has a worker, else the originating task's.
 *  Read by both the commit gate's acceptance rationale and selection. Accepts an
 *  optional candidate so the commit-side caller (which may not have resolved a
 *  candidate) can share the same lookup. Pure over persisted run state. */
export function sandboxProfileForCandidate(run: WorkflowRun, candidate: CandidateRecord | undefined): string | undefined {
  const worker = candidate?.workerId ? (run.workers || []).find((entry) => entry.id === candidate.workerId) : undefined;
  if (worker?.sandboxProfileId) return worker.sandboxProfileId;
  const task = candidate?.taskId ? (run.tasks || []).find((entry) => entry.id === candidate.taskId) : undefined;
  return task?.sandboxProfileId;
}
