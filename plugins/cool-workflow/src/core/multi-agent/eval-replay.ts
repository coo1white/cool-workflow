// core/multi-agent/eval-replay.ts — normalizeValue, replayStableStringify,
// the 31-metric compare, and the pure projection (normalizeRun) half of
// snapshot/replay/score/gate/report.
//
// MILESTONE 9. Byte-exact port of the old build's multi-agent-eval module
// + multi-agent-eval normalize module's PURE halves. Disk reads/writes
// (snapshot.json, replay-run.json, comparison.json, score.json, gate.json,
// report.md, suite.json) and the "re-derive from raw baseline state" load
// are the caller's job — see shell/eval-io.ts.
//
// BYTE-COMPAT / REBUILD RISK 5 [load-bearing]: replay must RE-DERIVE the
// normalized projection from the raw baseline run state, never copy
// snapshot.normalized — see eval-replay-detects-drift.case.js.
//
// Scope note: this milestone's `normalizeRun` derives `dependencyEdges`/
// `failures`/`evidenceAdoption` from the multi-agent/topology/blackboard/
// trust state actually built in this milestone (runtime.ts/topology.ts/
// coordinator.ts/candidate-scoring.ts), NOT from the full operator-ux
// module (out of this milestone's scope per project/docs/rebuild/PLAN.md's build-order
// list). The 9 optional v0.1.25/v0.1.26 sections (summaryFreshness
// through reasoningUnexplained) default to `[]`, which SPEC/multi-
// agent.md's own edge-case list says is valid for snapshots that predate
// those sections — so this is a real, spec-sanctioned subset, not a
// shortcut that breaks the determinism contract: every section that IS
// computed is still a genuine, deterministic re-derivation, and
// compareMultiAgentReplay/scoreMultiAgentReplay still correctly flag a
// drift in any of it (see eval-replay-detects-drift.case.js, which
// exercises exactly the sections this milestone computes for real).
//
// Evidence: SPEC/multi-agent.md section I ("Eval replay harness"), "Eval
// harness exact outputs"; the old build's multi-agent-eval module,
// multi-agent-eval normalize module (byte-exact source for the ported
// pieces).

import { fingerprintStrings } from "../hash";

export type EvalMetricStatus = "pass" | "fail" | "warning" | "improved" | "changed";
export type RegressionSeverity = "error" | "warning" | "info";

// ---------------------------------------------------------------------------
// normalizeValue / replayStableStringify — byte-exact port
// ---------------------------------------------------------------------------

const DROPPED_TIMESTAMP_KEYS = new Set(["createdAt", "updatedAt", "recordedAt", "selectedAt", "replayedAt", "generatedAt"]);

function normalizeString(value: string): string {
  return value
    .replace(/[0-9]{8}T[0-9]{6}Z/g, "<timestamp>")
    .replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/g, "<timestamp>")
    .replace(/\/[^"\s]+\/\.cw\/runs\/[^"\s/]+/g, "<run-dir>")
    .replace(/\/[^"\s]+\/\.cw\/evals\/[^"\s/]+/g, "<eval-dir>")
    .replace(/\/var\/folders\/[^"\s]+|\/tmp\/[^"\s]+|\/private\/tmp\/[^"\s]+/g, "<tmp>");
}

/** Recursive: sorts object keys; drops timestamp keys; stringifies +
 *  scrubs path-like keys (name ends "Path"/"Dir", or is "path"/"cwd"/
 *  "runDir") EVEN WHEN `undefined` (producing the literal string
 *  "undefined") — byte-exact edge case, replays reproduce this. */
export function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return normalizeString(value);
    return value;
  }
  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (DROPPED_TIMESTAMP_KEYS.has(key)) continue;
    if (key.endsWith("Path") || key === "path" || key === "cwd" || key === "runDir" || key.endsWith("Dir")) {
      normalized[key] = normalizeString(String(record[key]));
    } else {
      normalized[key] = normalizeValue(record[key]);
    }
  }
  return normalized;
}

export function replayStableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

