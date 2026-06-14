// Human formatting for the run registry (CLI-only; never affects --json / MCP
// payloads). Pure functions — a result object in, a string out — carved out of
// run-registry.ts (FreeBSD-audit R2) so the registry class no longer bundles the
// rendering layer. Re-exported from run-registry.ts to keep the public surface.
import {
  GcPlanResult,
  GcRunResult,
  GcVerifyResult,
  RunHistoryResult,
  RunQueueEntry,
  RunRecord,
  RunRegistryCounts,
  RunRegistryReport,
  RunResumeResult,
  RunSearchResult,
  RunShowResult
} from "../types";

function countsLine(counts: RunRegistryCounts): string {
  return `total=${counts.total} queued=${counts.queued} running=${counts.running} blocked=${counts.blocked} completed=${counts.completed} failed=${counts.failed} archived=${counts.archived} reclaimed=${counts.reclaimed}`;
}

function recordLine(record: RunRecord): string {
  const flags = [record.archived ? "archived" : "", record.provenance?.rerunOf ? `rerunOf=${record.provenance.rerunOf}` : ""].filter(Boolean).join(" ");
  return `  [${record.lifecycle}] ${record.runId} (${record.appId || record.workflowId}) ${record.loopStage}${flags ? ` {${flags}}` : ""}`;
}

export function formatRegistryReport(report: RunRegistryReport): string {
  const lines: string[] = [];
  lines.push(`Run Registry (${report.scope}): ${report.root}`);
  lines.push(`Freshness: ${report.freshness.status}${report.freshness.staleRuns.length ? ` (stale: ${report.freshness.staleRuns.join(", ")})` : ""}${report.freshness.missingRuns.length ? ` (missing: ${report.freshness.missingRuns.join(", ")})` : ""}`);
  lines.push(`Repos: ${report.index.repos.length}`);
  lines.push(countsLine(report.counts));
  if (report.freshness.status !== "valid") lines.push(`Next Action: ${report.nextAction}`);
  return lines.join("\n");
}

export function formatRunSearch(result: RunSearchResult): string {
  const lines: string[] = [];
  lines.push(`Run Search (${result.scope}): ${result.total} match(es), showing ${result.records.length} [offset ${result.offset}] freshness=${result.freshness}`);
  for (const record of result.records) lines.push(recordLine(record));
  if (!result.records.length) lines.push("  (no matching runs)");
  return lines.join("\n");
}

export function formatRunShow(result: RunShowResult): string {
  if (!result.found) {
    return `Run ${result.runId}: MISSING (source state.json absent — fail closed). Next: ${result.nextAction}`;
  }
  const r = result.record!;
  const lines = [
    `Run ${r.runId} [${r.lifecycle}] (derived: ${r.derivedLifecycle})`,
    `  app=${r.appId || r.workflowId} loopStage=${r.loopStage} repo=${r.repo}`,
    `  tasks: total=${r.tasks.total} pending=${r.tasks.pending} running=${r.tasks.running} failed=${r.tasks.failed} completed=${r.tasks.completed}`,
    `  commits=${r.commitCount} (verifier-gated=${r.verifierGatedCommitCount}) openFeedback=${r.openFeedbackCount}`
  ];
  if (r.provenance?.rerunOf) lines.push(`  provenance: rerunOf=${r.provenance.rerunOf} gen=${r.provenance.generation} origin=${r.provenance.originRunId}`);
  if (r.tier && r.tier !== "live") {
    lines.push(`  tier=${r.tier} capability=${r.capability} reason=${r.capabilityReason}${r.reclaimedBytes ? ` bytesFreed=${r.reclaimedBytes}` : ""}${r.tombstoneHash ? ` tombstone=${r.tombstoneHash.slice(0, 19)}` : ""}`);
  }
  return lines.join("\n");
}

