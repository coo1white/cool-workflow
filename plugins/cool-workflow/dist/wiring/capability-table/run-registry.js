// wiring/capability-table/run-registry.ts — CLI bindings for the run
// registry: registry refresh|show, queue add|list|drain|show, run
// search|list|show|resume|archive|rerun|link, history.
import { attachCliBinding, addCliOnlyCapability, REGISTRY_BY_CAPABILITY } from "./registry-core.js";
import { required, optionalArg, wantsJson } from "../../core/util/cli-args.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Handler BODIES live in shell/commands/registry-cli.ts and
// shell/run-registry-io.ts (impure — disk-scanning IO); this table only
// wires argv shape -> handler call, per cli/dispatch.ts's generic
// executor contract. Usage-error strings are byte-pinned.
// ---------------------------------------------------------------------
// This whole module is required unconditionally at CLI/MCP startup for
// EVERY command; loading the shell modules lazily (only inside the
// handler that actually calls into them) keeps that load cost off every
// invocation that never touches registry/queue/run/history.
function loadRegistryCli() {
    return require("../../shell/commands/registry-cli.js");
}
function loadRunRegistryIo() {
    return require("../../shell/run-registry-io.js");
}
function firstPositionalArg(args, index = 0) {
    return args.positionals[index];
}
// ---- registry (refresh|show) --------------------------------------------
addCliOnlyCapability("registry", "cw registry refresh|show [--scope repo|home] [--json] — the derived run registry index.", {
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
            throw new Error("Usage: cw registry refresh|show [--scope repo|home] [--json]");
        return { json: report, text: loadRunRegistryIo().formatRegistryReport(report) };
    },
}, "cw registry is the derived run-registry index; SPEC/mcp.md declares its MCP peers (cw_registry_refresh|show), each wired below.");
REGISTRY_BY_CAPABILITY.get("registry.refresh").mcp.handler = (args) => loadRegistryCli().registryRefreshCli(args);
REGISTRY_BY_CAPABILITY.get("registry.show").mcp.handler = (args) => loadRegistryCli().registryShowCli(args);
// `registry.refresh`/`registry.show` each carry their own two-token
// cli.path (found before the ["registry"] catch-all). `hiddenFromHelp`
// keeps `cw help registry`'s rows coming from the single literal
// COMMAND_HELP_ROWS.registry block. Both are read/derive verbs, so they
// stay in the payload-identity probe (classified deferred until a
// bootstrap fixture seeds a registry index).
attachCliBinding("registry.refresh", {
    path: ["registry", "refresh"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const report = loadRegistryCli().registryRefreshCli(args.options);
        return wantsJson(args.options) ? { json: report } : { json: report, text: loadRunRegistryIo().formatRegistryReport(report) };
    },
});
attachCliBinding("registry.show", {
    path: ["registry", "show"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const report = loadRegistryCli().registryShowCli(args.options);
        return wantsJson(args.options) ? { json: report } : { json: report, text: loadRunRegistryIo().formatRegistryReport(report) };
    },
});
// ---- queue (add|list|drain|show) ----------------------------------------
addCliOnlyCapability("queue", "cw queue add|list|drain|show [queue-id] [--repo PATH] [--priority N] — the durable run queue.", {
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
                return wantsJson(args.options) ? { json: result } : { json: result, text: loadRunRegistryIo().formatQueueList(result) };
            }
            case "drain":
                return { json: registryCli.queueDrainCli(args.options) };
            case "show":
                return { json: registryCli.queueShowCli(required(id, "queue id"), args.options) };
            default:
                throw new Error("Usage: cw queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]");
        }
    },
}, "cw queue is the durable run queue; SPEC/mcp.md declares its MCP peers (cw_queue_add|list|drain|show), each wired below.");
REGISTRY_BY_CAPABILITY.get("queue.add").mcp.handler = (args) => loadRegistryCli().queueAddCli(args);
REGISTRY_BY_CAPABILITY.get("queue.list").mcp.handler = (args) => loadRegistryCli().queueListCli(args);
REGISTRY_BY_CAPABILITY.get("queue.drain").mcp.handler = (args) => loadRegistryCli().queueDrainCli(args);
REGISTRY_BY_CAPABILITY.get("queue.show").mcp.handler = (args) => loadRegistryCli().queueShowCli(required(optionalArg(args.id), "queue id"), args);
// `queue add|list|drain|show` each carry their own two-token cli.path
// (found before the ["queue"] catch-all). `hiddenFromHelp` keeps `cw help
// queue`'s rows coming from the single literal COMMAND_HELP_ROWS.queue
// block. `queue.list` is jsonMode "flag" (human table by default); the
// others are always-JSON "default".
attachCliBinding("queue.add", {
    path: ["queue", "add"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: loadRegistryCli().queueAddCli(args.options) }),
});
attachCliBinding("queue.list", {
    path: ["queue", "list"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = loadRegistryCli().queueListCli(args.options);
        return wantsJson(args.options) ? { json: result } : { json: result, text: loadRunRegistryIo().formatQueueList(result) };
    },
});
attachCliBinding("queue.drain", {
    path: ["queue", "drain"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: loadRegistryCli().queueDrainCli(args.options) }),
});
attachCliBinding("queue.show", {
    path: ["queue", "show"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: loadRegistryCli().queueShowCli(required(args.positionals[0], "queue id"), args.options) }),
});
// ---- run search|list|show|resume|archive|rerun (2-token rows, found
// BEFORE the 1-token run.drive.step row per dispatchTable's reversed
// candidate order — see that row's own comment for why the run-registry
// keyword guard set still lists these words) --------------------------
attachCliBinding("run.search", {
    path: ["run", "search"],
    jsonMode: "flag",
    handler: (args) => {
        const result = loadRegistryCli().runSearchCli(args.options);
        return { json: result, text: loadRunRegistryIo().formatRunSearch(result) };
    },
});
REGISTRY_BY_CAPABILITY.get("run.search").mcp.handler = (args) => loadRegistryCli().runSearchCli(args);
attachCliBinding("run.list", {
    path: ["run", "list"],
    jsonMode: "flag",
    handler: (args) => {
        const result = loadRegistryCli().runListCli(args.options);
        return { json: result, text: loadRunRegistryIo().formatRunSearch(result) };
    },
});
REGISTRY_BY_CAPABILITY.get("run.list").mcp.handler = (args) => loadRegistryCli().runListCli(args);
attachCliBinding("run.show", {
    path: ["run", "show"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = required(args.positionals[0], "run id");
        const result = loadRegistryCli().runShowCli(runId, args.options);
        return { json: result, text: loadRunRegistryIo().formatRunShow(result) };
    },
});
REGISTRY_BY_CAPABILITY.get("run.show").mcp.handler = (args) => loadRegistryCli().runShowCli(required(optionalArg(args.runId), "run id"), args);
attachCliBinding("run.resume", {
    path: ["run", "resume"],
    jsonMode: "flag",
    handler: async (args) => {
        const runId = required(args.positionals[0], "run id");
        const runRegistryIo = loadRunRegistryIo();
        const result = await loadRegistryCli().runResumeCli(runId, args.options);
        return { json: result, text: runRegistryIo.formatResume(result) };
    },
});
REGISTRY_BY_CAPABILITY.get("run.resume").mcp.handler = (args) => loadRegistryCli().runResumeCli(required(optionalArg(args.runId), "run id"), args);
attachCliBinding("run.archive", {
    path: ["run", "archive"],
    jsonMode: "default",
    handler: (args) => ({ json: loadRegistryCli().runArchiveCli(optionalArg(args.positionals[0]), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("run.archive").mcp.handler = (args) => loadRegistryCli().runArchiveCli(optionalArg(args.runId), args);
attachCliBinding("run.rerun", {
    path: ["run", "rerun"],
    jsonMode: "default",
    handler: (args) => ({ json: loadRegistryCli().runRerunCli(required(args.positionals[0], "run id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("run.rerun").mcp.handler = (args) => loadRegistryCli().runRerunCli(required(optionalArg(args.runId), "run id"), args);
// `run link <run-id> --url <url> [--kind pr|issue|ticket] [--note TEXT]`
// (run <-> PR linkage): records one append-only link annotation on
// the run record. No network call — it only writes a link, it never
// calls out to a forge. `hiddenFromHelp` keeps the byte-pinned `cw help
// run` fixture unchanged (same reason run.export/import/... hide, per
// that block's own comment above): the command is real and documented in
// docs/run-registry-control-plane.7.md, it just does not add a new row
// to that one byte-pinned help page.
attachCliBinding("run.link", {
    path: ["run", "link"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: loadRegistryCli().runLinkCli(required(args.positionals[0], "run id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("run.link").mcp.handler = (args) => loadRegistryCli().runLinkCli(required(optionalArg(args.runId), "run id"), args);
// ---- history ---------------------------------------------------------
attachCliBinding("history", {
    path: ["history"],
    jsonMode: "flag",
    handler: (args) => {
        const result = loadRegistryCli().historyCli(args.options);
        return { json: result, text: loadRunRegistryIo().formatHistory(result) };
    },
});
REGISTRY_BY_CAPABILITY.get("history").mcp.handler = (args) => loadRegistryCli().historyCli(args);
// ---------------------------------------------------------------------
