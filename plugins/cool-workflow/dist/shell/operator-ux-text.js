"use strict";
// shell/operator-ux-text.ts — human-readable rendering for the operator
// console surface (`cw status`, `cw graph`, `cw operator status|report|
// graph`). Lives in shell/ (not core/format/) because it calls term.ts's
// `dim()`, which is TTY/env-aware.
//
// MILESTONE 11 (reporting/observability). Byte-exact port of the parts of
// the old build's src/operator-ux/format.ts this milestone's conformance
// surface exercises: formatOperatorSummary (`--summary`/`--brief`),
// formatOperatorStatus (full `cw status`), formatOperatorReport (`cw
// report --show`), formatOperatorGraph (`cw graph`).
//
// Evidence: SPEC/reporting-ux.md "Operator UX human text";
// plugins/cool-workflow/src/operator-ux/format.ts:1-132 (byte-exact
// source for the ported pieces).
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatOperatorSummary = formatOperatorSummary;
exports.formatMultiAgentTrustAudit = formatMultiAgentTrustAudit;
exports.formatMultiAgentSummaryText = formatMultiAgentSummaryText;
exports.formatOperatorStatus = formatOperatorStatus;
exports.formatOperatorReport = formatOperatorReport;
exports.formatOperatorGraph = formatOperatorGraph;
exports.formatCandidateSummaryText = formatCandidateSummaryText;
exports.formatFeedbackSummaryText = formatFeedbackSummaryText;
const term_1 = require("./term");
const multi_agent_operator_ux_1 = require("./multi-agent-operator-ux");
const collate_1 = require("../core/util/collate");
function formatCounts(counts) {
    const entries = Object.entries(counts).sort(([a], [b]) => (0, collate_1.stableCompare)(a, b));
    if (!entries.length)
        return "none";
    return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}
function formatRecommendations(actions) {
    if (!actions.length)
        return ["  none"];
    const lines = [];
    for (const action of actions) {
        lines.push(`  ${action.command}`);
        lines.push(`    reason: ${action.reason}`);
    }
    return lines;
}
/** Compact summary — `cw status <id> --summary`/`--brief`. Byte-exact
 *  port of formatOperatorSummary. */
