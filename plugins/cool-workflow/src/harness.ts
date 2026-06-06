import fs from "node:fs";
import path from "node:path";
import { RunTask, WorkflowRun } from "./types";
import { safeFileName } from "./state";

export function writeTaskFiles(run: WorkflowRun): void {
  for (const task of run.tasks) {
    const taskPath = path.join(run.paths.tasksDir, `${safeFileName(task.id)}.md`);
    task.taskPath = taskPath;
    fs.writeFileSync(taskPath, renderTask(run, task), "utf8");
  }
}

export function renderTask(run: WorkflowRun, task: RunTask): string {
  return [
    `# ${task.id}`,
    "",
    `- Workflow: ${run.workflow.title}`,
    `- Run: ${run.id}`,
    `- Phase: ${task.phase}`,
    `- Kind: ${task.kind}`,
    "",
    "## Inputs",
    "",
    `- Repository: ${String(run.inputs.repo || run.cwd)}`,
    `- Question: ${String(run.inputs.question || "")}`,
    `- Invariants: ${formatInputList(run.inputs.invariant)}`,
    "",
    "## Task",
    "",
    task.prompt,
    "",
    "## Output Contract",
    "",
    "- Return a concise Markdown summary.",
    "- Include concrete evidence paths and line numbers when applicable.",
    "- Separate real, conditional, non-issue, and unknown findings when reviewing risk.",
    "- For verification or verdict tasks, include a `cw:result` JSON fence with `findings` and `evidence`.",
    "- Do not edit files unless the parent agent session explicitly assigned implementation work.",
    "",
    "```cw:result",
    "{",
    '  "summary": "one sentence",',
    '  "findings": [',
    '    { "id": "finding-id", "classification": "real|conditional|non-issue|unknown", "severity": "P0|P1|P2|P3|none", "evidence": ["file-or-url:line"] }',
    "  ],",
    '  "evidence": ["file-or-url:line"]',
    "}",
    "```",
    ""
  ].join("\n");
}

function formatInputList(value: unknown): string {
  if (Array.isArray(value)) return value.join("; ");
  return value ? String(value) : "";
}
