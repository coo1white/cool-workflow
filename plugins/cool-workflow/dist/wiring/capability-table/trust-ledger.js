"use strict";
// wiring/capability-table/trust-ledger.ts — MILESTONE 8 (ledger, telemetry,
// trust-audit, tamper/bundle demos) CLI bindings: ledger.*, telemetry.verify,
// audit.verify, audit.head, demo.*, report.bundle/verify-bundle. Split out
// of core/capability-table.ts, byte-for-byte (extracted with sed, not
// retyped).
Object.defineProperty(exports, "__esModule", { value: true });
const registry_core_1 = require("./registry-core");
const cli_args_1 = require("../../core/util/cli-args");
// MILESTONE 8 (ledger, telemetry, trust-audit, tamper/bundle demos) CLI
// bindings: ledger propose|review|verify|apply|list, telemetry verify,
// audit verify, demo tamper|bundle, report bundle|verify-bundle. Handler
// BODIES live in shell/ledger-cli.ts, shell/telemetry-cli.ts, shell/
// audit-cli.ts, shell/demo-cli.ts, shell/report-cli.ts (impure — file/
// stdin reads, run-state loads, archive IO); this table only wires argv
// shape -> handler call, per cli/dispatch.ts's generic executor
// contract. `ledger` is intentionally absent from KNOWN_COMMANDS (see
// cli/parseargv.ts) even though dispatchTable now handles it as a real
// row — a known, preserved wart.
// ---------------------------------------------------------------------
const ledger_cli_1 = require("../../shell/ledger-cli");
// This file is required at startup for every command. Loading these shell
// modules only when their handler runs, not at import time, keeps that
// load cost out of commands that never touch telemetry/audit/demo/report.
function loadTelemetryCli() {
    return require("../../shell/telemetry-cli");
}
function loadAuditCli() {
    return require("../../shell/audit-cli");
}
function loadDemoCli() {
    return require("../../shell/demo-cli");
}
function loadTelemetryDemo() {
    return require("../../shell/telemetry-demo");
}
function loadReportCli() {
    return require("../../shell/report-cli");
}
(0, registry_core_1.attachCliBinding)("ledger.propose", {
    path: ["ledger", "propose"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, ledger_cli_1.ledgerProposeCli)(args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.propose").mcp.handler = (args) => (0, ledger_cli_1.ledgerProposeMcp)(args);
(0, registry_core_1.attachCliBinding)("ledger.review", {
    path: ["ledger", "review"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, ledger_cli_1.ledgerReviewCli)(args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.review").mcp.handler = (args) => (0, ledger_cli_1.ledgerReviewMcp)(args);
(0, registry_core_1.attachCliBinding)("ledger.verify", {
    path: ["ledger", "verify"],
    jsonMode: "default",
    handler: (args) => {
        const result = (0, ledger_cli_1.ledgerVerifyCli)(args.options);
        return { json: result, exitCode: result.ok ? undefined : 1 };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.verify").mcp.handler = (args) => (0, ledger_cli_1.ledgerVerifyEntry)(args.entry);
(0, registry_core_1.attachCliBinding)("ledger.apply", {
    path: ["ledger", "apply"],
    jsonMode: "default",
    handler: (args) => {
        const result = (0, ledger_cli_1.ledgerApplyCli)(args.options);
        return { json: result, exitCode: result.ok ? undefined : 1 };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.apply").mcp.handler = (args) => (0, ledger_cli_1.ledgerApplyEntry)(args.entry);
(0, registry_core_1.attachCliBinding)("ledger.list", {
    path: ["ledger", "list"],
    jsonMode: "default",
    handler: (args) => {
        const result = (0, ledger_cli_1.ledgerListCli)(args.options);
        return { json: result, exitCode: result.allOk ? undefined : 1 };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.list").mcp.handler = (args) => (0, ledger_cli_1.ledgerListMcp)(args);
(0, registry_core_1.attachCliBinding)("telemetry.verify", {
    path: ["telemetry", "verify"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.positionals[0]) || (0, cli_args_1.optionalArg)(args.options.runId) || (0, cli_args_1.optionalArg)(args.options.run), "run id");
        const result = loadTelemetryCli().telemetryVerifyCli(runId, args.options);
        return { json: result, text: loadTelemetryDemo().formatTelemetryVerify(result), exitCode: result.verified ? undefined : 1 };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("telemetry.verify").mcp.handler = (args) => loadTelemetryCli().telemetryVerifyCli((0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("audit.verify", {
    path: ["audit", "verify"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.positionals[0]), "run id");
        const result = loadAuditCli().auditVerifyCli(runId, args.options);
        return { json: result, exitCode: result.verified ? undefined : 1 };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.verify").mcp.handler = (args) => loadAuditCli().auditVerifyCli((0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("audit.head", {
    path: ["audit", "head"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.positionals[0]), "run id");
        return { json: loadAuditCli().auditHeadCli(runId, args.options) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.head").mcp.handler = (args) => loadAuditCli().auditHeadCli((0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("audit.repair", {
    path: ["audit", "repair"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.positionals[0]), "run id");
        const result = loadAuditCli().auditRepairCli(runId, args.options);
        return { json: result, exitCode: result.outcome === "refused" ? 1 : undefined };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.repair").mcp.handler = (args) => loadAuditCli().auditRepairCli((0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.addCliOnlyCapability)("demo.tamper", "Prove tamper-evidence: build a signed telemetry ledger, forge it, watch verification fail offline.", {
    path: ["demo", "tamper"],
    jsonMode: "flag",
    handler: (args) => {
        const result = loadDemoCli().demoTamperCli();
        return { json: result, text: loadTelemetryDemo().formatTamperDemo(result), exitCode: result.proven ? undefined : 1 };
    },
}, "Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface telemetry.verify. No agent or MCP client needs to invoke a demo.");
(0, registry_core_1.addCliOnlyCapability)("demo.bundle", "Prove portable-bundle verification: export a sealed report bundle, forge it two ways, watch report verify-bundle catch both offline with only the embedded public key.", {
    path: ["demo", "bundle"],
    jsonMode: "flag",
    handler: (args) => {
        const result = loadDemoCli().demoBundleCli();
        return { json: result, text: loadTelemetryDemo().formatBundleDemo(result), exitCode: result.proven ? undefined : 1 };
    },
}, "Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface report.verify-bundle. No agent or MCP client needs to invoke a demo.");
(0, registry_core_1.attachCliBinding)("report.bundle", {
    path: ["report", "bundle"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.positionals[0]), "run id");
        const result = loadReportCli().reportBundleCli(runId, args.options);
        return { json: result, exitCode: result.ok ? undefined : 1 };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("report.bundle").mcp.handler = (args) => loadReportCli().reportBundleCli((0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("report.verify-bundle", {
    path: ["report", "verify-bundle"],
    jsonMode: "flag",
    handler: (args) => {
        const archivePath = (0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.positionals[0]), "bundle path");
        const reportCli = loadReportCli();
        const result = reportCli.reportVerifyBundleCli({ ...args.options, archive: archivePath });
        return { json: result, text: reportCli.formatReportVerifyBundle(result), exitCode: result.ok ? undefined : 1 };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("report.verify-bundle").mcp.handler = (args) => {
    const result = loadReportCli().reportVerifyBundleCli(args);
    return result;
};
// ---------------------------------------------------------------------
