"use strict";
// shell/report.ts — report.md generation (the byte-exact section
// headers/fallback lines from the spec), the actual file write.
//
// Evidence: SPEC/reporting-ux.md "report.md (written by writeReport)".
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
exports.reportAnswer = reportAnswer;
exports.writeReport = writeReport;
const fs = __importStar(require("node:fs"));
const dispatch_1 = require("../core/pipeline/dispatch");
const registry_1 = require("./execution-backend/registry");
const trust_audit_1 = require("./trust-audit");
const telemetry_ledger_io_1 = require("./telemetry-ledger-io");
const run_registry_io_1 = require("./run-registry-io");
const collate_1 = require("../core/util/collate");
const result_normalize_1 = require("../core/pipeline/result-normalize");
const cli_args_1 = require("../core/util/cli-args");
/** One report head line: every control character (newline, CR, ESC and the
 *  rest of C0, and DEL; not tab) becomes a space, so a value from state.json
 *  such as `workflow.title` cannot start a new line in report.md. A value
 *  with no control character comes back byte-identical. */
function oneLine(value) {
    return value.replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, " ");
}
function formatInputList(value) {
    if (Array.isArray(value))
        return value.join("; ");
    return value ? String(value) : "";
}
function formatCounts(counts) {
    const entries = Object.entries(counts).sort(([a], [b]) => (0, collate_1.stableCompare)(a, b));
    if (!entries.length)
        return "none";
    return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}
function renderCommits(run) {
    if (!run.commits.length)
        return ["No state commits yet."];
    return run.commits.map((commit) => {
        const kind = commit.verifierGated ? "verifier-gated commit" : "checkpoint";
        const gate = commit.verifierGated ? `verifier=${commit.verifierNodeId || "unknown"}, evidence=${commit.evidence?.length || 0}` : "verifierGated=false";
        return `- ${commit.id}: ${commit.reason} [${commit.loopStage}; ${kind}; ${gate}] (${commit.snapshotPath})`;
    });
}
/** `## Sandbox Profiles`. */
function renderSandboxProfiles(run) {
    const profiles = run.sandboxProfiles || [];
    if (!profiles.length)
        return ["No sandbox profiles selected yet."];
    return profiles.map((profile) => [
        `- ${profile.id}: read=${profile.readPaths.length}, write=${profile.writePaths.length}, execute=${profile.execute.mode}, network=${profile.network.mode}`,
        `  enforcedByCW=${profile.enforcement.enforcedByCW.join("; ")}`,
        `  hostRequired=${profile.enforcement.hostRequired.join("; ")}`,
    ].join("\n"));
}
/** `## Trust Audit` (plus renderTelemetryAttestation). */
function renderTrustAudit(run) {
    const summary = (0, trust_audit_1.summarizeTrustAudit)(run);
    const integrity = summary.integrity;
    // Model-identity tally over the run's workers — only when workers exist,
    // so an empty run's report stays byte-identical.
    const workers = run.workers || [];
    const selfReported = workers.filter((w) => workerModelProvenance(w) === "agent-self-reported").length;
    const modelLines = workers.length
        ? [`- Model provenance: ${selfReported} agent-self-reported · ${workers.length - selfReported} absent (agent-self-reported, never CW-verified)`]
        : [];
    // Only when a workflow app actually ran — an empty/app-less run's report
    // stays byte-identical (matches the modelLines/links gating pattern).
    const appCodeLines = run.appCode
        ? [`- App code execution: ${run.appCode.execution} (trustedRoot=${run.appCode.trustedRoot}, ${run.appCode.path})`]
        : [];
    return [
        `- Events: ${summary.eventCount}`,
        `- Chain integrity: ${integrity ? (integrity.verified ? "verified" : "FAILED") : "n/a"}` +
            `${integrity ? ` (${integrity.chained} chained, ${integrity.unchained} legacy${integrity.corruptLines ? `, ${integrity.corruptLines} corrupt` : ""})` : ""}`,
        ...(integrity && !integrity.verified
            ? [`  !! TRUST-AUDIT CHAIN TAMPER DETECTED: ${integrity.checks.filter((c) => !c.pass).map((c) => c.code).join(", ")}`]
            : []),
        `- Decisions: ${formatCounts(summary.byDecision)}`,
        `- Sources: ${formatCounts(summary.bySource)}`,
        `- Sandbox profiles: ${formatCounts(summary.bySandboxProfile)}`,
        `- Event log: ${summary.eventLogPath}`,
        `- Summary: ${summary.summaryPath}`,
        `- Index: ${summary.indexPath}`,
        ...modelLines,
        ...appCodeLines,
        ...renderTelemetryAttestation(run),
    ];
}
/** Telemetry attestation coverage + a LOUD list of any `unattested`
 *  usage. */
