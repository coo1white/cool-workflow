// Web / Desktop Workbench core (v0.1.30) — the SINGLE source of the human
// console's view models, and a THIRD FRONT DOOR over ONE mechanism.
//
// BSD discipline:
//  - MECHANISM VS POLICY. The kernel + durable `.cw/` state are the mechanism.
//    The CLI renders for human speed, MCP for machine context, and the Workbench
//    for human inspection at a glance. All three are presentation POLICY over the
//    same data. This module computes, decides, and stores NOTHING the CLI/MCP
//    cannot already produce — every panel embeds, verbatim, the canonical
//    `--json` payload of ONE already-declared capability, assembled by calling
//    the SAME runner core entries the CLI and MCP route through.
//  - NO HIDDEN DASHBOARD. These are DERIVED, read-only projections. They hold no
//    authoritative state; refresh re-derives everything from disk. Delete the
//    host process and nothing is lost — the data is the files.
//  - EXPLICIT, INSPECTABLE, FAIL CLOSED. When a source capability is unreadable
//    (e.g. a run with no blackboard yet, or unresolvable state), the panel is
//    rendered `absent` with the honest error; we never fabricate a view.
//
// See docs/web-desktop-workbench.7.md, src/capability-registry.ts, and the
// v0.1.27 parity contract (docs/cli-mcp-parity.7.md).

import { CoolWorkflowRunner } from "./orchestrator";
import {
  runList,
  runRegistryFor,
  runRegistryShow,
  runSearch
} from "./capability-core";
import {
  WorkbenchIndexView,
  WorkbenchPanel,
  WorkbenchRunPanels,
  WorkbenchRunView,
  WorkbenchServeDescriptor
} from "./types";
import path from "node:path";
import fs from "node:fs";

/** Default loopback port. Local by default, least privilege — never a public
 *  interface. Overridable with `--port`. */
export const WORKBENCH_DEFAULT_PORT = 7717;

/** Relative location of the optional, dependency-light static UI assets. Kept
 *  OUT of the kernel: the host reads them lazily at request time, so the SDK
 *  builds and runs with the Workbench (and these files) absent. */
export const WORKBENCH_UI_RELATIVE = path.join("ui", "workbench");

// ---------------------------------------------------------------------------
// Panel assembly — each panel IS one capability payload, embedded verbatim.
// ---------------------------------------------------------------------------

/** Render one panel by invoking its single source capability. On success `data`
 *  equals `cw <cmd> --json` byte-for-byte; on failure the panel is `absent` with
 *  the honest reason (fail closed) — exactly what the CLI would report. */
function panel(capability: string, cli: string, mcp: string, produce: () => unknown): WorkbenchPanel {
  try {
    return { capability, cli, mcp, status: "present", data: produce() };
  } catch (error) {
    return { capability, cli, mcp, status: "absent", error: error instanceof Error ? error.message : String(error) };
  }
}

function buildPanels(runner: CoolWorkflowRunner, runId: string): WorkbenchRunPanels {
  return {
    // Run graph — operator + multi-agent, including the v0.1.25 compact and
    // critical-path views. Backend ids/attestations (v0.1.29) ride on the nodes.
    graph: {
      operator: panel("graph", `cw graph ${runId} --json`, "cw_operator_graph", () => runner.operatorGraph(runId)),
      multiAgent: panel("multi-agent.graph", `cw multi-agent graph ${runId} --json`, "cw_multi_agent_graph", () =>
        runner.multiAgentOperatorGraph(runId)
      ),
      compact: panel(
        "multi-agent.graph.compact",
        `cw multi-agent graph ${runId} --view compact --json`,
        "cw_multi_agent_graph_compact",
        () => runner.multiAgentGraphView(runId, { view: "compact" })
      ),
      criticalPath: panel(
        "multi-agent.graph.compact",
        `cw multi-agent graph ${runId} --view critical-path --json`,
        "cw_multi_agent_graph_compact",
        () => runner.multiAgentGraphView(runId, { view: "critical-path" })
      )
    },
    // Blackboard — coordinator topics/messages/contexts/artifacts/snapshots/
    // decisions/conflicts/adopted+missing evidence.
    blackboard: {
      coordinator: panel("coordinator.summary", `cw coordinator summary ${runId}`, "cw_coordinator_summary", () =>
        runner.coordinatorSummary(runId)
      ),
      digest: panel("blackboard.summarize", `cw blackboard summarize ${runId} --json`, "cw_blackboard_summarize", () =>
        runner.blackboardSummarize(runId)
      ),
      graph: panel("blackboard.graph", `cw blackboard graph ${runId}`, "cw_blackboard_graph", () => runner.blackboardGraph(runId))
    },
    // Worker logs — manifests, outputs, scoped results, failures, and the
    // recorded execution backend + sandbox attestation.
    worker: {
      summary: panel("worker.summary", `cw worker summary ${runId} --json`, "cw_worker_summary", () =>
        runner.summarizeWorkerRecords(runId)
      )
    },
    // Candidate compare — scores/selection/rejection, plus the v0.1.26
    // evidence-adoption reasoning chain (why adopted).
    candidate: {
      summary: panel("candidate.summary", `cw candidate summary ${runId} --json`, "cw_candidate_summary", () =>
        runner.summarizeCandidateOperatorRecords(runId)
      ),
      reasoning: panel("multi-agent.reasoning", `cw multi-agent reasoning ${runId} --json`, "cw_evidence_reasoning", () =>
        runner.multiAgentReasoning(runId)
      )
    },
    // Audit timeline — trust-audit events, role policy decisions, provenance,
    // judge/chair rationale, and policy violations.
    audit: {
      summary: panel("audit.summary", `cw audit summary ${runId}`, "cw_audit_summary", () => runner.auditSummary(runId)),
      multiAgent: panel("audit.multi-agent", `cw audit multi-agent ${runId} --json`, "cw_audit_multi_agent", () =>
        runner.auditMultiAgent(runId)
      ),
      policy: panel("audit.policy", `cw audit policy ${runId} --json`, "cw_audit_policy", () => runner.auditPolicy(runId)),
      judge: panel("audit.judge", `cw audit judge ${runId} --json`, "cw_audit_judge", () => runner.auditJudge(runId))
    }
  };
}

