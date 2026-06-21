"use strict";
// Report rendering for workflow runs — extracted from orchestrator.ts.
//
// Pure projection of a WorkflowRun into the human-readable run report and the
// RunSummary view model. No orchestration state, no I/O beyond writing the
// report file. The orchestrator re-imports the two public entry points
// (writeReport, summarizeRun); every render*/format* helper here is private.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeReport = writeReport;
exports.summarizeRun = summarizeRun;
const node_fs_1 = __importDefault(require("node:fs"));
const dispatch_1 = require("../dispatch");
const worker_isolation_1 = require("../worker-isolation");
const candidate_scoring_1 = require("../candidate-scoring");
const error_feedback_1 = require("../error-feedback");
const multi_agent_1 = require("../multi-agent");
const coordinator_1 = require("../coordinator");
const trust_audit_1 = require("../trust-audit");
const telemetry_ledger_1 = require("../telemetry-ledger");
const state_explosion_1 = require("../state-explosion");
function writeReport(run) {
    (0, dispatch_1.updatePhaseStatuses)(run);
    const workerSummary = (0, worker_isolation_1.summarizeWorkers)(run);
    const candidateSummary = (0, candidate_scoring_1.summarizeCandidates)(run);
    // A research run reads a local folder of files, not a code repo — label its source line
    // "Source". Skip the relabel when the run ALSO carries a remote-provenance "- Source: <url>"
    // line below (run.inputs.sourceUrl set by a --link/URL), so a report never shows two
    // "- Source:" lines. Every other app keeps the byte-identical "Repository:" (POLA).
    const sourceLabel = run.workflow.app?.metadata?.domain === "research" && !run.inputs.sourceUrl ? "Source" : "Repository";
    const report = [
        `# ${run.workflow.title}`,
        "",
        `- Run: ${run.id}`,
        `- Workflow: ${run.workflow.id}`,
        ...(run.workflow.app
            ? [
                `- Workflow App: ${run.workflow.app.id}@${run.workflow.app.version}`,
                `- Workflow App Source: ${run.workflow.app.source?.manifestPath || run.workflow.app.source?.entrypointPath || run.workflow.app.source?.path || ""}`
            ]
            : []),
        `- Created: ${run.createdAt}`,
        `- Updated: ${run.updatedAt}`,
        `- ${sourceLabel}: ${String(run.inputs.repo || run.cwd)}`,
        // Remote provenance (v0.1.91): when the repo was materialized from a --link/URL, record
        // the sanitized origin + resolved commit so the report itself says where the code came
        // from. Conditional — absent for a local-repo run, so existing reports stay byte-identical.
        ...(run.inputs.sourceUrl
            ? [`- Source: ${String(run.inputs.sourceUrl)}${run.inputs.sourceCommit ? `@${String(run.inputs.sourceCommit)}` : ""}`]
            : []),
        `- Question: ${String(run.inputs.question || "")}`,
        `- Invariants: ${formatInputList(run.inputs.invariant)}`,
        `- Loop Stage: ${run.loopStage}`,
        "",
        "## Phase Status",
        "",
        "| Phase | Status | Completed | Total |",
        "| --- | --- | ---: | ---: |",
        ...run.phases.map((phase) => {
            const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
            const completed = phaseTasks.filter((task) => task.status === "completed").length;
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
        ...renderWorkers(workerSummary),
        "",
        "## State Size & Compaction",
        "",
        ...renderStateSize(run),
        "",
        "## Multi-Agent Runtime",
        "",
        ...renderMultiAgent(run),
        "",
        "## Blackboard / Coordinator",
        "",
        ...renderBlackboard(run),
        "",
        "## Sandbox Profiles",
        "",
        ...renderSandboxProfiles(run),
        "",
        "## Trust Audit",
        "",
        ...renderTrustAudit(run),
        "",
        "## Acceptance Rationale",
        "",
        ...renderAcceptanceRationale(run),
        "",
        "## Candidates",
        "",
        ...renderCandidates(candidateSummary),
        "",
        "## Pending Tasks",
        "",
        ...renderPendingTasks(run),
        "",
        "## Results",
        "",
        ...renderResults(run)
    ].join("\n");
    node_fs_1.default.writeFileSync(run.paths.report, report, "utf8");
    return run.paths.report;
}
function summarizeRun(run) {
    (0, dispatch_1.updatePhaseStatuses)(run);
    const workerSummary = (0, worker_isolation_1.summarizeWorkers)(run);
    const createdAtMs = Date.parse(run.createdAt);
    const updatedAtMs = Date.parse(run.updatedAt);
    const durationMs = Number.isFinite(createdAtMs) && Number.isFinite(updatedAtMs) ? Math.max(0, updatedAtMs - createdAtMs) : undefined;
    return {
        runId: run.id,
        workflowId: run.workflow.id,
        app: run.workflow.app,
        phases: run.phases,
        tasks: {
            total: run.tasks.length,
            pending: run.tasks.filter((task) => task.status === "pending").length,
            running: run.tasks.filter((task) => task.status === "running").length,
            failed: run.tasks.filter((task) => task.status === "failed").length,
            completed: run.tasks.filter((task) => task.status === "completed").length
        },
        loopStage: run.loopStage,
        durationMs,
        progressPercent: run.tasks.length ? Math.round((run.tasks.filter((t) => t.status === "completed").length / run.tasks.length) * 100) : 0,
        next: (0, dispatch_1.firstRunnablePhase)(run)?.name || null,
        reportPath: run.paths.report,
        commits: run.commits,
        workers: {
            total: workerSummary.total,
            byStatus: workerSummary.byStatus
        }
    };
}
function renderPendingTasks(run) {
    const pending = run.tasks.filter((task) => task.status === "pending" || task.status === "running");
    if (!pending.length)
        return ["No pending tasks."];
    return pending.map((task) => `- ${task.id} (${task.phase}, ${task.status}): ${task.taskPath}`);
}
function renderResults(run) {
    const completed = run.tasks.filter((task) => task.status === "completed");
    if (!completed.length)
        return ["No completed results yet."];
    const lines = [];
    for (const task of completed) {
        lines.push(`### ${task.id}`, "", `Result: ${task.resultPath}`, "");
        if (task.resultPath && node_fs_1.default.existsSync(task.resultPath)) {
            lines.push(node_fs_1.default.readFileSync(task.resultPath, "utf8").trim(), "");
        }
        else {
            lines.push("_Result file is not present on this host; state metadata remains inspectable._", "");
        }
    }
    return lines;
}
function renderCommits(run) {
    if (!run.commits.length)
        return ["No state commits yet."];
    return run.commits.map((commit) => {
        const kind = commit.verifierGated ? "verifier-gated commit" : "checkpoint";
        const gate = commit.verifierGated ? formatCommitGate(commit) : "verifierGated=false";
        return `- ${commit.id}: ${commit.reason} [${commit.loopStage}; ${kind}; ${gate}] (${commit.snapshotPath})`;
    });
}
function renderFeedback(run) {
    const summary = (0, error_feedback_1.summarizeFeedback)(run);
    if (!summary.total)
        return ["No feedback records."];
    return [
        `- Total: ${summary.total}`,
        `- By status: ${formatCounts(summary.byStatus)}`,
        `- By severity: ${formatCounts(summary.bySeverity)}`,
        `- By classification: ${formatCounts(summary.byClassification)}`,
        "",
        ...summary.artifacts.map((artifact) => `- ${artifact}`)
    ];
}
function renderWorkers(summary) {
    if (!summary.total)
        return ["No worker scopes yet."];
    const lines = [
        `- Total: ${summary.total}`,
        `- By status: ${formatCounts(summary.byStatus)}`,
        "",
        ...summary.manifestPaths.map((artifact) => `- ${artifact}`)
    ];
    if (summary.failed.length) {
        lines.push("", "Failed or rejected:");
        for (const worker of summary.failed) {
            lines.push(`- ${worker.id} (${worker.status}) feedback=${worker.feedbackIds.join(",") || "none"}`);
        }
    }
    return lines;
}
function renderStateSize(run) {
    const index = (0, state_explosion_1.loadStateExplosionSummaryIndex)(run);
    const report = (0, state_explosion_1.buildStateExplosionReport)(run, { index });
    return (0, state_explosion_1.stateExplosionReportLines)(report);
}
function renderMultiAgent(run) {
    const summary = (0, multi_agent_1.summarizeMultiAgent)(run);
    if (!summary.totalRuns)
        return ["No multi-agent runtime records yet."];
    const lines = [
        `- Runs: ${summary.totalRuns} (${formatCounts(summary.runsByStatus)})`,
        `- Roles: ${summary.roles}`,
        `- Groups: ${summary.groups} (${formatCounts(summary.groupsByStatus)})`,
        `- Memberships: ${summary.memberships} (${formatCounts(summary.membershipsByStatus)})`,
        `- Fanouts: ${summary.fanouts}`,
        `- Fanins: ${summary.fanins} (${formatCounts(summary.faninsByStatus)})`
    ];
    if (summary.blockedReasons.length) {
        lines.push("", "Blocked:");
        for (const reason of summary.blockedReasons.slice(0, 8))
            lines.push(`- ${reason}`);
    }
    for (const group of summary.groupsDetail.slice(0, 8)) {
        lines.push("", `Group ${group.id}: status=${group.status}, phase=${group.phase || "none"}, run=${group.multiAgentRunId}`);
        for (const role of group.roles) {
            lines.push(`- role=${role.roleId}, memberships=${role.memberships}, reported=${role.reported}, missing=${role.missing}, requiredEvidence=${role.requiredEvidence}`);
        }
        lines.push(`- fanouts=${group.fanouts.join(", ") || "none"}`);
        lines.push(`- fanins=${group.fanins.join(", ") || "none"}`);
    }
    if (summary.nextAction)
        lines.push("", `Next multi-agent action: ${summary.nextAction}`);
    return lines;
}
function renderBlackboard(run) {
    const summary = (0, coordinator_1.summarizeBlackboard)(run);
    if (!summary.blackboardId)
        return ["No blackboard records yet."];
    const lines = [
        `- Blackboard: ${summary.blackboardId}`,
        `- Topics: ${summary.topics}`,
        `- Messages: ${summary.messages}`,
        `- Contexts: ${summary.contexts}`,
        `- Artifacts: ${summary.artifacts}`,
        `- Snapshots: ${summary.snapshots}`,
        `- Decisions: ${summary.decisions}`,
        `- Ready for fanin: ${summary.readyForFanin ? "yes" : "no"}`,
        `- Index: ${summary.indexPath || "none"}`,
        `- Latest snapshot: ${summary.latestSnapshotPath || "none"}`
    ];
    if (summary.openQuestions.length) {
        lines.push("", "Open questions:");
        for (const question of summary.openQuestions.slice(0, 8))
            lines.push(`- ${question.id}: ${question.key}=${question.value}`);
    }
    if (summary.conflicts.length) {
        lines.push("", "Conflicts:");
        for (const conflict of summary.conflicts.slice(0, 8)) {
            lines.push(`- ${conflict.id}: ${conflict.key} conflicts with ${conflict.conflictingContextIds.join(", ") || "unknown"}`);
        }
    }
    if (summary.missingEvidence.length) {
        lines.push("", "Missing evidence:");
        for (const item of summary.missingEvidence.slice(0, 8))
            lines.push(`- ${item}`);
    }
    if (summary.nextAction)
        lines.push("", `Next coordinator action: ${summary.nextAction}`);
    return lines;
}
function renderSandboxProfiles(run) {
    const profiles = run.sandboxProfiles || [];
    if (!profiles.length)
        return ["No sandbox profiles selected yet."];
    return profiles.map((profile) => [
        `- ${profile.id}: read=${profile.readPaths.length}, write=${profile.writePaths.length}, execute=${profile.execute.mode}, network=${profile.network.mode}`,
        `  enforcedByCW=${profile.enforcement.enforcedByCW.join("; ")}`,
        `  hostRequired=${profile.enforcement.hostRequired.join("; ")}`
    ].join("\n"));
}
function renderCandidates(summary) {
    if (!summary.total)
        return ["No candidates yet."];
    return [
        `- Total: ${summary.total}`,
        `- By status: ${formatCounts(summary.byStatus)}`,
        `- By kind: ${formatCounts(summary.byKind)}`,
        `- Selections: ${summary.selections}`,
        `- Index: ${summary.indexPath}`,
        `- Ranking: ${summary.rankingPath}`
    ];
}
function renderTrustAudit(run) {
    const summary = (0, trust_audit_1.summarizeTrustAudit)(run);
    const integrity = summary.integrity;
    return [
        `- Events: ${summary.eventCount}`,
        `- Chain integrity: ${integrity ? (integrity.verified ? "verified" : "FAILED") : "n/a"}` +
            `${integrity ? ` (${integrity.chained} chained, ${integrity.unchained} legacy${integrity.corruptLines ? `, ${integrity.corruptLines} corrupt` : ""})` : ""}`,
        // An auditable control-plane never lets a broken decision-log chain pass
        // silently — name the failing checks loudly, same as the telemetry chain.
        ...(integrity && !integrity.verified
            ? [`  !! TRUST-AUDIT CHAIN TAMPER DETECTED: ${integrity.checks.filter((c) => !c.pass).map((c) => c.code).join(", ")}`]
            : []),
        `- Decisions: ${formatCounts(summary.byDecision)}`,
        `- Sources: ${formatCounts(summary.bySource)}`,
        `- Sandbox profiles: ${formatCounts(summary.bySandboxProfile)}`,
        `- Event log: ${summary.eventLogPath}`,
        `- Summary: ${summary.summaryPath}`,
        `- Index: ${summary.indexPath}`,
        ...renderTelemetryAttestation(run)
    ];
}
/** Track 1: telemetry attestation coverage + a LOUD list of any `unattested`
 *  usage. An auditable control-plane never lets unverified telemetry pass
 *  silently — every reported-but-unverified usage is named here with its reason. */
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
            (absent ? `, ${absent} absent` : "")
    ];
    for (const event of unattested) {
        const reason = event.metadata.telemetryAttestationReason;
        lines.push(`  - ⚠️  UNATTESTED usage — worker=${event.workerId || "?"} task=${event.taskId || "?"}: ${reason || "signature unverified"}`);
    }
    // Tamper-evidence: re-prove the hash-chained ledger. A broken chain means a
    // recorded verdict/usage was edited after the fact — surfaced LOUDLY.
    const ledger = (0, telemetry_ledger_1.verifyTelemetryLedger)(run);
    if (ledger.present) {
        lines.push(ledger.verified
            ? `- Attestation ledger: ${ledger.records.length} records, chain verified (tamper-evident)`
            : `  - ⚠️  ATTESTATION LEDGER CHAIN BROKEN — a recorded verdict/usage was edited after the fact (${ledger.checks.filter((c) => !c.pass).map((c) => c.name).join(", ")})`);
    }
    return lines;
}
function renderAcceptanceRationale(run) {
    const lines = [];
    for (const selection of run.candidateSelections || []) {
        const rationale = selection.acceptanceRationale;
        if (!rationale)
            continue;
        lines.push(`- Selection ${selection.id}: candidate=${rationale.selectedCandidateId || selection.candidateId}, score=${rationale.scoreId || "none"}, verifier=${rationale.verifierNodeId || "none"}, evidence=${rationale.evidenceCount}, sandbox=${rationale.sandboxProfileId || "none"}, worker=${rationale.workerId || "none"}`);
    }
    for (const commit of run.commits || []) {
        if (!commit.acceptanceRationale)
            continue;
        const rationale = commit.acceptanceRationale;
        lines.push(`- Commit ${commit.id}: gate=${rationale.commitGateResult || "unknown"}, candidate=${rationale.selectedCandidateId || commit.candidateId || "none"}, score=${rationale.scoreId || "none"}, verifier=${rationale.verifierNodeId || commit.verifierNodeId || "none"}, evidence=${rationale.evidenceCount}, sandbox=${rationale.sandboxProfileId || "none"}, worker=${rationale.workerId || "none"}`);
    }
    return lines.length ? lines : ["No accepted candidate or verifier-gated commit rationale yet."];
}
function formatCommitGate(commit) {
    return [
        `verifier=${commit.verifierNodeId || "unknown"}`,
        commit.candidateId ? `candidate=${commit.candidateId}` : "",
        commit.selectionId ? `selection=${commit.selectionId}` : "",
        `evidence=${commit.evidence?.length || 0}`
    ]
        .filter(Boolean)
        .join(", ");
}
function formatCounts(counts) {
    const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
    if (!entries.length)
        return "none";
    return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}
function formatInputList(value) {
    if (Array.isArray(value))
        return value.join("; ");
    return value ? String(value) : "";
}
