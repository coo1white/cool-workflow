"use strict";
// shell/eval-text.ts — human render for the multi-agent eval/replay layer
// (`cw eval snapshot|replay|compare|score|gate|report` text output).
//
// Byte-behavior port of the old build's multi-agent-eval format module's
// formatMultiAgentEval + its runtime-discriminating type guards. CLI-only —
// never affects --json / MCP payloads. Types are imported type-only from the
// v2 core eval-replay module.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatMultiAgentEval = formatMultiAgentEval;
const path = __importStar(require("node:path"));
function metricStatus(score, id) {
    const metric = score.metrics.find((entry) => entry.id === id);
    return `${id}=${metric?.status || "missing"}`;
}
function sectionStatus(comparison, id) {
    return `${id}=${comparison.sections[id]?.status || "missing"}`;
}
function isSnapshot(value) {
    return Boolean(value && typeof value === "object" && value.kind === "multi-agent-replay-snapshot");
}
function isReplay(value) {
    return Boolean(value && typeof value === "object" && value.kind === "multi-agent-replay-run");
}
function isComparison(value) {
    return Boolean(value && typeof value === "object" && "sections" in value && "findings" in value);
}
function isScore(value) {
    return Boolean(value && typeof value === "object" && "metrics" in value && "score" in value);
}
function isGate(value) {
    return Boolean(value && typeof value === "object" && "verdict" in value && "requiredArtifacts" in value);
}
function isReport(value) {
    return Boolean(value && typeof value === "object" && "reportPath" in value && !("verdict" in value));
}
/** Human render for any eval-replay result object. Falls back to pretty JSON
 *  for an unrecognized shape (matches the old build's default arm). */
function formatMultiAgentEval(value) {
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
            `  ${value.nextAction}`,
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
            `  ${value.status === "pass" ? "Run eval gate or include report path as evidence." : "Review findings before release."}`,
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
            "  Score the replay or run the eval gate.",
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
            `  cw eval compare ${value.paths.snapshotPath} ${value.paths.replayRunPath}`,
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
            `  cw eval replay ${value.paths.snapshotPath}`,
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
            "  Run eval gate if this is release evidence.",
        ].join("\n");
    }
    return JSON.stringify(value, null, 2);
}
