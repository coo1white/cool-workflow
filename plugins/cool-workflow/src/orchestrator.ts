import fs from "node:fs";
import path from "node:path";
import {
  DispatchManifest,
  RunSummary,
  RunTask,
  WorkflowDefinition,
  WorkflowRun
} from "./types";
import { createWorkflowApi, slugify } from "./workflow-api";
import { createDispatchManifest, firstRunnablePhase, nextDispatchTasks, updatePhaseStatuses } from "./dispatch";
import { writeTaskFiles } from "./harness";
import { commitState } from "./commit";
import { assertTaskCanComplete, parseResultEnvelope, validateResultEnvelope, validateRunGates } from "./verifier";
import { createRunPaths, ensureRunDirs, loadRunFromCwd, safeFileName, saveCheckpoint, writeJson } from "./state";

export class CoolWorkflowRunner {
  pluginRoot: string;
  workflowsDir: string;

  constructor({ pluginRoot }: { pluginRoot: string }) {
    this.pluginRoot = resolvePluginRoot(pluginRoot);
    this.workflowsDir = path.join(this.pluginRoot, "workflows");
  }

  listWorkflows(): Array<{ id: string; title: string; summary: string; file: string }> {
    return this.loadWorkflowFiles().map((file) => {
      const workflow = this.loadWorkflow(file);
      return {
        id: workflow.id,
        title: workflow.title,
        summary: workflow.summary || "",
        file
      };
    });
  }

