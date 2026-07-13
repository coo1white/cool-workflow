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

import * as path from "node:path";
import { findCapability } from "../core/capability-table";
import { loadRunFromCwd } from "./run-store";

export const WORKBENCH_DEFAULT_PORT = 7717;
export const WORKBENCH_UI_RELATIVE = "ui/workbench";

/** Parse and range-check a workbench `--port` value. Returns `undefined`
 *  when no port was given (the caller then uses WORKBENCH_DEFAULT_PORT),
 *  the validated integer otherwise. Throws a clear Error on a bad value —
 *  a non-number (`NaN`), a float, a negative, or a number over 65535 — so
 *  callers fail closed with an actionable line instead of node's opaque
 *  ERR_SOCKET_BAD_PORT or a `"port": null` descriptor. A valid port is an
 *  integer in [0, 65535]; 0 is the legitimately-supported ephemeral port. */
export function parseWorkbenchPort(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  const reject = () => {
    throw new Error(`workbench serve --port must be an integer 0-65535 (got ${JSON.stringify(raw)})`);
  };
  // Only a string (the argv form) or a number is a real port. A valueless
  // `--port` flag parses to boolean `true`; reject it rather than let
  // Number(true) === 1 silently bind to port 1. A blank string is bad input
  // too — Number("") === 0 would otherwise pass as the ephemeral port.
  if (typeof raw !== "string" && typeof raw !== "number") reject();
  if (typeof raw === "string" && raw.trim() === "") reject();
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) reject();
  return port;
}

export type WorkbenchPanelStatus = "present" | "absent";

export interface WorkbenchPanel {
  capability: string;
  cli: string;
  mcp: string;
  status: WorkbenchPanelStatus;
  data?: unknown;
  error?: string;
}

/** Panel groups/members, in the SPEC's declared order. Each entry names
 *  the capability id whose MCP handler is called to fill the panel. */
const PANEL_MAP: Record<string, Record<string, string>> = {
  graph: { operator: "graph", multiAgent: "multi-agent.graph", compact: "summary.show", criticalPath: "summary.show" },
  blackboard: { coordinator: "coordinator.summary", digest: "blackboard.summary", graph: "blackboard.graph" },
  worker: { summary: "worker.summary" },
  candidate: { summary: "candidate.summary", reasoning: "candidate.summary" },
  metrics: { report: "metrics.show" },
  audit: { summary: "audit.summary", multiAgent: "audit.multi-agent", policy: "audit.policy", judge: "audit.judge" },
  collaboration: { review: "review.status", comments: "comment.list" },
};

function cliCommandFor(capability: string): string {
  const row = findCapability(capability);
  return row?.cli ? `cw ${row.cli.path.join(" ")}` : `cw ${capability.replace(/\./g, " ")}`;
}
function mcpToolFor(capability: string): string {
  const row = findCapability(capability);
  return row?.mcp?.tool || `cw_${capability.replace(/\./g, "_")}`;
}

function buildPanel(capability: string, args: Record<string, unknown>): WorkbenchPanel {
  const cli = cliCommandFor(capability);
  const mcp = mcpToolFor(capability);
  const row = findCapability(capability);
  if (!row || !row.mcp) {
    return { capability, cli, mcp, status: "absent", error: `capability not available: ${capability}` };
  }
  try {
    const data = row.mcp.handler(args);
    return { capability, cli, mcp, status: "present", data };
  } catch (error) {
    return { capability, cli, mcp, status: "absent", error: error instanceof Error ? error.message : String(error) };
  }
}

export interface WorkbenchRunView {
  schemaVersion: 1;
  surface: "workbench";
  runId: string;
  resolved: boolean;
  error?: string;
  panels: Record<string, Record<string, WorkbenchPanel>>;
}

/** `cw workbench view <run-id>` — read-only, never throws: an
 *  unresolvable run gives `resolved:false` and every panel `absent` with
 *  the real error, never a fabricated view. */
