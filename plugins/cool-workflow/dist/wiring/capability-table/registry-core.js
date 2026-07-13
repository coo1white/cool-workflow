"use strict";
// wiring/capability-table/registry-core.ts — the shared machinery every
// domain slice registers into: REGISTRY, REGISTRY_BY_CAPABILITY,
// attachCliBinding, addCliOnlyCapability, and the read-only query
// functions (findCapability*, cliCapabilities, mcpToolDefinitions,
// declaredMcpTools). Also owns the small set of capability BODIES that
// must be in scope when MCP_TOOL_DATA.map() builds REGISTRY at module
// load (MCP_REAL_HANDLERS below) — kept here, not in a domain slice, to
// avoid a circular import (a slice needing attachCliBinding from this
// file, while this file would need a handler body FROM that slice).
//
// No slice file imports another slice file; every slice imports ONLY
// from this file, core/capability-data.ts, and shell/core as needed.
// index.ts imports this file plus every slice and composes them in the
// exact original source order (REGISTRY order is a pinned behavior —
// tools/list order, gen-parity-doc's byte-diff gate, cw help line order).
//
// Split out of core/capability-table.ts's "Public table-derived API"
// section, byte-for-byte (this file's body is the ORIGINAL file's own
// text, extracted with sed line ranges, not retyped).
Object.defineProperty(exports, "__esModule", { value: true });
exports.REGISTRY_BY_CAPABILITY = exports.REGISTRY = void 0;
exports.listBundledWorkflows = listBundledWorkflows;
exports.listBundledSandboxProfiles = listBundledSandboxProfiles;
exports.statusPayload = statusPayload;
exports.attachCliBinding = attachCliBinding;
exports.addCliOnlyCapability = addCliOnlyCapability;
exports.findCapability = findCapability;
exports.findCapabilityByCliPath = findCapabilityByCliPath;
exports.cliCapabilities = cliCapabilities;
exports.mcpToolDefinitions = mcpToolDefinitions;
exports.declaredMcpTools = declaredMcpTools;
exports.findCapabilityByMcpTool = findCapabilityByMcpTool;
const capability_data_1 = require("../../core/capability-data");
const cli_args_1 = require("../../core/util/cli-args");
// Every capability-table module (this file plus each domain slice) is
// required unconditionally at CLI/MCP startup, for every single command
// (index.ts's whole point is to populate REGISTRY before dispatch can
// look anything up) — so a top-level `import` of a shell module here
// means EVERY invocation pays that module's full load cost, even the
// 99% of commands that never touch `status`/`summary.refresh`/`list`.
// Requiring these 4 lazily (inside the handler that actually uses them)
// measured live: this file alone was ~30-45ms of a ~75-100ms `cw --version`
// require chain, the single largest slice. The 8 domain slices have the
// same shape and are a natural follow-up, not attempted here.
function loadRunStore() {
    return require("../../shell/run-store");
}
function loadOperatorUx() {
    return require("../../shell/operator-ux");
}
function loadWorkflowAppLoader() {
    return require("../../shell/workflow-app-loader");
}
function loadStateExplosionCli() {
    return require("../../shell/state-explosion-cli");
}
/** Real handlers implemented at THIS milestone, keyed by capability id.
 *  Every tool row not listed here gets `notYetImplemented`. Kept as a
 *  small side table (rather than inlined into MCP_TOOL_DATA above) so the
 *  196-row literal above stays a pure, mechanically-checkable transcript
 *  of the spec table — handler wiring is a separate, obviously-later-
 *  editable concern. */
const MCP_REAL_HANDLERS = {
    list: () => listBundledWorkflows(),
    "sandbox.list": () => listBundledSandboxProfiles(),
    status: (args) => statusPayload(optionalString(args.runId)),
    "summary.refresh": (args) => loadStateExplosionCli().summaryRefreshCli((0, cli_args_1.required)(optionalString(args.runId), "run id"), args),
    "summary.show": (args) => loadStateExplosionCli().summaryShowCli((0, cli_args_1.required)(optionalString(args.runId), "run id"), args),
};
function optionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
/** `cw list` / `cw_list` (MILESTONE 12) — the real discovery over every
 *  `apps/*\/app.json` + legacy `workflows/*.workflow.js` on disk, per
 *  `listWorkflowsShallow` (shell/workflow-app-loader.ts). */
