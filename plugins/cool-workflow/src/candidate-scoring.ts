import fs from "node:fs";
import path from "node:path";
import {
  CandidateRecord,
  CandidateRanking,
  CandidateScore,
  CandidateScoringOptions,
  CandidateScoringPolicy,
  CandidateSelection,
  CandidateStatus,
  CandidateKind,
  StateArtifact,
  StateEvidence,
  StateNode,
  StateNodeError,
  WorkflowRun
} from "./types";
import { recordFeedback } from "./error-feedback";
import { safeFileName, saveCheckpoint, writeJson } from "./state";
import { appendRunNode, createStateNode, linkStateNodes } from "./state-node";
import { buildAcceptanceRationale, normalizeEvidence, recordTrustAuditEvent } from "./trust-audit";
import { reviewGateErrors, selfActorIdsForCandidate } from "./collaboration";
import { compareBytes } from "./compare";

export const CANDIDATE_SCHEMA_VERSION = 1;

/** Verdict thresholds on a score's normalized value [0,1], declared once so the
 *  numbers carry intent instead of being buried as literals in verdictFor(). A
 *  normalized score at-or-above PASS is "pass"; at-or-above WARN (but below
 *  PASS) is "warn"; anything lower is "fail". Same numbers as before. */
const VERDICT_PASS_THRESHOLD = 0.7;
const VERDICT_WARN_THRESHOLD = 0.4;

export interface RegisterCandidateInput {
  id?: string;
  kind?: CandidateKind;
  workerId?: string;
  taskId?: string;
  resultNodeId?: string;
  verifierNodeId?: string;
  resultPath?: string;
  artifacts?: StateArtifact[];
  evidence?: StateEvidence[];
  metadata?: Record<string, unknown>;
}

export interface ListCandidatesOptions {
  status?: CandidateStatus;
  kind?: CandidateKind;
}

