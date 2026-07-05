// shell/evidence-reasoning.ts — the Evidence Adoption Reasoning Chain
// (v0.1.26). Faithful port of the old flat build's src/evidence-reasoning.ts
// (+ its src/types/evidence-reasoning.ts types), adapted to v2's core/shell
// split. DERIVES the "why" behind each evidence adoption decision from
// existing run state; never mutates source records, never fabricates a
// rationale (an untraceable adoption renders `unexplained`).
//
// Evidence: SPEC/multi-agent.md "Evidence adoption reasoning";
// plugins/cool-workflow/src/evidence-reasoning.ts (byte-behavior source).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WorkflowRun } from "../core/state/types";
import { tryValidateCandidateScore } from "../core/state/validation";
import { writeJson, safeFileName } from "./fs-atomic";
import { MultiAgentOperatorEvidence, summarizeMultiAgentOperator } from "./multi-agent-operator-ux";
import { listTrustAuditEvents } from "./trust-audit";
import { policyForRole } from "../core/multi-agent/trust-policy";

export const EVIDENCE_REASONING_SCHEMA_VERSION = 1;

// ---- Types (ported from src/types/evidence-reasoning.ts) -------------------

export type EvidenceReasoningGate = "fanin" | "candidate-score" | "selection" | "verifier" | "commit";
export type EvidenceReasoningStatus = "adopted" | "rejected" | "superseded" | "conflicting" | "pending" | "missing" | "unexplained";
export type EvidenceRationaleStatus = "explained" | "unexplained" | "not-applicable";
export type EvidenceReasoningFreshnessStatus = "valid" | "stale" | "absent";

export interface EvidenceReasoningBasis {
  evidenceRefs: string[];
  provenanceSource?: string;
  parentEvidenceIds: string[];
  auditEventIds: string[];
}
export interface EvidenceReasoningAuthority {
  actor?: string;
  actorKind: "role" | "membership" | "worker" | "operator" | "coordinator" | "verifier" | "runtime";
  policyRef?: string;
  allowed?: boolean;
}
export interface EvidenceReasoningRationale {
  status: EvidenceRationaleStatus;
  text?: string;
  sourceKind?: "selection-reason" | "acceptance-rationale" | "score-notes" | "score-verdict" | "commit-reason" | "coordinator-decision" | "judge-rationale";
  sourceId?: string;
  judgeRationaleIds?: string[];
  panelDecisionId?: string;
  scoreCriteria?: Record<string, number>;
  scoreDelta?: number;
}
export interface EvidenceReasoningCounterfactual {
  ref: string;
  kind: "candidate" | "score" | "decision" | "evidence";
  status: EvidenceReasoningStatus;
  reason: string;
}
export interface EvidenceReasoningStep {
  gate: EvidenceReasoningGate;
  decision: EvidenceReasoningStatus;
  basis: EvidenceReasoningBasis;
  authority: EvidenceReasoningAuthority;
  rationale: EvidenceReasoningRationale;
  counterfactuals: EvidenceReasoningCounterfactual[];
}
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
export interface EvidenceReasoningReport {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  freshness: { status: EvidenceReasoningFreshnessStatus; persistedFingerprint?: string; currentFingerprint: string };
  sourceFingerprint: string;
  totals: { chains: number; explained: number; unexplained: number; notApplicable: number; adopted: number; rejected: number; byStatus: Record<string, number> };
  chains: EvidenceReasoningChain[];
  nextAction: string;
}
export interface EvidenceReasoningIndexEntry {
  id: string;
  path: string;
  evidenceStatus: EvidenceReasoningStatus;
  rationaleStatus: EvidenceRationaleStatus;
  sourceFingerprint: string;
}
export interface EvidenceReasoningIndex {
  schemaVersion: number;
  runId: string;
  id: "evidence-reasoning-index";
  generatedAt: string;
  sourceFingerprint: string;
  totals: EvidenceReasoningReport["totals"];
  entries: EvidenceReasoningIndexEntry[];
  paths: { reasoningDir: string; indexPath: string; reportPath: string };
  nextAction: string;
}

// ---- Loose views over v2's `unknown[]`-typed run subsystems ----------------

