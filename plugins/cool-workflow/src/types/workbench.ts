import type { Blackboard } from "./blackboard";

// ---------------------------------------------------------------------------
// Web / Desktop Workbench (v0.1.30) — DERIVED, READ-ONLY view models.
//
// The Workbench is a THIRD FRONT DOOR (a renderer), never a new brain. Every
// type here is a PROJECTION over payloads the CLI/MCP already produce; it forks
// no run/state schema and holds zero authoritative state. A `WorkbenchPanel`
// embeds, VERBATIM, the exact `--json` payload of ONE existing capability under
// `data` — so panel data equals `cw <cmd> --json` byte-for-byte (the v0.1.27
// parity contract). When a source is unreadable the panel is rendered `absent`
// with the failure surfaced honestly; the Workbench never fabricates a view.
// Refresh re-derives everything from disk: delete the host and nothing is lost.
// ---------------------------------------------------------------------------

/** Whether a panel's single source capability payload was readable. `absent`
 *  carries the honest reason (e.g. no blackboard yet, unreadable state). */
export type WorkbenchPanelStatus = "present" | "absent";

/** One rendered panel = one existing capability's canonical `--json` payload.
 *  `capability`/`cli`/`mcp` name the SINGLE source so a reader can re-derive it;
 *  `data` IS that payload, embedded verbatim — no projection, no business
 *  logic, nothing the CLI/MCP cannot already produce. */
export interface WorkbenchPanel<T = unknown> {
  /** Canonical capability id this panel renders, e.g. "graph". */
  capability: string;
  /** The `cw <cmd> --json` invocation that produces `data`, runId interpolated. */
  cli: string;
  /** The `cw_<tool>` MCP tool that produces `data`. */
  mcp: string;
  status: WorkbenchPanelStatus;
  /** The capability payload, verbatim, when status === "present". */
  data?: T;
  /** Honest failure reason when status === "absent" (fail closed). */
  error?: string;
}

/** The five operator panels for ONE run, each a verbatim capability payload.
 *  Names mirror the operator vocabulary exactly (least astonishment): run graph,
 *  blackboard, worker logs, candidate compare, audit timeline. */
export interface WorkbenchRunPanels {
  /** Run graph: operator + multi-agent graphs, incl. compact/critical-path. */
  graph: {
    operator: WorkbenchPanel;
    multiAgent: WorkbenchPanel;
    compact: WorkbenchPanel;
    criticalPath: WorkbenchPanel;
  };
  /** Blackboard: coordinator topics/messages/contexts/artifacts/decisions. */
  blackboard: {
    coordinator: WorkbenchPanel;
    digest: WorkbenchPanel;
    graph: WorkbenchPanel;
  };
  /** Worker logs: manifests, outputs, failures, backend + sandbox attestation. */
  worker: {
    summary: WorkbenchPanel;
  };
  /** Candidate compare: scores/selection/rejection + evidence-adoption reasoning. */
  candidate: {
    summary: WorkbenchPanel;
    reasoning: WorkbenchPanel;
  };
  /** Audit timeline: trust events, role policy, provenance, judge/chair, violations. */
  audit: {
    summary: WorkbenchPanel;
    multiAgent: WorkbenchPanel;
    policy: WorkbenchPanel;
    judge: WorkbenchPanel;
  };
  /** Observability + cost (v0.1.31): durations, failure/verifier/acceptance
   *  rates, attested usage + cost, with coverage and `unreported`/`n/a` shown
   *  honestly. Equals `cw metrics show <run> --json` byte-for-byte. */
  metrics: {
    report: WorkbenchPanel;
  };
  /** Team collaboration (v0.1.32): the derived per-target review state +
   *  chronological approval/comment/handoff timeline. Read-only. Equals
   *  `cw review status <run> --json` byte-for-byte. */
  collaboration: {
    review: WorkbenchPanel;
    comments: WorkbenchPanel;
  };
}

/** Read-only, derived five-panel view of ONE run. Holds no authoritative state;
 *  refresh re-derives every panel from durable `.cw/` files via the SAME core
 *  entries the CLI/MCP use. */
export interface WorkbenchRunView {
  schemaVersion: 1;
  surface: "workbench";
  runId: string;
  /** True when the run's own state.json was readable. When false every panel is
   *  `absent` and `error` explains why (fail closed). */
  resolved: boolean;
  error?: string;
  panels: WorkbenchRunPanels;
}

/** Cross-run entry view: existing registry + run-list payloads, embedded
 *  verbatim. Served by the host only (composes already-declared capabilities);
 *  it adds no new source of truth. */
export interface WorkbenchIndexView {
  schemaVersion: 1;
  surface: "workbench";
  command: "index";
  scope: "repo" | "home";
  /** Equals `cw registry show --json`. */
  registry: unknown;
  /** Equals `cw run list --json` (or `cw run search --json` when filtered). */
  runs: unknown;
}

/** A single localhost route the host serves. Read-only: every route is GET. */
export interface WorkbenchRoute {
  method: "GET";
  path: string;
  description: string;
}

/** What `cw workbench serve` binds — a description of the OPTIONAL localhost
 *  host. The host holds ZERO authoritative state; deleting it loses nothing. The
 *  CLI emits this under `--json`/`--once`; the MCP tool returns it directly. The
 *  CLI's default (no `--once`) additionally STARTS the blocking server — the
 *  declared, documented payload divergence (see capability-registry). */
export interface WorkbenchServeDescriptor {
  schemaVersion: 1;
  surface: "workbench";
  command: "serve";
  /** Always loopback — least privilege, local by default. Never binds a public
   *  interface; the host also rejects non-localhost Host headers. */
  host: "127.0.0.1";
  port: number;
  /** True when only the descriptor was requested (no server started). */
  once: boolean;
  /** The host is read-only by default; non-GET requests are refused. */
  readOnly: true;
  scope: "repo" | "home";
  /** The `.cw/` workspace root the host reads (and nothing outside it). */
  root: string;
  /** Whether the static UI asset directory was found on disk. */
  uiAvailable: boolean;
  uiRoot: string;
  routes: WorkbenchRoute[];
}
