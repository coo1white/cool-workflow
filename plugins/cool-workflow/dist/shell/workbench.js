"use strict";
// shell/workbench.ts — the read-only Workbench view: `cw workbench view`
// (five-panel JSON view of one run) and the serve descriptor.
//
// MILESTONE 11 (reporting/observability). Byte-exact port of the panel
// group/member shape from the old build's src/workbench.ts. Each panel
// embeds the SAME payload as the matching `cw <cmd> --json` call — built
// here by calling the matching capability's own MCP handler in-process
// (never a duplicate implementation), so panel data can never drift from
// the standalone command's output.
//
// Evidence: SPEC/reporting-ux.md "Workbench" (panel groups/members,
// serve descriptor, fail-closed-but-honest unresolved-run shape),
// invariant 11 (workbench is read-only and fails closed).
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
exports.WORKBENCH_UI_RELATIVE = exports.WORKBENCH_DEFAULT_PORT = void 0;
exports.parseWorkbenchPort = parseWorkbenchPort;
exports.buildWorkbenchRunView = buildWorkbenchRunView;
exports.workbenchUiRoot = workbenchUiRoot;
exports.buildWorkbenchServeDescriptor = buildWorkbenchServeDescriptor;
exports.buildWorkbenchIndex = buildWorkbenchIndex;
const path = __importStar(require("node:path"));
const capability_table_1 = require("../core/capability-table");
const run_store_1 = require("./run-store");
exports.WORKBENCH_DEFAULT_PORT = 7717;
exports.WORKBENCH_UI_RELATIVE = "ui/workbench";
/** Parse and range-check a workbench `--port` value. Returns `undefined`
 *  when no port was given (the caller then uses WORKBENCH_DEFAULT_PORT),
 *  the validated integer otherwise. Throws a clear Error on a bad value —
 *  a non-number (`NaN`), a float, a negative, or a number over 65535 — so
 *  callers fail closed with an actionable line instead of node's opaque
 *  ERR_SOCKET_BAD_PORT or a `"port": null` descriptor. A valid port is an
 *  integer in [0, 65535]; 0 is the legitimately-supported ephemeral port. */
function parseWorkbenchPort(raw) {
    if (raw === undefined)
        return undefined;
    const reject = () => {
        throw new Error(`workbench serve --port must be an integer 0-65535 (got ${JSON.stringify(raw)})`);
    };
    // Only a string (the argv form) or a number is a real port. A valueless
    // `--port` flag parses to boolean `true`; reject it rather than let
    // Number(true) === 1 silently bind to port 1. A blank string is bad input
    // too — Number("") === 0 would otherwise pass as the ephemeral port.
    if (typeof raw !== "string" && typeof raw !== "number")
        reject();
    if (typeof raw === "string" && raw.trim() === "")
        reject();
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
        reject();
    return port;
}
/** Panel groups/members, in the SPEC's declared order. Each entry names
 *  the capability id whose MCP handler is called to fill the panel. */
const PANEL_MAP = {
    graph: { operator: "graph", multiAgent: "multi-agent.graph", compact: "summary.show", criticalPath: "summary.show" },
    blackboard: { coordinator: "coordinator.summary", digest: "blackboard.summary", graph: "blackboard.graph" },
    worker: { summary: "worker.summary" },
    candidate: { summary: "candidate.summary", reasoning: "candidate.summary" },
    metrics: { report: "metrics.show" },
    audit: { summary: "audit.summary", multiAgent: "audit.multi-agent", policy: "audit.policy", judge: "audit.judge" },
    collaboration: { review: "review.status", comments: "comment.list" },
};
function cliCommandFor(capability) {
    const row = (0, capability_table_1.findCapability)(capability);
    return row?.cli ? `cw ${row.cli.path.join(" ")}` : `cw ${capability.replace(/\./g, " ")}`;
}
function mcpToolFor(capability) {
    const row = (0, capability_table_1.findCapability)(capability);
    return row?.mcp?.tool || `cw_${capability.replace(/\./g, "_")}`;
}
function buildPanel(capability, args) {
    const cli = cliCommandFor(capability);
    const mcp = mcpToolFor(capability);
    const row = (0, capability_table_1.findCapability)(capability);
    if (!row || !row.mcp) {
        return { capability, cli, mcp, status: "absent", error: `capability not available: ${capability}` };
    }
    try {
        const data = row.mcp.handler(args);
        return { capability, cli, mcp, status: "present", data };
    }
    catch (error) {
        return { capability, cli, mcp, status: "absent", error: error instanceof Error ? error.message : String(error) };
    }
}
/** `cw workbench view <run-id>` — read-only, never throws: an
 *  unresolvable run gives `resolved:false` and every panel `absent` with
 *  the real error, never a fabricated view. */
