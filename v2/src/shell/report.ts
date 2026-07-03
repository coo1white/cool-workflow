// shell/report.ts — report.md generation (the byte-exact section
// headers/fallback lines from the spec), the actual file write.
//
// MILESTONE 6+7 (combined). Byte-exact port of the SECTIONS the old
// build's src/orchestrator/report.ts always renders regardless of
// subsystem maturity (Phase Status, State Commits, Error Feedback,
// Workers, Pending Tasks, Results) — the multi-agent/blackboard/
// candidate/trust-audit-summary sections are milestone 8/9's scope and
// render their OWN "no records yet" fallback line here (real, not faked:
// those subsystems truly have zero records at this milestone since their
// build hasn't landed).
//
// Evidence: SPEC/pipeline-run.md "Files on disk" (report.md); the ten
// byte-exact fallback lines are ported from src/orchestrator/report.ts's
// renderX helpers.

import * as fs from "node:fs";
import { WorkflowRun } from "../core/state/types";
import { updatePhaseStatuses } from "../core/pipeline/dispatch";
import { WorkerScope } from "./worker-isolation";

function formatInputList(value: unknown): string {
  if (Array.isArray(value)) return value.join("; ");
  return value ? String(value) : "";
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
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

function renderWorkers(run: WorkflowRun): string[] {
  const workers = (run.workers as unknown as WorkerScope[]) || [];
  if (!workers.length) return ["No worker scopes yet."];
  const lines = [`- Total: ${workers.length}`, `- By status: ${formatCounts(countBy(workers, (w) => w.status))}`];
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
  const workflowApp = run.workflow.app as { id?: string; version?: string; source?: { manifestPath?: string; entrypointPath?: string; path?: string } } | undefined;
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
    `- Repository: ${String(run.inputs.repo || run.cwd)}`,
    `- Question: ${String(run.inputs.question || "")}`,
    `- Invariants: ${formatInputList(run.inputs.invariant)}`,
    `- Loop Stage: ${run.loopStage}`,
    "",
    "## Phase Status",
    "",
    "| Phase | Status | Completed | Total |",
    "| --- | --- | ---: | ---: |",
    ...run.phases.map((phase) => {
      const phaseTasks = run.tasks.filter((t) => phase.taskIds.includes(t.id));
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
    "## Multi-Agent Runtime",
    "",
    "No multi-agent runtime records yet.",
    "",
    "## Blackboard / Coordinator",
    "",
    "No blackboard records yet.",
    "",
    "## Candidates",
    "",
    "No candidates yet.",
    "",
    "## Pending Tasks",
    "",
    ...renderPendingTasks(run),
    "",
    "## Results",
    "",
    ...renderResults(run),
  ].join("\n");
  fs.writeFileSync(run.paths.report, report, "utf8");
  return run.paths.report;
}
