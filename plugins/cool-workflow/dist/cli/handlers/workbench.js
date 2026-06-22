"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWorkbench = handleWorkbench;
const workbench_1 = require("../../workbench");
const workbench_host_1 = require("../../workbench-host");
const format_1 = require("../format");
const io_1 = require("../io");
/** `cw workbench serve [--port N] [--once] | view <run-id> [--json]` — the optional
 *  read-only, localhost-only workbench. Behaviour-identical to the former inline case. */
async function handleWorkbench(args, runner) {
    const [subcommand, runId] = args.positionals;
    switch (subcommand) {
        case "view": {
            // Read-only five-panel view of one run. Same core entry as cw_workbench_view.
            const view = (0, workbench_1.buildWorkbenchRunView)(runner, (0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(view);
            else
                process.stdout.write(`${(0, format_1.formatWorkbenchView)(view)}\n`);
            return;
        }
        case "serve": {
            // The OPTIONAL localhost host. `--once`/`--json` emit the descriptor only
            // (no server); the default starts the read-only, localhost-only host.
            if (args.options.once || (0, io_1.wantsJson)(args.options)) {
                (0, io_1.printJson)((0, workbench_1.buildWorkbenchServeDescriptor)(runner, { ...args.options, once: true }));
                return;
            }
            const host = new workbench_host_1.WorkbenchHost({
                runner,
                cwd: String(args.options.cwd || process.cwd()),
                port: Number(args.options.port) || undefined,
                scope: args.options.scope === "repo" ? "repo" : "home"
            });
            await host.run();
            return;
        }
        default:
            throw new Error("Usage: cw.js workbench serve [--port N] [--once] | view <run-id> [--json]");
    }
}
