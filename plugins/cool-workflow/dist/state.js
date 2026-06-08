"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURRENT_RUN_STATE_SCHEMA_VERSION = void 0;
exports.createRunPaths = createRunPaths;
exports.ensureRunDirs = ensureRunDirs;
exports.loadRunFromCwd = loadRunFromCwd;
exports.loadRunStateFile = loadRunStateFile;
exports.checkRunStateFile = checkRunStateFile;
exports.migrateRunStateFile = migrateRunStateFile;
exports.saveCheckpoint = saveCheckpoint;
exports.readJson = readJson;
exports.writeJson = writeJson;
exports.safeFileName = safeFileName;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_migrations_1 = require("./state-migrations");
const version_1 = require("./version");
Object.defineProperty(exports, "CURRENT_RUN_STATE_SCHEMA_VERSION", { enumerable: true, get: function () { return version_1.CURRENT_RUN_STATE_SCHEMA_VERSION; } });
function createRunPaths(runDir) {
    return {
        runDir,
        state: node_path_1.default.join(runDir, "state.json"),
        report: node_path_1.default.join(runDir, "report.md"),
        tasksDir: node_path_1.default.join(runDir, "tasks"),
        resultsDir: node_path_1.default.join(runDir, "results"),
        dispatchesDir: node_path_1.default.join(runDir, "dispatches"),
        artifactsDir: node_path_1.default.join(runDir, "artifacts"),
        commitsDir: node_path_1.default.join(runDir, "commits"),
        stateNodesDir: node_path_1.default.join(runDir, "nodes"),
        feedbackDir: node_path_1.default.join(runDir, "feedback"),
        auditDir: node_path_1.default.join(runDir, "audit"),
        workersDir: node_path_1.default.join(runDir, "workers"),
        candidatesDir: node_path_1.default.join(runDir, "candidates"),
        multiAgentDir: node_path_1.default.join(runDir, "multi-agent"),
        blackboardDir: node_path_1.default.join(runDir, "blackboard"),
        topologiesDir: node_path_1.default.join(runDir, "topologies")
    };
}
function ensureRunDirs(paths) {
    for (const dir of [
        paths.runDir,
        paths.tasksDir,
        paths.resultsDir,
        paths.dispatchesDir,
        paths.artifactsDir,
        paths.commitsDir,
        paths.stateNodesDir,
        paths.feedbackDir,
        paths.auditDir || node_path_1.default.join(paths.runDir, "audit"),
        paths.workersDir || node_path_1.default.join(paths.runDir, "workers"),
        paths.candidatesDir || node_path_1.default.join(paths.runDir, "candidates"),
        paths.multiAgentDir || node_path_1.default.join(paths.runDir, "multi-agent"),
        paths.blackboardDir || node_path_1.default.join(paths.runDir, "blackboard"),
        paths.topologiesDir || node_path_1.default.join(paths.runDir, "topologies")
    ]) {
        node_fs_1.default.mkdirSync(dir, { recursive: true });
    }
}
function loadRunFromCwd(runId, cwd = process.cwd()) {
    if (!runId)
        throw new Error("Missing run id");
    const statePath = node_path_1.default.join(cwd, ".cw", "runs", runId, "state.json");
    const result = loadRunStateFile(statePath, { dryRun: true });
    if (result.report.status === "unsupported") {
        throw new Error(`Unsupported CW run state: ${result.report.errors.join("; ")}`);
    }
    return result.run;
}
function loadRunStateFile(statePath, options = {}) {
    const result = (0, state_migrations_1.migrateRunState)(readJson(statePath), {
        statePath,
        dryRun: options.dryRun === undefined ? true : options.dryRun
    });
    if (result.report.status === "unsupported")
        return result;
    return result;
}
function checkRunStateFile(statePath) {
    return loadRunStateFile(statePath, { dryRun: true });
}
function migrateRunStateFile(statePath, options = {}) {
    const result = loadRunStateFile(statePath, { dryRun: !options.write });
    if (result.report.status !== "unsupported" && options.write && result.report.writeRequired) {
        writeJson(statePath, result.run);
    }
    return result;
}
function saveCheckpoint(run) {
    run.updatedAt = new Date().toISOString();
    writeJson(run.paths.state, run);
}
function readJson(file) {
    if (!node_fs_1.default.existsSync(file))
        throw new Error(`File not found: ${file}`);
    try {
        return JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON in ${file}: ${message}`);
    }
}
function writeJson(file, value) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    node_fs_1.default.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function safeFileName(value) {
    return String(value).replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
