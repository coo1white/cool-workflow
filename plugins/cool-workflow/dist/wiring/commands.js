// wiring/commands.ts — the CLI's command table. Each row loads its shell
// module on first use, so `cw version` and `cw help` read no run state and
// load no signing code.
import { createRequire } from "node:module";
import { CURRENT_COOL_WORKFLOW_VERSION } from "../core/version.js";
import { optionalArg } from "../core/util/cli-args.js";
const load = createRequire(import.meta.url);
const pipeline = () => load("../shell/commands/pipeline-cli.js");
const doctor = () => load("../shell/doctor.js");
const reportView = () => load("../shell/commands/report-view-cli.js");
const reportCli = () => load("../shell/commands/report-cli.js");
const check = () => load("../shell/commands/check-cli.js");
const tamper = () => load("../shell/tamper-demo.js");
function runDoctor(options) {
    return doctor().runDoctor(options, process.env, optionalArg(options.cwd) || process.cwd());
}
/** `cw -q "question"` and `cw --resume --run <id>`: no verb of its own. */
export const ASK = {
    path: ["-q"],
    summary: "Ask a question, get a report (cw -q \"question\")",
    jsonMode: "default",
    handler: async ({ options }) => {
        const result = await pipeline().askRun(options);
        const stopped = result.reportPath && (result.status === "blocked" || result.status === "parked");
        return { json: result, exitCode: stopped ? 2 : undefined };
    },
    humanRender: (json) => pipeline().formatQuickstartHuman(json),
};
export const COMMANDS = [
    {
        path: ["version"],
        summary: "Show version",
        jsonMode: "default",
        handler: () => ({ text: `${CURRENT_COOL_WORKFLOW_VERSION}\n` }),
    },
    {
        path: ["doctor"],
        summary: "Check setup",
        jsonMode: "flag",
        flags: [
            { name: "--fix", summary: "Print only the fix commands" },
            { name: "--json", summary: "Print the report as JSON" },
        ],
        handler: ({ options }) => {
            const report = runDoctor(options);
            const text = options.fix ? `${doctor().formatDoctorFixes(report)}\n` : doctor().formatDoctorReport(report);
            return { json: report, text, exitCode: report.ok ? undefined : 1 };
        },
    },
    {
        path: ["fix"],
        summary: "Show fix commands for setup issues",
        jsonMode: "human",
        handler: ({ options }) => {
            const report = runDoctor(options);
            return { text: `${doctor().formatDoctorFixes(report)}\n`, exitCode: report.ok ? undefined : 1 };
        },
    },
    {
        path: ["report"],
        helpPath: ["report", "[run-id]", "[--show|--open]"],
        summary: "Write the report for a run (default: the latest) and print its path",
        jsonMode: "flag",
        flags: [
            { name: "--show", summary: "Print report.md" },
            { name: "--open", summary: "Open report.html in the browser" },
        ],
        handler: ({ positionals, options }) => {
            const view = reportView();
            const runId = view.resolveReportRunId(positionals[0], options);
            if (!runId)
                return { json: { runId: null }, text: 'No run yet. Try: cw -q "<question>"\n' };
            if (options.open) {
                const opened = view.reportOpenCli(runId, options);
                return { json: opened, text: `${opened.path}\n` };
            }
            if (options.show)
                return { json: view.reportWriteCli(runId, options), text: view.reportShowText(runId, options) };
            const written = view.reportWriteCli(runId, options);
            return { json: written, text: `${written.path}\n` };
        },
    },
    {
        path: ["report", "bundle"],
        helpPath: ["report", "bundle", "<run-id>"],
        summary: "Seal a run into one file that verifies offline",
        jsonMode: "default",
        flags: [
            { name: "--output FILE", summary: "Where to write the bundle (default: <run-id>.cwrun.json)" },
            { name: "--with-trust-key PEM", summary: "Embed this public key so signatures re-check offline" },
            { name: "--extract-report FILE", summary: "Also write report.md to FILE" },
        ],
        handler: ({ positionals, options }) => {
            const result = reportCli().reportBundleCli(positionals[0] || optionalArg(options.run) || "", options);
            return { json: result, exitCode: result.ok ? undefined : 1 };
        },
        humanRender: (json) => reportCli().formatReportBundle(json),
    },
    {
        path: ["report", "verify-bundle"],
        helpPath: ["report", "verify-bundle", "<bundle>"],
        summary: "Check a sealed run offline; fails closed",
        jsonMode: "flag",
        flags: [
            { name: "--pubkey PEM", summary: "Trust this public key over the embedded one" },
            { name: "--strict-signatures", summary: "Fail when signatures exist but no key does" },
            { name: "--require-signatures", summary: "Fail when any result is unsigned" },
            { name: "--extract-report FILE", summary: "Write the verified report.md to FILE" },
        ],
        handler: ({ positionals, options }) => {
            const archive = positionals[0] || optionalArg(options.archive || options.path || options.file || options.bundle);
            const result = reportCli().reportVerifyBundleCli({ ...options, archive });
            return { json: result, text: reportCli().formatReportVerifyBundle(result), exitCode: result.ok ? undefined : 1 };
        },
    },
    {
        path: ["check"],
        helpPath: ["check", "--", "<command>"],
        summary: "Run a command and keep a receipt a result can cite",
        jsonMode: "default",
        flags: [{ name: "--tee", summary: "Pass the output and exit code through; the receipt line goes to stderr" }],
        handler: ({ positionals, options }) => check().checkRunCli(positionals, options),
        humanRender: (json) => check().formatCheckRun(json),
    },
    {
        path: ["check", "list"],
        summary: "List the receipts in this folder",
        jsonMode: "default",
        handler: ({ options }) => ({ json: check().checkListCli(options) }),
        humanRender: (json) => check().formatCheckList(json),
    },
    {
        path: ["check", "show"],
        helpPath: ["check", "show", "<receipt-id>"],
        summary: "Show one receipt and whether it can be cited",
        jsonMode: "default",
        handler: ({ positionals, options }) => check().checkShowCli(positionals[0] || optionalArg(options.id), options),
        humanRender: (json) => check().formatCheckShow(json),
    },
    {
        path: ["demo"],
        hidden: true,
        summary: "Demos",
        jsonMode: "human",
        handler: () => {
            throw new Error("Usage: cw demo tamper [--json]");
        },
    },
    {
        path: ["demo", "tamper"],
        summary: "Edit a sealed run and watch verify catch it",
        jsonMode: "flag",
        handler: () => {
            const result = tamper().runTamperDemo();
            return { json: result, text: tamper().formatTamperDemo(result), exitCode: result.proven ? undefined : 1 };
        },
    },
];
/** The row for an exact path, or undefined. */
export function findCommand(path) {
    return COMMANDS.find((row) => row.path.length === path.length && row.path.every((token, i) => token === path[i]));
}