export interface ScoreCandidateInput {
  id?: string;
  scorer?: string;
  criteria: Record<string, number>;
  maxTotal?: number;
  verdict?: CandidateScore["verdict"];
  evidence?: StateEvidence[];
  artifacts?: StateArtifact[];
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface RankCandidatesOptions {
  policy?: CandidateScoringPolicy;
  includeRejected?: boolean;
}

export interface SelectCandidateOptions {
  selectedBy?: string;
  reason?: string;
  scoreId?: string;
  rankingPath?: string;
  allowUnverified?: boolean;
  metadata?: Record<string, unknown>;
}

export function createCandidateScoring(options: CandidateScoringOptions = {}) {
  return {
    registerCandidate: (run: WorkflowRun, input: RegisterCandidateInput) => registerCandidate(run, input, options),
    listCandidates: (run: WorkflowRun, listOptions?: ListCandidatesOptions) => listCandidates(run, listOptions),
    getCandidate,
    scoreCandidate: (run: WorkflowRun, candidateId: string, input: ScoreCandidateInput) =>
      scoreCandidate(run, candidateId, input, options),
    rankCandidates,
    selectCandidate: (run: WorkflowRun, candidateId: string, selectOptions?: SelectCandidateOptions) =>
      selectCandidate(run, candidateId, selectOptions, options),
    rejectCandidate: (run: WorkflowRun, candidateId: string, reason: string) =>
      rejectCandidate(run, candidateId, reason, options),
    summarizeCandidates
  };
}

export function registerCandidate(
  run: WorkflowRun,
  input: RegisterCandidateInput,
  options: CandidateScoringOptions = {}
): CandidateRecord {
  ensureCandidateState(run);
  const existing = input.id ? getCandidate(run, input.id) : undefined;
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = input.id || createCandidateId(input.kind || "manual", input.workerId || input.taskId || input.resultNodeId);
  const candidate: CandidateRecord = {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    id,
    runId: run.id,
    kind: input.kind || inferCandidateKind(input),
    status: "registered",
    createdAt: now,
    updatedAt: now,
    workerId: input.workerId,
    taskId: input.taskId,
    resultNodeId: input.resultNodeId,
    verifierNodeId: input.verifierNodeId,
    resultPath: input.resultPath,
    artifacts: input.artifacts || artifactsFromInput(input),
    evidence: normalizeEvidence(run, input.evidence || evidenceFromInput(run, input), {
      source: input.workerId ? "cw-validated" : "operator-recorded",
      workerId: input.workerId,
      taskId: input.taskId,
      resultNodeId: input.resultNodeId,
      verifierNodeId: input.verifierNodeId,
      candidateId: id
    }),
    scores: [],
    feedbackIds: [],
    metadata: compactMetadata(input.metadata || {})
  };
  upsertCandidate(run, candidate);
  recordTrustAuditEvent(run, {
    kind: "candidate.register",
    decision: "recorded",
    source: input.workerId ? "cw-validated" : "operator-recorded",
    workerId: input.workerId,
    taskId: input.taskId,
    nodeId: input.resultNodeId,
    candidateId: candidate.id,
    evidence: candidate.evidence,
    metadata: { kind: candidate.kind, verifierNodeId: candidate.verifierNodeId }
  });
  appendCandidateNode(run, candidate, "registered");
  if (shouldPersist(options)) saveCheckpoint(run);
  return candidate;
}

export function listCandidates(run: WorkflowRun, options: ListCandidatesOptions = {}): CandidateRecord[] {
  ensureCandidateState(run);
  const loaded = loadCandidatesFromDisk(run);
  run.candidates = mergeCandidates(run.candidates || [], loaded);
  return (run.candidates || []).filter((candidate) => {
    if (options.status && candidate.status !== options.status) return false;
    if (options.kind && candidate.kind !== options.kind) return false;
    return true;
  });
}

export function getCandidate(run: WorkflowRun, candidateId: string): CandidateRecord | undefined {
  ensureCandidateState(run);
  const existing = (run.candidates || []).find((candidate) => candidate.id === candidateId);
  if (existing) return existing;
  const file = candidateFile(run, candidateId);
  if (!fs.existsSync(file)) return undefined;
  const candidate = JSON.parse(fs.readFileSync(file, "utf8")) as CandidateRecord;
  upsertCandidate(run, candidate);
  return candidate;
}

export function scoreCandidate(
  run: WorkflowRun,
  candidateId: string,
  input: ScoreCandidateInput,
  options: CandidateScoringOptions = {}
): CandidateScore {
  const candidate = requireCandidate(run, candidateId);
  const scoreId = input.id || createScoreId(candidateId);
  const evidence = normalizeEvidence(run, input.evidence || [], {
    source: "operator-recorded",
    candidateId,
    scoreId
  });
  const policy = mergePolicy(options.policy);
  if (policy.requireEvidence && !evidence.length) {
    const feedback = recordCandidateFailure(run, candidate, "candidate-score-missing-evidence", {
      message: `Candidate ${candidateId} score requires evidence`,
      retryable: true
    });
    updateCandidate(run, {
      ...candidate,
      updatedAt: new Date().toISOString(),
      status: "failed",
      feedbackIds: unique([...(candidate.feedbackIds || []), feedback.id])
    });
    throw new Error(`Candidate ${candidateId} score requires evidence`);
  }
  const total = sumCriteria(input.criteria);
  const maxTotal = input.maxTotal ?? Math.max(total, 1);
  const normalized = maxTotal > 0 ? clamp(total / maxTotal, 0, 1) : 0;
  const score: CandidateScore = {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    id: scoreId,
    candidateId,
    runId: run.id,
    createdAt: new Date().toISOString(),
    scorer: input.scorer || "operator",
    criteria: input.criteria,
    total,
    maxTotal,
    normalized,
    verdict: input.verdict || verdictFor(normalized, policy),
    evidence,
    artifacts: input.artifacts || [],
    notes: input.notes,
    metadata: compactMetadata(input.metadata || {})
  };
  writeScore(run, candidateId, score);
  const updated = updateCandidate(run, {
    ...candidate,
    updatedAt: new Date().toISOString(),
    status: score.verdict === "fail" ? "failed" : "scored",
    scores: unique([...(candidate.scores || []), score.id]),
    evidence: mergeById(candidate.evidence, evidence),
    artifacts: mergeById(candidate.artifacts, score.artifacts)
  });
  const scoreAudit = recordTrustAuditEvent(run, {
    kind: "candidate.score",
    decision: score.verdict === "fail" ? "rejected" : "accepted",
    source: "operator-recorded",
    candidateId,
    scoreId: score.id,
    workerId: candidate.workerId,
    taskId: candidate.taskId,
    nodeId: candidate.verifierNodeId || candidate.resultNodeId,
    evidence: score.evidence,
    metadata: { criteria: score.criteria, normalized: score.normalized, verdict: score.verdict }
  });
  score.evidence = normalizeEvidence(run, score.evidence, {
    source: "operator-recorded",
    candidateId,
    scoreId: score.id,
    auditEventIds: [scoreAudit.id]
  });
  writeScore(run, candidateId, score);
  appendCandidateNode(run, updated, "scored", score);
  writeCandidateIndex(run);
  if (shouldPersist(options)) saveCheckpoint(run);
  return score;
}

export function rankCandidates(run: WorkflowRun, options: RankCandidatesOptions = {}): CandidateRanking {
  const policy = mergePolicy(options.policy);
  const rankable = listCandidates(run).filter((candidate) => options.includeRejected || candidate.status !== "rejected");
  const rows = rankable.map((candidate) => {
    const scores = readScores(run, candidate.id);
    const best = bestScore(scores);
    return {
      candidate,
      best,
      normalized: best?.normalized ?? 0
    };
  });
  rows.sort((left, right) => compareRows(left, right, policy));
  const candidates = rows.map((row, index) => ({
    candidateId: row.candidate.id,
    status: row.candidate.status,
    scoreCount: row.candidate.scores.length,
    bestScoreId: row.best?.id,
    normalized: row.normalized,
    verdict: row.best?.verdict,
    rank: index + 1
  }));
  const ranking: CandidateRanking = {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    runId: run.id,
    createdAt: new Date().toISOString(),
    policy,
    candidates,
    ties: detectTies(candidates)
  };
  writeJson(rankingPath(run), ranking);
  return ranking;
}

export function selectCandidate(
  run: WorkflowRun,
  candidateId: string,
  options: SelectCandidateOptions = {},
  scoringOptions: CandidateScoringOptions = {}
): CandidateSelection {
  const candidate = requireCandidate(run, candidateId);
  const policy = mergePolicy(scoringOptions.policy);
  const ranking = rankCandidates(run, { policy });
  const ranked = ranking.candidates.find((entry) => entry.candidateId === candidateId);
  const verifierNode = candidate.verifierNodeId
    ? run.nodes?.find((node) => node.id === candidate.verifierNodeId)
    : undefined;
  const bestScore = options.scoreId
    ? readScores(run, candidateId).find((score) => score.id === options.scoreId)
    : readScores(run, candidateId).find((score) => score.id === ranked?.bestScoreId);

  const failures: StateNodeError[] = [];
  if (candidate.status === "rejected" || candidate.status === "failed") {
    failures.push(error("candidate-not-selectable", `Candidate ${candidateId} is ${candidate.status}`));
  }
  if (policy.requireVerifierGate && !options.allowUnverified) {
    if (!verifierNode || verifierNode.status !== "verified") {
      failures.push(error("candidate-selection-missing-verifier", `Candidate ${candidateId} requires a verified verifier node`));
    } else if (!verifierNode.evidence.length) {
      failures.push(error("candidate-selection-missing-evidence", `Candidate ${candidateId} verifier node has no evidence`));
    } else if (emptyCaptureWarning(run, verifierNode)) {
      // HARD no-false-green gate (v0.1.43) — kept in SYNC with the commit gate
      // (commit.ts emptyCaptureWarning): a verifier node whose backing result was
      // an empty-capture must not be selectable, so selection + commit agree.
      failures.push(error("candidate-selection-empty-capture", `Candidate ${candidateId} verifier node has no real evidence (empty-capture result)`));
    }
  }
  if (policy.minNormalized !== undefined && (bestScore?.normalized ?? 0) < policy.minNormalized) {
    failures.push(error("candidate-selection-score-below-threshold", `Candidate ${candidateId} score is below threshold`, {
      details: { normalized: bestScore?.normalized ?? 0, minNormalized: policy.minNormalized }
    }));
  }
  // REVIEW GATE on selection — POLICY layered on the verifier gate above, never
  // replacing it. Empty unless a review policy applies to "selection"; fails
  // closed when required approvals from authorized roles are missing.
  for (const reviewError of reviewGateErrors(run, {
    targetKind: "selection",
    candidateId,
    selfActorIds: selfActorIdsForCandidate(run, candidateId)
  })) {
    failures.push(reviewError);
  }
  if (failures.length) {
    const feedbackIds = failures.map((failure) =>
      recordCandidateFailure(run, candidate, failure.code, {
        message: failure.message,
        retryable: false,
        details: failure.details
      }).id
    );
    updateCandidate(run, {
      ...candidate,
      updatedAt: new Date().toISOString(),
      status: "failed",
      feedbackIds: unique([...(candidate.feedbackIds || []), ...feedbackIds])
    });
    if (shouldPersist(scoringOptions)) saveCheckpoint(run);
    throw new Error(failures.map((failure) => failure.message).join("; "));
  }

  const now = new Date().toISOString();
  const selection: CandidateSelection = {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    id: createSelectionId(candidateId),
    runId: run.id,
    candidateId,
    selectedAt: now,
    selectedBy: options.selectedBy || "operator",
    verifierNodeId: candidate.verifierNodeId,
    scoreId: bestScore?.id,
    rankingPath: options.rankingPath || rankingPath(run),
    reason: options.reason || "selected candidate",
    evidence: normalizeEvidence(run, mergeEvidence(candidate.evidence, verifierNode?.evidence || []), {
      source: "cw-validated",
      workerId: candidate.workerId,
      taskId: candidate.taskId,
      resultNodeId: candidate.resultNodeId,
      verifierNodeId: candidate.verifierNodeId,
      candidateId,
      scoreId: bestScore?.id
    }),
    artifacts: candidate.artifacts,
    feedbackIds: [],
    acceptanceRationale: buildAcceptanceRationale({
      selectedCandidateId: candidateId,
      scoreId: bestScore?.id,
      scoreCriteria: bestScore?.criteria,
      verifierNodeId: candidate.verifierNodeId,
      evidenceCount: mergeEvidence(candidate.evidence, verifierNode?.evidence || []).length,
      sandboxProfileId: sandboxProfileForCandidate(run, candidate),
      workerId: candidate.workerId,
      commitGateResult: "passed"
    }),
    metadata: compactMetadata({
      ...(options.metadata || {}),
      rank: ranked?.rank,
      normalized: bestScore?.normalized
    })
  };
  const selectionAudit = recordTrustAuditEvent(run, {
    kind: "candidate.selection",
    decision: "accepted",
    source: "cw-validated",
    workerId: candidate.workerId,
    taskId: candidate.taskId,
    nodeId: candidate.verifierNodeId,
    candidateId,
    scoreId: bestScore?.id,
    selectionId: selection.id,
    sandboxProfileId: selection.acceptanceRationale?.sandboxProfileId,
    evidence: selection.evidence,
    metadata: selection.acceptanceRationale as unknown as Record<string, unknown>
  });
  selection.evidence = normalizeEvidence(run, selection.evidence, {
    source: "cw-validated",
    workerId: candidate.workerId,
    taskId: candidate.taskId,
    resultNodeId: candidate.resultNodeId,
    verifierNodeId: candidate.verifierNodeId,
    candidateId,
    scoreId: bestScore?.id,
    selectionId: selection.id,
    auditEventIds: [selectionAudit.id]
  });
  selection.acceptanceRationale = buildAcceptanceRationale({
    ...selection.acceptanceRationale,
    auditEventIds: [selectionAudit.id]
  });
  run.candidateSelections = [...(run.candidateSelections || []), selection];
  writeSelection(run, selection);
  const updated = updateCandidate(run, {
    ...candidate,
    updatedAt: now,
    status: verifierNode?.status === "verified" ? "verified" : "selected",
    selectedAt: now,
    evidence: selection.evidence
  });
  appendSelectionNode(run, updated, selection);
  writeCandidateIndex(run);
  if (shouldPersist(scoringOptions)) saveCheckpoint(run);
  return selection;
}

export function rejectCandidate(
  run: WorkflowRun,
  candidateId: string,
  reason: string,
  options: CandidateScoringOptions = {}
): CandidateRecord {
  const candidate = requireCandidate(run, candidateId);
  const feedback = recordCandidateFailure(run, candidate, "candidate-rejected", {
    message: reason || `Candidate ${candidateId} rejected`,
    retryable: false
  });
  const updated = updateCandidate(run, {
    ...candidate,
    updatedAt: new Date().toISOString(),
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    feedbackIds: unique([...(candidate.feedbackIds || []), feedback.id])
  });
  appendCandidateNode(run, updated, "rejected");
  if (shouldPersist(options)) saveCheckpoint(run);
  return updated;
}

export function summarizeCandidates(run: WorkflowRun): {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  indexPath: string;
  rankingPath: string;
  selections: number;
} {
  const candidates = listCandidates(run);
  return {
    total: candidates.length,
    byStatus: countBy(candidates, (candidate) => candidate.status),
    byKind: countBy(candidates, (candidate) => candidate.kind),
    indexPath: indexPath(run),
    rankingPath: rankingPath(run),
    selections: (run.candidateSelections || []).length
  };
}

function ensureCandidateState(run: WorkflowRun): void {
  run.paths.candidatesDir = run.paths.candidatesDir || path.join(run.paths.runDir, "candidates");
  fs.mkdirSync(run.paths.candidatesDir, { recursive: true });
  run.candidates = run.candidates || [];
  run.candidateSelections = run.candidateSelections || [];
}

function upsertCandidate(run: WorkflowRun, candidate: CandidateRecord): CandidateRecord {
  ensureCandidateState(run);
  const candidates = run.candidates || [];
  const index = candidates.findIndex((entry) => entry.id === candidate.id);
  run.candidates = index >= 0 ? candidates.map((entry) => (entry.id === candidate.id ? candidate : entry)) : [...candidates, candidate];
  writeCandidate(run, candidate);
  writeCandidateIndex(run);
  return candidate;
}

function updateCandidate(run: WorkflowRun, candidate: CandidateRecord): CandidateRecord {
  return upsertCandidate(run, candidate);
}

function requireCandidate(run: WorkflowRun, candidateId: string): CandidateRecord {
  const candidate = getCandidate(run, candidateId);
  if (!candidate) throw new Error(`Unknown candidate for run ${run.id}: ${candidateId}`);
  return candidate;
}

function appendCandidateNode(run: WorkflowRun, candidate: CandidateRecord, stage: string, score?: CandidateScore): void {
  const parents = [candidate.resultNodeId, candidate.verifierNodeId].filter(Boolean) as string[];
  const node = appendRunNode(
    run,
    createStateNode({
      id: `${run.id}:candidate:${safeFileName(candidate.id)}:${stage}`,
      kind: "candidate",
      status: candidate.status === "failed" ? "failed" : candidate.status === "verified" ? "verified" : "completed",
      loopStage: stage === "registered" ? "observe" : "adjust",
      inputs: { candidateId: candidate.id, workerId: candidate.workerId, taskId: candidate.taskId },
      outputs: compactMetadata({
        status: candidate.status,
        scoreId: score?.id,
        normalized: score?.normalized,
        verdict: score?.verdict
      }) || {},
      artifacts: candidateArtifacts(run, candidate),
      evidence: candidate.evidence,
      parents,
      metadata: { candidateId: candidate.id, stage, kind: candidate.kind }
    })
  );
  for (const parentId of parents) {
    const parent = run.nodes?.find((candidateNode) => candidateNode.id === parentId);
    if (!parent) continue;
    const linked = linkStateNodes(parent, node);
    appendRunNode(run, linked[0]);
    appendRunNode(run, linked[1]);
  }
}

function appendSelectionNode(run: WorkflowRun, candidate: CandidateRecord, selection: CandidateSelection): void {
  const parentIds = [candidate.verifierNodeId, `${run.id}:candidate:${safeFileName(candidate.id)}:scored`].filter(Boolean) as string[];
  const node = appendRunNode(
    run,
    createStateNode({
      id: `${run.id}:candidate:${safeFileName(candidate.id)}:selection:${safeFileName(selection.id)}`,
      kind: "candidate",
      status: candidate.status === "verified" ? "verified" : "completed",
      loopStage: "adjust",
      inputs: { candidateId: candidate.id, selectionId: selection.id },
      outputs: selection as unknown as Record<string, unknown>,
      artifacts: selection.artifacts,
      evidence: selection.evidence,
      parents: parentIds,
      metadata: { candidateId: candidate.id, selectionId: selection.id, selected: true }
    })
  );
  for (const parentId of parentIds) {
    const parent = run.nodes?.find((candidateNode) => candidateNode.id === parentId);
    if (!parent) continue;
    const linked = linkStateNodes(parent, node);
    appendRunNode(run, linked[0]);
    appendRunNode(run, linked[1]);
  }
}

function recordCandidateFailure(
  run: WorkflowRun,
  candidate: CandidateRecord,
  code: string,
  options: { message: string; retryable: boolean; details?: Record<string, unknown> }
) {
  return recordFeedback(
    run,
    {
      source: "verifier",
      error: {
        code,
        message: options.message,
        at: new Date().toISOString(),
        retryable: options.retryable,
        details: compactMetadata({
          ...(options.details || {}),
          candidateId: candidate.id,
          workerId: candidate.workerId,
          taskId: candidate.taskId
        })
      },
      taskId: candidate.taskId,
      retryable: options.retryable,
      evidence: candidate.evidence,
      artifacts: candidateArtifacts(run, candidate),
      metadata: { candidateId: candidate.id, workerId: candidate.workerId, resultNodeId: candidate.resultNodeId }
    },
    { persist: false }
  );
}

function writeCandidate(run: WorkflowRun, candidate: CandidateRecord): void {
  writeJson(candidateFile(run, candidate.id), candidate);
}

function writeScore(run: WorkflowRun, candidateId: string, score: CandidateScore): void {
  writeJson(path.join(candidateDir(run, candidateId), "scores", `${safeFileName(score.id)}.json`), score);
}

function writeSelection(run: WorkflowRun, selection: CandidateSelection): void {
  writeJson(path.join(candidateRoot(run), "selections", `${safeFileName(selection.id)}.json`), selection);
}

function writeCandidateIndex(run: WorkflowRun): void {
  ensureCandidateState(run);
  writeJson(indexPath(run), {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    runId: run.id,
    candidates: (run.candidates || []).map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      status: candidate.status,
      workerId: candidate.workerId,
      taskId: candidate.taskId,
      resultNodeId: candidate.resultNodeId,
      verifierNodeId: candidate.verifierNodeId,
      resultPath: candidate.resultPath,
      scores: candidate.scores,
      feedbackIds: candidate.feedbackIds
    })),
    selections: run.candidateSelections || []
  });
}

