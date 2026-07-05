"use strict";
// core/multi-agent/eval-replay.ts — normalizeValue, replayStableStringify,
// the 31-metric compare, and the pure projection (normalizeRun) half of
// snapshot/replay/score/gate/report.
//
// MILESTONE 9. Byte-exact port of the old build's src/multi-agent-eval.ts
// + src/multi-agent-eval/normalize.ts's PURE halves. Disk reads/writes
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
// module (out of this milestone's scope per v2/PLAN.md's build-order
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
// harness exact outputs"; plugins/cool-workflow/src/multi-agent-eval.ts,
// src/multi-agent-eval/normalize.ts (byte-exact source for the ported
// pieces).
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_METRIC_SECTIONS = exports.METRIC_SECTIONS = void 0;
exports.normalizeValue = normalizeValue;
exports.replayStableStringify = replayStableStringify;
exports.lines = lines;
exports.assertNormalizedShape = assertNormalizedShape;
exports.compareNormalized = compareNormalized;
exports.scoreComparison = scoreComparison;
exports.buildGate = buildGate;
exports.buildReportLines = buildReportLines;
// ---------------------------------------------------------------------------
// normalizeValue / replayStableStringify — byte-exact port
// ---------------------------------------------------------------------------
const DROPPED_TIMESTAMP_KEYS = new Set(["createdAt", "updatedAt", "recordedAt", "selectedAt", "replayedAt", "generatedAt"]);
function normalizeString(value) {
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
function normalizeValue(value) {
    if (Array.isArray(value))
        return value.map(normalizeValue);
    if (!value || typeof value !== "object") {
        if (typeof value === "string")
            return normalizeString(value);
        return value;
    }
    const record = value;
    const normalized = {};
    for (const key of Object.keys(record).sort()) {
        if (DROPPED_TIMESTAMP_KEYS.has(key))
            continue;
        if (key.endsWith("Path") || key === "path" || key === "cwd" || key === "runDir" || key.endsWith("Dir")) {
            normalized[key] = normalizeString(String(record[key]));
        }
        else {
            normalized[key] = normalizeValue(record[key]);
        }
    }
    return normalized;
}
function replayStableStringify(value) {
    return JSON.stringify(normalizeValue(value));
}
/** normalize -> per-entry replayStableStringify -> sorted string array. */
function lines(value) {
    const normalized = normalizeValue(value);
    if (Array.isArray(normalized))
        return normalized.map((entry) => replayStableStringify(entry)).sort();
    return [replayStableStringify(normalized)].sort();
}
exports.METRIC_SECTIONS = [
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
const SUMMARY_METRIC_SECTIONS = [
    { metric: "summary_freshness", section: "summaryFreshness", title: "Summary freshness" },
    { metric: "compact_graph_parity", section: "compactGraphShape", title: "Compact graph parity" },
    { metric: "blackboard_digest_parity", section: "blackboardDigest", title: "Blackboard digest parity" },
    { metric: "critical_path_parity", section: "criticalPath", title: "Critical path parity" },
    { metric: "evidence_digest_parity", section: "evidenceDigest", title: "Evidence digest parity" },
    { metric: "expansion_ref_integrity", section: "expansionRefs", title: "Expansion ref integrity" },
];
const REASONING_METRIC_SECTIONS = [
    { metric: "reasoning_freshness", section: "reasoningFreshness", title: "Reasoning chain freshness" },
    { metric: "reasoning_chain_parity", section: "reasoningChains", title: "Reasoning chain parity" },
    { metric: "reasoning_unexplained_parity", section: "reasoningUnexplained", title: "Fail-closed unexplained parity" },
];
exports.ALL_METRIC_SECTIONS = [...exports.METRIC_SECTIONS, ...SUMMARY_METRIC_SECTIONS, ...REASONING_METRIC_SECTIONS];
function assertNormalizedShape(value, message) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(message);
    for (const spec of exports.METRIC_SECTIONS) {
        const key = spec.section;
        if (key === "workflow") {
            if (!value.workflow || typeof value.workflow !== "object" || Array.isArray(value.workflow))
                throw new Error(`${message}; workflow must be an object`);
        }
        else if (!Array.isArray(value[key])) {
            throw new Error(`${message}; ${String(key)} must be an array`);
        }
    }
}
// ---------------------------------------------------------------------------
// Comparison (pure — takes already-loaded baseline/replay objects)
// ---------------------------------------------------------------------------
function comparisonValues(metric, section, baseline, replay) {
    if (metric === "replay_completed") {
        return {
            baselineValue: { status: "completed", errorCount: 0, workflow: baseline.workflow },
            replayValue: { status: replay.status, errorCount: replay.errors.length, workflow: replay.replay.workflow },
        };
    }
    return { baselineValue: baseline[section] ?? [], replayValue: replay.replay[section] ?? [] };
}
function compareNormalized(baselineId, baselinePath, baseline, replay, now, comparisonPath, findingsPath, suiteDir) {
    const sections = {};
    const findings = [];
    for (const spec of exports.ALL_METRIC_SECTIONS) {
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
        sections,
        findings,
    };
}
function scoreComparison(comparison, now, scorePath) {
    const metrics = exports.ALL_METRIC_SECTIONS.map((spec) => {
        const section = comparison.sections[String(spec.section)];
        const passed = section?.status === "pass";
        return {
            id: spec.metric,
            status: passed ? "pass" : "fail",
            score: passed ? 1 : 0,
            maxScore: 1,
            reason: section?.reason || `${spec.title} missing.`,
            evidenceRefs: [section?.baselineRef, section?.replayRef].filter(Boolean),
            baselineRefs: section?.baselineRef ? [section.baselineRef] : [],
            replayRefs: section?.replayRef ? [section.replayRef] : [],
        };
    });
    return {
        schemaVersion: 1,
        replayId: comparison.replayId,
        scoredAt: now,
        status: metrics.every((entry) => entry.status !== "fail") ? "pass" : "fail",
        score: metrics.reduce((total, entry) => total + entry.score, 0),
        maxScore: metrics.reduce((total, entry) => total + entry.maxScore, 0),
        metrics,
        findings: comparison.findings,
        paths: { suiteDir: comparison.paths.suiteDir, comparisonPath: comparison.paths.comparisonPath, scorePath },
    };
}
function buildGate(suiteDir, snapshotPath, replayRunPath, comparisonPath, scorePath, reportPath, comparison, score, now, suiteId) {
    if (comparison.paths.baselinePath !== snapshotPath) {
        throw new Error(`Eval gate found stale comparison artifact for ${comparison.paths.baselinePath}; rerun eval compare ${snapshotPath} ${comparison.paths.replayPath}`);
    }
    if (score.replayId !== comparison.replayId || score.paths.comparisonPath !== comparisonPath) {
        throw new Error(`Eval gate found stale score artifact for ${score.replayId}; rerun eval score ${comparison.paths.replayPath}`);
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
function metricLine(score, id) {
    const metric = score.metrics.find((entry) => entry.id === id);
    return `- ${id}: ${metric?.status || "missing"} - ${metric?.reason || "metric missing"}`;
}
/** The report.md body (fixed section layout, byte-exact). Writing the
 *  file is the shell's job. */
function buildReportLines(suiteDir, score) {
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
