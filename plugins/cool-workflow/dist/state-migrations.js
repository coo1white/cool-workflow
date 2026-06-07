"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUN_STATE_MIGRATIONS = void 0;
exports.migrateRunState = migrateRunState;
const node_path_1 = __importDefault(require("node:path"));
const version_1 = require("./version");
exports.RUN_STATE_MIGRATIONS = [
    {
        from: version_1.LEGACY_RUN_STATE_SCHEMA_VERSION,
        to: version_1.CURRENT_RUN_STATE_SCHEMA_VERSION,
        description: "Mark legacy run state without schemaVersion as run-state schema 1.",
        migrate(state, context) {
            setDefault(state, "schemaVersion", version_1.CURRENT_RUN_STATE_SCHEMA_VERSION, context, "legacy run state did not declare schemaVersion");
        }
    }
];
function migrateRunState(input, options = {}) {
    const report = {
        status: "current",
        statePath: options.statePath,
        detectedSchemaVersion: detectSchemaVersion(input),
        currentSchemaVersion: version_1.CURRENT_RUN_STATE_SCHEMA_VERSION,
        supportedSchemaVersions: {
            min: version_1.MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION,
            max: version_1.CURRENT_RUN_STATE_SCHEMA_VERSION
        },
        dryRun: Boolean(options.dryRun),
        writeRequired: false,
        changes: [],
        warnings: [],
        errors: []
    };
    if (!isRecord(input)) {
        report.status = "unsupported";
        report.errors.push("Run state must be a JSON object.");
        return { run: {}, report };
    }
    if (report.detectedSchemaVersion < version_1.MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION) {
        report.status = "unsupported";
        report.errors.push(`Unsupported run-state schemaVersion ${report.detectedSchemaVersion}.`);
        return { run: clone(input), report };
    }
    if (report.detectedSchemaVersion > version_1.CURRENT_RUN_STATE_SCHEMA_VERSION) {
        report.status = "unsupported";
        report.errors.push(`Run state schemaVersion ${report.detectedSchemaVersion} is newer than this CW runtime (${version_1.CURRENT_RUN_STATE_SCHEMA_VERSION}).`);
        return { run: clone(input), report };
    }
    const state = clone(input);
    const context = { statePath: options.statePath, changes: report.changes };
    let schemaVersion = report.detectedSchemaVersion;
    while (schemaVersion < version_1.CURRENT_RUN_STATE_SCHEMA_VERSION) {
        const step = exports.RUN_STATE_MIGRATIONS.find((candidate) => candidate.from === schemaVersion);
        if (!step) {
            report.status = "unsupported";
            report.errors.push(`No migration step from run-state schemaVersion ${schemaVersion}.`);
            return { run: state, report };
        }
        step.migrate(state, context);
        schemaVersion = step.to;
    }
    normalizeRunState(state, context);
    validateMigratedRunState(state, report);
    report.writeRequired = report.changes.length > 0;
    if (report.errors.length > 0)
        report.status = "unsupported";
    else if (report.detectedSchemaVersion < version_1.CURRENT_RUN_STATE_SCHEMA_VERSION)
        report.status = "migrated";
    else if (report.changes.length > 0)
        report.status = "normalized";
    else
        report.status = "current";
    return { run: state, report };
}
function normalizeRunState(state, context) {
    const runDir = context.statePath ? node_path_1.default.dirname(context.statePath) : undefined;
    const id = stringValue(state.id) || (runDir ? node_path_1.default.basename(runDir) : "unknown-run");
    const now = new Date(0).toISOString();
    setDefault(state, "id", id, context, "run id is required");
    setDefault(state, "createdAt", stringValue(state.updatedAt) || now, context, "createdAt is required");
    setDefault(state, "updatedAt", stringValue(state.createdAt) || now, context, "updatedAt is required");
    setDefault(state, "cwd", runDir ? node_path_1.default.resolve(runDir, "..", "..", "..") : process.cwd(), context, "cwd is required");
    setDefault(state, "inputs", {}, context, "inputs must be present");
    setDefault(state, "loopStage", "interpret", context, "loopStage is required");
    if (!isLoopStage(state.loopStage))
        setValue(state, "loopStage", "interpret", context, "unsupported loopStage normalized");
    const workflow = ensureRecord(state, "workflow", context, "workflow metadata is required");
    setDefault(workflow, "id", stringValue(state.workflowId) || "unknown-workflow", context, "workflow.id is required", "workflow.id");
    setDefault(workflow, "title", titleize(String(workflow.id)), context, "workflow.title is required", "workflow.title");
    setDefault(workflow, "summary", "", context, "workflow.summary is required", "workflow.summary");
    setDefault(workflow, "limits", { maxAgents: 8, maxConcurrentAgents: 4 }, context, "workflow.limits is required", "workflow.limits");
    const paths = ensureRecord(state, "paths", context, "run paths are required");
    const baseRunDir = stringValue(paths.runDir) || runDir || node_path_1.default.join(String(state.cwd), ".cw", "runs", id);
    setDefault(paths, "runDir", baseRunDir, context, "paths.runDir is required", "paths.runDir");
    setDefault(paths, "state", node_path_1.default.join(baseRunDir, "state.json"), context, "paths.state is required", "paths.state");
    setDefault(paths, "report", node_path_1.default.join(baseRunDir, "report.md"), context, "paths.report is required", "paths.report");
    setDefault(paths, "tasksDir", node_path_1.default.join(baseRunDir, "tasks"), context, "paths.tasksDir is required", "paths.tasksDir");
    setDefault(paths, "resultsDir", node_path_1.default.join(baseRunDir, "results"), context, "paths.resultsDir is required", "paths.resultsDir");
    setDefault(paths, "dispatchesDir", node_path_1.default.join(baseRunDir, "dispatches"), context, "paths.dispatchesDir is required", "paths.dispatchesDir");
    setDefault(paths, "artifactsDir", node_path_1.default.join(baseRunDir, "artifacts"), context, "paths.artifactsDir is required", "paths.artifactsDir");
    setDefault(paths, "commitsDir", node_path_1.default.join(baseRunDir, "commits"), context, "paths.commitsDir is required", "paths.commitsDir");
    setDefault(paths, "stateNodesDir", node_path_1.default.join(baseRunDir, "nodes"), context, "paths.stateNodesDir is required", "paths.stateNodesDir");
    setDefault(paths, "feedbackDir", node_path_1.default.join(baseRunDir, "feedback"), context, "paths.feedbackDir is required", "paths.feedbackDir");
    setDefault(paths, "auditDir", node_path_1.default.join(baseRunDir, "audit"), context, "paths.auditDir is required", "paths.auditDir");
    setDefault(paths, "workersDir", node_path_1.default.join(baseRunDir, "workers"), context, "paths.workersDir is required", "paths.workersDir");
    setDefault(paths, "candidatesDir", node_path_1.default.join(baseRunDir, "candidates"), context, "paths.candidatesDir is required", "paths.candidatesDir");
    setDefault(paths, "multiAgentDir", node_path_1.default.join(baseRunDir, "multi-agent"), context, "paths.multiAgentDir is required", "paths.multiAgentDir");
    ensureArray(state, "tasks", context);
    ensureArray(state, "dispatches", context);
    ensureArray(state, "commits", context);
    ensureArray(state, "nodes", context);
    ensureArray(state, "contracts", context);
    ensureArray(state, "feedback", context);
    if (!isRecord(state.audit)) {
        setValue(state, "audit", {
            schemaVersion: 1,
            eventLogPath: node_path_1.default.join(String(paths.auditDir), "events.jsonl"),
            summaryPath: node_path_1.default.join(String(paths.auditDir), "summary.json"),
            indexPath: node_path_1.default.join(String(paths.auditDir), "index.json")
        }, context, "audit metadata is required");
    }
    ensureArray(state, "workers", context);
    ensureArray(state, "sandboxProfiles", context);
    ensureArray(state, "candidates", context);
    ensureArray(state, "candidateSelections", context);
    if (!isRecord(state.multiAgent)) {
        setValue(state, "multiAgent", {
            schemaVersion: 1,
            runs: [],
            roles: [],
            groups: [],
            memberships: [],
            fanouts: [],
            fanins: []
        }, context, "multiAgent state is required");
    }
    else {
        const multiAgent = state.multiAgent;
        setDefault(multiAgent, "schemaVersion", 1, context, "multiAgent.schemaVersion is required", "multiAgent.schemaVersion");
        for (const key of ["runs", "roles", "groups", "memberships", "fanouts", "fanins"]) {
            if (!Array.isArray(multiAgent[key])) {
                setValue(multiAgent, key, [], context, `multiAgent.${key} must be an array`, `multiAgent.${key}`);
            }
        }
    }
    if (!Array.isArray(state.phases)) {
        const phases = derivePhases(Array.isArray(state.tasks) ? state.tasks : []);
        setValue(state, "phases", phases, context, "phases derived from tasks");
    }
}
function validateMigratedRunState(state, report) {
    for (const key of ["schemaVersion", "id", "createdAt", "updatedAt", "cwd", "workflow", "inputs", "loopStage", "phases", "tasks", "dispatches", "commits", "paths"]) {
        if (!(key in state))
            report.errors.push(`Missing required run-state field: ${key}.`);
    }
    if (state.schemaVersion !== version_1.CURRENT_RUN_STATE_SCHEMA_VERSION) {
        report.errors.push(`Expected schemaVersion ${version_1.CURRENT_RUN_STATE_SCHEMA_VERSION}; found ${String(state.schemaVersion)}.`);
    }
    if (!isRecord(state.workflow))
        report.errors.push("workflow must be an object.");
    if (!isRecord(state.paths))
        report.errors.push("paths must be an object.");
    for (const key of ["phases", "tasks", "dispatches", "commits"]) {
        if (!Array.isArray(state[key]))
            report.errors.push(`${key} must be an array.`);
    }
    if (!isRecord(state.multiAgent))
        report.errors.push("multiAgent must be an object.");
}
function detectSchemaVersion(value) {
    if (!isRecord(value) || value.schemaVersion === undefined)
        return version_1.LEGACY_RUN_STATE_SCHEMA_VERSION;
    if (!Number.isInteger(value.schemaVersion))
        return Number.POSITIVE_INFINITY;
    return Number(value.schemaVersion);
}
function ensureRecord(state, key, context, reason) {
    if (isRecord(state[key]))
        return state[key];
    setValue(state, key, {}, context, reason);
    return state[key];
}
function ensureArray(state, key, context) {
    if (Array.isArray(state[key]))
        return;
    setValue(state, key, [], context, `${key} must be an array`);
}
function setDefault(state, key, value, context, reason, reportPath = key) {
    if (state[key] !== undefined)
        return;
    setValue(state, key, value, context, reason, reportPath);
}
function setValue(state, key, value, context, reason, reportPath = key) {
    const before = state[key];
    state[key] = value;
    context.changes.push({ path: reportPath, before, after: value, reason });
}
function derivePhases(tasks) {
    const byPhase = new Map();
    for (const task of tasks) {
        if (!isRecord(task))
            continue;
        const phase = stringValue(task.phase) || "Workflow";
        const taskId = stringValue(task.id);
        if (!taskId)
            continue;
        byPhase.set(phase, [...(byPhase.get(phase) || []), taskId]);
    }
    if (byPhase.size === 0)
        return [];
    return Array.from(byPhase.entries()).map(([name, taskIds]) => ({
        id: slugify(name),
        name,
        status: tasksForPhaseCompleted(tasks, taskIds) ? "completed" : "pending",
        taskIds
    }));
}
function tasksForPhaseCompleted(tasks, taskIds) {
    return taskIds.every((taskId) => {
        const task = tasks.find((candidate) => isRecord(candidate) && candidate.id === taskId);
        return isRecord(task) && task.status === "completed";
    });
}
function titleize(value) {
    return value
        .split(/[-_\s]+/g)
        .filter(Boolean)
        .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
        .join(" ") || "Workflow";
}
function slugify(value) {
    const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return slug || "workflow";
}
function stringValue(value) {
    return typeof value === "string" && value.trim() ? value : undefined;
}
function isLoopStage(value) {
    return ["interpret", "act", "observe", "adjust", "checkpoint"].includes(String(value));
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
