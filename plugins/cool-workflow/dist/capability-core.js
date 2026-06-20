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
exports.runInspectArchive = runInspectArchive;
exports.runVerifyImport = runVerifyImport;
exports.reportBundle = reportBundle;
exports.runVerifyReportBundle = runVerifyReportBundle;
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
exports.auditVerify = auditVerify;
exports.demoTamper = demoTamper;
exports.demoBundle = demoBundle;
const drive_1 = require("./drive");
const agent_config_1 = require("./agent-config");
const run_registry_1 = require("./run-registry");
const observability_1 = require("./observability");
const telemetry_ledger_1 = require("./telemetry-ledger");
const telemetry_attestation_1 = require("./telemetry-attestation");
const trust_audit_1 = require("./trust-audit");
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
// same resolved cwd on both surfaces (CLI: --cwd|process.cwd(); MCP passes a
// resolved cwd and scopes the runner), so repo/home roots line up.
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
// F7: explicit invocation cwd — no more process.chdir bracket.
// The runner resolves a run from process.cwd() by default; to operate WITH a run's
// repo as base (run --drive --repo X from anywhere; cross-directory quickstart; run
// import/export against a target dir) we now pass that base EXPLICITLY —
// runner.withBaseDir(dir).loadRun(...) for run resolution (see
// CoolWorkflowRunner.withBaseDir), and invocationCwd(args) to anchor relative path
// args. Nothing mutates the global process.cwd(), so concurrent in-process callers
// can no longer corrupt each other's working directory (the former reentrancy hazard).
function invocationCwd(args) {
    return node_path_1.default.resolve(optionalString(args.cwd) || process.cwd());
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
function runResume(reg, runner, runId, args) {
    const base = reg.resume(runId, {
        scope: scopeOf(args, "home"),
        limit: args.limit === undefined ? undefined : Number(args.limit)
    });
    // Default (no --drive/--once): read-only, byte-identical to before.
    if (!isTrue(args.drive) && !isTrue(args.once))
        return base;
    // Opt-in continuation: hand the resolved run to the EXISTING agent-delegation
    // drive loop (re-plans nothing; picks up pending/running tasks from durable
    // state). An unconfigured agent surfaces drive.status="blocked" (fail-closed).
    const drive = runDrive(runner, { ...args, runId: base.runId, repo: base.repo, once: isTrue(args.once) });
    return { ...base, drive };
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
    const base = invocationCwd(args);
    const output = optionalString(args.output || args.path || args.archive) || `${runId}.cwrun.json`;
    // Optionally seal in the operator's PUBLIC trust key so the bundle re-verifies
    // offline. Default falls back to the same env the verify gate reads, so a single
    // configured key both attests at record-time and travels with the export.
    const trustPublicKey = optionalString(args["with-trust-key"] || args.withTrustKey || args.trustKey || args.pubkey) || process.env.CW_AGENT_ATTEST_PUBKEY;
    return (0, run_export_1.exportRun)(runner.withBaseDir(optionalString(args.cwd)).loadRun(runId), node_path_1.default.resolve(base, output), { trustPublicKey });
}
function runImportArchive(runner, args) {
    const base = invocationCwd(args);
    const archive = optionalString(args.archive || args.path || args.file);
    if (!archive)
        throw new Error("run import requires an archive path (positional, --archive, --path, or --file)");
    const target = node_path_1.default.resolve(base, optionalString(args.target || args.repo || args.cwd) || base);
    const imported = (0, run_export_1.importRun)(node_path_1.default.resolve(base, archive), target);
    const registry = new run_registry_1.RunRegistry(target, runner.withBaseDir(target));
    const registryReport = registry.refresh({ scope: "repo" });
    return { ...imported, registry: registryReport };
}
// Read-only: inspect a portable archive's integrity WITHOUT importing it. Routes
// both surfaces through one shared core entry. The runner is unused (no registry
// touch — inspection writes nothing) but kept for dispatch-signature symmetry.
function runInspectArchive(_runner, args) {
    const base = invocationCwd(args);
    const archive = optionalString(args.archive || args.path || args.file);
    if (!archive)
        throw new Error("run inspect-archive requires an archive path (positional, --archive, --path, or --file)");
    return (0, run_export_1.inspectArchive)(node_path_1.default.resolve(base, archive));
}
function runVerifyImport(runner, runId, args) {
    return (0, run_export_1.verifyImportedRun)(runner.withBaseDir(optionalString(args.cwd)).loadRun(runId));
}
// Produce-and-prove: export a run to a portable bundle sealed with the operator's
// trust key (defaulting to CW_AGENT_ATTEST_PUBKEY, same as `run export`), then
// IMMEDIATELY verify the artifact offline the way a recipient will. The producer
// learns now — fail-closed — whether the bundle a client will check is actually
// verifiable (e.g. an unconfigured attest key yields an unverifiable bundle). Pure
// composition of runExportArchive + verifyReportBundle; spawns nothing, writes only
// the archive (and, with --extract-report, the human report) that `run export` would.
function reportBundle(runner, runId, args) {
    const exported = runExportArchive(runner, runId, args);
    const base = invocationCwd(args);
    const extractReportTo = optionalString(args["extract-report"] || args.extractReport || args.extractReportTo);
    const verification = (0, run_export_1.verifyReportBundle)(exported.path, {
        pubkey: optionalString(args.pubkey || args.pubKey || args.publicKey),
        extractReportTo: extractReportTo ? node_path_1.default.resolve(base, extractReportTo) : undefined,
        strictSignatures: Boolean(args["strict-signatures"] || args.strictSignatures || args.strictSigs),
        requireSignatures: Boolean(args["require-signatures"] || args.requireSignatures || args.requireSigs)
    });
    return {
        schemaVersion: 1,
        runId,
        archivePath: exported.path,
        trustKeyEmbedded: exported.trustKeyEmbedded,
        reportExtractedTo: verification.reportExtractedTo,
        verification,
        ok: verification.ok
    };
}
// Read-only: verify a portable run bundle OFFLINE and self-contained (archive bytes
// + telemetry chain + trust-audit chain + embedded-key signatures). The runner is
// unused — verification restores into its own throwaway tmpdir and writes nothing to
// any registry — but kept for dispatch-signature symmetry with the other run verbs.
function runVerifyReportBundle(_runner, args) {
    const base = invocationCwd(args);
    const archive = optionalString(args.archive || args.path || args.file || args.bundle);
    if (!archive)
        throw new Error("report verify-bundle requires a bundle path (positional, --archive, --path, --file, or --bundle)");
    const extractReportTo = optionalString(args["extract-report"] || args.extractReport || args.extractReportTo);
    return (0, run_export_1.verifyReportBundle)(node_path_1.default.resolve(base, archive), {
        pubkey: optionalString(args.pubkey || args.pubKey || args.publicKey),
        extractReportTo: extractReportTo ? node_path_1.default.resolve(base, extractReportTo) : undefined,
        strictSignatures: Boolean(args["strict-signatures"] || args.strictSignatures || args.strictSigs),
        requireSignatures: Boolean(args["require-signatures"] || args.requireSignatures || args.requireSigs)
    });
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
    // Absent policy => conservative DEFAULT (an unconfigured backend, which §4
    // permits). But a PRESENT-but-corrupt policy must fail closed: silently
    // substituting defaults would schedule under settings the operator never
    // chose while their broken file sits on disk. Let readJson's throw surface it.
    if (node_fs_1.default.existsSync(file)) {
        return { policy: (0, scheduling_1.normalizeSchedulingPolicy)((0, state_1.readJson)(file)), source: "file" };
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
        if (args[key] === undefined)
            continue;
        // Fail closed on a non-numeric flag instead of letting normalizeSchedulingPolicy
        // silently substitute the DEFAULT (which would report source:"file" + exit 0,
        // so the operator believes they set a value they didn't). Matches the
        // Number.isFinite guard the sibling reclaimPolicyFrom already uses.
        const value = Number(args[key]);
        if (!Number.isFinite(value)) {
            throw new Error(`Invalid --${key} "${String(args[key])}": expected a number (e.g. --${key} 4)`);
        }
        patch[key] = value;
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
    "agent-timeout-ms",
    "resume"
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
    // The runner resolves the run from its baseDir, so the drive must run WITH the
    // run's repo as base. Pass it explicitly via withBaseDir (F7 — no process.chdir).
    const target = repoCwd && node_fs_1.default.existsSync(repoCwd) ? repoCwd : undefined;
    const driveRunId = runId;
    return (0, drive_1.drive)(runner.withBaseDir(target), driveRunId, {
        once: isTrue(args.once),
        now: optionalString(args.now),
        args
    });
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
    if (isTrue(args.check))
        return quickstartCheck(runner, appId, args, agentConfigured);
    // `--resume`: a discoverability flag over the existing continuation. With no
    // `--run`, advance exactly ONE step (reuse the `--once` path) and print a
    // copy-pasteable continue line; with `--run <id>`, continue that run to
    // completion (the default drive). It adds no new execution path.
    const resume = isTrue(args.resume);
    const resumeRunId = resume ? optionalString(args.runId || args.run) : undefined;
    // `--preview`: read-only, deterministic next-step projection (no spawn, no commit).
    // Plan a fresh run (the read-only first verb) then project the next drive step.
    if (isTrue(args.preview)) {
        let runId = optionalString(args.runId || args.run);
        let repoCwd = optionalString(args.repo);
        if (!runId) {
            const run = runner.plan(appId, planInputsFor(args));
            runId = run.id;
            repoCwd = run.cwd;
        }
        const previewRunId = runId;
        const target = repoCwd && node_fs_1.default.existsSync(repoCwd) ? repoCwd : undefined;
        return (0, drive_1.drivePreview)(runner.withBaseDir(target), previewRunId, args);
    }
    // Drive end-to-end (or one `--once` step). runDrive plans the run, delegates each
    // worker to the agent backend, and commits — we add only the report write + a
    // single assembled payload. No orchestration is duplicated here.
    // `--resume` with no run id advances a single step so a newcomer WITNESSES the
    // stop-then-resume; with a run id it continues to completion. Non-resume paths
    // are untouched (byte-identical default).
    const result = runDrive(runner, { ...args, appId, ...(resume && !resumeRunId ? { once: true } : {}) });
    // Always (re)write the report so the one command yields a report.md on disk, even
    // when the drive blocked/parked (a partial report is still useful triage).
    //
    // runDrive restored cwd, so the runs root would resolve against the CALLER's cwd
    // here — orphaning the run when quickstart is invoked cross-directory (cwd =
    // plugin dir, --repo elsewhere: the README's headline command). The run's
    // statePath (<repo>/.cw/runs/<id>/state.json) is authoritative however the run
    // was planned or continued; resolve to ITS repo BEFORE any run read, reentrant-safe.
    const runRepoCwd = node_path_1.default.resolve(node_path_1.default.dirname(result.statePath), "..", "..", "..");
    const reportTarget = node_fs_1.default.existsSync(runRepoCwd) ? runRepoCwd : undefined;
    const reportPath = runner.withBaseDir(reportTarget).report(result.runId).path;
    // --bundle: after a COMPLETE drive, seal the run into a portable, self-verified
    // bundle so the one command yields a client-verifiable artifact. Pure composition
    // of reportBundle() (export sealed + offline self-verify); spawns nothing. Gated on
    // completion: a partial or blocked run is NEVER sealed (you must not ship an
    // uncommitted artifact).
    //
    // Run-state resolution MUST anchor to the run's OWN repo (reportTarget): the README
    // headline runs quickstart cross-directory (caller cwd != --repo), so a caller-cwd
    // loadRun would not find the run. But operator-supplied OUTPUT paths
    // (--output/--extract-report) and the default archive name resolve against the
    // CALLER's cwd — so artifacts land where the operator ran the command (and `&&
    // send out.md` works) and never pollute the analyzed repo's working tree, matching
    // standalone `report bundle`. Pre-resolving to absolute makes path.resolve(base, …)
    // inside reportBundle a no-op, so the run-repo cwd cannot reclaim them.
    let bundle;
    const wantsBundle = flag(args.bundle) === true;
    if (wantsBundle && result.status === "complete") {
        const callerBase = invocationCwd(args);
        const outArg = optionalString(args.output || args.path || args.archive);
        const extractArg = optionalString(args["extract-report"] || args.extractReport || args.extractReportTo);
        bundle = reportBundle(runner, result.runId, {
            ...args,
            cwd: reportTarget,
            output: node_path_1.default.resolve(callerBase, outArg || `${result.runId}.cwrun.json`),
            ...(extractArg ? { "extract-report": node_path_1.default.resolve(callerBase, extractArg) } : {})
        });
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
        hint = resume
            ? `one step advanced — continue: cw quickstart ${appId} --run ${result.runId} --resume${wantsBundle ? " --bundle" : ""}`
            : `one step advanced (--once) — continue: cw quickstart ${appId} --run ${result.runId} --once`;
    }
    // --bundle on a run that didn't complete is a NO-OP, not silence: tell the operator
    // why nothing was sealed (Rule of Silence permits a human-facing hint).
    if (wantsBundle && result.status !== "complete") {
        hint = `${hint ? `${hint} ` : ""}--bundle skipped: the run did not complete (status=${result.status}); no bundle was sealed.`;
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
        hint,
        // Stamp resumedFrom ONLY when we continued an explicit run. Conditional spread
        // keeps the key absent on the default/fresh path (own-property absent + omitted
        // by JSON.stringify), so default output is byte-identical.
        ...(resumeRunId ? { resumedFrom: resumeRunId } : {}),
        // Same conditional-spread discipline: `bundle` is present only when --bundle ran
        // on a completed drive, so the default (no --bundle) payload is byte-identical.
        ...(bundle ? { bundle } : {})
    };
}
function quickstartCheck(runner, appId, args, agentConfigured) {
    const base = invocationCwd(args);
    const repoArg = optionalString(args.repo) || base;
    const repo = node_path_1.default.resolve(base, repoArg);
    const checks = [];
    try {
        runner.showApp(appId);
        checks.push({ name: "app", status: "ok", detail: `Workflow app ${appId} is available.` });
    }
    catch (error) {
        checks.push({
            name: "app",
            status: "blocked",
            detail: `Workflow app ${appId} is not available.`,
            fix: "Run `cw app list` and choose one of the listed app ids."
        });
    }
    let repoReadable = false;
    let repoStateWritable = false;
    try {
        const stat = node_fs_1.default.statSync(repo);
        repoReadable = stat.isDirectory();
        if (!repoReadable)
            throw new Error("not a directory");
        node_fs_1.default.accessSync(repo, node_fs_1.default.constants.R_OK);
        checks.push({ name: "repo", status: "ok", detail: `Repository path is readable (${repo}).` });
    }
    catch (error) {
        checks.push({
            name: "repo",
            status: "blocked",
            detail: `Repository path is not readable (${repo}).`,
            fix: "Pass --repo PATH for a readable repository directory."
        });
    }
    try {
        const cwDir = node_path_1.default.join(repo, ".cw");
        node_fs_1.default.accessSync(node_fs_1.default.existsSync(cwDir) ? cwDir : repo, node_fs_1.default.constants.W_OK);
        repoStateWritable = repoReadable;
        checks.push({ name: "repo-state", status: "ok", detail: "Run state location is writable." });
    }
    catch (error) {
        checks.push({
            name: "repo-state",
            status: "blocked",
            detail: "Run state location is not writable.",
            fix: "Use a writable repo, fix directory permissions, or pass --repo to a writable checkout."
        });
    }
    if (optionalString(args.question)) {
        checks.push({ name: "question", status: "ok", detail: "Question is set." });
    }
    else {
        checks.push({
            name: "question",
            status: "blocked",
            detail: "Question is missing.",
            fix: "Pass --question TEXT."
        });
    }
    if (agentConfigured) {
        checks.push({ name: "agent", status: "ok", detail: "Agent backend is configured." });
    }
    else {
        checks.push({
            name: "agent",
            status: "blocked",
            detail: "No agent backend is configured.",
            fix: "Pass --agent-command \"claude -p\", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude."
        });
    }
    if (flag(args.bundle) === true) {
        const trustKey = optionalString(args["with-trust-key"] || args.withTrustKey || args.trustKey || args.pubkey) || process.env.CW_AGENT_ATTEST_PUBKEY;
        if (trustKey) {
            checks.push({ name: "bundle-trust-key", status: "ok", detail: "Bundle trust public key is configured." });
        }
        else if (Boolean(args["strict-signatures"] || args.strictSignatures || args.strictSigs)) {
            checks.push({
                name: "bundle-trust-key",
                status: "blocked",
                detail: "Strict signature verification needs a public trust key.",
                fix: "Pass --with-trust-key PATH or set $CW_AGENT_ATTEST_PUBKEY."
            });
        }
        else {
            checks.push({
                name: "bundle-trust-key",
                status: "warn",
                detail: "No public trust key is configured; unsigned or unkeyed bundles may verify with reduced signature proof.",
                fix: "Pass --with-trust-key PATH to embed the public key."
            });
        }
    }
    const ok = checks.every((check) => check.status !== "blocked") && repoStateWritable;
    return {
        schemaVersion: 1,
        mode: "check",
        ok,
        appId,
        repo,
        checks,
        nextCommand: quickstartNextCommand(appId, repo, args)
    };
}
function quickstartNextCommand(appId, repo, args) {
    const parts = ["cw", "quickstart", shellWord(appId), "--repo", shellWord(repo)];
    const question = optionalString(args.question);
    if (question)
        parts.push("--question", shellWord(question));
    const command = optionalString(args.agentCommand || args["agent-command"]);
    if (command)
        parts.push("--agent-command", shellWord(command));
    if (flag(args.bundle) === true)
        parts.push("--bundle");
    const trustKey = optionalString(args["with-trust-key"] || args.withTrustKey || args.trustKey);
    if (trustKey)
        parts.push("--with-trust-key", shellWord(trustKey));
    if (Boolean(args["strict-signatures"] || args.strictSignatures || args.strictSigs))
        parts.push("--strict-signatures");
    return parts.join(" ");
}
function shellWord(value) {
    if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value))
        return value;
    return `'${value.replace(/'/g, "'\\''")}'`;
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
    // Opt-in independent signature re-verification. verifyTelemetryLedger re-proves
    // the chain (so the stored attestation verdicts were not edited); supplying the
    // trust public key (--pubkey / CW_AGENT_ATTEST_PUBKEY) additionally RE-RUNS the
    // ed25519 check over each `attested` record's stored raw usage rather than
    // trusting that verdict, so a forged signature can no longer ride a green chain.
    const trustPublicKeyInput = optionalString(args.pubkey || args.pubKey || args.publicKey) || process.env.CW_AGENT_ATTEST_PUBKEY;
    const trustPublicKey = (0, telemetry_attestation_1.resolveTrustPublicKey)(trustPublicKeyInput);
    const keyChecks = trustPublicKeyInput && !trustPublicKey
        ? [{ name: "signature-key", pass: false, code: "telemetry-pubkey-unreadable" }]
        : [];
    const sig = (0, telemetry_attestation_1.verifyTelemetrySignatures)(v.records, trustPublicKey);
    const failedChecks = [...v.checks.filter((c) => !c.pass), ...keyChecks, ...sig.checks.filter((c) => !c.pass)];
    return {
        schemaVersion: 1,
        runId: run.id,
        present: v.present,
        // Chain integrity AND (when a key was supplied) every attested signature must
        // re-verify. With no key, sig.failed is 0 → unchanged chain-only behavior.
        verified: v.verified && keyChecks.length === 0 && sig.failed === 0,
        records: v.records.length,
        attested: v.attested,
        unattested: v.unattested,
        absent: v.absent,
        signatureKeyProvided: sig.keyProvided,
        signaturesChecked: sig.checked,
        signaturesReverified: sig.reverified,
        signaturesFailed: sig.failed,
        failedChecks: failedChecks.map((c) => ({ name: c.name, code: c.code }))
    };
}
// audit.verify — fail-closed re-prove of a run's trust-audit hash chain. The peer
// of telemetry.verify for the sandbox/policy/commit-gate decision log: recomputes
// every event hash from genesis, checks chain linkage, and catches the
// unchained-event forgery. Exposed as a verb (not just embedded in `audit summary`,
// which always exits 0) so `cw audit verify <run> && deploy` can gate on the exit
// code. POLA: a run with no audit log is present:false / verified:true / exit 0.
function auditVerify(runner, args) {
    const runId = optionalString(args.runId || args.run);
    if (!runId)
        throw new Error("audit verify requires a run id (cw audit verify <run-id>)");
    const run = runner.loadRun(runId);
    const v = (0, trust_audit_1.verifyTrustAudit)(run);
    return {
        schemaVersion: 1,
        runId: run.id,
        present: v.present,
        verified: v.verified,
        eventCount: v.eventCount,
        chained: v.chained,
        unchained: v.unchained,
        corruptLines: v.corruptLines,
        failedChecks: v.checks.filter((c) => !c.pass).map((c) => ({ name: c.name, code: c.code }))
    };
}
// ---- demo: tamper-evidence (the one-command proof) -------------------------
// Hermetic, deterministic-shape: builds a real ed25519-signed telemetry ledger,
// then forges it three ways and shows all three tamper-evidence layers (ledger,
// signature, result) catch it. CLI-only
// (a human-facing demonstration; the underlying verify is the telemetry.verify verb).
function demoTamper(_runner, _args = {}) {
    return (0, telemetry_demo_1.runTamperDemo)();
}
function demoBundle(_runner, _args = {}) {
    return (0, telemetry_demo_1.runBundleDemo)();
}
