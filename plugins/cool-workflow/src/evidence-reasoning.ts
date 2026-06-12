import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CandidateScore,
  CandidateSelection,
  CoordinatorDecision,
  EvidenceRationaleStatus,
  EvidenceReasoningAuthority,
  EvidenceReasoningChain,
  EvidenceReasoningCounterfactual,
  EvidenceReasoningGate,
  EvidenceReasoningRationale,
  EvidenceReasoningReport,
  EvidenceReasoningStatus,
  EvidenceReasoningStep,
  StateCommit,
  TrustAuditEvent,
  WorkflowRun
} from "./types";
import { writeJson, safeFileName } from "./state";
import {
  MultiAgentOperatorEvidence,
  summarizeMultiAgentOperator
} from "./multi-agent-operator-ux";
import { listTrustAuditEvents } from "./trust-audit";
import { policyForRole } from "./multi-agent-trust";

// ---------------------------------------------------------------------------
// Evidence Adoption Reasoning Chain (v0.1.26)
//
// This module DERIVES the "why" behind each evidence adoption decision from
// existing run state. It is the mechanism half of the FreeBSD mechanism/policy
// split: it captures, fingerprints and renders the recorded rationale; it never
// decides whether a rationale is *sufficient* (that stays with the verifier /
// role policy). It never mutates source-of-truth records and never fabricates a
// rationale — an adoption whose reason cannot be traced renders `unexplained`.
//
// The persisted view mirrors the v0.1.25 state-explosion summaries: a derived,
// versioned, provenance-backed index under .cw/runs/<id>/reasoning/ with a
// sourceFingerprint and valid|stale|absent freshness, refreshable, never
// authoritative over raw state.
// ---------------------------------------------------------------------------

export const EVIDENCE_REASONING_SCHEMA_VERSION = 1;

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
  paths: {
    reasoningDir: string;
    indexPath: string;
    reportPath: string;
  };
  nextAction: string;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export function buildEvidenceReasoningReport(
  run: WorkflowRun,
  options: { index?: EvidenceReasoningIndex } = {}
): EvidenceReasoningReport {
  const operator = summarizeMultiAgentOperator(run);
  const scores = readAllScores(run);
  const auditEvents = listTrustAuditEvents(run);
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
    freshness: {
      status,
      persistedFingerprint: persisted?.sourceFingerprint,
      currentFingerprint
    },
    sourceFingerprint: currentFingerprint,
    totals,
    chains,
    nextAction
  };
}

interface DerivationContext {
  scores: Map<string, CandidateScore>;
  auditEvents: TrustAuditEvent[];
  counterfactuals: {
    forScoreGate: EvidenceReasoningCounterfactual[];
    forSelectionGate: EvidenceReasoningCounterfactual[];
    bestRejectedNormalized?: number;
  };
}

function buildChain(
  run: WorkflowRun,
  evidence: MultiAgentOperatorEvidence,
  context: DerivationContext
): EvidenceReasoningChain {
  const steps: EvidenceReasoningStep[] = [];
  const sourceRecordIds = new Set<string>();
  const note = (id?: string) => {
    if (id) sourceRecordIds.add(id);
  };

  // Walk the adopters/rejecters recorded on the evidence row and classify each
  // by the gate it represents. We never invent gates: a step exists only when a
  // real adopter/decision record references this evidence.
  const adopters = [...evidence.adoptedBy, ...evidence.rejectedBy];

  for (const scoreId of evidence.scoreIds) {
    const score = context.scores.get(scoreId);
    note(scoreId);
    steps.push(buildScoreStep(run, evidence, score, scoreId, context));
  }

  for (const selectionId of evidence.selectionIds) {
    const selection = (run.candidateSelections || []).find((entry) => entry.id === selectionId);
    note(selectionId);
    steps.push(buildSelectionStep(run, evidence, selection, selectionId, context));
  }

  for (const commitId of evidence.commitIds) {
    const commit = (run.commits || []).find((entry) => entry.id === commitId);
    note(commitId);
    const commitStep = buildCommitStep(run, evidence, commit, commitId);
    steps.push(commitStep);
    const verifierStep = buildVerifierStep(run, evidence, commit, commitId);
    if (verifierStep) steps.push(verifierStep);
  }

  // Fanin and coordinator-decision adopters (blackboard -> fanin consolidation).
  const faninIds = new Set((run.multiAgent?.fanins || []).map((entry) => entry.id));
  const decisions = run.blackboard?.decisions || [];
  for (const adopter of unique(adopters)) {
    if (faninIds.has(adopter)) {
      note(adopter);
      steps.push(buildFaninStep(run, evidence, adopter, decisions));
    } else {
      const decision = decisions.find((entry) => entry.id === adopter);
      if (decision) {
        note(decision.id);
        steps.push(buildDecisionStep(run, evidence, decision));
      }
    }
  }

  // An adopted/rejected item that produced no decision-gate step has a known
  // WHAT but no recorded WHY: fail closed with an explicit unexplained step so
  // the gap is visible rather than silently treated as adopted.
  if (!steps.length && isDecisionStatus(evidence.status)) {
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
    unexplainedReasons
  };
}

