// shell/candidate-scoring-io.ts — the impure wrapper around
// core/multi-agent/candidate-scoring.ts's pure decision math:
// registerCandidate/scoreCandidate/rankCandidates/selectCandidate/
// rejectCandidate/summarizeCandidates.
//
// MILESTONE 9. Byte-exact port of the impure half of the old build's
// candidate-scoring module: disk reads/writes, trust-audit calls,
// feedback recording, review-gate stacking, and saveCheckpoint.
//
// BYTE-COMPAT / REBUILD RISK 8 [load-bearing]: the review gate STACKS on
// top of the verifier-gate failures built here — reviewGateErrors is
// appended, never replacing a verifier error. See
// reviewstack-verifier-error-precedence.case.js.
//
// Evidence: SPEC/multi-agent.md section E; the old build's
// candidate-scoring module (byte-exact source for the wiring sequence).

import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, safeFileName, writeJson } from "./fs-atomic";
import { saveCheckpoint } from "./run-store";
import { StateArtifact, StateEvidence, StateNodeError, WorkflowRun } from "../core/state/types";
import { appendRunNode } from "./node-store";
import { createStateNode, linkStateNodes } from "../core/state/state-node";
import { normalizeEvidence, recordTrustAuditEvent } from "./trust-audit";
import { recordFeedback } from "./error-feedback-io";
import * as cs from "../core/multi-agent/candidate-scoring";
import { isEmptyCapture, ResultEnvelope } from "../core/pipeline/result-normalize";
import { reviewGateErrors as pureReviewGateErrors, ApprovalRecord, selfActorIdsForCandidate as pureSelfActorIdsForCandidate } from "../core/multi-agent/collaboration";
import { ensureCollaborationState } from "./collaboration-io";

function now(): string {
  return new Date().toISOString();
}

function ensureCandidateState(run: WorkflowRun): void {
  run.paths.candidatesDir = run.paths.candidatesDir || path.join(run.paths.runDir, "candidates");
  run.candidates = (run.candidates as cs.CandidateRecord[] | undefined) || [];
  run.candidateSelections = (run.candidateSelections as unknown[] | undefined) || [];
}

