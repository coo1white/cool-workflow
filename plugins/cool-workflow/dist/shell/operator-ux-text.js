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
exports.formatOperatorStatus = formatOperatorStatus;
exports.formatOperatorReport = formatOperatorReport;
exports.formatOperatorGraph = formatOperatorGraph;
const term_1 = require("./term");
function formatCounts(counts) {
    const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
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
    return ["Candidates", `  Total: ${summary.total}`, `  By status: ${formatCounts(summary.byStatus)}`, `  By kind: ${formatCounts(summary.byKind)}`, `  Selections: ${summary.selections}`].join("\n");
}
function formatFeedbackPanel(summary) {
    return ["Feedback", `  Total: ${summary.total}`, `  By status: ${formatCounts(summary.byStatus)}`, `  By severity: ${formatCounts(summary.bySeverity)}`].join("\n");
}
function formatCommitPanel(summary) {
    const lines = ["Commits", `  Total: ${summary.total}`, `  Verifier-gated: ${summary.verifierGated}`, `  Checkpoints: ${summary.checkpoints}`];
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
/** The full `cw status <id>` human render — byte-exact port of
 *  formatOperatorStatus's panel order (worker/candidate/feedback/commit/
 *  trust, then the report path). This milestone's port omits the old
 *  build's topology/multi-agent-operator/blackboard sub-panels (no
 *  dedicated conformance case pins their exact text yet); the panels the
 *  case set DOES pin (Workers/Candidates/Feedback/Commits/Trust Audit,
 *  Report: <path>) are byte-exact. */
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
        `  node scripts/cw.js audit judge ${summary.runId}`,
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
