// wiring/capability-table/state.ts — MILESTONE 3 (state kernel) + MILESTONE 4
// (state-explosion summaries) CLI bindings: state.check, migration.list|
// check|prove, node.list|show|graph|snapshot|diff|replay|replay.verify,
// summary.refresh|show. Split out of core/capability-table.ts, byte-for-byte
// (extracted with sed, not retyped).

import { attachCliBinding, REGISTRY_BY_CAPABILITY } from "./registry-core";
import { optionalArg } from "../../cli/io";

// This slice is required unconditionally at startup for every command;
// load these shell modules only when a handler that actually needs them runs.
function loadReportViewCli(): typeof import("../../shell/report-view-cli") {
  return require("../../shell/report-view-cli") as typeof import("../../shell/report-view-cli");
}
function loadStateCli(): typeof import("../../shell/state-cli") {
  return require("../../shell/state-cli") as typeof import("../../shell/state-cli");
}
function loadStateExplosionCli(): typeof import("../../shell/state-explosion-cli") {
  return require("../../shell/state-explosion-cli") as typeof import("../../shell/state-explosion-cli");
}

// MILESTONE 3 (state kernel) CLI bindings: state.check, migration.list|
// check|prove, node.list|show|graph|snapshot|diff|replay|replay.verify.
// Handler BODIES live in shell/state-cli.ts (impure — they read/write
// run state on disk); this table only wires argv shape -> handler call
// and the row's own exit-code rule, per cli/dispatch.ts's generic
// executor contract. `required`/`optionalArg` are cli/io.ts's shared
// coercion helpers, imported here so the wiring stays a thin adapter
// (Usage-error strings copied byte-for-byte from the old build's
// handlers/*.ts).
// ---------------------------------------------------------------------

import { required } from "../../cli/io";

attachCliBinding("state.check", {
  path: ["state", "check"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const report = loadStateCli().checkState(runId, args.options);
    return { json: report, exitCode: report.status === "unsupported" ? 1 : undefined };
  },
});

attachCliBinding("migration.list", {
  path: ["migration", "list"],
  jsonMode: "default",
  handler: () => ({ json: loadStateCli().migrationList() }),
});

attachCliBinding("migration.check", {
  path: ["migration", "check"],
  jsonMode: "default",
  handler: (args) => {
    const target = required(args.positionals[0], "target (run-id or state/app file)");
    const report = loadStateCli().migrationCheck(target, args.options);
    return { json: report, exitCode: report.status === "unsupported" ? 1 : undefined };
  },
});

attachCliBinding("migration.prove", {
  path: ["migration", "prove"],
  jsonMode: "default",
  handler: (args) => {
    const target = required(args.positionals[0], "target (run-id or state/app file)");
    const proof = loadStateCli().migrationProve(target, args.options);
    return { json: proof, exitCode: proof.pass ? undefined : 1 };
  },
});

attachCliBinding("node.list", {
  path: ["node", "list"],
  jsonMode: "default",
  handler: (args) => ({ json: loadStateCli().listNodes(required(args.positionals[0], "run id"), args.options) }),
});

attachCliBinding("node.show", {
  path: ["node", "show"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const nodeId = required(args.positionals[1], "node id");
    return { json: loadStateCli().showNode(runId, nodeId, args.options) };
  },
});

// jsonMode "flag": `--json` prints the node array (graphNodes); the bare
// verb prints the operator run-graph text, byte-for-byte the old build's
// `node graph` render (formatOperatorGraph over runner.operatorGraph).
attachCliBinding("node.graph", {
  path: ["node", "graph"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    return { json: loadStateCli().graphNodes(runId, args.options), text: `${loadReportViewCli().graphText(runId, args.options)}\n` };
  },
});

attachCliBinding("node.snapshot", {
  path: ["node", "snapshot"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const nodeId = required(args.positionals[1], "node id");
    return { json: loadStateCli().nodeSnapshotCli(runId, nodeId, args.options) };
  },
});

attachCliBinding("node.diff", {
  path: ["node", "diff"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const baselineSnapshotId = required(args.positionals[1], "baseline snapshot id");
    const candidateSnapshotId = required(args.positionals[2], "candidate snapshot id");
    return { json: loadStateCli().nodeDiffCli(runId, baselineSnapshotId, candidateSnapshotId, args.options) };
  },
});

attachCliBinding("node.replay", {
  path: ["node", "replay"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const snapshotId = required(args.positionals[1], "snapshot id");
    return { json: loadStateCli().nodeReplayCli(runId, snapshotId, args.options) };
  },
});

attachCliBinding("node.replay.verify", {
  path: ["node", "verify"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const replayId = required(args.positionals[1], "replay id");
    const verdict = loadStateCli().nodeReplayVerifyCli(runId, replayId, args.options);
    return { json: verdict, exitCode: verdict.pass ? undefined : 1 };
  },
});

