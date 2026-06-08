"use strict";
// Shared capability core: the SINGLE source of truth for composite capabilities
// whose payload is assembled from more than one orchestrator call.
//
// BSD discipline (mechanism vs policy): these functions are MECHANISM. They live
// here — never in cli.ts or mcp-server.ts — so the CLI and the MCP surface are
// two renderings of ONE data source. Any capability that composes multiple
// runner calls (plan summary, app run, sandbox choice, commit envelope) MUST be
// expressed here and called identically by both surfaces. A composite that lives
// in only one surface is exactly the cross-surface drift v0.1.27 forbids.
//
// See docs/cli-mcp-parity.7.md and src/capability-registry.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.planSummary = planSummary;
exports.appRun = appRun;
exports.sandboxChoose = sandboxChoose;
exports.commitEnvelope = commitEnvelope;
exports.compactOperatorStatus = compactOperatorStatus;
exports.sandboxProfileIdFrom = sandboxProfileIdFrom;
exports.withoutRuntimeKeys = withoutRuntimeKeys;
exports.optionalString = optionalString;
exports.isRecord = isRecord;
// ---- canonical plan payload -----------------------------------------------
// Both `cw plan` (default + --json) and `cw_plan` resolve to this exact object.
function planSummary(runner, workflowId, options) {
    const run = runner.plan(workflowId, options);
    return {
        runId: run.id,
        workflowId: run.workflow.id,
        statePath: run.paths.state,
        reportPath: run.paths.report,
        pendingTasks: run.tasks.filter((task) => task.status === "pending").length
    };
}
// ---- canonical app-run payload --------------------------------------------
// Both `cw app run` and `cw_app_run` resolve to this exact object. Structured
// app inputs + optional sandbox resolution, then a compact operator status.
function appRun(runner, args) {
    const appId = String(args.appId || args.workflowId || "");
    const inputs = isRecord(args.inputs) ? args.inputs : {};
    const planOptions = { ...inputs, ...withoutRuntimeKeys(args) };
    const sandboxProfileId = sandboxProfileIdFrom(args);
    const resolvedSandbox = sandboxProfileId ? runner.showSandboxProfile(sandboxProfileId, args) : undefined;
    const run = runner.plan(appId, planOptions);
    const status = runner.operatorStatus(run.id);
    return {
        runId: run.id,
        workflowId: run.workflow.id,
        appId: run.workflow.app?.id || appId,
        appVersion: run.workflow.app?.version,
        statePath: run.paths.state,
        reportPath: run.paths.report,
        pendingTasks: run.tasks.filter((task) => task.status === "pending").length,
        operatorStatus: compactOperatorStatus(status),
        nextActions: status.nextActions,
        sandboxProfileId,
        sandboxProfile: resolvedSandbox
    };
}
// ---- canonical sandbox choice payload -------------------------------------
// Both `cw sandbox choose|resolve` and `cw_sandbox_choose|cw_sandbox_resolve`
// resolve to this exact object.
function sandboxChoose(runner, args) {
    const profileId = sandboxProfileIdFrom(args) || "readonly";
    const profile = runner.showSandboxProfile(profileId, args);
    return {
        profileId,
        sandboxProfileId: profile.id,
        valid: true,
        profile
    };
}
// ---- canonical commit envelope --------------------------------------------
// `cw_commit` resolves to this operator-facing envelope. The CLI `commit`
// command intentionally emits the raw StateCommitResult for scripting; both
// derive from the single core entry runner.commit (declared, not drift — see
// the capability registry's `commit` descriptor).
function commitEnvelope(runner, runId, args) {
    const result = runner.commit(runId, args);
    const commit = result.commit;
    const status = runner.operatorStatus(runId);
    return {
        runId,
        commitId: commit.id,
        verifierGated: commit.verifierGated,
        checkpoint: commit.checkpoint,
        verifierNodeId: commit.verifierNodeId,
        candidateId: commit.candidateId,
        selectionId: commit.selectionId,
        evidenceCount: (commit.evidence || []).length,
        snapshotPath: commit.snapshotPath,
        nextActions: status.nextActions,
        commit
    };
}
function compactOperatorStatus(status) {
    return {
        runId: status.runId,
        workflowId: status.workflowId,
        appId: status.appId,
        appVersion: status.appVersion,
        loopStage: status.loopStage,
        activePhase: status.activePhase,
        blocked: status.blocked,
        blockedReasons: status.blockedReasons,
        pendingTasks: status.tasks.pending.length,
        runningTasks: status.tasks.running.length,
        completedTasks: status.tasks.completed.length,
        nextActions: status.nextActions
    };
}
// ---- shared argument helpers ----------------------------------------------
function sandboxProfileIdFrom(args) {
    return optionalString(args.sandbox || args.sandboxProfile || args.sandboxProfileId || args.profileId);
}
function withoutRuntimeKeys(args) {
    const copy = { ...args };
    for (const key of ["appId", "workflowId", "inputs", "sandbox", "sandboxProfile", "sandboxProfileId", "profileId"]) {
        delete copy[key];
    }
    return copy;
}
function optionalString(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    return String(value);
}
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
