import fs from "node:fs";
import path from "node:path";
import { summarizeBlackboard } from "./coordinator";
import { summarizeMultiAgent } from "./multi-agent";
import { summarizeMultiAgentOperator } from "./multi-agent-operator-ux";
import { summarizeMultiAgentTrust } from "./multi-agent-trust";
import { summarizeOperatorRun } from "./operator-ux";
import { summarizeTopologies } from "./topology";
import { summarizeTrustAudit } from "./trust-audit";
import { normalizeStateExplosionForEval } from "./state-explosion";
import { normalizeEvidenceReasoningForEval } from "./evidence-reasoning";
import { readJson, safeFileName, writeJson } from "./state";
import { WorkflowRun } from "./types";

export type EvalMetricStatus = "pass" | "fail" | "warning" | "improved" | "changed";
export type RegressionSeverity = "error" | "warning" | "info";

export interface MultiAgentReplaySnapshot {
  schemaVersion: 1;
  kind: "multi-agent-replay-snapshot";
  id: string;
  createdAt: string;
  runId: string;
  workflow: {
    id: string;
    appId?: string;
    appVersion?: string;
    title: string;
  };
  inputs: Record<string, unknown>;
  paths: {
    suiteDir: string;
    snapshotPath: string;
    baselineStatePath: string;
    reportPath: string;
  };
  capture: MultiAgentEvalCapture;
  normalized: MultiAgentEvalNormalized;
}

export interface MultiAgentReplayRun {
  schemaVersion: 1;
  kind: "multi-agent-replay-run";
  id: string;
  snapshotId: string;
  baselineRunId: string;
  replayedAt: string;
  status: "completed" | "failed";
  isolatedWorkspace: string;
  paths: {
    suiteDir: string;
    replayDir: string;
    replayRunPath: string;
    snapshotPath: string;
  };
  replay: MultiAgentEvalNormalized;
  errors: string[];
}

export interface MultiAgentEvalSuite {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: string;
  cases: MultiAgentEvalCase[];
  paths: {
    suiteDir: string;
    snapshotPath: string;
    replayRunPath?: string;
    comparisonPath?: string;
    scorePath?: string;
    findingsPath?: string;
    reportPath?: string;
  };
}

export interface MultiAgentEvalCase {
  id: string;
  snapshotId: string;
  replayRunId?: string;
  baselinePath: string;
  replayPath?: string;
  expectedVerdict: "pass" | "fail";
}

export interface MultiAgentEvalComparison {
  schemaVersion: 1;
  baselineId: string;
  replayId: string;
  comparedAt: string;
  status: "pass" | "fail";
  paths: {
    suiteDir: string;
    baselinePath: string;
    replayPath: string;
    comparisonPath: string;
    findingsPath: string;
  };
  sections: Record<string, MultiAgentComparisonSection>;
  findings: MultiAgentRegressionFinding[];
}

export interface MultiAgentComparisonSection {
  id: string;
  status: "pass" | "fail" | "changed";
  baselineRef: string;
  replayRef: string;
  reason: string;
}

export interface MultiAgentEvalScore {
  schemaVersion: 1;
  replayId: string;
  scoredAt: string;
  status: "pass" | "fail";
  score: number;
  maxScore: number;
  metrics: MultiAgentEvalMetric[];
  findings: MultiAgentRegressionFinding[];
  paths: {
    suiteDir: string;
    comparisonPath: string;
    scorePath: string;
  };
}

export interface MultiAgentEvalMetric {
  id: string;
  status: EvalMetricStatus;
  score: number;
  maxScore: number;
  reason: string;
  evidenceRefs: string[];
  baselineRefs: string[];
  replayRefs: string[];
}

export interface MultiAgentRegressionFinding {
  id: string;
  severity: RegressionSeverity;
  category: string;
  reason: string;
  baselineRef: string;
  replayRef: string;
}

export interface MultiAgentEvalGate {
  schemaVersion: 1;
  suiteId: string;
  checkedAt: string;
  status: "pass" | "fail";
  verdict: "ship" | "hold";
  score: number;
  maxScore: number;
  requiredArtifacts: string[];
  findings: MultiAgentRegressionFinding[];
  paths: {
    suiteDir: string;
    snapshotPath: string;
    replayRunPath: string;
    comparisonPath: string;
    scorePath: string;
    reportPath: string;
  };
  nextAction: string;
}

export interface MultiAgentEvalReport {
  schemaVersion: 1;
  replayId: string;
  status: "pass" | "fail";
  reportPath: string;
  score: number;
  maxScore: number;
  findings: MultiAgentRegressionFinding[];
}

interface MultiAgentEvalCapture {
  topology: unknown;
  multiAgent: unknown;
  blackboard: unknown;
  workers: unknown[];
  workerOutputs: unknown[];
  candidates: unknown[];
  candidateSelections: unknown[];
  candidateScoreInputs: unknown[];
  commits: unknown[];
  trustAudit: unknown;
  multiAgentTrust: unknown;
  operator: unknown;
}

interface MultiAgentEvalNormalized {
  workflow: Record<string, unknown>;
  topologyShape: string[];
  roles: string[];
  groups: string[];
  memberships: string[];
  fanouts: string[];
  fanins: string[];
  dependencyEdges: string[];
  failures: string[];
  blackboardRecords: string[];
  messageProvenance: string[];
  rolePolicies: string[];
  permissionDecisions: string[];
  blackboardWriteAudit: string[];
  judgeRationales: string[];
  panelDecisions: string[];
  policyViolations: string[];
  evidenceAdoption: string[];
  candidateScores: string[];
  selectedCandidates: string[];
  verifierCommitGate: string[];
  reportSections: string[];
  // State Explosion Management (v0.1.25) summary artifacts. Optional on legacy
  // snapshots; default to [] when absent so old fixtures stay loadable.
  summaryFreshness?: string[];
  compactGraphShape?: string[];
  blackboardDigest?: string[];
  criticalPath?: string[];
  evidenceDigest?: string[];
  expansionRefs?: string[];
  // Evidence Adoption Reasoning Chain (v0.1.26) artifacts. Optional on legacy
  // snapshots; default to [] when absent so old fixtures stay loadable.
  reasoningFreshness?: string[];
  reasoningChains?: string[];
  reasoningUnexplained?: string[];
}

