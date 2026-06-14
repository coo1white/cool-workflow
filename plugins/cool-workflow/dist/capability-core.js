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
// Capability metadata (which entry is on which surface, tool names, jsonMode) is
// declared in ONE place — the BUILTIN_CAPABILITIES table in capability-registry.ts,
// the single source of truth both surfaces and the parity gate read. New
// capabilities add a row there. (A v0.1.46 "self-register at load time" mechanism
// was removed: the registry snapshot was taken before those registrations ran, so
// they were silently dead duplicates of the table — see capability-registry.ts.)
//
// See docs/cli-mcp-parity.7.md and src/capability-registry.ts.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUICKSTART_DEFAULT_APP = void 0;
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
exports.runExportArchive = runExportArchive;
exports.runImportArchive = runImportArchive;
exports.runVerifyImport = runVerifyImport;
exports.queueAdd = queueAdd;
exports.queueList = queueList;
exports.queueDrain = queueDrain;
exports.queueShow = queueShow;
exports.schedPlan = schedPlan;
exports.schedLease = schedLease;
exports.schedRelease = schedRelease;
exports.schedComplete = schedComplete;
exports.schedReclaim = schedReclaim;
exports.schedReset = schedReset;
exports.schedPolicyShow = schedPolicyShow;
exports.schedPolicySet = schedPolicySet;
exports.runDrivePreview = runDrivePreview;
exports.runDrive = runDrive;
exports.quickstart = quickstart;
exports.backendAgentConfigShow = backendAgentConfigShow;
exports.backendAgentConfigSet = backendAgentConfigSet;
exports.gcPlan = gcPlan;
exports.gcRun = gcRun;
exports.gcVerify = gcVerify;
exports.runHistory = runHistory;
exports.metricsSummary = metricsSummary;
exports.sandboxProfileIdFrom = sandboxProfileIdFrom;
exports.withoutRuntimeKeys = withoutRuntimeKeys;
exports.optionalString = optionalString;
exports.isRecord = isRecord;
exports.telemetryVerify = telemetryVerify;
exports.demoTamper = demoTamper;
const drive_1 = require("./drive");
const agent_config_1 = require("./agent-config");
const run_registry_1 = require("./run-registry");
const observability_1 = require("./observability");
const telemetry_ledger_1 = require("./telemetry-ledger");
const telemetry_demo_1 = require("./telemetry-demo");
const state_1 = require("./state");
const run_export_1 = require("./run-export");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const scheduling_1 = require("./scheduling");
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
function withInvocationCwd(args, fn) {
    const cwd = optionalString(args.cwd);
    if (!cwd)
        return fn();
    const previous = process.cwd();
    process.chdir(cwd);
    try {
        return fn();
    }
    finally {
        process.chdir(previous);
    }
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
function runExportArchive(runner, runId, args) {
    return withInvocationCwd(args, () => {
        const output = optionalString(args.output || args.path || args.archive) || `${runId}.cwrun.json`;
        return (0, run_export_1.exportRun)(runner.loadRun(runId), node_path_1.default.resolve(output));
    });
}
function runImportArchive(runner, args) {
    return withInvocationCwd(args, () => {
        const archive = optionalString(args.archive || args.path || args.file);
        if (!archive)
            throw new Error("run import requires an archive path (positional, --archive, --path, or --file)");
        const target = optionalString(args.target || args.repo || args.cwd) || process.cwd();
        const imported = (0, run_export_1.importRun)(node_path_1.default.resolve(archive), node_path_1.default.resolve(target));
        const registry = new run_registry_1.RunRegistry(node_path_1.default.resolve(target), runner);
        const registryReport = registry.refresh({ scope: "repo" });
        return { ...imported, registry: registryReport };
    });
}
function runVerifyImport(runner, runId, args) {
    return withInvocationCwd(args, () => (0, run_export_1.verifyImportedRun)(runner.loadRun(runId)));
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
// ---- control-plane scheduling (v0.1.37) -----------------------------------
function loadSchedulingPolicy(reg) {
    const file = reg.schedulingPolicyPath();
    if (node_fs_1.default.existsSync(file)) {
        try {
            return { policy: (0, scheduling_1.normalizeSchedulingPolicy)((0, state_1.readJson)(file)), source: "file" };
        }
        catch {
            /* fall through to default */
        }
    }
    return { policy: scheduling_1.DEFAULT_SCHEDULING_POLICY, source: "default" };
}
function schedNow(args) {
    return optionalString(args.now) || new Date().toISOString();
}
function isTrue(value) {
    return value === true || value === "true" || value === "1";
}
function schedPlan(reg, args) {
    return (0, scheduling_1.planSchedule)(reg.loadQueueEntries(), loadSchedulingPolicy(reg).policy, schedNow(args));
}
function schedLease(reg, args) {
    const now = schedNow(args);
    const policy = loadSchedulingPolicy(reg).policy;
    const limit = args.limit === undefined ? undefined : Number(args.limit);
    const { entries, leases } = (0, scheduling_1.applyLease)(reg.loadQueueEntries(), policy, now, limit);
    reg.saveQueueEntries(entries);
    return { schemaVersion: 1, now, granted: leases.length, leases };
}
function schedRelease(reg, args) {
    const now = schedNow(args);
    const failed = isTrue(args.failed);
    const { entries, matched } = (0, scheduling_1.leaseRelease)(reg.loadQueueEntries(), String(args.leaseId || ""), loadSchedulingPolicy(reg).policy, now, {
        failed,
        reason: optionalString(args.reason)
    });
    if (!matched)
        throw new Error(`No active lease to release: ${args.leaseId}`);
    reg.saveQueueEntries(entries);
    return { schemaVersion: 1, released: String(args.leaseId || ""), failed };
}
function schedComplete(reg, args) {
    const { entries, matched } = (0, scheduling_1.leaseComplete)(reg.loadQueueEntries(), String(args.leaseId || ""), schedNow(args));
    if (!matched)
        throw new Error(`No active lease to complete: ${args.leaseId}`);
    reg.saveQueueEntries(entries);
    return { schemaVersion: 1, completed: String(args.leaseId || "") };
}
function schedReclaim(reg, args) {
    const now = schedNow(args);
    const { entries, reclaimed } = (0, scheduling_1.reclaimExpired)(reg.loadQueueEntries(), loadSchedulingPolicy(reg).policy, now);
    reg.saveQueueEntries(entries);
    return { schemaVersion: 1, now, reclaimed };
}
function schedReset(reg, args) {
    const { entries, matched } = (0, scheduling_1.resetEntry)(reg.loadQueueEntries(), String(args.id || ""));
    if (!matched)
        throw new Error(`No parked entry to reset: ${args.id}`);
    reg.saveQueueEntries(entries);
    return { schemaVersion: 1, reset: String(args.id || "") };
}
function schedPolicyShow(reg) {
    const { policy, source } = loadSchedulingPolicy(reg);
    return { schemaVersion: 1, policy, source };
}
function schedPolicySet(reg, args) {
    const current = loadSchedulingPolicy(reg).policy;
    const patch = {};
    for (const key of ["maxConcurrent", "maxAttempts", "leaseTtlMs", "backoffBaseMs", "backoffFactor", "backoffCapMs"]) {
        if (args[key] !== undefined)
            patch[key] = Number(args[key]);
    }
    const policy = (0, scheduling_1.normalizeSchedulingPolicy)({ ...current, ...patch });
    (0, state_1.writeJson)(reg.schedulingPolicyPath(), policy);
    return { schemaVersion: 1, policy, source: "file" };
}
// ---- agent delegation drive (v0.1.38) -------------------------------------
// MECHANISM, ONE SOURCE: both surfaces route drive/preview/config through these.
// The read-only preview + config-show payloads are deterministic (counts from
// state, host-stable config path) with NO now-derived numeric field, so
// `cw <cmd> --json` is byte-identical to `cw_<tool>`.
/** Read-only, deterministic preview of a run's NEXT drive step. */
function runDrivePreview(runner, args) {
    return (0, drive_1.drivePreview)(runner, String(args.runId || ""), args);
}
const DRIVE_RUNTIME_KEYS = [
    "once",
    "now",
    "preview",
    "step",
    "drive",
    "json",
    "format",
    "run",
    "runId",
    "cwd",
    "agentCommand",
    "agent-command",
    "agentArgs",
    "agent-args",
    "agentEndpoint",
    "agent-endpoint",
    "agentModel",
    "agent-model",
    "agentTimeoutMs",
    "agent-timeout-ms"
];
function planInputsFor(args) {
    const copy = withoutRuntimeKeys(args);
    for (const key of DRIVE_RUNTIME_KEYS)
        delete copy[key];
    return copy;
}
/** Mutating drive step/run. Plans a fresh run for an app id, or continues a run id.
 *  The agent hop goes ONLY through the agent backend; this composes existing verbs.
 *
 *  The run lives under its repo's `.cw/` and every runner verb resolves a run from
 *  the process cwd, so the drive operates WITH the run's repo as cwd (exactly how
 *  the golden path runs each verb from the repo dir) — then restores cwd. This lets
 *  `cw run <app> --drive --repo X` work when invoked from anywhere. */
function runDrive(runner, args) {
    const cwd0 = process.cwd();
    try {
        let runId = optionalString(args.runId || args.run);
        let repoCwd = optionalString(args.repo);
        if (!runId) {
            const appId = String(args.appId || args.workflowId || args.app || "");
            if (!appId)
                throw new Error("run --drive requires an app id (or --run <run-id> to continue)");
            const run = runner.plan(appId, planInputsFor(args));
            runId = run.id;
            repoCwd = run.cwd;
        }
        if (repoCwd && repoCwd !== process.cwd() && node_fs_1.default.existsSync(repoCwd))
            process.chdir(repoCwd);
        return (0, drive_1.drive)(runner, runId, { once: isTrue(args.once), now: optionalString(args.now), args });
    }
    finally {
        if (process.cwd() !== cwd0)
            process.chdir(cwd0);
    }
}
/** The app the one-command quickstart plans when none is named. */
exports.QUICKSTART_DEFAULT_APP = "architecture-review";
/** ONE-COMMAND quickstart (v0.1.38+): plan(app) -> run --drive -> report in a single
 *  invocation, so a newcomer gets a cited risk report from one command on a target
 *  repo. This is a THIN UX wrapper — NOT a new engine: it composes the EXISTING
 *  `runDrive` core (which already plans the run, then delegates every worker to the
 *  configured agent backend and commits) and then writes the report. It introduces
 *  no second executor, queue, or scheduler, and imports no model SDK.
 *
 *  RED LINE (DIRECTION.md): worker execution still DELEGATES to the operator's own
 *  agent backend (claude -p / codex exec / HTTP endpoint). With no agent configured
 *  the drive fails closed (status=blocked) and we never fabricate a completion. */
function quickstart(runner, args) {
    const appId = String(args.appId || args.app || args.workflowId || exports.QUICKSTART_DEFAULT_APP);
    const agentConfigured = Boolean((0, agent_config_1.resolveAgentConfig)(args).command || (0, agent_config_1.resolveAgentConfig)(args).endpoint);
    // `--preview`: read-only, deterministic next-step projection (no spawn, no commit).
    // Plan a fresh run (the read-only first verb) then project the next drive step.
    if (isTrue(args.preview)) {
        const cwd0 = process.cwd();
        try {
            let runId = optionalString(args.runId || args.run);
            let repoCwd = optionalString(args.repo);
            if (!runId) {
                const run = runner.plan(appId, planInputsFor(args));
                runId = run.id;
                repoCwd = run.cwd;
            }
            if (repoCwd && repoCwd !== process.cwd() && node_fs_1.default.existsSync(repoCwd))
                process.chdir(repoCwd);
            return (0, drive_1.drivePreview)(runner, runId, args);
        }
        finally {
            if (process.cwd() !== cwd0)
                process.chdir(cwd0);
        }
    }
    // Drive end-to-end (or one `--once` step). runDrive plans the run, delegates each
    // worker to the agent backend, and commits — we add only the report write + a
    // single assembled payload. No orchestration is duplicated here.
    const result = runDrive(runner, { ...args, appId });
    // Always (re)write the report so the one command yields a report.md on disk, even
    // when the drive blocked/parked (a partial report is still useful triage).
    const cwd0 = process.cwd();
    let reportPath = result.reportPath;
    try {
        // runDrive restored cwd, so the runs root would resolve against the CALLER's
        // cwd here — orphaning the run when quickstart is invoked cross-directory
        // (cwd = plugin dir, --repo elsewhere: the README's headline command). The
        // run's statePath (<repo>/.cw/runs/<id>/state.json) is authoritative however
        // the run was planned or continued; chdir to ITS repo BEFORE any run read.
        const runRepoCwd = node_path_1.default.resolve(node_path_1.default.dirname(result.statePath), "..", "..", "..");
        if (runRepoCwd !== process.cwd() && node_fs_1.default.existsSync(runRepoCwd))
            process.chdir(runRepoCwd);
        reportPath = runner.report(result.runId).path;
    }
    finally {
        if (process.cwd() !== cwd0)
            process.chdir(cwd0);
    }
    let hint;
    if (!agentConfigured) {
        hint =
            "agent backend not configured — set CW_AGENT_COMMAND (e.g. \"claude -p\") or pass --agent-command, then re-run. The one command DELEGATES worker execution to YOUR agent; it never executes a model itself.";
    }
    else if (result.status === "parked") {
        hint = `a worker parked past its retry budget — inspect: cw run show ${result.runId}`;
    }
    else if (result.status === "blocked") {
        hint = `the drive is blocked — inspect: cw run drive ${result.runId}`;
    }
    else if (result.status === "in-progress") {
        hint = `one step advanced (--once) — continue: cw quickstart ${appId} --run ${result.runId} --once`;
    }
    return {
        schemaVersion: 1,
        appId,
        runId: result.runId,
        workflowId: result.workflowId,
        status: result.status,
        plannedWorkers: result.plannedWorkers,
        completedWorkers: result.completedWorkers,
        parkedWorkers: result.parkedWorkers,
        commitId: result.commitId,
        reportPath,
        statePath: result.statePath,
        agentConfigured,
        steps: result.steps,
        hint
    };
}
/** Read-only, deterministic projection of the effective agent config (secret-stripped). */
function backendAgentConfigShow(args) {
    return (0, agent_config_1.agentConfigShow)(args);
}
/** Persist the durable agent config (secret-stripped) and return the new state. */
function backendAgentConfigSet(args) {
    (0, agent_config_1.setAgentConfigFile)(args);
    return (0, agent_config_1.agentConfigShow)(args);
}
// ---- run retention & provable reclamation (v0.1.39) -----------------------
// MECHANISM, ONE SOURCE: both surfaces route gc plan/run/verify through these.
// `gc plan`/`gc verify` are read-only + deterministic (only `generatedAt` is
// now-derived ISO, allowed by the parity rule); `gc run` is the disk-freeing tier.
function reclaimPolicyFrom(args) {
    const policy = {};
    const days = Number(args.reclaimAfterArchiveDays ?? args["reclaim-after-archive-days"] ?? args.olderThanDays ?? args["older-than-days"]);
    if (Number.isFinite(days))
        policy.reclaimAfterArchiveDays = days;
    const keepScratch = flag(args.keepScratch ?? args["keep-scratch"]);
    if (keepScratch !== undefined)
        policy.keepScratch = keepScratch;
    const keepSnapshots = flag(args.keepSnapshots ?? args["keep-snapshots"]);
    if (keepSnapshots !== undefined)
        policy.keepSnapshots = keepSnapshots;
    const maxRuns = Number(args.maxReclaimRuns ?? args["max-reclaim-runs"]);
    if (Number.isFinite(maxRuns))
        policy.maxReclaimRuns = maxRuns;
    const maxBytes = Number(args.maxReclaimBytes ?? args["max-reclaim-bytes"]);
    if (Number.isFinite(maxBytes))
        policy.maxReclaimBytes = maxBytes;
    const states = parseLifecycleList(args.state ?? args.status);
    if (states.length)
        policy.reclaimStates = states;
    return policy;
}
function gcPlan(reg, runId, args) {
    return reg.gcPlan({ scope: scopeOf(args, "home"), runId: runId || optionalString(args.runId), policy: reclaimPolicyFrom(args), now: optionalString(args.now) });
}
function gcRun(reg, runId, args) {
    return reg.gcRun({
        scope: scopeOf(args, "home"),
        runId: runId || optionalString(args.runId),
        policy: reclaimPolicyFrom(args),
        now: optionalString(args.now),
        actor: optionalString(args.actor),
        limit: args.limit === undefined ? undefined : Number(args.limit)
    });
}
function gcVerify(reg, runId, args) {
    return reg.gcVerify(runId, { scope: scopeOf(args, "home") });
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
// ---- observability + cost accounting (v0.1.31) ----------------------------
// MECHANISM, ONE SOURCE: both `cw metrics summary --json` and `cw_metrics_summary`
// route through this function. It enumerates the v0.1.28 registry (derived live
// from source), loads each run's durable state, and DERIVES the cross-repo
// rollup. Runs whose source is unreadable are counted in `unreadableRuns` (fail
// closed), never silently dropped. Pricing is POLICY via `--pricing`; `now` is
// injectable via `args.now` for eval/replay determinism.
function metricsSummary(reg, runner, args) {
    const scope = scopeOf(args, "repo");
    const report = reg.show({ scope });
    const policy = (0, observability_1.loadCostPolicy)(args, runner.pluginRoot);
    const now = optionalString(args.now) || new Date().toISOString();
    const inputs = [];
    let unreadableRuns = 0;
    for (const record of report.index.records) {
        try {
            const loaded = (0, state_1.loadRunStateFile)(record.statePath, { dryRun: true });
            if (loaded.report.status === "unsupported") {
                unreadableRuns++;
                continue;
            }
            inputs.push({
                run: loaded.run,
                repo: record.repo,
                persistedFingerprint: (0, observability_1.loadPersistedMetricsFingerprint)(loaded.run)
            });
        }
        catch {
            unreadableRuns++;
        }
    }
    return (0, observability_1.deriveMetricsSummary)(inputs, { now, scope, policy, unreadableRuns });
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
// ---- telemetry attestation: read-only ledger verification (Track 1) --------
// Re-prove a run's telemetry chain offline: prevHash linkage + independent per-
// record hash recompute (never trusts the stored hash). The auditable claim made
// inspectable on demand — anyone can run this; a forged/edited record fails it.
function telemetryVerify(runner, args) {
    const runId = optionalString(args.runId || args.run);
    if (!runId)
        throw new Error("telemetry verify requires a run id (cw telemetry verify <run-id>)");
    const run = runner.loadRun(runId);
    const v = (0, telemetry_ledger_1.verifyTelemetryLedger)(run);
    return {
        schemaVersion: 1,
        runId: run.id,
        present: v.present,
        verified: v.verified,
        records: v.records.length,
        attested: v.attested,
        unattested: v.unattested,
        absent: v.absent,
        failedChecks: v.checks.filter((c) => !c.pass).map((c) => ({ name: c.name, code: c.code }))
    };
}
// ---- demo: tamper-evidence (the one-command proof) -------------------------
// Hermetic, deterministic-shape: builds a real ed25519-signed telemetry ledger,
// then forges it two ways and shows both tamper-evidence layers catch it. CLI-only
// (a human-facing demonstration; the underlying verify is the telemetry.verify verb).
function demoTamper(_runner, _args = {}) {
    return (0, telemetry_demo_1.runTamperDemo)();
}
