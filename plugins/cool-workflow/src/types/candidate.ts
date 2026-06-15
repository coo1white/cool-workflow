import type { StateArtifact, StateEvidence } from "./result";

export type CandidateStatus = "registered" | "scored" | "selected" | "rejected" | "verified" | "failed";
export type CandidateKind = "worker-output" | "result" | "artifact" | "manual" | "release";
export type CandidateScoreVerdict = "pass" | "warn" | "fail";

export interface CandidateScoringPolicy {
  id?: string;
  title?: string;
  criteria?: string[];
  requireEvidence?: boolean;
  requireVerifierGate?: boolean;
  minNormalized?: number;
  tieBreaker?: "createdAt" | "candidateId";
}

export interface CandidateScoringOptions {
  policy?: CandidateScoringPolicy;
  persist?: boolean;
}

export interface CandidateRecord {
  schemaVersion: 1;
  id: string;
  runId: string;
  kind: CandidateKind;
  status: CandidateStatus;
  createdAt: string;
  updatedAt: string;
  workerId?: string;
  taskId?: string;
  resultNodeId?: string;
  verifierNodeId?: string;
  resultPath?: string;
  artifacts: StateArtifact[];
  evidence: StateEvidence[];
  scores: string[];
  selectedAt?: string;
  rejectedAt?: string;
  feedbackIds: string[];
  metadata?: Record<string, unknown>;
}

export interface CandidateScore {
  schemaVersion: 1;
  id: string;
  candidateId: string;
  runId: string;
  createdAt: string;
  scorer: string;
  criteria: Record<string, number>;
  total: number;
  maxTotal: number;
  normalized: number;
  verdict: CandidateScoreVerdict;
  evidence: StateEvidence[];
  artifacts: StateArtifact[];
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface CandidateRanking {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  policy: Required<Pick<CandidateScoringPolicy, "requireEvidence" | "requireVerifierGate" | "tieBreaker">> &
    CandidateScoringPolicy;
  candidates: Array<{
    candidateId: string;
    status: CandidateStatus;
    scoreCount: number;
    bestScoreId?: string;
    normalized: number;
    verdict?: CandidateScoreVerdict;
    rank: number;
  }>;
  ties: string[][];
}

export interface CandidateSelection {
  schemaVersion: 1;
  id: string;
  runId: string;
  candidateId: string;
  selectedAt: string;
  selectedBy: string;
  verifierNodeId?: string;
  scoreId?: string;
  rankingPath?: string;
  reason: string;
  evidence: StateEvidence[];
  artifacts: StateArtifact[];
  feedbackIds: string[];
  acceptanceRationale?: AcceptanceRationale;
  metadata?: Record<string, unknown>;
}

export interface AcceptanceRationale {
  schemaVersion: 1;
  selectedCandidateId?: string;
  scoreId?: string;
  scoreCriteria?: Record<string, number>;
  verifierNodeId?: string;
  evidenceCount: number;
  sandboxProfileId?: string;
  workerId?: string;
  commitGateResult?: "passed" | "blocked" | "checkpoint";
  auditEventIds?: string[];
  judgeRationaleIds?: string[];
  panelDecisionId?: string;
}