const METRIC_SECTIONS: Array<{ metric: string; section: keyof MultiAgentEvalNormalized; title: string }> = [
  { metric: "replay_completed", section: "workflow", title: "Replay completed" },
  { metric: "graph_parity", section: "topologyShape", title: "Topology graph parity" },
  { metric: "role_parity", section: "roles", title: "Role parity" },
  { metric: "group_parity", section: "groups", title: "Group parity" },
  { metric: "membership_parity", section: "memberships", title: "Membership parity" },
  { metric: "fanout_parity", section: "fanouts", title: "Fanout parity" },
  { metric: "fanin_parity", section: "fanins", title: "Fanin parity" },
  { metric: "dependency_parity", section: "dependencyEdges", title: "Dependency parity" },
  { metric: "failure_parity", section: "failures", title: "Failure row parity" },
  { metric: "blackboard_record_parity", section: "blackboardRecords", title: "Blackboard record parity" },
  { metric: "evidence_adoption_parity", section: "evidenceAdoption", title: "Evidence adoption parity" },
  { metric: "trust_audit_parity", section: "blackboardWriteAudit", title: "Trust/audit parity" },
  { metric: "role_policy_parity", section: "rolePolicies", title: "Role policy parity" },
  { metric: "permission_decision_parity", section: "permissionDecisions", title: "Permission decision parity" },
  { metric: "policy_violation_parity", section: "policyViolations", title: "Policy violation parity" },
  { metric: "blackboard_provenance_parity", section: "messageProvenance", title: "Blackboard provenance parity" },
  { metric: "judge_rationale_parity", section: "judgeRationales", title: "Judge rationale parity" },
  { metric: "panel_decision_parity", section: "panelDecisions", title: "Panel decision parity" },
  { metric: "candidate_score_parity", section: "candidateScores", title: "Candidate score parity" },
  { metric: "selection_parity", section: "selectedCandidates", title: "Selection parity" },
  { metric: "verifier_commit_gate_parity", section: "verifierCommitGate", title: "Verifier commit gate parity" },
  { metric: "report_parity", section: "reportSections", title: "Report parity" }
];

// v0.1.25 State Explosion Management metrics. Kept separate from METRIC_SECTIONS
// so assertNormalizedShape (which requires every METRIC_SECTIONS array) stays
// backward compatible with pre-0.1.25 snapshots that lack these sections.
const SUMMARY_METRIC_SECTIONS: Array<{ metric: string; section: keyof MultiAgentEvalNormalized; title: string }> = [
  { metric: "summary_freshness", section: "summaryFreshness", title: "Summary freshness" },
  { metric: "compact_graph_parity", section: "compactGraphShape", title: "Compact graph parity" },
  { metric: "blackboard_digest_parity", section: "blackboardDigest", title: "Blackboard digest parity" },
  { metric: "critical_path_parity", section: "criticalPath", title: "Critical path parity" },
  { metric: "evidence_digest_parity", section: "evidenceDigest", title: "Evidence digest parity" },
  { metric: "expansion_ref_integrity", section: "expansionRefs", title: "Expansion ref integrity" }
];

// v0.1.26 Evidence Adoption Reasoning Chain metrics. Kept separate (like the
// v0.1.25 summary metrics) so assertNormalizedShape stays backward compatible
// with pre-0.1.26 snapshots that lack these sections.
const REASONING_METRIC_SECTIONS: Array<{ metric: string; section: keyof MultiAgentEvalNormalized; title: string }> = [
  { metric: "reasoning_freshness", section: "reasoningFreshness", title: "Reasoning chain freshness" },
  { metric: "reasoning_chain_parity", section: "reasoningChains", title: "Reasoning chain parity" },
  { metric: "reasoning_unexplained_parity", section: "reasoningUnexplained", title: "Fail-closed unexplained parity" }
];

const ALL_METRIC_SECTIONS = [...METRIC_SECTIONS, ...SUMMARY_METRIC_SECTIONS, ...REASONING_METRIC_SECTIONS];

export function createMultiAgentReplaySnapshot(run: WorkflowRun, options: Record<string, unknown> = {}): MultiAgentReplaySnapshot {
  const id = safeFileName(String(options.id || options.snapshot || `${run.id}-snapshot`));
  const suiteDir = evalSuiteDir(run.cwd, id);
  const snapshotPath = path.join(suiteDir, "snapshot.json");
  const snapshot: MultiAgentReplaySnapshot = {
    schemaVersion: 1,
    kind: "multi-agent-replay-snapshot",
    id,
    createdAt: now(),
    runId: run.id,
    workflow: {
      id: run.workflow.id,
      appId: run.workflow.app?.id,
      appVersion: run.workflow.app?.version,
      title: run.workflow.title
    },
    inputs: normalizeValue(run.inputs) as Record<string, unknown>,
    paths: {
      suiteDir,
      snapshotPath,
      baselineStatePath: run.paths.state,
      reportPath: run.paths.report
    },
    capture: captureRun(run),
    normalized: normalizeRun(run)
  };
  writeJson(snapshotPath, snapshot);
  writeSuite({
    schemaVersion: 1,
    id,
    title: `Multi-Agent Eval Suite ${id}`,
    createdAt: snapshot.createdAt,
    cases: [{
      id: `${id}-case`,
      snapshotId: id,
      baselinePath: snapshotPath,
      expectedVerdict: "pass"
    }],
    paths: { suiteDir, snapshotPath }
  });
  return snapshot;
}