interface ScoreLike {
  id: string;
  verdict?: string;
  notes?: string;
  normalized: number;
  criteria?: Record<string, number>;
  scorer?: string;
  evidence?: Array<{ locator?: string; path?: string; summary?: string; id?: string; provenance?: { auditEventIds?: string[] } }>;
}
interface CandidateLike {
  id: string;
  status: string;
  scores?: string[];
  feedbackIds?: string[];
}
interface SelectionLike {
  id: string;
  reason?: string;
  selectedBy?: string;
  scoreId?: string;
  evidence?: Array<{ locator?: string; path?: string; summary?: string; id?: string }>;
  acceptanceRationale?: { commitGateResult?: string; evidenceCount?: number; scoreCriteria?: Record<string, number>; judgeRationaleIds?: string[]; panelDecisionId?: string; auditEventIds?: string[] };
}
interface CommitLike {
  id: string;
  reason?: string;
  verifierGated?: boolean;
  verifierNodeId?: string;
  stateNodeId?: string;
  evidence?: Array<{ locator?: string; path?: string; summary?: string; id?: string }>;
  acceptanceRationale?: { commitGateResult?: string; auditEventIds?: string[] };
}
interface DecisionLike {
  id: string;
  kind?: string;
  outcome?: string;
  reason?: string;
  subjectIds?: string[];
  evidenceRefs?: string[];
  author?: { kind?: string; id?: string };
}
interface FaninLike {
  id: string;
  verifierReady?: boolean;
  strategy?: string;
  blockedReasons?: string[];
  evidenceCoverage?: Array<{ complete: boolean }>;
}
interface RoleLike {
  id: string;
  policy?: { policyRef?: string };
}
interface AuditEventLike {
  id: string;
  kind?: string;
  decision?: string;
  scoreId?: string;
  candidateId?: string;
  agentRoleId?: string;
  metadata?: { rationale?: unknown };
}

function candidatesOf(run: WorkflowRun): CandidateLike[] {
  return ((run as unknown as { candidates?: CandidateLike[] }).candidates || []);
}
function selectionsOf(run: WorkflowRun): SelectionLike[] {
  return ((run as unknown as { candidateSelections?: SelectionLike[] }).candidateSelections || []);
}
function commitsOf(run: WorkflowRun): CommitLike[] {
  return ((run as unknown as { commits?: CommitLike[] }).commits || []);
}
function decisionsOf(run: WorkflowRun): DecisionLike[] {
  return ((run as unknown as { blackboard?: { decisions?: DecisionLike[] } }).blackboard?.decisions || []);
}
function faninsOf(run: WorkflowRun): FaninLike[] {
  return ((run as unknown as { multiAgent?: { fanins?: FaninLike[] } }).multiAgent?.fanins || []);
}
function rolesOf(run: WorkflowRun): RoleLike[] {
  return ((run as unknown as { multiAgent?: { roles?: RoleLike[] } }).multiAgent?.roles || []);
}

// ---- Derivation ------------------------------------------------------------

export function buildEvidenceReasoningReport(run: WorkflowRun, options: { index?: EvidenceReasoningIndex } = {}): EvidenceReasoningReport {
  const operator = summarizeMultiAgentOperator(run);
  const scores = readAllScores(run);
  const auditEvents = listTrustAuditEvents(run) as unknown as AuditEventLike[];
  const counterfactuals = deriveCounterfactuals(run, scores);

  const chains = operator.evidence
    .map((evidence) => buildChain(run, evidence, { scores, auditEvents, counterfactuals }))
    .sort((left, right) => statusRank(left.evidenceStatus) - statusRank(right.evidenceStatus) || left.id.localeCompare(right.id));

  const totals = summarizeTotals(chains);
  const currentFingerprint = fingerprintChains(chains);
  const persisted = options.index;
  let status: EvidenceReasoningReport["freshness"]["status"] = persisted ? "valid" : "absent";
  if (persisted && persisted.sourceFingerprint !== currentFingerprint) status = "stale";

  const nextAction =
    status === "stale" || status === "absent"
      ? `node scripts/cw.js multi-agent reasoning ${run.id} --refresh`
      : totals.unexplained > 0
        ? `node scripts/cw.js multi-agent reasoning ${run.id} --json`
        : `node scripts/cw.js multi-agent evidence ${run.id} --json`;

  return {
    schemaVersion: EVIDENCE_REASONING_SCHEMA_VERSION,
    runId: run.id,
    generatedAt: new Date().toISOString(),
    freshness: { status, persistedFingerprint: persisted?.sourceFingerprint, currentFingerprint },
    sourceFingerprint: currentFingerprint,
    totals,
    chains,
    nextAction,
  };
}

interface DerivationContext {
  scores: Map<string, ScoreLike>;
  auditEvents: AuditEventLike[];
  counterfactuals: { forScoreGate: EvidenceReasoningCounterfactual[]; forSelectionGate: EvidenceReasoningCounterfactual[]; bestRejectedNormalized?: number };
}

