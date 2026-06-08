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
exports.runRegistryFor = runRegistryFor;
exports.runRegistryRefresh = runRegistryRefresh;
exports.runRegistryShow = runRegistryShow;
exports.runSearch = runSearch;
exports.runList = runList;
exports.runShow = runShow;
exports.runResume = runResume;
exports.runArchive = runArchive;
exports.runRerun = runRerun;
exports.queueAdd = queueAdd;
exports.queueList = queueList;
exports.queueDrain = queueDrain;
exports.queueShow = queueShow;
exports.runHistory = runHistory;
exports.sandboxProfileIdFrom = sandboxProfileIdFrom;
exports.withoutRuntimeKeys = withoutRuntimeKeys;
exports.optionalString = optionalString;
exports.isRecord = isRecord;
const run_registry_1 = require("./run-registry");
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
// ---- run registry / control plane (v0.1.28) -------------------------------
// MECHANISM, ONE SOURCE: the CLI and MCP surfaces both route through these
// functions so `cw <cmd> --json` is byte-identical to `cw_<tool>`. Each accepts
// the raw CLI options OR the raw MCP arguments and normalizes them identically,
// then calls the single RunRegistry method. The registry is constructed from the
// same resolved cwd on both surfaces (CLI: --cwd|process.cwd(); MCP chdir'd to
// args.cwd), so repo/home roots line up.
function runRegistryFor(args, planner) {
    return new run_registry_1.RunRegistry(String(args.cwd || process.cwd()), planner);
}
function scopeOf(args, fallback) {
    if (args.scope === "repo")
        return "repo";
    if (args.scope === "home")
        return "home";
    return fallback;
}
function lifecycleOf(value) {
    return (0, run_registry_1.isRunLifecycleState)(value) ? value : undefined;
}
function flag(value) {
    if (value === undefined)
        return undefined;
    if (value === false || value === "false" || value === "no" || value === "0")
        return false;
    return Boolean(value);
}
function runRegistryRefresh(reg, args) {
    return reg.refresh({ scope: scopeOf(args, "repo") });
}
function runRegistryShow(reg, args) {
    return reg.show({ scope: scopeOf(args, "repo") });
}
function runSearch(reg, args) {
    return reg.search({
        scope: scopeOf(args, "home"),
        text: optionalString(args.text || args.q || args.query),
        app: optionalString(args.app || args.appId),
        status: lifecycleOf(args.status),
        repo: optionalString(args.repo),
        since: optionalString(args.since),
        until: optionalString(args.until),
        includeArchived: flag(args.includeArchived ?? args["include-archived"]),
        limit: args.limit === undefined ? undefined : Number(args.limit),
        offset: args.offset === undefined ? undefined : Number(args.offset)
    });
}
function runList(reg, args) {
    return reg.list({
        scope: scopeOf(args, "home"),
        includeArchived: flag(args.includeArchived ?? args["include-archived"]),
        limit: args.limit === undefined ? undefined : Number(args.limit),
        offset: args.offset === undefined ? undefined : Number(args.offset)
    });
}
function runShow(reg, runId, args) {
    return reg.showRun(runId, { scope: scopeOf(args, "home") });
}
function runResume(reg, runId, args) {
    return reg.resume(runId, {
        scope: scopeOf(args, "home"),
        limit: args.limit === undefined ? undefined : Number(args.limit)
    });
}
function runArchive(reg, runId, args) {
    if (runId) {
        return reg.archive(runId, {
            scope: scopeOf(args, "home"),
            reason: optionalString(args.reason),
            unarchive: flag(args.unarchive)
        });
    }
    const days = Number(args.olderThanDays ?? args["older-than-days"]);
    const states = parseLifecycleList(args.state ?? args.status);
    return reg.archiveByPolicy({
        schemaVersion: 1,
        archiveOlderThanDays: Number.isFinite(days) ? days : 0,
        archiveStates: states.length ? states : ["completed", "failed"],
        defaultQueuePriority: 100
    }, { scope: scopeOf(args, "home") });
}
function runRerun(reg, runId, args) {
    return reg.rerun(runId, { scope: scopeOf(args, "home"), reason: optionalString(args.reason) });
}
function queueAdd(reg, args) {
    return reg.queueAdd({
        runId: optionalString(args.runId),
        appId: optionalString(args.appId || args.app),
        workflowId: optionalString(args.workflowId || args.workflow),
        repo: optionalString(args.repo),
        priority: args.priority === undefined ? undefined : Number(args.priority),
        note: optionalString(args.note),
        id: optionalString(args.id)
    });
}
function queueList(reg, args) {
    const status = optionalString(args.status);
    return reg.queueList({
        status: status,
        repo: optionalString(args.repo)
    });
}
function queueDrain(reg, args) {
    return reg.queueDrain({
        limit: args.limit === undefined ? undefined : Number(args.limit),
        repo: optionalString(args.repo)
    });
}
function queueShow(reg, id) {
    return reg.queueShow(id);
}
function runHistory(reg, args) {
    return reg.history({
        scope: scopeOf(args, "home"),
        app: optionalString(args.app || args.appId),
        status: lifecycleOf(args.status),
        limit: args.limit === undefined ? undefined : Number(args.limit),
        offset: args.offset === undefined ? undefined : Number(args.offset)
    });
}
function parseLifecycleList(value) {
    const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
    const out = [];
    for (const item of raw) {
        if ((0, run_registry_1.isRunLifecycleState)(item))
            out.push(item);
    }
    return out;
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
