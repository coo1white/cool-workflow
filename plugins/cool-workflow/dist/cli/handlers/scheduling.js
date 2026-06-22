"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSchedule = handleSchedule;
exports.handleRoutine = handleRoutine;
exports.handleSched = handleSched;
// `cw schedule` / `cw routine` / `cw sched` handlers — the scheduling command
// family, carved out of the command-surface god-dispatch. Three sibling verbs:
//   schedule — desktop scheduler (create/list/.../daemon) over the Scheduler
//   routine  — routine triggers (create/list/delete/fire/events) over the bridge
//   sched    — durable run-queue scheduling (plan/lease/release/.../policy)
const node_fs_1 = __importDefault(require("node:fs"));
const daemon_1 = require("../../daemon");
const capability_core_1 = require("../../capability-core");
const io_1 = require("../io");
/** `cw schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon`. */
async function handleSchedule(args, scheduler) {
    const [subcommand, id] = args.positionals;
    switch (subcommand) {
        case "create":
            (0, io_1.printJson)(scheduler.create(args.options));
            return;
        case "list":
            (0, io_1.printJson)(scheduler.list(args.options.status ? String(args.options.status) : undefined));
            return;
        case "delete":
            (0, io_1.printJson)(scheduler.delete((0, io_1.required)(id, "schedule id")));
            return;
        case "due":
            (0, io_1.printJson)(scheduler.due());
            return;
        case "complete":
            (0, io_1.printJson)(scheduler.complete((0, io_1.required)(id, "schedule id"), args.options));
            return;
        case "pause":
            (0, io_1.printJson)(scheduler.pause((0, io_1.required)(id, "schedule id")));
            return;
        case "resume":
            (0, io_1.printJson)(scheduler.resume((0, io_1.required)(id, "schedule id")));
            return;
        case "run-now":
            (0, io_1.printJson)(scheduler.runNow((0, io_1.required)(id, "schedule id")));
            return;
        case "history":
            (0, io_1.printJson)(scheduler.history(id));
            return;
        case "daemon": {
            const daemon = new daemon_1.DesktopSchedulerDaemon({
                cwd: String(args.options.cwd || process.cwd()),
                intervalSeconds: Number(args.options.intervalSeconds || args.options.interval || 60)
            });
            if (args.options.once) {
                (0, io_1.printJson)(daemon.tick());
                return;
            }
            await daemon.run();
            return;
        }
        default:
            throw new Error("Usage: cw.js schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon");
    }
}
/** `cw routine create|list|delete|fire|events`. */
function handleRoutine(args, triggers) {
    const [subcommand, idOrKind, payloadPath] = args.positionals;
    switch (subcommand) {
        case "create":
            (0, io_1.printJson)(triggers.create(args.options));
            return;
        case "list":
            (0, io_1.printJson)(triggers.list(args.options.kind ? String(args.options.kind) : undefined));
            return;
        case "delete":
            (0, io_1.printJson)(triggers.delete((0, io_1.required)(idOrKind, "trigger id")));
            return;
        case "fire": {
            const kind = (0, io_1.required)(idOrKind, "trigger kind");
            const payload = payloadPath ? JSON.parse(node_fs_1.default.readFileSync(payloadPath, "utf8")) : args.options;
            (0, io_1.printJson)(triggers.fire(kind, payload));
            return;
        }
        case "events":
            (0, io_1.printJson)(triggers.events(idOrKind));
            return;
        default:
            throw new Error("Usage: cw.js routine create|list|delete|fire|events");
    }
}
/** `cw sched plan|lease|release|complete|reclaim|reset|policy [show|set]` — durable run-queue. */
function handleSched(args, runner) {
    const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
    const [subcommand, idArg] = args.positionals;
    switch (subcommand) {
        case "plan":
            (0, io_1.printJson)((0, capability_core_1.schedPlan)(registry, args.options));
            return;
        case "lease":
            (0, io_1.printJson)((0, capability_core_1.schedLease)(registry, args.options));
            return;
        case "release":
            (0, io_1.printJson)((0, capability_core_1.schedRelease)(registry, { ...args.options, leaseId: args.options.leaseId || idArg }));
            return;
        case "complete":
            (0, io_1.printJson)((0, capability_core_1.schedComplete)(registry, { ...args.options, leaseId: args.options.leaseId || idArg }));
            return;
        case "reclaim":
            (0, io_1.printJson)((0, capability_core_1.schedReclaim)(registry, args.options));
            return;
        case "reset":
            (0, io_1.printJson)((0, capability_core_1.schedReset)(registry, { ...args.options, id: args.options.id || idArg }));
            return;
        case "policy": {
            const [, action] = args.positionals;
            if (action === "set") {
                (0, io_1.printJson)((0, capability_core_1.schedPolicySet)(registry, args.options));
                return;
            }
            (0, io_1.printJson)((0, capability_core_1.schedPolicyShow)(registry));
            return;
        }
        default:
            throw new Error("Usage: cw.js sched plan|lease|release|complete|reclaim|reset|policy [show|set] [id] [--maxConcurrent N --maxAttempts N ...]");
    }
}