function buildChain(run: WorkflowRun, evidence: MultiAgentOperatorEvidence, context: DerivationContext): EvidenceReasoningChain {
  const steps: EvidenceReasoningStep[] = [];
  const sourceRecordIds = new Set<string>();
  const note = (id?: string) => { if (id) sourceRecordIds.add(id); };

  const adopters = [...evidence.adoptedBy, ...evidence.rejectedBy];

  for (const scoreId of evidence.scoreIds) {
    const score = context.scores.get(scoreId);
    note(scoreId);
    steps.push(buildScoreStep(run, evidence, score, scoreId, context));
  }
  for (const selectionId of evidence.selectionIds) {
    const selection = selectionsOf(run).find((entry) => entry.id === selectionId);
    note(selectionId);
    steps.push(buildSelectionStep(run, evidence, selection, selectionId, context));
  }
  for (const commitId of evidence.commitIds) {
    const commit = commitsOf(run).find((entry) => entry.id === commitId);
    note(commitId);
    steps.push(buildCommitStep(run, evidence, commit, commitId));
    const verifierStep = buildVerifierStep(evidence, commit, commitId);
    if (verifierStep) steps.push(verifierStep);
  }

  const faninIds = new Set(faninsOf(run).map((entry) => entry.id));
  const decisions = decisionsOf(run);
  for (const adopter of unique(adopters)) {
    if (faninIds.has(adopter)) {
      note(adopter);
      steps.push(buildFaninStep(run, evidence, adopter, decisions));
    } else {
      const decision = decisions.find((entry) => entry.id === adopter);
      if (decision) {
        note(decision.id);
        steps.push(buildDecisionStep(evidence, decision));
      }
    }
  }

  if (!steps.length && isDecisionStatus(evidence.status as EvidenceReasoningStatus)) {
    steps.push(buildUnexplainedStep(evidence));
  }

  const evidenceStatus = mapStatus(evidence.status);
  const rationaleStatus = rollupRationale(steps, evidenceStatus);
  const unexplainedReasons = steps
    .filter((step) => step.rationale.status === "unexplained")
    .map((step) => `${step.gate}: no recorded rationale for ${step.decision} adoption`);

  for (const ref of [evidence.sourceId, ...evidence.candidateIds]) note(ref);

  return {
    schemaVersion: EVIDENCE_REASONING_SCHEMA_VERSION,
    id: evidence.id,
    ref: evidence.ref,
    evidenceStatus,
    rationaleStatus,
    sourceKind: evidence.sourceKind,
    sourceId: evidence.sourceId,
    steps,
    sourceRecordIds: [...sourceRecordIds].filter(Boolean).sort(),
    unexplainedReasons,
  };
}

function buildScoreStep(run: WorkflowRun, evidence: MultiAgentOperatorEvidence, score: ScoreLike | undefined, scoreId: string, context: DerivationContext): EvidenceReasoningStep {
  const decision: EvidenceReasoningStatus = score?.verdict === "fail" ? "rejected" : "adopted";
  const judge = context.auditEvents.find(
    (event) => event.kind === "judge.rationale" && event.decision === "accepted" && (event.scoreId === scoreId || (!event.scoreId && event.candidateId && evidence.candidateIds.includes(event.candidateId)))
  );
  const rationaleText = score?.notes || judgeRationaleText(judge);
  const rationale: EvidenceReasoningRationale = rationaleText
    ? {
        status: "explained",
        text: truncate(rationaleText),
        sourceKind: score?.notes ? "score-notes" : "judge-rationale",
        sourceId: score?.notes ? scoreId : judge?.id,
        scoreCriteria: score?.criteria,
        scoreDelta: context.counterfactuals.bestRejectedNormalized !== undefined && score ? round(score.normalized - context.counterfactuals.bestRejectedNormalized) : undefined,
      }
    : unexplainedRationale();
  const auditIds = unique([...collectAuditIds(score), ...(judge ? [judge.id] : [])]);
  return {
    gate: "candidate-score",
    decision,
    basis: basisFor(evidence, { auditEventIds: auditIds, evidenceRefs: scoreEvidenceRefs(score) }),
    authority: roleAuthority(run, judge?.agentRoleId || score?.scorer, judge ? judge.decision === "accepted" : undefined),
    rationale,
    counterfactuals: decision === "adopted" ? context.counterfactuals.forScoreGate : [],
  };
}

