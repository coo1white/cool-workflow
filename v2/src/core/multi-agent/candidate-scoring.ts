// core/multi-agent/candidate-scoring.ts — registerCandidate/scoreCandidate/
// rankCandidates/selectCandidate's PURE decision half.
//
// MILESTONE 9. Byte-exact port of the decision math in the old build's
// src/candidate-scoring.ts: id minting, score/verdict math, ranking sort
// + tie detection, and the selection gate's failure list. Disk reads/
// writes, trust-audit calls, feedback recording, and saveCheckpoint are
// the caller's job — see shell/candidate-scoring-io.ts.
//
// BYTE-COMPAT ITEM 3 [load-bearing, HIGH priority]: `unique` in this file
// does NOT sort (dedup only, insertion order preserved) — same family as
// topology.ts's `unique`, the opposite of runtime.ts/coordinator.ts's
// sorting `unique`. See uniquedual-role-vs-candidate-order.case.js.
//
// Evidence: SPEC/multi-agent.md section E ("Candidate scoring"),
// "Candidate scoring exact outputs"; plugins/cool-workflow/src/
// candidate-scoring.ts (byte-exact source).

import { StateArtifact, StateEvidence, StateNode, StateNodeError } from "../state/types";

export const CANDIDATE_SCHEMA_VERSION = 1;

/** Verdict thresholds on a score's normalized value [0,1]. */
export const VERDICT_PASS_THRESHOLD = 0.7;
export const VERDICT_WARN_THRESHOLD = 0.4;

/** Dedup, insertion-order preserved (does NOT sort). See file header
 *  byte-compat note. */
export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export type CandidateKind = "worker-output" | "result" | "manual";
export type CandidateStatus = "registered" | "scored" | "failed" | "selected" | "verified" | "rejected";

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
  feedbackIds: string[];
  selectedAt?: string;
  rejectedAt?: string;
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
  verdict: "pass" | "warn" | "fail";
  evidence: StateEvidence[];
  artifacts: StateArtifact[];
  notes?: string;
  metadata?: Record<string, unknown>;
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
  rankingPath: string;
  reason: string;
  evidence: StateEvidence[];
  artifacts: StateArtifact[];
  feedbackIds: string[];
  acceptanceRationale?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CandidateScoringPolicy {
  id?: string;
  title?: string;
  requireEvidence?: boolean;
  requireVerifierGate?: boolean;
  minNormalized?: number;
  tieBreaker?: "createdAt" | "candidateId";
}

export interface MergedCandidatePolicy {
  id: string;
  title: string;
  requireEvidence: boolean;
  requireVerifierGate: boolean;
  minNormalized?: number;
  tieBreaker: "createdAt" | "candidateId";
}

export function mergePolicy(policy: CandidateScoringPolicy = {}): MergedCandidatePolicy {
  return {
    id: policy.id || "cw.candidate.default",
    title: policy.title || "Default Candidate Scoring",
    requireEvidence: policy.requireEvidence ?? true,
    requireVerifierGate: policy.requireVerifierGate ?? true,
    minNormalized: policy.minNormalized,
    tieBreaker: policy.tieBreaker || "createdAt",
  };
}

export function verdictFor(normalized: number, policy: MergedCandidatePolicy): CandidateScore["verdict"] {
  if (policy.minNormalized !== undefined && normalized < policy.minNormalized) return "fail";
  if (normalized >= VERDICT_PASS_THRESHOLD) return "pass";
  if (normalized >= VERDICT_WARN_THRESHOLD) return "warn";
  return "fail";
}

export function sumCriteria(criteria: Record<string, number>): number {
  return Object.values(criteria).reduce((total, value) => total + Number(value || 0), 0);
}

export function inferCandidateKind(input: { workerId?: string; resultNodeId?: string; resultPath?: string }): CandidateKind {
  if (input.workerId) return "worker-output";
  if (input.resultNodeId || input.resultPath) return "result";
  return "manual";
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}

