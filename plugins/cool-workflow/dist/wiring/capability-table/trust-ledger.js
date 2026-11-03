// wiring/capability-table/trust-ledger.ts — CLI bindings for ledger.*,
// telemetry.verify, audit.verify, audit.head, demo.*, report.bundle/verify-bundle.
import { attachCliBinding, addCliOnlyCapability, REGISTRY_BY_CAPABILITY } from "./registry-core.js";
import { required, optionalArg } from "../../core/util/cli-args.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Ledger, telemetry, trust-audit and tamper/bundle demo CLI
// bindings: ledger propose|review|verify|apply|list, telemetry verify,
// audit verify, demo tamper|bundle, report bundle|verify-bundle. Handler
// BODIES live in shell/commands/ledger-cli.ts, shell/commands/telemetry-cli.ts, shell/
// audit-cli.ts, shell/commands/demo-cli.ts, shell/commands/report-cli.ts (impure — file/
// stdin reads, run-state loads, archive IO); this table only wires argv
// shape -> handler call, per cli/dispatch.ts's generic executor
// contract. `ledger` is intentionally absent from KNOWN_COMMANDS (see
// cli/parseargv.ts) even though dispatchTable now handles it as a real
// row — a known, preserved wart.
// ---------------------------------------------------------------------
// This file is required at startup for every command. Loading these shell
// modules only when their handler runs, not at import time, keeps that
// load cost out of commands that never touch ledger/telemetry/audit/demo/
// report.
function loadLedgerCli() {
    return require("../../shell/commands/ledger-cli.js");
}
function loadTelemetryCli() {
    return require("../../shell/commands/telemetry-cli.js");
}
function loadAuditCli() {
    return require("../../shell/commands/audit-cli.js");
}
function loadDemoCli() {
    return require("../../shell/commands/demo-cli.js");
}
function loadTelemetryDemo() {
    return require("../../shell/telemetry-demo.js");
}
function loadReportCli() {
    return require("../../shell/commands/report-cli.js");
}
attachCliBinding("ledger.propose", {
    path: ["ledger", "propose"],
    jsonMode: "default",
    handler: (args) => ({ json: loadLedgerCli().ledgerProposeCli(args.options) }),
    // The flags `cw help ledger` lists, checked against ledgerProposeCli's
    // required()/stringOption() calls above.
    flags: [
        { name: "--from AGENT/REPO", summary: "Who is making the change." },
        { name: "--to AGENT/REPO", summary: "Who should get the change." },
        { name: "--title TEXT", summary: "A short name for the change." },
        { name: "--rationale TEXT", summary: "Why the change should happen." },
        { name: "--files LIST", summary: "The files the change touches, as a comma list." },
        { name: "--diff PATCH", summary: "The change itself, as diff text (e.g. \"$(git diff)\")." },
    ],
    // ledgerProposeCli reads exactly from/to/title/rationale/files/diff
    // (shell/commands/ledger-cli.ts) — the list above is complete, so the dispatcher
    // may warn about an unknown flag (TTY-only; see cli/global-flags.ts).
    flagsComplete: true,
});
REGISTRY_BY_CAPABILITY.get("ledger.propose").mcp.handler = (args) => loadLedgerCli().ledgerProposeMcp(args);
attachCliBinding("ledger.review", {
    path: ["ledger", "review"],
    jsonMode: "default",
    handler: (args) => ({ json: loadLedgerCli().ledgerReviewCli(args.options) }),
    // Real flag names verified against ledgerReviewCli's required()/
    // stringOption() calls above — NOT the same flag set as ledger propose
    // (this row needs --target/--verdict/--findings, not --title/
    // --rationale/--diff).
    flags: [
        { name: "--from AGENT/REPO", summary: "Who is doing the review." },
        { name: "--to AGENT/REPO", summary: "Who made the change being reviewed." },
        { name: "--target ID", summary: "The id of the proposal or PR to review." },
        { name: "--verdict approved|rejected", summary: "The result of the review." },
        { name: "--findings TEXT", summary: "Notes on what the review found." },
    ],
    // ledgerReviewCli reads exactly from/to/target/verdict/findings
    // (shell/commands/ledger-cli.ts) — the list above is complete, so the dispatcher
    // may warn about an unknown flag (TTY-only; see cli/global-flags.ts).
    flagsComplete: true,
});
REGISTRY_BY_CAPABILITY.get("ledger.review").mcp.handler = (args) => loadLedgerCli().ledgerReviewMcp(args);
attachCliBinding("ledger.verify", {
    path: ["ledger", "verify"],
    jsonMode: "default",
    handler: (args) => {
        const result = loadLedgerCli().ledgerVerifyCli(args.options);
        return { json: result, exitCode: result.ok ? undefined : 1 };
    },
});
REGISTRY_BY_CAPABILITY.get("ledger.verify").mcp.handler = (args) => loadLedgerCli().ledgerVerifyEntry(args.entry);
attachCliBinding("ledger.apply", {
    path: ["ledger", "apply"],
    jsonMode: "default",
    handler: (args) => {
        const result = loadLedgerCli().ledgerApplyCli(args.options);
        return { json: result, exitCode: result.ok ? undefined : 1 };
    },
});
REGISTRY_BY_CAPABILITY.get("ledger.apply").mcp.handler = (args) => loadLedgerCli().ledgerApplyEntry(args.entry);
attachCliBinding("ledger.list", {
    path: ["ledger", "list"],
    jsonMode: "default",
    handler: (args) => {
        const result = loadLedgerCli().ledgerListCli(args.options);
        return { json: result, exitCode: result.allOk ? undefined : 1 };
    },
    // `--dir` here names the ledger directory, while the global front door
    // (cli/entry.ts) treats `--dir` as an alias of `--repo` for every command
    // — one flag, two meanings. `--ledger-dir` is the unambiguous spelling;
    // `--dir` stays as the legacy alias, byte-compat.
    flags: [
        { name: "--ledger-dir DIR", summary: "The ledger directory to read. Give it more than once to union-verify mirrors." },
        { name: "--dir DIR", summary: "Old name for --ledger-dir (also the global --repo alias; kept working)." },
    ],
});
REGISTRY_BY_CAPABILITY.get("ledger.list").mcp.handler = (args) => loadLedgerCli().ledgerListMcp(args);
attachCliBinding("telemetry.verify", {
    path: ["telemetry", "verify"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = required(optionalArg(args.positionals[0]) || optionalArg(args.options.runId) || optionalArg(args.options.run), "run id");
        const result = loadTelemetryCli().telemetryVerifyCli(runId, args.options);
        return { json: result, text: loadTelemetryDemo().formatTelemetryVerify(result), exitCode: result.verified ? undefined : 1 };
    },
});
REGISTRY_BY_CAPABILITY.get("telemetry.verify").mcp.handler = (args) => loadTelemetryCli().telemetryVerifyCli(required(optionalArg(args.runId), "run id"), args);
attachCliBinding("audit.verify", {
    path: ["audit", "verify"],
    jsonMode: "default",
    handler: (args) => {
        const runId = required(optionalArg(args.positionals[0]), "run id");
        const result = loadAuditCli().auditVerifyCli(runId, args.options);
        return { json: result, exitCode: result.verified ? undefined : 1 };
    },
});
REGISTRY_BY_CAPABILITY.get("audit.verify").mcp.handler = (args) => loadAuditCli().auditVerifyCli(required(optionalArg(args.runId), "run id"), args);
attachCliBinding("audit.head", {
    path: ["audit", "head"],
    jsonMode: "default",
    handler: (args) => {
        const runId = required(optionalArg(args.positionals[0]), "run id");
        return { json: loadAuditCli().auditHeadCli(runId, args.options) };
    },
});
REGISTRY_BY_CAPABILITY.get("audit.head").mcp.handler = (args) => loadAuditCli().auditHeadCli(required(optionalArg(args.runId), "run id"), args);
attachCliBinding("audit.repair", {
    path: ["audit", "repair"],
    jsonMode: "default",
    handler: (args) => {
        const runId = required(optionalArg(args.positionals[0]), "run id");
        const result = loadAuditCli().auditRepairCli(runId, args.options);
        return { json: result, exitCode: result.outcome === "refused" ? 1 : undefined };
    },
});
REGISTRY_BY_CAPABILITY.get("audit.repair").mcp.handler = (args) => loadAuditCli().auditRepairCli(required(optionalArg(args.runId), "run id"), args);
addCliOnlyCapability("demo.tamper", "Prove tamper-evidence: build a signed telemetry ledger, forge it, watch verification fail offline.", {
    path: ["demo", "tamper"],
    jsonMode: "flag",
    handler: (args) => {
        const result = loadDemoCli().demoTamperCli();
        return { json: result, text: loadTelemetryDemo().formatTamperDemo(result), exitCode: result.proven ? undefined : 1 };
    },
}, "Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface telemetry.verify. No agent or MCP client needs to invoke a demo.");
addCliOnlyCapability("demo.bundle", "Prove portable-bundle verification: export a sealed report bundle, forge it two ways, watch report verify-bundle catch both offline with only the embedded public key.", {
    path: ["demo", "bundle"],
    jsonMode: "flag",
    handler: (args) => {
        const result = loadDemoCli().demoBundleCli();
        return { json: result, text: loadTelemetryDemo().formatBundleDemo(result), exitCode: result.proven ? undefined : 1 };
    },
}, "Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface report.verify-bundle. No agent or MCP client needs to invoke a demo.");
attachCliBinding("report.bundle", {
    path: ["report", "bundle"],
    jsonMode: "default",
    handler: (args) => {
        const runId = required(optionalArg(args.positionals[0]), "run id");
        const result = loadReportCli().reportBundleCli(runId, args.options);
        return { json: result, exitCode: result.ok ? undefined : 1 };
    },
    humanRender: (json) => loadReportCli().formatReportBundle(json),
});
REGISTRY_BY_CAPABILITY.get("report.bundle").mcp.handler = (args) => loadReportCli().reportBundleCli(required(optionalArg(args.runId), "run id"), args);
attachCliBinding("report.verify-bundle", {
    path: ["report", "verify-bundle"],
    jsonMode: "flag",
    handler: (args) => {
        const archivePath = required(optionalArg(args.positionals[0]), "bundle path");
        const reportCli = loadReportCli();
        const result = reportCli.reportVerifyBundleCli({ ...args.options, archive: archivePath });
        return { json: result, text: reportCli.formatReportVerifyBundle(result), exitCode: result.ok ? undefined : 1 };
    },
});
REGISTRY_BY_CAPABILITY.get("report.verify-bundle").mcp.handler = (args) => {
    const result = loadReportCli().reportVerifyBundleCli(args);
    return result;
};
function loadCheckCli() {
    return require("../../shell/commands/check-cli.js");
}
addCliOnlyCapability("check.run", "Run your own check command (no shell, no model) and keep a done receipt: git HEAD, exit code, output digests.", {
    path: ["check"],
    jsonMode: "default",
    handler: (args) => loadCheckCli().checkRunCli(args.positionals, args.options),
    humanRender: (json) => loadCheckCli().formatCheckRun(json),
    flags: [{ name: "-- COMMAND [ARGS...]", summary: "The command to run, e.g. cw check -- npm test." }],
}, "Runs a local process for the person at the terminal; an MCP host already runs commands with its own tool and cites the receipt. Reading receipts is both-surface (check.list, check.show).");
attachCliBinding("check.list", {
    path: ["check", "list"],
    jsonMode: "default",
    handler: (args) => ({ json: loadCheckCli().checkListCli(args.options) }),
    humanRender: (json) => loadCheckCli().formatCheckList(json),
});
REGISTRY_BY_CAPABILITY.get("check.list").mcp.handler = (args) => loadCheckCli().checkListMcp(args);
attachCliBinding("check.show", {
    path: ["check", "show"],
    jsonMode: "default",
    handler: (args) => loadCheckCli().checkShowCli(optionalArg(args.positionals[0]) || optionalArg(args.options.id), args.options),
    humanRender: (json) => loadCheckCli().formatCheckShow(json),
});
REGISTRY_BY_CAPABILITY.get("check.show").mcp.handler = (args) => loadCheckCli().checkShowMcp(args);
// ---------------------------------------------------------------------