function buildSelectionStep(run: WorkflowRun, evidence: MultiAgentOperatorEvidence, selection: SelectionLike | undefined, selectionId: string, context: DerivationContext): EvidenceReasoningStep {
  const rationaleText = selection?.reason;
  const acceptance = selection?.acceptanceRationale;
  const rationale: EvidenceReasoningRationale = rationaleText
    ? { status: "explained", text: truncate(rationaleText), sourceKind: "selection-reason", sourceId: selectionId, scoreCriteria: acceptance?.scoreCriteria, judgeRationaleIds: acceptance?.judgeRationaleIds, panelDecisionId: acceptance?.panelDecisionId }
    : acceptance
      ? { status: "explained", text: `commit gate ${acceptance.commitGateResult || "recorded"} with ${acceptance.evidenceCount} evidence ref(s)`, sourceKind: "acceptance-rationale", sourceId: selectionId, scoreCriteria: acceptance.scoreCriteria, judgeRationaleIds: acceptance.judgeRationaleIds, panelDecisionId: acceptance.panelDecisionId }
      : unexplainedRationale();
  const synthesis = decisionsOf(run).find((entry) => entry.kind === "candidate-synthesis" && (entry.subjectIds || []).includes(selectionId) && entry.author?.kind === "role");
  return {
    gate: "selection",
    decision: "adopted",
    basis: basisFor(evidence, { auditEventIds: acceptance?.auditEventIds || [], evidenceRefs: (selection?.evidence || []).map(evidenceRef).filter(Boolean) }),
    authority: roleAuthority(run, synthesis?.author?.id || selection?.selectedBy, true),
    rationale,
    counterfactuals: context.counterfactuals.forSelectionGate,
  };
}

function buildCommitStep(_run: WorkflowRun, evidence: MultiAgentOperatorEvidence, commit: CommitLike | undefined, commitId: string): EvidenceReasoningStep {
  const decision: EvidenceReasoningStatus = commit?.verifierGated ? "adopted" : "pending";
  const rationale: EvidenceReasoningRationale = commit?.reason
    ? { status: "explained", text: truncate(commit.reason), sourceKind: "commit-reason", sourceId: commitId }
    : decision === "adopted"
      ? unexplainedRationale()
      : { status: "not-applicable" };
  return {
    gate: "commit",
    decision,
    basis: basisFor(evidence, { auditEventIds: commit?.acceptanceRationale?.auditEventIds || [], evidenceRefs: (commit?.evidence || []).map(evidenceRef).filter(Boolean) }),
    authority: { actor: commitId, actorKind: "runtime", allowed: commit?.verifierGated },
    rationale,
    counterfactuals: [],
  };
}

function buildVerifierStep(evidence: MultiAgentOperatorEvidence, commit: CommitLike | undefined, commitId: string): EvidenceReasoningStep | undefined {
  const verifierNodeId = commit?.verifierNodeId;
  if (!verifierNodeId) return undefined;
  const gateResult = commit?.acceptanceRationale?.commitGateResult;
  return {
    gate: "verifier",
    decision: commit?.verifierGated ? "adopted" : "pending",
    basis: basisFor(evidence, { auditEventIds: [], evidenceRefs: [] }),
    authority: { actor: verifierNodeId, actorKind: "verifier", allowed: commit?.verifierGated },
    rationale: gateResult
      ? { status: "explained", text: `verifier commit gate ${gateResult}`, sourceKind: "acceptance-rationale", sourceId: commitId }
      : commit?.verifierGated
        ? { status: "explained", text: "verifier-gated commit recorded", sourceKind: "commit-reason", sourceId: commitId }
        : { status: "not-applicable" },
    counterfactuals: [],
  };
}

function buildFaninStep(run: WorkflowRun, evidence: MultiAgentOperatorEvidence, faninId: string, decisions: DecisionLike[]): EvidenceReasoningStep {
  const fanin = faninsOf(run).find((entry) => entry.id === faninId);
  const readiness = decisions.find((entry) => entry.kind === "fanin-readiness" && (entry.subjectIds || []).includes(faninId));
  const adopted = evidence.adoptedBy.includes(faninId);
  const decision: EvidenceReasoningStatus = adopted ? "adopted" : "pending";
  let rationale: EvidenceReasoningRationale;
  if (readiness?.reason) {
    rationale = { status: "explained", text: truncate(readiness.reason), sourceKind: "coordinator-decision", sourceId: readiness.id };
  } else if (fanin && fanin.verifierReady && coverageComplete(fanin)) {
    rationale = { status: "explained", text: `fanin ${faninId} ready: required evidence covered under "${fanin.strategy}" strategy`, sourceKind: "coordinator-decision", sourceId: faninId };
  } else if (fanin && (fanin.blockedReasons || []).length) {
    rationale = { status: "explained", text: truncate(fanin.blockedReasons![0]), sourceKind: "coordinator-decision", sourceId: faninId };
  } else {
    rationale = decision === "adopted" ? unexplainedRationale() : { status: "not-applicable" };
  }
  return {
    gate: "fanin",
    decision,
    basis: basisFor(evidence, { auditEventIds: [], evidenceRefs: [] }),
    authority: { actor: faninId, actorKind: "coordinator", allowed: adopted },
    rationale,
    counterfactuals: [],
  };
}