// ---------------------------------------------------------------------------
// Per-gate steps
// ---------------------------------------------------------------------------

function buildScoreStep(
  run: WorkflowRun,
  evidence: MultiAgentOperatorEvidence,
  score: CandidateScore | undefined,
  scoreId: string,
  context: DerivationContext
): EvidenceReasoningStep {
  const decision: EvidenceReasoningStatus = score?.verdict === "fail" ? "rejected" : "adopted";
  const judge = context.auditEvents.find(
    (event) =>
      event.kind === "judge.rationale" &&
      event.decision === "accepted" &&
      (event.scoreId === scoreId || (!event.scoreId && event.candidateId && evidence.candidateIds.includes(event.candidateId)))
  );
  const rationaleText = score?.notes || judgeRationaleText(judge);
  const rationale: EvidenceReasoningRationale = rationaleText
    ? {
        status: "explained",
        text: truncate(rationaleText),
        sourceKind: score?.notes ? "score-notes" : "judge-rationale",
        sourceId: score?.notes ? scoreId : judge?.id,
        scoreCriteria: score?.criteria,
        scoreDelta: context.counterfactuals.bestRejectedNormalized !== undefined && score
          ? round(score.normalized - context.counterfactuals.bestRejectedNormalized)
          : undefined
      }
    : unexplainedRationale();
  // AUTHORITY: the judge role that authored the rationale, when recorded; the
  // host that mechanically wrote the score is the fallback actor.
  const auditIds = unique([...collectAuditIds(score), ...(judge ? [judge.id] : [])]);
  return {
    gate: "candidate-score",
    decision,
    basis: basisFor(evidence, { auditEventIds: auditIds, evidenceRefs: scoreEvidenceRefs(score) }),
    authority: roleAuthority(run, judge?.agentRoleId || score?.scorer, judge ? judge.decision === "accepted" : undefined),
    rationale,
    counterfactuals: decision === "adopted" ? context.counterfactuals.forScoreGate : []
  };
}

function buildSelectionStep(
  run: WorkflowRun,
  evidence: MultiAgentOperatorEvidence,
  selection: CandidateSelection | undefined,
  selectionId: string,
  context: DerivationContext
): EvidenceReasoningStep {
  const rationaleText = selection?.reason;
  const acceptance = selection?.acceptanceRationale;
  const rationale: EvidenceReasoningRationale = rationaleText
    ? {
        status: "explained",
        text: truncate(rationaleText),
        sourceKind: "selection-reason",
        sourceId: selectionId,
        scoreCriteria: acceptance?.scoreCriteria,
        judgeRationaleIds: acceptance?.judgeRationaleIds,
        panelDecisionId: acceptance?.panelDecisionId
      }
    : acceptance
      ? {
          status: "explained",
          text: `commit gate ${acceptance.commitGateResult || "recorded"} with ${acceptance.evidenceCount} evidence ref(s)`,
          sourceKind: "acceptance-rationale",
          sourceId: selectionId,
          scoreCriteria: acceptance.scoreCriteria,
          judgeRationaleIds: acceptance.judgeRationaleIds,
          panelDecisionId: acceptance.panelDecisionId
        }
      : unexplainedRationale();
  // AUTHORITY: the chair role recorded as the author of the candidate-synthesis
  // coordinator decision for this selection; the host is the fallback actor.
  const synthesis = (run.blackboard?.decisions || []).find(
    (entry) => entry.kind === "candidate-synthesis" && entry.subjectIds.includes(selectionId) && entry.author?.kind === "role"
  );
  return {
    gate: "selection",
    decision: "adopted",
    basis: basisFor(evidence, {
      auditEventIds: acceptance?.auditEventIds || [],
      evidenceRefs: (selection?.evidence || []).map(evidenceRef).filter(Boolean)
    }),
    authority: roleAuthority(run, synthesis?.author?.id || selection?.selectedBy, true),
    rationale,
    counterfactuals: context.counterfactuals.forSelectionGate
  };
}

