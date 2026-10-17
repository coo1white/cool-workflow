// wiring/capability-table/reporting.ts — CLI bindings for reporting,
// observability, doctor/fix, workbench, run summary/status/operator,
// worker.*, feedback.*, audit.*.

import { attachCliBinding, REGISTRY_BY_CAPABILITY } from "./registry-core";
import { required, optionalArg, wantsJson } from "../../core/util/cli-args";
import { adviseNoRun } from "../../core/format/recovery-hint";
// This file is required at startup for every command. Loading these shell
// modules only when their handler runs, not at import time, keeps that
// load cost out of commands that never touch reporting/status/graph.
function loadRunStore(): typeof import("../../shell/run-store") {
  return require("../../shell/run-store") as typeof import("../../shell/run-store");
}

// Reporting CLI bindings: report, status (real run id), graph,
// operator.status|report|graph. Handler bodies live in shell/report-
// view-cli.ts (impure — they load run state and, for `report`/`operator
// report`, re-write report.md); this table only wires argv shape ->
// handler call, per cli/dispatch.ts's generic executor contract.
// ---------------------------------------------------------------------

function loadReportViewCli(): typeof import("../../shell/report-view-cli") {
  return require("../../shell/report-view-cli") as typeof import("../../shell/report-view-cli");
}
function loadOperatorUxText(): typeof import("../../shell/operator-ux-text") {
  return require("../../shell/operator-ux-text") as typeof import("../../shell/operator-ux-text");
}
import type { OperatorFeedbackSummary } from "../../shell/operator-ux";

