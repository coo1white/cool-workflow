// Human formatters for observability metrics (CLI default text; --json emits the
// canonical payload). Pure functions — a report/metric in, a string out — carved
// out of observability.ts (god-module carve, mirrors run-registry/format.ts) so
// the metrics module no longer bundles the rendering layer. Re-exported from
// observability.ts to keep the public surface byte-unchanged.
import { CostMetric, MetricsReport, MetricsSummaryReport, RateMetric } from "../types";

function formatRate(r: RateMetric): string {
  if (r.state === "n/a") return `n/a (0 samples)`;
  return `${(((r.rate as number) * 100)).toFixed(1)}% (${r.count}/${r.total})`;
}

function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(c: CostMetric): string {
  const parts: string[] = [`state=${c.state}`];
  if (c.attestedUsd !== null) parts.push(`attested=${c.currency} ${c.attestedUsd}`);
  if (c.estimatedUsd !== null) parts.push(`estimated=${c.currency} ${c.estimatedUsd}`);
  if (c.unpricedModels.length) parts.push(`unpriced-models=${c.unpricedModels.join(",")}`);
  return parts.join("  ");
}

export function formatMetricsReport(report: MetricsReport): string {
  const lines: string[] = [];
  lines.push(`metrics ${report.runId}  [${report.freshness.status}]  app=${report.scope.app || "-"}`);
  lines.push(
    `  time: run=${formatMs(report.time.run.wallClockMs)}${report.time.run.inFlight ? " (in-flight)" : ""}  active-task=${formatMs(report.time.activeTaskMs)}  in-flight-items=${report.time.inFlight}`
  );
  lines.push(`  failure-rate:    ${formatRate(report.rates.failure)}`);
  lines.push(`  verifier-pass:   ${formatRate(report.rates.verifierPass)}`);
  lines.push(`  cand-acceptance: ${formatRate(report.rates.candidateAcceptance)}`);
  const collab = report.collaboration;
  lines.push(
    `  collaboration:   approvals=${collab.approvals} rejections=${collab.rejections} comments=${collab.comments} handoffs=${collab.handoffs} reviewers=${collab.reviewers}  approval-rate=${formatRate(collab.approvalRate)}  time-to-approval=${collab.timeToApproval.meanMs === null ? "n/a" : `${Math.round(collab.timeToApproval.meanMs / 1000)}s`} (${collab.timeToApproval.samples} samples)`
  );
  const cov = report.usage.coverage === null ? "n/a" : `${(report.usage.coverage * 100).toFixed(0)}%`;
  lines.push(
    `  usage: attested=${report.usage.attestedUnits}/${report.usage.units} units (coverage ${cov}), unreported=${report.usage.unreportedUnits}; tokens in=${report.usage.inputTokens} out=${report.usage.outputTokens} total=${report.usage.totalTokens}`
  );
  lines.push(`  cost:  ${formatCost(report.cost)}`);
  if (report.usage.models.length) lines.push(`  models: ${report.usage.models.join(", ")}`);
  lines.push(`  next: ${report.nextAction}`);
  return lines.join("\n");
}

export function formatMetricsSummary(summary: MetricsSummaryReport): string {
  const lines: string[] = [];
  lines.push(
    `metrics summary  scope=${summary.scope}  runs=${summary.runCount}${summary.unreadableRuns ? ` (+${summary.unreadableRuns} unreadable)` : ""}`
  );
  lines.push(`  failure-rate:    ${formatRate(summary.rates.failure)}`);
  lines.push(`  verifier-pass:   ${formatRate(summary.rates.verifierPass)}`);
  lines.push(`  cand-acceptance: ${formatRate(summary.rates.candidateAcceptance)}`);
  const cov = summary.usage.coverage === null ? "n/a" : `${(summary.usage.coverage * 100).toFixed(0)}%`;
  lines.push(
    `  usage: attested=${summary.usage.attestedUnits}/${summary.usage.units} units (coverage ${cov}); tokens total=${summary.usage.totalTokens}`
  );
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
