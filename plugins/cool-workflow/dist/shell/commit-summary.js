"use strict";
// shell/commit-summary.ts — `cw commit summary` / `cw_commit_summary`.
//
// GAP #26 port: v2 dropped the CLI binding + shell body for commit.summary,
// keeping only the MCP tool row. This restores the old build's
// `summarizeOperatorCommits` (src/operator-ux.ts:339-349) + `formatCommitRow`
// (src/operator-ux.ts:683-696) byte-for-byte, plus the `commitSummaryCli`
// thin adapter both front doors call (mirrors feedbackSummaryCli /
// candidateSummaryCli shape). Impure: reads run state from disk.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeOperatorCommits = summarizeOperatorCommits;
exports.commitSummaryCli = commitSummaryCli;
exports.formatCommitSummaryText = formatCommitSummaryText;
const path = __importStar(require("node:path"));
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
/** Byte-exact port of the old build's `summarizeOperatorCommits`
 *  (src/operator-ux.ts:339-349). */
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
function req(value, label) {
    const s = value === undefined || value === null ? "" : String(value);
    if (!s)
        throw new Error(`Missing ${label}`);
    return s;
}
function cwdFor(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}
/** Thin adapter both front doors call (mirrors the old build's orchestrator
 *  `summarizeCommitRecords(runId)` = `summarizeOperatorCommits(loadRun(runId))`). */
function commitSummaryCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), cwdFor(args));
    return summarizeOperatorCommits(run);
}
/** `cw commit summary <run>` human text — port of the old build's
 *  formatCommitPanel (operator-ux/format.ts): a `Commits` rollup with the
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
