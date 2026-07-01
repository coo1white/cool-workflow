"use strict";
// `cw ledger propose|review|verify` — the cross-agent handoff ledger CLI surface.
// A proposing agent prints a proposal or a review verdict as a verifiable JSON
// entry; the receiving side verifies it fail-closed before acting. See
// docs/cross-agent-ledger.7.md and docs/designs/handoff-ledger.md.
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
exports.handleLedger = handleLedger;
const fs = __importStar(require("fs"));
const ledger_1 = require("../../ledger");
const io_1 = require("../io");
/** Coerce a repeatable/comma-joined list option to a clean string[]. */
function listOption(value) {
    const parts = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    return parts.map((p) => String(p).trim()).filter(Boolean);
}
function stringOption(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function nowIso() {
    return new Date().toISOString();
}
function handleLedger(args, _runner) {
    const [subcommand] = args.positionals;
    const opts = args.options;
    switch (subcommand) {
        case "propose": {
            const entry = (0, ledger_1.buildLedgerProposal)({
                from: (0, io_1.required)(stringOption(opts.from), "--from <agent/repo>"),
                to: (0, io_1.required)(stringOption(opts.to), "--to <agent/repo>"),
                title: (0, io_1.required)(stringOption(opts.title), "--title <text>"),
                rationale: (0, io_1.required)(stringOption(opts.rationale), "--rationale <text>"),
                targetFiles: listOption(opts.files),
                // Do NOT trim the diff: it is a unified patch (payload, not a label), and
                // trimming strips the trailing newline `git apply` requires — a trimmed
                // diff is a corrupt patch. Presence is detected with a trimmed test, but
                // the bytes are passed through verbatim (matching the MCP propose path).
                suggestedDiff: typeof opts.diff === "string" && opts.diff.trim() ? opts.diff : undefined,
                createdAt: nowIso()
            });
            (0, io_1.printJson)(entry);
            return;
        }
        case "review": {
            const verdictRaw = (0, io_1.required)(stringOption(opts.verdict), "--verdict <approved|rejected>").toUpperCase();
            if (verdictRaw !== "APPROVED" && verdictRaw !== "REJECTED") {
                throw new Error('--verdict must be "approved" or "rejected".');
            }
            const entry = (0, ledger_1.buildLedgerReview)({
                from: (0, io_1.required)(stringOption(opts.from), "--from <agent/repo>"),
                to: (0, io_1.required)(stringOption(opts.to), "--to <agent/repo>"),
                target: (0, io_1.required)(stringOption(opts.target), "--target <proposal-id|pr-ref>"),
                verdict: verdictRaw,
                findings: listOption(opts.findings),
                createdAt: nowIso()
            });
            (0, io_1.printJson)(entry);
            return;
        }
        case "verify": {
            const file = stringOption(opts.file);
            let text;
            try {
                // --file <path>, else read the entry from stdin (fd 0).
                text = fs.readFileSync(file || 0, "utf8");
            }
            catch (error) {
                throw new Error(`Cannot read ledger entry${file ? ` from ${file}` : " from stdin"}: ${error.message}`);
            }
            let parsed;
            try {
                parsed = JSON.parse(text);
            }
            catch {
                // A non-JSON input is itself a fail-closed refusal, not a crash.
                (0, io_1.printJson)({ ok: false, id: null, kind: null, checks: [{ name: "parse", pass: false, code: "ledger-bad-json" }], failedChecks: [{ name: "parse", code: "ledger-bad-json" }] });
                process.exitCode = 1;
                return;
            }
            const result = (0, ledger_1.verifyLedgerEntry)(parsed);
            (0, io_1.printJson)(result);
            // Fail-closed: a tampered/malformed entry exits non-zero so
            // `cw ledger verify <file> && open-pr` cannot proceed on a lie.
            if (!result.ok)
                process.exitCode = 1;
            return;
        }
        case "apply": {
            const file = stringOption(opts.file);
            let text;
            try {
                // --file <path>, else read the entry from stdin (fd 0), same as verify.
                text = fs.readFileSync(file || 0, "utf8");
            }
            catch (error) {
                throw new Error(`Cannot read ledger entry${file ? ` from ${file}` : " from stdin"}: ${error.message}`);
            }
            let parsed;
            try {
                parsed = JSON.parse(text);
            }
            catch {
                (0, io_1.printJson)({ ok: false, id: null, kind: null, diff: null, failedChecks: [{ name: "parse", code: "ledger-bad-json" }] });
                process.exitCode = 1;
                return;
            }
            const result = (0, ledger_1.applyLedgerProposal)(parsed);
            (0, io_1.printJson)(result);
            // Fail-closed: the diff only comes out (ok:true) when the proposal verifies,
            // so `cw ledger apply <file> | git apply` never feeds git an unverified patch.
            if (!result.ok)
                process.exitCode = 1;
            return;
        }
        case "list": {
            // `--dir` is repeatable: 2+ dirs union-verify multiple mirrors into one
            // inbox; a single --dir keeps the original single-directory output (POLA).
            const dirs = Array.isArray(opts.dir) ? opts.dir.map(String).filter(Boolean) : [];
            if (dirs.length > 1) {
                const union = (0, ledger_1.unionLedgerEntries)(dirs);
                (0, io_1.printJson)(union);
                if (!union.allOk)
                    process.exitCode = 1;
                return;
            }
            const dir = (0, io_1.required)(dirs[0] || stringOption(opts.dir), "--dir <ledger-directory>");
            const result = (0, ledger_1.listLedgerEntries)(dir);
            (0, io_1.printJson)(result);
            // Fail-closed inbox: refuse the whole batch if any entry does not verify.
            if (!result.allOk)
                process.exitCode = 1;
            return;
        }
        default:
            throw new Error("Usage: cw ledger propose|review|verify|apply|list [options]");
    }
}