function listBundledWorkflows() {
    return loadWorkflowAppLoader().listWorkflowsShallow();
}
/** PLACEHOLDER (milestone 5, execution-backend/sandbox) — the real
 *  `sandbox.list` resolves and stamps each of the 4 bundled profiles
 *  (default/readonly/workspace-write/locked-down) with real path lists
 *  via `resolveSandboxProfile` (SPEC/execution-backend.md). This
 *  milestone reproduces only the id/title/schemaVersion subset that
 *  mcp-basic.case.js checks. */
function listBundledSandboxProfiles() {
    return [
        { schemaVersion: 1, id: "default", title: "Default Worker Boundary" },
        { schemaVersion: 1, id: "readonly", title: "Readonly Workspace" },
        { schemaVersion: 1, id: "workspace-write", title: "Workspace Write" },
        { schemaVersion: 1, id: "locked-down", title: "Locked Down" },
    ];
}
/** `cw status` / `cw_status` — SPEC/cli-surface.md pins the no-id JSON
 *  shape exactly (`{runId:null, nextActions}`); a real run id resolves to
 *  `summarizeRun`'s payload (MILESTONE 11, reporting/observability). */
function statusPayload(runId, cwd) {
    const operatorUx = loadOperatorUx();
    if (!runId) {
        return { runId: null, nextActions: operatorUx.adviseNoRun() };
    }
    const run = loadRunStore().loadRunFromCwd(runId, cwd || process.cwd());
    return operatorUx.summarizeRun(run);
}
// ---------------------------------------------------------------------
// Public table-derived API
// ---------------------------------------------------------------------
function buildMcpBinding(row) {
    const handler = MCP_REAL_HANDLERS[row.capability] ?? (0, capability_data_1.notYetImplemented)(row.capability);
    // A transcript entry like "runId, workerId" is TWO AND-required args (the
    // spec table's comma form), while "topicId|id" is one OR-group. mcp/dispatch's
    // validator only splits on `|`, so expand each comma-joined transcript entry
    // into its separate AND-groups here (the one place the row shape is turned
    // into the runtime McpBinding.requiredArgs contract).
    const requiredArgs = row.requiredArgs.flatMap((group) => group.split(",").map((entry) => entry.trim()).filter(Boolean));
    const annotations = capability_data_1.MCP_TOOL_ANNOTATIONS[row.tool];
    return {
        tool: row.tool,
        requiredArgs: requiredArgs.length ? requiredArgs : undefined,
        properties: row.properties,
        description: row.description,
        ...(annotations ? { annotations } : {}),
        handler,
    };
}
/** The full capability table: one row per MCP tool (196, per SPEC/mcp.md),
 *  in the exact source order `tools/list` must report. CLI bindings are
 *  layered on top for the small set of capabilities this milestone also
 *  exposes on the CLI front door (see `CLI_ROWS` below); every other row
 *  is MCP-only AT THIS MILESTONE (not a permanent `mcp-only` declaration —
 *  just not yet CLI-wired; later milestones add the `cli` binding without
 *  touching this array's mcp side). */
exports.REGISTRY = capability_data_1.MCP_TOOL_DATA.map((row) => ({
    capability: row.capability,
    summary: row.description,
    surface: "both",
    mcp: buildMcpBinding(row),
}));
exports.REGISTRY_BY_CAPABILITY = new Map(exports.REGISTRY.map((row) => [row.capability, row]));
/** Attach (or replace) a CLI binding for an already-declared MCP capability.
 *  Used once below to wire `list`/`status`/`sandbox.list` onto the CLI
 *  front door too, without duplicating their row data. */