function buildCommitStep(
  run: WorkflowRun,
  evidence: MultiAgentOperatorEvidence,
  commit: StateCommit | undefined,
  commitId: string
): EvidenceReasoningStep {
  const decision: EvidenceReasoningStatus = commit?.verifierGated ? "adopted" : "pending";
  const rationale: EvidenceReasoningRationale = commit?.reason
    ? {
        status: "explained",
        text: truncate(commit.reason),
        sourceKind: "commit-reason",
        sourceId: commitId
      }
    : decision === "adopted"
      ? unexplainedRationale()
      : { status: "not-applicable" };
  return {
    gate: "commit",
    decision,
    basis: basisFor(evidence, {
      auditEventIds: commit?.acceptanceRationale?.auditEventIds || [],
      evidenceRefs: (commit?.evidence || []).map(evidenceRef).filter(Boolean)
    }),
    authority: {
      actor: commitId,
      actorKind: "runtime",
      allowed: commit?.verifierGated
    },
    rationale,
    counterfactuals: []
  };
}

function buildVerifierStep(
  run: WorkflowRun,
  evidence: MultiAgentOperatorEvidence,
  commit: StateCommit | undefined,
  commitId: string
): EvidenceReasoningStep | undefined {
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
    counterfactuals: []
  };
}

function buildFaninStep(
  run: WorkflowRun,
  evidence: MultiAgentOperatorEvidence,
  faninId: string,
  decisions: CoordinatorDecision[]
): EvidenceReasoningStep {
  const fanin = (run.multiAgent?.fanins || []).find((entry) => entry.id === faninId);
  const readiness = decisions.find((entry) => entry.kind === "fanin-readiness" && entry.subjectIds.includes(faninId));
  const adopted = evidence.adoptedBy.includes(faninId);
  const decision: EvidenceReasoningStatus = adopted ? "adopted" : "pending";
  let rationale: EvidenceReasoningRationale;
  if (readiness?.reason) {
    rationale = { status: "explained", text: truncate(readiness.reason), sourceKind: "coordinator-decision", sourceId: readiness.id };
  } else if (fanin && fanin.verifierReady && coverageComplete(fanin, evidence)) {
    rationale = {
      status: "explained",
      text: `fanin ${faninId} ready: required evidence covered under "${fanin.strategy}" strategy`,
      sourceKind: "coordinator-decision",
      sourceId: faninId
    };
  } else if (fanin && fanin.blockedReasons.length) {
    rationale = { status: "explained", text: truncate(fanin.blockedReasons[0]), sourceKind: "coordinator-decision", sourceId: faninId };
  } else {
    rationale = decision === "adopted" ? unexplainedRationale() : { status: "not-applicable" };
  }
  return {
    gate: "fanin",
    decision,
    basis: basisFor(evidence, { auditEventIds: [], evidenceRefs: [] }),
    authority: { actor: faninId, actorKind: "coordinator", allowed: adopted },
    rationale,
    counterfactuals: []
  };
}

function buildDecisionStep(
  run: WorkflowRun,
  evidence: MultiAgentOperatorEvidence,
  decision: CoordinatorDecision
): EvidenceReasoningStep {
  const status = mapDecisionOutcome(decision.outcome);
  return {
    gate: "fanin",
    decision: status,
    basis: basisFor(evidence, { auditEventIds: [], evidenceRefs: decision.evidenceRefs || [] }),
    authority: {
      actor: decision.author?.id || decision.id,
      actorKind: authorKind(decision.author?.kind),
      allowed: decision.outcome === "accepted" || decision.outcome === "ready"
    },
    rationale: decision.reason
      ? { status: "explained", text: truncate(decision.reason), sourceKind: "coordinator-decision", sourceId: decision.id }
      : isDecisionStatus(status)
        ? unexplainedRationale()
        : { status: "not-applicable" },
    counterfactuals: []
  };
}