/** Assemble the read-only five-panel view of ONE run. The run is first resolved
 *  from its durable `.cw/runs/<id>/state.json`; when that source is unreadable
 *  the view is `resolved: false` and every panel is `absent` — fail closed,
 *  never fabricated. */
export function buildWorkbenchRunView(runner: CoolWorkflowRunner, runId: string): WorkbenchRunView {
  const id = String(runId || "");
  let resolved = true;
  let error: string | undefined;
  try {
    runner.loadRun(id);
  } catch (caught) {
    resolved = false;
    error = caught instanceof Error ? caught.message : String(caught);
  }
  return {
    schemaVersion: 1,
    surface: "workbench",
    runId: id,
    resolved,
    ...(error ? { error } : {}),
    panels: buildPanels(runner, id)
  };
}

// ---------------------------------------------------------------------------
// Cross-run entry (v0.1.28 Run Registry) — composed from already-declared
// capabilities; adds NO new source of truth.
// ---------------------------------------------------------------------------

/** Build the cross-run index: the registry index plus the run list (or a
 *  filtered search). Each field equals the corresponding `cw <cmd> --json`
 *  payload; the Workbench can show nothing the CLI/MCP cannot. */
export function buildWorkbenchIndex(runner: CoolWorkflowRunner, args: Record<string, unknown> = {}): WorkbenchIndexView {
  const scope: "repo" | "home" = args.scope === "repo" ? "repo" : "home";
  const scoped = { ...args, scope };
  const registry = runRegistryShow(runRegistryFor(scoped, runner), scoped);
  const filtered = Boolean(args.text || args.q || args.query || args.app || args.appId || args.status || args.repo || args.since || args.until);
  const runs = filtered ? runSearch(runRegistryFor(scoped, runner), scoped) : runList(runRegistryFor(scoped, runner), scoped);
  return { schemaVersion: 1, surface: "workbench", command: "index", scope, registry, runs };
}

// ---------------------------------------------------------------------------
// Serve descriptor — describes the OPTIONAL localhost host (no state).
// ---------------------------------------------------------------------------

/** Absolute path to the optional static UI assets for this plugin install. */
export function workbenchUiRoot(runner: CoolWorkflowRunner): string {
  return path.join(runner.pluginRoot, WORKBENCH_UI_RELATIVE);
}

/** The canonical `cw workbench serve` payload: a description of the localhost
 *  bind and its read-only routes. Holds zero authoritative state. The CLI emits
 *  this under `--json`/`--once`; `cw_workbench_serve` returns it directly. */
export function buildWorkbenchServeDescriptor(
  runner: CoolWorkflowRunner,
  args: Record<string, unknown> = {}
): WorkbenchServeDescriptor {
  const scope: "repo" | "home" = args.scope === "repo" ? "repo" : "home";
  const root = path.resolve(String(args.cwd || process.cwd()));
  const portRaw = Number(args.port);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? Math.floor(portRaw) : WORKBENCH_DEFAULT_PORT;
  const uiRoot = workbenchUiRoot(runner);
  return {
    schemaVersion: 1,
    surface: "workbench",
    command: "serve",
    host: "127.0.0.1",
    port,
    once: Boolean(args.once),
    readOnly: true,
    scope,
    root,
    uiAvailable: dirExists(uiRoot),
    uiRoot,
    routes: [
      { method: "GET", path: "/", description: "Workbench UI shell (static, dependency-light)." },
      { method: "GET", path: "/ui/*", description: "Static UI assets (read from disk; absent if not installed)." },
      { method: "GET", path: "/api/index", description: "Cross-run index: registry show + run list/search (v0.1.28)." },
      { method: "GET", path: "/api/serve", description: "This serve descriptor." },
      { method: "GET", path: "/api/run/:runId", description: "Five-panel WorkbenchRunView for one run (read-only)." }
    ]
  };
}

function dirExists(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}