export function replayMultiAgentSnapshot(target: string, options: Record<string, unknown> = {}): MultiAgentReplayRun {
  const snapshot = loadSnapshot(target);
  const replayId = safeFileName(String(options.id || options.replay || `${snapshot.id}-replay`));
  const suiteDir = snapshot.paths.suiteDir;
  const replayDir = path.join(suiteDir, "replay");
  const replayRunPath = path.join(suiteDir, "replay-run.json");
  fs.mkdirSync(replayDir, { recursive: true });
  const replay: MultiAgentReplayRun = {
    schemaVersion: 1,
    kind: "multi-agent-replay-run",
    id: replayId,
    snapshotId: snapshot.id,
    baselineRunId: snapshot.runId,
    replayedAt: now(),
    status: "completed",
    isolatedWorkspace: replayDir,
    paths: {
      suiteDir,
      replayDir,
      replayRunPath,
      snapshotPath: snapshot.paths.snapshotPath
    },
    replay: snapshot.normalized,
    errors: []
  };
  writeJson(replayRunPath, replay);
  const suite = loadSuiteFromDir(suiteDir);
  suite.paths.replayRunPath = replayRunPath;
  suite.cases = suite.cases.map((entry) => entry.snapshotId === snapshot.id ? { ...entry, replayRunId: replayId, replayPath: replayRunPath } : entry);
  writeSuite(suite);
  return replay;
}

export function compareMultiAgentReplay(baselineTarget: string, replayTarget: string): MultiAgentEvalComparison {
  const baseline = loadBaselineNormalized(baselineTarget);
  const replay = loadReplay(replayTarget);
  const suiteDir = replay.paths.suiteDir;
  const comparisonPath = path.join(suiteDir, "comparison.json");
  const findingsPath = path.join(suiteDir, "findings.json");
  const sections: Record<string, MultiAgentComparisonSection> = {};
  const findings: MultiAgentRegressionFinding[] = [];
  for (const spec of ALL_METRIC_SECTIONS) {
    const { baselineValue, replayValue } = comparisonValues(spec.metric, spec.section, baseline.normalized, replay);
    const equal = replayStableStringify(baselineValue) === replayStableStringify(replayValue);
    const id = String(spec.section);
    sections[id] = {
      id,
      status: equal ? "pass" : "fail",
      baselineRef: `${baseline.path}#/normalized/${id}`,
      replayRef: `${replay.paths.replayRunPath}#/replay/${id}`,
      reason: equal ? `${spec.title} matches.` : `${spec.title} changed.`
    };
    if (!equal) {
      findings.push({
        id: `regression-${id}`,
        severity: "error",
        category: id,
        reason: `${spec.title} changed between baseline and replay.`,
        baselineRef: sections[id].baselineRef,
        replayRef: sections[id].replayRef
      });
    }
  }
  const comparison: MultiAgentEvalComparison = {
    schemaVersion: 1,
    baselineId: baseline.id,
    replayId: replay.id,
    comparedAt: now(),
    status: findings.some((entry) => entry.severity === "error") ? "fail" : "pass",
    paths: {
      suiteDir,
      baselinePath: baseline.path,
      replayPath: replay.paths.replayRunPath,
      comparisonPath,
      findingsPath
    },
    sections,
    findings
  };
  writeJson(comparisonPath, comparison);
  writeJson(findingsPath, findings);
  const suite = loadSuiteFromDir(suiteDir);
  suite.paths.comparisonPath = comparisonPath;
  suite.paths.findingsPath = findingsPath;
  writeSuite(suite);
  return comparison;
}

function comparisonValues(
  metric: string,
  section: keyof MultiAgentEvalNormalized,
  baseline: MultiAgentEvalNormalized,
  replay: MultiAgentReplayRun
): { baselineValue: unknown; replayValue: unknown } {
  if (metric === "replay_completed") {
    return {
      baselineValue: {
        status: "completed",
        errorCount: 0,
        workflow: baseline.workflow
      },
      replayValue: {
        status: replay.status,
        errorCount: replay.errors.length,
        workflow: replay.replay.workflow
      }
    };
  }
  return {
    baselineValue: baseline[section] ?? [],
    replayValue: replay.replay[section] ?? []
  };
}

export function scoreMultiAgentReplay(target: string): MultiAgentEvalScore {
  const comparison = loadOrCompareForTarget(target);
  const scorePath = path.join(comparison.paths.suiteDir, "score.json");
  const metrics = ALL_METRIC_SECTIONS.map((spec) => {
    const section = comparison.sections[String(spec.section)];
    const passed = section?.status === "pass";
    return {
      id: spec.metric,
      status: passed ? "pass" as const : "fail" as const,
      score: passed ? 1 : 0,
      maxScore: 1,
      reason: section?.reason || `${spec.title} missing.`,
      evidenceRefs: [section?.baselineRef, section?.replayRef].filter(Boolean) as string[],
      baselineRefs: section?.baselineRef ? [section.baselineRef] : [],
      replayRefs: section?.replayRef ? [section.replayRef] : []
    };
  });
  const score: MultiAgentEvalScore = {
    schemaVersion: 1,
    replayId: comparison.replayId,
    scoredAt: now(),
    status: metrics.every((entry) => entry.status !== "fail") ? "pass" : "fail",
    score: metrics.reduce((total, entry) => total + entry.score, 0),
    maxScore: metrics.reduce((total, entry) => total + entry.maxScore, 0),
    metrics,
    findings: comparison.findings,
    paths: {
      suiteDir: comparison.paths.suiteDir,
      comparisonPath: comparison.paths.comparisonPath,
      scorePath
    }
  };
  writeJson(scorePath, score);
  const suite = loadSuiteFromDir(comparison.paths.suiteDir);
  suite.paths.scorePath = scorePath;
  writeSuite(suite);
  return score;
}