function buildUnexplainedStep(evidence: MultiAgentOperatorEvidence): EvidenceReasoningStep {
  // The item is marked adopted/rejected but no decision record carries a reason.
  // Render the gap explicitly (fail closed) rather than inferring a rationale.
  return {
    gate: "fanin",
    decision: mapStatus(evidence.status),
    basis: basisFor(evidence, { auditEventIds: [], evidenceRefs: [] }),
    authority: {
      actor: evidence.adoptedBy[0] || evidence.rejectedBy[0] || evidence.sourceId,
      actorKind: actorKindForSource(evidence.sourceKind),
      allowed: evidence.status === "adopted"
    },
    rationale: evidence.reason
      ? { status: "explained", text: truncate(evidence.reason), sourceKind: "coordinator-decision", sourceId: evidence.sourceId }
      : unexplainedRationale(),
    counterfactuals: []
  };
}

// ---------------------------------------------------------------------------
// Counterfactuals
// ---------------------------------------------------------------------------

function deriveCounterfactuals(run: WorkflowRun, scores: Map<string, CandidateScore>): DerivationContext["counterfactuals"] {
  const forScoreGate: EvidenceReasoningCounterfactual[] = [];
  const forSelectionGate: EvidenceReasoningCounterfactual[] = [];
  let bestRejectedNormalized: number | undefined;

  for (const candidate of run.candidates || []) {
    if (candidate.status === "rejected" || candidate.status === "failed") {
      forSelectionGate.push({
        ref: candidate.id,
        kind: "candidate",
        status: candidate.status === "failed" ? "rejected" : "rejected",
        reason: candidate.feedbackIds[0] ? `see feedback ${candidate.feedbackIds[0]}` : `candidate ${candidate.id} ${candidate.status}`
      });
      for (const scoreId of candidate.scores || []) {
        const score = scores.get(scoreId);
        if (score && (bestRejectedNormalized === undefined || score.normalized > bestRejectedNormalized)) {
          bestRejectedNormalized = score.normalized;
        }
      }
    }
  }

  for (const [scoreId, score] of scores) {
    if (score.verdict === "fail") {
      forScoreGate.push({
        ref: scoreId,
        kind: "score",
        status: "rejected",
        reason: score.notes ? truncate(score.notes) : `score ${scoreId} verdict=fail (normalized ${round(score.normalized)})`
      });
    }
  }

  for (const decision of run.blackboard?.decisions || []) {
    if (decision.outcome === "rejected" || decision.outcome === "superseded" || decision.outcome === "conflicting") {
      forSelectionGate.push({
        ref: decision.id,
        kind: "decision",
        status: mapDecisionOutcome(decision.outcome),
        reason: decision.reason ? truncate(decision.reason) : `decision ${decision.id} ${decision.outcome}`
      });
    }
  }

  return {
    forScoreGate: forScoreGate.sort(byRef),
    forSelectionGate: forSelectionGate.sort(byRef),
    bestRejectedNormalized
  };
}

// ---------------------------------------------------------------------------
// Compaction exemption
//
// FreeBSD tenet — ORTHOGONALITY & COMPOSABILITY: the reasoning chain composes
// with the existing graph views and must survive compaction. A reasoning step is
// on the critical path and must NEVER be collapsed into a synthetic summary
// node. This returns the operator-graph node ids backing every decision-bearing
// reasoning step of an adopted chain, so state-explosion can protect them.
// ---------------------------------------------------------------------------

export function reasoningCriticalNodeIds(
  run: WorkflowRun,
  operator: Pick<ReturnType<typeof summarizeMultiAgentOperator>, "evidence"> = summarizeMultiAgentOperator(run)
): string[] {
  const ids = new Set<string>();
  const faninIds = new Set((run.multiAgent?.fanins || []).map((entry) => entry.id));
  const commitById = new Map((run.commits || []).map((commit) => [commit.id, commit]));
  for (const evidence of operator.evidence) {
    if (evidence.status !== "adopted") continue;
    for (const id of evidence.candidateIds) ids.add(`${run.id}:candidate:${id}`);
    for (const id of evidence.scoreIds) ids.add(`${run.id}:score:${id}`);
    for (const id of evidence.selectionIds) ids.add(`${run.id}:selection:${id}`);
    for (const id of evidence.commitIds) {
      const commit = commitById.get(id);
      ids.add(commit?.stateNodeId || `${run.id}:commit:${id}`);
    }
    for (const adopter of evidence.adoptedBy) {
      if (faninIds.has(adopter)) ids.add(`${run.id}:multi-agent:fanin:${adopter}`);
    }
  }
  return [...ids].sort();
}

