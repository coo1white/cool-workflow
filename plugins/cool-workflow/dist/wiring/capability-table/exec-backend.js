"use strict";
// wiring/capability-table/exec-backend.ts — MILESTONE 5 (execution backend,
// agent spawn, sandbox) CLI bindings: sandbox.*, backend.*, app.run. Split
// out of core/capability-table.ts, byte-for-byte (extracted with sed, not
// retyped).
Object.defineProperty(exports, "__esModule", { value: true });
const registry_core_1 = require("./registry-core");
// MILESTONE 5 (execution backend, agent spawn, sandbox) CLI bindings:
// sandbox.list|show|validate, backend.list|show|probe,
// backend.agent.config.show|set, doctor, fix. Handler BODIES live in
// shell/exec-backend-cli.ts / shell/doctor.ts (impure — env/fs reads);
// this table only wires argv shape -> handler call, per cli/dispatch.ts's
// generic executor contract. `sandbox.list`/`backend.list` are ALREADY
// declared MCP-only rows from milestone 2 (MCP_TOOL_DATA above) — this
// section layers a `cli` binding onto them (attachCliBinding) and replaces
// their milestone-2 placeholder `mcp.handler` with the real body, exactly
// as milestones 3/4 did for their own rows.
// ---------------------------------------------------------------------
const cli_args_1 = require("../../core/util/cli-args");
// This slice is required unconditionally at startup for every command; every
// shell import below is lazy (require()'d only inside the handler that
// actually uses it), so a command that never touches doctor/fix/sandbox/
// backend/app.run never pays any of these shell modules' require cost.
function loadDoctor() {
    return require("../../shell/doctor");
}
function loadAppRunCli() {
    return require("../../shell/app-run-cli");
}
function loadExecBackendCli() {
    return require("../../shell/exec-backend-cli");
}
(0, registry_core_1.attachCliBinding)("sandbox.list", {
    path: ["sandbox", "list"],
    jsonMode: "default",
    handler: (args) => ({ json: loadExecBackendCli().listSandboxProfilesCli(args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("sandbox.list").mcp.handler = (args) => loadExecBackendCli().listSandboxProfilesCli(args);
// GAP #24: cw_sandbox_choose / cw_sandbox_resolve + cw_app_run were declared
// MCP-only rows with the notYetImplemented placeholder handler. Wire them to
// the ported shell bodies (both are MCP-only in the old build — no CLI path).
registry_core_1.REGISTRY_BY_CAPABILITY.get("sandbox.choose").mcp.handler = (args) => loadAppRunCli().sandboxChooseCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("sandbox.resolve").mcp.handler = (args) => loadAppRunCli().sandboxChooseCli(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("app.run").mcp.handler = (args) => loadAppRunCli().appRunCli(args);
(0, registry_core_1.attachCliBinding)("sandbox.show", {
    path: ["sandbox", "show"],
    jsonMode: "default",
    handler: (args) => ({ json: loadExecBackendCli().showSandboxProfileCli((0, cli_args_1.required)(args.positionals[0], "profile id"), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("sandbox.show").mcp.handler = (args) => loadExecBackendCli().showSandboxProfileCli((0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.profileId), "profile id"), args);
(0, registry_core_1.attachCliBinding)("sandbox.validate", {
    path: ["sandbox", "validate"],
    jsonMode: "default",
    handler: (args) => {
        const result = loadExecBackendCli().validateSandboxProfileCli((0, cli_args_1.required)(args.positionals[0], "profile file"), args.options);
        return { json: result, exitCode: result.valid ? undefined : 1 };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("sandbox.validate").mcp.handler = (args) => loadExecBackendCli().validateSandboxProfileCli((0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.profileFile), "profile file"), args);
// PARITY: `sandbox.choose`/`sandbox.resolve` are BOTH-surface capabilities
// per SPEC/mcp.md (old build cli.path ["sandbox","choose"]/["sandbox",
// "resolve"]) — they were left MCP-only at GAP #24 (see the comment
// above sandboxChooseCli's mcp.handler wiring). Attach the same, already-
// working shell body as the cli.handler too, so the CLI front door and
// the parity payload probe both reach it (no new business logic, same
// function both surfaces already call over MCP).
(0, registry_core_1.attachCliBinding)("sandbox.choose", {
    path: ["sandbox", "choose"],
    jsonMode: "default",
    handler: (args) => ({ json: loadAppRunCli().sandboxChooseCli(args.options) }),
});
(0, registry_core_1.attachCliBinding)("sandbox.resolve", {
    path: ["sandbox", "resolve"],
    jsonMode: "default",
    handler: (args) => ({ json: loadAppRunCli().sandboxChooseCli(args.options) }),
});
(0, registry_core_1.attachCliBinding)("backend.list", {
    path: ["backend", "list"],
    jsonMode: "default",
    handler: () => ({ json: loadExecBackendCli().listBackendsCli() }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("backend.list").mcp.handler = () => loadExecBackendCli().listBackendsCli();
(0, registry_core_1.attachCliBinding)("backend.show", {
    path: ["backend", "show"],
    jsonMode: "default",
    handler: (args) => ({ json: loadExecBackendCli().showBackendCli((0, cli_args_1.required)(args.positionals[0], "backend id")) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("backend.show").mcp.handler = (args) => loadExecBackendCli().showBackendCli((0, cli_args_1.required)((0, cli_args_1.optionalArg)(args.backendId), "backend id"));
(0, registry_core_1.attachCliBinding)("backend.probe", {
    path: ["backend", "probe"],
    jsonMode: "default",
    handler: (args) => ({ json: loadExecBackendCli().probeBackendCli(args.positionals[0], args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("backend.probe").mcp.handler = (args) => loadExecBackendCli().probeBackendCli((0, cli_args_1.optionalArg)(args.backendId), args);
// `backend agent config [show]` = read-only; `backend agent config set
// ...` = mutating. CLI path is ["backend", "agent"] (2 tokens, matching
// dispatchTable's supported path lengths); the remaining positionals
// ("config", "show"/"set") are read inside the handler, byte-exact to the
// old build's handleBackend "agent" case (src/cli/handlers/
// operational.ts:52-62).
(0, registry_core_1.attachCliBinding)("backend.agent.config.show", {
    path: ["backend", "agent"],
    helpPath: ["backend", "agent", "config"],
    jsonMode: "default",
    handler: (args) => {
        const action = args.positionals[1];
        if (action === "set")
            return { json: loadExecBackendCli().backendAgentConfigSet(args.options) };
        return { json: loadExecBackendCli().backendAgentConfigShow(args.options) };
    },
});
// `backend.agent.config.set` shares the SAME dispatch path/handler as
// `.show` above (dispatchTable only supports 2-token paths, and the
// show-vs-set branch lives inside that one handler on positionals[1] —
// byte-exact to the old build's handleBackend "agent" case). This second
// attachCliBinding call exists ONLY so `cw help backend` lists both rows
// (cliCommandHelpRows iterates cliCapabilities(), one row per capability),
// matching the old registry's two declared rows sharing one caseTokens
// group; dispatchTable itself never reaches this row a second time because
// `backend.agent.config.show`'s row is found first by
// findCapabilityByCliPath's linear scan and its handler already covers
// both actions.
(0, registry_core_1.attachCliBinding)("backend.agent.config.set", {
    path: ["backend", "agent"],
    helpPath: ["backend", "agent", "config"],
    jsonMode: "default",
    handler: (args) => {
        const action = args.positionals[1];
        if (action === "set")
            return { json: loadExecBackendCli().backendAgentConfigSet(args.options) };
        return { json: loadExecBackendCli().backendAgentConfigShow(args.options) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("backend.agent.config.show").mcp.handler = (args) => loadExecBackendCli().backendAgentConfigShow(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("backend.agent.config.set").mcp.handler = (args) => loadExecBackendCli().backendAgentConfigSet(args);
// PARITY: `backend.agent.config.set` mutates $CW_HOME/agent-config.json
// (secret-stripped) before returning the effective config; both surfaces
// perform the same write, so it is a documented opt-out from the
// read-payload probe, not an undocumented divergence.
registry_core_1.REGISTRY_BY_CAPABILITY.get("backend.agent.config.set").payloadIdentical = false;
registry_core_1.REGISTRY_BY_CAPABILITY.get("backend.agent.config.set").reason =
    "Mutating: persists $CW_HOME/agent-config.json (secret-stripped) before returning the effective config; both surfaces perform the same write — it is a surface-mutating verb, not a read probe.";
(0, registry_core_1.addCliOnlyCapability)("doctor", "Diagnose the host for setup problems (Node version, agent backend, agent binary on PATH, git, writable home/repo state) and print an actionable fix per check.", {
    path: ["doctor"],
    jsonMode: "flag",
    handler: (args) => {
        const doctor = loadDoctor();
        const report = doctor.runDoctor(args.options, process.env, String(args.options.cwd || process.cwd()));
        // Byte-exact port of the old build's command-surface module: both text
        // branches are written as `${formatX(report)}\n` UNCONDITIONALLY —
        // formatDoctorFixes already ends in its own "\n" (its last joined
        // element is ""), so its case needs one MORE explicit "\n" here to
        // reproduce that unconditional append; cli/dispatch.ts's generic
        // renderer only appends "\n" when the text does NOT already end in
        // one, so a bare `formatDoctorFixes(report)` here would silently
        // drop the old build's trailing blank line.
        const text = (0, cli_args_1.wantsJson)(args.options) ? undefined : args.options.fix ? `${doctor.formatDoctorFixes(report)}\n` : doctor.formatDoctorReport(report);
        return { json: report, text, exitCode: report.ok ? undefined : 1 };
    },
    // UI/UX fix: `cw help doctor` used to list only the one-line summary
    // above, so a first-run user had no way to learn these flags without
    // reading source. Real flag names verified against this handler and
    // the `runDoctor(args.options, ...)` call it makes (shell/doctor.ts).
    flags: [
        { name: "--onramp", summary: "Run the extra onramp checks (3-step quick start)." },
        { name: "--fix", summary: "Print fix commands instead of the full report." },
        { name: "--changed-from REF", summary: "Check the onramp only for the change since REF." },
        { name: "--json", summary: "Print the report as JSON." },
    ],
    // The handler above and runDoctor (shell/doctor.ts) read exactly
    // onramp/fix/changed-from/json plus the shared globals (cwd, format)
    // — the list above is complete, so the dispatcher may warn about an
    // unknown flag (TTY-only; see cli/global-flags.ts).
    flagsComplete: true,
}, "Environment diagnostics are inherently local to the CLI host — Node version, $PATH, $CW_HOME/cwd writability. An MCP client diagnosing the server process's environment is not meaningful; agents already receive the same readiness facts in their typed results (e.g. status: blocked, agentConfigured). Inspired by `brew doctor`.");
(0, registry_core_1.addCliOnlyCapability)("fix", "Print consolidated fix commands for CW setup issues.", {
    path: ["fix"],
    jsonMode: "human",
    handler: (args) => {
        const doctor = loadDoctor();
        const report = doctor.runDoctor(args.options, process.env, String(args.options.cwd || process.cwd()));
        // See the "doctor" handler's comment above: formatDoctorFixes
        // already ends in "\n", so one more explicit "\n" here reproduces
        // the old build's command-surface module's unconditional
        // `${formatDoctorFixes(report)}\n` write.
        return { text: `${doctor.formatDoctorFixes(report)}\n`, exitCode: report.ok ? undefined : 1 };
    },
}, "Environment fix commands are local diagnostics, same reasoning as doctor.");
// ---------------------------------------------------------------------