attachCliBinding("report", {
  path: ["report"],
  helpPath: ["report", "[run-id]", "[--show|--open]"],
  jsonMode: "flag",
  handler: (args) => {
    const reportViewCli = loadReportViewCli();
    // No id given: fall back to the newest run under `.cw/runs/`; no run
    // at all is a one-line pointer to the tool's real starting command,
    // never a "Missing required input" throw.
    const runId = optionalArg(args.positionals[0]) || reportViewCli.resolveReportRunId(args.options);
    if (!runId) return { json: { runId: null }, text: 'No run yet. Try: cw -q "<question>"\n' };
    if (args.options.open) {
      const opened = reportViewCli.reportOpenCli(runId, args.options);
      return { json: opened, text: `${opened.path}\n` };
    }
    const result = reportViewCli.reportWriteCli(runId, args.options);
    if (args.options.show || args.options.summary) {
      return { json: result, text: `${reportViewCli.operatorReportText(runId, args.options)}\n` };
    }
    return { json: result, text: `${result.path}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("report")!.mcp!.handler = (args) => loadReportViewCli().reportMcp(required(optionalArg(args.runId), "run id"), args);

// `status` already carries a CLI binding (`attachCliBinding("status", ...)`
// above); replace its handler here with the real run-id-aware body while
// keeping the same row/path (see byte-compat item 5).
REGISTRY_BY_CAPABILITY.get("status")!.cli = {
  path: ["status"],
  jsonMode: "flag",
  handler: (args) => {
    // `cw status <id>` (positional) and `cw status --run <id>` must both
    // resolve the same run, so a bogus id given via --run is never mistaken
    // for "No run selected".
    const runId = optionalArg(args.positionals[0]) || optionalArg(args.options.run) || optionalArg(args.options.runId);
    if (!runId) return { json: { runId: null, nextActions: adviseNoRun() }, text: `No run selected\n\nNext Action\n${adviseNoRunLines()}` };
    const reportViewCli = loadReportViewCli();
    if (args.options.summary || args.options.brief) {
      return { json: reportViewCli.statusCli(runId, args.options), text: `${reportViewCli.statusSummaryText(runId, args.options)}\n` };
    }
    return { json: reportViewCli.statusCli(runId, args.options), text: `${reportViewCli.statusFullText(runId, args.options)}\n` };
  },
};
REGISTRY_BY_CAPABILITY.get("status")!.mcp!.handler = (args) => loadReportViewCli().statusCli(optionalArg(args.runId), args);

function adviseNoRunLines(): string {
  return "  cw plan <workflow-id> --repo <path>\n    reason: No run id is available yet; create a workflow run before dispatching or recording evidence.\n";
}

attachCliBinding("graph", {
  path: ["graph"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const reportViewCli = loadReportViewCli();
    return { json: reportViewCli.graphCli(runId, args.options), text: `${reportViewCli.graphText(runId, args.options)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("graph")!.mcp!.handler = (args) => loadReportViewCli().graphCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("operator.status", {
  path: ["operator", "status"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const reportViewCli = loadReportViewCli();
    if (args.options.summary || args.options.brief) {
      return { json: reportViewCli.operatorStatusCli(runId, args.options), text: `${reportViewCli.statusSummaryText(runId, args.options)}\n` };
    }
    return { json: reportViewCli.operatorStatusCli(runId, args.options), text: `${reportViewCli.statusFullText(runId, args.options)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("operator.status")!.mcp!.handler = (args) => loadReportViewCli().operatorStatusCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("operator.report", {
  path: ["operator", "report"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const reportViewCli = loadReportViewCli();
    return { json: reportViewCli.operatorReportCli(runId, args.options), text: `${reportViewCli.operatorReportText(runId, args.options)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("operator.report")!.mcp!.handler = (args) => loadReportViewCli().operatorReportCli(required(optionalArg(args.runId), "run id"), args);

// ---- metrics.show / metrics.summary -----------------------------------

function loadMetricsCli(): typeof import("../../shell/metrics-cli") {
  return require("../../shell/metrics-cli") as typeof import("../../shell/metrics-cli");
}
function loadObservability(): typeof import("../../shell/observability") {
  return require("../../shell/observability") as typeof import("../../shell/observability");
}

attachCliBinding("metrics.show", {
  path: ["metrics", "show"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const report = loadMetricsCli().metricsShowCli(runId, args.options);
    return { json: report, text: `${loadObservability().formatMetricsReport(report)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("metrics.show")!.mcp!.handler = (args) => loadMetricsCli().metricsShowCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("metrics.summary", {
  path: ["metrics", "summary"],
  jsonMode: "flag",
  handler: (args) => {
    const report = loadMetricsCli().metricsSummaryCli(args.options);
    return { json: report, text: `${loadObservability().formatMetricsSummary(report)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("metrics.summary")!.mcp!.handler = (args) => loadMetricsCli().metricsSummaryCli(args);

// ---- worker.summary (the workbench worker panel + `cw worker summary`) ----

function loadWorkerIsolation(): typeof import("../../shell/worker-isolation") {
  return require("../../shell/worker-isolation") as typeof import("../../shell/worker-isolation");
}
import * as workerPath from "node:path";

function workerSummaryCli(args: Record<string, unknown>): ReturnType<typeof import("../../shell/worker-isolation").summarizeWorkers> {
  const runId = required(optionalArg(args.runId), "run id");
  const run = loadRunStore().loadRunFromCwd(runId, invocationCwdFor(args));
  return loadWorkerIsolation().summarizeWorkers(run);
}
function workerSummaryText(args: Record<string, unknown>): string {
  const runId = required(optionalArg(args.runId), "run id");
  const run = loadRunStore().loadRunFromCwd(runId, invocationCwdFor(args));
  return loadWorkerIsolation().formatWorkerSummaryText(run);
}
function invocationCwdFor(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? workerPath.resolve(args.cwd) : process.cwd();
}

// jsonMode "flag": human `Workers` panel by default, canonical JSON under
// --json.
attachCliBinding("worker.summary", {
  path: ["worker", "summary"],
  jsonMode: "flag",
  handler: (args) => ({
    json: workerSummaryCli({ ...args.options, runId: args.positionals[0] }),
    text: `${workerSummaryText({ ...args.options, runId: args.positionals[0] })}\n`,
  }),
});
REGISTRY_BY_CAPABILITY.get("worker.summary")!.mcp!.handler = (args) => workerSummaryCli(args);

// ---- worker list|show|manifest|output|fail|validate (CLI + MCP) ----------
// Each worker lifecycle verb over a run. positionals: [runId, workerId,
// resultFile].

function loadWorkerCli(): typeof import("../../shell/worker-cli") {
  return require("../../shell/worker-cli") as typeof import("../../shell/worker-cli");
}

attachCliBinding("worker.list", {
  path: ["worker", "list"],
  jsonMode: "default",
  handler: (args) => ({ json: loadWorkerCli().workerListCli({ ...args.options, runId: args.positionals[0] }) }),
});
REGISTRY_BY_CAPABILITY.get("worker.list")!.mcp!.handler = (args) => loadWorkerCli().workerListCli(args);

attachCliBinding("worker.show", {
  path: ["worker", "show"],
  jsonMode: "default",
  handler: (args) => ({ json: loadWorkerCli().workerShowCli({ ...args.options, runId: args.positionals[0], workerId: args.positionals[1] }) }),
});
REGISTRY_BY_CAPABILITY.get("worker.show")!.mcp!.handler = (args) => loadWorkerCli().workerShowCli(args);

attachCliBinding("worker.manifest", {
  path: ["worker", "manifest"],
  jsonMode: "default",
  handler: (args) => ({ json: loadWorkerCli().workerManifestCli({ ...args.options, runId: args.positionals[0], workerId: args.positionals[1] }) }),
});
REGISTRY_BY_CAPABILITY.get("worker.manifest")!.mcp!.handler = (args) => loadWorkerCli().workerManifestCli(args);

attachCliBinding("worker.output", {
  path: ["worker", "output"],
  jsonMode: "default",
  handler: (args) => ({ json: loadWorkerCli().workerOutputCli({ ...args.options, runId: args.positionals[0], workerId: args.positionals[1], resultPath: args.positionals[2] }) }),
});
REGISTRY_BY_CAPABILITY.get("worker.output")!.mcp!.handler = (args) => loadWorkerCli().workerOutputCli(args);

attachCliBinding("worker.fail", {
  path: ["worker", "fail"],
  jsonMode: "default",
  handler: (args) => ({ json: loadWorkerCli().workerFailCli({ ...args.options, runId: args.positionals[0], workerId: args.positionals[1], resultPath: args.positionals[2] }) }),
});
REGISTRY_BY_CAPABILITY.get("worker.fail")!.mcp!.handler = (args) => loadWorkerCli().workerFailCli(args);

attachCliBinding("worker.validate", {
  path: ["worker", "validate"],
  jsonMode: "default",
  handler: (args) => {
    const { violation, exitCode } = loadWorkerCli().workerValidateCli({ ...args.options, runId: args.positionals[0], workerId: args.positionals[1], resultPath: args.positionals[2] });
    return { json: violation, exitCode };
  },
});
REGISTRY_BY_CAPABILITY.get("worker.validate")!.mcp!.handler = (args) => loadWorkerCli().workerValidateCli(args).violation;

// ---- feedback list|show|summary|collect|task|resolve (CLI + MCP) ---------
// The operator feedback lifecycle. positionals: [runId, feedbackId].

function loadFeedbackCli(): typeof import("../../shell/feedback-cli") {
  return require("../../shell/feedback-cli") as typeof import("../../shell/feedback-cli");
}

// jsonMode "flag": human `Feedback` panel by default, canonical JSON under
// --json.
attachCliBinding("feedback.summary", {
  path: ["feedback", "summary"],
  jsonMode: "flag",
  handler: (args) => {
    const summary = loadFeedbackCli().feedbackSummaryCli({ ...args.options, runId: args.positionals[0] });
    return { json: summary, text: `${loadOperatorUxText().formatFeedbackSummaryText(summary as OperatorFeedbackSummary)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("feedback.summary")!.mcp!.handler = (args) => loadFeedbackCli().feedbackSummaryCli(args);

attachCliBinding("feedback.list", {
  path: ["feedback", "list"],
  jsonMode: "default",
  handler: (args) => ({ json: loadFeedbackCli().feedbackListCli({ ...args.options, runId: args.positionals[0] }) }),
});
REGISTRY_BY_CAPABILITY.get("feedback.list")!.mcp!.handler = (args) => loadFeedbackCli().feedbackListCli(args);

attachCliBinding("feedback.show", {
  path: ["feedback", "show"],
  jsonMode: "default",
  handler: (args) => ({ json: loadFeedbackCli().feedbackShowCli({ ...args.options, runId: args.positionals[0], feedbackId: args.positionals[1] }) }),
});
REGISTRY_BY_CAPABILITY.get("feedback.show")!.mcp!.handler = (args) => loadFeedbackCli().feedbackShowCli(args);

attachCliBinding("feedback.collect", {
  path: ["feedback", "collect"],
  jsonMode: "default",
  handler: (args) => ({ json: loadFeedbackCli().feedbackCollectCli({ ...args.options, runId: args.positionals[0] }) }),
});
REGISTRY_BY_CAPABILITY.get("feedback.collect")!.mcp!.handler = (args) => loadFeedbackCli().feedbackCollectCli(args);

attachCliBinding("feedback.task", {
  path: ["feedback", "task"],
  jsonMode: "default",
  handler: (args) => ({ json: loadFeedbackCli().feedbackTaskCli({ ...args.options, runId: args.positionals[0], feedbackId: args.positionals[1] }) }),
});
REGISTRY_BY_CAPABILITY.get("feedback.task")!.mcp!.handler = (args) => loadFeedbackCli().feedbackTaskCli(args);

attachCliBinding("feedback.resolve", {
  path: ["feedback", "resolve"],
  jsonMode: "default",
  handler: (args) => ({ json: loadFeedbackCli().feedbackResolveCli({ ...args.options, runId: args.positionals[0], feedbackId: args.positionals[1] }) }),
});
REGISTRY_BY_CAPABILITY.get("feedback.resolve")!.mcp!.handler = (args) => loadFeedbackCli().feedbackResolveCli(args);

// ---- workbench.view / workbench.serve ---------------------------------

function loadWorkbench(): typeof import("../../shell/workbench") {
  return require("../../shell/workbench") as typeof import("../../shell/workbench");
}
function loadWorkbenchText(): typeof import("../../shell/workbench-text") {
  return require("../../shell/workbench-text") as typeof import("../../shell/workbench-text");
}
function loadWorkbenchHost(): typeof import("../../shell/workbench-host") {
  return require("../../shell/workbench-host") as typeof import("../../shell/workbench-host");
}

attachCliBinding("workbench.view", {
  path: ["workbench", "view"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const view = loadWorkbench().buildWorkbenchRunView(runId, args.options);
    return { json: view, text: `${loadWorkbenchText().formatWorkbenchView(view)}\n` };
  },
});
// The MCP path is CLI-facing byte-identical (buildWorkbenchRunView takes
// the same args shape either way) — required here since `.cli` and
// `.mcp` never share a handler object per byte-compat item 5.
REGISTRY_BY_CAPABILITY.get("workbench.view")!.mcp!.handler = (args) => loadWorkbench().buildWorkbenchRunView(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("workbench.serve", {
  path: ["workbench", "serve"],
  jsonMode: "flag",
  handler: (args) => {
    const { WorkbenchHost } = loadWorkbenchHost();
    const host = new WorkbenchHost(args.options);
    if (args.options.once || wantsJson(args.options)) {
      return { json: host.descriptor(true) };
    }
    // The default (no --once, no --json) actually binds and blocks: the
    // host is started here and the handler never returns. See
    // cli/dispatch.ts's renderCliResult: it is synchronous, so a genuinely
    // blocking serve must perform its own stdout write and keep the event
    // loop alive rather than returning a CliHandlerResult at all.
    // run() already fails closed internally (a `cw:` line + exit 1) for the
    // known bind failures; this .catch is a backstop so any future throw
    // path can never surface as an unhandled-rejection stack dump.
    void host.run().catch((error: unknown) => {
      process.stderr.write(`cw: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
    return { json: undefined };
  },
});
// `cw_workbench_serve` NEVER starts the server — the MCP path forces
// `once: true` unconditionally, per SPEC/reporting-ux.md's "one declared
// divergence": an MCP client must never be able to make the server
// process open a persistent listening socket.
REGISTRY_BY_CAPABILITY.get("workbench.serve")!.mcp!.handler = (args) => new (loadWorkbenchHost().WorkbenchHost)(args).descriptor(true);
// PARITY: both surfaces route through the single core entry
// buildWorkbenchServeDescriptor and return the IDENTICAL serve
// descriptor under `cw workbench serve --json`/`--once` and
// `cw_workbench_serve`. They diverge only in side effect, not payload:
// the CLI's default `cw workbench serve` (no --once) additionally
// STARTS the blocking localhost host, which an MCP stdio host cannot do,
// so cw_workbench_serve only ever returns the descriptor. Declared
// divergence, not drift.
REGISTRY_BY_CAPABILITY.get("workbench.serve")!.payloadIdentical = false;
REGISTRY_BY_CAPABILITY.get("workbench.serve")!.reason =
  "Both surfaces route through the single core entry buildWorkbenchServeDescriptor and return the IDENTICAL serve descriptor under `cw workbench serve --json`/`--once` and `cw_workbench_serve`. They diverge only in side effect, not payload: the CLI's default `cw workbench serve` (no --once) additionally STARTS the blocking localhost host, which an MCP stdio host cannot do, so cw_workbench_serve only ever returns the descriptor. Declared divergence, not drift.";

// ---- audit.summary ----------------------------------------------------

function loadAuditCli(): typeof import("../../shell/audit-cli") {
  return require("../../shell/audit-cli") as typeof import("../../shell/audit-cli");
}

attachCliBinding("audit.summary", {
  path: ["audit", "summary"],
  jsonMode: "default",
  handler: (args) => ({ json: loadAuditCli().auditSummaryCli(required(args.positionals[0], "run id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("audit.summary")!.mcp!.handler = (args) => loadAuditCli().auditSummaryCli(required(optionalArg(args.runId), "run id"), args);

// `cw audit worker|provenance|attest|decision` — CLI path bindings and the
// cw_audit_worker/provenance/attest/decision MCP handlers. `audit worker`/
// `decision` read positionals[1] as the entity id.
attachCliBinding("audit.worker", {
  path: ["audit", "worker"],
  jsonMode: "default",
  handler: (args) => ({ json: loadAuditCli().auditWorkerCli(required(args.positionals[0], "run id"), required(args.positionals[1], "worker id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("audit.worker")!.mcp!.handler = (args) => loadAuditCli().auditWorkerCli(required(optionalArg(args.runId), "run id"), required(optionalArg(args.workerId ?? args.worker), "worker id"), args);

attachCliBinding("audit.provenance", {
  path: ["audit", "provenance"],
  jsonMode: "default",
  handler: (args) => ({ json: loadAuditCli().auditProvenanceCli(required(args.positionals[0], "run id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("audit.provenance")!.mcp!.handler = (args) => loadAuditCli().auditProvenanceCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("audit.attest", {
  path: ["audit", "attest"],
  jsonMode: "default",
  handler: (args) => ({ json: loadAuditCli().auditAttestCli(required(args.positionals[0], "run id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("audit.attest")!.mcp!.handler = (args) => loadAuditCli().auditAttestCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("audit.decision", {
  path: ["audit", "decision"],
  jsonMode: "default",
  handler: (args) => ({ json: loadAuditCli().auditDecisionCli(required(args.positionals[0], "run id"), required(args.positionals[1], "worker id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("audit.decision")!.mcp!.handler = (args) => loadAuditCli().auditDecisionCli(required(optionalArg(args.runId), "run id"), required(optionalArg(args.workerId), "worker id"), args);

// ---- app.list / app.show / app.validate / app.init / app.package -------
