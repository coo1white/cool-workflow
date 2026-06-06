"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoolWorkflowRunner = void 0;
exports.parseArgv = parseArgv;
exports.formatHelp = formatHelp;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const workflow_api_1 = require("./workflow-api");
const dispatch_1 = require("./dispatch");
const harness_1 = require("./harness");
const commit_1 = require("./commit");
const verifier_1 = require("./verifier");
const state_1 = require("./state");
const pipeline_contract_1 = require("./pipeline-contract");
const error_feedback_1 = require("./error-feedback");
const state_node_1 = require("./state-node");
const pipeline_runner_1 = require("./pipeline-runner");
class CoolWorkflowRunner {
    pluginRoot;
    workflowsDir;
    constructor({ pluginRoot }) {
        this.pluginRoot = resolvePluginRoot(pluginRoot);
        this.workflowsDir = node_path_1.default.join(this.pluginRoot, "workflows");
    }
    listWorkflows() {
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
    init(workflowId, options) {
        const id = (0, workflow_api_1.slugify)(workflowId);
        if (!id)
            throw new Error("Workflow id must include at least one letter or digit");
        const title = String(options.title || titleize(id));
        const destination = node_path_1.default.resolve(String(options.output || node_path_1.default.join(this.workflowsDir, `${id}.workflow.js`)));
        if (node_fs_1.default.existsSync(destination) && !options.force) {
            throw new Error(`Refusing to overwrite existing workflow: ${destination}`);
        }
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(destination), { recursive: true });
        node_fs_1.default.writeFileSync(destination, renderWorkflowTemplate(id, title), "utf8");
        return { id, path: destination };
    }
    plan(workflowId, options) {
        const workflow = this.loadWorkflowById(workflowId);
        const inputs = normalizeInputs(options);
        validateInputs(workflow, inputs);
        const cwd = node_path_1.default.resolve(String(inputs.cwd || inputs.repo || process.cwd()));
        const runId = createRunId(workflow.id);
        const runDir = node_path_1.default.join(cwd, ".cw", "runs", runId);
        const paths = (0, state_1.createRunPaths)(runDir);
        (0, state_1.ensureRunDirs)(paths);
        const tasks = flattenTasks(workflow, inputs);
        const run = {
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
                id: phase.id || (0, workflow_api_1.slugify)(phase.name),
                name: phase.name,
                status: "pending",
                taskIds: phase.tasks.map((task) => task.id)
            })),
            tasks,
            dispatches: [],
            commits: [],
            paths,
            nodes: [],
            contracts: []
        };
        (0, harness_1.writeTaskFiles)(run);
        const contract = (0, state_node_1.upsertRunContract)(run, (0, pipeline_contract_1.createDefaultPipelineContract)());
        const inputNode = (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
            id: `${run.id}:input`,
            kind: "input",
            status: "completed",
            loopStage: "interpret",
            outputs: run.inputs,
            artifacts: [{ id: "state", kind: "json", path: run.paths.state }],
            contractId: contract.id,
            metadata: { workflowId: workflow.id }
        }));
        (0, state_1.saveCheckpoint)(run);
        const pipeline = (0, pipeline_runner_1.createPipelineRunner)({ contractId: contract.id, persist: false });
        for (const task of run.tasks) {
            const taskResult = pipeline.runPipelineStage(run, "plan", inputNode.id, {
                outputNodeId: `${run.id}:task:${task.id}`,
                outputStatus: "pending",
                loopStage: "interpret",
                artifacts: [{ id: "task", kind: "markdown", path: task.taskPath }],
                metadata: { workflowId: workflow.id, taskId: task.id, phase: task.phase, taskKind: task.kind, requiresEvidence: task.requiresEvidence }
            });
            task.stateNodeId = taskResult.outputNodeId;
        }
        writeReport(run);
        (0, commit_1.commitState)(run, "initial-plan");
        (0, state_1.saveCheckpoint)(run);
        return run;
    }
    status(runId) {
        return summarizeRun(this.loadRun(runId));
    }
    next(runId, options) {
        return (0, dispatch_1.nextDispatchTasks)(this.loadRun(runId), numberOption(options.limit));
    }
    dispatch(runId, options) {
        const run = this.loadRun(runId);
        const manifest = (0, dispatch_1.createDispatchManifest)(run, numberOption(options.limit));
        run.loopStage = "act";
        if (manifest.dispatchId)
            (0, commit_1.commitState)(run, `dispatch:${manifest.dispatchId}`);
        (0, state_1.saveCheckpoint)(run);
        writeReport(run);
        return manifest;
    }
    recordResult(runId, taskId, resultPath) {
        const run = this.loadRun(runId);
        const task = run.tasks.find((candidate) => candidate.id === taskId);
        if (!task)
            throw new Error(`Unknown task id for run ${runId}: ${taskId}`);
        try {
            (0, verifier_1.assertTaskCanComplete)(run, task);
            const absoluteResultPath = node_path_1.default.resolve(resultPath);
            if (!node_fs_1.default.existsSync(absoluteResultPath)) {
                throw new Error(`Result file does not exist: ${absoluteResultPath}`);
            }
            const rawResult = node_fs_1.default.readFileSync(absoluteResultPath, "utf8");
            run.loopStage = "observe";
            const parsedResult = (0, verifier_1.parseResultEnvelope)(rawResult);
            run.loopStage = "adjust";
            (0, verifier_1.validateResultEnvelope)(task, parsedResult);
            const destination = node_path_1.default.join(run.paths.resultsDir, `${(0, state_1.safeFileName)(taskId)}.md`);
            node_fs_1.default.copyFileSync(absoluteResultPath, destination);
            task.status = "completed";
            task.completedAt = new Date().toISOString();
            task.resultPath = destination;
            task.loopStage = "observe";
            task.result = parsedResult;
            const resultNode = (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
                id: `${run.id}:result:${task.id}`,
                kind: "result",
                status: "completed",
                loopStage: "observe",
                inputs: { taskId: task.id, dispatchId: task.dispatchId },
                outputs: parsedResult,
                artifacts: [{ id: "result", kind: "markdown", path: destination }],
                evidence: parsedResult.evidence.map((entry, index) => ({
                    id: `result:${index + 1}`,
                    source: "cw:result",
                    locator: entry,
                    summary: entry
                })),
                parents: task.dispatchId ? [`${run.id}:dispatch:${task.dispatchId}`] : [task.stateNodeId || `${run.id}:task:${task.id}`],
                contractId: pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
                metadata: { taskId: task.id }
            }));
            task.resultNodeId = resultNode.id;
            (0, dispatch_1.updatePhaseStatuses)(run);
            (0, verifier_1.validateRunGates)(run);
            const verifierResult = (0, pipeline_runner_1.createPipelineRunner)({ persist: false }).runPipelineStage(run, "verify", resultNode.id, {
                outputNodeId: `${run.id}:verifier:${task.id}`,
                outputStatus: "verified",
                loopStage: "adjust",
                outputs: { accepted: true },
                artifacts: [{ id: "result", kind: "markdown", path: destination }],
                evidence: resultNode.evidence.length
                    ? resultNode.evidence
                    : [{ id: "result:summary", source: "summary", summary: parsedResult.summary }],
                metadata: { taskId: task.id, resultNodeId: resultNode.id }
            });
            task.verifierNodeId = verifierResult.outputNodeId;
            (0, commit_1.commitState)(run, `result:${taskId}`);
            writeReport(run);
            (0, state_1.saveCheckpoint)(run);
            return summarizeRun(run);
        }
        catch (error) {
            (0, error_feedback_1.recordFeedback)(run, {
                source: "verifier",
                error: error instanceof Error ? error : String(error),
                taskId: task.id,
                path: resultPath ? node_path_1.default.resolve(resultPath) : undefined,
                retryable: false,
                metadata: {
                    taskStatus: task.status,
                    dispatchId: task.dispatchId,
                    stateNodeId: task.stateNodeId,
                    resultNodeId: task.resultNodeId
                }
            });
            writeReport(run);
            throw error;
        }
    }
    report(runId) {
        const run = this.loadRun(runId);
        return { path: writeReport(run) };
    }
    showContract(runId, contractId) {
        const run = this.loadRun(runId);
        return (0, pipeline_runner_1.createPipelineRunner)().getRunContract(run, contractId);
    }
    listNodes(runId) {
        return this.loadRun(runId).nodes || [];
    }
    showNode(runId, nodeId) {
        return (0, pipeline_runner_1.createPipelineRunner)().getRunNode(this.loadRun(runId), nodeId);
    }
    graphNodes(runId) {
        return (this.loadRun(runId).nodes || []).map((node) => ({
            id: node.id,
            kind: node.kind,
            status: node.status,
            parents: node.parents,
            children: node.children
        }));
    }
    commit(runId, reason) {
        const run = this.loadRun(runId);
        run.loopStage = "checkpoint";
        const commit = (0, commit_1.commitState)(run, reason || "manual");
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return { runId, commit };
    }
    collectFeedback(runId) {
        const run = this.loadRun(runId);
        const collected = (0, error_feedback_1.collectRunErrors)(run);
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return collected;
    }
    listFeedback(runId, options = {}) {
        return (0, error_feedback_1.listFeedback)(this.loadRun(runId), {
            status: options.status ? String(options.status) : undefined,
            severity: options.severity ? String(options.severity) : undefined,
            classification: options.classification ? String(options.classification) : undefined
        });
    }
    showFeedback(runId, feedbackId) {
        const feedback = (0, error_feedback_1.getFeedback)(this.loadRun(runId), feedbackId);
        if (!feedback)
            throw new Error(`Unknown feedback id for run ${runId}: ${feedbackId}`);
        return feedback;
    }
    createFeedbackTask(runId, feedbackId, options = {}) {
        const run = this.loadRun(runId);
        const feedback = (0, error_feedback_1.createCorrectionTask)(run, feedbackId, {
            verifierCommand: options.verify ? String(options.verify) : undefined,
            guidance: options.guidance ? String(options.guidance) : undefined
        });
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return feedback;
    }
    resolveFeedback(runId, feedbackId, options = {}) {
        const run = this.loadRun(runId);
        const feedback = (0, error_feedback_1.resolveFeedback)(run, feedbackId, {
            status: options.status === "rejected" ? "rejected" : "resolved",
            nodeId: options.node ? String(options.node) : undefined,
            message: options.message ? String(options.message) : undefined
        });
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return feedback;
    }
    loadRun(runId) {
        return (0, state_1.loadRunFromCwd)(runId);
    }
    loadWorkflowById(workflowId) {
        for (const file of this.loadWorkflowFiles()) {
            const workflow = this.loadWorkflow(file);
            if (workflow.id === workflowId)
                return workflow;
        }
        throw new Error(`Workflow not found: ${workflowId}`);
    }
    loadWorkflowFiles() {
        if (!node_fs_1.default.existsSync(this.workflowsDir))
            return [];
        return node_fs_1.default
            .readdirSync(this.workflowsDir)
            .filter((file) => file.endsWith(".workflow.js"))
            .sort()
            .map((file) => node_path_1.default.join(this.workflowsDir, file));
    }
    loadWorkflow(file) {
        // Bundled workflows are runtime JavaScript so users can run them without ts-node.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const workflowFactory = require(file);
        if (typeof workflowFactory !== "function") {
            throw new Error(`Workflow file must export a function: ${file}`);
        }
        return workflowFactory((0, workflow_api_1.createWorkflowApi)());
    }
}
exports.CoolWorkflowRunner = CoolWorkflowRunner;
function parseArgv(argv) {
    const [command, ...rest] = argv;
    const options = {};
    const positionals = [];
    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index];
        if (!token.startsWith("--")) {
            positionals.push(token);
            continue;
        }
        const withoutPrefix = token.slice(2);
        const equalsIndex = withoutPrefix.indexOf("=");
        let key;
        let value;
        if (equalsIndex >= 0) {
            key = withoutPrefix.slice(0, equalsIndex);
            value = withoutPrefix.slice(equalsIndex + 1);
        }
        else {
            key = withoutPrefix;
            value = rest[index + 1] && !rest[index + 1].startsWith("--") ? rest[++index] : true;
        }
        appendOption(options, key, value);
    }
    return { command, positionals, options };
}
function formatHelp() {
    return `Cool Workflow\n\nCommands:\n  list\n  init <workflow-id> [--title TEXT] [--output PATH]\n  plan <workflow-id> [--repo PATH] [--question TEXT] [--invariant TEXT]\n  status <run-id>\n  next <run-id> [--limit N]\n  dispatch <run-id> [--limit N]\n  result <run-id> <task-id> <result-file>\n  commit <run-id> [--reason TEXT]\n  report <run-id>\n  contract show <run-id> [contract-id]\n  node list <run-id>\n  node show <run-id> <node-id>\n  node graph <run-id>\n  feedback list <run-id> [--status open]\n  feedback show <run-id> <feedback-id>\n  feedback collect <run-id>\n  feedback task <run-id> <feedback-id> [--verify CMD]\n  feedback resolve <run-id> <feedback-id> --node <node-id>\n  loop --intervalMinutes 30 --prompt TEXT\n  schedule create --kind loop --intervalMinutes 30 --prompt TEXT\n  schedule list [--status active]\n  schedule due\n  schedule complete <schedule-id>\n  schedule pause <schedule-id>\n  schedule resume <schedule-id>\n  schedule run-now <schedule-id>\n  schedule history [schedule-id]\n  schedule daemon [--once] [--intervalSeconds 60]\n  schedule delete <schedule-id>\n  routine create --kind api|github --prompt TEXT [--match JSON]\n  routine fire api|github [payload.json]\n  routine list\n  routine events [trigger-id]\n  routine delete <trigger-id>\n\n`;
}
function appendOption(options, key, value) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
        const current = options[key];
        options[key] = Array.isArray(current) ? [...current, value] : [current, value];
        return;
    }
    options[key] = value;
}
function normalizeInputs(options) {
    const inputs = {};
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
    if (inputs.repo && !inputs.cwd)
        inputs.cwd = inputs.repo;
    return inputs;
}
function validateInputs(workflow, inputs) {
    for (const input of workflow.inputs || []) {
        if (input.required && isMissing(inputs[input.name])) {
            throw new Error(`Missing required input --${input.name}`);
        }
    }
}
function flattenTasks(workflow, inputs) {
    const seen = new Set();
    const tasks = [];
    for (const phase of workflow.phases) {
        for (const task of phase.tasks) {
            if (seen.has(task.id))
                throw new Error(`Duplicate task id: ${task.id}`);
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
function writeReport(run) {
    (0, dispatch_1.updatePhaseStatuses)(run);
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
        "## Error Feedback",
        "",
        ...renderFeedback(run),
        "",
        "## Pending Tasks",
        "",
        ...renderPendingTasks(run),
        "",
        "## Results",
        "",
        ...renderResults(run)
    ].join("\n");
    node_fs_1.default.writeFileSync(run.paths.report, report, "utf8");
    return run.paths.report;
}
function summarizeRun(run) {
    (0, dispatch_1.updatePhaseStatuses)(run);
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
        next: (0, dispatch_1.firstRunnablePhase)(run)?.name || null,
        reportPath: run.paths.report,
        commits: run.commits
    };
}
function renderPendingTasks(run) {
    const pending = run.tasks.filter((task) => task.status === "pending" || task.status === "running");
    if (!pending.length)
        return ["No pending tasks."];
    return pending.map((task) => `- ${task.id} (${task.phase}, ${task.status}): ${task.taskPath}`);
}
function renderResults(run) {
    const completed = run.tasks.filter((task) => task.status === "completed");
    if (!completed.length)
        return ["No completed results yet."];
    const lines = [];
    for (const task of completed) {
        lines.push(`### ${task.id}`, "", `Result: ${task.resultPath}`, "");
        lines.push(node_fs_1.default.readFileSync(task.resultPath, "utf8").trim(), "");
    }
    return lines;
}
function renderCommits(run) {
    if (!run.commits.length)
        return ["No state commits yet."];
    return run.commits.map((commit) => `- ${commit.id}: ${commit.reason} [${commit.loopStage}] (${commit.snapshotPath})`);
}
function renderFeedback(run) {
    const summary = (0, error_feedback_1.summarizeFeedback)(run);
    if (!summary.total)
        return ["No feedback records."];
    return [
        `- Total: ${summary.total}`,
        `- By status: ${formatCounts(summary.byStatus)}`,
        `- By severity: ${formatCounts(summary.bySeverity)}`,
        `- By classification: ${formatCounts(summary.byClassification)}`,
        "",
        ...summary.artifacts.map((artifact) => `- ${artifact}`)
    ];
}
function formatCounts(counts) {
    const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
    if (!entries.length)
        return "none";
    return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}
function renderPrompt(prompt, inputs) {
    const invariant = Array.isArray(inputs.invariant)
        ? inputs.invariant.join("; ")
        : String(inputs.invariant || "");
    return String(prompt)
        .replaceAll("{{repo}}", String(inputs.repo || ""))
        .replaceAll("{{question}}", String(inputs.question || ""))
        .replaceAll("{{invariant}}", invariant);
}
function formatInputList(value) {
    if (Array.isArray(value))
        return value.join("; ");
    return value ? String(value) : "";
}
function isMissing(value) {
    return value === undefined || value === null || value === "";
}
function numberOption(value) {
    if (value === undefined || value === null || value === true)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function createRunId(workflowId) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${workflowId}-${stamp}-${suffix}`;
}
function resolvePluginRoot(candidate) {
    let current = node_path_1.default.resolve(candidate);
    for (let depth = 0; depth < 5; depth += 1) {
        if (node_fs_1.default.existsSync(node_path_1.default.join(current, "workflows")) && node_fs_1.default.existsSync(node_path_1.default.join(current, "package.json"))) {
            return current;
        }
        current = node_path_1.default.dirname(current);
    }
    throw new Error("Run cw.js from the cool-workflow plugin directory");
}
function renderWorkflowTemplate(id, title) {
    return `module.exports = ({ workflow, phase, agent, artifact }) =>\n  workflow({\n    id: ${JSON.stringify(id)},\n    title: ${JSON.stringify(title)},\n    summary: "Describe what this workflow does.",\n    limits: {\n      maxAgents: 8,\n      maxConcurrentAgents: 4\n    },\n    inputs: [\n      { name: "question", required: true }\n    ],\n    phases: [\n      phase("Map", [\n        agent("map:context", "Map the task context, constraints, and evidence needed for {{question}}.")\n      ]),\n      phase("Assess", [\n        agent("assess:risks", "Assess risks, tradeoffs, and unknowns for {{question}}.")\n      ]),\n      phase("Synthesize", [\n        artifact("synthesis:report", "Synthesize the final answer for {{question}}.", { requiresEvidence: true })\n      ])\n    ]\n  });\n`;
}
function titleize(value) {
    return value
        .split("-")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