function formatOperatorSummary(summary) {
    return [
        `Run: ${summary.runId}`,
        `Workflow: ${summary.workflowId}${summary.appId ? ` (${summary.appId}@${summary.appVersion || "unknown"})` : ""}`,
        `Phase: ${summary.activePhase || "none"} | Stage: ${summary.loopStage} | Blocked: ${summary.blocked ? summary.blockedReasons.join("; ") : "no"}`,
        `Tasks: ${formatCounts(summary.tasks.byStatus)}; total=${summary.tasks.total}`,
        ...summary.phases.map((phase) => `  ${phase.name}: ${phase.status} (${phase.tasks.completed || 0}/${phase.tasks.total} completed)`),
        "",
        "Next Action",
        ...formatRecommendations(summary.nextActions),
        "",
        (0, term_1.dim)("(use --verbose for full worker/candidate/feedback/commit/trust panels)"),
    ].join("\n");
}
function formatWorkerPanel(summary) {
    const lines = ["Workers", `  Total: ${summary.total}`, `  By status: ${formatCounts(summary.byStatus)}`];
    for (const worker of summary.workers)
        lines.push(`  - ${worker.id} (${worker.status}) task=${worker.taskId}`);
    return lines.join("\n");
}
function formatCandidatePanel(summary) {
    return [
        "Candidates",
        `  Total: ${summary.total}`,
        `  By status: ${formatCounts(summary.byStatus)}`,
        `  By kind: ${formatCounts(summary.byKind)}`,
        `  Selections: ${summary.selections}`,
        `  ready for commit=${summary.readyForCommit.map((item) => `${item.candidateId}/${item.selectionId}`).join(", ") || "none"}`,
    ].join("\n");
}
function formatFeedbackPanel(summary) {
    return ["Feedback", `  Total: ${summary.total}`, `  By status: ${formatCounts(summary.byStatus)}`, `  By severity: ${formatCounts(summary.bySeverity)}`].join("\n");
}
function formatCommitPanel(summary) {
    const lines = [
        "Commits",
        `  total=${summary.total}; verifier-gated=${summary.verifierGated}; checkpoints=${summary.checkpoints}`,
    ];
    for (const commit of summary.commits)
        lines.push(`  - ${commit.id}: ${commit.reason}`);
    return lines.join("\n");
}
function formatTrustPanel(summary) {
    return [
        "Trust Audit",
        `  Events: ${summary.eventCount}`,
        `  Chain integrity: ${summary.integrity.verified ? "verified" : "FAILED"}`,
    ].join("\n");
}
function arrayView(value) {
    return Array.isArray(value) ? value : [];
}
function formatRolePolicyRows(rows) {
    if (!rows.length)
        return ["  none"];
    return rows.slice(0, 40).map((row) => {
        const writes = Array.isArray(row.allowedWriteOperations) ? row.allowedWriteOperations.join(",") : "none";
        const candidates = Array.isArray(row.allowedCandidateOperations) ? row.allowedCandidateOperations.join(",") : "none";
        const judges = Array.isArray(row.allowedJudgeOperations) ? row.allowedJudgeOperations.join(",") : "none";
        const topics = Array.isArray(row.allowedBlackboardTopicIds) ? row.allowedBlackboardTopicIds.join(",") : "none";
        return `  ${String(row.policyRef || row.id || row.subjectId)} subject=${String(row.subjectKind || "unknown")}:${String(row.subjectId || "unknown")} topics=${topics} writes=${writes} candidates=${candidates} judges=${judges}`;
    });
}
function formatAuditEventRows(rows) {
    if (!rows.length)
        return ["  none"];
    return rows.slice(0, 60).map((row) => {
        const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
        const ids = [
            row.agentRoleId ? `role=${row.agentRoleId}` : "",
            row.agentMembershipId ? `membership=${row.agentMembershipId}` : "",
            row.blackboardMessageId ? `message=${row.blackboardMessageId}` : "",
            row.blackboardContextId ? `context=${row.blackboardContextId}` : "",
            row.blackboardArtifactRefId ? `artifact=${row.blackboardArtifactRefId}` : "",
            row.coordinatorDecisionId ? `decision=${row.coordinatorDecisionId}` : "",
            row.candidateId ? `candidate=${row.candidateId}` : "",
            row.scoreId ? `score=${row.scoreId}` : "",
            row.selectionId ? `selection=${row.selectionId}` : "",
        ].filter(Boolean).join(" ");
        const reason = metadata.reason ? ` reason=${String(metadata.reason)}` : "";
        const operation = metadata.operation ? ` operation=${String(metadata.operation)}` : "";
        return `  [${String(row.decision || "recorded")}] ${String(row.kind || "event")} ${String(row.id || "")}${operation}${ids ? ` ${ids}` : ""}${row.policyRef ? ` policy=${String(row.policyRef)}` : ""}${reason}`;
    });
}
/** `cw audit multi-agent|policy|role|blackboard|judge` human render — port
 *  of the old build's formatMultiAgentTrustAudit (operator-ux/format.ts). */
function formatMultiAgentTrustAudit(view) {
    return [
        `Multi-Agent Trust: ${String(view.runId || "unknown")}`,
        "",
        "Role Policies",
        ...formatRolePolicyRows(arrayView(view.rolePolicies)),
        "",
        "Permission Decisions",
        ...formatAuditEventRows(arrayView(view.permissionDecisions)),
        "",
        "Blackboard Write Audit",
        ...formatAuditEventRows(arrayView(view.blackboardWrites)),
        "",
        "Message Provenance",
        ...formatAuditEventRows(arrayView(view.messageProvenance)),
        "",
        "Judge Rationales",
        ...formatAuditEventRows([...arrayView(view.judgeRationales), ...arrayView(view.panelDecisions)]),
        "",
        "Policy Violations",
        ...formatAuditEventRows(arrayView(view.policyViolations)),
        "",
        "Next Action",
        `  ${String(view.nextAction || `cw audit multi-agent ${String(view.runId || "<run-id>")} --json`)}`,
    ].join("\n");
}
/** `Topologies` panel — port of the old build's formatTopologyPanel
 *  (operator-ux/format.ts): the topology-run rollup with per-run roles/
 *  topics/fanout/fanin/readiness. */