  init(workflowId: string, options: Record<string, unknown>): { id: string; path: string } {
    const id = slugify(workflowId);
    if (!id) throw new Error("Workflow id must include at least one letter or digit");
    const title = String(options.title || titleize(id));
    const destination = path.resolve(
      String(options.output || path.join(this.workflowsDir, `${id}.workflow.js`))
    );
    if (fs.existsSync(destination) && !options.force) {
      throw new Error(`Refusing to overwrite existing workflow: ${destination}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, renderWorkflowTemplate(id, title), "utf8");
    return { id, path: destination };
  }

  plan(workflowId: string, options: Record<string, unknown>): WorkflowRun {
    const workflow = this.loadWorkflowById(workflowId);
    const inputs = normalizeInputs(options);
    validateInputs(workflow, inputs);

    const cwd = path.resolve(String(inputs.cwd || inputs.repo || process.cwd()));
    const runId = createRunId(workflow.id);
    const runDir = path.join(cwd, ".cw", "runs", runId);
    const paths = createRunPaths(runDir);
    ensureRunDirs(paths);

    const tasks = flattenTasks(workflow, inputs);
    const run: WorkflowRun = {
      schemaVersion: 1,
      id: runId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cwd,
      workflow: {
        id: workflow.id,
        title: workflow.title,
        summary: workflow.summary || "",
        limits: workflow.limits
      },
      inputs,
      loopStage: "interpret",
      phases: workflow.phases.map((phase) => ({
        id: phase.id || slugify(phase.name),
        name: phase.name,
        status: "pending",
        taskIds: phase.tasks.map((task) => task.id)
      })),
      tasks,
      dispatches: [],
      commits: [],
      paths
    };

    writeTaskFiles(run);
    writeReport(run);
    commitState(run, "initial-plan");
    saveCheckpoint(run);
    return run;
  }

  status(runId: string): RunSummary {
    return summarizeRun(this.loadRun(runId));
  }

  next(runId: string, options: Record<string, unknown>): ReturnType<typeof nextDispatchTasks> {
    return nextDispatchTasks(this.loadRun(runId), numberOption(options.limit));
  }

  dispatch(runId: string, options: Record<string, unknown>): DispatchManifest {
    const run = this.loadRun(runId);
    const manifest = createDispatchManifest(run, numberOption(options.limit));
    run.loopStage = "act";
    if (manifest.dispatchId) commitState(run, `dispatch:${manifest.dispatchId}`);
    saveCheckpoint(run);
    writeReport(run);
    return manifest;
  }

  recordResult(runId: string, taskId: string, resultPath: string): RunSummary {
    const run = this.loadRun(runId);
    const task = run.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Unknown task id for run ${runId}: ${taskId}`);
    assertTaskCanComplete(run, task);

    const absoluteResultPath = path.resolve(resultPath);
    if (!fs.existsSync(absoluteResultPath)) {
      throw new Error(`Result file does not exist: ${absoluteResultPath}`);
    }
    const rawResult = fs.readFileSync(absoluteResultPath, "utf8");
    run.loopStage = "observe";
    const parsedResult = parseResultEnvelope(rawResult);
    run.loopStage = "adjust";
    validateResultEnvelope(task, parsedResult);

    const destination = path.join(run.paths.resultsDir, `${safeFileName(taskId)}.md`);
    fs.copyFileSync(absoluteResultPath, destination);
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.resultPath = destination;
    task.loopStage = "observe";
    task.result = parsedResult;
    updatePhaseStatuses(run);
    validateRunGates(run);
    commitState(run, `result:${taskId}`);
    writeReport(run);
    saveCheckpoint(run);
    return summarizeRun(run);
  }

  report(runId: string): { path: string } {
    const run = this.loadRun(runId);
    return { path: writeReport(run) };
  }

  commit(runId: string, reason: string): StateCommitResult {
    const run = this.loadRun(runId);
    run.loopStage = "checkpoint";
    const commit = commitState(run, reason || "manual");
    writeReport(run);
    saveCheckpoint(run);
    return { runId, commit };
  }

  loadRun(runId: string): WorkflowRun {
    return loadRunFromCwd(runId);
  }

  loadWorkflowById(workflowId: string): WorkflowDefinition {
    for (const file of this.loadWorkflowFiles()) {
      const workflow = this.loadWorkflow(file);
      if (workflow.id === workflowId) return workflow;
    }
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  private loadWorkflowFiles(): string[] {
    if (!fs.existsSync(this.workflowsDir)) return [];
    return fs
      .readdirSync(this.workflowsDir)
      .filter((file) => file.endsWith(".workflow.js"))
      .sort()
      .map((file) => path.join(this.workflowsDir, file));
  }

  private loadWorkflow(file: string): WorkflowDefinition {
    // Bundled workflows are runtime JavaScript so users can run them without ts-node.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const workflowFactory = require(file) as unknown;
    if (typeof workflowFactory !== "function") {
      throw new Error(`Workflow file must export a function: ${file}`);
    }
    return workflowFactory(createWorkflowApi()) as WorkflowDefinition;
  }
}

interface StateCommitResult {
  runId: string;
  commit: WorkflowRun["commits"][number];
}

export function parseArgv(argv: string[]): {
  command?: string;
  positionals: string[];
  options: Record<string, unknown>;
} {
  const [command, ...rest] = argv;
  const options: Record<string, unknown> = {};
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const withoutPrefix = token.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    let key: string;
    let value: string | boolean;
    if (equalsIndex >= 0) {
      key = withoutPrefix.slice(0, equalsIndex);
      value = withoutPrefix.slice(equalsIndex + 1);
    } else {
      key = withoutPrefix;
      value = rest[index + 1] && !rest[index + 1].startsWith("--") ? rest[++index] : true;
    }
    appendOption(options, key, value);
  }
  return { command, positionals, options };
}

export function formatHelp(): string {
  return `Cool Workflow\n\nCommands:\n  list\n  init <workflow-id> [--title TEXT] [--output PATH]\n  plan <workflow-id> [--repo PATH] [--question TEXT] [--invariant TEXT]\n  status <run-id>\n  next <run-id> [--limit N]\n  dispatch <run-id> [--limit N]\n  result <run-id> <task-id> <result-file>\n  commit <run-id> [--reason TEXT]\n  report <run-id>\n  loop --intervalMinutes 30 --prompt TEXT\n  schedule create --kind loop --intervalMinutes 30 --prompt TEXT\n  schedule list [--status active]\n  schedule due\n  schedule complete <schedule-id>\n  schedule pause <schedule-id>\n  schedule resume <schedule-id>\n  schedule run-now <schedule-id>\n  schedule history [schedule-id]\n  schedule daemon [--once] [--intervalSeconds 60]\n  schedule delete <schedule-id>\n  routine create --kind api|github --prompt TEXT [--match JSON]\n  routine fire api|github [payload.json]\n  routine list\n  routine events [trigger-id]\n  routine delete <trigger-id>\n\n`;
}

function appendOption(options: Record<string, unknown>, key: string, value: string | boolean): void {
  if (Object.prototype.hasOwnProperty.call(options, key)) {
    const current = options[key];
    options[key] = Array.isArray(current) ? [...current, value] : [current, value];
    return;
  }
  options[key] = value;
}

function normalizeInputs(options: Record<string, unknown>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === "arg") {
      const pairs = Array.isArray(value) ? value : [value];
      for (const pair of pairs) {
        const [argKey, ...rest] = String(pair).split("=");
        inputs[argKey] = rest.join("=");
      }
      continue;
    }
    inputs[key] = value;
  }
  if (inputs.repo && !inputs.cwd) inputs.cwd = inputs.repo;
  return inputs;
}

function validateInputs(workflow: WorkflowDefinition, inputs: Record<string, unknown>): void {
  for (const input of workflow.inputs || []) {
    if (input.required && isMissing(inputs[input.name])) {
      throw new Error(`Missing required input --${input.name}`);
    }
  }
}