function renderTelemetryAttestation(run) {
    const delegations = (0, trust_audit_1.listTrustAuditEvents)(run).filter((event) => event.kind === "worker.agent-delegation" && event.metadata && event.metadata.telemetryAttestation);
    if (!delegations.length)
        return [];
    const statusOf = (event) => String(event.metadata.telemetryAttestation);
    const attested = delegations.filter((event) => statusOf(event) === "attested").length;
    const unattested = delegations.filter((event) => statusOf(event) === "unattested");
    const absent = delegations.filter((event) => statusOf(event) === "absent").length;
    const lines = [
        `- Telemetry attestation: ${attested}/${delegations.length} attested` +
            (unattested.length ? `, ${unattested.length} UNATTESTED` : "") +
            (absent ? `, ${absent} absent` : ""),
    ];
    for (const event of unattested) {
        const reason = event.metadata.telemetryAttestationReason;
        lines.push(`  - ⚠️  UNATTESTED usage — worker=${event.workerId || "?"} task=${event.taskId || "?"}: ${reason || "signature unverified"}`);
    }
    const ledger = (0, telemetry_ledger_io_1.verifyTelemetryLedger)(run);
    if (ledger.present) {
        lines.push(ledger.verified
            ? `- Attestation ledger: ${ledger.records.length} records, chain verified (tamper-evident)`
            : `  - ⚠️  ATTESTATION LEDGER CHAIN BROKEN — a recorded verdict/usage was edited after the fact (${ledger.checks.filter((c) => !c.pass).map((c) => c.name).join(", ")})`);
    }
    return lines;
}
function renderFeedback(run) {
    const records = (run.feedback || []);
    if (!records.length)
        return ["No feedback records."];
    return [
        `- Total: ${records.length}`,
        `- By status: ${formatCounts((0, cli_args_1.countBy)(records, (r) => r.status))}`,
        `- By severity: ${formatCounts((0, cli_args_1.countBy)(records, (r) => r.severity))}`,
        `- By classification: ${formatCounts((0, cli_args_1.countBy)(records, (r) => r.classification))}`,
    ];
}
/** The worker's model-identity label. Comes only from the usage record the
 *  agent self-reported into — an old record or no record at all reads as
 *  "absent" (fail closed, never made up). */
function workerModelProvenance(worker) {
    const usage = worker.usage;
    return usage && usage.modelProvenance === "agent-self-reported" ? "agent-self-reported" : "absent";
}
function renderWorkers(run) {
    const workers = run.workers || [];
    if (!workers.length)
        return ["No worker scopes yet."];
    const lines = [`- Total: ${workers.length}`, `- By status: ${formatCounts((0, cli_args_1.countBy)(workers, (w) => w.status))}`];
    // Per-worker guarantee labels — rendered only for a worker that carries
    // an attestation or a usage record, so a run with neither keeps a
    // byte-identical report. Labels come ONLY from sandboxGuaranteeLabels.
    for (const w of workers) {
        if (!w.backendAttestation && !w.usage)
            continue;
        const g = (0, registry_1.sandboxGuaranteeLabels)(w.backendAttestation);
        lines.push(`- ${w.id}: backend=${w.backendId || "none"} guarantees write=${g.write} read=${g.read} command=${g.command} network=${g.network} env=${g.env} model=${workerModelProvenance(w)}`);
    }
    const failed = workers.filter((w) => w.status === "failed" || w.status === "rejected");
    if (failed.length) {
        lines.push("", "Failed or rejected:");
        for (const w of failed)
            lines.push(`- ${w.id} (${w.status}) feedback=${w.feedbackIds.join(",") || "none"}`);
    }
    return lines;
}
function renderPendingTasks(run) {
    const pending = run.tasks.filter((t) => t.status === "pending" || t.status === "running");
    if (!pending.length)
        return ["No pending tasks."];
    return pending.map((t) => `- ${t.id} (${t.phase}, ${t.status}): ${t.taskPath}`);
}
/** "run <-> PR linkage": one line per link annotation. Called only
 *  when `run.links` is non-empty (see writeReport below) — a run with no
 *  links never gains a "## Links" header, so an empty run's report.md
 *  stays byte-identical to before this field existed. */
/** The answer first: the completed verdict/synthesis task's own summary and
 *  evidence, above the run facts, so a reader does not scroll past them to
 *  find it. Nothing when the run has no completed verdict task or its
 *  result file is gone; the full result stays under ## Results. The same
 *  task-id rule as the terminal commit gate (drive-decide.ts). */
function renderAnswer(run) {
    const answer = reportAnswer(run);
    if (!answer)
        return [];
    const lines = ["## Answer", "", answer.summary, ""];
    if (answer.evidence.length)
        lines.push("Evidence:", "", ...answer.evidence.map((ref) => `- ${ref}`), "");
    lines.push(`Full result: ## Results, ### ${answer.taskId}`, "");
    return lines;
}
/** The report's "## Answer" as data: the completed verdict/synthesis
 *  task's id, summary and evidence, or null when report.md has no Answer
 *  part. MCP's cw_report gives it back when asked (`answer: true`). */
