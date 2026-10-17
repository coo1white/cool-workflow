// shell/commit-summary.ts — `cw commit summary` / `cw_commit_summary`.
//
// `summarizeOperatorCommits` + `formatCommitRow`, plus the
// `commitSummaryCli` thin adapter both front doors call. Impure: reads
// run state from disk.

import { cwdArg, requireArg } from "../core/util/cli-args.js";
import { WorkflowRun, StateCommit } from "../core/state/types.js";
import { loadRunFromCwd } from "./run-store.js";
import { stableCompare } from "../core/util/collate.js";

export interface OperatorCommitSummary {
  total: number;
  verifierGated: number;
  checkpoints: number;
  latest?: OperatorCommitRow;
  commits: OperatorCommitRow[];
}

interface OperatorCommitRow {
  id: string;
  kind: "verifier-gated" | "checkpoint";
  reason: string;
  createdAt: string;
  snapshotPath: string;
  stateNodeId?: string;
  verifierNodeId?: string;
  candidateId?: string;
  selectionId?: string;
  evidenceCount: number;
}

function formatCommitRow(commit: StateCommit): OperatorCommitRow {
  return {
    id: commit.id,
    kind: commit.verifierGated ? "verifier-gated" : "checkpoint",
    reason: commit.reason,
    createdAt: commit.createdAt,
    snapshotPath: commit.snapshotPath,
    stateNodeId: commit.stateNodeId,
    verifierNodeId: commit.verifierNodeId,
    candidateId: commit.candidateId,
    selectionId: commit.selectionId,
    evidenceCount: commit.evidence?.length || 0,
  };
}

export function summarizeOperatorCommits(run: WorkflowRun): OperatorCommitSummary {
  const commits = [...(run.commits || [])].sort(
    (left, right) => stableCompare(left.createdAt, right.createdAt) || stableCompare(left.id, right.id)
  );
  const rows = commits.map(formatCommitRow);
  return {
    total: rows.length,
    verifierGated: rows.filter((commit) => commit.kind === "verifier-gated").length,
    checkpoints: rows.filter((commit) => commit.kind === "checkpoint").length,
    latest: rows.at(-1),
    commits: rows,
  };
}

/** Thin adapter both front doors call: summarizeOperatorCommits(loadRun(runId)). */
export function commitSummaryCli(args: Record<string, unknown>): OperatorCommitSummary {
  const run = loadRunFromCwd(requireArg(args.runId, "run id"), cwdArg(args));
  return summarizeOperatorCommits(run);
}

/** `cw commit summary <run>` human text: a `Commits` rollup with the
 *  verifier-gated / checkpoint counts and the latest commit. */
export function formatCommitSummaryText(summary: OperatorCommitSummary): string {
  const lines = [
    "Commits",
    `  total=${summary.total}; verifier-gated=${summary.verifierGated}; checkpoints=${summary.checkpoints}`,
    `  latest=${summary.latest ? `${summary.latest.id} (${summary.latest.kind}) ${summary.latest.snapshotPath}` : "none"}`,
  ];
  for (const commit of summary.commits.slice(-8)) {
    lines.push(`  ${commit.id}: ${commit.kind}, reason=${commit.reason}`);
  }
  return lines.join("\n");
}