function flattenTasks(workflow: WorkflowDefinition, inputs: Record<string, unknown>): RunTask[] {
  const seen = new Set<string>();
  const tasks: RunTask[] = [];
  for (const phase of workflow.phases) {
    for (const task of phase.tasks) {
      if (seen.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
      seen.add(task.id);
      tasks.push({
        id: task.id,
        kind: task.kind,
        phase: phase.name,
        status: "pending",
        loopStage: "interpret",
        requiresEvidence: Boolean(task.requiresEvidence),
        prompt: renderPrompt(task.prompt, inputs),
        taskPath: "",
        resultPath: ""
      });
    }
  }
  return tasks;
}

function writeReport(run: WorkflowRun): string {
  updatePhaseStatuses(run);
  const report = [
    `# ${run.workflow.title}`,
    "",
    `- Run: ${run.id}`,
    `- Workflow: ${run.workflow.id}`,
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
      const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
      const completed = phaseTasks.filter((task) => task.status === "completed").length;
      return `| ${phase.name} | ${phase.status} | ${completed} | ${phaseTasks.length} |`;
    }),
    "",
    "## State Commits",
    "",
    ...renderCommits(run),
    "",
    "## Pending Tasks",
    "",
    ...renderPendingTasks(run),
    "",
    "## Results",
    "",
    ...renderResults(run)
  ].join("\n");
  fs.writeFileSync(run.paths.report, report, "utf8");
  return run.paths.report;
}

function summarizeRun(run: WorkflowRun): RunSummary {
  updatePhaseStatuses(run);
  return {
    runId: run.id,
    workflowId: run.workflow.id,
    phases: run.phases,
    tasks: {
      total: run.tasks.length,
      pending: run.tasks.filter((task) => task.status === "pending").length,
      running: run.tasks.filter((task) => task.status === "running").length,
      failed: run.tasks.filter((task) => task.status === "failed").length,
      completed: run.tasks.filter((task) => task.status === "completed").length
    },
    loopStage: run.loopStage,
    next: firstRunnablePhase(run)?.name || null,
    reportPath: run.paths.report,
    commits: run.commits
  };
}

function renderPendingTasks(run: WorkflowRun): string[] {
  const pending = run.tasks.filter((task) => task.status === "pending" || task.status === "running");
  if (!pending.length) return ["No pending tasks."];
  return pending.map((task) => `- ${task.id} (${task.phase}, ${task.status}): ${task.taskPath}`);
}

function renderResults(run: WorkflowRun): string[] {
  const completed = run.tasks.filter((task) => task.status === "completed");
  if (!completed.length) return ["No completed results yet."];
  const lines: string[] = [];
  for (const task of completed) {
    lines.push(`### ${task.id}`, "", `Result: ${task.resultPath}`, "");
    lines.push(fs.readFileSync(task.resultPath, "utf8").trim(), "");
  }
  return lines;
}

function renderCommits(run: WorkflowRun): string[] {
  if (!run.commits.length) return ["No state commits yet."];
  return run.commits.map((commit) => `- ${commit.id}: ${commit.reason} [${commit.loopStage}] (${commit.snapshotPath})`);
}

function renderPrompt(prompt: string, inputs: Record<string, unknown>): string {
  const invariant = Array.isArray(inputs.invariant)
    ? inputs.invariant.join("; ")
    : String(inputs.invariant || "");
  return String(prompt)
    .replaceAll("{{repo}}", String(inputs.repo || ""))
    .replaceAll("{{question}}", String(inputs.question || ""))
    .replaceAll("{{invariant}}", invariant);
}

function formatInputList(value: unknown): string {
  if (Array.isArray(value)) return value.join("; ");
  return value ? String(value) : "";
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function numberOption(value: unknown): number | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function createRunId(workflowId: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${workflowId}-${stamp}-${suffix}`;
}

function resolvePluginRoot(candidate: string): string {
  let current = path.resolve(candidate);
  for (let depth = 0; depth < 5; depth += 1) {
    if (fs.existsSync(path.join(current, "workflows")) && fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error("Run cw.js from the cool-workflow plugin directory");
}

function renderWorkflowTemplate(id: string, title: string): string {
  return `module.exports = ({ workflow, phase, agent, artifact }) =>\n  workflow({\n    id: ${JSON.stringify(id)},\n    title: ${JSON.stringify(title)},\n    summary: "Describe what this workflow does.",\n    limits: {\n      maxAgents: 8,\n      maxConcurrentAgents: 4\n    },\n    inputs: [\n      { name: "question", required: true }\n    ],\n    phases: [\n      phase("Map", [\n        agent("map:context", "Map the task context, constraints, and evidence needed for {{question}}.")\n      ]),\n      phase("Assess", [\n        agent("assess:risks", "Assess risks, tradeoffs, and unknowns for {{question}}.")\n      ]),\n      phase("Synthesize", [\n        artifact("synthesis:report", "Synthesize the final answer for {{question}}.", { requiresEvidence: true })\n      ])\n    ]\n  });\n`;
}

function titleize(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