function reportAnswer(run) {
    const verdict = run.tasks.find((task) => /^verdict[:/]|^synthesis[:/]/i.test(task.id) && task.status === "completed");
    if (!verdict || !verdict.resultPath || !fs.existsSync(verdict.resultPath))
        return null;
    const envelope = (0, result_normalize_1.normalizeResultEnvelope)(fs.readFileSync(verdict.resultPath, "utf8"));
    if (!envelope.summary.trim())
        return null;
    return { taskId: verdict.id, summary: envelope.summary.trim(), evidence: envelope.evidence };
}
function renderLinks(run) {
    const links = run.links || [];
    return links.map((link) => `- [${link.kind}] ${link.url}${link.note ? ` — ${link.note}` : ""} (added ${link.addedAt} by ${link.actor})`);
}
function renderResults(run) {
    const completed = run.tasks.filter((t) => t.status === "completed");
    if (!completed.length)
        return ["No completed results yet."];
    const lines = [];
    for (const task of completed) {
        lines.push(`### ${task.id}`, "", `Result: ${task.resultPath}`, "");
        if (task.resultPath && fs.existsSync(task.resultPath)) {
            lines.push(fs.readFileSync(task.resultPath, "utf8").trim(), "");
        }
        else {
            lines.push("_Result file is not present on this host; state metadata remains inspectable._", "");
        }
    }
    return lines;
}
/** writeReport — renders report.md and writes it. Returns the path. */
function writeReport(run) {
    (0, dispatch_1.updatePhaseStatuses)(run);
    const workflowApp = run.workflow.app;
    // A research run reads a local folder of files, not a code repo — label
    // its source line "Source". Skip the relabel when the run ALSO carries a
    // remote-provenance "- Source: <url>" line below (run.inputs.sourceUrl
    // set by a --link/URL), so a report never shows two "- Source:" lines.
    // Every other app keeps the byte-identical "Repository:" (POLA).
    const sourceLabel = workflowApp?.metadata?.domain === "research" && !run.inputs.sourceUrl ? "Source" : "Repository";
    const lifecycle = (0, run_registry_io_1.runLifecycle)(run);
    const report = [
        `# ${oneLine(String(run.workflow.title))}`,
        "",
        `- Run: ${run.id}`,
        `- Workflow: ${oneLine(String(run.workflow.id))}`,
        ...(workflowApp
            ? [`- Workflow App: ${oneLine(`${workflowApp.id}@${workflowApp.version}`)}`, `- Workflow App Source: ${oneLine(String(workflowApp.source?.manifestPath || workflowApp.source?.entrypointPath || workflowApp.source?.path || ""))}`]
            : []),
        `- Created: ${run.createdAt}`,
        `- Updated: ${run.updatedAt}`,
        `- ${sourceLabel}: ${oneLine(String(run.inputs.repo || run.cwd))}`,
        ...(run.inputs.sourceUrl
            ? [`- Source: ${oneLine(`${String(run.inputs.sourceUrl)}${run.inputs.sourceCommit ? `@${String(run.inputs.sourceCommit)}` : ""}`)}`]
            : []),
        `- Question: ${oneLine(String(run.inputs.question || ""))}`,
        `- Invariants: ${oneLine(formatInputList(run.inputs.invariant))}`,
        `- Loop Stage: ${run.loopStage}`,
        `- Verdict: ${lifecycle === "completed" ? "PASS" : lifecycle.toUpperCase()}`,
        "",
        ...renderAnswer(run),
        "## Phase Status",
        "",
        "| Phase | Status | Completed | Total |",
        "| --- | --- | ---: | ---: |",
        ...run.phases.map((phase) => {
            const taskIds = new Set(phase.taskIds);
            const phaseTasks = run.tasks.filter((t) => taskIds.has(t.id));
            const completed = phaseTasks.filter((t) => t.status === "completed").length;
            return `| ${phase.name} | ${phase.status} | ${completed} | ${phaseTasks.length} |`;
        }),
        "",
        "## State Commits",
        "",
        ...renderCommits(run),
        "",
        "## Error Feedback",
        "",
        ...renderFeedback(run),
        "",
        "## Workers",
        "",
        ...renderWorkers(run),
        "",
        "## Sandbox Profiles",
        "",
        ...renderSandboxProfiles(run),
        "",
        "## Trust Audit",
        "",
        ...renderTrustAudit(run),
        "",
        "## Pending Tasks",
        "",
        ...renderPendingTasks(run),
        "",
        "## Results",
        "",
        ...renderResults(run),
        // "run <-> PR linkage": the ONLY section that is fully absent (no
        // header at all) when it has nothing to show — every section above
        // keeps its header plus a "none yet" fallback line, but a "## Links"
        // header on a run with no links would be new, unwanted noise on
        // every run's report, so it is skipped outright instead.
        ...(run.links && run.links.length ? ["", "## Links", "", ...renderLinks(run)] : []),
    ].join("\n");
    fs.writeFileSync(run.paths.report, report, "utf8");
    return run.paths.report;
}