function buildDecisionStep(evidence: MultiAgentOperatorEvidence, decision: DecisionLike): EvidenceReasoningStep {
  const status = mapDecisionOutcome(decision.outcome || "");
  return {
    gate: "fanin",
    decision: status,
    basis: basisFor(evidence, { auditEventIds: [], evidenceRefs: decision.evidenceRefs || [] }),
    authority: { actor: decision.author?.id || decision.id, actorKind: authorKind(decision.author?.kind), allowed: decision.outcome === "accepted" || decision.outcome === "ready" },
    rationale: decision.reason
      ? { status: "explained", text: truncate(decision.reason), sourceKind: "coordinator-decision", sourceId: decision.id }
      : isDecisionStatus(status)
        ? unexplainedRationale()
        : { status: "not-applicable" },
    counterfactuals: [],
  };
}

function buildUnexplainedStep(evidence: MultiAgentOperatorEvidence): EvidenceReasoningStep {
  return {
    gate: "fanin",
    decision: mapStatus(evidence.status),
    basis: basisFor(evidence, { auditEventIds: [], evidenceRefs: [] }),
    authority: { actor: evidence.adoptedBy[0] || evidence.rejectedBy[0] || evidence.sourceId, actorKind: actorKindForSource(evidence.sourceKind), allowed: evidence.status === "adopted" },
    rationale: evidence.reason ? { status: "explained", text: truncate(evidence.reason), sourceKind: "coordinator-decision", sourceId: evidence.sourceId } : unexplainedRationale(),
    counterfactuals: [],
  };
}

function deriveCounterfactuals(run: WorkflowRun, scores: Map<string, ScoreLike>): DerivationContext["counterfactuals"] {
  const forScoreGate: EvidenceReasoningCounterfactual[] = [];
  const forSelectionGate: EvidenceReasoningCounterfactual[] = [];
  let bestRejectedNormalized: number | undefined;

  for (const candidate of candidatesOf(run)) {
    if (candidate.status === "rejected" || candidate.status === "failed") {
      forSelectionGate.push({ ref: candidate.id, kind: "candidate", status: "rejected", reason: (candidate.feedbackIds || [])[0] ? `see feedback ${candidate.feedbackIds![0]}` : `candidate ${candidate.id} ${candidate.status}` });
      for (const scoreId of candidate.scores || []) {
        const score = scores.get(scoreId);
        if (score && (bestRejectedNormalized === undefined || score.normalized > bestRejectedNormalized)) bestRejectedNormalized = score.normalized;
      }
    }
  }
  for (const [scoreId, score] of scores) {
    if (score.verdict === "fail") {
      forScoreGate.push({ ref: scoreId, kind: "score", status: "rejected", reason: score.notes ? truncate(score.notes) : `score ${scoreId} verdict=fail (normalized ${round(score.normalized)})` });
    }
  }
  for (const decision of decisionsOf(run)) {
    if (decision.outcome === "rejected" || decision.outcome === "superseded" || decision.outcome === "conflicting") {
      forSelectionGate.push({ ref: decision.id, kind: "decision", status: mapDecisionOutcome(decision.outcome), reason: decision.reason ? truncate(decision.reason) : `decision ${decision.id} ${decision.outcome}` });
    }
  }
  return { forScoreGate: forScoreGate.sort(byRef), forSelectionGate: forSelectionGate.sort(byRef), bestRejectedNormalized };
}

/** Critical-path node ids that state-explosion compaction must never collapse. */
export function reasoningCriticalNodeIds(run: WorkflowRun): string[] {
  const ids = new Set<string>();
  const faninIds = new Set(faninsOf(run).map((entry) => entry.id));
  const commitById = new Map(commitsOf(run).map((commit) => [commit.id, commit]));
  for (const evidence of summarizeMultiAgentOperator(run).evidence) {
    if (evidence.status !== "adopted") continue;
    for (const id of evidence.candidateIds) ids.add(`${run.id}:candidate:${id}`);
    for (const id of evidence.scoreIds) ids.add(`${run.id}:score:${id}`);
    for (const id of evidence.selectionIds) ids.add(`${run.id}:selection:${id}`);
    for (const id of evidence.commitIds) ids.add(commitById.get(id)?.stateNodeId || `${run.id}:commit:${id}`);
    for (const adopter of evidence.adoptedBy) if (faninIds.has(adopter)) ids.add(`${run.id}:multi-agent:fanin:${adopter}`);
  }
  return [...ids].sort();
}

