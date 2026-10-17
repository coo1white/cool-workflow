// shell/ledger-cli.ts — CLI/MCP-reachable bodies for `cw ledger
// propose|review|verify|apply|list`.
//
// The `cw ledger` argv shape, calling core/trust/ledger.ts's pure
// functions + shell/ledger-io.ts's directory reads. Impure (fs: stdin/
// file reads for verify/apply, directory scans for list) — this is the
// shell layer the capability-table's CLI/MCP handlers delegate to.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw ledger`", "Edge cases".
import * as fs from "node:fs";
import { applyLedgerProposal, buildLedgerProposal, buildLedgerReview, verifyLedgerEntry, } from "../core/trust/ledger.js";
import { listLedgerEntries, unionLedgerEntries } from "./ledger-io.js";
import { optionalArg } from "../core/util/cli-args.js";
/** Coerce a repeatable/comma-joined list option to a clean string[]. */
function listOption(value) {
    const parts = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    return parts.map((p) => String(p).trim()).filter(Boolean);
}
function required(value, label) {
    if (!value)
        throw new Error(`${label} is required`);
    return value;
}
function nowIso() {
    return new Date().toISOString();
}
export function ledgerProposeCli(options) {
    return buildLedgerProposal({
        from: required(optionalArg(options.from), "--from <agent/repo>"),
        to: required(optionalArg(options.to), "--to <agent/repo>"),
        title: required(optionalArg(options.title), "--title <text>"),
        rationale: required(optionalArg(options.rationale), "--rationale <text>"),
        targetFiles: listOption(options.files),
        // Do NOT trim the diff: it is a unified patch (payload, not a
        // label), and trimming strips the trailing newline `git apply`
        // requires. Presence is detected with a trimmed test, but the bytes
        // are passed through verbatim.
        suggestedDiff: typeof options.diff === "string" && options.diff.trim() ? options.diff : undefined,
        createdAt: nowIso(),
    });
}
/** MCP-facing `cw_ledger_propose`: `files` is a comma string; `diff` is
 *  passed through as-is (undefined only when the arg itself is absent),
 *  a slightly looser shape than the CLI handler's flag-labeled
 *  requireds. */
export function ledgerProposeMcp(args) {
    return buildLedgerProposal({
        from: String(args.from || ""),
        to: String(args.to || ""),
        title: String(args.title || ""),
        rationale: String(args.rationale || ""),
        targetFiles: String(args.files || "").split(",").map((f) => f.trim()).filter(Boolean),
        suggestedDiff: args.diff === undefined ? undefined : String(args.diff),
        createdAt: nowIso(),
    });
}
export function ledgerReviewCli(options) {
    const verdictRaw = required(optionalArg(options.verdict), "--verdict <approved|rejected>").toUpperCase();
    if (verdictRaw !== "APPROVED" && verdictRaw !== "REJECTED") {
        throw new Error('--verdict must be "approved" or "rejected".');
    }
    return buildLedgerReview({
        from: required(optionalArg(options.from), "--from <agent/repo>"),
        to: required(optionalArg(options.to), "--to <agent/repo>"),
        target: required(optionalArg(options.target), "--target <proposal-id|pr-ref>"),
        verdict: verdictRaw,
        findings: listOption(options.findings),
        createdAt: nowIso(),
    });
}
/** MCP-facing `cw_ledger_review`: same verdict check, but WITHOUT the
 *  `--verdict` CLI-flag framing in the error message (a separate call
 *  site from the CLI handler's own message). */
export function ledgerReviewMcp(args) {
    const verdict = String(args.verdict || "").toUpperCase();
    if (verdict !== "APPROVED" && verdict !== "REJECTED") {
        throw new Error('verdict must be "approved" or "rejected".');
    }
    return buildLedgerReview({
        from: String(args.from || ""),
        to: String(args.to || ""),
        target: String(args.target || ""),
        verdict: verdict,
        findings: String(args.findings || "").split(",").map((f) => f.trim()).filter(Boolean),
        createdAt: nowIso(),
    });
}
const BAD_JSON_VERIFY = {
    ok: false,
    id: null,
    kind: null,
    checks: [{ name: "parse", pass: false, code: "ledger-bad-json" }],
    failedChecks: [{ name: "parse", code: "ledger-bad-json" }],
};
const BAD_JSON_APPLY = {
    ok: false,
    id: null,
    kind: null,
    diff: null,
    failedChecks: [{ name: "parse", code: "ledger-bad-json" }],
};
function readLedgerEntryInput(options) {
    const file = optionalArg(options.file);
    try {
        // --file <path>, else read the entry from stdin (fd 0).
        return fs.readFileSync(file || 0, "utf8");
    }
    catch (error) {
        throw new Error(`Cannot read ledger entry${file ? ` from ${file}` : " from stdin"}: ${error.message}`);
    }
}
export function ledgerVerifyCli(options) {
    let text;
    try {
        text = readLedgerEntryInput(options);
    }
    catch (error) {
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return BAD_JSON_VERIFY;
    }
    return verifyLedgerEntry(parsed);
}
export function ledgerApplyCli(options) {
    const text = readLedgerEntryInput(options);
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return BAD_JSON_APPLY;
    }
    return applyLedgerProposal(parsed);
}
export function ledgerListCli(options) {
    // `--ledger-dir` is the preferred flag: the global CLI front door
    // (cli/entry.ts) treats `--dir` as an alias of `--repo` for EVERY
    // command, so `cw ledger list --dir X` made one flag mean two things.
    // `--dir` keeps working unchanged as the legacy spelling; when both are
    // given, `--ledger-dir` wins. Repeated flags become an array via
    // parseArgv's append behavior, same as `--dir` always has.
    const input = options["ledger-dir"] ?? options.dir;
    const dirs = Array.isArray(input) ? input.map(String).filter(Boolean) : [];
    if (dirs.length > 1)
        return unionLedgerEntries(dirs);
    const dir = required(dirs[0] || optionalArg(input), "--ledger-dir <ledger-directory>");
    return listLedgerEntries(dir);
}
/** MCP-facing verify/apply take the entry OBJECT directly (not a file/
 *  stdin path). */
export function ledgerVerifyEntry(entry) {
    return verifyLedgerEntry(entry);
}
export function ledgerApplyEntry(entry) {
    return applyLedgerProposal(entry);
}
export function ledgerListMcp(args) {
    const dirsArg = args.dirs;
    const dirs = Array.isArray(dirsArg) ? dirsArg.map(String).filter(Boolean) : [];
    if (dirs.length > 1)
        return unionLedgerEntries(dirs);
    const dir = required(dirs[0] || optionalArg(args.dir), "dir");
    return listLedgerEntries(dir);
}
