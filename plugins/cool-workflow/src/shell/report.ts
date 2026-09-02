// shell/report.ts — report.md generation (the byte-exact section
// headers/fallback lines from the spec), the actual file write.
//
// MILESTONE 6+7 (combined), EXTENDED at MILESTONE 11 (reporting/
// observability) with the four sections that were deferred while their
// own subsystems' milestones (8/9/4) had not yet landed: State Size &
// Compaction (state-explosion, milestone 4), Sandbox Profiles (milestone
// 5), Trust Audit (milestone 8), Acceptance Rationale (commit-gate,
// milestone 6+7). Byte-exact port of
// the old build's orchestrator report module's renderX helpers for
// each.
//
// Evidence: SPEC/reporting-ux.md "report.md (written by writeReport)".

import * as fs from "node:fs";
import { WorkflowRun } from "../core/state/types";
import { updatePhaseStatuses } from "../core/pipeline/dispatch";
import { WorkerScope } from "./worker-isolation";
import { sandboxGuaranteeLabels } from "./execution-backend/registry";
import { buildStateExplosionReport, loadStateExplosionSummaryIndex } from "./state-explosion-cli";
import { stateExplosionReportLines } from "../core/format/state-explosion-text";
import { summarizeCandidates } from "./candidate-scoring-io";
import { summarizeTrustAudit, listTrustAuditEvents } from "./trust-audit";
import { verifyTelemetryLedger } from "./telemetry-ledger-io";
import { summarizeMultiAgent } from "./multi-agent-io";
import { summarizeBlackboard } from "./coordinator-io";
import { operatorDigestInput } from "./multi-agent-operator-ux";
import { stableCompare } from "../core/util/collate";

interface SandboxProfileLike {
  id: string;
  readPaths: string[];
  writePaths: string[];
  execute: { mode: string };
  network: { mode: string };
  enforcement: { enforcedByCW: string[]; hostRequired: string[] };
}

function formatInputList(value: unknown): string {
  if (Array.isArray(value)) return value.join("; ");
  return value ? String(value) : "";
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([a], [b]) => stableCompare(a, b));
  if (!entries.length) return "none";
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

