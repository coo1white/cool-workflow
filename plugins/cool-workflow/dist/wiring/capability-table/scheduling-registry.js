"use strict";
// wiring/capability-table/scheduling-registry.ts — MILESTONE 10
// (scheduling, registry, gc/reclamation, orphans, clones) CLI bindings:
// schedule *, cw loop, routine *, sched *, registry *, queue *, run *
// (list/show/search/rerun/resume/archive), history, gc *, orphans *,
// clones *. Split out of core/capability-table.ts, byte-for-byte
// (extracted with sed, not retyped).
Object.defineProperty(exports, "__esModule", { value: true });
const registry_core_1 = require("./registry-core");
const io_1 = require("../../cli/io");
// MILESTONE 10 (scheduling, registry, gc/reclamation, orphans, clones)
// CLI bindings: schedule *, cw loop, routine *, sched *, registry *,
// queue *, gc *, orphans *, clones *, run search|list|show|resume|
// archive|rerun, history. Handler BODIES live in shell/registry-cli.ts,
// shell/scheduler-io.ts, shell/scheduling-io.ts, shell/reclamation-io.ts,
// shell/run-registry-io.ts (impure — disk-scanning IO); this table only
// wires argv shape -> handler call, per cli/dispatch.ts's generic
// executor contract. Usage-error strings are copied byte-for-byte from
// the old build's handlers/{scheduling,registry,maintenance,orphans,
// clones}.ts.
// ---------------------------------------------------------------------
const registry_cli_1 = require("../../shell/registry-cli");
const reclamation_io_1 = require("../../shell/reclamation-io");
const run_registry_io_1 = require("../../shell/run-registry-io");
const scheduling_io_1 = require("../../shell/scheduling-io");
function firstPositionalArg(args, index = 0) {
    return args.positionals[index];
}
// ---- schedule (+ cw loop) ----------------------------------------------
(0, registry_core_1.addCliOnlyCapability)("loop", 'cw loop — sugar for "schedule create --kind loop".', {
    path: ["loop"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, registry_cli_1.scheduleCreateCli)({ ...args.options, kind: "loop" }) }),
}, "loop is CLI-only sugar over schedule.create; the old build never gave it an MCP tool of its own (SPEC/scheduling-registry.md section I).");
(0, registry_core_1.addCliOnlyCapability)("schedule", "cw schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon — the wall-clock scheduler.", {
    path: ["schedule"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
        const [subcommand, id] = args.positionals;
        switch (subcommand) {
            case "create":
                return { json: (0, registry_cli_1.scheduleCreateCli)(args.options) };
            case "list":
                return { json: (0, registry_cli_1.scheduleListCli)(args.options) };
            case "delete":
                return { json: (0, registry_cli_1.scheduleDeleteCli)((0, io_1.required)(id, "schedule id"), args.options) };
            case "due":
                return { json: (0, registry_cli_1.scheduleDueCli)(args.options) };
            case "complete":
                return { json: (0, registry_cli_1.scheduleCompleteCli)((0, io_1.required)(id, "schedule id"), args.options) };
            case "pause":
                return { json: (0, registry_cli_1.schedulePauseCli)((0, io_1.required)(id, "schedule id"), args.options) };
            case "resume":
                return { json: (0, registry_cli_1.scheduleResumeCli)((0, io_1.required)(id, "schedule id"), args.options) };
            case "run-now":
                return { json: (0, registry_cli_1.scheduleRunNowCli)((0, io_1.required)(id, "schedule id"), args.options) };
            case "history":
                return { json: (0, registry_cli_1.scheduleHistoryCli)(id, args.options) };
            case "daemon": {
                if (args.options.once)
                    return { json: (0, registry_cli_1.scheduleDaemonTickCli)(args.options) };
                // Never returns (matches the old build's forever daemon loop);
                // the process stays alive via the DesktopSchedulerDaemon's own
                // setInterval, printing one tick line per interval.
                void (0, registry_cli_1.scheduleDaemonRunForever)(args.options);
                return {};
            }
            default:
                throw new Error("Usage: cw.js schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon");
        }
    },
}, "cw schedule is the desktop wall-clock scheduler; SPEC/mcp.md declares its MCP peers per verb (cw_schedule_*), each wired below.");
// GAP #24: the cw_schedule_* MCP peers were declared but left on the
// notYetImplemented placeholder (the "each wired below" comment was never
// satisfied). Mirror the CLI switch's shell fns; arg-name reads (id/status)
// copied from the old build's mcp/tool-call.ts scheduler arms.
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.create").mcp.handler = (args) => (0, registry_cli_1.scheduleCreateCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.list").mcp.handler = (args) => (0, registry_cli_1.scheduleListCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.due").mcp.handler = (args) => (0, registry_cli_1.scheduleDueCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.complete").mcp.handler = (args) => (0, registry_cli_1.scheduleCompleteCli)((0, io_1.required)((0, io_1.optionalArg)(args.id), "schedule id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.pause").mcp.handler = (args) => (0, registry_cli_1.schedulePauseCli)((0, io_1.required)((0, io_1.optionalArg)(args.id), "schedule id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.resume").mcp.handler = (args) => (0, registry_cli_1.scheduleResumeCli)((0, io_1.required)((0, io_1.optionalArg)(args.id), "schedule id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.run-now").mcp.handler = (args) => (0, registry_cli_1.scheduleRunNowCli)((0, io_1.required)((0, io_1.optionalArg)(args.id), "schedule id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.history").mcp.handler = (args) => (0, registry_cli_1.scheduleHistoryCli)((0, io_1.optionalArg)(args.id), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.delete").mcp.handler = (args) => (0, registry_cli_1.scheduleDeleteCli)((0, io_1.required)((0, io_1.optionalArg)(args.id), "schedule id"), args);
// Each `schedule <verb>` sub-action is its own two-token cli row (found
// before the ["schedule"] catch-all per the reversed candidate order), so
// each capability is a real both-surface dual-bound row. Same shell fns and
// [subcommand, id] positional mapping as the catch-all switch above.
// `hiddenFromHelp` keeps `cw help schedule`'s rows coming from the single
// literal COMMAND_HELP_ROWS.schedule block.
(0, registry_core_1.attachCliBinding)("schedule.create", { path: ["schedule", "create"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.scheduleCreateCli)(args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.list", { path: ["schedule", "list"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.scheduleListCli)(args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.delete", { path: ["schedule", "delete"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.scheduleDeleteCli)((0, io_1.required)(args.positionals[0], "schedule id"), args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.due", { path: ["schedule", "due"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.scheduleDueCli)(args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.complete", { path: ["schedule", "complete"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.scheduleCompleteCli)((0, io_1.required)(args.positionals[0], "schedule id"), args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.pause", { path: ["schedule", "pause"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.schedulePauseCli)((0, io_1.required)(args.positionals[0], "schedule id"), args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.resume", { path: ["schedule", "resume"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.scheduleResumeCli)((0, io_1.required)(args.positionals[0], "schedule id"), args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.run-now", { path: ["schedule", "run-now"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.scheduleRunNowCli)((0, io_1.required)(args.positionals[0], "schedule id"), args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.history", { path: ["schedule", "history"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.scheduleHistoryCli)(args.positionals[0], args.options) }) });
// ---- routine ------------------------------------------------------------
(0, registry_core_1.addCliOnlyCapability)("routine", "cw routine create|list|delete|fire|events — API/GitHub-style triggers.", {
    path: ["routine"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
        const [subcommand, idOrKind, payloadPath] = args.positionals;
        switch (subcommand) {
            case "create":
                return { json: (0, registry_cli_1.routineCreateCli)(args.options) };
            case "list":
                return { json: (0, registry_cli_1.routineListCli)(args.options) };
            case "delete":
                return { json: (0, registry_cli_1.routineDeleteCli)((0, io_1.required)(idOrKind, "trigger id"), args.options) };
            case "fire": {
                const kind = (0, io_1.required)(idOrKind, "trigger kind");
                const payload = (0, registry_cli_1.resolveRoutineFirePayload)(payloadPath, args.options);
                return { json: (0, registry_cli_1.routineFireCli)(kind, payload, args.options) };
            }
            case "events":
                return { json: (0, registry_cli_1.routineEventsCli)(idOrKind, args.options) };
            default:
                throw new Error("Usage: cw.js routine create|list|delete|fire|events");
        }
    },
}, "cw routine is the API/GitHub-style trigger bridge; SPEC/mcp.md declares its MCP peers per verb (cw_routine_*), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("routine.create").mcp.handler = (args) => (0, registry_cli_1.routineCreateCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("routine.list").mcp.handler = (args) => (0, registry_cli_1.routineListCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("routine.delete").mcp.handler = (args) => (0, registry_cli_1.routineDeleteCli)((0, io_1.required)((0, io_1.optionalArg)(args.id), "trigger id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("routine.fire").mcp.handler = (args) => (0, registry_cli_1.routineFireCli)((0, io_1.required)((0, io_1.optionalArg)(args.kind), "trigger kind"), args.payload, args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("routine.events").mcp.handler = (args) => (0, registry_cli_1.routineEventsCli)((0, io_1.optionalArg)(args.id), args);
// Each `routine <verb>` sub-action is its own two-token cli row. The
// catch-all read [subcommand, idOrKind, payloadPath], so after the
// dispatcher consumes the sub-verb positionals[0]=idOrKind,
// positionals[1]=payloadPath. `hiddenFromHelp` keeps `cw help routine`'s
// rows coming from the single literal COMMAND_HELP_ROWS.routine block.
(0, registry_core_1.attachCliBinding)("routine.create", { path: ["routine", "create"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.routineCreateCli)(args.options) }) });
(0, registry_core_1.attachCliBinding)("routine.list", { path: ["routine", "list"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.routineListCli)(args.options) }) });
(0, registry_core_1.attachCliBinding)("routine.delete", { path: ["routine", "delete"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.routineDeleteCli)((0, io_1.required)(args.positionals[0], "trigger id"), args.options) }) });
(0, registry_core_1.attachCliBinding)("routine.fire", {
    path: ["routine", "fire"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
        const kind = (0, io_1.required)(args.positionals[0], "trigger kind");
        const payloadPath = args.positionals[1];
        const payload = (0, registry_cli_1.resolveRoutineFirePayload)(payloadPath, args.options);
        return { json: (0, registry_cli_1.routineFireCli)(kind, payload, args.options) };
    },
});
(0, registry_core_1.attachCliBinding)("routine.events", { path: ["routine", "events"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, registry_cli_1.routineEventsCli)(args.positionals[0], args.options) }) });
// ---- sched (control-plane leases over the durable queue) ---------------
(0, registry_core_1.addCliOnlyCapability)("sched", "cw sched plan|lease|release|complete|reclaim|reset|policy [show|set] — control-plane lease scheduling over the durable queue.", {
    path: ["sched"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
        const [subcommand, idArg] = args.positionals;
        switch (subcommand) {
            case "plan":
                return { json: (0, scheduling_io_1.schedPlanCli)(args.options) };
            case "lease":
                return { json: (0, scheduling_io_1.schedLeaseCli)(args.options) };
            case "release":
                return { json: (0, scheduling_io_1.schedReleaseCli)(String(args.options.leaseId || idArg || ""), args.options) };
            case "complete":
                return { json: (0, scheduling_io_1.schedCompleteCli)(String(args.options.leaseId || idArg || ""), args.options) };
            case "reclaim":
                return { json: (0, scheduling_io_1.schedReclaimCli)(args.options) };
            case "reset":
                return { json: (0, scheduling_io_1.schedResetCli)(String(args.options.id || idArg || ""), args.options) };
            case "policy": {
                const action = args.positionals[1];
                if (action === "set")
                    return { json: (0, scheduling_io_1.schedPolicySetCli)(args.options) };
                return { json: (0, scheduling_io_1.schedPolicyShowCli)(args.options) };
            }
            default:
                throw new Error("Usage: cw.js sched plan|lease|release|complete|reclaim|reset|policy [show|set] [id] [--maxConcurrent N --maxAttempts N ...]");
        }
    },
}, "cw sched is the durable-queue lease scheduler; SPEC/mcp.md declares its MCP peers per verb (cw_sched_*), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.plan").mcp.handler = (args) => (0, scheduling_io_1.schedPlanCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.lease").mcp.handler = (args) => (0, scheduling_io_1.schedLeaseCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.release").mcp.handler = (args) => (0, scheduling_io_1.schedReleaseCli)(String(args.leaseId || ""), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.complete").mcp.handler = (args) => (0, scheduling_io_1.schedCompleteCli)(String(args.leaseId || ""), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.reclaim").mcp.handler = (args) => (0, scheduling_io_1.schedReclaimCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.reset").mcp.handler = (args) => (0, scheduling_io_1.schedResetCli)(String(args.id || ""), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.policy.show").mcp.handler = (args) => (0, scheduling_io_1.schedPolicyShowCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.policy.set").mcp.handler = (args) => (0, scheduling_io_1.schedPolicySetCli)(args);
// Each `sched <verb>` sub-action is its own two-token cli row. The
// catch-all read [subcommand, idArg]; after the dispatcher consumes the
// sub-verb, positionals[0]=idArg (release/complete read --leaseId or that
// positional; reset reads --id or that positional). `sched.policy.show`/
// `.set` share the ["sched","policy"] path with the [show|set] action read
// from the first positional (like blackboard.message.post/list).
// `hiddenFromHelp` keeps `cw help sched`'s rows coming from the single
// literal COMMAND_HELP_ROWS.sched block.
(0, registry_core_1.attachCliBinding)("sched.plan", { path: ["sched", "plan"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, scheduling_io_1.schedPlanCli)(args.options) }) });
(0, registry_core_1.attachCliBinding)("sched.lease", { path: ["sched", "lease"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, scheduling_io_1.schedLeaseCli)(args.options) }) });
(0, registry_core_1.attachCliBinding)("sched.release", { path: ["sched", "release"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, scheduling_io_1.schedReleaseCli)(String(args.options.leaseId || args.positionals[0] || ""), args.options) }) });
(0, registry_core_1.attachCliBinding)("sched.complete", { path: ["sched", "complete"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, scheduling_io_1.schedCompleteCli)(String(args.options.leaseId || args.positionals[0] || ""), args.options) }) });
(0, registry_core_1.attachCliBinding)("sched.reclaim", { path: ["sched", "reclaim"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, scheduling_io_1.schedReclaimCli)(args.options) }) });
(0, registry_core_1.attachCliBinding)("sched.reset", { path: ["sched", "reset"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: (0, scheduling_io_1.schedResetCli)(String(args.options.id || args.positionals[0] || ""), args.options) }) });
function schedPolicyHandler(args) {
    const action = args.positionals[0];
    if (action === "set")
        return { json: (0, scheduling_io_1.schedPolicySetCli)(args.options) };
    return { json: (0, scheduling_io_1.schedPolicyShowCli)(args.options) };
}
(0, registry_core_1.attachCliBinding)("sched.policy.show", { path: ["sched", "policy"], helpPath: ["sched", "policy"], jsonMode: "default", hiddenFromHelp: true, handler: schedPolicyHandler });
(0, registry_core_1.attachCliBinding)("sched.policy.set", { path: ["sched", "policy"], helpPath: ["sched", "policy"], jsonMode: "default", hiddenFromHelp: true, handler: schedPolicyHandler });
// ---- registry (refresh|show) --------------------------------------------
(0, registry_core_1.addCliOnlyCapability)("registry", "cw registry refresh|show [--scope repo|home] [--json] — the derived run registry index.", {
    path: ["registry"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const subcommand = firstPositionalArg(args);
        let report;
        if (subcommand === "refresh")
            report = (0, registry_cli_1.registryRefreshCli)(args.options);
        else if (subcommand === "show")
            report = (0, registry_cli_1.registryShowCli)(args.options);
        else
            throw new Error("Usage: cw.js registry refresh|show [--scope repo|home] [--json]");
        return { json: report, text: (0, run_registry_io_1.formatRegistryReport)(report) };
    },
}, "cw registry is the derived run-registry index; SPEC/mcp.md declares its MCP peers (cw_registry_refresh|show), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("registry.refresh").mcp.handler = (args) => (0, registry_cli_1.registryRefreshCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("registry.show").mcp.handler = (args) => (0, registry_cli_1.registryShowCli)(args);
// `registry.refresh`/`registry.show` each carry their own two-token
// cli.path (found before the ["registry"] catch-all). `hiddenFromHelp`
// keeps `cw help registry`'s rows coming from the single literal
// COMMAND_HELP_ROWS.registry block. Both are read/derive verbs, so they
// stay in the payload-identity probe (classified deferred until a
// bootstrap fixture seeds a registry index).
(0, registry_core_1.attachCliBinding)("registry.refresh", {
    path: ["registry", "refresh"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const report = (0, registry_cli_1.registryRefreshCli)(args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: report } : { json: report, text: (0, run_registry_io_1.formatRegistryReport)(report) };
    },
});
(0, registry_core_1.attachCliBinding)("registry.show", {
    path: ["registry", "show"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const report = (0, registry_cli_1.registryShowCli)(args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: report } : { json: report, text: (0, run_registry_io_1.formatRegistryReport)(report) };
    },
});
// ---- queue (add|list|drain|show) ----------------------------------------
(0, registry_core_1.addCliOnlyCapability)("queue", "cw queue add|list|drain|show [queue-id] [--repo PATH] [--priority N] — the durable run queue.", {
    path: ["queue"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const [subcommand, id] = args.positionals;
        switch (subcommand) {
            case "add":
                return { json: (0, registry_cli_1.queueAddCli)(args.options) };
            case "list": {
                const result = (0, registry_cli_1.queueListCli)(args.options);
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, run_registry_io_1.formatQueueList)(result) };
            }
            case "drain":
                return { json: (0, registry_cli_1.queueDrainCli)(args.options) };
            case "show":
                return { json: (0, registry_cli_1.queueShowCli)((0, io_1.required)(id, "queue id"), args.options) };
            default:
                throw new Error("Usage: cw.js queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]");
        }
    },
}, "cw queue is the durable run queue; SPEC/mcp.md declares its MCP peers (cw_queue_add|list|drain|show), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("queue.add").mcp.handler = (args) => (0, registry_cli_1.queueAddCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("queue.list").mcp.handler = (args) => (0, registry_cli_1.queueListCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("queue.drain").mcp.handler = (args) => (0, registry_cli_1.queueDrainCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("queue.show").mcp.handler = (args) => (0, registry_cli_1.queueShowCli)((0, io_1.required)((0, io_1.optionalArg)(args.id), "queue id"), args);
// `queue add|list|drain|show` each carry their own two-token cli.path
// (found before the ["queue"] catch-all). `hiddenFromHelp` keeps `cw help
// queue`'s rows coming from the single literal COMMAND_HELP_ROWS.queue
// block. `queue.list` is jsonMode "flag" (human table by default); the
// others are always-JSON "default", matching the old build's registry.
(0, registry_core_1.attachCliBinding)("queue.add", {
    path: ["queue", "add"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: (0, registry_cli_1.queueAddCli)(args.options) }),
});
(0, registry_core_1.attachCliBinding)("queue.list", {
    path: ["queue", "list"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = (0, registry_cli_1.queueListCli)(args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, run_registry_io_1.formatQueueList)(result) };
    },
});
(0, registry_core_1.attachCliBinding)("queue.drain", {
    path: ["queue", "drain"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: (0, registry_cli_1.queueDrainCli)(args.options) }),
});
(0, registry_core_1.attachCliBinding)("queue.show", {
    path: ["queue", "show"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: (0, registry_cli_1.queueShowCli)((0, io_1.required)(args.positionals[0], "queue id"), args.options) }),
});
// ---- gc (plan|run|verify) ------------------------------------------------
(0, registry_core_1.addCliOnlyCapability)("gc", "cw gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json] — run retention & provable reclamation.", {
    path: ["gc"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const [subcommand, id] = args.positionals;
        switch (subcommand) {
            case "plan": {
                const result = (0, registry_cli_1.gcPlanCli)(id, args.options);
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, reclamation_io_1.formatGcPlan)(result) };
            }
            case "run": {
                const result = (0, registry_cli_1.gcRunCli)(id, args.options);
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, reclamation_io_1.formatGcRun)(result) };
            }
            case "verify": {
                const result = (0, registry_cli_1.gcVerifyCli)((0, io_1.required)(id, "run id"), args.options);
                const text = (0, reclamation_io_1.formatGcVerify)(result);
                return { json: result, text, exitCode: result.reclaimed && !result.verified ? 1 : undefined };
            }
            default:
                throw new Error("Usage: cw.js gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json]");
        }
    },
}, "cw gc is run retention & provable reclamation; SPEC/mcp.md declares its MCP peers (cw_gc_plan|run|verify), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("gc.plan").mcp.handler = (args) => (0, registry_cli_1.gcPlanCli)((0, io_1.optionalArg)(args.runId), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("gc.run").mcp.handler = (args) => (0, registry_cli_1.gcRunCli)((0, io_1.optionalArg)(args.runId), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("gc.verify").mcp.handler = (args) => (0, registry_cli_1.gcVerifyCli)((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
// PARITY: `gc.run` frees disk and appends a tombstone; both surfaces run
// the identical transaction but the payload reports now-derived
// bytesFreed/tombstone, so it is a documented opt-out, not drift.
registry_core_1.REGISTRY_BY_CAPABILITY.get("gc.run").payloadIdentical = false;
registry_core_1.REGISTRY_BY_CAPABILITY.get("gc.run").reason =
    "Mutating: frees disk and appends a tombstone; both surfaces perform the identical transaction but the payload reports now-derived bytesFreed/tombstone.";
