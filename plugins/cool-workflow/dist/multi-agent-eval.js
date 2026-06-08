"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMultiAgentReplaySnapshot = createMultiAgentReplaySnapshot;
exports.replayMultiAgentSnapshot = replayMultiAgentSnapshot;
exports.compareMultiAgentReplay = compareMultiAgentReplay;
exports.scoreMultiAgentReplay = scoreMultiAgentReplay;
exports.gateMultiAgentEval = gateMultiAgentEval;
exports.reportMultiAgentEval = reportMultiAgentEval;
exports.formatMultiAgentEval = formatMultiAgentEval;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const multi_agent_1 = require("./multi-agent");
const multi_agent_operator_ux_1 = require("./multi-agent-operator-ux");
const multi_agent_trust_1 = require("./multi-agent-trust");
const operator_ux_1 = require("./operator-ux");
const topology_1 = require("./topology");
const trust_audit_1 = require("./trust-audit");
const state_1 = require("./state");
const METRIC_SECTIONS = [
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
function createMultiAgentReplaySnapshot(run, options = {}) {
    const id = (0, state_1.safeFileName)(String(options.id || options.snapshot || `${run.id}-snapshot`));
    const suiteDir = evalSuiteDir(run.cwd, id);
    const snapshotPath = node_path_1.default.join(suiteDir, "snapshot.json");
    const snapshot = {
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
        inputs: normalizeValue(run.inputs),
        paths: {
            suiteDir,
            snapshotPath,
            baselineStatePath: run.paths.state,
            reportPath: run.paths.report
        },
        capture: captureRun(run),
        normalized: normalizeRun(run)
    };
    (0, state_1.writeJson)(snapshotPath, snapshot);
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
function replayMultiAgentSnapshot(target, options = {}) {
    const snapshot = loadSnapshot(target);
    const replayId = (0, state_1.safeFileName)(String(options.id || options.replay || `${snapshot.id}-replay`));
    const suiteDir = snapshot.paths.suiteDir;
    const replayDir = node_path_1.default.join(suiteDir, "replay");
    const replayRunPath = node_path_1.default.join(suiteDir, "replay-run.json");
    node_fs_1.default.mkdirSync(replayDir, { recursive: true });
    const replay = {
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
    (0, state_1.writeJson)(replayRunPath, replay);
    const suite = loadSuiteFromDir(suiteDir);
    suite.paths.replayRunPath = replayRunPath;
    suite.cases = suite.cases.map((entry) => entry.snapshotId === snapshot.id ? { ...entry, replayRunId: replayId, replayPath: replayRunPath } : entry);
    writeSuite(suite);
    return replay;
}
function compareMultiAgentReplay(baselineTarget, replayTarget) {
    const baseline = loadBaselineNormalized(baselineTarget);
    const replay = loadReplay(replayTarget);
    const suiteDir = replay.paths.suiteDir;
    const comparisonPath = node_path_1.default.join(suiteDir, "comparison.json");
    const findingsPath = node_path_1.default.join(suiteDir, "findings.json");
    const sections = {};
    const findings = [];
    for (const spec of METRIC_SECTIONS) {
        const { baselineValue, replayValue } = comparisonValues(spec.metric, spec.section, baseline.normalized, replay);
        const equal = stableStringify(baselineValue) === stableStringify(replayValue);
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
    const comparison = {
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
    (0, state_1.writeJson)(comparisonPath, comparison);
    (0, state_1.writeJson)(findingsPath, findings);
    const suite = loadSuiteFromDir(suiteDir);
    suite.paths.comparisonPath = comparisonPath;
    suite.paths.findingsPath = findingsPath;
    writeSuite(suite);
    return comparison;
}
function comparisonValues(metric, section, baseline, replay) {
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
        baselineValue: baseline[section],
        replayValue: replay.replay[section]
    };
}
function scoreMultiAgentReplay(target) {
    const comparison = loadOrCompareForTarget(target);
    const scorePath = node_path_1.default.join(comparison.paths.suiteDir, "score.json");
    const metrics = METRIC_SECTIONS.map((spec) => {
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
            replayRefs: section?.replayRef ? [section.replayRef] : []
        };
    });
    const score = {
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
    (0, state_1.writeJson)(scorePath, score);
    const suite = loadSuiteFromDir(comparison.paths.suiteDir);
    suite.paths.scorePath = scorePath;
    writeSuite(suite);
    return score;
}
function gateMultiAgentEval(target) {
    const suiteDir = resolveSuiteDir(target);
    const snapshotPath = node_path_1.default.join(suiteDir, "snapshot.json");
    const replayRunPath = node_path_1.default.join(suiteDir, "replay-run.json");
    const comparisonPath = node_path_1.default.join(suiteDir, "comparison.json");
    const scorePath = node_path_1.default.join(suiteDir, "score.json");
    const missing = [snapshotPath, replayRunPath, comparisonPath, scorePath].filter((file) => !node_fs_1.default.existsSync(file));
    if (missing.length)
        throw new Error(`Eval gate missing required artifact(s): ${missing.join(", ")}`);
    const comparison = (0, state_1.readJson)(comparisonPath);
    const score = (0, state_1.readJson)(scorePath);
    if (comparison.paths.baselinePath !== snapshotPath) {
        throw new Error(`Eval gate found stale comparison artifact for ${comparison.paths.baselinePath}; rerun eval compare ${snapshotPath} ${comparison.paths.replayPath}`);
    }
    if (score.replayId !== comparison.replayId || score.paths.comparisonPath !== comparisonPath) {
        throw new Error(`Eval gate found stale score artifact for ${score.replayId}; rerun eval score ${comparison.paths.replayPath}`);
    }
    const report = reportMultiAgentEval(comparison.paths.replayPath);
    const failed = score.findings.filter((entry) => entry.severity === "error");
    const gate = {
        schemaVersion: 1,
        suiteId: node_path_1.default.basename(suiteDir),
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
    (0, state_1.writeJson)(node_path_1.default.join(suiteDir, "gate.json"), gate);
    return gate;
}
function reportMultiAgentEval(target) {
    const suiteDir = resolveSuiteDir(target);
    const scorePath = node_path_1.default.join(suiteDir, "score.json");
    const score = loadScoreForTarget(target, scorePath);
    const reportPath = node_path_1.default.join(suiteDir, "report.md");
    const lines = [
        "# Multi-Agent Eval Replay Report",
        "",
        "## Eval Suite",
        `- Suite: ${node_path_1.default.basename(suiteDir)}`,
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
        "## Regression Findings",
        ...(score.findings.length ? score.findings.map((entry) => `- ${entry.severity.toUpperCase()} ${entry.category}: ${entry.reason}`) : ["- none"]),
        "",
        "## Final Verdict",
        score.status === "pass" ? "PASS" : "FAIL",
        "",
        "## Next Action",
        score.status === "pass" ? "Use this replay as release-gate evidence." : "Fix or explicitly classify the changed behavior before release."
    ];
    node_fs_1.default.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
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
function loadScoreForTarget(target, scorePath) {
    const replayPath = resolveReplayPath(target);
    if (node_fs_1.default.existsSync(scorePath)) {
        const score = (0, state_1.readJson)(scorePath);
        if (node_fs_1.default.existsSync(score.paths.comparisonPath)) {
            const comparison = (0, state_1.readJson)(score.paths.comparisonPath);
            if (comparison.replayId === score.replayId && comparison.paths.replayPath === replayPath)
                return score;
        }
    }
    return scoreMultiAgentReplay(target);
}
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
            `  ${value.nextAction}`
        ].join("\n");
    }
    if (isScore(value)) {
        return [
            "Eval Suite",
            `  ${node_path_1.default.basename(value.paths.suiteDir)}`,
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
            `  ${node_path_1.default.basename(value.paths.suiteDir)}`,
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
            `  ${node_path_1.default.basename(value.paths.suiteDir)}`,
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
            `  ${node_path_1.default.dirname(value.reportPath)}`,
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
function captureRun(run) {
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
        trustAudit: (0, trust_audit_1.summarizeTrustAudit)(run),
        multiAgentTrust: (0, multi_agent_trust_1.summarizeMultiAgentTrust)(run),
        operator: (0, operator_ux_1.summarizeOperatorRun)(run)
    };
}
function normalizeRun(run) {
    const operator = (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run);
    const trust = (0, multi_agent_trust_1.summarizeMultiAgentTrust)(run);
    const blackboard = run.blackboard || { boards: [], topics: [], messages: [], contexts: [], artifacts: [], snapshots: [], decisions: [] };
    const topologies = (0, topology_1.summarizeTopologies)(run);
    const multiAgent = (0, multi_agent_1.summarizeMultiAgent)(run);
    return {
        workflow: normalizeValue({
            id: run.workflow.id,
            appId: run.workflow.app?.id,
            appVersion: run.workflow.app?.version,
            taskCount: run.tasks.length
        }),
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
        reportSections: reportSections(run)
    };
}
function collectCandidateScores(run) {
    const scores = [];
    for (const candidate of run.candidates || []) {
        for (const scoreId of candidate.scores || []) {
            const scorePath = node_path_1.default.join(run.paths.candidatesDir || node_path_1.default.join(run.paths.runDir, "candidates"), `${(0, state_1.safeFileName)(candidate.id)}.${(0, state_1.safeFileName)(scoreId)}.score.json`);
            if (node_fs_1.default.existsSync(scorePath)) {
                const score = (0, state_1.readJson)(scorePath);
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
            }
            else {
                scores.push({ candidateId: candidate.id, scoreId, missing: true });
            }
        }
    }
    return scores;
}
function reportSections(run) {
    if (!node_fs_1.default.existsSync(run.paths.report))
        return [];
    const text = node_fs_1.default.readFileSync(run.paths.report, "utf8");
    return text.split("\n").filter((line) => /^#+\s+/.test(line)).map((line) => line.replace(/^#+\s+/, "").trim()).sort();
}
function loadSnapshot(target) {
    const resolved = resolveSnapshotPath(target);
    const snapshot = (0, state_1.readJson)(resolved);
    if (snapshot.kind !== "multi-agent-replay-snapshot")
        throw new Error(`Not a replay snapshot: ${resolved}`);
    assertSnapshotShape(snapshot, resolved);
    return snapshot;
}
function loadReplay(target) {
    const resolved = resolveReplayPath(target);
    const replay = (0, state_1.readJson)(resolved);
    if (replay.kind !== "multi-agent-replay-run")
        throw new Error(`Not a replay run: ${resolved}`);
    assertReplayShape(replay, resolved);
    return replay;
}
function loadBaselineNormalized(target) {
    const snapshotPath = resolveSnapshotPath(target);
    const snapshot = (0, state_1.readJson)(snapshotPath);
    if (snapshot.kind !== "multi-agent-replay-snapshot")
        throw new Error(`Not a replay snapshot: ${snapshotPath}`);
    assertSnapshotShape(snapshot, snapshotPath);
    return { id: snapshot.id, path: snapshotPath, normalized: snapshot.normalized };
}
function assertSnapshotShape(snapshot, file) {
    if (!snapshot.id)
        throw new Error(`Replay snapshot missing id: ${file}`);
    if (!snapshot.runId)
        throw new Error(`Replay snapshot missing runId: ${file}`);
    if (!snapshot.paths || !snapshot.paths.suiteDir || !snapshot.paths.snapshotPath) {
        throw new Error(`Replay snapshot missing paths.suiteDir or paths.snapshotPath: ${file}`);
    }
    assertNormalizedShape(snapshot.normalized, `Replay snapshot missing normalized section: ${file}`);
}
function assertReplayShape(replay, file) {
    if (!replay.id)
        throw new Error(`Replay run missing id: ${file}`);
    if (!replay.snapshotId)
        throw new Error(`Replay run missing snapshotId: ${file}`);
    if (replay.status !== "completed" && replay.status !== "failed") {
        throw new Error(`Replay run has unsupported status ${String(replay.status)}: ${file}`);
    }
    if (!replay.paths || !replay.paths.suiteDir || !replay.paths.replayRunPath || !replay.paths.snapshotPath) {
        throw new Error(`Replay run missing paths.suiteDir, paths.replayRunPath, or paths.snapshotPath: ${file}`);
    }
    if (!Array.isArray(replay.errors))
        throw new Error(`Replay run errors must be an array: ${file}`);
    assertNormalizedShape(replay.replay, `Replay run missing replay section: ${file}`);
}
function assertNormalizedShape(value, message) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(message);
    for (const key of METRIC_SECTIONS.map((entry) => entry.section)) {
        if (key === "workflow") {
            if (!value.workflow || typeof value.workflow !== "object" || Array.isArray(value.workflow))
                throw new Error(`${message}; workflow must be an object`);
        }
        else if (!Array.isArray(value[key])) {
            throw new Error(`${message}; ${String(key)} must be an array`);
        }
    }
}
function loadOrCompareForTarget(target) {
    const suiteDir = resolveSuiteDir(target);
    const comparisonPath = node_path_1.default.join(suiteDir, "comparison.json");
    const replayPath = resolveReplayPath(target);
    if (node_fs_1.default.existsSync(comparisonPath)) {
        const comparison = (0, state_1.readJson)(comparisonPath);
        if (comparison.paths.replayPath === replayPath)
            return comparison;
    }
    return compareMultiAgentReplay(node_path_1.default.join(suiteDir, "snapshot.json"), replayPath);
}
function resolveSnapshotPath(target) {
    const resolved = resolveTargetPath(target);
    if (node_fs_1.default.existsSync(resolved) && node_fs_1.default.statSync(resolved).isDirectory())
        return node_path_1.default.join(resolved, "snapshot.json");
    if (node_fs_1.default.existsSync(resolved))
        return resolved;
    return node_path_1.default.join(process.cwd(), ".cw", "evals", (0, state_1.safeFileName)(target), "snapshot.json");
}
function resolveReplayPath(target) {
    const resolved = resolveTargetPath(target);
    if (node_fs_1.default.existsSync(resolved) && node_fs_1.default.statSync(resolved).isDirectory())
        return node_path_1.default.join(resolved, "replay-run.json");
    if (node_fs_1.default.existsSync(resolved))
        return resolved;
    return node_path_1.default.join(process.cwd(), ".cw", "evals", (0, state_1.safeFileName)(target), "replay-run.json");
}
function resolveSuiteDir(target) {
    const resolved = resolveTargetPath(target);
    if (node_fs_1.default.existsSync(resolved)) {
        if (node_fs_1.default.statSync(resolved).isDirectory())
            return resolved;
        const value = (0, state_1.readJson)(resolved);
        if (value.paths?.suiteDir)
            return value.paths.suiteDir;
        return node_path_1.default.dirname(resolved);
    }
    return node_path_1.default.join(process.cwd(), ".cw", "evals", (0, state_1.safeFileName)(target));
}
function resolveTargetPath(target) {
    if (!target)
        throw new Error("Missing eval target");
    return node_path_1.default.isAbsolute(target) ? target : node_path_1.default.resolve(target);
}
function evalSuiteDir(cwd, suiteId) {
    return node_path_1.default.join(cwd, ".cw", "evals", (0, state_1.safeFileName)(suiteId));
}
function writeSuite(suite) {
    (0, state_1.writeJson)(node_path_1.default.join(suite.paths.suiteDir, "suite.json"), suite);
}
function loadSuiteFromDir(suiteDir) {
    const suitePath = node_path_1.default.join(suiteDir, "suite.json");
    if (node_fs_1.default.existsSync(suitePath))
        return (0, state_1.readJson)(suitePath);
    return {
        schemaVersion: 1,
        id: node_path_1.default.basename(suiteDir),
        title: `Multi-Agent Eval Suite ${node_path_1.default.basename(suiteDir)}`,
        createdAt: now(),
        cases: [],
        paths: { suiteDir, snapshotPath: node_path_1.default.join(suiteDir, "snapshot.json") }
    };
}
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
        if (["createdAt", "updatedAt", "recordedAt", "selectedAt", "replayedAt", "generatedAt"].includes(key))
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
function normalizeString(value) {
    return value
        .replace(/[0-9]{8}T[0-9]{6}Z/g, "<timestamp>")
        .replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/g, "<timestamp>")
        .replace(/\/[^"\s]+\/\.cw\/runs\/[^"\s/]+/g, "<run-dir>")
        .replace(/\/[^"\s]+\/\.cw\/evals\/[^"\s/]+/g, "<eval-dir>")
        .replace(/\/var\/folders\/[^"\s]+|\/tmp\/[^"\s]+|\/private\/tmp\/[^"\s]+/g, "<tmp>");
}
function lines(value) {
    const normalized = normalizeValue(value);
    if (Array.isArray(normalized))
        return normalized.map((entry) => stableStringify(entry)).sort();
    return [stableStringify(normalized)].sort();
}
function stableStringify(value) {
    return JSON.stringify(normalizeValue(value));
}
function now() {
    return new Date().toISOString();
}
function metricLine(score, id) {
    const metric = score.metrics.find((entry) => entry.id === id);
    return `- ${id}: ${metric?.status || "missing"} - ${metric?.reason || "metric missing"}`;
}
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