// ---------------------------------------------------------------------------
// Persistence + refresh (mirrors state-explosion summaries discipline)
// ---------------------------------------------------------------------------

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
    entries.push({
      id: chain.id,
      path: file,
      evidenceStatus: chain.evidenceStatus,
      rationaleStatus: chain.rationaleStatus,
      sourceFingerprint: fingerprintChains([chain])
    });
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
    nextAction: `node scripts/cw.js multi-agent reasoning ${run.id}`
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

// ---------------------------------------------------------------------------
// Eval normalization (deterministic, timestamp/path-free)
//
// Mirrors normalizeStateExplosionForEval: optional sections so pre-v0.1.26
// snapshots stay loadable. Proves freshness, evidence/reasoning parity under
// compaction, fail-closed `unexplained` on missing rationale, and determinism.
// ---------------------------------------------------------------------------

export interface EvidenceReasoningEvalSections {
  reasoningFreshness: string[];
  reasoningChains: string[];
  reasoningUnexplained: string[];
}

export function normalizeEvidenceReasoningForEval(run: WorkflowRun): EvidenceReasoningEvalSections {
  // Derive without the persisted index: a replay run has no reasoning/index.json,
  // so persistence-derived freshness status would drift. Parity is asserted over
  // the derived content (the CLI smoke test covers valid|stale|absent behavior).
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
        rejected: report.totals.rejected
      })
    ],
    reasoningChains: report.chains
      .map((chain) =>
        JSON.stringify({
          id: stripRunId(run, chain.id),
          evidenceStatus: chain.evidenceStatus,
          rationaleStatus: chain.rationaleStatus,
          gates: chain.steps.map((step) => `${step.gate}:${step.decision}:${step.rationale.status}`),
          counterfactuals: chain.steps.reduce((total, step) => total + step.counterfactuals.length, 0)
        })
      )
      .sort(),
    reasoningUnexplained: report.chains
      .filter((chain) => chain.rationaleStatus === "unexplained")
      .map((chain) => stripRunId(run, chain.id))
      .sort()
  };
}

function stripRunId(run: WorkflowRun, id: string): string {
  return id.startsWith(`${run.id}:`) ? id.slice(run.id.length + 1) : id;
}

// ---------------------------------------------------------------------------
// Human formatting (stable, six-panel-compatible idiom)
// ---------------------------------------------------------------------------