function candidateRoot(run: WorkflowRun): string {
  ensureCandidateState(run);
  return run.paths.candidatesDir as string;
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

function writeCandidate(run: WorkflowRun, candidate: cs.CandidateRecord): void {
  writeJson(candidateFile(run, candidate.id), candidate);
}
function writeScoreFile(run: WorkflowRun, candidateId: string, score: cs.CandidateScore): void {
  writeJson(path.join(candidateDir(run, candidateId), "scores", `${safeFileName(score.id)}.json`), score);
}
function writeSelectionFile(run: WorkflowRun, selection: cs.CandidateSelection): void {
  writeJson(path.join(candidateRoot(run), "selections", `${safeFileName(selection.id)}.json`), selection);
}
function writeCandidateIndex(run: WorkflowRun): void {
  ensureCandidateState(run);
  writeJson(indexPath(run), {
    schemaVersion: cs.CANDIDATE_SCHEMA_VERSION,
    runId: run.id,
    candidates: ((run.candidates as cs.CandidateRecord[] | undefined) || []).map((candidate) => ({ id: candidate.id, kind: candidate.kind, status: candidate.status, workerId: candidate.workerId, taskId: candidate.taskId, resultNodeId: candidate.resultNodeId, verifierNodeId: candidate.verifierNodeId, resultPath: candidate.resultPath, scores: candidate.scores, feedbackIds: candidate.feedbackIds })),
    selections: run.candidateSelections || [],
  });
}

function upsertCandidate(run: WorkflowRun, candidate: cs.CandidateRecord): cs.CandidateRecord {
  ensureCandidateState(run);
  const candidates = (run.candidates as cs.CandidateRecord[]) || [];
  const index = candidates.findIndex((entry) => entry.id === candidate.id);
  run.candidates = (index >= 0 ? candidates.map((entry) => (entry.id === candidate.id ? candidate : entry)) : [...candidates, candidate]) as unknown as WorkflowRun["candidates"];
  writeCandidate(run, candidate);
  writeCandidateIndex(run);
  return candidate;
}

function loadCandidatesFromDisk(run: WorkflowRun): cs.CandidateRecord[] {
  ensureCandidateState(run);
  const root = candidateRoot(run);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "selections")
    .map((entry) => path.join(root, entry.name, "candidate.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => readJson(file) as cs.CandidateRecord);
}

function mergeCandidates(left: cs.CandidateRecord[], right: cs.CandidateRecord[]): cs.CandidateRecord[] {
  const merged = [...left];
  for (const candidate of right) {
    const index = merged.findIndex((entry) => entry.id === candidate.id);
    if (index >= 0) merged[index] = candidate;
    else merged.push(candidate);
  }
  return merged;
}

export function getCandidate(run: WorkflowRun, candidateId: string): cs.CandidateRecord | undefined {
  ensureCandidateState(run);
  const existing = ((run.candidates as cs.CandidateRecord[] | undefined) || []).find((candidate) => candidate.id === candidateId);
  if (existing) return existing;
  const file = candidateFile(run, candidateId);
  if (!fs.existsSync(file)) return undefined;
  const candidate = readJson(file) as cs.CandidateRecord;
  upsertCandidate(run, candidate);
  return candidate;
}

function requireCandidate(run: WorkflowRun, candidateId: string): cs.CandidateRecord {
  const candidate = getCandidate(run, candidateId);
  if (!candidate) throw new Error(`Unknown candidate for run ${run.id}: ${candidateId}`);
  return candidate;
}

export function listCandidates(run: WorkflowRun, options: { status?: cs.CandidateStatus; kind?: cs.CandidateKind } = {}): cs.CandidateRecord[] {
  ensureCandidateState(run);
  const loaded = loadCandidatesFromDisk(run);
  run.candidates = mergeCandidates((run.candidates as cs.CandidateRecord[]) || [], loaded) as unknown as WorkflowRun["candidates"];
  return ((run.candidates as cs.CandidateRecord[]) || []).filter((candidate) => {
    if (options.status && candidate.status !== options.status) return false;
    if (options.kind && candidate.kind !== options.kind) return false;
    return true;
  });
}

function candidateArtifacts(run: WorkflowRun, candidate: cs.CandidateRecord): StateArtifact[] {
  return [{ id: "candidate", kind: "json", path: candidateFile(run, candidate.id) }, ...candidate.artifacts];
}

function appendCandidateNode(run: WorkflowRun, candidate: cs.CandidateRecord, stage: string, score?: cs.CandidateScore): void {
  const parents = [candidate.resultNodeId, candidate.verifierNodeId].filter(Boolean) as string[];
  const outputs: Record<string, unknown> = {};
  if (candidate.status !== undefined) outputs.status = candidate.status;
  if (score?.id !== undefined) outputs.scoreId = score.id;
  if (score?.normalized !== undefined) outputs.normalized = score.normalized;
  if (score?.verdict !== undefined) outputs.verdict = score.verdict;
  const node = appendRunNode(
    run,
    createStateNode({
      id: `${run.id}:candidate:${safeFileName(candidate.id)}:${stage}`,
      kind: "candidate",
      status: candidate.status === "failed" ? "failed" : candidate.status === "verified" ? "verified" : "completed",
      loopStage: stage === "registered" ? "observe" : "adjust",
      inputs: { candidateId: candidate.id, workerId: candidate.workerId, taskId: candidate.taskId },
      outputs,
      artifacts: candidateArtifacts(run, candidate),
      evidence: candidate.evidence,
      parents,
      metadata: { candidateId: candidate.id, stage, kind: candidate.kind },
    })
  );
  for (const parentId of parents) {
    const parent = (run.nodes || []).find((candidateNode) => candidateNode.id === parentId);
    if (!parent) continue;
    const linked = linkStateNodes(parent, node);
    appendRunNode(run, linked[0]);
    appendRunNode(run, linked[1]);
  }
}

function appendSelectionNode(run: WorkflowRun, candidate: cs.CandidateRecord, selection: cs.CandidateSelection): void {
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
      metadata: { candidateId: candidate.id, selectionId: selection.id, selected: true },
    })
  );
  for (const parentId of parentIds) {
    const parent = (run.nodes || []).find((candidateNode) => candidateNode.id === parentId);
    if (!parent) continue;
    const linked = linkStateNodes(parent, node);
    appendRunNode(run, linked[0]);
    appendRunNode(run, linked[1]);
  }
}