export function formatGcPlan(result: GcPlanResult): string {
  const lines = [
    `GC Plan (${result.scope}): ${result.eligibleCount}/${result.total} eligible, ${result.bytesToFree} byte(s) would be freed [DRY-RUN, frees nothing]`,
    `  policy: reclaimAfterArchiveDays=${result.policy.reclaimAfterArchiveDays} keepScratch=${result.policy.keepScratch} keepSnapshots=${result.policy.keepSnapshots}`
  ];
  for (const entry of result.entries) {
    if (entry.eligible) {
      const kinds = Object.entries(entry.byKind).map(([k, v]) => `${k}=${v}`).join(" ");
      lines.push(`  [eligible] ${entry.runId} -> ${entry.capability} (${entry.capabilityReason}) ${entry.bytesToFree}B {${kinds}}`);
    } else {
      lines.push(`  [skip:${entry.reason}] ${entry.runId} (tier=${entry.tier})`);
    }
  }
  if (!result.entries.length) lines.push("  (no runs in scope)");
  return lines.join("\n");
}

export function formatGcRun(result: GcRunResult): string {
  const lines = [`GC Run (${result.scope}): reclaimed ${result.reclaimed.length} run(s), freed ${result.totalBytesFreed} byte(s)`];
  for (const r of result.reclaimed) lines.push(`  [reclaimed] ${r.runId} -> ${r.capability} (${r.capabilityReason}) ${r.bytesFreed}B tombstone=${r.tombstoneHash.slice(0, 19)}`);
  for (const r of result.refused) lines.push(`  [refused:${r.code}] ${r.runId}`);
  if (!result.reclaimed.length && !result.refused.length) lines.push("  (nothing eligible)");
  return lines.join("\n");
}

export function formatGcVerify(result: GcVerifyResult): string {
  const lines = [
    `GC Verify ${result.runId}: reclaimed=${result.reclaimed} verified=${result.verified} tier=${result.tier} capability=${result.capability}${result.tombstoneHash ? ` tombstone=${result.tombstoneHash.slice(0, 19)}` : ""}`
  ];
  for (const check of result.checks) lines.push(`  ${check.pass ? "PASS" : "FAIL"} ${check.name}${check.code ? ` [${check.code}]` : ""}${check.detail ? ` (${check.detail})` : ""}`);
  return lines.join("\n");
}

export function formatResume(result: RunResumeResult): string {
  const lines = [
    `Resume ${result.runId} [${result.lifecycle}] loopStage=${result.loopStage} (resolved from ${result.resolvedFrom}, ${result.freshness})`,
    `  resumable=${result.resumable} nextTasks=${result.nextTasks.length}`
  ];
  for (const action of result.nextActions) lines.push(`  -> ${action.command}\n     ${action.reason}`);
  return lines.join("\n");
}

export function formatHistory(result: RunHistoryResult): string {
  const lines: string[] = [];
  lines.push(`Run History (${result.scope}): ${result.total} run(s) across ${result.repos.length} repo(s), freshness=${result.freshness}`);
  for (const entry of result.entries) {
    lines.push(`  ${entry.createdAt} [${entry.lifecycle}] ${entry.runId} (${entry.appId || entry.workflowId})${entry.provenance?.rerunOf ? ` rerunOf=${entry.provenance.rerunOf}` : ""}`);
  }
  if (!result.entries.length) lines.push("  (no runs)");
  return lines.join("\n");
}

export function formatQueueList(result: { total: number; entries: RunQueueEntry[] }): string {
  const lines = [`Run Queue: ${result.total} entry(ies) [priority asc]`];
  for (const entry of result.entries) {
    lines.push(`  #${entry.priority} ${entry.id} [${entry.status}] ${entry.appId || entry.workflowId || entry.runId || "?"} repo=${entry.repo}${entry.note ? ` note=${entry.note}` : ""}`);
  }
  if (!result.entries.length) lines.push("  (queue empty)");
  return lines.join("\n");
}
