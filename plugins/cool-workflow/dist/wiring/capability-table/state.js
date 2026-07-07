"use strict";
// wiring/capability-table/state.ts — MILESTONE 3 (state kernel) + MILESTONE 4
// (state-explosion summaries) CLI bindings: state.check, migration.list|
// check|prove, node.list|show|graph|snapshot|diff|replay|replay.verify,
// summary.refresh|show. Split out of core/capability-table.ts, byte-for-byte
// (extracted with sed, not retyped).
Object.defineProperty(exports, "__esModule", { value: true });
const registry_core_1 = require("./registry-core");
const io_1 = require("../../cli/io");
const report_view_cli_1 = require("../../shell/report-view-cli");
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
const io_2 = require("../../cli/io");
const state_cli_1 = require("../../shell/state-cli");
(0, registry_core_1.attachCliBinding)("state.check", {
    path: ["state", "check"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, io_2.required)(args.positionals[0], "run id");
        const report = (0, state_cli_1.checkState)(runId, args.options);
        return { json: report, exitCode: report.status === "unsupported" ? 1 : undefined };
    },
});
(0, registry_core_1.attachCliBinding)("migration.list", {
    path: ["migration", "list"],
    jsonMode: "default",
    handler: () => ({ json: (0, state_cli_1.migrationList)() }),
});
(0, registry_core_1.attachCliBinding)("migration.check", {
    path: ["migration", "check"],
    jsonMode: "default",
    handler: (args) => {
        const target = (0, io_2.required)(args.positionals[0], "target (run-id or state/app file)");
        const report = (0, state_cli_1.migrationCheck)(target, args.options);
        return { json: report, exitCode: report.status === "unsupported" ? 1 : undefined };
    },
});
(0, registry_core_1.attachCliBinding)("migration.prove", {
    path: ["migration", "prove"],
    jsonMode: "default",
    handler: (args) => {
        const target = (0, io_2.required)(args.positionals[0], "target (run-id or state/app file)");
        const proof = (0, state_cli_1.migrationProve)(target, args.options);
        return { json: proof, exitCode: proof.pass ? undefined : 1 };
    },
});
(0, registry_core_1.attachCliBinding)("node.list", {
    path: ["node", "list"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, state_cli_1.listNodes)((0, io_2.required)(args.positionals[0], "run id"), args.options) }),
});
(0, registry_core_1.attachCliBinding)("node.show", {
    path: ["node", "show"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, io_2.required)(args.positionals[0], "run id");
        const nodeId = (0, io_2.required)(args.positionals[1], "node id");
        return { json: (0, state_cli_1.showNode)(runId, nodeId, args.options) };
    },
});
// jsonMode "flag": `--json` prints the node array (graphNodes); the bare
// verb prints the operator run-graph text, byte-for-byte the old build's
// `node graph` render (formatOperatorGraph over runner.operatorGraph).
(0, registry_core_1.attachCliBinding)("node.graph", {
    path: ["node", "graph"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, io_2.required)(args.positionals[0], "run id");
        return { json: (0, state_cli_1.graphNodes)(runId, args.options), text: `${(0, report_view_cli_1.graphText)(runId, args.options)}\n` };
    },
});
(0, registry_core_1.attachCliBinding)("node.snapshot", {
    path: ["node", "snapshot"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, io_2.required)(args.positionals[0], "run id");
        const nodeId = (0, io_2.required)(args.positionals[1], "node id");
        return { json: (0, state_cli_1.nodeSnapshotCli)(runId, nodeId, args.options) };
    },
});
(0, registry_core_1.attachCliBinding)("node.diff", {
    path: ["node", "diff"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, io_2.required)(args.positionals[0], "run id");
        const baselineSnapshotId = (0, io_2.required)(args.positionals[1], "baseline snapshot id");
        const candidateSnapshotId = (0, io_2.required)(args.positionals[2], "candidate snapshot id");
        return { json: (0, state_cli_1.nodeDiffCli)(runId, baselineSnapshotId, candidateSnapshotId, args.options) };
    },
});
(0, registry_core_1.attachCliBinding)("node.replay", {
    path: ["node", "replay"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, io_2.required)(args.positionals[0], "run id");
        const snapshotId = (0, io_2.required)(args.positionals[1], "snapshot id");
        return { json: (0, state_cli_1.nodeReplayCli)(runId, snapshotId, args.options) };
    },
});
(0, registry_core_1.attachCliBinding)("node.replay.verify", {
    path: ["node", "verify"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, io_2.required)(args.positionals[0], "run id");
        const replayId = (0, io_2.required)(args.positionals[1], "replay id");
        const verdict = (0, state_cli_1.nodeReplayVerifyCli)(runId, replayId, args.options);
        return { json: verdict, exitCode: verdict.pass ? undefined : 1 };
    },
});
// GAP #24: mirror the state-kernel CLI shell fns as MCP handlers (they were
// declared MCP tool rows but left on notYetImplemented). Arg-name reads copied
// byte-for-byte from the old build's mcp/tool-call.ts switch arms.
registry_core_1.REGISTRY_BY_CAPABILITY.get("state.check").mcp.handler = (args) => (0, state_cli_1.checkState)((0, io_2.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("migration.list").mcp.handler = () => (0, state_cli_1.migrationList)();
registry_core_1.REGISTRY_BY_CAPABILITY.get("migration.check").mcp.handler = (args) => (0, state_cli_1.migrationCheck)((0, io_2.required)((0, io_1.optionalArg)(args.target ?? args.runId), "target (run-id or state/app file)"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("migration.prove").mcp.handler = (args) => (0, state_cli_1.migrationProve)((0, io_2.required)((0, io_1.optionalArg)(args.target ?? args.runId), "target (run-id or state/app file)"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("node.list").mcp.handler = (args) => (0, state_cli_1.listNodes)((0, io_2.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("node.show").mcp.handler = (args) => (0, state_cli_1.showNode)((0, io_2.required)((0, io_1.optionalArg)(args.runId), "run id"), (0, io_2.required)((0, io_1.optionalArg)(args.nodeId), "node id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("node.graph").mcp.handler = (args) => (0, state_cli_1.graphNodes)((0, io_2.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("node.snapshot").mcp.handler = (args) => (0, state_cli_1.nodeSnapshotCli)((0, io_2.required)((0, io_1.optionalArg)(args.runId), "run id"), (0, io_2.required)((0, io_1.optionalArg)(args.nodeId), "node id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("node.diff").mcp.handler = (args) => (0, state_cli_1.nodeDiffCli)((0, io_2.required)((0, io_1.optionalArg)(args.runId), "run id"), (0, io_2.required)((0, io_1.optionalArg)(args.baselineSnapshotId ?? args.baseline), "baseline snapshot id"), (0, io_2.required)((0, io_1.optionalArg)(args.candidateSnapshotId ?? args.candidate), "candidate snapshot id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("node.replay").mcp.handler = (args) => (0, state_cli_1.nodeReplayCli)((0, io_2.required)((0, io_1.optionalArg)(args.runId), "run id"), (0, io_2.required)((0, io_1.optionalArg)(args.snapshotId), "snapshot id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("node.replay.verify").mcp.handler = (args) => (0, state_cli_1.nodeReplayVerifyCli)((0, io_2.required)((0, io_1.optionalArg)(args.runId), "run id"), (0, io_2.required)((0, io_1.optionalArg)(args.replayId), "replay id"), args);
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
const state_explosion_text_1 = require("../../core/format/state-explosion-text");
const state_explosion_cli_1 = require("../../shell/state-explosion-cli");
const io_3 = require("../../cli/io");
(0, registry_core_1.attachCliBinding)("summary.refresh", {
    path: ["summary", "refresh"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, io_2.required)(args.positionals[0], "run id");
        const index = (0, state_explosion_cli_1.summaryRefreshCli)(runId, args.options);
        // Byte-exact port of the old build's handleSummary "refresh": the
        // human-text branch re-reads via a fresh summaryShow call rather than
        // formatting the refresh's own index record (src/cli/handlers/
        // operator.ts:118-127); only computed when actually needed, so a
        // --json call does exactly the one read the old build's if/else did.
        if ((0, io_3.wantsJson)(args.options))
            return { json: index };
        return { json: index, text: (0, state_explosion_text_1.formatStateExplosionReport)((0, state_explosion_cli_1.summaryShowCli)(runId, args.options)) };
    },
});
(0, registry_core_1.attachCliBinding)("summary.show", {
    path: ["summary", "show"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, io_2.required)(args.positionals[0], "run id");
        const report = (0, state_explosion_cli_1.summaryShowCli)(runId, args.options);
        return { json: report, text: (0, state_explosion_text_1.formatStateExplosionReport)(report) };
    },
});
// ---------------------------------------------------------------------
