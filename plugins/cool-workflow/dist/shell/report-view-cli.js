"use strict";
// shell/report-view-cli.ts — CLI/MCP-facing entry points for `cw report
// <run-id>`, `cw status`, `cw graph`, `cw operator status|report|graph`.
//
// MILESTONE 11 (reporting/observability). Wires shell/operator-ux.ts +
// shell/report.ts + shell/operator-ux-text.ts into the shapes
// core/capability-table.ts's CLI/MCP bindings call, matching shell/
// pipeline-cli.ts's pattern.
//
// Evidence: SPEC/reporting-ux.md "CLI commands" (`cw report`, `cw
// status`, `cw operator status|report`, `cw graph`).
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
exports.reportWriteCli = reportWriteCli;
exports.statusCli = statusCli;
exports.statusSummaryText = statusSummaryText;
exports.statusFullText = statusFullText;
exports.operatorStatusCli = operatorStatusCli;
exports.operatorReportCli = operatorReportCli;
exports.operatorReportText = operatorReportText;
exports.graphCli = graphCli;
exports.graphText = graphText;
exports.optionalString = optionalString;
const path = __importStar(require("node:path"));
const run_store_1 = require("./run-store");
const report_1 = require("./report");
const operator_ux_1 = require("./operator-ux");
const operator_ux_text_1 = require("./operator-ux-text");
function invocationCwd(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}
function optionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
/** `cw report <run-id>` — writes report.md fresh and returns just its
 *  path (the CLI binding prints ONLY this path + "\n" to stdout; `--json`
 *  prints `{path}`). */
function reportWriteCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return { path: (0, report_1.writeReport)(run) };
}
/** `cw status [<run-id>]` / `cw_status` — no id: the fixed advice shape;
 *  with an id: `summarizeRun`'s payload. */
function statusCli(runId, args) {
    if (!runId)
        return { runId: null, nextActions: (0, operator_ux_1.adviseNoRun)() };
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, operator_ux_1.summarizeRun)(run);
}
/** `cw status <id> --summary`/`--brief` human text. */
function statusSummaryText(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, operator_ux_text_1.formatOperatorSummary)((0, operator_ux_1.summarizeOperatorRun)(run));
}
/** The full `cw status <id>` human text. */
function statusFullText(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, operator_ux_text_1.formatOperatorStatus)((0, operator_ux_1.summarizeOperatorRun)(run));
}
/** `cw operator status <id> [--json]`. */
function operatorStatusCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, operator_ux_1.summarizeOperatorRun)(run);
}
/** `cw operator report <id> [--json]` — also re-writes report.md as a
 *  side effect (byte-exact to the old build's operator report verb). */
function operatorReportCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    (0, report_1.writeReport)(run);
    return (0, operator_ux_1.summarizeOperatorRun)(run);
}
function operatorReportText(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    (0, report_1.writeReport)(run);
    return (0, operator_ux_text_1.formatOperatorReport)((0, operator_ux_1.summarizeOperatorRun)(run), []);
}
/** `cw graph <id> [--json]` / `cw operator graph`. */
function graphCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, operator_ux_1.buildOperatorGraph)(run);
}
function graphText(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, operator_ux_text_1.formatOperatorGraph)((0, operator_ux_1.buildOperatorGraph)(run));
}