function formatTopologyPanel(summary) {
    const lines = [
        "Topologies",
        `  runs=${summary.totalRuns}; status=${formatCounts(summary.runsByStatus)}; official=${summary.officialTopologies.join(", ")}`,
    ];
    for (const record of summary.active.slice(0, 6)) {
        lines.push(`  ${record.id}: ${record.topologyId}, status=${record.status}, readiness=${record.readiness}`);
        lines.push(`    run=${record.multiAgentRunId} board=${record.blackboardId}`);
        lines.push(`    roles=${record.roles.join(", ") || "none"} topics=${record.topics.join(", ") || "none"}`);
        lines.push(`    fanout=${record.fanouts.join(", ") || "none"} fanin=${record.fanins.join(", ") || "none"}`);
        for (const missing of record.missingEvidence.slice(0, 4))
            lines.push(`    missing=${missing}`);
        for (const conflict of record.conflicts.slice(0, 4))
            lines.push(`    conflict=${conflict}`);
        if (record.nextActions[0])
            lines.push(`    next=${record.nextActions[0]}`);
    }
    if (summary.nextAction)
        lines.push(`  next=${summary.nextAction}`);
    return lines.join("\n");
}
/** `Multi-Agent` panel — port of the old build's formatMultiAgentPanel
 *  (operator-ux/format.ts): the run/role/group/membership/fanout/fanin
 *  rollup with per-group role coverage and blocked reasons. */
function formatMultiAgentPanel(summary) {
    const lines = [
        "Multi-Agent",
        `  runs=${summary.totalRuns}; status=${formatCounts(summary.runsByStatus)}`,
        `  roles=${summary.roles}; groups=${summary.groups} (${formatCounts(summary.groupsByStatus)})`,
        `  memberships=${summary.memberships} (${formatCounts(summary.membershipsByStatus)})`,
        `  fanouts=${summary.fanouts}; fanins=${summary.fanins} (${formatCounts(summary.faninsByStatus)})`,
    ];
    for (const group of summary.groupsDetail.slice(0, 6)) {
        lines.push(`  group ${group.id}: ${group.status}, phase=${group.phase || "none"}, run=${group.multiAgentRunId}`);
        for (const role of group.roles.slice(0, 6)) {
            lines.push(`    role ${role.roleId}: memberships=${role.memberships}, reported=${role.reported}, missing=${role.missing}`);
        }
        lines.push(`    fanout=${group.fanouts.join(", ") || "none"} fanin=${group.fanins.join(", ") || "none"}`);
    }
    for (const reason of summary.blockedReasons.slice(0, 6))
        lines.push(`  blocked: ${reason}`);
    if (summary.nextAction)
        lines.push(`  next=${summary.nextAction}`);
    return lines.join("\n");
}
/** `cw multi-agent summary <run>` human text — the same `Multi-Agent`
 *  panel `cw status` shows, port of the old build's formatMultiAgentSummary
 *  (operator-ux/format.ts). */
function formatMultiAgentSummaryText(summary) {
    return formatMultiAgentPanel(summary);
}
/** `Multi-Agent Operator UX` block — port of the old build's inline
 *  operator-status summary (operator-ux/format.ts:41-45): active runs,
 *  dependency/failure/evidence counts, and the next command. */