// ---- Persistence + refresh -------------------------------------------------

export function reasoningDir(run: WorkflowRun): string {
  return path.join(run.paths.runDir, "reasoning");
}

export function refreshEvidenceReasoning(run: WorkflowRun): EvidenceReasoningIndex {
  const report = buildEvidenceReasoningReport(run);
  const dir = reasoningDir(run);
  fs.mkdirSync(dir, { recursive: true });
  const entries: EvidenceReasoningIndexEntry[] = [];
  for (const chain of report.chains) {
    const file = path.join(dir, `chain-${safeFileName(chain.id)}.json`);
    writeJson(file, chain);
    entries.push({ id: chain.id, path: file, evidenceStatus: chain.evidenceStatus, rationaleStatus: chain.rationaleStatus, sourceFingerprint: fingerprintChains([chain]) });
  }
  const indexPath = path.join(dir, "index.json");
  const reportPath = path.join(dir, "report.json");
  const index: EvidenceReasoningIndex = {
    schemaVersion: EVIDENCE_REASONING_SCHEMA_VERSION,
    runId: run.id,
    id: "evidence-reasoning-index",
    generatedAt: new Date().toISOString(),
    sourceFingerprint: report.sourceFingerprint,
    totals: report.totals,
    entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
    paths: { reasoningDir: dir, indexPath, reportPath },
    nextAction: `node scripts/cw.js multi-agent reasoning ${run.id}`,
  };
  writeJson(indexPath, index);
  writeJson(reportPath, { ...report, freshness: { ...report.freshness, status: "valid", persistedFingerprint: report.sourceFingerprint } });
  return index;
}

