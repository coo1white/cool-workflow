"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatOperatorStatus = formatOperatorStatus;
exports.formatOperatorSummary = formatOperatorSummary;
exports.formatOperatorReport = formatOperatorReport;
exports.formatOperatorGraph = formatOperatorGraph;
exports.formatWorkerSummary = formatWorkerSummary;
exports.formatCandidateSummary = formatCandidateSummary;
exports.formatFeedbackSummary = formatFeedbackSummary;
exports.formatCommitSummary = formatCommitSummary;
exports.formatMultiAgentSummary = formatMultiAgentSummary;
exports.formatTopologySummary = formatTopologySummary;
exports.formatMultiAgentTrustAudit = formatMultiAgentTrustAudit;
const multi_agent_operator_ux_1 = require("../multi-agent-operator-ux");
const term_1 = require("../term");
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
        formatTopologyPanel(summary.topologies),
        "",
        formatMultiAgentPanel(summary.multiAgent),
        "",
        "Multi-Agent Operator UX",
        `  active=${operator(summary).activeMultiAgentRunIds.join(", ") || "none"}; topologies=${operator(summary).topologyRunIds.join(", ") || "none"}; blocked=${operator(summary).blocked ? "yes" : "no"}`,
        `  dependencies=${operator(summary).dependencies.length}; failures=${operator(summary).failures.length}; adoptedEvidence=${operator(summary).adoptedEvidence.length}; missingEvidence=${operator(summary).missingEvidence.length}${operator(summary).inspectableEvidence.length ? ` (inspectable=${operator(summary).inspectableEvidence.length})` : ""}`,
        `  next=${operator(summary).nextAction}`,
        "",
        formatBlackboardPanel(summary.blackboard),
        "",
        formatTrustPanel(summary.trust),
        "",
        formatMultiAgentTrustAudit(summary.multiAgentTrust),
        "",
        `Report: ${summary.reportPath}`
    ].join("\n");
}
function operator(summary) { return summary.multiAgentOperator; }
/** Compact summary — the default `cw status` output. `cw status --verbose` shows the full panel. */
function formatOperatorSummary(summary) {
    return [
        `Run: ${summary.runId}`,
        `Workflow: ${summary.workflowId}${summary.appId ? ` (${summary.appId}@${summary.appVersion || "unknown"})` : ""}`,
        `Phase: ${summary.activePhase || "none"} | Stage: ${summary.loopStage} | Blocked: ${summary.blocked ? summary.blockedReasons.join("; ") : "no"}`,
        `Tasks: ${formatCounts(summary.tasks.byStatus)}; total=${summary.tasks.total}`,
        ...summary.phases.map((phase) => `  ${phase.name}: ${phase.status} (${phase.tasks.completed}/${phase.tasks.total} completed)`),
        "",
        "Next Action",
        ...formatRecommendations(summary.nextActions),
        "",
        (0, term_1.dim)(`(use --verbose for full worker/candidate/feedback/commit/trust panels)`)
    ].join("\n");
}
function formatOperatorReport(summary) {
    return [
        formatOperatorStatus(summary),
        "",
        "Active and Pending Tasks",
        ...formatTaskList(summary.tasks),
        "",
        "Evidence",
        ...(summary.evidencePaths.length ? summary.evidencePaths.map((entry) => `  ${entry}`) : ["  none recorded"]),
        "",
        (0, multi_agent_operator_ux_1.formatMultiAgentDependencies)(summary.multiAgentOperator.dependencies),
        "",
        (0, multi_agent_operator_ux_1.formatMultiAgentFailures)(summary.multiAgentOperator.failures),
        "",
        (0, multi_agent_operator_ux_1.formatMultiAgentEvidence)(summary.multiAgentOperator.evidence),
        "",
        "Resource Commands",
        `  node scripts/cw.js graph ${summary.runId}`,
        `  node scripts/cw.js worker summary ${summary.runId}`,
        `  node scripts/cw.js topology summary ${summary.runId}`,
        `  node scripts/cw.js topology graph ${summary.runId}`,
        `  node scripts/cw.js multi-agent summary ${summary.runId}`,
        `  node scripts/cw.js multi-agent graph ${summary.runId}`,
        `  node scripts/cw.js multi-agent dependencies ${summary.runId}`,
        `  node scripts/cw.js multi-agent failures ${summary.runId}`,
        `  node scripts/cw.js multi-agent evidence ${summary.runId}`,
        `  node scripts/cw.js blackboard summary ${summary.runId}`,
        `  node scripts/cw.js blackboard graph ${summary.runId}`,
        `  node scripts/cw.js coordinator summary ${summary.runId}`,
        `  node scripts/cw.js candidate summary ${summary.runId}`,
        `  node scripts/cw.js feedback summary ${summary.runId}`,
        `  node scripts/cw.js commit summary ${summary.runId}`,
        `  node scripts/cw.js audit summary ${summary.runId}`,
        `  node scripts/cw.js audit provenance ${summary.runId}`,
        `  node scripts/cw.js audit multi-agent ${summary.runId}`,
        `  node scripts/cw.js audit policy ${summary.runId}`,
        `  node scripts/cw.js audit blackboard ${summary.runId}`,
        `  node scripts/cw.js audit judge ${summary.runId}`
    ].join("\n");
}
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
function formatWorkerSummary(summary) {
    return formatWorkerPanel(summary);
}
function formatCandidateSummary(summary) {
    return formatCandidatePanel(summary);
}
function formatFeedbackSummary(summary) {
    return formatFeedbackPanel(summary);
}
function formatCommitSummary(summary) {
    return formatCommitPanel(summary);
}
function formatTrustPanel(summary) {
    const lines = [
        "Trust Audit",
        `  total=${summary.eventCount}; decision=${formatCounts(summary.byDecision)}; source=${formatCounts(summary.bySource)}`,
        `  sandbox=${formatCounts(summary.bySandboxProfile)}`,
        `  multi-agent trust=${summary.multiAgentTrust ? formatCounts(summary.multiAgentTrust) : "none"}`,
        `  events=${summary.eventLogPath}`,
        `  summary=${summary.summaryPath}`
    ];
    for (const worker of summary.workers.slice(0, 6)) {
        lines.push(`  worker ${worker.workerId}: sandbox=${worker.sandboxProfileId || "none"}, decisions=${formatCounts(worker.decisions)}, denied=${worker.denied}`);
    }
    return lines.join("\n");
}
function formatMultiAgentSummary(summary) {
    return formatMultiAgentPanel(summary);
}
function formatTopologySummary(summary) {
    return formatTopologyPanel(summary);
}
function formatMultiAgentTrustAudit(view) {
    const rolePolicies = arrayView(view.rolePolicies);
    const permissionDecisions = arrayView(view.permissionDecisions);
    const blackboardWrites = arrayView(view.blackboardWrites);
    const messageProvenance = arrayView(view.messageProvenance);
    const judgeRationales = arrayView(view.judgeRationales);
    const panelDecisions = arrayView(view.panelDecisions);
    const policyViolations = arrayView(view.policyViolations);
    return [
        `Multi-Agent Trust: ${String(view.runId || "unknown")}`,
        "",
        "Role Policies",
        ...formatRolePolicyRows(rolePolicies),
        "",
        "Permission Decisions",
        ...formatAuditRows(permissionDecisions),
        "",
        "Blackboard Write Audit",
        ...formatAuditRows(blackboardWrites),
        "",
        "Message Provenance",
        ...formatAuditRows(messageProvenance),
        "",
        "Judge Rationales",
        ...formatAuditRows([...judgeRationales, ...panelDecisions]),
        "",
        "Policy Violations",
        ...formatAuditRows(policyViolations),
        "",
        "Next Action",
        `  ${String(view.nextAction || `node scripts/cw.js audit multi-agent ${String(view.runId || "<run-id>")} --json`)}`
    ].join("\n");
}
function formatTopologyPanel(summary) {
    const lines = [
        "Topologies",
        `  runs=${summary.totalRuns}; status=${formatCounts(summary.runsByStatus)}; official=${summary.officialTopologies.join(", ")}`
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
function formatMultiAgentPanel(summary) {
    const lines = [
        "Multi-Agent",
        `  runs=${summary.totalRuns}; status=${formatCounts(summary.runsByStatus)}`,
        `  roles=${summary.roles}; groups=${summary.groups} (${formatCounts(summary.groupsByStatus)})`,
        `  memberships=${summary.memberships} (${formatCounts(summary.membershipsByStatus)})`,
        `  fanouts=${summary.fanouts}; fanins=${summary.fanins} (${formatCounts(summary.faninsByStatus)})`
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
function formatBlackboardPanel(summary) {
    const lines = [
        "Blackboard / Coordinator",
        `  board=${summary.blackboardId || "none"}; topics=${summary.topics}; messages=${summary.messages}; contexts=${summary.contexts}; artifacts=${summary.artifacts}`,
        `  open questions=${summary.openQuestions.length}; conflicts=${summary.conflicts.length}; missing evidence=${summary.missingEvidence.length}`,
        `  ready for fanin=${summary.readyForFanin ? "yes" : "no"}`,
        `  index=${summary.indexPath || "none"}`,
        `  latest snapshot=${summary.latestSnapshotPath || "none"}`
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
function formatAuditRows(rows) {
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
            row.selectionId ? `selection=${row.selectionId}` : ""
        ].filter(Boolean).join(" ");
        const reason = metadata.reason ? ` reason=${String(metadata.reason)}` : "";
        const operation = metadata.operation ? ` operation=${String(metadata.operation)}` : "";
        return `  [${String(row.decision || "recorded")}] ${String(row.kind || "event")} ${String(row.id || "")}${operation}${ids ? ` ${ids}` : ""}${row.policyRef ? ` policy=${String(row.policyRef)}` : ""}${reason}`;
    });
}
function formatWorkerPanel(summary) {
    const lines = [
        "Workers",
        `  total=${summary.total}; status=${formatCounts(summary.byStatus)}; sandbox=${formatCounts(summary.bySandboxProfile)}; backend=${formatCounts(summary.byBackend)}`
    ];
    for (const worker of summary.workers.slice(0, 8)) {
        const attestation = worker.backendAttestationStatus ? `/${worker.backendAttestationStatus}` : "";
        lines.push(`  ${worker.id}: ${worker.status}, task=${worker.taskId}, sandbox=${worker.sandboxProfileId || "none"}, backend=${worker.backendId || "none"}${attestation}`);
        lines.push(`    manifest=${worker.manifestPath}`);
        lines.push(`    result=${worker.resultPath}`);
        if (worker.feedbackIds.length)
            lines.push(`    feedback=${worker.feedbackIds.join(", ")}`);
    }
    if (summary.workers.length > 8)
        lines.push(`  ... ${summary.workers.length - 8} more worker(s)`);
    return lines.join("\n");
}
function formatCandidatePanel(summary) {
    const lines = [
        "Candidates",
        `  total=${summary.total}; status=${formatCounts(summary.byStatus)}; kind=${formatCounts(summary.byKind)}`,
        `  latest ranking=${summary.latestRankingPath || "none"}`,
        `  selected=${summary.selected.map((selection) => `${selection.candidateId}/${selection.selectionId}`).join(", ") || "none"}`,
        `  ready for commit=${summary.readyForCommit.map((item) => `${item.candidateId}/${item.selectionId}`).join(", ") || "none"}`
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
function formatFeedbackPanel(summary) {
    const lines = [
        "Feedback",
        `  total=${summary.total}; status=${formatCounts(summary.byStatus)}`,
        `  severity=${formatCounts(summary.bySeverity)}`,
        `  classification=${formatCounts(summary.byClassification)}`,
        `  retryable=${summary.retryable}; nonRetryable=${summary.nonRetryable}`
    ];
    for (const record of summary.open.slice(0, 6)) {
        lines.push(`  ${record.id}: ${record.severity}/${record.classification}, retryable=${record.retryable ? "yes" : "no"}`);
        lines.push(`    ${record.message}`);
    }
    return lines.join("\n");
}
function formatCommitPanel(summary) {
    const lines = [
        "Commits",
        `  total=${summary.total}; verifier-gated=${summary.verifierGated}; checkpoints=${summary.checkpoints}`,
        `  latest=${summary.latest ? `${summary.latest.id} (${summary.latest.kind}) ${summary.latest.snapshotPath}` : "none"}`
    ];
    for (const commit of summary.commits.slice(-8)) {
        lines.push(`  ${commit.id}: ${commit.kind}, reason=${commit.reason}`);
        lines.push(`    verifier=${commit.verifierNodeId || "none"} candidate=${commit.candidateId || "none"} selection=${commit.selectionId || "none"} evidence=${commit.evidenceCount}`);
        lines.push(`    snapshot=${commit.snapshotPath}`);
    }
    return lines.join("\n");
}
function formatTaskList(summary) {
    const lines = [];
    for (const [label, values] of [
        ["pending", summary.pending],
        ["running", summary.running],
        ["failed", summary.failed]
    ]) {
        lines.push(`  ${label}: ${values.length ? values.join(", ") : "none"}`);
    }
    return lines;
}
function formatRecommendations(actions) {
    return actions.length ? actions.map((action) => `  ${action.command}\n    reason: ${action.reason}`) : ["  none"];
}
function formatCounts(counts) {
    const entries = Object.entries(counts).filter(([, value]) => value > 0).sort(([left], [right]) => left.localeCompare(right));
    if (!entries.length)
        return "none";
    return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}
function groupBy(items, getKey) {
    const groups = {};
    for (const item of items) {
        const key = getKey(item);
        groups[key] = groups[key] || [];
        groups[key].push(item);
    }
    return groups;
}