function countBy<T>(values: T[], key: (v: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const bucket = key(value);
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  return counts;
}

function renderCommits(run: WorkflowRun): string[] {
  if (!run.commits.length) return ["No state commits yet."];
  return run.commits.map((commit) => {
    const kind = commit.verifierGated ? "verifier-gated commit" : "checkpoint";
    const gate = commit.verifierGated ? `verifier=${commit.verifierNodeId || "unknown"}, evidence=${commit.evidence?.length || 0}` : "verifierGated=false";
    return `- ${commit.id}: ${commit.reason} [${commit.loopStage}; ${kind}; ${gate}] (${commit.snapshotPath})`;
  });
}

/** `## State Size & Compaction` — milestone 4's state-explosion report,
 *  rendered with its own dedicated text formatter (always non-empty; no
 *  "no records" fallback in the old build either). */
function renderStateSize(run: WorkflowRun): string[] {
  const index = loadStateExplosionSummaryIndex(run);
  const report = buildStateExplosionReport(run, { index, operator: operatorDigestInput(run) });
  return stateExplosionReportLines(report);
}

/** `## Sandbox Profiles` — byte-exact port of the old build's
 *  renderSandboxProfiles. */
function renderSandboxProfiles(run: WorkflowRun): string[] {
  const profiles = (run.sandboxProfiles as SandboxProfileLike[] | undefined) || [];
  if (!profiles.length) return ["No sandbox profiles selected yet."];
  return profiles.map((profile) =>
    [
      `- ${profile.id}: read=${profile.readPaths.length}, write=${profile.writePaths.length}, execute=${profile.execute.mode}, network=${profile.network.mode}`,
      `  enforcedByCW=${profile.enforcement.enforcedByCW.join("; ")}`,
      `  hostRequired=${profile.enforcement.hostRequired.join("; ")}`,
    ].join("\n")
  );
}

/** `## Trust Audit` — byte-exact port of the old build's renderTrustAudit
 *  + renderTelemetryAttestation. */
function renderTrustAudit(run: WorkflowRun): string[] {
  const summary = summarizeTrustAudit(run);
  const integrity = summary.integrity;
  // Model-identity tally over the run's workers — only when workers exist,
  // so an empty run's report stays byte-identical.
  const workers = (run.workers as unknown as WorkerScope[]) || [];
  const selfReported = workers.filter((w) => workerModelProvenance(w) === "agent-self-reported").length;
  const modelLines = workers.length
    ? [`- Model provenance: ${selfReported} agent-self-reported · ${workers.length - selfReported} absent (agent-self-reported, never CW-verified)`]
    : [];
  // Only when a workflow app actually ran — an empty/app-less run's report
  // stays byte-identical (matches the modelLines/links gating pattern).
  const appCodeLines = run.appCode
    ? [`- App code execution: ${run.appCode.execution} (trustedRoot=${run.appCode.trustedRoot}, ${run.appCode.path})`]
    : [];
  return [
    `- Events: ${summary.eventCount}`,
    `- Chain integrity: ${integrity ? (integrity.verified ? "verified" : "FAILED") : "n/a"}` +
      `${integrity ? ` (${integrity.chained} chained, ${integrity.unchained} legacy${integrity.corruptLines ? `, ${integrity.corruptLines} corrupt` : ""})` : ""}`,
    ...(integrity && !integrity.verified
      ? [`  !! TRUST-AUDIT CHAIN TAMPER DETECTED: ${integrity.checks.filter((c) => !c.pass).map((c) => c.code).join(", ")}`]
      : []),
    `- Decisions: ${formatCounts(summary.byDecision)}`,
    `- Sources: ${formatCounts(summary.bySource)}`,
    `- Sandbox profiles: ${formatCounts(summary.bySandboxProfile)}`,
    `- Event log: ${summary.eventLogPath}`,
    `- Summary: ${summary.summaryPath}`,
    `- Index: ${summary.indexPath}`,
    ...modelLines,
    ...appCodeLines,
    ...renderTelemetryAttestation(run),
  ];
}

/** Telemetry attestation coverage + a LOUD list of any `unattested`
 *  usage, byte-exact port of the old build's renderTelemetryAttestation. */
function renderTelemetryAttestation(run: WorkflowRun): string[] {
  const delegations = listTrustAuditEvents(run).filter(
    (event) => event.kind === "worker.agent-delegation" && event.metadata && event.metadata.telemetryAttestation
  );
  if (!delegations.length) return [];
  const statusOf = (event: (typeof delegations)[number]) => String((event.metadata as Record<string, unknown>).telemetryAttestation);
  const attested = delegations.filter((event) => statusOf(event) === "attested").length;
  const unattested = delegations.filter((event) => statusOf(event) === "unattested");
  const absent = delegations.filter((event) => statusOf(event) === "absent").length;
  const lines = [
    `- Telemetry attestation: ${attested}/${delegations.length} attested` +
      (unattested.length ? `, ${unattested.length} UNATTESTED` : "") +
      (absent ? `, ${absent} absent` : ""),
  ];
  for (const event of unattested) {
    const reason = (event.metadata as Record<string, unknown>).telemetryAttestationReason;
    lines.push(`  - ⚠️  UNATTESTED usage — worker=${event.workerId || "?"} task=${event.taskId || "?"}: ${reason || "signature unverified"}`);
  }
  const ledger = verifyTelemetryLedger(run);
  if (ledger.present) {
    lines.push(
      ledger.verified
        ? `- Attestation ledger: ${ledger.records.length} records, chain verified (tamper-evident)`
        : `  - ⚠️  ATTESTATION LEDGER CHAIN BROKEN — a recorded verdict/usage was edited after the fact (${ledger.checks.filter((c) => !c.pass).map((c) => c.name).join(", ")})`
    );
  }
  return lines;
}

/** `## Acceptance Rationale` — byte-exact port of the old build's
 *  renderAcceptanceRationale. */
function renderAcceptanceRationale(run: WorkflowRun): string[] {
  const lines: string[] = [];
  for (const selectionRaw of run.candidateSelections || []) {
    const selection = selectionRaw as { id: string; candidateId?: string; acceptanceRationale?: Record<string, unknown> };
    const rationale = selection.acceptanceRationale;
    if (!rationale) continue;
    lines.push(
      `- Selection ${selection.id}: candidate=${rationale.selectedCandidateId || selection.candidateId}, score=${rationale.scoreId || "none"}, verifier=${rationale.verifierNodeId || "none"}, evidence=${rationale.evidenceCount}, sandbox=${rationale.sandboxProfileId || "none"}, worker=${rationale.workerId || "none"}`
    );
  }
  for (const commit of run.commits || []) {
    if (!commit.acceptanceRationale) continue;
    const rationale = commit.acceptanceRationale;
    lines.push(
      `- Commit ${commit.id}: gate=${rationale.commitGateResult || "unknown"}, candidate=${rationale.selectedCandidateId || commit.candidateId || "none"}, score=${rationale.scoreId || "none"}, verifier=${rationale.verifierNodeId || commit.verifierNodeId || "none"}, evidence=${rationale.evidenceCount}, sandbox=${rationale.sandboxProfileId || "none"}, worker=${rationale.workerId || "none"}`
    );
  }
  return lines.length ? lines : ["No accepted candidate or verifier-gated commit rationale yet."];
}

/** `## Multi-Agent Runtime` — byte-exact port of the old build's
 *  renderMultiAgent. */
function renderMultiAgent(run: WorkflowRun): string[] {
  const summary = summarizeMultiAgent(run);
  if (!summary.totalRuns) return ["No multi-agent runtime records yet."];
  const lines = [
    `- Runs: ${summary.totalRuns} (${formatCounts(summary.runsByStatus)})`,
    `- Roles: ${summary.roles}`,
    `- Groups: ${summary.groups} (${formatCounts(summary.groupsByStatus)})`,
    `- Memberships: ${summary.memberships} (${formatCounts(summary.membershipsByStatus)})`,
    `- Fanouts: ${summary.fanouts}`,
    `- Fanins: ${summary.fanins} (${formatCounts(summary.faninsByStatus)})`,
  ];
  if (summary.blockedReasons.length) {
    lines.push("", "Blocked:");
    for (const reason of summary.blockedReasons.slice(0, 8)) lines.push(`- ${reason}`);
  }
  for (const group of summary.groupsDetail.slice(0, 8)) {
    lines.push("", `Group ${group.id}: status=${group.status}, phase=${group.phase || "none"}, run=${group.multiAgentRunId}`);
    for (const role of group.roles) {
      lines.push(`- role=${role.roleId}, memberships=${role.memberships}, reported=${role.reported}, missing=${role.missing}, requiredEvidence=${role.requiredEvidence}`);
    }
    lines.push(`- fanouts=${group.fanouts.join(", ") || "none"}`);
    lines.push(`- fanins=${group.fanins.join(", ") || "none"}`);
  }
  if (summary.nextAction) lines.push("", `Next multi-agent action: ${summary.nextAction}`);
  return lines;
}

/** `## Blackboard / Coordinator` — byte-exact port of the old build's
 *  renderBlackboard. */
function renderBlackboard(run: WorkflowRun): string[] {
  const summary = summarizeBlackboard(run);
  if (!summary.blackboardId) return ["No blackboard records yet."];
  const lines = [
    `- Blackboard: ${summary.blackboardId}`,
    `- Topics: ${summary.topics}`,
    `- Messages: ${summary.messages}`,
    `- Contexts: ${summary.contexts}`,
    `- Artifacts: ${summary.artifacts}`,
    `- Snapshots: ${summary.snapshots}`,
    `- Decisions: ${summary.decisions}`,
    `- Ready for fanin: ${summary.readyForFanin ? "yes" : "no"}`,
    `- Index: ${summary.indexPath || "none"}`,
    `- Latest snapshot: ${summary.latestSnapshotPath || "none"}`,
  ];
  if (summary.openQuestions.length) {
    lines.push("", "Open questions:");
    for (const question of summary.openQuestions.slice(0, 8)) lines.push(`- ${question.id}: ${question.key}=${question.value}`);
  }
  if (summary.conflicts.length) {
    lines.push("", "Conflicts:");
    for (const conflict of summary.conflicts.slice(0, 8)) {
      lines.push(`- ${conflict.id}: ${conflict.key} conflicts with ${conflict.conflictingContextIds.join(", ") || "unknown"}`);
    }
  }
  if (summary.missingEvidence.length) {
    lines.push("", "Missing evidence:");
    for (const item of summary.missingEvidence.slice(0, 8)) lines.push(`- ${item}`);
  }
  if (summary.nextAction) lines.push("", `Next coordinator action: ${summary.nextAction}`);
  return lines;
}

/** `## Candidates` — byte-exact port of the old build's renderCandidates. */
function renderCandidatesSection(run: WorkflowRun): string[] {
  const summary = summarizeCandidates(run);
  if (!summary.total) return ["No candidates yet."];
  return [
    `- Total: ${summary.total}`,
    `- By status: ${formatCounts(summary.byStatus)}`,
    `- By kind: ${formatCounts(summary.byKind)}`,
    `- Selections: ${summary.selections}`,
    `- Index: ${summary.indexPath}`,
    `- Ranking: ${summary.rankingPath}`,
  ];
}

function renderFeedback(run: WorkflowRun): string[] {
  const records = (run.feedback || []) as Array<{ status: string; severity: string; classification: string }>;
  if (!records.length) return ["No feedback records."];
  return [
    `- Total: ${records.length}`,
    `- By status: ${formatCounts(countBy(records, (r) => r.status))}`,
    `- By severity: ${formatCounts(countBy(records, (r) => r.severity))}`,
    `- By classification: ${formatCounts(countBy(records, (r) => r.classification))}`,
  ];
}

/** The worker's model-identity label. Comes only from the usage record the
 *  agent self-reported into — an old record or no record at all reads as
 *  "absent" (fail closed, never made up). */
function workerModelProvenance(worker: WorkerScope): string {
  const usage = worker.usage as Record<string, unknown> | undefined;
  return usage && usage.modelProvenance === "agent-self-reported" ? "agent-self-reported" : "absent";
}

function renderWorkers(run: WorkflowRun): string[] {
  const workers = (run.workers as unknown as WorkerScope[]) || [];
  if (!workers.length) return ["No worker scopes yet."];
  const lines = [`- Total: ${workers.length}`, `- By status: ${formatCounts(countBy(workers, (w) => w.status))}`];
  // Per-worker guarantee labels — rendered only for a worker that carries
  // an attestation or a usage record, so a run with neither keeps a
  // byte-identical report. Labels come ONLY from sandboxGuaranteeLabels.
  for (const w of workers) {
    if (!w.backendAttestation && !w.usage) continue;
    const g = sandboxGuaranteeLabels(w.backendAttestation);
    lines.push(
      `- ${w.id}: backend=${w.backendId || "none"} guarantees write=${g.write} read=${g.read} command=${g.command} network=${g.network} env=${g.env} model=${workerModelProvenance(w)}`
    );
  }
  const failed = workers.filter((w) => w.status === "failed" || w.status === "rejected");
  if (failed.length) {
    lines.push("", "Failed or rejected:");
    for (const w of failed) lines.push(`- ${w.id} (${w.status}) feedback=${w.feedbackIds.join(",") || "none"}`);
  }
  return lines;
}

function renderPendingTasks(run: WorkflowRun): string[] {
  const pending = run.tasks.filter((t) => t.status === "pending" || t.status === "running");
  if (!pending.length) return ["No pending tasks."];
  return pending.map((t) => `- ${t.id} (${t.phase}, ${t.status}): ${t.taskPath}`);
}

/** "run <-> PR linkage": one line per link annotation. Called only
 *  when `run.links` is non-empty (see writeReport below) — a run with no
 *  links never gains a "## Links" header, so an empty run's report.md
 *  stays byte-identical to before this field existed. */
function renderLinks(run: WorkflowRun): string[] {
  const links = run.links || [];
  return links.map((link) => `- [${link.kind}] ${link.url}${link.note ? ` — ${link.note}` : ""} (added ${link.addedAt} by ${link.actor})`);
}

function renderResults(run: WorkflowRun): string[] {
  const completed = run.tasks.filter((t) => t.status === "completed");
  if (!completed.length) return ["No completed results yet."];
  const lines: string[] = [];
  for (const task of completed) {
    lines.push(`### ${task.id}`, "", `Result: ${task.resultPath}`, "");
    if (task.resultPath && fs.existsSync(task.resultPath)) {
      lines.push(fs.readFileSync(task.resultPath, "utf8").trim(), "");
    } else {
      lines.push("_Result file is not present on this host; state metadata remains inspectable._", "");
    }
  }
  return lines;
}

/** writeReport — renders report.md and writes it. Returns the path. */
export function writeReport(run: WorkflowRun): string {
  updatePhaseStatuses(run);
  const workflowApp = run.workflow.app as
    | { id?: string; version?: string; source?: { manifestPath?: string; entrypointPath?: string; path?: string }; metadata?: { domain?: string } }
    | undefined;
  // A research run reads a local folder of files, not a code repo — label
  // its source line "Source". Skip the relabel when the run ALSO carries a
  // remote-provenance "- Source: <url>" line below (run.inputs.sourceUrl
  // set by a --link/URL), so a report never shows two "- Source:" lines.
  // Every other app keeps the byte-identical "Repository:" (POLA).
  const sourceLabel = workflowApp?.metadata?.domain === "research" && !run.inputs.sourceUrl ? "Source" : "Repository";
  const report = [
    `# ${run.workflow.title}`,
    "",
    `- Run: ${run.id}`,
    `- Workflow: ${run.workflow.id}`,
    ...(workflowApp
      ? [`- Workflow App: ${workflowApp.id}@${workflowApp.version}`, `- Workflow App Source: ${workflowApp.source?.manifestPath || workflowApp.source?.entrypointPath || workflowApp.source?.path || ""}`]
      : []),
    `- Created: ${run.createdAt}`,
    `- Updated: ${run.updatedAt}`,
    `- ${sourceLabel}: ${String(run.inputs.repo || run.cwd)}`,
    ...(run.inputs.sourceUrl
      ? [`- Source: ${String(run.inputs.sourceUrl)}${run.inputs.sourceCommit ? `@${String(run.inputs.sourceCommit)}` : ""}`]
      : []),
    `- Question: ${String(run.inputs.question || "")}`,
    `- Invariants: ${formatInputList(run.inputs.invariant)}`,
    `- Loop Stage: ${run.loopStage}`,
    "",
    "## Phase Status",
    "",
    "| Phase | Status | Completed | Total |",
    "| --- | --- | ---: | ---: |",
    ...run.phases.map((phase) => {
      const taskIds = new Set(phase.taskIds);
      const phaseTasks = run.tasks.filter((t) => taskIds.has(t.id));
      const completed = phaseTasks.filter((t) => t.status === "completed").length;
      return `| ${phase.name} | ${phase.status} | ${completed} | ${phaseTasks.length} |`;
    }),
    "",
    "## State Commits",
    "",
    ...renderCommits(run),
    "",
    "## Error Feedback",
    "",
    ...renderFeedback(run),
    "",
    "## Workers",
    "",
    ...renderWorkers(run),
    "",
    "## State Size & Compaction",
    "",
    ...renderStateSize(run),
    "",
    "## Multi-Agent Runtime",
    "",
    ...renderMultiAgent(run),
    "",
    "## Blackboard / Coordinator",
    "",
    ...renderBlackboard(run),
    "",
    "## Sandbox Profiles",
    "",
    ...renderSandboxProfiles(run),
    "",
    "## Trust Audit",
    "",
    ...renderTrustAudit(run),
    "",
    "## Acceptance Rationale",
    "",
    ...renderAcceptanceRationale(run),
    "",
    "## Candidates",
    "",
    ...renderCandidatesSection(run),
    "",
    "## Pending Tasks",
    "",
    ...renderPendingTasks(run),
    "",
    "## Results",
    "",
    ...renderResults(run),
    // "run <-> PR linkage": the ONLY section that is fully absent (no
    // header at all) when it has nothing to show — every section above
    // keeps its header plus a "none yet" fallback line, but a "## Links"
    // header on a run with no links would be new, unwanted noise on
    // every run's report, so it is skipped outright instead.
    ...(run.links && run.links.length ? ["", "## Links", "", ...renderLinks(run)] : []),
  ].join("\n");
  fs.writeFileSync(run.paths.report, report, "utf8");
  return run.paths.report;
}
