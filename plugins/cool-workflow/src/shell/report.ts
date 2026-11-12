// shell/report.ts — writes report.md (and report.html beside it) for a run.
// Section headers and fallback lines are part of the report's shape:
// verify-bundle relies on each result rendering as
// `### <taskId>\n\nResult: <path>\n\n<body>`.

import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { WorkflowRun } from "../core/state/types.js";
import { updatePhaseStatuses } from "../core/pipeline/drive-decide.js";
import { normalizeResultEnvelope } from "../core/pipeline/result-normalize.js";
import { isVerdictTaskId } from "../core/trust/evidence-grounding.js";
import { reportToHtml } from "../core/format/report-html.js";
import { verifyTelemetryLedger } from "./telemetry-ledger-io.js";

/** Control characters (not tab) become spaces, so a value from state.json
 *  cannot start a new line in report.md. */
function oneLine(value: string): string {
  return value.replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, " ");
}

function formatInputList(value: unknown): string {
  if (Array.isArray(value)) return value.join("; ");
  return value ? String(value) : "";
}

/** The run's one lifecycle word: running, failed, completed, or queued. */
export function runVerdict(run: WorkflowRun): string {
  const tasks = run.tasks;
  if (tasks.some((t) => t.status === "running")) return "RUNNING";
  if (tasks.some((t) => t.status === "failed")) return "FAILED";
  if (tasks.length > 0 && tasks.every((t) => t.status === "completed")) return "PASS";
  return tasks.some((t) => t.status === "completed") ? "RUNNING" : "QUEUED";
}

