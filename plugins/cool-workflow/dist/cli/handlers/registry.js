"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRegistry = handleRegistry;
exports.handleQueue = handleQueue;
exports.handleHistory = handleHistory;
const capability_core_1 = require("../../capability-core");
const run_registry_1 = require("../../run-registry");
const io_1 = require("../io");
/** `cw registry refresh|show [--scope repo|home] [--json]`. */
function handleRegistry(args, runner) {
    const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
    const [subcommand] = args.positionals;
    switch (subcommand) {
        case "refresh": {
            const report = (0, capability_core_1.runRegistryRefresh)(registry, args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(report);
            else
                process.stdout.write(`${(0, run_registry_1.formatRegistryReport)(report)}\n`);
            return;
        }
        case "show": {
            const report = (0, capability_core_1.runRegistryShow)(registry, args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(report);
            else
                process.stdout.write(`${(0, run_registry_1.formatRegistryReport)(report)}\n`);
            return;
        }
        default:
            throw new Error("Usage: cw.js registry refresh|show [--scope repo|home] [--json]");
    }
}
/** `cw queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]`. */
function handleQueue(args, runner) {
    const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
    const [subcommand, id] = args.positionals;
    switch (subcommand) {
        case "add":
            (0, io_1.printJson)((0, capability_core_1.queueAdd)(registry, args.options));
            return;
        case "list": {
            const result = (0, capability_core_1.queueList)(registry, args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, run_registry_1.formatQueueList)(result)}\n`);
            return;
        }
        case "drain":
            (0, io_1.printJson)((0, capability_core_1.queueDrain)(registry, args.options));
            return;
        case "show":
            (0, io_1.printJson)((0, capability_core_1.queueShow)(registry, (0, io_1.required)(id, "queue id")));
            return;
        default:
            throw new Error("Usage: cw.js queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]");
    }
}
/** `cw history [--json]` — recent runs across the resolved registry scope. */
function handleHistory(args, runner) {
    const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
    const result = (0, capability_core_1.runHistory)(registry, args.options);
    if ((0, io_1.wantsJson)(args.options))
        (0, io_1.printJson)(result);
    else
        process.stdout.write(`${(0, run_registry_1.formatHistory)(result)}\n`);
}
