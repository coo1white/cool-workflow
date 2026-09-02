// shell/commit-summary.ts — `cw commit summary` / `cw_commit_summary`.
//
// GAP #26 port: v2 dropped the CLI binding + shell body for commit.summary,
// keeping only the MCP tool row. This restores the old build's
// `summarizeOperatorCommits` + `formatCommitRow` byte-for-byte, plus the `commitSummaryCli`
// thin adapter both front doors call (mirrors feedbackSummaryCli /
// candidateSummaryCli shape). Impure: reads run state from disk.

import * as path from "node:path";
import { WorkflowRun, StateCommit } from "../core/state/types";
import { loadRunFromCwd } from "./run-store";
import { stableCompare } from "../core/util/collate";

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

/** Byte-exact port of the old build's `summarizeOperatorCommits`. */
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

function req(value: unknown, label: string): string {
  const s = value === undefined || value === null ? "" : String(value);
  if (!s) throw new Error(`Missing ${label}`);
  return s;
}

function cwdFor(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}

/** Thin adapter both front doors call (mirrors the old build's orchestrator
 *  `summarizeCommitRecords(runId)` = `summarizeOperatorCommits(loadRun(runId))`). */
export function commitSummaryCli(args: Record<string, unknown>): OperatorCommitSummary {
  const run = loadRunFromCwd(req(args.runId, "run id"), cwdFor(args));
  return summarizeOperatorCommits(run);
}

/** `cw commit summary <run>` human text — port of the old build's
 *  formatCommitPanel (operator-ux/format.ts): a `Commits` rollup with the
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
