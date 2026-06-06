"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.commitState = commitState;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const state_1 = require("./state");
function commitState(run, reason) {
    node_fs_1.default.mkdirSync(run.paths.commitsDir, { recursive: true });
    const id = createCommitId();
    const snapshotPath = node_path_1.default.join(run.paths.commitsDir, `${id}.json`);
    const commit = {
        id,
        createdAt: new Date().toISOString(),
        reason,
        loopStage: run.loopStage,
        statePath: run.paths.state,
        reportPath: run.paths.report,
        snapshotPath,
        gitHead: readGitHead(run.cwd)
    };
    (0, state_1.writeJson)(snapshotPath, {
        commit,
        run
    });
    run.commits.push(commit);
    return commit;
}
function createCommitId() {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    return `state-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}
function readGitHead(cwd) {
    try {
        return (0, node_child_process_1.execFileSync)("git", ["rev-parse", "HEAD"], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        }).trim();
    }
    catch {
        return undefined;
    }
}