function formatMultiAgentOperatorBlock(operator) {
    return [
        "Multi-Agent Operator UX",
        `  active=${operator.activeMultiAgentRunIds.join(", ") || "none"}; topologies=${operator.topologyRunIds.join(", ") || "none"}; blocked=${operator.blocked ? "yes" : "no"}`,
        `  dependencies=${operator.dependencies.length}; failures=${operator.failures.length}; adoptedEvidence=${operator.adoptedEvidence.length}; missingEvidence=${operator.missingEvidence.length}${operator.inspectableEvidence.length ? ` (inspectable=${operator.inspectableEvidence.length})` : ""}`,
        `  next=${operator.nextAction}`,
    ].join("\n");
}
/** `Blackboard / Coordinator` panel — port of the old build's
 *  formatBlackboardPanel (operator-ux/format.ts). */
function formatBlackboardPanel(summary) {
    const lines = [
        "Blackboard / Coordinator",
        `  board=${summary.blackboardId || "none"}; topics=${summary.topics}; messages=${summary.messages}; contexts=${summary.contexts}; artifacts=${summary.artifacts}`,
        `  open questions=${summary.openQuestions.length}; conflicts=${summary.conflicts.length}; missing evidence=${summary.missingEvidence.length}`,
        `  ready for fanin=${summary.readyForFanin ? "yes" : "no"}`,
        `  index=${summary.indexPath || "none"}`,
        `  latest snapshot=${summary.latestSnapshotPath || "none"}`,
    ];
    for (const question of summary.openQuestions.slice(0, 5))
        lines.push(`  question ${question.id}: ${question.value}`);
    for (const conflict of summary.conflicts.slice(0, 5))
        lines.push(`  conflict ${conflict.id}: ${conflict.key} -> ${conflict.conflictingContextIds.join(", ") || "unindexed"}`);
    for (const missing of summary.missingEvidence.slice(0, 5))
        lines.push(`  missing: ${missing}`);
    if (summary.nextAction)
        lines.push(`  next=${summary.nextAction}`);
    return lines.join("\n");
}
/** The full `cw status <id>` human render — port of formatOperatorStatus's
 *  panel order (worker/candidate/feedback/commit, then the
 *  multi-agent/operator-ux/blackboard sub-panels the operator-ux smokes
 *  pin, then trust and the report path). */
function formatOperatorStatus(summary) {
    return [
        formatOperatorSummary(summary),
        "",
        formatWorkerPanel(summary.workers),
        "",
        formatCandidatePanel(summary.candidates),
        "",
        formatFeedbackPanel(summary.feedback),
        "",
        formatCommitPanel(summary.commits),
        "",
        formatTopologyPanel(summary.multiAgentOperator.summaries.topologies),
        "",
        formatMultiAgentPanel(summary.multiAgent),
        "",
        formatMultiAgentOperatorBlock(summary.multiAgentOperator),
        "",
        formatBlackboardPanel(summary.blackboard),
        "",
        formatTrustPanel(summary.trust),
        "",
        formatMultiAgentTrustAudit(summary.multiAgentTrust),
        "",
        `Report: ${summary.reportPath}`,
    ].join("\n");
}
function formatTaskList(tasks) {
    const active = [...tasks.running, ...tasks.pending];
    if (!active.length)
        return ["  none"];
    return active.map((id) => `  ${id}`);
}
/** `cw report <id> --show` — byte-exact port of formatOperatorReport's
 *  fixed 18-line Resource Commands tail plus Active/Pending Tasks and
 *  Evidence sections (multi-agent dependency/failure/evidence panels are
 *  scoped out of this milestone's port per the file header note). */
