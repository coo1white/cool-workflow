"use strict";
// shell/harness.ts — writeTaskFiles, renderTask (task file template).
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// harness module.
//
// Evidence: SPEC/pipeline-run.md "Task files — harness module", "Task
// file template (verbatim skeleton from renderTask)".
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTask = renderTask;
exports.writeTaskFiles = writeTaskFiles;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
function formatInputList(value) {
    if (Array.isArray(value))
        return value.join("; ");
    return value ? String(value) : "";
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
        "",
    ].join("\n");
}
function writeTaskFiles(run) {
    for (const task of run.tasks) {
        const taskPath = path.join(run.paths.tasksDir, `${(0, fs_atomic_1.safeFileName)(task.id)}.md`);
        task.taskPath = taskPath;
        fs.writeFileSync(taskPath, renderTask(run, task), "utf8");
    }
}