/** Deterministic candidate id: position in the run's candidate set,
 *  qualified by kind + seed (stable worker/task/result id). */
export function createCandidateId(candidateCount: number, kind: CandidateKind, seed?: string): string {
  const seq = candidateCount + 1;
  return `candidate-${safeFileName(kind)}-${seed ? `${safeFileName(seed)}-` : ""}${String(seq).padStart(4, "0")}`;
}

/** Deterministic score id: position within the candidate's score list. */
export function createScoreId(candidate: { id: string; scores: string[] }): string {
  const seq = (candidate.scores || []).length + 1;
  return `score-${safeFileName(candidate.id)}-${String(seq).padStart(4, "0")}`;
}

/** Deterministic selection id: position in the run's append-only
 *  selection log. */
export function createSelectionId(selectionCount: number, candidateId: string): string {
  const seq = selectionCount + 1;
  return `selection-${safeFileName(candidateId)}-${String(seq).padStart(4, "0")}`;
}

export function computeScoreMath(criteria: Record<string, number>, maxTotalInput: number | undefined, policy: MergedCandidatePolicy, verdictOverride: CandidateScore["verdict"] | undefined): { total: number; maxTotal: number; normalized: number; verdict: CandidateScore["verdict"] } {
  const total = sumCriteria(criteria);
  const maxTotal = maxTotalInput ?? Math.max(total, 1);
  const normalized = maxTotal > 0 ? clamp(total / maxTotal, 0, 1) : 0;
  return { total, maxTotal, normalized, verdict: verdictOverride || verdictFor(normalized, policy) };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface RankRow {
  candidate: { id: string; status: CandidateStatus; createdAt: string; scores: string[] };
  best?: CandidateScore;
  normalized: number;
}

export function bestScore(scores: CandidateScore[]): CandidateScore | undefined {
  return [...scores].sort((left, right) => right.normalized - left.normalized || compareBytes(left.createdAt, right.createdAt))[0];
}

export function compareRankRows(left: RankRow, right: RankRow, policy: MergedCandidatePolicy): number {
  const byScore = right.normalized - left.normalized;
  if (byScore !== 0) return byScore;
  if (policy.tieBreaker === "candidateId") return compareBytes(left.candidate.id, right.candidate.id);
  const byCreated = compareBytes(left.candidate.createdAt, right.candidate.createdAt);
  return byCreated || compareBytes(left.candidate.id, right.candidate.id);
}

export interface CandidateRankingRow {
  candidateId: string;
  status: CandidateStatus;
  scoreCount: number;
  bestScoreId?: string;
  normalized: number;
  verdict?: CandidateScore["verdict"];
  rank: number;
}

export function detectTies(candidates: CandidateRankingRow[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const candidate of candidates) {
    const key = String(candidate.normalized);
    groups.set(key, [...(groups.get(key) || []), candidate.candidateId]);
  }
  return Array.from(groups.values()).filter((group) => group.length > 1);
}

export interface CandidateRanking {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  policy: MergedCandidatePolicy;
  candidates: CandidateRankingRow[];
  ties: string[][];
}

/** Ranks already-loaded candidates + their scores (loading/merging with
 *  disk is the shell's job). Sort: normalized desc, tie -> tieBreaker. */
export function rankCandidateRows(
  runId: string,
  now: string,
  candidates: Array<{ id: string; status: CandidateStatus; createdAt: string; scores: string[] }>,
  scoresByCandidate: (candidateId: string) => CandidateScore[],
  policy: MergedCandidatePolicy,
  includeRejected: boolean
): CandidateRanking {
  const rankable = candidates.filter((candidate) => includeRejected || candidate.status !== "rejected");
  const rows: RankRow[] = rankable.map((candidate) => {
    const scores = scoresByCandidate(candidate.id);
    const best = bestScore(scores);
    return { candidate, best, normalized: best?.normalized ?? 0 };
  });
  rows.sort((left, right) => compareRankRows(left, right, policy));
  const rankedCandidates: CandidateRankingRow[] = rows.map((row, index) => ({
    candidateId: row.candidate.id,
    status: row.candidate.status,
    scoreCount: row.candidate.scores.length,
    bestScoreId: row.best?.id,
    normalized: row.normalized,
    verdict: row.best?.verdict,
    rank: index + 1,
  }));
  return { schemaVersion: CANDIDATE_SCHEMA_VERSION, runId, createdAt: now, policy, candidates: rankedCandidates, ties: detectTies(rankedCandidates) };
}

// ---------------------------------------------------------------------------
// Selection gate — pure failure-list builder (byte-exact to selectCandidate's
// gate logic; review-gate errors are appended by the caller, since
// core/multi-agent/collaboration.ts's reviewGateErrors needs its own
// WorkflowRun-shaped state).
// ---------------------------------------------------------------------------

export function stateNodeError(code: string, message: string, options: { details?: Record<string, unknown> } = {}): StateNodeError {
  return { code, message, at: new Date().toISOString(), retryable: false, details: options.details };
}

export interface SelectionGateInput {
  candidateId: string;
  candidateStatus: CandidateStatus;
  policy: MergedCandidatePolicy;
  allowUnverified?: boolean;
  verifierNode?: StateNode;
  /** True when the verifier node's backing result was an empty capture —
   *  computed by the caller via core/pipeline/result-normalize.ts's
   *  isEmptyCapture over the backing task's result, since this file
   *  cannot look up tasks itself. */
  verifierNodeIsEmptyCapture: boolean;
  bestScoreNormalized: number | undefined;
}

/** Byte-exact port of selectCandidate's own gate ordering: not-selectable
 *  -> verifier-missing/no-evidence/empty-capture -> score-below-threshold.
 *  Review-gate errors are NOT included here; the caller appends them
 *  (v2/PLAN.md byte-compat / rebuild risk 8: append-only stacking, never
 *  replacing a verifier error). */
export function selectionGateFailures(input: SelectionGateInput): StateNodeError[] {
  const failures: StateNodeError[] = [];
  if (input.candidateStatus === "rejected" || input.candidateStatus === "failed") {
    failures.push(stateNodeError("candidate-not-selectable", `Candidate ${input.candidateId} is ${input.candidateStatus}`));
  }
  if (input.policy.requireVerifierGate && !input.allowUnverified) {
    if (!input.verifierNode || input.verifierNode.status !== "verified") {
      failures.push(stateNodeError("candidate-selection-missing-verifier", `Candidate ${input.candidateId} requires a verified verifier node`));
    } else if (!input.verifierNode.evidence.length) {
      failures.push(stateNodeError("candidate-selection-missing-evidence", `Candidate ${input.candidateId} verifier node has no evidence`));
    } else if (input.verifierNodeIsEmptyCapture) {
      failures.push(stateNodeError("candidate-selection-empty-capture", `Candidate ${input.candidateId} verifier node has no real evidence (empty-capture result)`));
    }
  }
  if (input.policy.minNormalized !== undefined && (input.bestScoreNormalized ?? 0) < input.policy.minNormalized) {
    failures.push(
      stateNodeError("candidate-selection-score-below-threshold", `Candidate ${input.candidateId} score is below threshold`, {
        details: { normalized: input.bestScoreNormalized ?? 0, minNormalized: input.policy.minNormalized },
      })
    );
  }
  return failures;
}

export function mergeById<T extends { id: string }>(left: T[], right: T[]): T[] {
  const merged = [...left];
  for (const item of right) {
    const index = merged.findIndex((entry) => entry.id === item.id);
    if (index >= 0) merged[index] = item;
    else merged.push(item);
  }
  return merged;
}

export function mergeEvidence(left: StateEvidence[], right: StateEvidence[]): StateEvidence[] {
  const merged = [...left];
  for (const item of right) {
    const index = merged.findIndex((entry) => entry.id === item.id && entry.source === item.source && entry.path === item.path && entry.locator === item.locator);
    if (index >= 0) merged[index] = item;
    else merged.push(item);
  }
  return merged;
}

export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}
