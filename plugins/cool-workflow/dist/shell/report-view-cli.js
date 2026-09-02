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
exports.resolveReportRunId = resolveReportRunId;
exports.ensureAndOpenReportHtml = ensureAndOpenReportHtml;
exports.reportOpenCli = reportOpenCli;
exports.statusCli = statusCli;
exports.statusSummaryText = statusSummaryText;
exports.statusFullText = statusFullText;
exports.operatorStatusCli = operatorStatusCli;
exports.operatorReportCli = operatorReportCli;
exports.operatorReportText = operatorReportText;
exports.graphCli = graphCli;
exports.graphText = graphText;
exports.optionalString = optionalString;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const run_store_1 = require("./run-store");
const report_1 = require("./report");
const operator_ux_1 = require("./operator-ux");
const operator_ux_text_1 = require("./operator-ux-text");
const report_html_1 = require("../core/format/report-html");
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
/** `cw report` with no run id: the newest run under this repo's
 *  `.cw/runs/`. Run ids sort chronologically (checked on three real
 *  runs: the largest id by plain string sort was also the latest
 *  `createdAt`), so "newest" is just the last name after a sort.
 *  Returns undefined when the repo has no run yet. */
function resolveReportRunId(args) {
    const runsDir = path.join(invocationCwd(args), ".cw", "runs");
    if (!fs.existsSync(runsDir))
        return undefined;
    const ids = fs
        .readdirSync(runsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(runsDir, entry.name, "state.json")))
        .map((entry) => entry.name)
        .sort();
    return ids.length ? ids[ids.length - 1] : undefined;
}
/** Writes/refreshes `report.html` beside `report.md` (only when missing
 *  or older) and opens it with the system viewer: `CW_OPENER` when set
 *  (the smoke test's stub), else `open`/`xdg-open`/`start` for macOS/
 *  Linux/Windows. Spawned argv-style, `shell: false` — never a shell
 *  string built from a path. A missing opener never throws (spawnSync's
 *  `error` field just carries it), so the caller still gets the path
 *  back and exits 0. */
function ensureAndOpenReportHtml(mdPath) {
    const htmlPath = mdPath.replace(/\.md$/, ".html");
    const mdMtime = fs.statSync(mdPath).mtimeMs;
    const htmlMtime = fs.existsSync(htmlPath) ? fs.statSync(htmlPath).mtimeMs : -1;
    if (htmlMtime < mdMtime)
        fs.writeFileSync(htmlPath, (0, report_html_1.reportToHtml)(fs.readFileSync(mdPath, "utf8")), "utf8");
    const opener = process.env.CW_OPENER || (process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open");
    (0, node_child_process_1.spawnSync)(opener, [htmlPath], { stdio: "ignore", shell: false });
    return htmlPath;
}
/** `cw report --open [run-id]` — a fresh report.md, then the html+open
 *  step above. */
function reportOpenCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return { path: ensureAndOpenReportHtml((0, report_1.writeReport)(run)) };
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
    if (args.__cwWorkbenchReadOnlyProjection === true)
        run.__cwWorkbenchReadOnlyProjection = true;
    return (0, operator_ux_1.buildOperatorGraph)(run);
}
function graphText(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, operator_ux_text_1.formatOperatorGraph)((0, operator_ux_1.buildOperatorGraph)(run));
}
