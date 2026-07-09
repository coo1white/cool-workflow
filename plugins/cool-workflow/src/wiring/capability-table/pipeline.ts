// wiring/capability-table/pipeline.ts — MILESTONE 6+7 (plan, run.drive*,
// dispatch, result, commit, commit.summary) + MILESTONE 11's run.export/
// import/verify-import/inspect-archive/restore CLI bindings. Split out of
// core/capability-table.ts, byte-for-byte (extracted with sed, not
// retyped).

import { attachCliBinding, addCliOnlyCapability, REGISTRY_BY_CAPABILITY } from "./registry-core";
import { required } from "../../cli/io";
import { optionalArg } from "../../cli/io";

// MILESTONE 6+7 (combined; see docs/rebuild/PLAN.md Open risk 10) CLI bindings:
// plan, quickstart, run --drive, run drive (preview), dispatch, result,
// commit. Handler BODIES live in shell/pipeline-cli.ts (impure — they
// plan/drive/dispatch/commit real run state on disk); this table only
// wires argv shape -> handler call, per cli/dispatch.ts's generic
// executor contract.
// ---------------------------------------------------------------------

import { planRun, runDrivePreview, runDriveStep, quickstartRun, dispatchRun, recordResultRun, commitRun } from "../../shell/pipeline-cli";
import { commitSummaryCli, formatCommitSummaryText } from "../../shell/commit-summary";

