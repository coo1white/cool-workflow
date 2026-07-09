"use strict";
// wiring/capability-table/pipeline.ts — MILESTONE 6+7 (plan, run.drive*,
// dispatch, result, commit, commit.summary) + MILESTONE 11's run.export/
// import/verify-import/inspect-archive/restore CLI bindings. Split out of
// core/capability-table.ts, byte-for-byte (extracted with sed, not
// retyped).
Object.defineProperty(exports, "__esModule", { value: true });
const registry_core_1 = require("./registry-core");
const io_1 = require("../../cli/io");
const io_2 = require("../../cli/io");
// MILESTONE 6+7 (combined; see docs/rebuild/PLAN.md Open risk 10) CLI bindings:
// plan, quickstart, run --drive, run drive (preview), dispatch, result,
// commit. Handler BODIES live in shell/pipeline-cli.ts (impure — they
// plan/drive/dispatch/commit real run state on disk); this table only
// wires argv shape -> handler call, per cli/dispatch.ts's generic
// executor contract.
// ---------------------------------------------------------------------
// This file is required unconditionally at startup for every command, so
// a top-level import of pipeline-cli/commit-summary would cost every
// invocation, not just plan/run/dispatch/result/commit/commit.summary ones.
function loadPipelineCli() {
    return require("../../shell/pipeline-cli");
}
function loadCommitSummary() {
    return require("../../shell/commit-summary");
}
(0, registry_core_1.attachCliBinding)("plan", {
    path: ["plan"],
    jsonMode: "default",
    handler: (args) => {
        const workflowId = (0, io_2.optionalArg)(args.positionals[0]);
        if (!workflowId) {
            throw new Error('Missing workflow id.\n  Tip: plan an architecture review with "cw plan architecture-review"');
        }
        return { json: loadPipelineCli().planRun({ ...args.options, workflowId }) };
    },
});
// `cw run <app> --drive [--once]` and `cw run drive <run-id> [--step]`
// share the single `run` dispatch path (byte-exact to the old build's
// handleRun: a run-REGISTRY subcommand keyword is never hijacked by the
// bare `--drive` intercept just because it carries its own --drive/--step
// flag). Both rows below dispatch on `["run"]`; the FIRST one registered
// (run.drive.step) is found first by findCapabilityByCliPath's linear
// scan, so its handler carries the full branch — the second row exists
// only so `cw help run` lists both capabilities.
(0, registry_core_1.attachCliBinding)("run.drive.step", {
    path: ["run"],
    helpPath: ["run", "drive"],
    jsonMode: "default",
    handler: async (args) => {
        const registrySubcommands = new Set(["drive", "search", "list", "show", "resume", "archive", "rerun", "export", "import", "verify-import", "inspect-archive", "restore"]);
        const target = args.positionals[0];
        if (args.options.drive && !registrySubcommands.has(String(target || ""))) {
            const runId = (0, io_2.optionalArg)(args.options.run) || (0, io_2.optionalArg)(args.options.runId);
            if (args.options.preview)
                return { json: loadPipelineCli().runDrivePreview({ ...args.options, runId: runId || target }) };
            const driveArgs = { ...args.options };
            if (runId)
                driveArgs.runId = runId;
            else
                driveArgs.appId = target;
            return { json: await loadPipelineCli().runDriveStep(driveArgs) };
        }
        const [subcommand, id] = args.positionals;
        if (subcommand === "drive") {
            if (args.options.step) {
                const driveArgs = { ...args.options };
                if (id)
                    driveArgs.runId = id;
                return { json: await loadPipelineCli().runDriveStep(driveArgs) };
            }
            return { json: loadPipelineCli().runDrivePreview({ ...args.options, runId: (0, io_1.required)(id, "run id") }) };
        }
        // MILESTONE 11 (reporting/run-export) — the archive family. Handler
        // bodies live in shell/run-export-cli.ts; this arm only wires argv
        // shape -> handler call.
        if (subcommand === "export") {
            const result = loadRunExportCli().runExportCli((0, io_1.required)(id, "run id"), args.options);
            return { json: result };
        }
        if (subcommand === "import") {
            const result = loadRunExportCli().runImportCli((0, io_1.required)(id, "archive path"), args.options);
            return { json: result };
        }
        if (subcommand === "verify-import") {
            const result = loadRunExportCli().runVerifyImportCli((0, io_1.required)(id, "run id"), args.options);
            return { json: result, exitCode: args.options.strict && !result.ok ? 1 : undefined };
        }
        if (subcommand === "inspect-archive") {
            const result = loadRunExportCli().runInspectArchiveCli((0, io_1.required)(id, "archive path"), args.options);
            return { json: result, exitCode: result.ok ? undefined : 1 };
        }
        if (subcommand === "restore") {
            const result = loadRunExportCli().runRestoreCli((0, io_1.required)(id, "archive path"), args.options);
            return { json: result, exitCode: result.ok ? undefined : 1 };
        }
        throw new Error("Usage: cw.js run search|list|show|resume|archive|rerun|drive|export|import|verify-import|inspect-archive|restore [run-id|archive] [--scope repo|home] [--json]  |  cw.js run <app> --drive [--once] [--incremental] [--repo R --question Q]");
    },
});
// PARITY: `run.drive` (the read-only MCP preview tool) now ALSO carries
// its own two-token `cli.path` ["run","drive"], same as the old build's
// registry row (cli.path ["run","drive"]) and the same reversed-
// candidate-order pattern already used for run.search/run.list/etc.
// (see those rows' own comment below): findCapabilityByCliPath tries the
// 2-token candidate BEFORE the 1-token ["run"] row, so this row — not
// run.drive.step's combined switch — now serves `cw run drive <run-id>`
// [--step]. Behavior is unchanged (same runDrivePreview/runDriveStep
// calls, same --step branch run.drive.step's switch already used); only
// WHICH row answers the dispatch changes, so run.drive becomes a real
// both-surface, dual-bound capability for the payload-identity probe.
(0, registry_core_1.attachCliBinding)("run.drive", {
    path: ["run", "drive"],
    jsonMode: "default",
    handler: async (args) => {
        const id = args.positionals[0];
        if (args.options.step) {
            const driveArgs = { ...args.options };
            if (id)
                driveArgs.runId = id;
            return { json: await loadPipelineCli().runDriveStep(driveArgs) };
        }
        return { json: loadPipelineCli().runDrivePreview({ ...args.options, runId: (0, io_1.required)(id, "run id") }) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.drive").mcp.handler = (args) => loadPipelineCli().runDrivePreview(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.drive.step").mcp.handler = (args) => loadPipelineCli().runDriveStep(args);
// PARITY: `run.drive.step` advances the run by spawning the external
// agent per worker and recording attested output — not a read probe.
// CLI (--drive/--step) and MCP route through the same drive() core; the
// opt-out is the documented divergence, not undocumented drift.
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.drive.step").payloadIdentical = false;
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.drive.step").reason =
    "Mutating: advances the run by spawning the external agent per worker and recording attested output — not a read probe. CLI (--drive/--step) and MCP route through the same drive() core.";
registry_core_1.REGISTRY_BY_CAPABILITY.get("plan").mcp.handler = (args) => loadPipelineCli().planRun(args);
// GAP #24: dispatchRun reads the sandbox profile from `args.sandbox` only
// (the CLI's --sandbox flag). The cw_dispatch MCP tool also accepts the
// `sandboxProfile`/`sandboxProfileId` aliases (its declared properties), so
// normalize them onto `sandbox` here — mirrors the old build's
// sandboxProfileIdFrom() alias set — before handing off.
registry_core_1.REGISTRY_BY_CAPABILITY.get("dispatch").mcp.handler = (args) => loadPipelineCli().dispatchRun({ ...args, sandbox: args.sandbox ?? args.sandboxProfile ?? args.sandboxProfileId });
registry_core_1.REGISTRY_BY_CAPABILITY.get("result").mcp.handler = (args) => loadPipelineCli().recordResultRun(args);
// `cw_commit` returns the FLAT commit envelope (verifierGated/checkpoint/
// selectionId/… at the top level, plus a nested `commit`), matching the old
// build's commitEnvelope. `commitRun` (CLI shape) returns `{ runId, commit }`;
// lift the commit's key fields to the top for the MCP surface.
registry_core_1.REGISTRY_BY_CAPABILITY.get("commit").mcp.handler = (args) => {
    const result = loadPipelineCli().commitRun(args);
    const commit = result.commit || {};
    return {
        runId: result.runId,
        commitId: commit.id,
        verifierGated: commit.verifierGated,
        checkpoint: commit.checkpoint,
        verifierNodeId: commit.verifierNodeId,
        candidateId: commit.candidateId,
        selectionId: commit.selectionId,
        evidenceCount: Array.isArray(commit.evidence) ? commit.evidence.length : 0,
        snapshotPath: commit.snapshotPath,
        commit,
    };
};
// PARITY: `commit` is the one declared payload projection (byte-compat
// item 5 above). Both surfaces route through the single core entry
// runner.commit (commitRun); the CLI keeps the raw StateCommitResult for
// scripting while cw_commit lifts an operator-facing envelope on top (see
// the mcp.handler just above). Marked here, not silently let drift, so
// the parity payload probe (core/capability-table.ts's
// payloadIdenticalCapabilities) skips it with a paper trail instead of
// tripping on an undocumented divergence.
registry_core_1.REGISTRY_BY_CAPABILITY.get("commit").payloadIdentical = false;
registry_core_1.REGISTRY_BY_CAPABILITY.get("commit").reason =
    "Both surfaces route through the single core entry runner.commit. The CLI emits the raw StateCommitResult for scripting (commit.id, commit.evidence, commit.gate); cw_commit emits the operator commit envelope (commitId, verifierGated, checkpoint, evidenceCount, snapshotPath, nextActions, plus the raw result under `commit`). Declared projection, not drift.";
// MILESTONE 11 — run.export/import/verify-import/inspect-archive/restore
// MCP handlers (the CLI side is served by run.drive.step's combined
// handler above; these tools are called directly by name over MCP, so
// each needs its own mcp.handler per byte-compat item 5's two-field
// row shape).
// Same lazy-load reasoning as loadPipelineCli/loadCommitSummary above, for
// the run.export/import/verify-import/inspect-archive/restore family.
function loadRunExportCli() {
    return require("../../shell/run-export-cli");
}
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.export").mcp.handler = (args) => loadRunExportCli().runExportCli((0, io_1.required)((0, io_2.optionalArg)(args.runId), "run id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.import").mcp.handler = (args) => loadRunExportCli().runImportCli((0, io_1.required)((0, io_2.optionalArg)(args.archive || args.path || args.file), "archive path"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.verify-import").mcp.handler = (args) => loadRunExportCli().runVerifyImportCli((0, io_1.required)((0, io_2.optionalArg)(args.runId), "run id"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.inspect-archive").mcp.handler = (args) => loadRunExportCli().runInspectArchiveCli((0, io_1.required)((0, io_2.optionalArg)(args.archive || args.path || args.file), "archive path"), args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("run.restore").mcp.handler = (args) => loadRunExportCli().runRestoreCli((0, io_1.required)((0, io_2.optionalArg)(args.archive || args.path || args.file), "archive path"), args);
// `run export|import|verify-import|inspect-archive|restore` each carry their
// own two-token cli.path (found before the ["run"] run.drive.step catch-all
// per the reversed candidate order), calling the same shell fns with the
// same [subcommand, id] positional mapping and exit-code shape the catch-all
// switch already used. `hiddenFromHelp` keeps the byte-pinned `cw help run`
// fixture's rows coming from the single literal COMMAND_HELP_ROWS.run block.
(0, registry_core_1.attachCliBinding)("run.export", {
    path: ["run", "export"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: loadRunExportCli().runExportCli((0, io_1.required)(args.positionals[0], "run id"), args.options) }),
});
(0, registry_core_1.attachCliBinding)("run.import", {
    path: ["run", "import"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => ({ json: loadRunExportCli().runImportCli((0, io_1.required)(args.positionals[0], "archive path"), args.options) }),
});
(0, registry_core_1.attachCliBinding)("run.verify-import", {
    path: ["run", "verify-import"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = loadRunExportCli().runVerifyImportCli((0, io_1.required)(args.positionals[0], "run id"), args.options);
        return { json: result, exitCode: args.options.strict && !result.ok ? 1 : undefined };
    },
});
(0, registry_core_1.attachCliBinding)("run.inspect-archive", {
    path: ["run", "inspect-archive"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = loadRunExportCli().runInspectArchiveCli((0, io_1.required)(args.positionals[0], "archive path"), args.options);
        return { json: result, exitCode: result.ok ? undefined : 1 };
    },
});
(0, registry_core_1.attachCliBinding)("run.restore", {
    path: ["run", "restore"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
        const result = loadRunExportCli().runRestoreCli((0, io_1.required)(args.positionals[0], "archive path"), args.options);
        return { json: result, exitCode: result.ok ? undefined : 1 };
    },
});
(0, registry_core_1.addCliOnlyCapability)("quickstart", "ONE-COMMAND quickstart: --check preflights without writes; otherwise plan(app, default architecture-review) -> run --drive -> report in a single invocation (--preview for a read-only dry run; --bundle [--with-trust-key K] seals a completed run into a self-verified portable bundle).", {
    path: ["quickstart"],
    // `audit-run` is a CLI-only alias that dispatches to the same quickstart
    // wrapper (byte-behavior port of the old build's caseTokens).
    caseTokens: ["quickstart", "audit-run"],
    jsonMode: "default",
    handler: async (args) => {
        const appId = (0, io_2.optionalArg)(args.positionals[0]);
        const result = (await loadPipelineCli().quickstartRun({ ...args.options, appId }));
        // Fail closed on both known bad outcomes: a --check preflight that
        // found a blocking gap, OR a --bundle that did not self-verify.
        const bundle = result.bundle;
        const bundleFailed = Boolean(bundle && bundle.ok === false);
        const exitCode = (result.mode === "check" && result.ok === false) || bundleFailed ? 1 : undefined;
        return { json: result, exitCode };
    },
}, "quickstart composes plan/runDrive/report; SPEC/mcp.md's declared cli-only list names it explicitly (no MCP peer). `audit-run` is a CLI-only alias of the same wrapper.", "quickstart");
(0, registry_core_1.attachCliBinding)("dispatch", {
    path: ["dispatch"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, io_1.required)((0, io_2.optionalArg)(args.positionals[0]), "run id");
        return { json: loadPipelineCli().dispatchRun({ ...args.options, runId }) };
    },
});
(0, registry_core_1.attachCliBinding)("result", {
    path: ["result"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, io_1.required)((0, io_2.optionalArg)(args.positionals[0]), "run id");
        const taskId = (0, io_1.required)((0, io_2.optionalArg)(args.positionals[1]), "task id");
        const resultPath = (0, io_1.required)((0, io_2.optionalArg)(args.positionals[2]), "result file path");
        return { json: loadPipelineCli().recordResultRun({ ...args.options, runId, taskId, resultPath }) };
    },
});
(0, registry_core_1.attachCliBinding)("commit", {
    path: ["commit"],
    jsonMode: "default",
    handler: (args) => {
        const runId = (0, io_1.required)((0, io_2.optionalArg)(args.positionals[0]), "run id");
        return { json: loadPipelineCli().commitRun({ ...args.options, runId }) };
    },
});
// GAP #26: restore `cw commit summary <run-id>` (CLI + help row). The old
// build had commit.summary with cli path ["commit","summary"] surface "both"
// (capability-registry.ts:260-266); v2 kept only the cw_commit_summary MCP
// tool and dropped both the CLI binding and the COMMAND_HELP_ROWS entry, so
// `cw commit summary` mis-read "summary" as the run id. Path ["commit","summary"]
// is 2 tokens; dispatch consumes 1, so positionals[0] is the run id.
(0, registry_core_1.attachCliBinding)("commit.summary", {
    path: ["commit", "summary"],
    jsonMode: "flag",
    handler: (args) => {
        const commitSummary = loadCommitSummary();
        const summary = commitSummary.commitSummaryCli({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id") });
        return { json: summary, text: `${commitSummary.formatCommitSummaryText(summary)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("commit.summary").mcp.handler = (args) => loadCommitSummary().commitSummaryCli(args);
// ---------------------------------------------------------------------