function loadCandidatesFromDisk(run: WorkflowRun): CandidateRecord[] {
  ensureCandidateState(run);
  return fs
    .readdirSync(candidateRoot(run), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "selections")
    .map((entry) => path.join(candidateRoot(run), entry.name, "candidate.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as CandidateRecord);
}

function readScores(run: WorkflowRun, candidateId: string): CandidateScore[] {
  const dir = path.join(candidateDir(run, candidateId), "scores");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as CandidateScore);
}

function candidateArtifacts(run: WorkflowRun, candidate: CandidateRecord): StateArtifact[] {
  return [
    { id: "candidate", kind: "json", path: candidateFile(run, candidate.id) },
    ...candidate.artifacts
  ];
}

function artifactsFromInput(input: RegisterCandidateInput): StateArtifact[] {
  const artifacts: StateArtifact[] = [];
  if (input.resultPath) artifacts.push({ id: "result", kind: "markdown", path: path.resolve(input.resultPath) });
  return artifacts;
}

function evidenceFromInput(run: WorkflowRun, input: RegisterCandidateInput): StateEvidence[] {
  const resultNode = input.resultNodeId ? run.nodes?.find((node) => node.id === input.resultNodeId) : undefined;
  const verifierNode = input.verifierNodeId ? run.nodes?.find((node) => node.id === input.verifierNodeId) : undefined;
  return mergeById(resultNode?.evidence || [], verifierNode?.evidence || []);
}

function inferCandidateKind(input: RegisterCandidateInput): CandidateKind {
  if (input.workerId) return "worker-output";
  if (input.resultNodeId || input.resultPath) return "result";
  return "manual";
}

function bestScore(scores: CandidateScore[]): CandidateScore | undefined {
  return [...scores].sort((left, right) => right.normalized - left.normalized || compareBytes(left.createdAt, right.createdAt))[0];
}

function compareRows(
  left: { candidate: CandidateRecord; best?: CandidateScore; normalized: number },
  right: { candidate: CandidateRecord; best?: CandidateScore; normalized: number },
  policy: ReturnType<typeof mergePolicy>
): number {
  const byScore = right.normalized - left.normalized;
  if (byScore !== 0) return byScore;
  if (policy.tieBreaker === "candidateId") return compareBytes(left.candidate.id, right.candidate.id);
  const byCreated = compareBytes(left.candidate.createdAt, right.candidate.createdAt);
  return byCreated || compareBytes(left.candidate.id, right.candidate.id);
}

function detectTies(candidates: CandidateRanking["candidates"]): string[][] {
  const groups = new Map<string, string[]>();
  for (const candidate of candidates) {
    const key = String(candidate.normalized);
    groups.set(key, [...(groups.get(key) || []), candidate.candidateId]);
  }
  return Array.from(groups.values()).filter((group) => group.length > 1);
}

function mergePolicy(policy: CandidateScoringPolicy = {}) {
  // NOTE: `policy.criteria` (string[]) is intentionally NOT carried here. A
  // whole-repo grep shows it has no read points — scoring reads each score's
  // own `input.criteria` (Record<string, number>), not this list. Emitting a
  // default `criteria: []` advertised a guarantee the code never honored and
  // could silently drift, so it is dropped. The field stays OPTIONAL on
  // CandidateScoringPolicy / CandidateRanking.policy for forward-compat input.
  return {
    id: policy.id || "cw.candidate.default",
    title: policy.title || "Default Candidate Scoring",
    requireEvidence: policy.requireEvidence ?? true,
    requireVerifierGate: policy.requireVerifierGate ?? true,
    minNormalized: policy.minNormalized,
    tieBreaker: policy.tieBreaker || "createdAt"
  };
}

function verdictFor(normalized: number, policy: ReturnType<typeof mergePolicy>): CandidateScore["verdict"] {
  if (policy.minNormalized !== undefined && normalized < policy.minNormalized) return "fail";
  if (normalized >= VERDICT_PASS_THRESHOLD) return "pass";
  if (normalized >= VERDICT_WARN_THRESHOLD) return "warn";
  return "fail";
}

function sumCriteria(criteria: Record<string, number>): number {
  return Object.values(criteria).reduce((total, value) => total + Number(value || 0), 0);
}

function candidateRoot(run: WorkflowRun): string {
  ensureCandidateState(run);
  return run.paths.candidatesDir || path.join(run.paths.runDir, "candidates");
}

function candidateDir(run: WorkflowRun, candidateId: string): string {
  return path.join(candidateRoot(run), safeFileName(candidateId));
}

function candidateFile(run: WorkflowRun, candidateId: string): string {
  return path.join(candidateDir(run, candidateId), "candidate.json");
}

function indexPath(run: WorkflowRun): string {
  return path.join(candidateRoot(run), "index.json");
}

function rankingPath(run: WorkflowRun): string {
  return path.join(candidateRoot(run), "ranking.json");
}

function createCandidateId(kind: CandidateKind, seed?: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `candidate-${safeFileName(kind)}-${seed ? `${safeFileName(seed)}-` : ""}${stamp}-${suffix}`;
}

function createScoreId(candidateId: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `score-${safeFileName(candidateId)}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function createSelectionId(candidateId: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `selection-${safeFileName(candidateId)}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function shouldPersist(options: CandidateScoringOptions): boolean {
  return options.persist !== false;
}

function error(code: string, message: string, options: { details?: Record<string, unknown> } = {}): StateNodeError {
  return {
    code,
    message,
    at: new Date().toISOString(),
    retryable: false,
    details: options.details
  };
}

/** HARD no-false-green gate (v0.1.43) — kept in SYNC with commit.ts. Traces a
 *  verifier node back to its source result node and returns the empty-capture
 *  marker (set at ingest via isEmptyCapture) when present. Reads ONLY persisted
 *  state, so selection replays deterministically. */
function emptyCaptureWarning(run: WorkflowRun, verifierNode: StateNode): string | undefined {
  const resultNodeId =
    (typeof verifierNode.inputs?.inputNodeId === "string" ? (verifierNode.inputs.inputNodeId as string) : undefined) ||
    verifierNode.parents[0];
  const resultNode = resultNodeId ? run.nodes?.find((node) => node.id === resultNodeId) : undefined;
  const warning = resultNode?.metadata?.captureWarning;
  return typeof warning === "string" && warning ? warning : undefined;
}

function mergeCandidates(left: CandidateRecord[], right: CandidateRecord[]): CandidateRecord[] {
  const merged = [...left];
  for (const candidate of right) {
    const index = merged.findIndex((entry) => entry.id === candidate.id);
    if (index >= 0) merged[index] = candidate;
    else merged.push(candidate);
  }
  return merged;
}

function mergeById<T extends { id: string }>(left: T[], right: T[]): T[] {
  const merged = [...left];
  for (const item of right) {
    const index = merged.findIndex((entry) => entry.id === item.id);
    if (index >= 0) merged[index] = item;
    else merged.push(item);
  }
  return merged;
}

function mergeEvidence(left: StateEvidence[], right: StateEvidence[]): StateEvidence[] {
  const merged = [...left];
  for (const item of right) {
    const index = merged.findIndex(
      (entry) =>
        entry.id === item.id &&
        entry.source === item.source &&
        entry.path === item.path &&
        entry.locator === item.locator
    );
    if (index >= 0) merged[index] = item;
    else merged.push(item);
  }
  return merged;
}

function sandboxProfileForCandidate(run: WorkflowRun, candidate: CandidateRecord): string | undefined {
  const worker = candidate.workerId ? (run.workers || []).find((entry) => entry.id === candidate.workerId) : undefined;
  if (worker?.sandboxProfileId) return worker.sandboxProfileId;
  const task = candidate.taskId ? (run.tasks || []).find((entry) => entry.id === candidate.taskId) : undefined;
  return task?.sandboxProfileId;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function compactMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}
