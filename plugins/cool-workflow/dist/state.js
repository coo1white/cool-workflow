"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRunPaths = createRunPaths;
exports.ensureRunDirs = ensureRunDirs;
exports.loadRunFromCwd = loadRunFromCwd;
exports.saveCheckpoint = saveCheckpoint;
exports.readJson = readJson;
exports.writeJson = writeJson;
exports.safeFileName = safeFileName;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
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
        workersDir: node_path_1.default.join(runDir, "workers"),
        candidatesDir: node_path_1.default.join(runDir, "candidates")
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
        paths.workersDir || node_path_1.default.join(paths.runDir, "workers"),
        paths.candidatesDir || node_path_1.default.join(paths.runDir, "candidates")
    ]) {
        node_fs_1.default.mkdirSync(dir, { recursive: true });
    }
}
function loadRunFromCwd(runId, cwd = process.cwd()) {
    if (!runId)
        throw new Error("Missing run id");
    const run = readJson(node_path_1.default.join(cwd, ".cw", "runs", runId, "state.json"));
    run.paths.stateNodesDir = run.paths.stateNodesDir || node_path_1.default.join(run.paths.runDir, "nodes");
    run.paths.feedbackDir = run.paths.feedbackDir || node_path_1.default.join(run.paths.runDir, "feedback");
    run.paths.workersDir = run.paths.workersDir || node_path_1.default.join(run.paths.runDir, "workers");
    run.paths.candidatesDir = run.paths.candidatesDir || node_path_1.default.join(run.paths.runDir, "candidates");
    run.nodes = run.nodes || [];
    run.contracts = run.contracts || [];
    run.feedback = run.feedback || [];
    run.workers = run.workers || [];
    run.sandboxProfiles = run.sandboxProfiles || [];
    run.candidates = run.candidates || [];
    run.candidateSelections = run.candidateSelections || [];
    return run;
}
function saveCheckpoint(run) {
    run.updatedAt = new Date().toISOString();
    writeJson(run.paths.state, run);
}
function readJson(file) {
    if (!node_fs_1.default.existsSync(file))
        throw new Error(`File not found: ${file}`);
    return JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
}
function writeJson(file, value) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    node_fs_1.default.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function safeFileName(value) {
    return String(value).replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