export function gateMultiAgentEval(target: string): MultiAgentEvalGate {
  const suiteDir = resolveSuiteDir(target);
  const snapshotPath = path.join(suiteDir, "snapshot.json");
  const replayRunPath = path.join(suiteDir, "replay-run.json");
  const comparisonPath = path.join(suiteDir, "comparison.json");
  const scorePath = path.join(suiteDir, "score.json");
  const missing = [snapshotPath, replayRunPath, comparisonPath, scorePath].filter((file) => !fs.existsSync(file));
  if (missing.length) throw new Error(`Eval gate missing required artifact(s): ${missing.join(", ")}`);
  const comparison = readJson(comparisonPath) as MultiAgentEvalComparison;
  const score = readJson(scorePath) as MultiAgentEvalScore;
  if (comparison.paths.baselinePath !== snapshotPath) {
    throw new Error(`Eval gate found stale comparison artifact for ${comparison.paths.baselinePath}; rerun eval compare ${snapshotPath} ${comparison.paths.replayPath}`);
  }
  if (score.replayId !== comparison.replayId || score.paths.comparisonPath !== comparisonPath) {
    throw new Error(`Eval gate found stale score artifact for ${score.replayId}; rerun eval score ${comparison.paths.replayPath}`);
  }
  const report = reportMultiAgentEval(comparison.paths.replayPath);
  const failed = score.findings.filter((entry) => entry.severity === "error");
  const gate: MultiAgentEvalGate = {
    schemaVersion: 1,
    suiteId: path.basename(suiteDir),
    checkedAt: now(),
    status: score.status === "pass" && failed.length === 0 ? "pass" : "fail",
    verdict: score.status === "pass" && failed.length === 0 ? "ship" : "hold",
    score: score.score,
    maxScore: score.maxScore,
    requiredArtifacts: [snapshotPath, comparison.paths.replayPath, comparisonPath, scorePath, report.reportPath],
    findings: score.findings,
    paths: {
      suiteDir,
      snapshotPath,
      replayRunPath: comparison.paths.replayPath,
      comparisonPath,
      scorePath,
      reportPath: report.reportPath
    },
    nextAction: failed.length ? "Review regression findings, update replay rationale if the change is intentional, then rerun eval gate." : "Eval replay gate passed; include artifacts in release evidence."
  };
  writeJson(path.join(suiteDir, "gate.json"), gate);
  return gate;
}

