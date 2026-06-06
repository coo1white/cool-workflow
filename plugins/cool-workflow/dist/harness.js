"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeTaskFiles = writeTaskFiles;
exports.renderTask = renderTask;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
function writeTaskFiles(run) {
    for (const task of run.tasks) {
        const taskPath = node_path_1.default.join(run.paths.tasksDir, `${(0, state_1.safeFileName)(task.id)}.md`);
        task.taskPath = taskPath;
        node_fs_1.default.writeFileSync(taskPath, renderTask(run, task), "utf8");
    }
}
function renderTask(run, task) {
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
function formatInputList(value) {
    if (Array.isArray(value))
        return value.join("; ");
    return value ? String(value) : "";
}