export function buildWorkbenchRunView(runId: string, args: Record<string, unknown> = {}): WorkbenchRunView {
  const cwd = typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
  let resolved = true;
  let resolveError: string | undefined;
  try {
    loadRunFromCwd(runId, cwd);
  } catch (error) {
    resolved = false;
    resolveError = error instanceof Error ? error.message : String(error);
  }

  const panels: Record<string, Record<string, WorkbenchPanel>> = {};
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

export interface WorkbenchRoute {
  /** Every route is GET — the host refuses any other verb 405. The label
   *  is carried per route so a reader of the serve descriptor can see the
   *  read-only guarantee route by route (old build's WorkbenchRoute.method). */
  method: "GET";
  path: string;
  description: string;
}

export interface WorkbenchServeDescriptor {
  schemaVersion: 1;
  surface: "workbench";
  command: "serve";
  host: string;
  port: number;
  once: boolean;
  readOnly: true;
  scope: "repo" | "home";
  root: string;
  uiAvailable: boolean;
  uiRoot: string;
  routes: WorkbenchRoute[];
}

/** Package-relative resolution only — never falls back to the invocation
 *  cwd. `ui/` ships as a sibling of `dist/` in the published package
 *  (package.json's `files`), so from `dist/shell/workbench.js` the fixed
 *  path is two levels up. Matches the existing precedent in
 *  execution-backend/agent.ts's BATCH_DELEGATE_CHILD_SCRIPT resolution. */
export function workbenchUiRoot(): string {
  return path.resolve(__dirname, "..", "..", WORKBENCH_UI_RELATIVE);
}

const WORKBENCH_ROUTES: WorkbenchRoute[] = [
  { method: "GET", path: "/", description: "Index page (or the UI's index.html, when installed)." },
  { method: "GET", path: "/ui/*", description: "Static Workbench UI assets, when installed." },
  { method: "GET", path: "/api/index", description: "Read-only index of available runs." },
  { method: "GET", path: "/api/serve", description: "This serve descriptor." },
  { method: "GET", path: "/api/run/:runId", description: "The five-panel WorkbenchRunView for one run." },
];

/** `cw workbench serve [--port N] [--once] [--scope repo|home]` — the
 *  serve descriptor. Building this never starts a listener; the caller
 *  (shell/workbench-host.ts's `run()`) decides whether to actually bind. */
export function buildWorkbenchServeDescriptor(args: Record<string, unknown> = {}, boundPort?: number): WorkbenchServeDescriptor {
  const cwd = typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
  const uiRoot = workbenchUiRoot();
  const fs = require("node:fs") as typeof import("node:fs");
  return {
    schemaVersion: 1,
    surface: "workbench",
    command: "serve",
    host: "127.0.0.1",
    // `boundPort` (from a real listen()) is already a valid port. Otherwise
    // validate the requested `--port` so the `--once`/`--json`/MCP descriptor
    // path fails closed with a clear line instead of emitting `"port": null`.
    port: boundPort ?? (parseWorkbenchPort(args.port) ?? WORKBENCH_DEFAULT_PORT),
    once: Boolean(args.once),
    readOnly: true,
    scope: args.scope === "home" ? "home" : "repo",
    root: cwd,
    uiAvailable: fs.existsSync(uiRoot),
    uiRoot,
    routes: WORKBENCH_ROUTES,
  };
}

export interface WorkbenchIndexView {
  schemaVersion: 1;
  surface: "workbench";
  command: "index";
  scope: "repo" | "home";
  registry: unknown;
  runs: unknown;
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
export function buildWorkbenchIndex(args: Record<string, unknown> = {}): WorkbenchIndexView {
  const scope: "repo" | "home" = args.scope === "home" ? "home" : "repo";
  const scoped = { ...args, scope };
  const registryRow = findCapability("registry.show");
  const text = typeof args.text === "string" ? args.text.trim() : "";
  const runListRow = findCapability(text ? "run.search" : "run.list");
  const registry = registryRow?.mcp ? registryRow.mcp.handler(scoped) : undefined;
  const runs = runListRow?.mcp ? runListRow.mcp.handler(scoped) : [];
  return { schemaVersion: 1, surface: "workbench", command: "index", scope, registry, runs };
}
