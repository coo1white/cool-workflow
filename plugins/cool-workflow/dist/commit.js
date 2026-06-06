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
const pipeline_contract_1 = require("./pipeline-contract");
const state_node_1 = require("./state-node");
const pipeline_runner_1 = require("./pipeline-runner");
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
    const commitNodeId = recordCommitNode(run, commit, reason);
    if (commitNodeId)
        commit.stateNodeId = commitNodeId;
    (0, state_1.writeJson)(snapshotPath, {
        commit,
        run
    });
    run.commits.push(commit);
    return commit;
}
function recordCommitNode(run, commit, reason) {
    const contract = (0, state_node_1.upsertRunContract)(run, (0, pipeline_contract_1.createDefaultPipelineContract)());
    const taskId = reason.startsWith("result:") ? reason.slice("result:".length) : "";
    const task = taskId ? run.tasks.find((candidate) => candidate.id === taskId) : undefined;
    const verifierNode = task?.verifierNodeId
        ? run.nodes?.find((candidate) => candidate.id === task.verifierNodeId)
        : undefined;
    if (verifierNode) {
        const commitResult = (0, pipeline_runner_1.createPipelineRunner)({ contractId: contract.id, persist: false }).runPipelineStage(run, "commit", verifierNode.id, {
            outputNodeId: `${run.id}:commit:${commit.id}`,
            outputStatus: "committed",
            loopStage: "checkpoint",
            outputs: { snapshotPath: commit.snapshotPath, gitHead: commit.gitHead },
            artifacts: [{ id: "snapshot", kind: "json", path: commit.snapshotPath }],
            evidence: verifierNode.evidence,
            metadata: { reason, commitId: commit.id, verifierNodeId: verifierNode.id }
        });
        return commitResult.outputNodeId;
    }
    const checkpointNode = (0, state_node_1.createStateNode)({
        id: `${run.id}:checkpoint:${commit.id}`,
        kind: "commit",
        status: "completed",
        loopStage: "checkpoint",
        inputs: { reason, commitId: commit.id },
        outputs: { snapshotPath: commit.snapshotPath, gitHead: commit.gitHead },
        artifacts: [{ id: "snapshot", kind: "json", path: commit.snapshotPath }],
        contractId: pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: { verifierGated: false }
    });
    (0, state_node_1.appendRunNode)(run, checkpointNode);
    return checkpointNode.id;
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
