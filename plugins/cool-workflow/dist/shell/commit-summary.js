"use strict";
// shell/commit-summary.ts — `cw commit summary` / `cw_commit_summary`.
//
// `summarizeOperatorCommits` + `formatCommitRow`, plus the
// `commitSummaryCli` thin adapter both front doors call. Impure: reads
// run state from disk.
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeOperatorCommits = summarizeOperatorCommits;
exports.commitSummaryCli = commitSummaryCli;
exports.formatCommitSummaryText = formatCommitSummaryText;
const cli_args_1 = require("../core/util/cli-args");
const run_store_1 = require("./run-store");
const collate_1 = require("../core/util/collate");
function formatCommitRow(commit) {
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
function summarizeOperatorCommits(run) {
    const commits = [...(run.commits || [])].sort((left, right) => (0, collate_1.stableCompare)(left.createdAt, right.createdAt) || (0, collate_1.stableCompare)(left.id, right.id));
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
function commitSummaryCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)((0, cli_args_1.requireArg)(args.runId, "run id"), (0, cli_args_1.cwdArg)(args));
    return summarizeOperatorCommits(run);
}
/** `cw commit summary <run>` human text: a `Commits` rollup with the
 *  verifier-gated / checkpoint counts and the latest commit. */
function formatCommitSummaryText(summary) {
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