// GAP #24: mirror the state-kernel CLI shell fns as MCP handlers (they were
// declared MCP tool rows but left on notYetImplemented). Arg-name reads copied
// byte-for-byte from the old build's mcp/tool-call.ts switch arms.
REGISTRY_BY_CAPABILITY.get("state.check")!.mcp!.handler = (args) => loadStateCli().checkState(required(optionalArg(args.runId), "run id"), args);
REGISTRY_BY_CAPABILITY.get("migration.list")!.mcp!.handler = () => loadStateCli().migrationList();
REGISTRY_BY_CAPABILITY.get("migration.check")!.mcp!.handler = (args) => loadStateCli().migrationCheck(required(optionalArg(args.target ?? args.runId), "target (run-id or state/app file)"), args);
REGISTRY_BY_CAPABILITY.get("migration.prove")!.mcp!.handler = (args) => loadStateCli().migrationProve(required(optionalArg(args.target ?? args.runId), "target (run-id or state/app file)"), args);
REGISTRY_BY_CAPABILITY.get("node.list")!.mcp!.handler = (args) => loadStateCli().listNodes(required(optionalArg(args.runId), "run id"), args);
REGISTRY_BY_CAPABILITY.get("node.show")!.mcp!.handler = (args) => loadStateCli().showNode(required(optionalArg(args.runId), "run id"), required(optionalArg(args.nodeId), "node id"), args);
REGISTRY_BY_CAPABILITY.get("node.graph")!.mcp!.handler = (args) => loadStateCli().graphNodes(required(optionalArg(args.runId), "run id"), args);
REGISTRY_BY_CAPABILITY.get("node.snapshot")!.mcp!.handler = (args) => loadStateCli().nodeSnapshotCli(required(optionalArg(args.runId), "run id"), required(optionalArg(args.nodeId), "node id"), args);
REGISTRY_BY_CAPABILITY.get("node.diff")!.mcp!.handler = (args) => loadStateCli().nodeDiffCli(required(optionalArg(args.runId), "run id"), required(optionalArg(args.baselineSnapshotId ?? args.baseline), "baseline snapshot id"), required(optionalArg(args.candidateSnapshotId ?? args.candidate), "candidate snapshot id"), args);
REGISTRY_BY_CAPABILITY.get("node.replay")!.mcp!.handler = (args) => loadStateCli().nodeReplayCli(required(optionalArg(args.runId), "run id"), required(optionalArg(args.snapshotId), "snapshot id"), args);
REGISTRY_BY_CAPABILITY.get("node.replay.verify")!.mcp!.handler = (args) => loadStateCli().nodeReplayVerifyCli(required(optionalArg(args.runId), "run id"), required(optionalArg(args.replayId), "replay id"), args);

// `contract.show` is not yet a declared MCP_TOOL_DATA row with a CLI peer
// wired here (it IS in MCP_TOOL_DATA already); no milestone-3 conformance
// case reaches it, so it is intentionally left on its placeholder handler
// until a case demands it — avoids speculative, untested wiring.

// ---------------------------------------------------------------------
// MILESTONE 4 (state-explosion summaries) CLI bindings: summary.refresh,
// summary.show. Handler BODIES live in shell/state-explosion-cli.ts
// (impure — disk reads/writes summaries under the run dir); this table
// only wires argv shape -> handler call, per cli/dispatch.ts's generic
// executor contract. Per SPEC/state-core.md's CLI verbs section: without
// `--json` both print `formatStateExplosionReport` text (jsonMode
// "flag" — text by default, JSON under --json/--format json).
// ---------------------------------------------------------------------

import { formatStateExplosionReport, formatCompactGraph } from "../../core/format/state-explosion-text";
import { wantsJson } from "../../cli/io";

attachCliBinding("summary.refresh", {
  path: ["summary", "refresh"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const index = loadStateExplosionCli().summaryRefreshCli(runId, args.options);
    // Byte-exact port of the old build's handleSummary "refresh": the
    // human-text branch re-reads via a fresh summaryShow call rather than
    // formatting the refresh's own index record (src/cli/handlers/
    // operator.ts:118-127); only computed when actually needed, so a
    // --json call does exactly the one read the old build's if/else did.
    if (wantsJson(args.options)) return { json: index };
    return { json: index, text: formatStateExplosionReport(loadStateExplosionCli().summaryShowCli(runId, args.options)) };
  },
});

attachCliBinding("summary.show", {
  path: ["summary", "show"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const report = loadStateExplosionCli().summaryShowCli(runId, args.options);
    return { json: report, text: formatStateExplosionReport(report) };
  },
});

// ---------------------------------------------------------------------
