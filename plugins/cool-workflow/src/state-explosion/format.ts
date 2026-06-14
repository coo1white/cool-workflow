// Human formatting + markdown rendering for the state-explosion derived indexes
// (CLI / report.md only; never affects --json / MCP payloads). Pure functions —
// a record object in, strings out — carved out of state-explosion.ts
// (FreeBSD-audit god-module carve) so the report/graph/digest builders no longer
// bundle the rendering layer. Re-exported from state-explosion.ts to keep the
// public surface byte-identical. Types are type-only imports (erased at compile
// time) so there is no runtime cycle with the parent module.
import type {
  BlackboardDigestEntry,
  BlackboardSummaryRecord,
  GraphSummaryRecord,
  StateExplosionReport
} from "../state-explosion";

export function formatStateExplosionReport(report: StateExplosionReport): string {
  const lines: string[] = [];
  const size = report.stateSize;
  lines.push(`State Explosion Report: ${report.runId}`);
  lines.push(`Freshness: ${report.freshness.status}${report.freshness.staleScopes.length ? ` (stale: ${report.freshness.staleScopes.join(", ")})` : ""}`);
  lines.push("");
  lines.push("State Size");
  lines.push(`  records=${size.total}; graph nodes=${size.graphNodes}; graph edges=${size.graphEdges}; messages=${size.messages}; compaction=${size.compactionRecommended ? "recommended" : "not needed"}`);
  for (const reason of size.reasons) lines.push(`  - ${reason}`);
  lines.push("");
  lines.push("Compact Graph");
  lines.push(`  full=${report.compactGraph.fullNodeCount} nodes/${report.compactGraph.fullEdgeCount} edges -> compact=${report.compactGraph.compactNodeCount} nodes/${report.compactGraph.compactEdgeCount} edges`);
  if (report.compactGraph.collapsedNodeCount > 0) {
    lines.push(`  Graph compacted: ${report.compactGraph.collapsedNodeCount} nodes collapsed into ${report.compactGraph.syntheticNodes.length} summary nodes`);
  }
  for (const syn of report.compactGraph.syntheticNodes) {
    lines.push(`  [${syn.dominantStatus}] ${syn.id} collapses ${syn.collapsedNodeCount} nodes/${syn.collapsedEdgeCount} edges${syn.blockedReason ? ` blocked=${syn.blockedReason}` : ""}; expand: ${syn.expansionCommand}`);
  }
  lines.push("");
  lines.push("Blackboard Digest");
  lines.push(`  topics=${report.blackboardDigest.topicRollups.length}; threads=${report.blackboardDigest.threadSummaries.length}; unresolved=${report.blackboardDigest.unresolvedQuestions.length}; conflicts=${report.blackboardDigest.conflicts.length}; decisions=${report.blackboardDigest.decisions.length}; artifacts=${report.blackboardDigest.artifacts.length}`);
  for (const topic of report.blackboardDigest.topicRollups.slice(0, 20)) lines.push(`  - ${topic.label}; expand: ${topic.expansionCommand}`);
  lines.push("");
  lines.push("Critical Path");
  if (!report.criticalPathGraph.criticalPath.length) lines.push("  none");
  for (const id of report.criticalPathGraph.criticalPath.slice(0, 40)) lines.push(`  -> ${id}`);
  lines.push("");
  lines.push("Failures / Blockers");
  if (!report.operatorDigest.failures.length) lines.push("  none");
  for (const failure of report.operatorDigest.failures.slice(0, 30)) lines.push(`  [${failure.status}] ${failure.kind} ${failure.id}: ${failure.reason}; next=${failure.nextCommand}`);
  lines.push("");
  lines.push("Evidence Digest");
  lines.push(`  adopted=${report.operatorDigest.evidenceDigest.adopted}; missing=${report.operatorDigest.evidenceDigest.missing}; rejected=${report.operatorDigest.evidenceDigest.rejected}`);
  lines.push("");
  lines.push("Trust / Policy Digest");
  lines.push(`  events=${report.operatorDigest.trustDigest.events}; policyViolations=${report.operatorDigest.trustDigest.policyViolations}; judgeRationales=${report.operatorDigest.trustDigest.judgeRationales}`);
  for (const violation of report.blackboardDigest.policyViolations.slice(0, 20)) lines.push(`  [policy] ${violation.label}; expand: ${violation.expansionCommand}`);
  lines.push("");
  lines.push("Hidden Source Records");
  if (!report.hiddenSourceRecords.length) lines.push("  none (all records shown)");
  for (const hidden of report.hiddenSourceRecords) lines.push(`  ${hidden.kind}: ${hidden.count} records hidden; expand: ${hidden.expansionCommand}`);
  lines.push("");
  lines.push("Expansion Commands");
  for (const command of report.expansionCommands) lines.push(`  ${command}`);
  lines.push("");
  lines.push("Next Action");
  lines.push(`  ${report.nextAction}`);
  return lines.join("\n");
}