attachCliBinding("plan", {
  path: ["plan"],
  jsonMode: "default",
  handler: (args) => {
    const workflowId = optionalArg(args.positionals[0]);
    if (!workflowId) {
      throw new Error('Missing workflow id.\n  Tip: plan an architecture review with "cw plan architecture-review"');
    }
    return { json: planRun({ ...args.options, workflowId }) };
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
attachCliBinding("run.drive.step", {
  path: ["run"],
  helpPath: ["run", "drive"],
  jsonMode: "default",
  handler: async (args) => {
    const registrySubcommands = new Set(["drive", "search", "list", "show", "resume", "archive", "rerun", "export", "import", "verify-import", "inspect-archive", "restore"]);
    const target = args.positionals[0];
    if (args.options.drive && !registrySubcommands.has(String(target || ""))) {
      const runId = optionalArg(args.options.run) || optionalArg(args.options.runId);
      if (args.options.preview) return { json: runDrivePreview({ ...args.options, runId: runId || target }) };
      const driveArgs: Record<string, unknown> = { ...args.options };
      if (runId) driveArgs.runId = runId;
      else driveArgs.appId = target;
      return { json: await runDriveStep(driveArgs) };
    }
    const [subcommand, id] = args.positionals;
    if (subcommand === "drive") {
      if (args.options.step) {
        const driveArgs: Record<string, unknown> = { ...args.options };
        if (id) driveArgs.runId = id;
        return { json: await runDriveStep(driveArgs) };
      }
      return { json: runDrivePreview({ ...args.options, runId: required(id, "run id") }) };
    }
    // MILESTONE 11 (reporting/run-export) — the archive family. Handler
    // bodies live in shell/run-export-cli.ts; this arm only wires argv
    // shape -> handler call.
    if (subcommand === "export") {
      const result = runExportCli(required(id, "run id"), args.options);
      return { json: result };
    }
    if (subcommand === "import") {
      const result = runImportCli(required(id, "archive path"), args.options);
      return { json: result };
    }
    if (subcommand === "verify-import") {
      const result = runVerifyImportCli(required(id, "run id"), args.options);
      return { json: result, exitCode: args.options.strict && !result.ok ? 1 : undefined };
    }
    if (subcommand === "inspect-archive") {
      const result = runInspectArchiveCli(required(id, "archive path"), args.options);
      return { json: result, exitCode: result.ok ? undefined : 1 };
    }
    if (subcommand === "restore") {
      const result = runRestoreCli(required(id, "archive path"), args.options);
      return { json: result, exitCode: result.ok ? undefined : 1 };
    }
    throw new Error(
      "Usage: cw.js run search|list|show|resume|archive|rerun|drive|export|import|verify-import|inspect-archive|restore [run-id|archive] [--scope repo|home] [--json]  |  cw.js run <app> --drive [--once] [--incremental] [--repo R --question Q]"
    );
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
attachCliBinding("run.drive", {
  path: ["run", "drive"],
  jsonMode: "default",
  handler: async (args) => {
    const id = args.positionals[0];
    if (args.options.step) {
      const driveArgs: Record<string, unknown> = { ...args.options };
      if (id) driveArgs.runId = id;
      return { json: await runDriveStep(driveArgs) };
    }
    return { json: runDrivePreview({ ...args.options, runId: required(id, "run id") }) };
  },
});
REGISTRY_BY_CAPABILITY.get("run.drive")!.mcp!.handler = (args) => runDrivePreview(args);
REGISTRY_BY_CAPABILITY.get("run.drive.step")!.mcp!.handler = (args) => runDriveStep(args);
// PARITY: `run.drive.step` advances the run by spawning the external
// agent per worker and recording attested output — not a read probe.
// CLI (--drive/--step) and MCP route through the same drive() core; the
// opt-out is the documented divergence, not undocumented drift.
REGISTRY_BY_CAPABILITY.get("run.drive.step")!.payloadIdentical = false;
REGISTRY_BY_CAPABILITY.get("run.drive.step")!.reason =
  "Mutating: advances the run by spawning the external agent per worker and recording attested output — not a read probe. CLI (--drive/--step) and MCP route through the same drive() core.";
REGISTRY_BY_CAPABILITY.get("plan")!.mcp!.handler = (args) => planRun(args);
// GAP #24: dispatchRun reads the sandbox profile from `args.sandbox` only
// (the CLI's --sandbox flag). The cw_dispatch MCP tool also accepts the
// `sandboxProfile`/`sandboxProfileId` aliases (its declared properties), so
// normalize them onto `sandbox` here — mirrors the old build's
// sandboxProfileIdFrom() alias set — before handing off.
REGISTRY_BY_CAPABILITY.get("dispatch")!.mcp!.handler = (args) =>
  dispatchRun({ ...args, sandbox: args.sandbox ?? args.sandboxProfile ?? args.sandboxProfileId });
REGISTRY_BY_CAPABILITY.get("result")!.mcp!.handler = (args) => recordResultRun(args);
// `cw_commit` returns the FLAT commit envelope (verifierGated/checkpoint/
// selectionId/… at the top level, plus a nested `commit`), matching the old
// build's commitEnvelope. `commitRun` (CLI shape) returns `{ runId, commit }`;
// lift the commit's key fields to the top for the MCP surface.
REGISTRY_BY_CAPABILITY.get("commit")!.mcp!.handler = (args) => {
  const result = commitRun(args) as { runId: string; commit: Record<string, unknown> };
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
REGISTRY_BY_CAPABILITY.get("commit")!.payloadIdentical = false;
REGISTRY_BY_CAPABILITY.get("commit")!.reason =
  "Both surfaces route through the single core entry runner.commit. The CLI emits the raw StateCommitResult for scripting (commit.id, commit.evidence, commit.gate); cw_commit emits the operator commit envelope (commitId, verifierGated, checkpoint, evidenceCount, snapshotPath, nextActions, plus the raw result under `commit`). Declared projection, not drift.";

// MILESTONE 11 — run.export/import/verify-import/inspect-archive/restore
// MCP handlers (the CLI side is served by run.drive.step's combined
// handler above; these tools are called directly by name over MCP, so
// each needs its own mcp.handler per byte-compat item 5's two-field
// row shape).
import { runExportCli, runImportCli, runVerifyImportCli, runInspectArchiveCli, runRestoreCli } from "../../shell/run-export-cli";

REGISTRY_BY_CAPABILITY.get("run.export")!.mcp!.handler = (args) => runExportCli(required(optionalArg(args.runId), "run id"), args);
REGISTRY_BY_CAPABILITY.get("run.import")!.mcp!.handler = (args) => runImportCli(required(optionalArg(args.archive || args.path || args.file), "archive path"), args);
REGISTRY_BY_CAPABILITY.get("run.verify-import")!.mcp!.handler = (args) => runVerifyImportCli(required(optionalArg(args.runId), "run id"), args);
REGISTRY_BY_CAPABILITY.get("run.inspect-archive")!.mcp!.handler = (args) => runInspectArchiveCli(required(optionalArg(args.archive || args.path || args.file), "archive path"), args);
REGISTRY_BY_CAPABILITY.get("run.restore")!.mcp!.handler = (args) => runRestoreCli(required(optionalArg(args.archive || args.path || args.file), "archive path"), args);

// `run export|import|verify-import|inspect-archive|restore` each carry their
// own two-token cli.path (found before the ["run"] run.drive.step catch-all
// per the reversed candidate order), calling the same shell fns with the
// same [subcommand, id] positional mapping and exit-code shape the catch-all
// switch already used. `hiddenFromHelp` keeps the byte-pinned `cw help run`
// fixture's rows coming from the single literal COMMAND_HELP_ROWS.run block.
attachCliBinding("run.export", {
  path: ["run", "export"],
  jsonMode: "default",
  hiddenFromHelp: true,
  handler: (args) => ({ json: runExportCli(required(args.positionals[0], "run id"), args.options) }),
});
attachCliBinding("run.import", {
  path: ["run", "import"],
  jsonMode: "default",
  hiddenFromHelp: true,
  handler: (args) => ({ json: runImportCli(required(args.positionals[0], "archive path"), args.options) }),
});
attachCliBinding("run.verify-import", {
  path: ["run", "verify-import"],
  jsonMode: "default",
  hiddenFromHelp: true,
  handler: (args) => {
    const result = runVerifyImportCli(required(args.positionals[0], "run id"), args.options);
    return { json: result, exitCode: args.options.strict && !result.ok ? 1 : undefined };
  },
});
attachCliBinding("run.inspect-archive", {
  path: ["run", "inspect-archive"],
  jsonMode: "default",
  hiddenFromHelp: true,
  handler: (args) => {
    const result = runInspectArchiveCli(required(args.positionals[0], "archive path"), args.options);
    return { json: result, exitCode: result.ok ? undefined : 1 };
  },
});
attachCliBinding("run.restore", {
  path: ["run", "restore"],
  jsonMode: "default",
  hiddenFromHelp: true,
  handler: (args) => {
    const result = runRestoreCli(required(args.positionals[0], "archive path"), args.options);
    return { json: result, exitCode: result.ok ? undefined : 1 };
  },
});

addCliOnlyCapability(
  "quickstart",
  "ONE-COMMAND quickstart: --check preflights without writes; otherwise plan(app, default architecture-review) -> run --drive -> report in a single invocation (--preview for a read-only dry run; --bundle [--with-trust-key K] seals a completed run into a self-verified portable bundle).",
  {
    path: ["quickstart"],
    // `audit-run` is a CLI-only alias that dispatches to the same quickstart
    // wrapper (byte-behavior port of the old build's caseTokens).
    caseTokens: ["quickstart", "audit-run"],
    jsonMode: "default",
    handler: async (args) => {
      const appId = optionalArg(args.positionals[0]);
      const result = (await quickstartRun({ ...args.options, appId })) as unknown as Record<string, unknown>;
      // Fail closed on both known bad outcomes: a --check preflight that
      // found a blocking gap, OR a --bundle that did not self-verify.
      const bundle = result.bundle as { ok?: boolean } | undefined;
      const bundleFailed = Boolean(bundle && bundle.ok === false);
      const exitCode = (result.mode === "check" && result.ok === false) || bundleFailed ? 1 : undefined;
      return { json: result, exitCode };
    },
  },
  "quickstart composes plan/runDrive/report; SPEC/mcp.md's declared cli-only list names it explicitly (no MCP peer). `audit-run` is a CLI-only alias of the same wrapper.",
  "quickstart"
);

attachCliBinding("dispatch", {
  path: ["dispatch"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    return { json: dispatchRun({ ...args.options, runId }) };
  },
});

attachCliBinding("result", {
  path: ["result"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const taskId = required(optionalArg(args.positionals[1]), "task id");
    const resultPath = required(optionalArg(args.positionals[2]), "result file path");
    return { json: recordResultRun({ ...args.options, runId, taskId, resultPath }) };
  },
});

attachCliBinding("commit", {
  path: ["commit"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    return { json: commitRun({ ...args.options, runId }) };
  },
});

// GAP #26: restore `cw commit summary <run-id>` (CLI + help row). The old
// build had commit.summary with cli path ["commit","summary"] surface "both"
// (capability-registry.ts:260-266); v2 kept only the cw_commit_summary MCP
// tool and dropped both the CLI binding and the COMMAND_HELP_ROWS entry, so
// `cw commit summary` mis-read "summary" as the run id. Path ["commit","summary"]
// is 2 tokens; dispatch consumes 1, so positionals[0] is the run id.
attachCliBinding("commit.summary", {
  path: ["commit", "summary"],
  jsonMode: "flag",
  handler: (args) => {
    const summary = commitSummaryCli({ ...args.options, runId: required(args.positionals[0], "run id") });
    return { json: summary, text: `${formatCommitSummaryText(summary)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("commit.summary")!.mcp!.handler = (args) => commitSummaryCli(args);

// ---------------------------------------------------------------------
