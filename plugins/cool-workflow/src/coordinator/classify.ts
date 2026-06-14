// Pure status / source classifiers for the coordinator/blackboard layer
// (FreeBSD-audit R-carve). Carved out of coordinator.ts so the module no longer
// bundles these stateless enum-to-enum mappers alongside the stateful blackboard
// operations. Re-exported from coordinator.ts to keep the public surface
// byte-identical.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Each function maps
// a record/outcome enum to a status/source enum; no WorkflowRun, no state, no I/O.
import { BlackboardAuthor, CoordinatorDecisionOutcome, BlackboardRecordStatus, StateNodeStatus } from "../types";

export function statusToNodeStatus(status: string): StateNodeStatus {
  switch (status) {
    case "active":
    case "open":
      return "running";
    case "resolved":
    case "superseded":
      return "completed";
    case "conflicting":
      return "blocked";
    case "rejected":
      return "rejected";
    default:
      return "completed";
  }
}

export function decisionStatus(outcome: CoordinatorDecisionOutcome): BlackboardRecordStatus {
  if (outcome === "conflicting" || outcome === "blocked") return "conflicting";
  if (outcome === "rejected") return "rejected";
  if (outcome === "superseded") return "superseded";
  return "active";
}

export function auditDecision(outcome: CoordinatorDecisionOutcome) {
  if (outcome === "rejected") return "rejected" as const;
  if (outcome === "blocked" || outcome === "conflicting") return "failed" as const;
  return "accepted" as const;
}

export function sourceForAuthor(author: BlackboardAuthor) {
  if (author.kind === "runtime" || author.kind === "coordinator") return "runtime-derived" as const;
  if (author.kind === "worker" || author.kind === "verifier") return "cw-validated" as const;
  return "operator-recorded" as const;
}
