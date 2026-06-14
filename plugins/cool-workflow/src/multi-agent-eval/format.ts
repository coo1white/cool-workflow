// Human formatting for the multi-agent eval replay layer (CLI-only; never affects
// --json / MCP payloads). Pure functions — a result object in, a string out —
// carved out of multi-agent-eval.ts (FreeBSD-audit god-module split) so the eval
// router no longer bundles the rendering layer. The runtime-discriminating type
// guards travel with the renderer that is their only consumer. Re-exported from
// multi-agent-eval.ts to keep the public surface byte-unchanged.
//
// Types are imported type-only from the parent module: `import type` is fully
// erased at runtime, so there is no import cycle despite the parent re-exporting
// formatMultiAgentEval from here.
import path from "node:path";
import type {
  MultiAgentEvalComparison,
  MultiAgentEvalGate,
  MultiAgentEvalReport,
  MultiAgentEvalScore,
  MultiAgentReplayRun,
  MultiAgentReplaySnapshot
} from "../multi-agent-eval";

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
