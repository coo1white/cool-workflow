"use strict";
// shell/ledger-cli.ts — CLI/MCP-reachable bodies for `cw ledger
// propose|review|verify|apply|list`.
//
// MILESTONE 8. Byte-exact port of the old build's src/cli/handlers/
// ledger.ts argv shape, now calling core/trust/ledger.ts's pure
// functions + shell/ledger-io.ts's directory reads. Impure (fs: stdin/
// file reads for verify/apply, directory scans for list) — this is the
// shell layer the capability-table's CLI/MCP handlers delegate to.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw ledger`", "Edge cases".
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
exports.ledgerProposeCli = ledgerProposeCli;
exports.ledgerProposeMcp = ledgerProposeMcp;
exports.ledgerReviewCli = ledgerReviewCli;
exports.ledgerReviewMcp = ledgerReviewMcp;
exports.ledgerVerifyCli = ledgerVerifyCli;
exports.ledgerApplyCli = ledgerApplyCli;
exports.ledgerListCli = ledgerListCli;
exports.ledgerVerifyEntry = ledgerVerifyEntry;
exports.ledgerApplyEntry = ledgerApplyEntry;
exports.ledgerListMcp = ledgerListMcp;
const fs = __importStar(require("node:fs"));
const ledger_1 = require("../core/trust/ledger");
const ledger_io_1 = require("./ledger-io");
/** Coerce a repeatable/comma-joined list option to a clean string[]. */
function listOption(value) {
    const parts = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    return parts.map((p) => String(p).trim()).filter(Boolean);
}
function stringOption(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function required(value, label) {
    if (!value)
        throw new Error(`${label} is required`);
    return value;
}
function nowIso() {
    return new Date().toISOString();
}
function ledgerProposeCli(options) {
    return (0, ledger_1.buildLedgerProposal)({
        from: required(stringOption(options.from), "--from <agent/repo>"),
        to: required(stringOption(options.to), "--to <agent/repo>"),
        title: required(stringOption(options.title), "--title <text>"),
        rationale: required(stringOption(options.rationale), "--rationale <text>"),
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
 *  requireds (byte-exact to the old build's src/mcp/tool-call.ts). */
function ledgerProposeMcp(args) {
    return (0, ledger_1.buildLedgerProposal)({
        from: String(args.from || ""),
        to: String(args.to || ""),
        title: String(args.title || ""),
        rationale: String(args.rationale || ""),
        targetFiles: String(args.files || "").split(",").map((f) => f.trim()).filter(Boolean),
        suggestedDiff: args.diff === undefined ? undefined : String(args.diff),
        createdAt: nowIso(),
    });
}
function ledgerReviewCli(options) {
    const verdictRaw = required(stringOption(options.verdict), "--verdict <approved|rejected>").toUpperCase();
    if (verdictRaw !== "APPROVED" && verdictRaw !== "REJECTED") {
        throw new Error('--verdict must be "approved" or "rejected".');
    }
    return (0, ledger_1.buildLedgerReview)({
        from: required(stringOption(options.from), "--from <agent/repo>"),
        to: required(stringOption(options.to), "--to <agent/repo>"),
        target: required(stringOption(options.target), "--target <proposal-id|pr-ref>"),
        verdict: verdictRaw,
        findings: listOption(options.findings),
        createdAt: nowIso(),
    });
}
/** MCP-facing `cw_ledger_review`: same verdict check, but WITHOUT the
 *  `--verdict` CLI-flag framing in the error message (byte-exact to the
 *  old build's src/mcp/tool-call.ts, a separate call site from the CLI
 *  handler's own message). */
function ledgerReviewMcp(args) {
    const verdict = String(args.verdict || "").toUpperCase();
    if (verdict !== "APPROVED" && verdict !== "REJECTED") {
        throw new Error('verdict must be "approved" or "rejected".');
    }
    return (0, ledger_1.buildLedgerReview)({
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
    const file = stringOption(options.file);
    try {
        // --file <path>, else read the entry from stdin (fd 0).
        return fs.readFileSync(file || 0, "utf8");
    }
    catch (error) {
        throw new Error(`Cannot read ledger entry${file ? ` from ${file}` : " from stdin"}: ${error.message}`);
    }
}
function ledgerVerifyCli(options) {
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
    return (0, ledger_1.verifyLedgerEntry)(parsed);
}
function ledgerApplyCli(options) {
    const text = readLedgerEntryInput(options);
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return BAD_JSON_APPLY;
    }
    return (0, ledger_1.applyLedgerProposal)(parsed);
}
function ledgerListCli(options) {
    // `--ledger-dir` is the preferred flag: the global CLI front door
    // (cli/entry.ts) treats `--dir` as an alias of `--repo` for EVERY
    // command, so `cw ledger list --dir X` made one flag mean two things.
    // `--dir` keeps working unchanged as the legacy spelling; when both are
    // given, `--ledger-dir` wins. Repeated flags become an array via
    // parseArgv's append behavior, same as `--dir` always has.
    const input = options["ledger-dir"] ?? options.dir;
    const dirs = Array.isArray(input) ? input.map(String).filter(Boolean) : [];
    if (dirs.length > 1)
        return (0, ledger_io_1.unionLedgerEntries)(dirs);
    const dir = required(dirs[0] || stringOption(input), "--ledger-dir <ledger-directory>");
    return (0, ledger_io_1.listLedgerEntries)(dir);
}
/** MCP-facing verify/apply take the entry OBJECT directly (not a file/
 *  stdin path). */
function ledgerVerifyEntry(entry) {
    return (0, ledger_1.verifyLedgerEntry)(entry);
}
function ledgerApplyEntry(entry) {
    return (0, ledger_1.applyLedgerProposal)(entry);
}
function ledgerListMcp(args) {
    const dirsArg = args.dirs;
    const dirs = Array.isArray(dirsArg) ? dirsArg.map(String).filter(Boolean) : [];
    if (dirs.length > 1)
        return (0, ledger_io_1.unionLedgerEntries)(dirs);
    const dir = required(dirs[0] || stringOption(args.dir), "dir");
    return (0, ledger_io_1.listLedgerEntries)(dir);
}
