"use strict";
// wiring/capability-table/workflow-apps.ts — MILESTONE 12 (workflow-apps:
// app.*, info, man) CLI bindings, plus the `next` capability (a milestone
// 3/6 placeholder folded in alongside app.* per the file's own history).
// Split out of core/capability-table.ts, byte-for-byte (extracted with
// sed, not retyped).
Object.defineProperty(exports, "__esModule", { value: true });
const registry_core_1 = require("./registry-core");
const io_1 = require("../../cli/io");
// This whole module is required unconditionally at startup for EVERY
// command (see wiring/capability-table/index.ts) — loading `next`'s and
// `app.run`'s shell modules lazily, inside the handler that actually
// calls them, keeps other commands from paying their load cost.
function loadStateCli() {
    return require("../../shell/state-cli");
}
function loadAppRunCli() {
    return require("../../shell/app-run-cli");
}
// MILESTONE 12 (workflow-apps). Handler BODIES live in
// shell/workflow-app-loader.ts (impure — they scan apps/*/app.json +
// workflows/*.workflow.js on disk and `require()` each entrypoint); this
// table only wires argv/tool-args shape -> handler call, per SPEC/
// workflow-apps.md's "Exact outputs". `app.validate` is ALWAYS JSON
// (jsonMode "default") even without --json, and its handler sets
// exitCode 1 on `valid:false` — both the "not found" id case and a
// structurally-broken manifest case fail this same way.
// Loaded lazily so the app.* handlers below pay this module's load cost
// only when actually invoked, not on every CLI/MCP startup.
function loadWorkflowAppLoader() {
    return require("../../shell/workflow-app-loader");
}
const help_1 = require("../../core/format/help");
// Loaded lazily so only the `man` handler below pays its load cost.
function loadManCli() {
    return require("../../shell/man-cli");
}
(0, registry_core_1.attachCliBinding)("app.list", {
    path: ["app", "list"],
    jsonMode: "default",
    handler: () => ({ json: loadWorkflowAppLoader().listWorkflowApps() }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("app.list").mcp.handler = () => loadWorkflowAppLoader().listWorkflowApps();
(0, registry_core_1.attachCliBinding)("app.show", {
    path: ["app", "show"],
    jsonMode: "default",
    handler: (args) => ({ json: loadWorkflowAppLoader().showWorkflowApp((0, io_1.required)(args.positionals[0], "workflow app id")) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("app.show").mcp.handler = (args) => loadWorkflowAppLoader().showWorkflowApp((0, io_1.required)((0, io_1.optionalArg)(args.appId), "workflow app id"));
(0, registry_core_1.attachCliBinding)("app.validate", {
    path: ["app", "validate"],
    jsonMode: "default",
    handler: (args) => {
        const result = loadWorkflowAppLoader().validateWorkflowAppTarget((0, io_1.required)(args.positionals[0], "workflow app path or id"));
        return { json: result, exitCode: result.valid ? undefined : 1 };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("app.validate").mcp.handler = (args) => loadWorkflowAppLoader().validateWorkflowAppTarget((0, io_1.required)((0, io_1.optionalArg)(args.target ?? args.appId), "workflow app path or id"));
(0, registry_core_1.attachCliBinding)("app.init", {
    path: ["app", "init"],
    jsonMode: "default",
    handler: (args) => ({ json: loadWorkflowAppLoader().initWorkflowApp((0, io_1.required)(args.positionals[0], "app id"), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("app.init").mcp.handler = (args) => loadWorkflowAppLoader().initWorkflowApp((0, io_1.required)((0, io_1.optionalArg)(args.appId), "app id"), args);
// `cw init <id>` — the standalone scaffold verb. v2 folds `init` into
// `app.init` (the old build's legacy `.workflow.js` scaffold is gone), so
// both surfaces route through initWorkflowApp, same as `cw app init`. The
// `init` help token is folded away (declaredCliHelpTokens) — it stays in
// the frozen "More commands" index line only, matching the parity smoke's
// HELP_INDEX_ONLY_TOKENS treatment. `workflowId` is the old init arg name.
(0, registry_core_1.attachCliBinding)("init", {
    path: ["init"],
    jsonMode: "default",
    handler: (args) => ({ json: loadWorkflowAppLoader().initWorkflowApp((0, io_1.required)((0, io_1.optionalArg)(args.positionals[0]), "workflow id"), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("init").mcp.handler = (args) => loadWorkflowAppLoader().initWorkflowApp((0, io_1.required)((0, io_1.optionalArg)(args.workflowId ?? args.appId), "workflow id"), args);
(0, registry_core_1.attachCliBinding)("app.package", {
    path: ["app", "package"],
    jsonMode: "default",
    handler: (args) => ({ json: loadWorkflowAppLoader().packageWorkflowApp((0, io_1.required)(args.positionals[0], "app id"), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("app.package").mcp.handler = (args) => loadWorkflowAppLoader().packageWorkflowApp((0, io_1.required)((0, io_1.optionalArg)(args.appId), "app id"), args);
// `cw app run <app-id>` — plan+drive+report an app in one call. 2-token
// cli.path found before the ["app"] usage catch-all; `appRunCli` reads the
// app id from `appId`, so the first positional after "run" is forwarded as
// appId (old build: appRun(runner, { ...options, appId: <positional> })).
(0, registry_core_1.attachCliBinding)("app.run", {
    path: ["app", "run"],
    jsonMode: "default",
    handler: (args) => ({ json: loadAppRunCli().appRunCli({ ...args.options, appId: (0, io_1.required)(args.positionals[0], "app id") }) }),
});
// A 1-token `["app"]` row that exists ONLY to own the fixed usage string
// for an unrecognized `app` subcommand (`app run` is not yet CLI-wired at
// this milestone — cw_app_run stays MCP-only — so a bogus or `run`
// subcommand both fall through to this same usage throw, matching
// SPEC/cli-surface.md's "Usage strings" table byte-for-byte). Per
// dispatchTable's reversed-candidate-order contract (cli/dispatch.ts),
// this 1-token row is only ever reached when no 2-token `app.*` row
// above matched. `hiddenFromHelp` keeps it off `cw help app`'s own line
// (see CliBinding.hiddenFromHelp's doc comment).
(0, registry_core_1.addCliOnlyCapability)("app.usage", "cw app list|show|validate|init|package|run [app-id|path] — the workflow-app framework.", {
    path: ["app"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw app list|show|validate|init|package|run [app-id|path]");
    },
}, "app.usage exists only to own the fixed usage-error text for an unrecognized app subcommand; every real app.* action is its own capability row above.");
// ---------------------------------------------------------------------
// 1-token usage-fallback rows: one per multi-verb family, each existing
// ONLY to own the fixed usage string for an unrecognized subcommand,
// same pattern and reasoning as app.usage above (SPEC/cli-surface.md's
// "Usage strings" table, byte-for-byte). Per dispatchTable's reversed-
// candidate-order contract (cli/dispatch.ts), each 1-token row here is
// only ever reached when no 2-token real row for that family matched.
// `hiddenFromHelp` keeps each off its own `cw help <verb>` line.
// ---------------------------------------------------------------------
(0, registry_core_1.addCliOnlyCapability)("sandbox.usage", "cw sandbox list|show|validate|choose|resolve [profile-id|profile-file]", {
    path: ["sandbox"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw sandbox list|show|validate|choose|resolve [profile-id|profile-file]");
    },
}, "sandbox.usage exists only to own the fixed usage-error text for an unrecognized sandbox subcommand; every real sandbox.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("state.usage", "cw state check <run-id> [--state PATH] [--write]", {
    path: ["state"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw state check <run-id> [--state PATH] [--write]");
    },
}, "state.usage exists only to own the fixed usage-error text for an unrecognized state subcommand; every real state.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("audit.usage", "cw audit summary|worker|provenance|multi-agent|policy|role|blackboard|judge|attest|decision <run-id> [worker-id|role-id]", {
    path: ["audit"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw audit summary|worker|provenance|multi-agent|policy|role|blackboard|judge|attest|decision <run-id> [worker-id|role-id]");
    },
}, "audit.usage exists only to own the fixed usage-error text for an unrecognized audit subcommand; every real audit.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("blackboard.usage", "cw blackboard summary|summarize|graph|resolve <run-id> | topic create <run-id> | message post|list <run-id> | context put <run-id> | artifact add|list <run-id> | snapshot <run-id>", {
    path: ["blackboard"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw blackboard summary|summarize|graph|resolve <run-id> | topic create <run-id> | message post|list <run-id> | context put <run-id> | artifact add|list <run-id> | snapshot <run-id>");
    },
}, "blackboard.usage exists only to own the fixed usage-error text for an unrecognized blackboard subcommand; every real blackboard.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("candidate.usage", "cw candidate list|show|register|score|rank|select|reject|summary <run-id> [candidate-id]", {
    path: ["candidate"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw candidate list|show|register|score|rank|select|reject|summary <run-id> [candidate-id]");
    },
}, "candidate.usage exists only to own the fixed usage-error text for an unrecognized candidate subcommand; every real candidate.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("comment.usage", "cw comment add <kind> <run-id> <target-id> --body <text> | comment list <run-id> [--json]", {
    path: ["comment"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw comment add <kind> <run-id> <target-id> --body <text> | comment list <run-id> [--json]");
    },
}, "comment.usage exists only to own the fixed usage-error text for an unrecognized comment subcommand; every real comment.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("eval.usage", "cw eval snapshot <run-id> --id <snapshot-id> | replay <snapshot-id-or-path> | compare <baseline-id-or-path> <replay-id-or-path> | score <replay-id-or-path> | gate <suite-id-or-path> | report <replay-id-or-path>", {
    path: ["eval"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw eval snapshot <run-id> --id <snapshot-id> | replay <snapshot-id-or-path> | compare <baseline-id-or-path> <replay-id-or-path> | score <replay-id-or-path> | gate <suite-id-or-path> | report <replay-id-or-path>");
    },
}, "eval.usage exists only to own the fixed usage-error text for an unrecognized eval subcommand; every real eval.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("telemetry.usage", "cw telemetry verify <run-id> [--pubkey <pem-or-path>] [--json]", {
    path: ["telemetry"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw telemetry verify <run-id> [--pubkey <pem-or-path>] [--json]");
    },
}, "telemetry.usage exists only to own the fixed usage-error text for an unrecognized telemetry subcommand; every real telemetry.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("demo.usage", "cw demo tamper|bundle [--json]", {
    path: ["demo"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw demo tamper|bundle [--json]");
    },
}, "demo.usage exists only to own the fixed usage-error text for an unrecognized demo subcommand; every real demo.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("multi-agent.usage", "cw multi-agent run|status|step|blackboard|score|select|summary|summarize|graph|dependencies|failures|evidence|reasoning|show|role|group|membership|fanout|fanin <run-id> [id]", {
    path: ["multi-agent"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw multi-agent run|status|step|blackboard|score|select|summary|summarize|graph|dependencies|failures|evidence|reasoning|show|role|group|membership|fanout|fanin <run-id> [id]");
    },
}, "multi-agent.usage exists only to own the fixed usage-error text for an unrecognized multi-agent subcommand; every real multi-agent.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("node.usage", "cw node list|show|graph|snapshot|diff|replay|verify <run-id> [node-id|snapshot-id|replay-id]", {
    path: ["node"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw node list|show|graph|snapshot|diff|replay|verify <run-id> [node-id|snapshot-id|replay-id]");
    },
}, "node.usage exists only to own the fixed usage-error text for an unrecognized node subcommand; every real node.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("backend.usage", "cw backend list|show|probe [backend-id]  |  cw backend agent config [show|set] [--agent-command ... --agent-endpoint ... --agent-model ...]", {
    path: ["backend"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw backend list|show|probe [backend-id]  |  cw backend agent config [show|set] [--agent-command ... --agent-endpoint ... --agent-model ...]");
    },
}, "backend.usage exists only to own the fixed usage-error text for an unrecognized backend subcommand; every real backend.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("contract.usage", "cw contract show <run-id> [contract-id]", {
    path: ["contract"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw contract show <run-id> [contract-id]");
    },
}, "contract.usage exists only to own the fixed usage-error text for an unrecognized contract subcommand; every real contract.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("migration.usage", "cw migration list|check|prove [target] [--contract run-state|workflow-app]", {
    path: ["migration"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw migration list|check|prove [target] [--contract run-state|workflow-app]");
    },
}, "migration.usage exists only to own the fixed usage-error text for an unrecognized migration subcommand; every real migration.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("feedback.usage", "cw feedback list|show|summary|collect|task|resolve <run-id> [feedback-id]", {
    path: ["feedback"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw feedback list|show|summary|collect|task|resolve <run-id> [feedback-id]");
    },
}, "feedback.usage exists only to own the fixed usage-error text for an unrecognized feedback subcommand; every real feedback.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("metrics.usage", "cw metrics show <run-id> | metrics summary [--scope repo|home] [--pricing <path>|default] [--limit N] [--json]", {
    path: ["metrics"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw metrics show <run-id> | metrics summary [--scope repo|home] [--pricing <path>|default] [--limit N] [--json]");
    },
}, "metrics.usage exists only to own the fixed usage-error text for an unrecognized metrics subcommand; every real metrics.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("operator.usage", "cw operator status|report <run-id> [--json]", {
    path: ["operator"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw operator status|report <run-id> [--json]");
    },
}, "operator.usage exists only to own the fixed usage-error text for an unrecognized operator subcommand; every real operator.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("topology.usage", "cw topology list|show <topology-id>|show <run-id> <topology-run-id>|validate <topology-id>|apply <run-id> <topology-id>|summary <run-id>|graph <run-id>", {
    path: ["topology"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw topology list|show <topology-id>|show <run-id> <topology-run-id>|validate <topology-id>|apply <run-id> <topology-id>|summary <run-id>|graph <run-id>");
    },
}, "topology.usage exists only to own the fixed usage-error text for an unrecognized topology subcommand; every real topology.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("summary.usage", "cw summary refresh|show <run-id> [--json]", {
    path: ["summary"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw summary refresh|show <run-id> [--json]");
    },
}, "summary.usage exists only to own the fixed usage-error text for an unrecognized summary subcommand; every real summary.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("workbench.usage", "cw workbench serve [--port N] [--once] [--require-token] | view <run-id> [--json]", {
    path: ["workbench"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw workbench serve [--port N] [--once] [--require-token] | view <run-id> [--json]");
    },
}, "workbench.usage exists only to own the fixed usage-error text for an unrecognized workbench subcommand; every real workbench.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("worker.usage", "cw worker list|summary|show|manifest|output|fail|validate <run-id> [worker-id] [result-file]", {
    path: ["worker"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw worker list|summary|show|manifest|output|fail|validate <run-id> [worker-id] [result-file]");
    },
}, "worker.usage exists only to own the fixed usage-error text for an unrecognized worker subcommand; every real worker.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("review.usage", "cw review status <run-id> [--json] | review policy <run-id> --required-approvals N --authorized-roles a,b --applies-to commit,selection", {
    path: ["review"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw review status <run-id> [--json] | review policy <run-id> --required-approvals N --authorized-roles a,b --applies-to commit,selection");
    },
}, "review.usage exists only to own the fixed usage-error text for an unrecognized review subcommand; every real review.* action is its own capability row above.");
(0, registry_core_1.addCliOnlyCapability)("coordinator.usage", "cw coordinator summary <run-id> | coordinator decision <run-id> --kind <kind> --outcome <outcome> --reason TEXT", {
    path: ["coordinator"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: () => {
        throw new Error("Usage: cw coordinator summary <run-id> | coordinator decision <run-id> --kind <kind> --outcome <outcome> --reason TEXT");
    },
}, "coordinator.usage exists only to own the fixed usage-error text for an unrecognized coordinator subcommand; every real coordinator.* action is its own capability row above.");
// ---- man (CLI-only; raw manual-page bytes to stdout, no MCP peer) -----
//
// Writes the resolved doc file's raw bytes directly to stdout and
// returns an empty result — the generic renderCliResult (cli/dispatch.ts)
// always appends "\n" to `result.text` when it is missing one, which
// would violate "no added trailing newline" for any manual page that
// does not already end in one. A handler performing its own stdout write
// and returning `{}` is the established escape hatch (see
// workbench.serve's handler above for the same pattern/reasoning).
(0, registry_core_1.addCliOnlyCapability)("man", "cw man <topic> — read a manual page from docs/ (raw bytes, no added newline).", {
    path: ["man"],
    jsonMode: "human",
    // core/format/help.ts's COMMAND_HELP_ROWS.man already owns the
    // human-facing "cw man" help line (byte-ported from the old build's
    // orchestrator.ts help table); hiddenFromHelp avoids a duplicate row.
    hiddenFromHelp: true,
    handler: (args) => {
        const topic = args.positionals[0];
        if (!topic) {
            throw new Error("Missing topic.\n  Tip: cw man release-tooling for the release tooling manual.");
        }
        process.stdout.write(loadManCli().readManPage(topic));
        return {};
    },
}, "man is a CLI-only raw-file reader over docs/; the old build never gave it an MCP peer.");
// ---- info (CLI-only; mirrors app.show with a human card by default) ----
(0, registry_core_1.addCliOnlyCapability)("info", "Show a workflow app's contract as a human card (or JSON with --json).", {
    path: ["info"],
    jsonMode: "flag",
    handler: (args) => {
        const appId = (0, io_1.required)(args.positionals[0], "workflow app id");
        const data = loadWorkflowAppLoader().showWorkflowApp(appId);
        return { json: data, text: `${(0, help_1.formatInfo)(appId, data)}\n` };
    },
}, "info is a CLI-only convenience card over app.show; the old build never gave it an MCP peer.");
// ---- PARITY WIRING -------------------------------------------------------
//
// `next` had a raw `case "next"` arm in cli/dispatch.ts (a milestone 3/6
// PLACEHOLDER that always throws "not implemented in this milestone") but
// no row in this table's cli binding, so it had no cli-mcp-parity-smoke /
// cli-jsonmode-parity-smoke coverage. This row makes `next` a real,
// dual-bound capability (matching the old build's `cli: { path: ["next"],
// jsonMode: "default" }`) with the SAME placeholder body as the dispatch.ts
// arm — no new capability logic, just giving the existing placeholder a
// home in the one data table. dispatchTable() in cli/dispatch.ts tries this
// row before the switch statement is reached, so the old `case "next"` arm
// is now dead code for the CLI path (left in place, like the other
// superseded arms in that file, each with its own "dispatchTable() above
// always matches first" note).
(0, registry_core_1.attachCliBinding)("next", {
    path: ["next"],
    jsonMode: "default",
    handler: (args) => ({ json: loadStateCli().nextCli((0, io_1.required)((0, io_1.optionalArg)(args.positionals[0]), "run id"), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("next").mcp.handler = (args) => loadStateCli().nextCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
// `ledger.propose`/`.review`/`.verify`/`.apply`/`.list` are documented
// payload-probe opt-outs in the old build (each mints a fresh timestamped/
// digested entry, or reads args that arrive by --file/stdin on the CLI vs
// a plain `entry` argument over MCP, or reads an on-disk ledger directory
// the generic probe does not populate) — same reasoning applies here
// unchanged, since both surfaces still route through the same
// buildLedgerProposal/buildLedgerReview/verifyLedgerEntry/
// applyLedgerProposal/listLedgerEntries core. Ported so these rows do not
// sit unclassified in the payload-identity probe.
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.propose").payloadIdentical = false;
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.propose").reason =
    "Mints a fresh entry each call: createdAt is the wall-clock instant and the id/digest are derived from it, so the output is inherently non-deterministic and a byte-identity probe does not apply. Both surfaces call the same buildLedgerProposal core; round-trip + fail-closed behavior is covered by ledger-verify-smoke.";
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.review").payloadIdentical = false;
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.review").reason =
    "Mints a fresh timestamped/digested verdict each call — non-deterministic output, same reasoning as ledger.propose. Both surfaces call the same buildLedgerReview core.";
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.verify").payloadIdentical = false;
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.verify").reason =
    "The entry arrives by --file/stdin on the CLI and as an `entry` argument over MCP; there is no shared arg-bag the byte-identity probe can feed both. Both surfaces call the same verifyLedgerEntry core; ledger-verify-smoke proves the fail-closed contract.";
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.apply").payloadIdentical = false;
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.apply").reason =
    "The entry arrives by --file/stdin on the CLI and as an `entry` argument over MCP; there is no shared arg-bag the byte-identity probe can feed both. Both surfaces call the same applyLedgerProposal core (a fail-closed wrapper over verifyLedgerEntry); ledger-apply-smoke proves the diff only escapes a verified proposal.";
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.list").payloadIdentical = false;
registry_core_1.REGISTRY_BY_CAPABILITY.get("ledger.list").reason =
    "Output depends on the on-disk contents of the named ledger directory/directories, which the generic payload probe does not populate. Both surfaces call the same listLedgerEntries/unionLedgerEntries core; ledger-verify-smoke covers the fail-closed inbox and the multi-mirror union.";
// ---------------------------------------------------------------------------