function recordCandidateFailure(run: WorkflowRun, candidate: cs.CandidateRecord, code: string, options: { message: string; retryable: boolean; details?: Record<string, unknown> }): { id: string } {
  return recordFeedback(
    run,
    {
      source: "verifier",
      error: { code, message: options.message, at: now(), retryable: options.retryable, details: { ...(options.details || {}), candidateId: candidate.id, workerId: candidate.workerId, taskId: candidate.taskId } },
      taskId: candidate.taskId,
      retryable: options.retryable,
      evidence: candidate.evidence,
      artifacts: candidateArtifacts(run, candidate),
      metadata: { candidateId: candidate.id, workerId: candidate.workerId, resultNodeId: candidate.resultNodeId },
    },
    { persist: false }
  );
}

export interface RegisterCandidateInput {
  id?: string;
  kind?: cs.CandidateKind;
  workerId?: string;
  taskId?: string;
  resultNodeId?: string;
  verifierNodeId?: string;
  resultPath?: string;
  artifacts?: StateArtifact[];
  evidence?: StateEvidence[];
  metadata?: Record<string, unknown>;
}

function artifactsFromInput(input: RegisterCandidateInput): StateArtifact[] {
  const artifacts: StateArtifact[] = [];
  if (input.resultPath) artifacts.push({ id: "result", kind: "markdown", path: path.resolve(input.resultPath) });
  return artifacts;
}

function evidenceFromInput(run: WorkflowRun, input: RegisterCandidateInput): StateEvidence[] {
  const resultNode = input.resultNodeId ? (run.nodes || []).find((node) => node.id === input.resultNodeId) : undefined;
  const verifierNode = input.verifierNodeId ? (run.nodes || []).find((node) => node.id === input.verifierNodeId) : undefined;
  return cs.mergeById(resultNode?.evidence || [], verifierNode?.evidence || []);
}

export function registerCandidate(run: WorkflowRun, input: RegisterCandidateInput, options: { persist?: boolean } = {}): cs.CandidateRecord {
  ensureCandidateState(run);
  const existing = input.id ? getCandidate(run, input.id) : undefined;
  if (existing) return existing;
  const stamp = now();
  const id = input.id || cs.createCandidateId(((run.candidates as cs.CandidateRecord[]) || []).length, input.kind || "manual", input.workerId || input.taskId || input.resultNodeId);
  const candidate: cs.CandidateRecord = {
    schemaVersion: cs.CANDIDATE_SCHEMA_VERSION,
    id,
    runId: run.id,
    kind: input.kind || cs.inferCandidateKind(input),
    status: "registered",
    createdAt: stamp,
    updatedAt: stamp,
    workerId: input.workerId,
    taskId: input.taskId,
    resultNodeId: input.resultNodeId,
    verifierNodeId: input.verifierNodeId,
    resultPath: input.resultPath,
    artifacts: input.artifacts || artifactsFromInput(input),
    evidence: normalizeEvidence(run, input.evidence || evidenceFromInput(run, input), { source: input.workerId ? "cw-validated" : "operator-recorded", workerId: input.workerId, taskId: input.taskId, resultNodeId: input.resultNodeId, verifierNodeId: input.verifierNodeId, candidateId: id }),
    scores: [],
    feedbackIds: [],
    metadata: compactMetadata(input.metadata || {}),
  };
  upsertCandidate(run, candidate);
  recordTrustAuditEvent(run, { kind: "candidate.register", decision: "recorded", source: input.workerId ? "cw-validated" : "operator-recorded", workerId: input.workerId, taskId: input.taskId, nodeId: input.resultNodeId, candidateId: candidate.id, evidence: candidate.evidence, metadata: { kind: candidate.kind, verifierNodeId: candidate.verifierNodeId } });
  appendCandidateNode(run, candidate, "registered");
  if (options.persist !== false) saveCheckpoint(run);
  return candidate;
}

function compactMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export interface ScoreCandidateInput {
  id?: string;
  scorer?: string;
  criteria: Record<string, number>;
  maxTotal?: number;
  verdict?: cs.CandidateScore["verdict"];
  evidence?: StateEvidence[];
  artifacts?: StateArtifact[];
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function scoreCandidate(run: WorkflowRun, candidateId: string, input: ScoreCandidateInput, options: { persist?: boolean; policy?: cs.CandidateScoringPolicy } = {}): cs.CandidateScore {
  const candidate = requireCandidate(run, candidateId);
  const scoreId = input.id || cs.createScoreId(candidate);
  const evidence = normalizeEvidence(run, input.evidence || [], { source: "operator-recorded", candidateId, scoreId });
  const policy = cs.mergePolicy(options.policy);
  if (policy.requireEvidence && !evidence.length) {
    const feedback = recordCandidateFailure(run, candidate, "candidate-score-missing-evidence", { message: `Candidate ${candidateId} score requires evidence`, retryable: true });
    upsertCandidate(run, { ...candidate, updatedAt: now(), status: "failed", feedbackIds: cs.unique([...(candidate.feedbackIds || []), feedback.id]) });
    throw new Error(`Candidate ${candidateId} score requires evidence`);
  }
  const math = cs.computeScoreMath(input.criteria, input.maxTotal, policy, input.verdict);
  const score: cs.CandidateScore = {
    schemaVersion: cs.CANDIDATE_SCHEMA_VERSION,
    id: scoreId,
    candidateId,
    runId: run.id,
    createdAt: now(),
    scorer: input.scorer || "operator",
    criteria: input.criteria,
    total: math.total,
    maxTotal: math.maxTotal,
    normalized: math.normalized,
    verdict: math.verdict,
    evidence,
    artifacts: input.artifacts || [],
    notes: input.notes,
    metadata: compactMetadata(input.metadata || {}),
  };
  writeScoreFile(run, candidateId, score);
  const updated = upsertCandidate(run, { ...candidate, updatedAt: now(), status: score.verdict === "fail" ? "failed" : "scored", scores: cs.unique([...(candidate.scores || []), score.id]), evidence: cs.mergeById(candidate.evidence, evidence), artifacts: cs.mergeById(candidate.artifacts, score.artifacts) });
  const scoreAudit = recordTrustAuditEvent(run, { kind: "candidate.score", decision: score.verdict === "fail" ? "rejected" : "accepted", source: "operator-recorded", candidateId, scoreId: score.id, workerId: candidate.workerId, taskId: candidate.taskId, nodeId: candidate.verifierNodeId || candidate.resultNodeId, evidence: score.evidence, metadata: { criteria: score.criteria, normalized: score.normalized, verdict: score.verdict } });
  score.evidence = normalizeEvidence(run, score.evidence, { source: "operator-recorded", candidateId, scoreId: score.id, auditEventIds: [scoreAudit.id] });
  writeScoreFile(run, candidateId, score);
  appendCandidateNode(run, updated, "scored", score);
  writeCandidateIndex(run);
  if (options.persist !== false) saveCheckpoint(run);
  return score;
}

function readScores(run: WorkflowRun, candidateId: string): cs.CandidateScore[] {
  const dir = path.join(candidateDir(run, candidateId), "scores");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => readJson(path.join(dir, file)) as cs.CandidateScore);
}

export function rankCandidates(run: WorkflowRun, options: { policy?: cs.CandidateScoringPolicy; includeRejected?: boolean } = {}): cs.CandidateRanking {
  const policy = cs.mergePolicy(options.policy);
  const rankable = listCandidates(run);
  const ranking = cs.rankCandidateRows(run.id, now(), rankable, (id) => readScores(run, id), policy, Boolean(options.includeRejected));
  writeJson(rankingPath(run), ranking);
  return ranking;
}

export interface SelectCandidateOptions {
  selectedBy?: string;
  reason?: string;
  scoreId?: string;
  rankingPath?: string;
  allowUnverified?: boolean;
  metadata?: Record<string, unknown>;
}

function sandboxProfileForCandidate(run: WorkflowRun, candidate: cs.CandidateRecord | undefined): string | undefined {
  const worker = candidate?.workerId ? ((run.workers as Array<{ id: string; sandboxProfileId?: string }> | undefined) || []).find((entry) => entry.id === candidate.workerId) : undefined;
  if (worker?.sandboxProfileId) return worker.sandboxProfileId;
  const task = candidate?.taskId ? run.tasks.find((entry) => entry.id === candidate.taskId) : undefined;
  return task?.sandboxProfileId as string | undefined;
}

