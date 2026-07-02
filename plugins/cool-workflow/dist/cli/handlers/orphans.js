"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleOrphans = handleOrphans;
const capability_core_1 = require("../../capability-core");
const run_registry_1 = require("../../run-registry");
const io_1 = require("../io");
/** `cw orphans list [--json] | orphans gc [--min-age-minutes N] [--all] [--json]`. */
function handleOrphans(args, runner) {
    const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
    const [subcommand] = args.positionals;
    switch (subcommand) {
        case "list": {
            const result = (0, capability_core_1.listOrphanRuns)(registry, args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, run_registry_1.formatOrphanRunsList)(result)}\n`);
            return;
        }
        case "gc": {
            const result = (0, capability_core_1.gcOrphanRuns)(registry, args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, run_registry_1.formatOrphanRunsGc)(result)}\n`);
            return;
        }
        default:
            throw new Error("Usage: cw.js orphans list [--json] | orphans gc [--min-age-minutes N] [--all] [--json]");
    }
}