// PARITY: `gc.plan`/`gc.verify` now ALSO carry their own two-token
// cli.path ["gc","plan"]/["gc","verify"], same as the old build's
// registry rows and the same reversed-candidate-order pattern used for
// run.drive/run.search above: findCapabilityByCliPath tries the 2-token
// candidate before the 1-token ["gc"] catch-all row, so these rows — not
// the "gc" capability's combined switch — now serve `cw gc plan`/`cw gc
// verify`. Same functions, same output; only which row answers the
// dispatch changes, so both become real both-surface, dual-bound
// capabilities for the payload-identity probe. `gc.run` stays reachable
// only via the ["gc"] catch-all (it is a documented payload-probe
// opt-out above, so it does not need its own dual-bound row).
(0, registry_core_1.attachCliBinding)("gc.plan", {
    path: ["gc", "plan"],
    jsonMode: "flag",
    handler: (args) => {
        const result = (0, registry_cli_1.gcPlanCli)(args.positionals[0], args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, reclamation_io_1.formatGcPlan)(result) };
    },
});
(0, registry_core_1.attachCliBinding)("gc.verify", {
    path: ["gc", "verify"],
    jsonMode: "flag",
    handler: (args) => {
        const result = (0, registry_cli_1.gcVerifyCli)((0, io_1.required)(args.positionals[0], "run id"), args.options);
        const text = (0, reclamation_io_1.formatGcVerify)(result);
        return { json: result, text, exitCode: result.reclaimed && !result.verified ? 1 : undefined };
    },
});
// `gc.run` also carries its own two-token cli.path ["gc","run"], same
// reversed-candidate-order pattern as gc.plan/gc.verify. It stays a
// documented payload-probe opt-out (mutating reclamation), so this row
// only satisfies the both-surface "cli + mcp" pairing — it does not join
// the payload-identity probe. `hiddenFromHelp` keeps `cw help gc`'s row
// coming from the single literal COMMAND_HELP_ROWS.gc entry.
(0, registry_core_1.attachCliBinding)("gc.run", {
    path: ["gc", "run"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = (0, registry_cli_1.gcRunCli)(args.positionals[0], args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, reclamation_io_1.formatGcRun)(result) };
    },
});
// ---- orphans (list|gc) ---------------------------------------------------
(0, registry_core_1.addCliOnlyCapability)("orphans", "cw orphans list|gc — reclaim run directories a killed process never registered (no state.json).", {
    path: ["orphans"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const subcommand = firstPositionalArg(args);
        switch (subcommand) {
            case "list": {
                const result = (0, registry_cli_1.orphansListCli)(args.options);
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, reclamation_io_1.formatOrphanRunsList)(result) };
            }
            case "gc": {
                const result = (0, registry_cli_1.orphansGcCli)(args.options);
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, reclamation_io_1.formatOrphanRunsGc)(result) };
            }
            default:
                throw new Error("Usage: cw.js orphans list [--scope repo|home] [--json] | orphans gc [--scope repo|home] [--min-age-minutes N] [--all] [--json]  (scope defaults to home: every registered repo)");
        }
    },
}, "cw orphans reclaims killed-process run dirs with no state.json; SPEC/mcp.md declares its MCP peers (cw_orphans_list|gc), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("orphans.list").mcp.handler = (args) => (0, registry_cli_1.orphansListCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("orphans.gc").mcp.handler = (args) => (0, registry_cli_1.orphansGcCli)(args);
// `orphans.list`/`orphans.gc` each carry their own two-token cli.path
// (found before the ["orphans"] catch-all per the reversed-candidate
// order), so both are real both-surface dual-bound rows. `hiddenFromHelp`
// keeps `cw help orphans`'s rows coming from the single literal
// COMMAND_HELP_ROWS.orphans block. `orphans.gc` is a documented
// payload-probe opt-out (mutating sweep, now-derived freedBytes/removed),
// same as gc.run/clones.gc.
(0, registry_core_1.attachCliBinding)("orphans.list", {
    path: ["orphans", "list"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = (0, registry_cli_1.orphansListCli)(args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, reclamation_io_1.formatOrphanRunsList)(result) };
    },
});
(0, registry_core_1.attachCliBinding)("orphans.gc", {
    path: ["orphans", "gc"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = (0, registry_cli_1.orphansGcCli)(args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, reclamation_io_1.formatOrphanRunsGc)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("orphans.gc").payloadIdentical = false;
registry_core_1.REGISTRY_BY_CAPABILITY.get("orphans.gc").reason =
    "Mutating: removes orphan run directories and reports now-derived freedBytes/removed; both surfaces perform the identical sweep.";
// ---- clones (list|gc) ------------------------------------------------------
(0, registry_core_1.addCliOnlyCapability)("clones", "cw clones list|gc [--older-than-days N] [--all] — the cached remote-source checkout cache.", {
    path: ["clones"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const subcommand = firstPositionalArg(args);
        switch (subcommand) {
            case "list": {
                const result = (0, registry_cli_1.clonesListCli)();
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, reclamation_io_1.formatClonesList)(result) };
            }
            case "gc": {
                const result = (0, registry_cli_1.clonesGcCli)(args.options);
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, reclamation_io_1.formatClonesGc)(result) };
            }
            default:
                throw new Error("Usage: cw.js clones list [--json] | clones gc [--older-than-days N] [--all] [--json]");
        }
    },
}, "cw clones is the cached remote-source checkout cache; SPEC/mcp.md declares its MCP peers (cw_clones_list|gc), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("clones.list").mcp.handler = () => (0, registry_cli_1.clonesListCli)();
registry_core_1.REGISTRY_BY_CAPABILITY.get("clones.gc").mcp.handler = (args) => (0, registry_cli_1.clonesGcCli)(args);
// `clones.list`/`clones.gc` each carry their own two-token cli.path (found
// before the ["clones"] catch-all). `hiddenFromHelp` keeps the byte-pinned
// `cw help clones` fixture's rows coming from the single literal
// COMMAND_HELP_ROWS.clones block. `clones.gc` is a documented payload-probe
// opt-out (mutating sweep), same as gc.run/orphans.gc.
(0, registry_core_1.attachCliBinding)("clones.list", {
    path: ["clones", "list"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = (0, registry_cli_1.clonesListCli)();
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, reclamation_io_1.formatClonesList)(result) };
    },
});
(0, registry_core_1.attachCliBinding)("clones.gc", {
    path: ["clones", "gc"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = (0, registry_cli_1.clonesGcCli)(args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: (0, reclamation_io_1.formatClonesGc)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("clones.gc").payloadIdentical = false;
registry_core_1.REGISTRY_BY_CAPABILITY.get("clones.gc").reason =
    "Mutating: removes cache directories and reports now-derived freedBytes/removed; both surfaces perform the identical reclamation.";
// ---- run search|list|show|resume|archive|rerun (2-token rows, found
// BEFORE the 1-token run.drive.step row per dispatchTable's reversed
// candidate order — see that row's own comment for why the run-registry
// keyword guard set still lists these words) --------------------------
(0, registry_core_1.attachCliBinding)("run.search", {
    path: ["run", "search"],
    jsonMode: "flag",
    handler: (args) => {
        const result = (0, registry_cli_1.runSearchCli)(args.options);
        return { json: result, text: (0, run_registry_io_1.formatRunSearch)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.search").mcp.handler = (args) => (0, registry_cli_1.runSearchCli)(args);
(0, registry_core_1.attachCliBinding)("run.list", {
    path: ["run", "list"],
    jsonMode: "flag",
    handler: (args) => {
        const result = (0, registry_cli_1.runListCli)(args.options);
        return { json: result, text: (0, run_registry_io_1.formatRunSearch)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.list").mcp.handler = (args) => (0, registry_cli_1.runListCli)(args);
(0, registry_core_1.attachCliBinding)("run.show", {
    path: ["run", "show"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, io_1.required)(args.positionals[0], "run id");
        const result = (0, registry_cli_1.runShowCli)(runId, args.options);
        return { json: result, text: (0, run_registry_io_1.formatRunShow)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.show").mcp.handler = (args) => (0, registry_cli_1.runShowCli)((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("run.resume", {
    path: ["run", "resume"],
    jsonMode: "flag",
    handler: async (args) => {
        const runId = (0, io_1.required)(args.positionals[0], "run id");
        const result = await (0, registry_cli_1.runResumeCli)(runId, args.options);
        return { json: result, text: (0, run_registry_io_1.formatResume)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.resume").mcp.handler = (args) => (0, registry_cli_1.runResumeCli)((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("run.archive", {
    path: ["run", "archive"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, registry_cli_1.runArchiveCli)((0, io_1.optionalArg)(args.positionals[0]), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.archive").mcp.handler = (args) => (0, registry_cli_1.runArchiveCli)((0, io_1.optionalArg)(args.runId), args);
(0, registry_core_1.attachCliBinding)("run.rerun", {
    path: ["run", "rerun"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, registry_cli_1.runRerunCli)((0, io_1.required)(args.positionals[0], "run id"), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.rerun").mcp.handler = (args) => (0, registry_cli_1.runRerunCli)((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
// ---- history ---------------------------------------------------------
(0, registry_core_1.attachCliBinding)("history", {
    path: ["history"],
    jsonMode: "flag",
    handler: (args) => {
        const result = (0, registry_cli_1.historyCli)(args.options);
        return { json: result, text: (0, run_registry_io_1.formatHistory)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("history").mcp.handler = (args) => (0, registry_cli_1.historyCli)(args);
// ---------------------------------------------------------------------