function attachCliBinding(capability, cli) {
    const row = exports.REGISTRY_BY_CAPABILITY.get(capability);
    if (!row)
        throw new Error(`capability-table: cannot attach cli binding to undeclared capability ${capability}`);
    row.cli = cli;
}
/** Declare a capability that is CLI-only at this milestone (`help`,
 *  `version` — both are permanently `cli-only` per SPEC/mcp.md's
 *  declared one-surface list, so no mcp row is created for them). */
function addCliOnlyCapability(capability, summary, cli, reason, entry) {
    const row = { capability, summary, surface: "cli-only", cli, reason, ...(entry ? { entry } : {}) };
    exports.REGISTRY.push(row);
    exports.REGISTRY_BY_CAPABILITY.set(capability, row);
}
/** Returns the declared row for a capability id, or undefined. */
function findCapability(capability) {
    return exports.REGISTRY_BY_CAPABILITY.get(capability);
}
/** Returns the declared row whose `cli.path` matches `path` exactly
 *  (path[0] is the verb). Used by cli/dispatch.ts's generic executor.
 *  A single-token command also matches a row's `caseTokens` alias list, so
 *  an alias (e.g. `audit-run`) dispatches to the same handler as its verb. */
function findCapabilityByCliPath(path) {
    for (const row of exports.REGISTRY) {
        if (row.cli && row.cli.path.length === path.length && row.cli.path.every((p, i) => p === path[i])) {
            return row;
        }
    }
    if (path.length === 1) {
        for (const row of exports.REGISTRY) {
            if (row.cli && row.cli.caseTokens && row.cli.caseTokens.includes(path[0]))
                return row;
        }
    }
    return undefined;
}
/** Every capability row that declares a `cli` binding, in registry order.
 *  Used to derive `formatCommandHelp`'s per-verb subcommand rows. */
function cliCapabilities() {
    return exports.REGISTRY.filter((row) => Boolean(row.cli));
}
/** `tools/list`'s exact array, in the pinned source order. Each
 *  property's shape comes from the first hit, in order: a per-tool
 *  `PROPERTY_OVERRIDES` entry, then the shared `COMMON_PROPERTY_TYPES`
 *  entry for that property name, then the plain `stringProperty`
 *  fallback for any name neither table covers.
 *
 *  `inputSchema.required` is built from `row.mcp.requiredArgs`, which
 *  mcp/dispatch.ts's `requiredToolArguments` also reads: each array
 *  entry is one AND-required group, already split from the transcript's
 *  comma form (see `buildMcpBinding` above). A group holding `|` is an
 *  OR-group — at least one of the named keys must be present, so no
 *  single name from it can go into the flat, AND-only `required` list;
 *  a group with no `|` is one plain required name. */
function mcpToolDefinitions() {
    const definitions = [];
    for (const row of exports.REGISTRY) {
        if (!row.mcp)
            continue;
        const overrides = capability_data_1.PROPERTY_OVERRIDES[row.mcp.tool] ?? {};
        const properties = {};
        for (const propName of row.mcp.properties) {
            properties[propName] = overrides[propName] ?? capability_data_1.COMMON_PROPERTY_TYPES[propName] ?? (0, capability_data_1.stringProperty)(propName);
        }
        const required = (row.mcp.requiredArgs ?? []).filter((group) => !group.includes("|"));
        definitions.push({
            name: row.mcp.tool,
            description: row.mcp.description,
            // Additive behavior hints (MCP_TOOL_ANNOTATIONS): present only for
            // tools whose handler was checked by hand; omitted otherwise.
            ...(row.mcp.annotations ? { annotations: row.mcp.annotations } : {}),
            inputSchema: {
                type: "object",
                properties,
                additionalProperties: true,
                ...(required.length ? { required } : {}),
            },
        });
    }
    return definitions;
}
/** Every declared MCP tool name, in `tools/list` order. */
function declaredMcpTools() {
    return exports.REGISTRY.filter((row) => row.mcp).map((row) => row.mcp.tool);
}
/** Look up a capability row by its MCP tool name. */
function findCapabilityByMcpTool(tool) {
    return exports.REGISTRY.find((row) => row.mcp && row.mcp.tool === tool);
}