export function formatEvidenceReasoningReport(report: EvidenceReasoningReport): string {
  const lines: string[] = [];
  lines.push(`Evidence Adoption Reasoning: ${report.runId}`);
  lines.push(`Freshness: ${report.freshness.status}`);
  lines.push("");
  lines.push("Adoption Rationale");
  lines.push(
    `  chains=${report.totals.chains}; explained=${report.totals.explained}; unexplained=${report.totals.unexplained}; n/a=${report.totals.notApplicable}; adopted=${report.totals.adopted}; rejected=${report.totals.rejected}`
  );
  lines.push("");
  if (!report.chains.length) {
    lines.push("  none");
  }
  for (const chain of report.chains.slice(0, 60)) {
    lines.push(`  [${chain.evidenceStatus}/${chain.rationaleStatus}] ${chain.id} (${chain.ref || chain.sourceKind})`);
    for (const step of chain.steps) {
      const actor = `${step.authority.actorKind}:${step.authority.actor || "unknown"}`;
      const why = step.rationale.status === "explained" ? step.rationale.text : `(${step.rationale.status})`;
      const policy = step.authority.policyRef ? ` policy=${step.authority.policyRef}` : "";
      lines.push(`    - ${step.gate} [${step.decision}] by ${actor}${policy}: ${why}`);
      for (const cf of step.counterfactuals.slice(0, 4)) {
        lines.push(`        x ${cf.kind} ${cf.ref} [${cf.status}]: ${cf.reason}`);
      }
    }
    for (const reason of chain.unexplainedReasons) lines.push(`    ! ${reason}`);
  }
  if (report.chains.length > 60) lines.push(`  ... ${report.chains.length - 60} more`);
  lines.push("");
  lines.push("Next Action");
  lines.push(`  ${report.nextAction}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basisFor(
  evidence: MultiAgentOperatorEvidence,
  extra: { auditEventIds: string[]; evidenceRefs: string[] }
): EvidenceReasoningStep["basis"] {
  return {
    evidenceRefs: unique([evidence.locator || evidence.path || evidence.ref || evidence.id, ...extra.evidenceRefs].filter(Boolean)),
    provenanceSource: provenanceSourceFor(evidence),
    parentEvidenceIds: [],
    auditEventIds: unique(extra.auditEventIds.filter(Boolean))
  };
}

function provenanceSourceFor(evidence: MultiAgentOperatorEvidence): EvidenceReasoningStep["basis"]["provenanceSource"] {
  const value = evidence.provenanceSource;
  if (value === "cw-validated" || value === "host-attested" || value === "operator-recorded" || value === "runtime-derived") {
    return value;
  }
  return undefined;
}

// AUTHORITY resolver: links the actor to its role policy when the actor is a
// role; never fabricates a policy. allowed comes from the recorded decision.
function roleAuthority(run: WorkflowRun, actor: string | undefined, allowed?: boolean): EvidenceReasoningAuthority {
  const role = (run.multiAgent?.roles || []).find((entry) => entry.id === actor);
  const policyRef = role ? (role.policy || policyForRole(role)).policyRef : undefined;
  return {
    actor,
    actorKind: role ? "role" : actor === "multi-agent-host" ? "operator" : actorKindForActor(actor),
    policyRef,
    allowed
  };
}

function rollupRationale(steps: EvidenceReasoningStep[], evidenceStatus: EvidenceReasoningStatus): EvidenceRationaleStatus {
  const decisionSteps = steps.filter((step) => isDecisionStatus(step.decision));
  if (!decisionSteps.length) return "not-applicable";
  // Explained only when EVERY decision-bearing step is explained — fail closed.
  if (decisionSteps.some((step) => step.rationale.status === "unexplained")) return "unexplained";
  if (decisionSteps.every((step) => step.rationale.status === "explained")) return "explained";
  return evidenceStatus === "adopted" ? "unexplained" : "not-applicable";
}

function summarizeTotals(chains: EvidenceReasoningChain[]): EvidenceReasoningReport["totals"] {
  const byStatus: Record<string, number> = {};
  let explained = 0;
  let unexplained = 0;
  let notApplicable = 0;
  let adopted = 0;
  let rejected = 0;
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

function readAllScores(run: WorkflowRun): Map<string, CandidateScore> {
  const scores = new Map<string, CandidateScore>();
  const candidatesDir = run.paths.candidatesDir || path.join(run.paths.runDir, "candidates");
  for (const candidate of run.candidates || []) {
    const dir = path.join(candidatesDir, safeFileName(candidate.id), "scores");
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((entry) => entry.endsWith(".json")).sort()) {
      try {
        const score = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as CandidateScore;
        scores.set(score.id, score);
      } catch {
        // Unreadable score record: skip; the score gate will fail closed.
      }
    }
  }
  return scores;
}

function fingerprintChains(chains: EvidenceReasoningChain[]): string {
  const lines = chains.map((chain) =>
    JSON.stringify([
      chain.id,
      chain.evidenceStatus,
      chain.rationaleStatus,
      chain.steps.map((step) => [step.gate, step.decision, step.rationale.status, step.rationale.sourceId || ""])
    ])
  );
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify([...lines].sort()));
  return `sha256:${hash.digest("hex").slice(0, 32)}`;
}

function unexplainedRationale(): EvidenceReasoningRationale {
  return { status: "unexplained" };
}

function judgeRationaleText(event: TrustAuditEvent | undefined): string | undefined {
  const value = event?.metadata?.rationale;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function collectAuditIds(score: CandidateScore | undefined): string[] {
  const ids: string[] = [];
  for (const item of score?.evidence || []) {
    for (const id of item.provenance?.auditEventIds || []) ids.push(id);
  }
  return ids;
}

function scoreEvidenceRefs(score: CandidateScore | undefined): string[] {
  return (score?.evidence || []).map(evidenceRef).filter(Boolean);
}

function evidenceRef(item: { id?: string; locator?: string; path?: string; summary?: string }): string {
  return item.locator || item.path || item.summary || item.id || "";
}

function coverageComplete(fanin: { evidenceCoverage: Array<{ complete: boolean }> }, _evidence: MultiAgentOperatorEvidence): boolean {
  return fanin.evidenceCoverage.length > 0 && fanin.evidenceCoverage.every((entry) => entry.complete);
}

function mapStatus(status: MultiAgentOperatorEvidence["status"]): EvidenceReasoningStatus {
  return status;
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
  return { adopted: 0, pending: 1, missing: 2, conflicting: 3, rejected: 4, superseded: 5, unexplained: 6 }[status];
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