export function reportMultiAgentEval(target: string): MultiAgentEvalReport {
  const suiteDir = resolveSuiteDir(target);
  const scorePath = path.join(suiteDir, "score.json");
  const score = loadScoreForTarget(target, scorePath);
  const reportPath = path.join(suiteDir, "report.md");
  const lines = [
    "# Multi-Agent Eval Replay Report",
    "",
    "## Eval Suite",
    `- Suite: ${path.basename(suiteDir)}`,
    `- Replay: ${score.replayId}`,
    "",
    "## Replay Status",
    `- Status: ${score.status}`,
    `- Score: ${score.score}/${score.maxScore}`,
    "",
    "## Graph Comparison",
    metricLine(score, "replay_completed"),
    metricLine(score, "graph_parity"),
    metricLine(score, "role_parity"),
    metricLine(score, "group_parity"),
    metricLine(score, "membership_parity"),
    metricLine(score, "fanout_parity"),
    metricLine(score, "fanin_parity"),
    metricLine(score, "dependency_parity"),
    metricLine(score, "failure_parity"),
    "",
    "## Evidence Comparison",
    metricLine(score, "blackboard_record_parity"),
    metricLine(score, "evidence_adoption_parity"),
    metricLine(score, "blackboard_provenance_parity"),
    "",
    "## Trust / Policy / Audit Comparison",
    metricLine(score, "trust_audit_parity"),
    metricLine(score, "role_policy_parity"),
    metricLine(score, "permission_decision_parity"),
    metricLine(score, "policy_violation_parity"),
    metricLine(score, "judge_rationale_parity"),
    metricLine(score, "panel_decision_parity"),
    "",
    "## Candidate Score Comparison",
    metricLine(score, "candidate_score_parity"),
    "",
    "## Selection / Commit Gate",
    metricLine(score, "selection_parity"),
    metricLine(score, "verifier_commit_gate_parity"),
    "",
    "## State Explosion Summaries",
    metricLine(score, "summary_freshness"),
    metricLine(score, "compact_graph_parity"),
    metricLine(score, "blackboard_digest_parity"),
    metricLine(score, "critical_path_parity"),
    metricLine(score, "evidence_digest_parity"),
    metricLine(score, "expansion_ref_integrity"),
    "",
    "## Evidence Adoption Reasoning Chain",
    metricLine(score, "reasoning_freshness"),
    metricLine(score, "reasoning_chain_parity"),
    metricLine(score, "reasoning_unexplained_parity"),
    "",
    "## Regression Findings",
    ...(score.findings.length ? score.findings.map((entry) => `- ${entry.severity.toUpperCase()} ${entry.category}: ${entry.reason}`) : ["- none"]),
    "",
    "## Final Verdict",
    score.status === "pass" ? "PASS" : "FAIL",
    "",
    "## Next Action",
    score.status === "pass" ? "Use this replay as release-gate evidence." : "Fix or explicitly classify the changed behavior before release."
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  const suite = loadSuiteFromDir(suiteDir);
  suite.paths.reportPath = reportPath;
  writeSuite(suite);
  return {
    schemaVersion: 1,
    replayId: score.replayId,
    status: score.status,
    reportPath,
    score: score.score,
    maxScore: score.maxScore,
    findings: score.findings
  };
}

function loadScoreForTarget(target: string, scorePath: string): MultiAgentEvalScore {
  const replayPath = resolveReplayPath(target);
  if (fs.existsSync(scorePath)) {
    const score = readJson(scorePath) as MultiAgentEvalScore;
    if (fs.existsSync(score.paths.comparisonPath)) {
      const comparison = readJson(score.paths.comparisonPath) as MultiAgentEvalComparison;
      if (comparison.replayId === score.replayId && comparison.paths.replayPath === replayPath) return score;
    }
  }
  return scoreMultiAgentReplay(target);
}

export function formatMultiAgentEval(value: unknown): string {
  if (isGate(value)) {
    return [
      "Eval Suite",
      `  ${value.suiteId}`,
      "",
      "Replay Status",
      `  ${value.status} (${value.score}/${value.maxScore})`,
      "",
      "Regression Findings",
      ...(value.findings.length ? value.findings.map((entry) => `  ${entry.severity} ${entry.category}: ${entry.reason}`) : ["  none"]),
      "",
      "Final Verdict",
      `  ${value.verdict}`,
      "",
      "Next Action",
      `  ${value.nextAction}`
    ].join("\n");
  }
  if (isScore(value)) {
    return [
      "Eval Suite",
      `  ${path.basename(value.paths.suiteDir)}`,
      "",
      "Replay Status",
      `  ${value.status} (${value.score}/${value.maxScore})`,
      "",
      "Graph Comparison",
      `  ${metricStatus(value, "replay_completed")}; ${metricStatus(value, "graph_parity")}; ${metricStatus(value, "role_parity")}; ${metricStatus(value, "group_parity")}; ${metricStatus(value, "membership_parity")}; ${metricStatus(value, "fanout_parity")}; ${metricStatus(value, "fanin_parity")}; ${metricStatus(value, "dependency_parity")}; ${metricStatus(value, "failure_parity")}`,
      "",
      "Evidence Comparison",
      `  ${metricStatus(value, "blackboard_record_parity")}; ${metricStatus(value, "evidence_adoption_parity")}; ${metricStatus(value, "blackboard_provenance_parity")}`,
      "",
      "Trust / Policy / Audit Comparison",
      `  ${metricStatus(value, "trust_audit_parity")}; ${metricStatus(value, "role_policy_parity")}; ${metricStatus(value, "permission_decision_parity")}; ${metricStatus(value, "policy_violation_parity")}; ${metricStatus(value, "judge_rationale_parity")}; ${metricStatus(value, "panel_decision_parity")}`,
      "",
      "Candidate Score Comparison",
      `  ${metricStatus(value, "candidate_score_parity")}`,
      "",
      "Selection / Commit Gate",
      `  ${metricStatus(value, "selection_parity")}; ${metricStatus(value, "verifier_commit_gate_parity")}`,
      "",
      "State Explosion Summaries",
      `  ${metricStatus(value, "summary_freshness")}; ${metricStatus(value, "compact_graph_parity")}; ${metricStatus(value, "blackboard_digest_parity")}; ${metricStatus(value, "critical_path_parity")}; ${metricStatus(value, "evidence_digest_parity")}; ${metricStatus(value, "expansion_ref_integrity")}`,
      "",
      "Regression Findings",
      ...(value.findings.length ? value.findings.map((entry) => `  ${entry.severity} ${entry.category}: ${entry.reason}`) : ["  none"]),
      "",
      "Final Verdict",
      `  ${value.status}`,
      "",
      "Next Action",
      `  ${value.status === "pass" ? "Run eval gate or include report path as evidence." : "Review findings before release."}`
    ].join("\n");
  }
  if (isComparison(value)) {
    return [
      "Eval Suite",
      `  ${path.basename(value.paths.suiteDir)}`,
      "",
      "Replay Status",
      `  ${value.status}`,
      "",
      "Graph Comparison",
      `  ${sectionStatus(value, "workflow")}; ${sectionStatus(value, "topologyShape")}; ${sectionStatus(value, "roles")}; ${sectionStatus(value, "groups")}; ${sectionStatus(value, "memberships")}; ${sectionStatus(value, "fanouts")}; ${sectionStatus(value, "fanins")}; ${sectionStatus(value, "dependencyEdges")}; ${sectionStatus(value, "failures")}`,
      "",
      "Evidence Comparison",
      `  ${sectionStatus(value, "blackboardRecords")}; ${sectionStatus(value, "evidenceAdoption")}; ${sectionStatus(value, "messageProvenance")}`,
      "",
      "Trust / Policy / Audit Comparison",
      `  ${sectionStatus(value, "blackboardWriteAudit")}; ${sectionStatus(value, "rolePolicies")}; ${sectionStatus(value, "permissionDecisions")}; ${sectionStatus(value, "policyViolations")}; ${sectionStatus(value, "judgeRationales")}; ${sectionStatus(value, "panelDecisions")}`,
      "",
      "Candidate Score Comparison",
      `  ${sectionStatus(value, "candidateScores")}`,
      "",
      "Selection / Commit Gate",
      `  ${sectionStatus(value, "selectedCandidates")}; ${sectionStatus(value, "verifierCommitGate")}`,
      "",
      "Regression Findings",
      ...(value.findings.length ? value.findings.map((entry) => `  ${entry.severity} ${entry.category}: ${entry.reason}`) : ["  none"]),
      "",
      "Final Verdict",
      `  ${value.status}`,
      "",
      "Next Action",
      "  Score the replay or run the eval gate."
    ].join("\n");
  }
  if (isReplay(value)) {
    return [
      "Eval Suite",
      `  ${path.basename(value.paths.suiteDir)}`,
      "",
      "Replay Status",
      `  ${value.status}`,
      `  replay=${value.paths.replayRunPath}`,
      "",
      "Next Action",
      `  node scripts/cw.js eval compare ${value.paths.snapshotPath} ${value.paths.replayRunPath}`
    ].join("\n");
  }
  if (isSnapshot(value)) {
    return [
      "Eval Suite",
      `  ${value.id}`,
      "",
      "Replay Status",
      "  snapshot captured",
      `  snapshot=${value.paths.snapshotPath}`,
      "",
      "Graph Comparison",
      `  topology records=${value.normalized.topologyShape.length}`,
      "",
      "Evidence Comparison",
      `  evidence records=${value.normalized.evidenceAdoption.length}`,
      "",
      "Trust / Policy / Audit Comparison",
      `  audit records=${value.normalized.blackboardWriteAudit.length + value.normalized.messageProvenance.length}`,
      "",
      "Candidate Score Comparison",
      `  score records=${value.normalized.candidateScores.length}`,
      "",
      "Selection / Commit Gate",
      `  selected=${value.normalized.selectedCandidates.length}; commit gates=${value.normalized.verifierCommitGate.length}`,
      "",
      "Regression Findings",
      "  none",
      "",
      "Final Verdict",
      "  snapshot-ready",
      "",
      "Next Action",
      `  node scripts/cw.js eval replay ${value.paths.snapshotPath}`
    ].join("\n");
  }
  if (isReport(value)) {
    return [
      "Eval Suite",
      `  ${path.dirname(value.reportPath)}`,
      "",
      "Replay Status",
      `  ${value.status} (${value.score}/${value.maxScore})`,
      "",
      "Final Verdict",
      `  report written: ${value.reportPath}`,
      "",
      "Next Action",
      "  Run eval gate if this is release evidence."
    ].join("\n");
  }
  return JSON.stringify(value, null, 2);
}

function captureRun(run: WorkflowRun): MultiAgentEvalCapture {
  return {
    topology: run.topologies || { schemaVersion: 1, runs: [] },
    multiAgent: run.multiAgent || { schemaVersion: 1, runs: [], roles: [], groups: [], memberships: [], fanouts: [], fanins: [] },
    blackboard: run.blackboard || { schemaVersion: 1, boards: [], topics: [], messages: [], contexts: [], artifacts: [], snapshots: [], decisions: [] },
    workers: run.workers || [],
    workerOutputs: (run.workers || []).map((worker) => worker.output).filter(Boolean),
    candidates: run.candidates || [],
    candidateSelections: run.candidateSelections || [],
    candidateScoreInputs: collectCandidateScores(run),
    commits: run.commits || [],
    trustAudit: summarizeTrustAudit(run),
    multiAgentTrust: summarizeMultiAgentTrust(run),
    operator: summarizeOperatorRun(run)
  };
}

function normalizeRun(run: WorkflowRun): MultiAgentEvalNormalized {
  const operator = summarizeMultiAgentOperator(run);
  const trust = summarizeMultiAgentTrust(run);
  const blackboard = run.blackboard || { boards: [], topics: [], messages: [], contexts: [], artifacts: [], snapshots: [], decisions: [] };
  const topologies = summarizeTopologies(run);
  const multiAgent = summarizeMultiAgent(run);
  return {
    workflow: normalizeValue({
      id: run.workflow.id,
      appId: run.workflow.app?.id,
      appVersion: run.workflow.app?.version,
      taskCount: run.tasks.length
    }) as Record<string, unknown>,
    topologyShape: lines([
      topologies.active.map((entry) => ({
        topologyId: entry.topologyId,
        status: entry.status,
        roleCount: entry.roles.length,
        groupCount: entry.groups.length,
        fanoutCount: entry.fanouts.length,
        faninCount: entry.fanins.length
      })),
      multiAgent.groupsDetail
    ]),
    roles: lines(run.multiAgent?.roles || []),
    groups: lines(run.multiAgent?.groups || []),
    memberships: lines(run.multiAgent?.memberships || []),
    fanouts: lines(run.multiAgent?.fanouts || []),
    fanins: lines(run.multiAgent?.fanins || []),
    dependencyEdges: lines(operator.dependencies.map((entry) => ({ from: entry.from, to: entry.to, label: entry.label, status: entry.status }))),
    failures: lines(operator.failures.map((entry) => ({ kind: entry.kind, status: entry.status, owner: entry.owner, reason: entry.reason }))),
    blackboardRecords: lines([blackboard.boards, blackboard.topics, blackboard.messages, blackboard.contexts, blackboard.artifacts, blackboard.snapshots, blackboard.decisions]),
    messageProvenance: lines(trust.messageProvenance || []),
    rolePolicies: lines(trust.rolePolicies || []),
    permissionDecisions: lines(trust.permissionDecisions || []),
    blackboardWriteAudit: lines(trust.blackboardWrites || []),
    judgeRationales: lines(trust.judgeRationales || []),
    panelDecisions: lines(trust.panelDecisions || []),
    policyViolations: lines(trust.policyViolations || []),
    evidenceAdoption: lines(operator.evidence.map((entry) => ({
      ref: entry.ref || entry.id,
      status: entry.status,
      adoptedBy: entry.adoptedBy,
      candidateIds: entry.candidateIds,
      selectionIds: entry.selectionIds,
      commitIds: entry.commitIds
    }))),
    candidateScores: lines(collectCandidateScores(run)),
    selectedCandidates: lines((run.candidateSelections || []).map((entry) => ({
      candidateId: entry.candidateId,
      scoreId: entry.scoreId,
      verifierNodeId: entry.verifierNodeId,
      reason: entry.reason,
      evidenceCount: entry.evidence.length
    }))),
    verifierCommitGate: lines((run.commits || []).map((entry) => ({
      verifierGated: Boolean(entry.verifierGated),
      checkpoint: Boolean(entry.checkpoint),
      candidateId: entry.candidateId,
      selectionId: entry.selectionId,
      verifierNodeId: entry.verifierNodeId,
      evidenceCount: (entry.evidence || []).length
    }))),
    reportSections: reportSections(run),
    ...normalizeStateExplosionForEval(run),
    ...normalizeEvidenceReasoningForEval(run)
  };
}

function collectCandidateScores(run: WorkflowRun): unknown[] {
  const scores: unknown[] = [];
  for (const candidate of run.candidates || []) {
    for (const scoreId of candidate.scores || []) {
      // Canonical nested score path — MUST match the writers (candidate-scoring.ts
      // persistScore, commit.ts): candidates/<candidateId>/scores/<scoreId>.json.
      // The old flat `<id>.<scoreId>.score.json` path was written by nobody, so the
      // candidate_score_parity eval metric silently scored empty placeholders.
      const scorePath = path.join(run.paths.candidatesDir || path.join(run.paths.runDir, "candidates"), safeFileName(candidate.id), "scores", `${safeFileName(scoreId)}.json`);
      if (fs.existsSync(scorePath)) {
        const score = readJson(scorePath) as Record<string, unknown>;
        scores.push({
          candidateId: candidate.id,
          scoreId,
          criteria: score.criteria,
          total: score.total,
          maxTotal: score.maxTotal,
          normalized: score.normalized,
          verdict: score.verdict,
          evidenceCount: Array.isArray(score.evidence) ? score.evidence.length : 0,
          notes: score.notes
        });
      } else {
        scores.push({ candidateId: candidate.id, scoreId, missing: true });
      }
    }
  }
  return scores;
}

function reportSections(run: WorkflowRun): string[] {
  if (!fs.existsSync(run.paths.report)) return [];
  const text = fs.readFileSync(run.paths.report, "utf8");
  return text.split("\n").filter((line) => /^#+\s+/.test(line)).map((line) => line.replace(/^#+\s+/, "").trim()).sort();
}

function loadSnapshot(target: string): MultiAgentReplaySnapshot {
  const resolved = resolveSnapshotPath(target);
  const snapshot = readJson(resolved) as MultiAgentReplaySnapshot;
  if (snapshot.kind !== "multi-agent-replay-snapshot") throw new Error(`Not a replay snapshot: ${resolved}`);
  assertSnapshotShape(snapshot, resolved);
  return snapshot;
}

function loadReplay(target: string): MultiAgentReplayRun {
  const resolved = resolveReplayPath(target);
  const replay = readJson(resolved) as MultiAgentReplayRun;
  if (replay.kind !== "multi-agent-replay-run") throw new Error(`Not a replay run: ${resolved}`);
  assertReplayShape(replay, resolved);
  return replay;
}

function loadBaselineNormalized(target: string): { id: string; path: string; normalized: MultiAgentEvalNormalized } {
  const snapshotPath = resolveSnapshotPath(target);
  const snapshot = readJson(snapshotPath) as MultiAgentReplaySnapshot;
  if (snapshot.kind !== "multi-agent-replay-snapshot") throw new Error(`Not a replay snapshot: ${snapshotPath}`);
  assertSnapshotShape(snapshot, snapshotPath);
  return { id: snapshot.id, path: snapshotPath, normalized: snapshot.normalized };
}

function assertSnapshotShape(snapshot: MultiAgentReplaySnapshot, file: string): void {
  if (!snapshot.id) throw new Error(`Replay snapshot missing id: ${file}`);
  if (!snapshot.runId) throw new Error(`Replay snapshot missing runId: ${file}`);
  if (!snapshot.paths || !snapshot.paths.suiteDir || !snapshot.paths.snapshotPath) {
    throw new Error(`Replay snapshot missing paths.suiteDir or paths.snapshotPath: ${file}`);
  }
  assertNormalizedShape(snapshot.normalized, `Replay snapshot missing normalized section: ${file}`);
}

function assertReplayShape(replay: MultiAgentReplayRun, file: string): void {
  if (!replay.id) throw new Error(`Replay run missing id: ${file}`);
  if (!replay.snapshotId) throw new Error(`Replay run missing snapshotId: ${file}`);
  if (replay.status !== "completed" && replay.status !== "failed") {
    throw new Error(`Replay run has unsupported status ${String(replay.status)}: ${file}`);
  }
  if (!replay.paths || !replay.paths.suiteDir || !replay.paths.replayRunPath || !replay.paths.snapshotPath) {
    throw new Error(`Replay run missing paths.suiteDir, paths.replayRunPath, or paths.snapshotPath: ${file}`);
  }
  if (!Array.isArray(replay.errors)) throw new Error(`Replay run errors must be an array: ${file}`);
  assertNormalizedShape(replay.replay, `Replay run missing replay section: ${file}`);
}

function assertNormalizedShape(value: MultiAgentEvalNormalized, message: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  for (const key of METRIC_SECTIONS.map((entry) => entry.section)) {
    if (key === "workflow") {
      if (!value.workflow || typeof value.workflow !== "object" || Array.isArray(value.workflow)) throw new Error(`${message}; workflow must be an object`);
    } else if (!Array.isArray(value[key])) {
      throw new Error(`${message}; ${String(key)} must be an array`);
    }
  }
}

function loadOrCompareForTarget(target: string): MultiAgentEvalComparison {
  const suiteDir = resolveSuiteDir(target);
  const comparisonPath = path.join(suiteDir, "comparison.json");
  const replayPath = resolveReplayPath(target);
  if (fs.existsSync(comparisonPath)) {
    const comparison = readJson(comparisonPath) as MultiAgentEvalComparison;
    if (comparison.paths.replayPath === replayPath) return comparison;
  }
  return compareMultiAgentReplay(path.join(suiteDir, "snapshot.json"), replayPath);
}

function resolveSnapshotPath(target: string): string {
  const resolved = resolveTargetPath(target);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return path.join(resolved, "snapshot.json");
  if (fs.existsSync(resolved)) return resolved;
  return path.join(process.cwd(), ".cw", "evals", safeFileName(target), "snapshot.json");
}

function resolveReplayPath(target: string): string {
  const resolved = resolveTargetPath(target);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return path.join(resolved, "replay-run.json");
  if (fs.existsSync(resolved)) return resolved;
  return path.join(process.cwd(), ".cw", "evals", safeFileName(target), "replay-run.json");
}

function resolveSuiteDir(target: string): string {
  const resolved = resolveTargetPath(target);
  if (fs.existsSync(resolved)) {
    if (fs.statSync(resolved).isDirectory()) return resolved;
    const value = readJson(resolved) as { paths?: { suiteDir?: string } };
    if (value.paths?.suiteDir) return value.paths.suiteDir;
    return path.dirname(resolved);
  }
  return path.join(process.cwd(), ".cw", "evals", safeFileName(target));
}

function resolveTargetPath(target: string): string {
  if (!target) throw new Error("Missing eval target");
  return path.isAbsolute(target) ? target : path.resolve(target);
}

function evalSuiteDir(cwd: string, suiteId: string): string {
  return path.join(cwd, ".cw", "evals", safeFileName(suiteId));
}

function writeSuite(suite: MultiAgentEvalSuite): void {
  writeJson(path.join(suite.paths.suiteDir, "suite.json"), suite);
}

function loadSuiteFromDir(suiteDir: string): MultiAgentEvalSuite {
  const suitePath = path.join(suiteDir, "suite.json");
  if (fs.existsSync(suitePath)) return readJson(suitePath) as MultiAgentEvalSuite;
  return {
    schemaVersion: 1,
    id: path.basename(suiteDir),
    title: `Multi-Agent Eval Suite ${path.basename(suiteDir)}`,
    createdAt: now(),
    cases: [],
    paths: { suiteDir, snapshotPath: path.join(suiteDir, "snapshot.json") }
  };
}

export function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return normalizeString(value);
    return value;
  }
  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (["createdAt", "updatedAt", "recordedAt", "selectedAt", "replayedAt", "generatedAt"].includes(key)) continue;
    if (key.endsWith("Path") || key === "path" || key === "cwd" || key === "runDir" || key.endsWith("Dir")) {
      normalized[key] = normalizeString(String(record[key]));
    } else {
      normalized[key] = normalizeValue(record[key]);
    }
  }
  return normalized;
}