/** normalize -> per-entry replayStableStringify -> sorted string array. */
export function lines(value: unknown): string[] {
  const normalized = normalizeValue(value);
  if (Array.isArray(normalized)) return normalized.map((entry) => replayStableStringify(entry)).sort();
  return [replayStableStringify(normalized)].sort();
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface MultiAgentEvalNormalized {
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
  summaryFreshness?: string[];
  compactGraphShape?: string[];
  blackboardDigest?: string[];
  criticalPath?: string[];
  evidenceDigest?: string[];
  expansionRefs?: string[];
  reasoningFreshness?: string[];
  reasoningChains?: string[];
  reasoningUnexplained?: string[];
}

/** Content fingerprint of a replay's normalized projection — NOT its path
 *  or replay id, both of which stay fixed across reruns of `eval replay`
 *  on the same suite. Two replays of the same underlying baseline content
 *  fingerprint identically; a replay that reflects a genuine drift (the
 *  baseline changed since the last replay) fingerprints differently. This
 *  is what a cached comparison/score must be checked against before being
 *  trusted — see shell/eval-io.ts's loadOrCompareForTarget/
 *  loadScoreForTarget and buildGate below. */
export function replayContentFingerprint(replay: MultiAgentEvalNormalized): string {
  return fingerprintStrings([replayStableStringify(replay)]);
}

export interface MultiAgentReplaySnapshot {
  schemaVersion: 1;
  kind: "multi-agent-replay-snapshot";
  id: string;
  createdAt: string;
  runId: string;
  workflow: { id: string; appId?: string; appVersion?: string; title: string };
  inputs: Record<string, unknown>;
  paths: { suiteDir: string; snapshotPath: string; baselineStatePath: string; reportPath: string };
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
  paths: { suiteDir: string; replayDir: string; replayRunPath: string; snapshotPath: string };
  replay: MultiAgentEvalNormalized;
  errors: string[];
}

export interface MultiAgentEvalCase {
  id: string;
  snapshotId: string;
  replayRunId?: string;
  baselinePath: string;
  replayPath?: string;
  expectedVerdict: "pass" | "fail";
}

export interface MultiAgentEvalSuite {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: string;
  cases: MultiAgentEvalCase[];
  paths: { suiteDir: string; snapshotPath: string; replayRunPath?: string; comparisonPath?: string; scorePath?: string; findingsPath?: string; reportPath?: string };
}

export interface MultiAgentComparisonSection {
  id: string;
  status: "pass" | "fail" | "changed";
  baselineRef: string;
  replayRef: string;
  reason: string;
}

export interface MultiAgentRegressionFinding {
  id: string;
  severity: RegressionSeverity;
  category: string;
  reason: string;
  baselineRef: string;
  replayRef: string;
}

export interface MultiAgentEvalComparison {
  schemaVersion: 1;
  baselineId: string;
  replayId: string;
  comparedAt: string;
  status: "pass" | "fail";
  paths: { suiteDir: string; baselinePath: string; replayPath: string; comparisonPath: string; findingsPath: string };
  /** Content fingerprint of the replay this comparison was built from (see
   *  replayContentFingerprint) — replayPath alone is a fixed, deterministic
   *  path per suite, so path equality can never detect that replay-run.json
   *  was overwritten with different content since this comparison ran. */
  replayFingerprint: string;
  sections: Record<string, MultiAgentComparisonSection>;
  findings: MultiAgentRegressionFinding[];
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

export interface MultiAgentEvalScore {
  schemaVersion: 1;
  replayId: string;
  /** Mirrored from the comparison this score was built from — see
   *  MultiAgentEvalComparison.replayFingerprint. */
  replayFingerprint: string;
  scoredAt: string;
  status: "pass" | "fail";
  score: number;
  maxScore: number;
  metrics: MultiAgentEvalMetric[];
  findings: MultiAgentRegressionFinding[];
  paths: { suiteDir: string; comparisonPath: string; scorePath: string };
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
  paths: { suiteDir: string; snapshotPath: string; replayRunPath: string; comparisonPath: string; scorePath: string; reportPath: string };
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

// ---------------------------------------------------------------------------
// The 31 metric sections, in order
// ---------------------------------------------------------------------------

interface MetricSpec {
  metric: string;
  section: keyof MultiAgentEvalNormalized;
  title: string;
}

export const METRIC_SECTIONS: MetricSpec[] = [
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
  { metric: "report_parity", section: "reportSections", title: "Report parity" },
];

const SUMMARY_METRIC_SECTIONS: MetricSpec[] = [
  { metric: "summary_freshness", section: "summaryFreshness", title: "Summary freshness" },
  { metric: "compact_graph_parity", section: "compactGraphShape", title: "Compact graph parity" },
  { metric: "blackboard_digest_parity", section: "blackboardDigest", title: "Blackboard digest parity" },
  { metric: "critical_path_parity", section: "criticalPath", title: "Critical path parity" },
  { metric: "evidence_digest_parity", section: "evidenceDigest", title: "Evidence digest parity" },
  { metric: "expansion_ref_integrity", section: "expansionRefs", title: "Expansion ref integrity" },
];

const REASONING_METRIC_SECTIONS: MetricSpec[] = [
  { metric: "reasoning_freshness", section: "reasoningFreshness", title: "Reasoning chain freshness" },
  { metric: "reasoning_chain_parity", section: "reasoningChains", title: "Reasoning chain parity" },
  { metric: "reasoning_unexplained_parity", section: "reasoningUnexplained", title: "Fail-closed unexplained parity" },
];

export const ALL_METRIC_SECTIONS: MetricSpec[] = [...METRIC_SECTIONS, ...SUMMARY_METRIC_SECTIONS, ...REASONING_METRIC_SECTIONS];

export function assertNormalizedShape(value: MultiAgentEvalNormalized, message: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  for (const spec of METRIC_SECTIONS) {
    const key = spec.section;
    if (key === "workflow") {
      if (!value.workflow || typeof value.workflow !== "object" || Array.isArray(value.workflow)) throw new Error(`${message}; workflow must be an object`);
    } else if (!Array.isArray(value[key])) {
      throw new Error(`${message}; ${String(key)} must be an array`);
    }
  }
}

// ---------------------------------------------------------------------------
// Comparison (pure — takes already-loaded baseline/replay objects)
// ---------------------------------------------------------------------------

function comparisonValues(metric: string, section: keyof MultiAgentEvalNormalized, baseline: MultiAgentEvalNormalized, replay: MultiAgentReplayRun): { baselineValue: unknown; replayValue: unknown } {
  if (metric === "replay_completed") {
    return {
      baselineValue: { status: "completed", errorCount: 0, workflow: baseline.workflow },
      replayValue: { status: replay.status, errorCount: replay.errors.length, workflow: replay.replay.workflow },
    };
  }
  return { baselineValue: baseline[section] ?? [], replayValue: replay.replay[section] ?? [] };
}

export function compareNormalized(baselineId: string, baselinePath: string, baseline: MultiAgentEvalNormalized, replay: MultiAgentReplayRun, now: string, comparisonPath: string, findingsPath: string, suiteDir: string): MultiAgentEvalComparison {
  const sections: Record<string, MultiAgentComparisonSection> = {};
  const findings: MultiAgentRegressionFinding[] = [];
  for (const spec of ALL_METRIC_SECTIONS) {
    const { baselineValue, replayValue } = comparisonValues(spec.metric, spec.section, baseline, replay);
    const equal = replayStableStringify(baselineValue) === replayStableStringify(replayValue);
    const id = String(spec.section);
    sections[id] = {
      id,
      status: equal ? "pass" : "fail",
      baselineRef: `${baselinePath}#/normalized/${id}`,
      replayRef: `${replay.paths.replayRunPath}#/replay/${id}`,
      reason: equal ? `${spec.title} matches.` : `${spec.title} changed.`,
    };
    if (!equal) {
      findings.push({ id: `regression-${id}`, severity: "error", category: id, reason: `${spec.title} changed between baseline and replay.`, baselineRef: sections[id].baselineRef, replayRef: sections[id].replayRef });
    }
  }
  return {
    schemaVersion: 1,
    baselineId,
    replayId: replay.id,
    comparedAt: now,
    status: findings.some((entry) => entry.severity === "error") ? "fail" : "pass",
    paths: { suiteDir, baselinePath, replayPath: replay.paths.replayRunPath, comparisonPath, findingsPath },
    replayFingerprint: replayContentFingerprint(replay.replay),
    sections,
    findings,
  };
}

export function scoreComparison(comparison: MultiAgentEvalComparison, now: string, scorePath: string): MultiAgentEvalScore {
  const metrics: MultiAgentEvalMetric[] = ALL_METRIC_SECTIONS.map((spec) => {
    const section = comparison.sections[String(spec.section)];
    const passed = section?.status === "pass";
    return {
      id: spec.metric,
      status: passed ? "pass" : "fail",
      score: passed ? 1 : 0,
      maxScore: 1,
      reason: section?.reason || `${spec.title} missing.`,
      evidenceRefs: [section?.baselineRef, section?.replayRef].filter(Boolean) as string[],
      baselineRefs: section?.baselineRef ? [section.baselineRef] : [],
      replayRefs: section?.replayRef ? [section.replayRef] : [],
    };
  });
  return {
    schemaVersion: 1,
    replayId: comparison.replayId,
    replayFingerprint: comparison.replayFingerprint,
    scoredAt: now,
    status: metrics.every((entry) => entry.status !== "fail") ? "pass" : "fail",
    score: metrics.reduce((total, entry) => total + entry.score, 0),
    maxScore: metrics.reduce((total, entry) => total + entry.maxScore, 0),
    metrics,
    findings: comparison.findings,
    paths: { suiteDir: comparison.paths.suiteDir, comparisonPath: comparison.paths.comparisonPath, scorePath },
  };
}

export function buildGate(suiteDir: string, snapshotPath: string, replayRunPath: string, comparisonPath: string, scorePath: string, reportPath: string, comparison: MultiAgentEvalComparison, score: MultiAgentEvalScore, now: string, suiteId: string, currentReplayFingerprint: string): MultiAgentEvalGate {
  if (comparison.paths.baselinePath !== snapshotPath) {
    throw new Error(`Eval gate found stale comparison artifact for ${comparison.paths.baselinePath}; rerun eval compare ${snapshotPath} ${comparison.paths.replayPath}`);
  }
  if (score.replayId !== comparison.replayId || score.paths.comparisonPath !== comparisonPath) {
    throw new Error(`Eval gate found stale score artifact for ${score.replayId}; rerun eval score ${comparison.paths.replayPath}`);
  }
  // Path/id equality alone (the two checks above) cannot catch a rerun of
  // `eval replay` that overwrote replay-run.json with genuinely different
  // content at the SAME path — see replayContentFingerprint's doc comment.
  // This is the P1 "eval-replay staleness check is vacuously-true path-
  // equality" finding from examples/audits/self-audit-cool-workflow-v0.2.6.md.
  if (comparison.replayFingerprint !== currentReplayFingerprint) {
    throw new Error(`Eval gate found stale comparison artifact for ${comparison.paths.replayPath}: its content changed since the comparison was built; rerun eval compare ${snapshotPath} ${comparison.paths.replayPath}`);
  }
  const failed = score.findings.filter((entry) => entry.severity === "error");
  return {
    schemaVersion: 1,
    suiteId,
    checkedAt: now,
    status: score.status === "pass" && failed.length === 0 ? "pass" : "fail",
    verdict: score.status === "pass" && failed.length === 0 ? "ship" : "hold",
    score: score.score,
    maxScore: score.maxScore,
    requiredArtifacts: [snapshotPath, comparison.paths.replayPath, comparisonPath, scorePath, reportPath],
    findings: score.findings,
    paths: { suiteDir, snapshotPath, replayRunPath: comparison.paths.replayPath, comparisonPath, scorePath, reportPath },
    nextAction: failed.length ? "Review regression findings, update replay rationale if the change is intentional, then rerun eval gate." : "Eval replay gate passed; include artifacts in release evidence.",
  };
}

function metricLine(score: MultiAgentEvalScore, id: string): string {
  const metric = score.metrics.find((entry) => entry.id === id);
  return `- ${id}: ${metric?.status || "missing"} - ${metric?.reason || "metric missing"}`;
}

/** The report.md body (fixed section layout, byte-exact). Writing the
 *  file is the shell's job. */
export function buildReportLines(suiteDir: string, score: MultiAgentEvalScore): string[] {
  return [
    "# Multi-Agent Eval Replay Report",
    "",
    "## Eval Suite",
    `- Suite: ${suiteDir}`,
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
    score.status === "pass" ? "Use this replay as release-gate evidence." : "Fix or explicitly classify the changed behavior before release.",
  ];
}
