// shell/operator-ux-text.ts — human-readable rendering for the operator
// console surface (`cw status`, `cw graph`, `cw operator status|report|
// graph`). Lives in shell/ (not core/format/) because it calls term.ts's
// `dim()`, which is TTY/env-aware.
//
// formatOperatorSummary (`--summary`/`--brief`), formatOperatorStatus
// (full `cw status`), formatOperatorReport (`cw report --show`),
// formatOperatorGraph (`cw graph`).
//
// Evidence: SPEC/reporting-ux.md "Operator UX human text".
import { dim } from "./term.js";
import { stableCompare } from "../core/util/collate.js";
function formatCounts(counts) {
    const entries = Object.entries(counts).sort(([a], [b]) => stableCompare(a, b));
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
/** Compact summary — `cw status <id> --summary`/`--brief`. */
export function formatOperatorSummary(summary) {
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
        dim("(use --verbose for full worker/feedback/commit/trust panels)"),
    ].join("\n");
}
function formatWorkerPanel(summary) {
    const lines = ["Workers", `  Total: ${summary.total}`, `  By status: ${formatCounts(summary.byStatus)}`];
    for (const worker of summary.workers)
        lines.push(`  - ${worker.id} (${worker.status}) task=${worker.taskId}`);
    return lines.join("\n");
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
/** The full `cw status <id>` human render, in panel order
 *  (worker/feedback/commit, then trust and the report path). */
export function formatOperatorStatus(summary) {
    return [
        formatOperatorSummary(summary),
        "",
        formatWorkerPanel(summary.workers),
        "",
        formatFeedbackPanel(summary.feedback),
        "",
        formatCommitPanel(summary.commits),
        "",
        formatTrustPanel(summary.trust),
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
/** `cw report <id> --show`: the Resource Commands tail plus
 *  Active/Pending Tasks and Evidence sections. */
export function formatOperatorReport(summary, evidencePaths) {
    return [
        formatOperatorStatus(summary),
        "",
        "Active and Pending Tasks",
        ...formatTaskList(summary.tasks),
        "",
        "Evidence",
        ...(evidencePaths.length ? evidencePaths.map((entry) => `  ${entry}`) : ["  none recorded"]),
        "",
        "Resource Commands",
        `  cw graph ${summary.runId}`,
        `  cw worker summary ${summary.runId}`,
        `  cw feedback summary ${summary.runId}`,
        `  cw commit summary ${summary.runId}`,
        `  cw audit summary ${summary.runId}`,
        `  cw audit provenance ${summary.runId}`,
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
/** `cw graph <id>` human render. */
export function formatOperatorGraph(graph) {
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
/** `cw feedback summary <run>` human text: a `Feedback` rollup with
 *  status/severity/classification counts. */
export function formatFeedbackSummaryText(summary) {
    return [
        "Feedback",
        `  total=${summary.total}; status=${formatCounts(summary.byStatus)}`,
        `  severity=${formatCounts(summary.bySeverity)}`,
        `  classification=${formatCounts(summary.byClassification)}`,
    ].join("\n");
}