function underRunDir(run: WorkflowRun, file: string): string {
  const rel = path.relative(run.paths.runDir, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : file;
}

function renderCommits(run: WorkflowRun): string[] {
  if (!run.commits.length) return ["No state commits yet."];
  return run.commits.map((commit) => {
    const kind = commit.verifierGated ? "verifier-gated commit" : "checkpoint";
    const gate = commit.verifierGated ? `verifier=${commit.verifierTaskId || "unknown"}, evidence=${commit.evidence?.length || 0}` : "verifierGated=false";
    return `- ${commit.id}: ${commit.reason} [${commit.loopStage}; ${kind}; ${gate}] (${underRunDir(run, commit.snapshotPath)})`;
  });
}

/** `## Telemetry`: who reported usage, whether it was signed, and whether the
 *  attestation ledger's chain still verifies. */
function renderTelemetry(run: WorkflowRun): string[] {
  const hops = run.tasks.filter((t) => t.usageAttestation);
  if (!hops.length) return ["No agent telemetry recorded."];
  const by = (s: string) => hops.filter((t) => t.usageAttestation === s);
  const unattested = by("unattested");
  const lines = [
    `- Telemetry attestation: ${by("attested").length}/${hops.length} attested` + (unattested.length ? `, ${unattested.length} UNATTESTED` : "") + (by("absent").length ? `, ${by("absent").length} absent` : ""),
    `- Models (agent-self-reported, never CW-verified): ${Array.from(new Set(hops.map((t) => t.model || "unreported"))).join(", ")}`,
  ];
  for (const t of unattested) lines.push(`  - ⚠️  UNATTESTED usage — task=${t.id}`);
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

function loadReceiptIo(): typeof import("./receipt-io.js") {
  return createRequire(import.meta.url)("./receipt-io.js") as typeof import("./receipt-io.js");
}

function receiptNote(run: WorkflowRun, ref: string): string {
  return ref.startsWith("receipt:") ? ` — ${loadReceiptIo().pinnedReceiptNote(run.paths.runDir, ref.slice("receipt:".length))}` : "";
}

/** The answer as data: the completed verdict/synthesis task's id, summary
 *  and evidence, or null when there is none. */
export function reportAnswer(run: WorkflowRun): { taskId: string; summary: string; evidence: string[] } | null {
  const verdict = run.tasks.find((task) => isVerdictTaskId(task.id) && task.status === "completed");
  if (!verdict || !verdict.resultPath || !fs.existsSync(verdict.resultPath)) return null;
  const envelope = normalizeResultEnvelope(fs.readFileSync(verdict.resultPath, "utf8"));
  if (!envelope.summary.trim()) return null;
  return { taskId: verdict.id, summary: envelope.summary.trim(), evidence: envelope.evidence };
}

function renderAnswer(run: WorkflowRun): string[] {
  const answer = reportAnswer(run);
  if (!answer) return [];
  const lines = ["## Answer", "", answer.summary, ""];
  if (answer.evidence.length) lines.push("Evidence:", "", ...answer.evidence.map((ref) => `- ${ref}${receiptNote(run, ref)}`), "");
  lines.push(`Full result: ## Results, ### ${answer.taskId}`, "");
  return lines;
}

function renderResults(run: WorkflowRun): string[] {
  const completed = run.tasks.filter((t) => t.status === "completed");
  if (!completed.length) return ["No completed results yet."];
  const lines: string[] = [];
  for (const task of completed) {
    lines.push(`### ${task.id}`, "", `Result: ${task.resultPath}`, "");
    if (task.resultPath && fs.existsSync(task.resultPath)) lines.push(fs.readFileSync(task.resultPath, "utf8").trim(), "");
    else lines.push("_Result file is not present on this host; state metadata remains inspectable._", "");
  }
  return lines;
}

function renderPending(run: WorkflowRun): string[] {
  const open = run.tasks.filter((t) => t.status !== "completed");
  if (!open.length) return ["No pending tasks."];
  return open.map((t) => {
    const last = t.errors?.length ? t.errors[t.errors.length - 1].message : "";
    return `- ${t.id} (${t.phase}, ${t.status})${last ? `: ${oneLine(last)}` : ""}`;
  });
}

export function renderReport(run: WorkflowRun): string {
  updatePhaseStatuses(run);
  const invariants = formatInputList(run.inputs.invariant).trim();
  return [
    `# ${oneLine(run.workflow.title)}`,
    "",
    `- Run: ${run.id}`,
    `- Workflow: ${oneLine(run.workflow.id)}`,
    `- Created: ${run.createdAt}`,
    `- Updated: ${run.updatedAt}`,
    `- Repository: ${oneLine(String(run.inputs.repo || run.cwd))}`,
    `- Question: ${oneLine(String(run.inputs.question || ""))}`,
    ...(invariants ? [`- Invariants: ${oneLine(invariants)}`] : []),
    `- Loop Stage: ${run.loopStage}`,
    `- Verdict: ${runVerdict(run)}`,
    "",
    ...renderAnswer(run),
    ...(fs.existsSync(path.join(run.paths.runDir, "receipts")) ? ["## Check Receipts", "", ...loadReceiptIo().pinnedReceiptLines(run.paths.runDir), ""] : []),
    "## Phase Status",
    "",
    "| Phase | Status | Completed | Total |",
    "| --- | --- | ---: | ---: |",
    ...run.phases.map((phase) => {
      const ids = new Set(phase.taskIds);
      const tasks = run.tasks.filter((t) => ids.has(t.id));
      return `| ${phase.name} | ${phase.status} | ${tasks.filter((t) => t.status === "completed").length} | ${tasks.length} |`;
    }),
    "",
    "## Results",
    "",
    ...renderResults(run),
    "",
    "## Pending Tasks",
    "",
    ...renderPending(run),
    "",
    "## Telemetry",
    "",
    ...renderTelemetry(run),
    "",
    "## State Commits",
    "",
    ...renderCommits(run),
    "",
  ].join("\n");
}

/** Writes report.md and report.html. Returns the report.md path. */
export function writeReport(run: WorkflowRun): string {
  const markdown = renderReport(run);
  fs.writeFileSync(run.paths.report, markdown, "utf8");
  fs.writeFileSync(path.join(path.dirname(run.paths.report), "report.html"), reportToHtml(markdown, run.workflow.title), "utf8");
  return run.paths.report;
}