function formatOperatorReport(summary, evidencePaths) {
    return [
        formatOperatorStatus(summary),
        "",
        "Active and Pending Tasks",
        ...formatTaskList(summary.tasks),
        "",
        "Evidence",
        ...(evidencePaths.length ? evidencePaths.map((entry) => `  ${entry}`) : ["  none recorded"]),
        "",
        (0, multi_agent_operator_ux_1.formatMultiAgentDependencies)(summary.multiAgentOperator.dependencies),
        "",
        (0, multi_agent_operator_ux_1.formatMultiAgentFailures)(summary.multiAgentOperator.failures),
        "",
        (0, multi_agent_operator_ux_1.formatMultiAgentEvidence)(summary.multiAgentOperator.evidence),
        "",
        "Resource Commands",
        `  cw graph ${summary.runId}`,
        `  cw worker summary ${summary.runId}`,
        `  cw topology summary ${summary.runId}`,
        `  cw topology graph ${summary.runId}`,
        `  cw multi-agent summary ${summary.runId}`,
        `  cw multi-agent graph ${summary.runId}`,
        `  cw multi-agent dependencies ${summary.runId}`,
        `  cw multi-agent failures ${summary.runId}`,
        `  cw multi-agent evidence ${summary.runId}`,
        `  cw blackboard summary ${summary.runId}`,
        `  cw blackboard graph ${summary.runId}`,
        `  cw coordinator summary ${summary.runId}`,
        `  cw candidate summary ${summary.runId}`,
        `  cw feedback summary ${summary.runId}`,
        `  cw commit summary ${summary.runId}`,
        `  cw audit summary ${summary.runId}`,
        `  cw audit provenance ${summary.runId}`,
        `  cw audit multi-agent ${summary.runId}`,
        `  cw audit policy ${summary.runId}`,
        `  cw audit blackboard ${summary.runId}`,
        `  cw audit judge ${summary.runId}`,
    ].join("\n");
}
function groupBy(values, key) {
    const groups = {};
    for (const value of values) {
        const bucket = key(value);
        (groups[bucket] ||= []).push(value);
    }
    return groups;
}
/** `cw graph <id>` human render — byte-exact port of formatOperatorGraph. */
function formatOperatorGraph(graph) {
    const lines = [`Run Graph: ${graph.runId}`, "", "Nodes"];
    const groups = groupBy(graph.nodes, (node) => node.kind);
    for (const kind of Object.keys(groups).sort()) {
        lines.push(`  ${kind}`);
        for (const node of groups[kind]) {
            const suffix = node.path ? ` -> ${node.path}` : "";
            lines.push(`    [${node.status}] ${node.id} (${node.label})${suffix}`);
        }
    }
    lines.push("", "Edges");
    if (!graph.edges.length)
        lines.push("  none");
    for (const edge of graph.edges) {
        lines.push(`  ${edge.from} -> ${edge.to}${edge.label ? ` (${edge.label})` : ""}`);
    }
    return lines.join("\n");
}
/** `cw candidate summary <run>` human text — port of the old build's
 *  formatCandidatePanel (operator-ux/format.ts): a `Candidates` rollup with
 *  status/kind counts, the latest ranking, and the ready-for-commit list. */
function formatCandidateSummaryText(summary) {
    const lines = [
        "Candidates",
        `  total=${summary.total}; status=${formatCounts(summary.byStatus)}; kind=${formatCounts(summary.byKind)}`,
        `  latest ranking=${summary.latestRankingPath || summary.rankingPath || "none"}`,
        `  selected=${summary.selected.map((selection) => `${selection.candidateId}/${selection.selectionId}`).join(", ") || "none"}`,
        `  ready for commit=${summary.readyForCommit.map((item) => `${item.candidateId}/${item.selectionId}`).join(", ") || "none"}`,
    ];
    for (const problem of summary.problems.slice(0, 5))
        lines.push(`  problem: ${problem}`);
    for (const candidate of summary.candidates.slice(0, 8)) {
        lines.push(`  ${candidate.id}: ${candidate.status}, scores=${candidate.scoreCount}, selected=${candidate.selected ? "yes" : "no"}`);
    }
    if (summary.candidates.length > 8)
        lines.push(`  ... ${summary.candidates.length - 8} more candidate(s)`);
    return lines.join("\n");
}
/** `cw feedback summary <run>` human text — port of the old build's
 *  formatFeedbackPanel (operator-ux/format.ts): a `Feedback` rollup with
 *  status/severity/classification counts. */
function formatFeedbackSummaryText(summary) {
    return [
        "Feedback",
        `  total=${summary.total}; status=${formatCounts(summary.byStatus)}`,
        `  severity=${formatCounts(summary.bySeverity)}`,
        `  classification=${formatCounts(summary.byClassification)}`,
    ].join("\n");
}
