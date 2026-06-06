import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { StateCommit, WorkflowRun } from "./types";
import { writeJson } from "./state";

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
  writeJson(snapshotPath, {
    commit,
    run
  });
  run.commits.push(commit);
  return commit;
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
