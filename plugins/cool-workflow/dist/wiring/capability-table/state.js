// wiring/capability-table/state.ts — state-kernel CLI bindings:
// state.check, migration.list|check|prove, node.list|show|graph|
// snapshot|diff|replay|replay.verify, contract.show.
import { attachCliBinding, REGISTRY_BY_CAPABILITY } from "./registry-core.js";
import { optionalArg } from "../../core/util/cli-args.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// This slice is required unconditionally at startup for every command;
// load these shell modules only when a handler that actually needs them runs.
function loadReportViewCli() {
    return require("../../shell/report-view-cli.js");
}
function loadStateCli() {
    return require("../../shell/state-cli.js");
}
// State-kernel CLI bindings: state.check, migration.list|
// check|prove, node.list|show|graph|snapshot|diff|replay|replay.verify.
// Handler BODIES live in shell/state-cli.ts (impure — they read/write
// run state on disk); this table only wires argv shape -> handler call
// and the row's own exit-code rule, per cli/dispatch.ts's generic
// executor contract. `required`/`optionalArg` are core/util/cli-args.ts's
// shared coercion helpers, imported here so the wiring stays a thin adapter
// (Usage-error strings are byte-pinned).
// ---------------------------------------------------------------------
import { required } from "../../core/util/cli-args.js";
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
// verb prints the operator run-graph text (formatOperatorGraph).
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
// The state-kernel CLI shell fns, as MCP handlers.
REGISTRY_BY_CAPABILITY.get("state.check").mcp.handler = (args) => loadStateCli().checkState(required(optionalArg(args.runId), "run id"), args);
REGISTRY_BY_CAPABILITY.get("migration.list").mcp.handler = () => loadStateCli().migrationList();
REGISTRY_BY_CAPABILITY.get("migration.check").mcp.handler = (args) => loadStateCli().migrationCheck(required(optionalArg(args.target ?? args.runId), "target (run-id or state/app file)"), args);
REGISTRY_BY_CAPABILITY.get("migration.prove").mcp.handler = (args) => loadStateCli().migrationProve(required(optionalArg(args.target ?? args.runId), "target (run-id or state/app file)"), args);
REGISTRY_BY_CAPABILITY.get("node.list").mcp.handler = (args) => loadStateCli().listNodes(required(optionalArg(args.runId), "run id"), args);
REGISTRY_BY_CAPABILITY.get("node.show").mcp.handler = (args) => loadStateCli().showNode(required(optionalArg(args.runId), "run id"), required(optionalArg(args.nodeId), "node id"), args);
REGISTRY_BY_CAPABILITY.get("node.graph").mcp.handler = (args) => loadStateCli().graphNodes(required(optionalArg(args.runId), "run id"), args);
REGISTRY_BY_CAPABILITY.get("node.snapshot").mcp.handler = (args) => loadStateCli().nodeSnapshotCli(required(optionalArg(args.runId), "run id"), required(optionalArg(args.nodeId), "node id"), args);
REGISTRY_BY_CAPABILITY.get("node.diff").mcp.handler = (args) => loadStateCli().nodeDiffCli(required(optionalArg(args.runId), "run id"), required(optionalArg(args.baselineSnapshotId ?? args.baseline), "baseline snapshot id"), required(optionalArg(args.candidateSnapshotId ?? args.candidate), "candidate snapshot id"), args);
REGISTRY_BY_CAPABILITY.get("node.replay").mcp.handler = (args) => loadStateCli().nodeReplayCli(required(optionalArg(args.runId), "run id"), required(optionalArg(args.snapshotId), "snapshot id"), args);
REGISTRY_BY_CAPABILITY.get("node.replay.verify").mcp.handler = (args) => loadStateCli().nodeReplayVerifyCli(required(optionalArg(args.runId), "run id"), required(optionalArg(args.replayId), "replay id"), args);
// `cw contract show <run> [contract-id]` / `cw_contract_show` — the run's
// own pipeline contract, in shell/state-cli.ts.
attachCliBinding("contract.show", {
    path: ["contract", "show"],
    jsonMode: "default",
    handler: (args) => ({ json: loadStateCli().contractShowCli({ runId: required(args.positionals[0], "run id"), ...args.options }, args.positionals[1]) }),
});
REGISTRY_BY_CAPABILITY.get("contract.show").mcp.handler = (args) => loadStateCli().contractShowCli(args);
// ---------------------------------------------------------------------