function normalizeString(value: string): string {
  return value
    .replace(/[0-9]{8}T[0-9]{6}Z/g, "<timestamp>")
    .replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/g, "<timestamp>")
    .replace(/\/[^"\s]+\/\.cw\/runs\/[^"\s/]+/g, "<run-dir>")
    .replace(/\/[^"\s]+\/\.cw\/evals\/[^"\s/]+/g, "<eval-dir>")
    .replace(/\/var\/folders\/[^"\s]+|\/tmp\/[^"\s]+|\/private\/tmp\/[^"\s]+/g, "<tmp>");
}

export function lines(value: unknown): string[] {
  const normalized = normalizeValue(value);
  if (Array.isArray(normalized)) return normalized.map((entry) => replayStableStringify(entry)).sort();
  return [replayStableStringify(normalized)].sort();
}

export function replayStableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

function now(): string {
  return new Date().toISOString();
}

function metricLine(score: MultiAgentEvalScore, id: string): string {
  const metric = score.metrics.find((entry) => entry.id === id);
  return `- ${id}: ${metric?.status || "missing"} - ${metric?.reason || "metric missing"}`;
}

function metricStatus(score: MultiAgentEvalScore, id: string): string {
  const metric = score.metrics.find((entry) => entry.id === id);
  return `${id}=${metric?.status || "missing"}`;
}

function sectionStatus(comparison: MultiAgentEvalComparison, id: string): string {
  return `${id}=${comparison.sections[id]?.status || "missing"}`;
}

function isSnapshot(value: unknown): value is MultiAgentReplaySnapshot {
  return Boolean(value && typeof value === "object" && (value as { kind?: string }).kind === "multi-agent-replay-snapshot");
}

function isReplay(value: unknown): value is MultiAgentReplayRun {
  return Boolean(value && typeof value === "object" && (value as { kind?: string }).kind === "multi-agent-replay-run");
}

function isComparison(value: unknown): value is MultiAgentEvalComparison {
  return Boolean(value && typeof value === "object" && "sections" in value && "findings" in value);
}

function isScore(value: unknown): value is MultiAgentEvalScore {
  return Boolean(value && typeof value === "object" && "metrics" in value && "score" in value);
}

function isGate(value: unknown): value is MultiAgentEvalGate {
  return Boolean(value && typeof value === "object" && "verdict" in value && "requiredArtifacts" in value);
}

function isReport(value: unknown): value is MultiAgentEvalReport {
  return Boolean(value && typeof value === "object" && "reportPath" in value && !("verdict" in value));
}
