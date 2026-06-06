import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { StateCommit, WorkflowRun } from "./types";
import { writeJson } from "./state";
import { createDefaultPipelineContract, DEFAULT_PIPELINE_CONTRACT_ID } from "./pipeline-contract";
import { appendRunNode, createStateNode, upsertRunContract } from "./state-node";
import { createPipelineRunner } from "./pipeline-runner";

export function commitState(run: WorkflowRun, reason: string): StateCommit {
  fs.mkdirSync(run.paths.commitsDir, { recursive: true });
  const id = createCommitId();
  const snapshotPath = path.join(run.paths.commitsDir, `${id}.json`);
  const commit: StateCommit = {
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
  if (commitNodeId) commit.stateNodeId = commitNodeId;
  writeJson(snapshotPath, {
    commit,
    run
  });
  run.commits.push(commit);
  return commit;
}

function recordCommitNode(run: WorkflowRun, commit: StateCommit, reason: string): string | undefined {
  const contract = upsertRunContract(run, createDefaultPipelineContract());
  const taskId = reason.startsWith("result:") ? reason.slice("result:".length) : "";
  const task = taskId ? run.tasks.find((candidate) => candidate.id === taskId) : undefined;
  const verifierNode = task?.verifierNodeId
    ? run.nodes?.find((candidate) => candidate.id === task.verifierNodeId)
    : undefined;

  if (verifierNode) {
    const commitResult = createPipelineRunner({ contractId: contract.id, persist: false }).runPipelineStage(
      run,
      "commit",
      verifierNode.id,
      {
        outputNodeId: `${run.id}:commit:${commit.id}`,
        outputStatus: "committed",
        loopStage: "checkpoint",
        outputs: { snapshotPath: commit.snapshotPath, gitHead: commit.gitHead },
        artifacts: [{ id: "snapshot", kind: "json", path: commit.snapshotPath }],
        evidence: verifierNode.evidence,
        metadata: { reason, commitId: commit.id, verifierNodeId: verifierNode.id }
      }
    );
    return commitResult.outputNodeId;
  }

  const checkpointNode = createStateNode({
    id: `${run.id}:checkpoint:${commit.id}`,
    kind: "commit",
    status: "completed",
    loopStage: "checkpoint",
    inputs: { reason, commitId: commit.id },
    outputs: { snapshotPath: commit.snapshotPath, gitHead: commit.gitHead },
    artifacts: [{ id: "snapshot", kind: "json", path: commit.snapshotPath }],
    contractId: DEFAULT_PIPELINE_CONTRACT_ID,
    metadata: { verifierGated: false }
  });
  appendRunNode(run, checkpointNode);
  return checkpointNode.id;
}

function createCommitId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `state-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function readGitHead(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}
