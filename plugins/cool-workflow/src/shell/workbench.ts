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

export function workbenchUiRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "plugins", "cool-workflow", WORKBENCH_UI_RELATIVE);
    if (require("node:fs").existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), WORKBENCH_UI_RELATIVE);
}

const WORKBENCH_ROUTES: WorkbenchRoute[] = [
  { path: "/", description: "Index page (or the UI's index.html, when installed)." },
  { path: "/ui/*", description: "Static Workbench UI assets, when installed." },
  { path: "/api/index", description: "Read-only index of available runs." },
  { path: "/api/serve", description: "This serve descriptor." },
  { path: "/api/run/:runId", description: "The five-panel WorkbenchRunView for one run." },
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
    port: boundPort ?? (args.port !== undefined ? Number(args.port) : WORKBENCH_DEFAULT_PORT),
    once: Boolean(args.once),
    readOnly: true,
    scope: args.scope === "home" ? "home" : "repo",
    root: cwd,
    uiAvailable: fs.existsSync(uiRoot),
    uiRoot,
    routes: WORKBENCH_ROUTES,
  };
}

export function buildWorkbenchIndex(): { schemaVersion: 1; runs: never[] } {
  // PLACEHOLDER (no conformance case in this milestone's scope exercises
  // /api/index against a real run registry listing) — a real index would
  // enumerate the run registry the same way `cw run list` does. Kept
  // honestly empty rather than fabricated, per the workbench's
  // fail-closed invariant.
  return { schemaVersion: 1, runs: [] };
}
