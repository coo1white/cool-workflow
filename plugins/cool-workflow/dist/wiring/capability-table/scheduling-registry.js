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
// This whole module is required unconditionally at CLI/MCP startup for
// EVERY command; loading these 4 shell modules lazily (only inside the
// handler that actually calls into them) keeps that load cost off every
// invocation that never touches schedule/routine/sched/registry/queue/
// gc/orphans/clones/run/history.
function loadRegistryCli() {
    return require("../../shell/registry-cli");
}
function loadReclamationIo() {
    return require("../../shell/reclamation-io");
}
function loadRunRegistryIo() {
    return require("../../shell/run-registry-io");
}
function loadSchedulingIo() {
    return require("../../shell/scheduling-io");
}
function firstPositionalArg(args, index = 0) {
    return args.positionals[index];
}
// ---- schedule (+ cw loop) ----------------------------------------------
(0, registry_core_1.addCliOnlyCapability)("loop", 'cw loop — sugar for "schedule create --kind loop".', {
    path: ["loop"],
    jsonMode: "default",
    handler: (args) => ({ json: loadRegistryCli().scheduleCreateCli({ ...args.options, kind: "loop" }) }),
}, "loop is CLI-only sugar over schedule.create; the old build never gave it an MCP tool of its own (SPEC/scheduling-registry.md section I).");
(0, registry_core_1.addCliOnlyCapability)("schedule", "cw schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon — the wall-clock scheduler.", {
    path: ["schedule"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
        const [subcommand, id] = args.positionals;
        const registryCli = loadRegistryCli();
        switch (subcommand) {
            case "create":
                return { json: registryCli.scheduleCreateCli(args.options) };
            case "list":
                return { json: registryCli.scheduleListCli(args.options) };
            case "delete":
                return { json: registryCli.scheduleDeleteCli((0, io_1.required)(id, "schedule id"), args.options) };
            case "due":
                return { json: registryCli.scheduleDueCli(args.options) };
            case "complete":
                return { json: registryCli.scheduleCompleteCli((0, io_1.required)(id, "schedule id"), args.options) };
            case "pause":
                return { json: registryCli.schedulePauseCli((0, io_1.required)(id, "schedule id"), args.options) };
            case "resume":
                return { json: registryCli.scheduleResumeCli((0, io_1.required)(id, "schedule id"), args.options) };
            case "run-now":
                return { json: registryCli.scheduleRunNowCli((0, io_1.required)(id, "schedule id"), args.options) };
            case "history":
                return { json: registryCli.scheduleHistoryCli(id, args.options) };
            case "daemon": {
                if (args.options.once)
                    return { json: registryCli.scheduleDaemonTickCli(args.options) };
                // Never returns (matches the old build's forever daemon loop);
                // the process stays alive via the DesktopSchedulerDaemon's own
                // setInterval, printing one tick line per interval.
                void registryCli.scheduleDaemonRunForever(args.options);
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
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.create").mcp.handler = (args) => loadRegistryCli().scheduleCreateCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.list").mcp.handler = (args) => loadRegistryCli().scheduleListCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.due").mcp.handler = (args) => loadRegistryCli().scheduleDueCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.complete").mcp.handler = (args) => loadRegistryCli().scheduleCompleteCli((0, io_1.required)((0, io_1.optionalArg)(args.id), "schedule id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.pause").mcp.handler = (args) => loadRegistryCli().schedulePauseCli((0, io_1.required)((0, io_1.optionalArg)(args.id), "schedule id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.resume").mcp.handler = (args) => loadRegistryCli().scheduleResumeCli((0, io_1.required)((0, io_1.optionalArg)(args.id), "schedule id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.run-now").mcp.handler = (args) => loadRegistryCli().scheduleRunNowCli((0, io_1.required)((0, io_1.optionalArg)(args.id), "schedule id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.history").mcp.handler = (args) => loadRegistryCli().scheduleHistoryCli((0, io_1.optionalArg)(args.id), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("schedule.delete").mcp.handler = (args) => loadRegistryCli().scheduleDeleteCli((0, io_1.required)((0, io_1.optionalArg)(args.id), "schedule id"), args);
// Each `schedule <verb>` sub-action is its own two-token cli row (found
// before the ["schedule"] catch-all per the reversed candidate order), so
// each capability is a real both-surface dual-bound row. Same shell fns and
// [subcommand, id] positional mapping as the catch-all switch above.
// `hiddenFromHelp` keeps `cw help schedule`'s rows coming from the single
// literal COMMAND_HELP_ROWS.schedule block.
(0, registry_core_1.attachCliBinding)("schedule.create", { path: ["schedule", "create"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().scheduleCreateCli(args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.list", { path: ["schedule", "list"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().scheduleListCli(args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.delete", { path: ["schedule", "delete"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().scheduleDeleteCli((0, io_1.required)(args.positionals[0], "schedule id"), args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.due", { path: ["schedule", "due"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().scheduleDueCli(args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.complete", { path: ["schedule", "complete"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().scheduleCompleteCli((0, io_1.required)(args.positionals[0], "schedule id"), args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.pause", { path: ["schedule", "pause"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().schedulePauseCli((0, io_1.required)(args.positionals[0], "schedule id"), args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.resume", { path: ["schedule", "resume"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().scheduleResumeCli((0, io_1.required)(args.positionals[0], "schedule id"), args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.run-now", { path: ["schedule", "run-now"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().scheduleRunNowCli((0, io_1.required)(args.positionals[0], "schedule id"), args.options) }) });
(0, registry_core_1.attachCliBinding)("schedule.history", { path: ["schedule", "history"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().scheduleHistoryCli(args.positionals[0], args.options) }) });
// ---- routine ------------------------------------------------------------
(0, registry_core_1.addCliOnlyCapability)("routine", "cw routine create|list|delete|fire|events — API/GitHub-style triggers.", {
    path: ["routine"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
        const [subcommand, idOrKind, payloadPath] = args.positionals;
        const registryCli = loadRegistryCli();
        switch (subcommand) {
            case "create":
                return { json: registryCli.routineCreateCli(args.options) };
            case "list":
                return { json: registryCli.routineListCli(args.options) };
            case "delete":
                return { json: registryCli.routineDeleteCli((0, io_1.required)(idOrKind, "trigger id"), args.options) };
            case "fire": {
                const kind = (0, io_1.required)(idOrKind, "trigger kind");
                const payload = registryCli.resolveRoutineFirePayload(payloadPath, args.options);
                return { json: registryCli.routineFireCli(kind, payload, args.options) };
            }
            case "events":
                return { json: registryCli.routineEventsCli(idOrKind, args.options) };
            default:
                throw new Error("Usage: cw.js routine create|list|delete|fire|events");
        }
    },
}, "cw routine is the API/GitHub-style trigger bridge; SPEC/mcp.md declares its MCP peers per verb (cw_routine_*), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("routine.create").mcp.handler = (args) => loadRegistryCli().routineCreateCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("routine.list").mcp.handler = (args) => loadRegistryCli().routineListCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("routine.delete").mcp.handler = (args) => loadRegistryCli().routineDeleteCli((0, io_1.required)((0, io_1.optionalArg)(args.id), "trigger id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("routine.fire").mcp.handler = (args) => loadRegistryCli().routineFireCli((0, io_1.required)((0, io_1.optionalArg)(args.kind), "trigger kind"), args.payload, args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("routine.events").mcp.handler = (args) => loadRegistryCli().routineEventsCli((0, io_1.optionalArg)(args.id), args);
// Each `routine <verb>` sub-action is its own two-token cli row. The
// catch-all read [subcommand, idOrKind, payloadPath], so after the
// dispatcher consumes the sub-verb positionals[0]=idOrKind,
// positionals[1]=payloadPath. `hiddenFromHelp` keeps `cw help routine`'s
// rows coming from the single literal COMMAND_HELP_ROWS.routine block.
(0, registry_core_1.attachCliBinding)("routine.create", { path: ["routine", "create"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().routineCreateCli(args.options) }) });
(0, registry_core_1.attachCliBinding)("routine.list", { path: ["routine", "list"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().routineListCli(args.options) }) });
(0, registry_core_1.attachCliBinding)("routine.delete", { path: ["routine", "delete"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().routineDeleteCli((0, io_1.required)(args.positionals[0], "trigger id"), args.options) }) });
(0, registry_core_1.attachCliBinding)("routine.fire", {
    path: ["routine", "fire"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
        const kind = (0, io_1.required)(args.positionals[0], "trigger kind");
        const payloadPath = args.positionals[1];
        const registryCli = loadRegistryCli();
        const payload = registryCli.resolveRoutineFirePayload(payloadPath, args.options);
        return { json: registryCli.routineFireCli(kind, payload, args.options) };
    },
});
(0, registry_core_1.attachCliBinding)("routine.events", { path: ["routine", "events"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadRegistryCli().routineEventsCli(args.positionals[0], args.options) }) });
// ---- sched (control-plane leases over the durable queue) ---------------
(0, registry_core_1.addCliOnlyCapability)("sched", "cw sched plan|lease|release|complete|reclaim|reset|policy [show|set] — control-plane lease scheduling over the durable queue.", {
    path: ["sched"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
        const [subcommand, idArg] = args.positionals;
        const schedulingIo = loadSchedulingIo();
        switch (subcommand) {
            case "plan":
                return { json: schedulingIo.schedPlanCli(args.options) };
            case "lease":
                return { json: schedulingIo.schedLeaseCli(args.options) };
            case "release":
                return { json: schedulingIo.schedReleaseCli(String(args.options.leaseId || idArg || ""), args.options) };
            case "complete":
                return { json: schedulingIo.schedCompleteCli(String(args.options.leaseId || idArg || ""), args.options) };
            case "reclaim":
                return { json: schedulingIo.schedReclaimCli(args.options) };
            case "reset":
                return { json: schedulingIo.schedResetCli(String(args.options.id || idArg || ""), args.options) };
            case "policy": {
                const action = args.positionals[1];
                if (action === "set")
                    return { json: schedulingIo.schedPolicySetCli(args.options) };
                return { json: schedulingIo.schedPolicyShowCli(args.options) };
            }
            default:
                throw new Error("Usage: cw.js sched plan|lease|release|complete|reclaim|reset|policy [show|set] [id] [--maxConcurrent N --maxAttempts N ...]");
        }
    },
}, "cw sched is the durable-queue lease scheduler; SPEC/mcp.md declares its MCP peers per verb (cw_sched_*), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.plan").mcp.handler = (args) => loadSchedulingIo().schedPlanCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.lease").mcp.handler = (args) => loadSchedulingIo().schedLeaseCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.release").mcp.handler = (args) => loadSchedulingIo().schedReleaseCli(String(args.leaseId || ""), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.complete").mcp.handler = (args) => loadSchedulingIo().schedCompleteCli(String(args.leaseId || ""), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.reclaim").mcp.handler = (args) => loadSchedulingIo().schedReclaimCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.reset").mcp.handler = (args) => loadSchedulingIo().schedResetCli(String(args.id || ""), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.policy.show").mcp.handler = (args) => loadSchedulingIo().schedPolicyShowCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sched.policy.set").mcp.handler = (args) => loadSchedulingIo().schedPolicySetCli(args);
// Each `sched <verb>` sub-action is its own two-token cli row. The
// catch-all read [subcommand, idArg]; after the dispatcher consumes the
// sub-verb, positionals[0]=idArg (release/complete read --leaseId or that
// positional; reset reads --id or that positional). `sched.policy.show`/
// `.set` share the ["sched","policy"] path with the [show|set] action read
// from the first positional (like blackboard.message.post/list).
// `hiddenFromHelp` keeps `cw help sched`'s rows coming from the single
// literal COMMAND_HELP_ROWS.sched block.
(0, registry_core_1.attachCliBinding)("sched.plan", { path: ["sched", "plan"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadSchedulingIo().schedPlanCli(args.options) }) });
(0, registry_core_1.attachCliBinding)("sched.lease", { path: ["sched", "lease"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadSchedulingIo().schedLeaseCli(args.options) }) });
(0, registry_core_1.attachCliBinding)("sched.release", { path: ["sched", "release"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadSchedulingIo().schedReleaseCli(String(args.options.leaseId || args.positionals[0] || ""), args.options) }) });
(0, registry_core_1.attachCliBinding)("sched.complete", { path: ["sched", "complete"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadSchedulingIo().schedCompleteCli(String(args.options.leaseId || args.positionals[0] || ""), args.options) }) });
(0, registry_core_1.attachCliBinding)("sched.reclaim", { path: ["sched", "reclaim"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadSchedulingIo().schedReclaimCli(args.options) }) });
(0, registry_core_1.attachCliBinding)("sched.reset", { path: ["sched", "reset"], jsonMode: "default", hiddenFromHelp: true, handler: (args) => ({ json: loadSchedulingIo().schedResetCli(String(args.options.id || args.positionals[0] || ""), args.options) }) });
function schedPolicyHandler(args) {
    const action = args.positionals[0];
    const schedulingIo = loadSchedulingIo();
    if (action === "set")
        return { json: schedulingIo.schedPolicySetCli(args.options) };
    return { json: schedulingIo.schedPolicyShowCli(args.options) };
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
        const registryCli = loadRegistryCli();
        let report;
        if (subcommand === "refresh")
            report = registryCli.registryRefreshCli(args.options);
        else if (subcommand === "show")
            report = registryCli.registryShowCli(args.options);
        else
            throw new Error("Usage: cw.js registry refresh|show [--scope repo|home] [--json]");
        return { json: report, text: loadRunRegistryIo().formatRegistryReport(report) };
    },
}, "cw registry is the derived run-registry index; SPEC/mcp.md declares its MCP peers (cw_registry_refresh|show), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("registry.refresh").mcp.handler = (args) => loadRegistryCli().registryRefreshCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("registry.show").mcp.handler = (args) => loadRegistryCli().registryShowCli(args);
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
        const report = loadRegistryCli().registryRefreshCli(args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: report } : { json: report, text: loadRunRegistryIo().formatRegistryReport(report) };
    },
});
(0, registry_core_1.attachCliBinding)("registry.show", {
    path: ["registry", "show"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const report = loadRegistryCli().registryShowCli(args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: report } : { json: report, text: loadRunRegistryIo().formatRegistryReport(report) };
    },
});
// ---- queue (add|list|drain|show) ----------------------------------------
(0, registry_core_1.addCliOnlyCapability)("queue", "cw queue add|list|drain|show [queue-id] [--repo PATH] [--priority N] — the durable run queue.", {
    path: ["queue"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const [subcommand, id] = args.positionals;
        const registryCli = loadRegistryCli();
        switch (subcommand) {
            case "add":
                return { json: registryCli.queueAddCli(args.options) };
            case "list": {
                const result = registryCli.queueListCli(args.options);
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: loadRunRegistryIo().formatQueueList(result) };
            }
            case "drain":
                return { json: registryCli.queueDrainCli(args.options) };
            case "show":
                return { json: registryCli.queueShowCli((0, io_1.required)(id, "queue id"), args.options) };
            default:
                throw new Error("Usage: cw.js queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]");
        }
    },
}, "cw queue is the durable run queue; SPEC/mcp.md declares its MCP peers (cw_queue_add|list|drain|show), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("queue.add").mcp.handler = (args) => loadRegistryCli().queueAddCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("queue.list").mcp.handler = (args) => loadRegistryCli().queueListCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("queue.drain").mcp.handler = (args) => loadRegistryCli().queueDrainCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("queue.show").mcp.handler = (args) => loadRegistryCli().queueShowCli((0, io_1.required)((0, io_1.optionalArg)(args.id), "queue id"), args);
// `queue add|list|drain|show` each carry their own two-token cli.path
// (found before the ["queue"] catch-all). `hiddenFromHelp` keeps `cw help
// queue`'s rows coming from the single literal COMMAND_HELP_ROWS.queue
// block. `queue.list` is jsonMode "flag" (human table by default); the
// others are always-JSON "default", matching the old build's registry.
(0, registry_core_1.attachCliBinding)("queue.add", {
    path: ["queue", "add"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: loadRegistryCli().queueAddCli(args.options) }),
});
(0, registry_core_1.attachCliBinding)("queue.list", {
    path: ["queue", "list"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = loadRegistryCli().queueListCli(args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: loadRunRegistryIo().formatQueueList(result) };
    },
});
(0, registry_core_1.attachCliBinding)("queue.drain", {
    path: ["queue", "drain"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: loadRegistryCli().queueDrainCli(args.options) }),
});
(0, registry_core_1.attachCliBinding)("queue.show", {
    path: ["queue", "show"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: loadRegistryCli().queueShowCli((0, io_1.required)(args.positionals[0], "queue id"), args.options) }),
});
// ---- gc (plan|run|verify) ------------------------------------------------
(0, registry_core_1.addCliOnlyCapability)("gc", "cw gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json] — run retention & provable reclamation.", {
    path: ["gc"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const [subcommand, id] = args.positionals;
        const registryCli = loadRegistryCli();
        const reclamationIo = loadReclamationIo();
        switch (subcommand) {
            case "plan": {
                const result = registryCli.gcPlanCli(id, args.options);
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: reclamationIo.formatGcPlan(result) };
            }
            case "run": {
                const result = registryCli.gcRunCli(id, args.options);
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: reclamationIo.formatGcRun(result) };
            }
            case "verify": {
                const result = registryCli.gcVerifyCli((0, io_1.required)(id, "run id"), args.options);
                const text = reclamationIo.formatGcVerify(result);
                return { json: result, text, exitCode: result.reclaimed && !result.verified ? 1 : undefined };
            }
            default:
                throw new Error("Usage: cw.js gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json]");
        }
    },
}, "cw gc is run retention & provable reclamation; SPEC/mcp.md declares its MCP peers (cw_gc_plan|run|verify), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("gc.plan").mcp.handler = (args) => loadRegistryCli().gcPlanCli((0, io_1.optionalArg)(args.runId), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("gc.run").mcp.handler = (args) => loadRegistryCli().gcRunCli((0, io_1.optionalArg)(args.runId), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("gc.verify").mcp.handler = (args) => loadRegistryCli().gcVerifyCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
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
        const result = loadRegistryCli().gcPlanCli(args.positionals[0], args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: loadReclamationIo().formatGcPlan(result) };
    },
});
(0, registry_core_1.attachCliBinding)("gc.verify", {
    path: ["gc", "verify"],
    jsonMode: "flag",
    handler: (args) => {
        const result = loadRegistryCli().gcVerifyCli((0, io_1.required)(args.positionals[0], "run id"), args.options);
        const text = loadReclamationIo().formatGcVerify(result);
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
        const result = loadRegistryCli().gcRunCli(args.positionals[0], args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: loadReclamationIo().formatGcRun(result) };
    },
});
// ---- orphans (list|gc) ---------------------------------------------------
(0, registry_core_1.addCliOnlyCapability)("orphans", "cw orphans list|gc — reclaim run directories a killed process never registered (no state.json).", {
    path: ["orphans"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const subcommand = firstPositionalArg(args);
        const registryCli = loadRegistryCli();
        const reclamationIo = loadReclamationIo();
        switch (subcommand) {
            case "list": {
                const result = registryCli.orphansListCli(args.options);
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: reclamationIo.formatOrphanRunsList(result) };
            }
            case "gc": {
                const result = registryCli.orphansGcCli(args.options);
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: reclamationIo.formatOrphanRunsGc(result) };
            }
            default:
                throw new Error("Usage: cw.js orphans list [--scope repo|home] [--json] | orphans gc [--scope repo|home] [--min-age-minutes N] [--all] [--json]  (scope defaults to home: every registered repo)");
        }
    },
}, "cw orphans reclaims killed-process run dirs with no state.json; SPEC/mcp.md declares its MCP peers (cw_orphans_list|gc), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("orphans.list").mcp.handler = (args) => loadRegistryCli().orphansListCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("orphans.gc").mcp.handler = (args) => loadRegistryCli().orphansGcCli(args);
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
        const result = loadRegistryCli().orphansListCli(args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: loadReclamationIo().formatOrphanRunsList(result) };
    },
});
(0, registry_core_1.attachCliBinding)("orphans.gc", {
    path: ["orphans", "gc"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = loadRegistryCli().orphansGcCli(args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: loadReclamationIo().formatOrphanRunsGc(result) };
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
        const registryCli = loadRegistryCli();
        const reclamationIo = loadReclamationIo();
        switch (subcommand) {
            case "list": {
                const result = registryCli.clonesListCli();
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: reclamationIo.formatClonesList(result) };
            }
            case "gc": {
                const result = registryCli.clonesGcCli(args.options);
                return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: reclamationIo.formatClonesGc(result) };
            }
            default:
                throw new Error("Usage: cw.js clones list [--json] | clones gc [--older-than-days N] [--all] [--json]");
        }
    },
}, "cw clones is the cached remote-source checkout cache; SPEC/mcp.md declares its MCP peers (cw_clones_list|gc), each wired below.");
registry_core_1.REGISTRY_BY_CAPABILITY.get("clones.list").mcp.handler = () => loadRegistryCli().clonesListCli();
registry_core_1.REGISTRY_BY_CAPABILITY.get("clones.gc").mcp.handler = (args) => loadRegistryCli().clonesGcCli(args);
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
        const result = loadRegistryCli().clonesListCli();
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: loadReclamationIo().formatClonesList(result) };
    },
});
(0, registry_core_1.attachCliBinding)("clones.gc", {
    path: ["clones", "gc"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = loadRegistryCli().clonesGcCli(args.options);
        return (0, io_1.wantsJson)(args.options) ? { json: result } : { json: result, text: loadReclamationIo().formatClonesGc(result) };
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
        const result = loadRegistryCli().runSearchCli(args.options);
        return { json: result, text: loadRunRegistryIo().formatRunSearch(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.search").mcp.handler = (args) => loadRegistryCli().runSearchCli(args);
(0, registry_core_1.attachCliBinding)("run.list", {
    path: ["run", "list"],
    jsonMode: "flag",
    handler: (args) => {
        const result = loadRegistryCli().runListCli(args.options);
        return { json: result, text: loadRunRegistryIo().formatRunSearch(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.list").mcp.handler = (args) => loadRegistryCli().runListCli(args);
(0, registry_core_1.attachCliBinding)("run.show", {
    path: ["run", "show"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, io_1.required)(args.positionals[0], "run id");
        const result = loadRegistryCli().runShowCli(runId, args.options);
        return { json: result, text: loadRunRegistryIo().formatRunShow(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.show").mcp.handler = (args) => loadRegistryCli().runShowCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("run.resume", {
    path: ["run", "resume"],
    jsonMode: "flag",
    handler: async (args) => {
        const runId = (0, io_1.required)(args.positionals[0], "run id");
        const runRegistryIo = loadRunRegistryIo();
        const result = await loadRegistryCli().runResumeCli(runId, args.options);
        return { json: result, text: runRegistryIo.formatResume(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.resume").mcp.handler = (args) => loadRegistryCli().runResumeCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("run.archive", {
    path: ["run", "archive"],
    jsonMode: "default",
    handler: (args) => ({ json: loadRegistryCli().runArchiveCli((0, io_1.optionalArg)(args.positionals[0]), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.archive").mcp.handler = (args) => loadRegistryCli().runArchiveCli((0, io_1.optionalArg)(args.runId), args);
(0, registry_core_1.attachCliBinding)("run.rerun", {
    path: ["run", "rerun"],
    jsonMode: "default",
    handler: (args) => ({ json: loadRegistryCli().runRerunCli((0, io_1.required)(args.positionals[0], "run id"), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.rerun").mcp.handler = (args) => loadRegistryCli().runRerunCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
// ---- history ---------------------------------------------------------
(0, registry_core_1.attachCliBinding)("history", {
    path: ["history"],
    jsonMode: "flag",
    handler: (args) => {
        const result = loadRegistryCli().historyCli(args.options);
        return { json: result, text: loadRunRegistryIo().formatHistory(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("history").mcp.handler = (args) => loadRegistryCli().historyCli(args);
// ---------------------------------------------------------------------
