"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatMetricsReport = formatMetricsReport;
exports.formatMetricsSummary = formatMetricsSummary;
function formatRate(r) {
    if (r.state === "n/a")
        return `n/a (0 samples)`;
    return `${((r.rate * 100)).toFixed(1)}% (${r.count}/${r.total})`;
}
function formatMs(ms) {
    if (ms === null)
        return "—";
    if (ms < 1000)
        return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
function formatCost(c) {
    const parts = [`state=${c.state}`];
    if (c.attestedUsd !== null)
        parts.push(`attested=${c.currency} ${c.attestedUsd}`);
    if (c.estimatedUsd !== null)
        parts.push(`estimated=${c.currency} ${c.estimatedUsd}`);
    if (c.unpricedModels.length)
        parts.push(`unpriced-models=${c.unpricedModels.join(",")}`);
    return parts.join("  ");
}
function formatMetricsReport(report) {
    const lines = [];
    lines.push(`metrics ${report.runId}  [${report.freshness.status}]  app=${report.scope.app || "-"}`);
    lines.push(`  time: run=${formatMs(report.time.run.wallClockMs)}${report.time.run.inFlight ? " (in-flight)" : ""}  active-task=${formatMs(report.time.activeTaskMs)}  in-flight-items=${report.time.inFlight}`);
    lines.push(`  failure-rate:    ${formatRate(report.rates.failure)}`);
    lines.push(`  verifier-pass:   ${formatRate(report.rates.verifierPass)}`);
    lines.push(`  cand-acceptance: ${formatRate(report.rates.candidateAcceptance)}`);
    const collab = report.collaboration;
    lines.push(`  collaboration:   approvals=${collab.approvals} rejections=${collab.rejections} comments=${collab.comments} handoffs=${collab.handoffs} reviewers=${collab.reviewers}  approval-rate=${formatRate(collab.approvalRate)}  time-to-approval=${collab.timeToApproval.meanMs === null ? "n/a" : `${Math.round(collab.timeToApproval.meanMs / 1000)}s`} (${collab.timeToApproval.samples} samples)`);
    const cov = report.usage.coverage === null ? "n/a" : `${(report.usage.coverage * 100).toFixed(0)}%`;
    lines.push(`  usage: attested=${report.usage.attestedUnits}/${report.usage.units} units (coverage ${cov}), unreported=${report.usage.unreportedUnits}; tokens in=${report.usage.inputTokens} out=${report.usage.outputTokens} total=${report.usage.totalTokens}`);
    lines.push(`  cost:  ${formatCost(report.cost)}`);
    if (report.usage.models.length)
        lines.push(`  models: ${report.usage.models.join(", ")}`);
    lines.push(`  next: ${report.nextAction}`);
    return lines.join("\n");
}
function formatMetricsSummary(summary) {
    const lines = [];
    lines.push(`metrics summary  scope=${summary.scope}  runs=${summary.runCount}${summary.unreadableRuns ? ` (+${summary.unreadableRuns} unreadable)` : ""}`);
    lines.push(`  failure-rate:    ${formatRate(summary.rates.failure)}`);
    lines.push(`  verifier-pass:   ${formatRate(summary.rates.verifierPass)}`);
    lines.push(`  cand-acceptance: ${formatRate(summary.rates.candidateAcceptance)}`);
    const cov = summary.usage.coverage === null ? "n/a" : `${(summary.usage.coverage * 100).toFixed(0)}%`;
    lines.push(`  usage: attested=${summary.usage.attestedUnits}/${summary.usage.units} units (coverage ${cov}); tokens total=${summary.usage.totalTokens}`);
    lines.push(`  cost:  ${formatCost(summary.cost)}`);
    for (const app of summary.byApp) {
        lines.push(`  app ${app.key}: runs=${app.runCount} verifier=${formatRate(app.rates.verifierPass)} cost=${formatCost(app.cost)}`);
    }
    for (const backend of summary.byBackend) {
        lines.push(`  backend ${backend.key}: runs=${backend.runCount} failure=${formatRate(backend.rates.failure)}`);
    }
    lines.push(`  next: ${summary.nextAction}`);
    return lines.join("\n");
}