function buildAcceptanceRationale(input: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    selectedCandidateId: input.selectedCandidateId,
    scoreId: input.scoreId,
    scoreCriteria: input.scoreCriteria,
    verifierNodeId: input.verifierNodeId,
    evidenceCount: input.evidenceCount || 0,
    sandboxProfileId: input.sandboxProfileId,
    workerId: input.workerId,
    commitGateResult: input.commitGateResult,
    auditEventIds: cs.unique((input.auditEventIds as string[]) || []).sort(),
  };
}

/** Whether the verifier node's backing result was an empty capture: walk
 *  from the verifier node id (`<runId>:verifier:<taskId>`) to the task
 *  and its recorded result envelope. */
function verifierIsEmptyCapture(run: WorkflowRun, verifierNodeId: string | undefined): boolean {
  if (!verifierNodeId) return false;
  const marker = ":verifier:";
  const idx = verifierNodeId.indexOf(marker);
  const taskId = idx >= 0 ? verifierNodeId.slice(idx + marker.length) : undefined;
  const task = taskId ? run.tasks.find((t) => t.id === taskId) : undefined;
  const result = task?.result as unknown as ResultEnvelope | undefined;
  return result ? isEmptyCapture(result) : false;
}

export function selectCandidate(run: WorkflowRun, candidateId: string, options: SelectCandidateOptions = {}, scoringOptions: { persist?: boolean; policy?: cs.CandidateScoringPolicy } = {}): cs.CandidateSelection {
  const candidate = requireCandidate(run, candidateId);
  const policy = cs.mergePolicy(scoringOptions.policy);
  const ranking = rankCandidates(run, { policy });
  const ranked = ranking.candidates.find((entry) => entry.candidateId === candidateId);
  const verifierNode = candidate.verifierNodeId ? (run.nodes || []).find((node) => node.id === candidate.verifierNodeId) : undefined;
  const bestScoreRecord = options.scoreId ? readScores(run, candidateId).find((score) => score.id === options.scoreId) : readScores(run, candidateId).find((score) => score.id === ranked?.bestScoreId);

  const failures: StateNodeError[] = cs.selectionGateFailures(
    {
      candidateId,
      candidateStatus: candidate.status,
      policy,
      allowUnverified: options.allowUnverified,
      verifierNode,
      verifierNodeIsEmptyCapture: verifierNode ? verifierIsEmptyCapture(run, candidate.verifierNodeId) : false,
      bestScoreNormalized: bestScoreRecord?.normalized,
    },
    now()
  );

  // REVIEW GATE — layered on top, never replacing the verifier failures above.
  const collaborationState = ensureCollaborationState(run);
  const approvals = (collaborationState.approvals || []) as ApprovalRecord[];
  const reviewPolicy = collaborationState.policy;
  const selfIds = pureSelfActorIdsForCandidate(candidate.workerId, ((run.candidateSelections as Array<{ id: string; candidateId: string; selectedBy?: string }> | undefined) || []).filter((s) => s.candidateId === candidateId).map((s) => s.selectedBy).filter((x): x is string => Boolean(x)));
  for (const reviewError of pureReviewGateErrors(run.id, approvals, { targetKind: "selection", candidateId, selfActorIds: selfIds, policy: reviewPolicy }, now())) {
    failures.push(reviewError);
  }

  if (failures.length) {
    const feedbackIds = failures.map((failure) => recordCandidateFailure(run, candidate, failure.code, { message: failure.message, retryable: false, details: failure.details }).id);
    upsertCandidate(run, { ...candidate, updatedAt: now(), status: "failed", feedbackIds: cs.unique([...(candidate.feedbackIds || []), ...feedbackIds]) });
    if (scoringOptions.persist !== false) saveCheckpoint(run);
    throw new Error(failures.map((failure) => failure.message).join("; "));
  }

  const stamp = now();
  const selectionId = cs.createSelectionId(((run.candidateSelections as unknown[]) || []).length, candidateId);
  const evidence = normalizeEvidence(run, cs.mergeEvidence(candidate.evidence, verifierNode?.evidence || []), { source: "cw-validated", workerId: candidate.workerId, taskId: candidate.taskId, resultNodeId: candidate.resultNodeId, verifierNodeId: candidate.verifierNodeId, candidateId, scoreId: bestScoreRecord?.id });
  const selection: cs.CandidateSelection = {
    schemaVersion: cs.CANDIDATE_SCHEMA_VERSION,
    id: selectionId,
    runId: run.id,
    candidateId,
    selectedAt: stamp,
    selectedBy: options.selectedBy || "operator",
    verifierNodeId: candidate.verifierNodeId,
    scoreId: bestScoreRecord?.id,
    rankingPath: options.rankingPath || rankingPath(run),
    reason: options.reason || "selected candidate",
    evidence,
    artifacts: candidate.artifacts,
    feedbackIds: [],
    acceptanceRationale: buildAcceptanceRationale({ selectedCandidateId: candidateId, scoreId: bestScoreRecord?.id, scoreCriteria: bestScoreRecord?.criteria, verifierNodeId: candidate.verifierNodeId, evidenceCount: evidence.length, sandboxProfileId: sandboxProfileForCandidate(run, candidate), workerId: candidate.workerId, commitGateResult: "passed" }),
    metadata: compactMetadata({ ...(options.metadata || {}), rank: ranked?.rank, normalized: bestScoreRecord?.normalized }),
  };
  const selectionAudit = recordTrustAuditEvent(run, { kind: "candidate.selection", decision: "accepted", source: "cw-validated", workerId: candidate.workerId, taskId: candidate.taskId, nodeId: candidate.verifierNodeId, candidateId, scoreId: bestScoreRecord?.id, selectionId: selection.id, sandboxProfileId: selection.acceptanceRationale?.sandboxProfileId as string | undefined, evidence: selection.evidence, metadata: selection.acceptanceRationale as unknown as Record<string, unknown> });
  selection.evidence = normalizeEvidence(run, selection.evidence, { source: "cw-validated", workerId: candidate.workerId, taskId: candidate.taskId, resultNodeId: candidate.resultNodeId, verifierNodeId: candidate.verifierNodeId, candidateId, scoreId: bestScoreRecord?.id, selectionId: selection.id, auditEventIds: [selectionAudit.id] });
  selection.acceptanceRationale = buildAcceptanceRationale({ ...selection.acceptanceRationale, auditEventIds: [selectionAudit.id] });
  run.candidateSelections = [...((run.candidateSelections as unknown[]) || []), selection] as unknown as WorkflowRun["candidateSelections"];
  writeSelectionFile(run, selection);
  const updated = upsertCandidate(run, { ...candidate, updatedAt: stamp, status: verifierNode?.status === "verified" ? "verified" : "selected", selectedAt: stamp, evidence: selection.evidence });
  appendSelectionNode(run, updated, selection);
  writeCandidateIndex(run);
  if (scoringOptions.persist !== false) saveCheckpoint(run);
  return selection;
}

export function rejectCandidate(run: WorkflowRun, candidateId: string, reason: string, options: { persist?: boolean } = {}): cs.CandidateRecord {
  const candidate = requireCandidate(run, candidateId);
  const feedback = recordCandidateFailure(run, candidate, "candidate-rejected", { message: reason || `Candidate ${candidateId} rejected`, retryable: false });
  const updated = upsertCandidate(run, { ...candidate, updatedAt: now(), status: "rejected", rejectedAt: now(), feedbackIds: cs.unique([...(candidate.feedbackIds || []), feedback.id]) });
  appendCandidateNode(run, updated, "rejected");
  if (options.persist !== false) saveCheckpoint(run);
  return updated;
}

export function summarizeCandidates(run: WorkflowRun): { total: number; byStatus: Record<string, number>; byKind: Record<string, number>; indexPath: string; rankingPath: string; selections: number } {
  const candidates = listCandidates(run);
  return { total: candidates.length, byStatus: cs.countBy(candidates, (candidate) => candidate.status), byKind: cs.countBy(candidates, (candidate) => candidate.kind), indexPath: indexPath(run), rankingPath: rankingPath(run), selections: ((run.candidateSelections as unknown[]) || []).length };
}
