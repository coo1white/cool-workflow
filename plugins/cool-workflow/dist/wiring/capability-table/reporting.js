"use strict";
// wiring/capability-table/reporting.ts — MILESTONE 11 (reporting,
// observability, doctor/fix, workbench, run summary/status/operator,
// worker.*, feedback.*, audit.*) CLI bindings. Split out of
// core/capability-table.ts, byte-for-byte (extracted with sed, not
// retyped).
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const registry_core_1 = require("./registry-core");
const io_1 = require("../../cli/io");
const state_explosion_text_1 = require("../../core/format/state-explosion-text");
// This file is required at startup for every command. Loading these shell
// modules only when their handler runs, not at import time, keeps that
// load cost out of commands that never touch reporting/status/graph.
function loadStateExplosionCli() {
    return require("../../shell/state-explosion-cli");
}
function loadRunStore() {
    return require("../../shell/run-store");
}
// MILESTONE 11 (reporting, observability, doctor/fix, workbench, run
// export/bundle) CLI bindings: report, status (real run id), graph,
// operator.status|report|graph. Handler bodies live in shell/report-
// view-cli.ts (impure — they load run state and, for `report`/`operator
// report`, re-write report.md); this table only wires argv shape ->
// handler call, per cli/dispatch.ts's generic executor contract.
// ---------------------------------------------------------------------
function loadReportViewCli() {
    return require("../../shell/report-view-cli");
}
function loadOperatorUxText() {
    return require("../../shell/operator-ux-text");
}
(0, registry_core_1.attachCliBinding)("report", {
    path: ["report"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, io_1.required)((0, io_1.optionalArg)(args.positionals[0]), "run id");
        const reportViewCli = loadReportViewCli();
        const result = reportViewCli.reportWriteCli(runId, args.options);
        if (args.options.show || args.options.summary) {
            const stateExplosion = (0, state_explosion_text_1.formatStateExplosionReport)(loadStateExplosionCli().summaryShowCli(runId, args.options));
            return { json: result, text: `${reportViewCli.operatorReportText(runId, args.options)}\n\n${stateExplosion}\n` };
        }
        return { json: result, text: `${result.path}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("report").mcp.handler = (args) => loadReportViewCli().reportWriteCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
// `status` already carries a milestone-2 CLI binding (`attachCliBinding("status", ...)`
// above); replace its handler here with the real run-id-aware body while
// keeping the same row/path (no reshape needed — see byte-compat item 5).
registry_core_1.REGISTRY_BY_CAPABILITY.get("status").cli = {
    path: ["status"],
    jsonMode: "flag",
    handler: (args) => {
        // `cw status <id>` (positional) and `cw status --run <id>` must both
        // resolve the same run — the flag form used to be silently ignored
        // (positionals[0] only), so a bogus id given via --run and a real one
        // looked identical ("No run selected" for both).
        const runId = (0, io_1.optionalArg)(args.positionals[0]) || (0, io_1.optionalArg)(args.options.run) || (0, io_1.optionalArg)(args.options.runId);
        const reportViewCli = loadReportViewCli();
        if (!runId)
            return { json: reportViewCli.statusCli(undefined, args.options), text: `No run selected\n\nNext Action\n${adviseNoRunLines()}` };
        if (args.options.summary || args.options.brief) {
            return { json: reportViewCli.statusCli(runId, args.options), text: `${reportViewCli.statusSummaryText(runId, args.options)}\n` };
        }
        return { json: reportViewCli.statusCli(runId, args.options), text: `${reportViewCli.statusFullText(runId, args.options)}\n` };
    },
};
registry_core_1.REGISTRY_BY_CAPABILITY.get("status").mcp.handler = (args) => loadReportViewCli().statusCli((0, io_1.optionalArg)(args.runId), args);
function adviseNoRunLines() {
    return "  node scripts/cw.js plan <workflow-id> --repo <path>\n    reason: No run id is available yet; create a workflow run before dispatching or recording evidence.\n";
}
(0, registry_core_1.attachCliBinding)("graph", {
    path: ["graph"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, io_1.required)((0, io_1.optionalArg)(args.positionals[0]), "run id");
        const reportViewCli = loadReportViewCli();
        return { json: reportViewCli.graphCli(runId, args.options), text: `${reportViewCli.graphText(runId, args.options)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("graph").mcp.handler = (args) => loadReportViewCli().graphCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("operator.status", {
    path: ["operator", "status"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, io_1.required)((0, io_1.optionalArg)(args.positionals[0]), "run id");
        const reportViewCli = loadReportViewCli();
        if (args.options.summary || args.options.brief) {
            return { json: reportViewCli.operatorStatusCli(runId, args.options), text: `${reportViewCli.statusSummaryText(runId, args.options)}\n` };
        }
        return { json: reportViewCli.operatorStatusCli(runId, args.options), text: `${reportViewCli.statusFullText(runId, args.options)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("operator.status").mcp.handler = (args) => loadReportViewCli().operatorStatusCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("operator.report", {
    path: ["operator", "report"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, io_1.required)((0, io_1.optionalArg)(args.positionals[0]), "run id");
        const reportViewCli = loadReportViewCli();
        return { json: reportViewCli.operatorReportCli(runId, args.options), text: `${reportViewCli.operatorReportText(runId, args.options)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("operator.report").mcp.handler = (args) => loadReportViewCli().operatorReportCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
// ---- metrics.show / metrics.summary -----------------------------------
function loadMetricsCli() {
    return require("../../shell/metrics-cli");
}
function loadObservability() {
    return require("../../shell/observability");
}
(0, registry_core_1.attachCliBinding)("metrics.show", {
    path: ["metrics", "show"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, io_1.required)((0, io_1.optionalArg)(args.positionals[0]), "run id");
        const report = loadMetricsCli().metricsShowCli(runId, args.options);
        return { json: report, text: `${loadObservability().formatMetricsReport(report)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("metrics.show").mcp.handler = (args) => loadMetricsCli().metricsShowCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("metrics.summary", {
    path: ["metrics", "summary"],
    jsonMode: "flag",
    handler: (args) => {
        const report = loadMetricsCli().metricsSummaryCli(args.options);
        return { json: report, text: `${loadObservability().formatMetricsSummary(report)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("metrics.summary").mcp.handler = (args) => loadMetricsCli().metricsSummaryCli(args);
// ---- worker.summary (the workbench worker panel + `cw worker summary`) ----
function loadWorkerIsolation() {
    return require("../../shell/worker-isolation");
}
const workerPath = __importStar(require("node:path"));
function workerSummaryCli(args) {
    const runId = (0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id");
    const run = loadRunStore().loadRunFromCwd(runId, invocationCwdFor(args));
    return loadWorkerIsolation().summarizeWorkers(run);
}
function workerSummaryText(args) {
    const runId = (0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id");
    const run = loadRunStore().loadRunFromCwd(runId, invocationCwdFor(args));
    return loadWorkerIsolation().formatWorkerSummaryText(run);
}
function invocationCwdFor(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? workerPath.resolve(args.cwd) : process.cwd();
}
// jsonMode "flag": human `Workers` panel by default, canonical JSON under
// --json (old build's worker.summary was flag, cli/handlers/worker.ts).
(0, registry_core_1.attachCliBinding)("worker.summary", {
    path: ["worker", "summary"],
    jsonMode: "flag",
    handler: (args) => ({
        json: workerSummaryCli({ ...args.options, runId: args.positionals[0] }),
        text: `${workerSummaryText({ ...args.options, runId: args.positionals[0] })}\n`,
    }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("worker.summary").mcp.handler = (args) => workerSummaryCli(args);
// ---- worker list|show|manifest|output|fail|validate (CLI + MCP) ----------
// Each worker lifecycle verb over a run. The old build routed all of these
// via src/cli/handlers/worker.ts; v2 shipped only worker.summary bound, so the
// rest fell through to the worker.usage error. positionals: [runId, workerId,
// resultFile].
function loadWorkerCli() {
    return require("../../shell/worker-cli");
}
(0, registry_core_1.attachCliBinding)("worker.list", {
    path: ["worker", "list"],
    jsonMode: "default",
    handler: (args) => ({ json: loadWorkerCli().workerListCli({ ...args.options, runId: args.positionals[0] }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("worker.list").mcp.handler = (args) => loadWorkerCli().workerListCli(args);
(0, registry_core_1.attachCliBinding)("worker.show", {
    path: ["worker", "show"],
    jsonMode: "default",
    handler: (args) => ({ json: loadWorkerCli().workerShowCli({ ...args.options, runId: args.positionals[0], workerId: args.positionals[1] }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("worker.show").mcp.handler = (args) => loadWorkerCli().workerShowCli(args);
(0, registry_core_1.attachCliBinding)("worker.manifest", {
    path: ["worker", "manifest"],
    jsonMode: "default",
    handler: (args) => ({ json: loadWorkerCli().workerManifestCli({ ...args.options, runId: args.positionals[0], workerId: args.positionals[1] }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("worker.manifest").mcp.handler = (args) => loadWorkerCli().workerManifestCli(args);
(0, registry_core_1.attachCliBinding)("worker.output", {
    path: ["worker", "output"],
    jsonMode: "default",
    handler: (args) => ({ json: loadWorkerCli().workerOutputCli({ ...args.options, runId: args.positionals[0], workerId: args.positionals[1], resultPath: args.positionals[2] }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("worker.output").mcp.handler = (args) => loadWorkerCli().workerOutputCli(args);
(0, registry_core_1.attachCliBinding)("worker.fail", {
    path: ["worker", "fail"],
    jsonMode: "default",
    handler: (args) => ({ json: loadWorkerCli().workerFailCli({ ...args.options, runId: args.positionals[0], workerId: args.positionals[1], resultPath: args.positionals[2] }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("worker.fail").mcp.handler = (args) => loadWorkerCli().workerFailCli(args);
(0, registry_core_1.attachCliBinding)("worker.validate", {
    path: ["worker", "validate"],
    jsonMode: "default",
    handler: (args) => {
        const { violation, exitCode } = loadWorkerCli().workerValidateCli({ ...args.options, runId: args.positionals[0], workerId: args.positionals[1], resultPath: args.positionals[2] });
        return { json: violation, exitCode };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("worker.validate").mcp.handler = (args) => loadWorkerCli().workerValidateCli(args).violation;
// ---- feedback list|show|summary|collect|task|resolve (CLI + MCP) ---------
// The operator feedback lifecycle. MCP rows were declared but stubbed
// (notYetImplemented) and no CLI verb was bound; the old build routed all of
// these. positionals: [runId, feedbackId].
function loadFeedbackCli() {
    return require("../../shell/feedback-cli");
}
// jsonMode "flag": human `Feedback` panel by default, canonical JSON under
// --json (old build's feedback.summary was flag).
(0, registry_core_1.attachCliBinding)("feedback.summary", {
    path: ["feedback", "summary"],
    jsonMode: "flag",
    handler: (args) => {
        const summary = loadFeedbackCli().feedbackSummaryCli({ ...args.options, runId: args.positionals[0] });
        return { json: summary, text: `${loadOperatorUxText().formatFeedbackSummaryText(summary)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("feedback.summary").mcp.handler = (args) => loadFeedbackCli().feedbackSummaryCli(args);
(0, registry_core_1.attachCliBinding)("feedback.list", {
    path: ["feedback", "list"],
    jsonMode: "default",
    handler: (args) => ({ json: loadFeedbackCli().feedbackListCli({ ...args.options, runId: args.positionals[0] }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("feedback.list").mcp.handler = (args) => loadFeedbackCli().feedbackListCli(args);
(0, registry_core_1.attachCliBinding)("feedback.show", {
    path: ["feedback", "show"],
    jsonMode: "default",
    handler: (args) => ({ json: loadFeedbackCli().feedbackShowCli({ ...args.options, runId: args.positionals[0], feedbackId: args.positionals[1] }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("feedback.show").mcp.handler = (args) => loadFeedbackCli().feedbackShowCli(args);
(0, registry_core_1.attachCliBinding)("feedback.collect", {
    path: ["feedback", "collect"],
    jsonMode: "default",
    handler: (args) => ({ json: loadFeedbackCli().feedbackCollectCli({ ...args.options, runId: args.positionals[0] }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("feedback.collect").mcp.handler = (args) => loadFeedbackCli().feedbackCollectCli(args);
(0, registry_core_1.attachCliBinding)("feedback.task", {
    path: ["feedback", "task"],
    jsonMode: "default",
    handler: (args) => ({ json: loadFeedbackCli().feedbackTaskCli({ ...args.options, runId: args.positionals[0], feedbackId: args.positionals[1] }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("feedback.task").mcp.handler = (args) => loadFeedbackCli().feedbackTaskCli(args);
(0, registry_core_1.attachCliBinding)("feedback.resolve", {
    path: ["feedback", "resolve"],
    jsonMode: "default",
    handler: (args) => ({ json: loadFeedbackCli().feedbackResolveCli({ ...args.options, runId: args.positionals[0], feedbackId: args.positionals[1] }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("feedback.resolve").mcp.handler = (args) => loadFeedbackCli().feedbackResolveCli(args);
// ---- workbench.view / workbench.serve ---------------------------------
function loadWorkbench() {
    return require("../../shell/workbench");
}
function loadWorkbenchText() {
    return require("../../shell/workbench-text");
}
function loadWorkbenchHost() {
    return require("../../shell/workbench-host");
}
(0, registry_core_1.attachCliBinding)("workbench.view", {
    path: ["workbench", "view"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, io_1.required)((0, io_1.optionalArg)(args.positionals[0]), "run id");
        const view = loadWorkbench().buildWorkbenchRunView(runId, args.options);
        return { json: view, text: `${loadWorkbenchText().formatWorkbenchView(view)}\n` };
    },
});
// The MCP path is CLI-facing byte-identical (buildWorkbenchRunView takes
// the same args shape either way) — required here since `.cli` and
// `.mcp` never share a handler object per byte-compat item 5.
registry_core_1.REGISTRY_BY_CAPABILITY.get("workbench.view").mcp.handler = (args) => loadWorkbench().buildWorkbenchRunView((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("workbench.serve", {
    path: ["workbench", "serve"],
    jsonMode: "flag",
    handler: (args) => {
        const { WorkbenchHost } = loadWorkbenchHost();
        const host = new WorkbenchHost(args.options);
        if (args.options.once || (0, io_1.wantsJson)(args.options)) {
            return { json: host.descriptor(true) };
        }
        // The default (no --once, no --json) actually binds and blocks — this
        // returns a promise the generic dispatcher does not await today, so
        // instead we run it directly here and never return (matching the old
        // build's own blocking `serve` behavior). See cli/dispatch.ts's
        // renderCliResult: it is synchronous, so a genuinely blocking serve
        // must perform its own stdout write and keep the event loop alive
        // rather than returning a CliHandlerResult at all.
        void host.run();
        return { json: undefined };
    },
});
// `cw_workbench_serve` NEVER starts the server — the MCP path forces
// `once: true` unconditionally, per SPEC/reporting-ux.md's "one declared
// divergence": an MCP client must never be able to make the server
// process open a persistent listening socket.
registry_core_1.REGISTRY_BY_CAPABILITY.get("workbench.serve").mcp.handler = (args) => new (loadWorkbenchHost().WorkbenchHost)(args).descriptor(true);
// PARITY: both surfaces route through the single core entry
// buildWorkbenchServeDescriptor and return the IDENTICAL serve
// descriptor under `cw workbench serve --json`/`--once` and
// `cw_workbench_serve`. They diverge only in side effect, not payload:
// the CLI's default `cw workbench serve` (no --once) additionally
// STARTS the blocking localhost host, which an MCP stdio host cannot do,
// so cw_workbench_serve only ever returns the descriptor. Declared
// divergence, not drift.
registry_core_1.REGISTRY_BY_CAPABILITY.get("workbench.serve").payloadIdentical = false;
registry_core_1.REGISTRY_BY_CAPABILITY.get("workbench.serve").reason =
    "Both surfaces route through the single core entry buildWorkbenchServeDescriptor and return the IDENTICAL serve descriptor under `cw workbench serve --json`/`--once` and `cw_workbench_serve`. They diverge only in side effect, not payload: the CLI's default `cw workbench serve` (no --once) additionally STARTS the blocking localhost host, which an MCP stdio host cannot do, so cw_workbench_serve only ever returns the descriptor. Declared divergence, not drift.";
// ---- audit.summary / audit.multi-agent / audit.policy / audit.judge ----
function loadAuditCli() {
    return require("../../shell/audit-cli");
}
function loadEvalText() {
    return require("../../shell/eval-text");
}
(0, registry_core_1.attachCliBinding)("audit.summary", {
    path: ["audit", "summary"],
    jsonMode: "default",
    handler: (args) => ({ json: loadAuditCli().auditSummaryCli((0, io_1.required)(args.positionals[0], "run id"), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.summary").mcp.handler = (args) => loadAuditCli().auditSummaryCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("audit.multi-agent", {
    path: ["audit", "multi-agent"],
    jsonMode: "flag",
    handler: (args) => {
        const view = loadAuditCli().auditMultiAgentCli((0, io_1.required)(args.positionals[0], "run id"), args.options);
        return { json: view, text: loadOperatorUxText().formatMultiAgentTrustAudit(view) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.multi-agent").mcp.handler = (args) => loadAuditCli().auditMultiAgentCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("audit.policy", {
    path: ["audit", "policy"],
    jsonMode: "flag",
    handler: (args) => {
        const view = loadAuditCli().auditPolicyCli((0, io_1.required)(args.positionals[0], "run id"), args.options);
        return { json: view, text: loadOperatorUxText().formatMultiAgentTrustAudit(view) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.policy").mcp.handler = (args) => loadAuditCli().auditPolicyCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("audit.judge", {
    path: ["audit", "judge"],
    jsonMode: "flag",
    handler: (args) => {
        const view = loadAuditCli().auditJudgeCli((0, io_1.required)(args.positionals[0], "run id"), args.options);
        return { json: view, text: loadOperatorUxText().formatMultiAgentTrustAudit(view) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.judge").mcp.handler = (args) => loadAuditCli().auditJudgeCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
// GAP: `cw audit worker|provenance|role|blackboard|attest|decision` — the MCP
// tool rows (cw_audit_worker/provenance/role/blackboard/attest/decision) were
// declared but had no CLI path binding and their mcp.handler was still
// notYetImplemented. Wire both surfaces (port of the old cli/handlers/audit.ts
// arms). `audit worker`/`role`/`decision` read positionals[1] as the entity id.
(0, registry_core_1.attachCliBinding)("audit.worker", {
    path: ["audit", "worker"],
    jsonMode: "default",
    handler: (args) => ({ json: loadAuditCli().auditWorkerCli((0, io_1.required)(args.positionals[0], "run id"), (0, io_1.required)(args.positionals[1], "worker id"), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.worker").mcp.handler = (args) => loadAuditCli().auditWorkerCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), (0, io_1.required)((0, io_1.optionalArg)(args.workerId ?? args.worker), "worker id"), args);
(0, registry_core_1.attachCliBinding)("audit.provenance", {
    path: ["audit", "provenance"],
    jsonMode: "default",
    handler: (args) => ({ json: loadAuditCli().auditProvenanceCli((0, io_1.required)(args.positionals[0], "run id"), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.provenance").mcp.handler = (args) => loadAuditCli().auditProvenanceCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("audit.role", {
    path: ["audit", "role"],
    jsonMode: "flag",
    handler: (args) => {
        const view = loadAuditCli().auditRoleCli((0, io_1.required)(args.positionals[0], "run id"), (0, io_1.required)(args.positionals[1], "role id"), args.options);
        return { json: view, text: loadOperatorUxText().formatMultiAgentTrustAudit(view) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.role").mcp.handler = (args) => loadAuditCli().auditRoleCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), (0, io_1.required)((0, io_1.optionalArg)(args.roleId ?? args.id), "role id"), args);
(0, registry_core_1.attachCliBinding)("audit.blackboard", {
    path: ["audit", "blackboard"],
    jsonMode: "flag",
    handler: (args) => {
        const view = loadAuditCli().auditBlackboardCli((0, io_1.required)(args.positionals[0], "run id"), args.options);
        return { json: view, text: loadOperatorUxText().formatMultiAgentTrustAudit(view) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.blackboard").mcp.handler = (args) => loadAuditCli().auditBlackboardCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("audit.attest", {
    path: ["audit", "attest"],
    jsonMode: "default",
    handler: (args) => ({ json: loadAuditCli().auditAttestCli((0, io_1.required)(args.positionals[0], "run id"), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.attest").mcp.handler = (args) => loadAuditCli().auditAttestCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), args);
(0, registry_core_1.attachCliBinding)("audit.decision", {
    path: ["audit", "decision"],
    jsonMode: "default",
    handler: (args) => ({ json: loadAuditCli().auditDecisionCli((0, io_1.required)(args.positionals[0], "run id"), (0, io_1.required)(args.positionals[1], "worker id"), args.options) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("audit.decision").mcp.handler = (args) => loadAuditCli().auditDecisionCli((0, io_1.required)((0, io_1.optionalArg)(args.runId), "run id"), (0, io_1.required)((0, io_1.optionalArg)(args.workerId), "worker id"), args);
// ---- app.list / app.show / app.validate / app.init / app.package -------
