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
    // The run's lifecycle, from the SAME `run.show` capability handler the
    // CLI/MCP use (the buildWorkbenchIndex composition style — never a
    // duplicate implementation). This function's contract is never-throws,
    // so any failure here just leaves the key out.
    let lifecycle;
    try {
        const showRow = (0, capability_table_1.findCapability)("run.show");
        const shown = showRow?.mcp ? showRow.mcp.handler({ ...args, runId, cwd }) : undefined;
        if (shown && shown.found === true && shown.record && typeof shown.record.lifecycle === "string") {
            lifecycle = shown.record.lifecycle;
        }
    }
    catch {
        lifecycle = undefined;
    }
    const panels = {};
    // This is an internal mechanism flag, not a CLI/MCP option. The Workbench
    // must use the same capability bodies as the other front doors, but its
    // GET-only projection must not make derived audit or metrics files.
    const panelArgs = { ...args, runId, cwd, __cwWorkbenchReadOnlyProjection: true };
    for (const [group, members] of Object.entries(PANEL_MAP)) {
        panels[group] = {};
        for (const [member, capability] of Object.entries(members)) {
            panels[group][member] = resolved
                ? buildPanel(capability, panelArgs)
                : { capability, cli: cliCommandFor(capability), mcp: mcpToolFor(capability), status: "absent", error: resolveError };
        }
    }
    return { schemaVersion: 1, surface: "workbench", runId, resolved, ...(lifecycle ? { lifecycle } : {}), ...(resolveError ? { error: resolveError } : {}), panels };
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
 *  can never drift from the standalone `cw` commands. Read-only.
 *
 *  When `args.text` names a non-blank filter (the Workbench UI's sidebar
 *  filter box, `ui/workbench/app.js`'s `loadIndex`), the run list is filled
 *  via the `run.search` capability instead of `run.list` — `run.list`'s own
 *  handler (`runListCli` -> `RunRegistry.list()`) never reads a `text`
 *  field, so calling it with a filter present would silently ignore it.
 *  With no `text` filter the call is unchanged: `run.list`, byte-identical
 *  to the payload before this branch existed. */
function buildWorkbenchIndex(args = {}) {
    const scope = args.scope === "home" ? "home" : "repo";
    const scoped = { ...args, scope };
    const registryRow = (0, capability_table_1.findCapability)("registry.show");
    const text = typeof args.text === "string" ? args.text.trim() : "";
    const runListRow = (0, capability_table_1.findCapability)(text ? "run.search" : "run.list");
    const registry = registryRow?.mcp ? registryRow.mcp.handler(scoped) : undefined;
    const runs = runListRow?.mcp ? newestRunPage(runListRow.mcp.handler, scoped) : [];
    return { schemaVersion: 1, surface: "workbench", command: "index", scope, registry, runs };
}
/** The run list/search handler sorts oldest-first and returns only the
 *  first `limit` page — so the default page is the OLDEST runs, and a scope
 *  with more runs than the page size never shows the newest run at all. The
 *  Workbench wants the newest page: when the caller pinned no offset and the
 *  total exceeds one page, re-fetch with the offset that lands on the last
 *  page. The payload shape (total/offset/limit/records) is unchanged, so
 *  the UI can still show "showing latest N of M". */
function newestRunPage(handler, scoped) {
    const first = handler(scoped);
    if (scoped.offset !== undefined)
        return first;
    if (!first || typeof first !== "object")
        return first;
    const page = first;
    const total = typeof page.total === "number" ? page.total : undefined;
    const limit = typeof page.limit === "number" ? page.limit : undefined;
    if (total === undefined || limit === undefined || total <= limit)
        return first;
    return handler({ ...scoped, offset: total - limit });
}
