"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatRegistryReport = formatRegistryReport;
exports.formatRunSearch = formatRunSearch;
exports.formatRunShow = formatRunShow;
exports.formatGcPlan = formatGcPlan;
exports.formatGcRun = formatGcRun;
exports.formatGcVerify = formatGcVerify;
exports.formatResume = formatResume;
exports.formatHistory = formatHistory;
exports.formatQueueList = formatQueueList;
function countsLine(counts) {
    return `total=${counts.total} queued=${counts.queued} running=${counts.running} blocked=${counts.blocked} completed=${counts.completed} failed=${counts.failed} archived=${counts.archived} reclaimed=${counts.reclaimed}`;
}
function recordLine(record) {
    const flags = [record.archived ? "archived" : "", record.provenance?.rerunOf ? `rerunOf=${record.provenance.rerunOf}` : ""].filter(Boolean).join(" ");
    return `  [${record.lifecycle}] ${record.runId} (${record.appId || record.workflowId}) ${record.loopStage}${flags ? ` {${flags}}` : ""}`;
}
function formatRegistryReport(report) {
    const lines = [];
    lines.push(`Run Registry (${report.scope}): ${report.root}`);
    lines.push(`Freshness: ${report.freshness.status}${report.freshness.staleRuns.length ? ` (stale: ${report.freshness.staleRuns.join(", ")})` : ""}${report.freshness.missingRuns.length ? ` (missing: ${report.freshness.missingRuns.join(", ")})` : ""}`);
    lines.push(`Repos: ${report.index.repos.length}`);
    lines.push(countsLine(report.counts));
    if (report.freshness.status !== "valid")
        lines.push(`Next Action: ${report.nextAction}`);
    return lines.join("\n");
}
function formatRunSearch(result) {
    const lines = [];
    lines.push(`Run Search (${result.scope}): ${result.total} match(es), showing ${result.records.length} [offset ${result.offset}] freshness=${result.freshness}`);
    for (const record of result.records)
        lines.push(recordLine(record));
    if (!result.records.length)
        lines.push("  (no matching runs)");
    return lines.join("\n");
}
function formatRunShow(result) {
    if (!result.found) {
        return `Run ${result.runId}: MISSING (source state.json absent — fail closed). Next: ${result.nextAction}`;
    }
    const r = result.record;
    const lines = [
        `Run ${r.runId} [${r.lifecycle}] (derived: ${r.derivedLifecycle})`,
        `  app=${r.appId || r.workflowId} loopStage=${r.loopStage} repo=${r.repo}`,
        `  tasks: total=${r.tasks.total} pending=${r.tasks.pending} running=${r.tasks.running} failed=${r.tasks.failed} completed=${r.tasks.completed}`,
        `  commits=${r.commitCount} (verifier-gated=${r.verifierGatedCommitCount}) openFeedback=${r.openFeedbackCount}`
    ];
    if (r.provenance?.rerunOf)
        lines.push(`  provenance: rerunOf=${r.provenance.rerunOf} gen=${r.provenance.generation} origin=${r.provenance.originRunId}`);
    if (r.tier && r.tier !== "live") {
        lines.push(`  tier=${r.tier} capability=${r.capability} reason=${r.capabilityReason}${r.reclaimedBytes ? ` bytesFreed=${r.reclaimedBytes}` : ""}${r.tombstoneHash ? ` tombstone=${r.tombstoneHash.slice(0, 19)}` : ""}`);
    }
    return lines.join("\n");
}
function formatGcPlan(result) {
    const lines = [
        `GC Plan (${result.scope}): ${result.eligibleCount}/${result.total} eligible, ${result.bytesToFree} byte(s) would be freed [DRY-RUN, frees nothing]`,
        `  policy: reclaimAfterArchiveDays=${result.policy.reclaimAfterArchiveDays} keepScratch=${result.policy.keepScratch} keepSnapshots=${result.policy.keepSnapshots}`
    ];
    for (const entry of result.entries) {
        if (entry.eligible) {
            const kinds = Object.entries(entry.byKind).map(([k, v]) => `${k}=${v}`).join(" ");
            lines.push(`  [eligible] ${entry.runId} -> ${entry.capability} (${entry.capabilityReason}) ${entry.bytesToFree}B {${kinds}}`);
        }
        else {
            lines.push(`  [skip:${entry.reason}] ${entry.runId} (tier=${entry.tier})`);
        }
    }
    if (!result.entries.length)
        lines.push("  (no runs in scope)");
    return lines.join("\n");
}
function formatGcRun(result) {
    const lines = [`GC Run (${result.scope}): reclaimed ${result.reclaimed.length} run(s), freed ${result.totalBytesFreed} byte(s)`];
    for (const r of result.reclaimed)
        lines.push(`  [reclaimed] ${r.runId} -> ${r.capability} (${r.capabilityReason}) ${r.bytesFreed}B tombstone=${r.tombstoneHash.slice(0, 19)}`);
    for (const r of result.refused)
        lines.push(`  [refused:${r.code}] ${r.runId}`);
    if (!result.reclaimed.length && !result.refused.length)
        lines.push("  (nothing eligible)");
    return lines.join("\n");
}
function formatGcVerify(result) {
    const lines = [
        `GC Verify ${result.runId}: reclaimed=${result.reclaimed} verified=${result.verified} tier=${result.tier} capability=${result.capability}${result.tombstoneHash ? ` tombstone=${result.tombstoneHash.slice(0, 19)}` : ""}`
    ];
    for (const check of result.checks)
        lines.push(`  ${check.pass ? "PASS" : "FAIL"} ${check.name}${check.code ? ` [${check.code}]` : ""}${check.detail ? ` (${check.detail})` : ""}`);
    return lines.join("\n");
}
function formatResume(result) {
    const lines = [
        `Resume ${result.runId} [${result.lifecycle}] loopStage=${result.loopStage} (resolved from ${result.resolvedFrom}, ${result.freshness})`,
        `  resumable=${result.resumable} nextTasks=${result.nextTasks.length}`
    ];
    for (const action of result.nextActions)
        lines.push(`  -> ${action.command}\n     ${action.reason}`);
    // Only when --drive/--once continued the run; the default read-only resume text is unchanged.
    if (result.drive) {
        const d = result.drive;
        lines.push(`  drive: ${d.status} (${d.completedWorkers}/${d.plannedWorkers} workers${d.commitId ? `, committed ${d.commitId}` : ""})`);
    }
    return lines.join("\n");
}
function formatHistory(result) {
    const lines = [];
    lines.push(`Run History (${result.scope}): ${result.total} run(s) across ${result.repos.length} repo(s), freshness=${result.freshness}`);
    for (const entry of result.entries) {
        lines.push(`  ${entry.createdAt} [${entry.lifecycle}] ${entry.runId} (${entry.appId || entry.workflowId})${entry.provenance?.rerunOf ? ` rerunOf=${entry.provenance.rerunOf}` : ""}`);
    }
    if (!result.entries.length)
        lines.push("  (no runs)");
    return lines.join("\n");
}
function formatQueueList(result) {
    const lines = [`Run Queue: ${result.total} entry(ies) [priority asc]`];
    for (const entry of result.entries) {
        lines.push(`  #${entry.priority} ${entry.id} [${entry.status}] ${entry.appId || entry.workflowId || entry.runId || "?"} repo=${entry.repo}${entry.note ? ` note=${entry.note}` : ""}`);
    }
    if (!result.entries.length)
        lines.push("  (queue empty)");
    return lines.join("\n");
}