export function loadEvidenceReasoningIndex(run: WorkflowRun): EvidenceReasoningIndex | undefined {
  const indexPath = path.join(reasoningDir(run), "index.json");
  if (!fs.existsSync(indexPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8")) as EvidenceReasoningIndex;
    if (!parsed || parsed.id !== "evidence-reasoning-index") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function showEvidenceReasoning(run: WorkflowRun, options: { evidenceId?: string } = {}): EvidenceReasoningReport {
  const index = loadEvidenceReasoningIndex(run);
  const report = buildEvidenceReasoningReport(run, { index });
  if (!options.evidenceId) return report;
  const chains = report.chains.filter((chain) => chain.id === options.evidenceId || chain.ref === options.evidenceId);
  return { ...report, chains, totals: summarizeTotals(chains) };
}

// ---- Eval normalization (deterministic, timestamp/path-free) ---------------

export interface EvidenceReasoningEvalSections {
  reasoningFreshness: string[];
  reasoningChains: string[];
  reasoningUnexplained: string[];
}

/** Derive the reasoning eval sections WITHOUT the persisted index (a replay
 *  run has no reasoning/index.json). Port of normalizeEvidenceReasoningForEval. */
export function normalizeEvidenceReasoningForEval(run: WorkflowRun): EvidenceReasoningEvalSections {
  const report = buildEvidenceReasoningReport(run);
  return {
    reasoningFreshness: [
      JSON.stringify({
        sourceFingerprint: report.sourceFingerprint,
        chains: report.totals.chains,
        explained: report.totals.explained,
        unexplained: report.totals.unexplained,
        notApplicable: report.totals.notApplicable,
        adopted: report.totals.adopted,
        rejected: report.totals.rejected,
      }),
    ],
    reasoningChains: report.chains
      .map((chain) =>
        JSON.stringify({
          id: stripRunId(run, chain.id),
          evidenceStatus: chain.evidenceStatus,
          rationaleStatus: chain.rationaleStatus,
          gates: chain.steps.map((step) => `${step.gate}:${step.decision}:${step.rationale.status}`),
          counterfactuals: chain.steps.reduce((total, step) => total + step.counterfactuals.length, 0),
        })
      )
      .sort(),
    reasoningUnexplained: report.chains.filter((chain) => chain.rationaleStatus === "unexplained").map((chain) => stripRunId(run, chain.id)).sort(),
  };
}

function stripRunId(run: WorkflowRun, id: string): string {
  return id.startsWith(`${run.id}:`) ? id.slice(run.id.length + 1) : id;
}

// ---- Human formatting ------------------------------------------------------

export function formatEvidenceReasoningReport(report: EvidenceReasoningReport): string {
  const lines: string[] = [];
  lines.push(`Evidence Adoption Reasoning: ${report.runId}`);
  lines.push(`Freshness: ${report.freshness.status}`);
  lines.push("");
  lines.push("Adoption Rationale");
  lines.push(`  chains=${report.totals.chains}; explained=${report.totals.explained}; unexplained=${report.totals.unexplained}; n/a=${report.totals.notApplicable}; adopted=${report.totals.adopted}; rejected=${report.totals.rejected}`);
  lines.push("");
  if (!report.chains.length) lines.push("  none");
  for (const chain of report.chains.slice(0, 60)) {
    lines.push(`  [${chain.evidenceStatus}/${chain.rationaleStatus}] ${chain.id} (${chain.ref || chain.sourceKind})`);
    for (const step of chain.steps) {
      const actor = `${step.authority.actorKind}:${step.authority.actor || "unknown"}`;
      const why = step.rationale.status === "explained" ? step.rationale.text : `(${step.rationale.status})`;
      const policy = step.authority.policyRef ? ` policy=${step.authority.policyRef}` : "";
      lines.push(`    - ${step.gate} [${step.decision}] by ${actor}${policy}: ${why}`);
      for (const cf of step.counterfactuals.slice(0, 4)) lines.push(`        x ${cf.kind} ${cf.ref} [${cf.status}]: ${cf.reason}`);
    }
    for (const reason of chain.unexplainedReasons) lines.push(`    ! ${reason}`);
  }
  if (report.chains.length > 60) lines.push(`  ... ${report.chains.length - 60} more`);
  lines.push("");
  lines.push("Next Action");
  lines.push(`  ${report.nextAction}`);
  return lines.join("\n");
}

// ---- Helpers ---------------------------------------------------------------

function basisFor(evidence: MultiAgentOperatorEvidence, extra: { auditEventIds: string[]; evidenceRefs: string[] }): EvidenceReasoningBasis {
  return {
    evidenceRefs: unique([evidence.locator || evidence.path || evidence.ref || evidence.id, ...extra.evidenceRefs].filter(Boolean) as string[]),
    provenanceSource: provenanceSourceFor(evidence),
    parentEvidenceIds: [],
    auditEventIds: unique(extra.auditEventIds.filter(Boolean)),
  };
}

function provenanceSourceFor(evidence: MultiAgentOperatorEvidence): string | undefined {
  const value = evidence.provenanceSource;
  if (value === "cw-validated" || value === "host-attested" || value === "operator-recorded" || value === "runtime-derived") return value;
  return undefined;
}

function roleAuthority(run: WorkflowRun, actor: string | undefined, allowed?: boolean): EvidenceReasoningAuthority {
  const role = rolesOf(run).find((entry) => entry.id === actor);
  const policyRef = role ? (role.policy || policyForRole(role as never)).policyRef : undefined;
  return { actor, actorKind: role ? "role" : actor === "multi-agent-host" ? "operator" : actorKindForActor(actor), policyRef, allowed };
}

function rollupRationale(steps: EvidenceReasoningStep[], evidenceStatus: EvidenceReasoningStatus): EvidenceRationaleStatus {
  const decisionSteps = steps.filter((step) => isDecisionStatus(step.decision));
  if (!decisionSteps.length) return "not-applicable";
  if (decisionSteps.some((step) => step.rationale.status === "unexplained")) return "unexplained";
  if (decisionSteps.every((step) => step.rationale.status === "explained")) return "explained";
  return evidenceStatus === "adopted" ? "unexplained" : "not-applicable";
}

function summarizeTotals(chains: EvidenceReasoningChain[]): EvidenceReasoningReport["totals"] {
  const byStatus: Record<string, number> = {};
  let explained = 0, unexplained = 0, notApplicable = 0, adopted = 0, rejected = 0;
  for (const chain of chains) {
    byStatus[chain.evidenceStatus] = (byStatus[chain.evidenceStatus] || 0) + 1;
    if (chain.rationaleStatus === "explained") explained += 1;
    else if (chain.rationaleStatus === "unexplained") unexplained += 1;
    else notApplicable += 1;
    if (chain.evidenceStatus === "adopted") adopted += 1;
    if (chain.evidenceStatus === "rejected") rejected += 1;
  }
  return { chains: chains.length, explained, unexplained, notApplicable, adopted, rejected, byStatus };
}

function readAllScores(run: WorkflowRun): Map<string, ScoreLike> {
  const scores = new Map<string, ScoreLike>();
  const candidatesDir = run.paths.candidatesDir || path.join(run.paths.runDir, "candidates");
  for (const candidate of candidatesOf(run)) {
    const dir = path.join(candidatesDir, safeFileName(candidate.id), "scores");
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((entry) => entry.endsWith(".json")).sort()) {
      try {
        // Fail closed on a malformed/forged score shape via the shared core
        // guard (full field-shape check, not just id/normalized).
        const parsed = tryValidateCandidateScore(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
        if (!parsed) continue;
        scores.set(parsed.id, parsed as unknown as ScoreLike);
      } catch {
        // Unreadable score record: skip; the score gate fails closed.
      }
    }
  }
  return scores;
}

function fingerprintChains(chains: EvidenceReasoningChain[]): string {
  const lines = chains.map((chain) => JSON.stringify([chain.id, chain.evidenceStatus, chain.rationaleStatus, chain.steps.map((step) => [step.gate, step.decision, step.rationale.status, step.rationale.sourceId || ""])]));
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify([...lines].sort()));
  return `sha256:${hash.digest("hex").slice(0, 32)}`;
}

function unexplainedRationale(): EvidenceReasoningRationale {
  return { status: "unexplained" };
}
function judgeRationaleText(event: AuditEventLike | undefined): string | undefined {
  const value = event?.metadata?.rationale;
  return typeof value === "string" && value.trim() ? value : undefined;
}
function collectAuditIds(score: ScoreLike | undefined): string[] {
  const ids: string[] = [];
  for (const item of score?.evidence || []) for (const id of item.provenance?.auditEventIds || []) ids.push(id);
  return ids;
}
function scoreEvidenceRefs(score: ScoreLike | undefined): string[] {
  return (score?.evidence || []).map(evidenceRef).filter(Boolean);
}
function evidenceRef(item: { id?: string; locator?: string; path?: string; summary?: string }): string {
  return item.locator || item.path || item.summary || item.id || "";
}
function coverageComplete(fanin: { evidenceCoverage?: Array<{ complete: boolean }> }): boolean {
  const coverage = fanin.evidenceCoverage || [];
  return coverage.length > 0 && coverage.every((entry) => entry.complete);
}
function mapStatus(status: MultiAgentOperatorEvidence["status"]): EvidenceReasoningStatus {
  return status as EvidenceReasoningStatus;
}
function mapDecisionOutcome(outcome: string): EvidenceReasoningStatus {
  if (outcome === "accepted" || outcome === "ready") return "adopted";
  if (outcome === "rejected") return "rejected";
  if (outcome === "superseded") return "superseded";
  if (outcome === "conflicting") return "conflicting";
  return "pending";
}
function isDecisionStatus(status: EvidenceReasoningStatus): boolean {
  return status === "adopted" || status === "rejected" || status === "superseded" || status === "conflicting";
}
function authorKind(kind: string | undefined): EvidenceReasoningAuthority["actorKind"] {
  if (kind === "role" || kind === "group") return "role";
  if (kind === "worker") return "worker";
  if (kind === "membership") return "membership";
  if (kind === "operator") return "operator";
  if (kind === "verifier") return "verifier";
  if (kind === "coordinator") return "coordinator";
  return "runtime";
}
function actorKindForActor(actor: string | undefined): EvidenceReasoningAuthority["actorKind"] {
  if (!actor) return "runtime";
  if (actor.includes("worker")) return "worker";
  if (actor.includes("membership")) return "membership";
  if (actor.includes("verifier")) return "verifier";
  return "runtime";
}
function actorKindForSource(sourceKind: MultiAgentOperatorEvidence["sourceKind"]): EvidenceReasoningAuthority["actorKind"] {
  if (sourceKind === "worker") return "worker";
  if (sourceKind === "coordinator") return "coordinator";
  if (sourceKind === "verifier") return "verifier";
  if (sourceKind === "operator") return "operator";
  return "runtime";
}
function statusRank(status: EvidenceReasoningStatus): number {
  return ({ adopted: 0, pending: 1, missing: 2, conflicting: 3, rejected: 4, superseded: 5, unexplained: 6 } as Record<string, number>)[status] ?? 9;
}
function truncate(value: string): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > 200 ? `${single.slice(0, 197)}...` : single;
}
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}
function byRef(a: EvidenceReasoningCounterfactual, b: EvidenceReasoningCounterfactual): number {
  return a.ref.localeCompare(b.ref);
}