function buildWorkbenchRunView(runId, args = {}) {
    const cwd = typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
    let resolved = true;
    let resolveError;
    try {
        (0, run_store_1.loadRunFromCwd)(runId, cwd);
    }
    catch (error) {
        resolved = false;
        resolveError = error instanceof Error ? error.message : String(error);
    }
    const panels = {};
    const panelArgs = { ...args, runId, cwd };
    for (const [group, members] of Object.entries(PANEL_MAP)) {
        panels[group] = {};
        for (const [member, capability] of Object.entries(members)) {
            panels[group][member] = resolved
                ? buildPanel(capability, panelArgs)
                : { capability, cli: cliCommandFor(capability), mcp: mcpToolFor(capability), status: "absent", error: resolveError };
        }
    }
    return { schemaVersion: 1, surface: "workbench", runId, resolved, ...(resolveError ? { error: resolveError } : {}), panels };
}
/** Package-relative resolution only — never falls back to the invocation
 *  cwd. `ui/` ships as a sibling of `dist/` in the published package
 *  (package.json's `files`), so from `dist/shell/workbench.js` the fixed
 *  path is two levels up. Matches the existing precedent in
 *  execution-backend/agent.ts's BATCH_DELEGATE_CHILD_SCRIPT resolution. */
function workbenchUiRoot() {
    return path.resolve(__dirname, "..", "..", exports.WORKBENCH_UI_RELATIVE);
}
const WORKBENCH_ROUTES = [
    { method: "GET", path: "/", description: "Index page (or the UI's index.html, when installed)." },
    { method: "GET", path: "/ui/*", description: "Static Workbench UI assets, when installed." },
    { method: "GET", path: "/api/index", description: "Read-only index of available runs." },
    { method: "GET", path: "/api/serve", description: "This serve descriptor." },
    { method: "GET", path: "/api/run/:runId", description: "The five-panel WorkbenchRunView for one run." },
];
/** `cw workbench serve [--port N] [--once] [--scope repo|home]` — the
 *  serve descriptor. Building this never starts a listener; the caller
 *  (shell/workbench-host.ts's `run()`) decides whether to actually bind. */
function buildWorkbenchServeDescriptor(args = {}, boundPort) {
    const cwd = typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
    const uiRoot = workbenchUiRoot();
    const fs = require("node:fs");
    return {
        schemaVersion: 1,
        surface: "workbench",
        command: "serve",
        host: "127.0.0.1",
        // `boundPort` (from a real listen()) is already a valid port. Otherwise
        // validate the requested `--port` so the `--once`/`--json`/MCP descriptor
        // path fails closed with a clear line instead of emitting `"port": null`.
        port: boundPort ?? (parseWorkbenchPort(args.port) ?? exports.WORKBENCH_DEFAULT_PORT),
        once: Boolean(args.once),
        readOnly: true,
        scope: args.scope === "home" ? "home" : "repo",
        root: cwd,
        uiAvailable: fs.existsSync(uiRoot),
        uiRoot,
        routes: WORKBENCH_ROUTES,
    };
}
/** The cross-run index (old build's src/workbench.ts buildWorkbenchIndex):
 *  the registry index (`cw registry show`) plus the run list (`cw run
 *  list`), each embedded VERBATIM from its own already-declared capability
 *  handler — the Workbench adds no new source of truth. Composed the same
 *  way the panels are (findCapability(...).mcp.handler), so `/api/index`
 *  can never drift from the standalone `cw` commands. Read-only. */
function buildWorkbenchIndex(args = {}) {
    const scope = args.scope === "home" ? "home" : "repo";
    const scoped = { ...args, scope };
    const registryRow = (0, capability_table_1.findCapability)("registry.show");
    const runListRow = (0, capability_table_1.findCapability)("run.list");
    const registry = registryRow?.mcp ? registryRow.mcp.handler(scoped) : undefined;
    const runs = runListRow?.mcp ? runListRow.mcp.handler(scoped) : [];
    return { schemaVersion: 1, surface: "workbench", command: "index", scope, registry, runs };
}