export function formatCompactGraph(graph: GraphSummaryRecord): string {
  const lines: string[] = [];
  lines.push(`Compact Graph (${graph.view}): ${graph.runId}`);
  lines.push(`  full=${graph.fullNodeCount} nodes/${graph.fullEdgeCount} edges -> view=${graph.compactNodeCount} nodes/${graph.compactEdgeCount} edges`);
  if (graph.collapsedNodeCount > 0) {
    lines.push(`  Graph compacted: ${graph.collapsedNodeCount} nodes collapsed into ${graph.syntheticNodes.length} summary nodes`);
  }
  lines.push("");
  lines.push("Critical Path");
  if (!graph.criticalPath.length) lines.push("  none");
  for (const id of graph.criticalPath.slice(0, 40)) lines.push(`  -> ${id}`);
  lines.push("");
  lines.push("Summary Nodes");
  if (!graph.syntheticNodes.length) lines.push("  none");
  for (const syn of graph.syntheticNodes) {
    lines.push(`  [${syn.dominantStatus}] ${syn.id}: ${syn.collapsedNodeCount} nodes / ${syn.collapsedEdgeCount} edges${syn.blockedReason ? ` blocked=${syn.blockedReason}` : ""}`);
    lines.push(`    expand: ${syn.expansionCommand}`);
  }
  lines.push("");
  lines.push("Blockers");
  if (!graph.blockedReasons.length) lines.push("  none");
  for (const reason of graph.blockedReasons.slice(0, 20)) lines.push(`  ${reason}`);
  lines.push("");
  lines.push("Nodes");
  for (const node of graph.nodes.slice(0, 80)) {
    lines.push(`  [${node.status}] ${node.kind} ${node.id}${node.synthetic ? ` (summary of ${node.synthetic.collapsedNodeCount})` : ""}`);
  }
  if (graph.nodes.length > 80) lines.push(`  ... ${graph.nodes.length - 80} more`);
  lines.push("");
  lines.push("Next Action");
  lines.push(`  ${graph.nextAction}`);
  return lines.join("\n");
}

export function formatBlackboardDigest(record: BlackboardSummaryRecord): string {
  const lines: string[] = [];
  lines.push(`Blackboard Digest: ${record.runId}${record.blackboardId ? ` (${record.blackboardId})` : ""}`);
  lines.push(`  freshness=${record.status}; included=${record.includedCount}; omitted=${record.omittedCount}`);
  const section = (title: string, entries: BlackboardDigestEntry[]) => {
    lines.push("");
    lines.push(title);
    if (!entries.length) {
      lines.push("  none");
      return;
    }
    for (const entry of entries.slice(0, 25)) lines.push(`  [${entry.status}] ${entry.label}; expand: ${entry.expansionCommand}`);
    if (entries.length > 25) lines.push(`  ... ${entries.length - 25} more`);
  };
  section("Topic Rollups", record.topicRollups);
  section("Thread Summaries", record.threadSummaries);
  section("Unresolved Questions", record.unresolvedQuestions);
  section("Conflicts", record.conflicts);
  section("Decisions", record.decisions);
  section("Artifacts", record.artifacts);
  section("Adopted Evidence", record.adoptedEvidence);
  section("Missing Evidence", record.missingEvidence);
  section("Policy Violations", record.policyViolations);
  section("Judge Rationale", record.judgeRationale);
  section("Recent Changes", record.recentChanges);
  section("High-Signal Records", record.highSignal);
  lines.push("");
  lines.push("Next Action");
  lines.push(`  ${record.nextAction}`);
  return lines.join("\n");
}

export function stateExplosionReportLines(report: StateExplosionReport): string[] {
  // Markdown lines for inclusion in the run report.md State Size section.
  const size = report.stateSize;
  const lines = [
    `- Records: ${size.total}; graph nodes: ${size.graphNodes}; graph edges: ${size.graphEdges}; messages: ${size.messages}`,
    `- Compaction: ${size.compactionRecommended ? "recommended" : "not needed"}`,
    `- Summary freshness: ${report.freshness.status}`
  ];
  for (const reason of size.reasons) lines.push(`  - ${reason}`);
  if (report.compactGraph.collapsedNodeCount > 0) {
    lines.push(`- Graph compacted: ${report.compactGraph.collapsedNodeCount} nodes collapsed into ${report.compactGraph.syntheticNodes.length} summary nodes`);
    lines.push(`  - Use: \`node scripts/cw.js multi-agent graph ${report.runId} --view full --json\``);
  }
  if (report.hiddenSourceRecords.length) {
    for (const hidden of report.hiddenSourceRecords) {
      lines.push(`- Hidden ${hidden.kind}: ${hidden.count} records; expand: \`${hidden.expansionCommand}\``);
    }
  }
  lines.push(`- Next: \`${report.nextAction}\``);
  return lines;
}
