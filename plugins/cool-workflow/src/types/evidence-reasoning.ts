import type { CoordinatorDecision } from "./blackboard";
import type { AcceptanceRationale, CandidateScore, CandidateSelection } from "./candidate";
import type { AgentFanin } from "./multi-agent";
import type { StateEvidence } from "./result";
import type { StateCommit } from "./run";
import type { EvidenceProvenance, TrustAuditEvent, TrustAuditSource } from "./trust";

// ---------------------------------------------------------------------------
// Evidence Adoption Reasoning Chain (v0.1.26)
//
// Derived, provenance-backed records that explain WHY each evidence item was
// adopted / rejected / superseded / conflicting at each gate. These are a
// DERIVED view over existing source-of-truth records (StateEvidence,
// EvidenceProvenance, CandidateScore, CandidateSelection, AcceptanceRationale,
// StateCommit, CoordinatorDecision, TrustAuditEvent, AgentFanin): they never
// duplicate or mutate them, only link by id / ref. They follow the v0.1.25
// state-explosion summary discipline (sourceFingerprint + valid|stale|absent
// freshness, refreshable, never authoritative over raw state).
//
// FreeBSD tenet — SEPARATE MECHANISM FROM POLICY: these records capture, store
// and render the "why" (mechanism). What counts as a *sufficient* reason is left
// to the verifier / role policy (policy). The chain only reports whether a
// rationale could be traced; it never decides whether the reason is good enough.
// FreeBSD tenet — FAIL CLOSED, NEVER INFER: an adoption whose rationale cannot be
// traced to a real record renders as `unexplained` — never a fabricated reason.
// ---------------------------------------------------------------------------

// Gate at which an adoption decision is taken. Matches the existing adoption
// path vocabulary: worker result -> blackboard -> fanin -> candidate score ->
// selection -> verifier-gated commit.
export type EvidenceReasoningGate =
  | "fanin"
  | "candidate-score"
  | "selection"
  | "verifier"
  | "commit";

// Per-step / per-chain decision status. Mirrors MultiAgentOperatorEvidenceStatus
// (adopted/rejected/pending/superseded/conflicting/missing) and adds the
// fail-closed `unexplained` state for an adoption with no traceable rationale.
export type EvidenceReasoningStatus =
  | "adopted"
  | "rejected"
  | "superseded"
  | "conflicting"
  | "pending"
  | "missing"
  | "unexplained";

// Whether a rationale could be traced to a real source record. Never inferred:
// `unexplained` is a visible state, not a guess. `not-applicable` covers steps
// where no adoption decision is taken (e.g. still-pending evidence).
export type EvidenceRationaleStatus = "explained" | "unexplained" | "not-applicable";

// Derived-view freshness, identical in spirit to the state-explosion
// SummaryStatus. Declared here so types.ts stays import-free of src modules.
export type EvidenceReasoningFreshnessStatus = "valid" | "stale" | "absent";

// BASIS: the concrete evidence + provenance + trust source grounding a decision.
// Links to existing EvidenceProvenance / trust-audit records; does not copy them.
export interface EvidenceReasoningBasis {
  evidenceRefs: string[];
  provenanceSource?: TrustAuditSource;
  parentEvidenceIds: string[];
  auditEventIds: string[];
}

// AUTHORITY: which role / membership / worker made the call and under which role
// policy it was permitted. Links to existing trust / policy / audit records.
export interface EvidenceReasoningAuthority {
  actor?: string;
  actorKind:
    | "role"
    | "membership"
    | "worker"
    | "operator"
    | "coordinator"
    | "verifier"
    | "runtime";
  policyRef?: string;
  allowed?: boolean;
}

// RATIONALE: the explicit recorded reason. Reuses existing rationale fields
// (selection.reason, AcceptanceRationale, score.notes/verdict, commit.reason,
// CoordinatorDecision.reason, judge-rationale audit metadata). When none exists,
// status is `unexplained` and text is omitted — never fabricated.
export interface EvidenceReasoningRationale {
  status: EvidenceRationaleStatus;
  text?: string;
  sourceKind?:
    | "selection-reason"
    | "acceptance-rationale"
    | "score-notes"
    | "score-verdict"
    | "commit-reason"
    | "coordinator-decision"
    | "judge-rationale";
  sourceId?: string;
  judgeRationaleIds?: string[];
  panelDecisionId?: string;
  scoreCriteria?: Record<string, number>;
  // Normalized score delta vs. the best rejected candidate, when computable.
  scoreDelta?: number;
}

// COUNTERFACTUAL: a rejected/losing alternative and the recorded reason it lost,
// so adoption is understood relative to its alternatives. Reasons are recorded,
// never inferred.
export interface EvidenceReasoningCounterfactual {
  ref: string;
  kind: "candidate" | "score" | "decision" | "evidence";
  status: EvidenceReasoningStatus;
  reason: string;
}

// DECISION: one gate's worth of reasoning for a single evidence item.
export interface EvidenceReasoningStep {
  gate: EvidenceReasoningGate;
  decision: EvidenceReasoningStatus;
  basis: EvidenceReasoningBasis;
  authority: EvidenceReasoningAuthority;
  rationale: EvidenceReasoningRationale;
  counterfactuals: EvidenceReasoningCounterfactual[];
}

// The full reasoning chain for one evidence item across the gates it traversed.
export interface EvidenceReasoningChain {
  schemaVersion: 1;
  id: string;
  ref?: string;
  evidenceStatus: EvidenceReasoningStatus;
  rationaleStatus: EvidenceRationaleStatus;
  sourceKind: "worker" | "blackboard" | "coordinator" | "verifier" | "operator" | "runtime";
  sourceId?: string;
  steps: EvidenceReasoningStep[];
  sourceRecordIds: string[];
  unexplainedReasons: string[];
}

// INTEGRITY: a fingerprinted, freshness-tracked report over all chains.
export interface EvidenceReasoningReport {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  freshness: {
    status: EvidenceReasoningFreshnessStatus;
    persistedFingerprint?: string;
    currentFingerprint: string;
  };
  sourceFingerprint: string;
  totals: {
    chains: number;
    explained: number;
    unexplained: number;
    notApplicable: number;
    adopted: number;
    rejected: number;
    byStatus: Record<string, number>;
  };
  chains: EvidenceReasoningChain[];
  nextAction: string;
}
