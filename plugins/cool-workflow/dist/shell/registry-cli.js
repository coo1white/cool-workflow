"use strict";
// shell/registry-cli.ts — CLI/MCP-reachable bodies for the milestone-10
// capability rows: schedule.*, routine.*, registry.*, run.search|list|
// show|resume|archive|rerun, queue.*, sched.*, gc.*, orphans.*, clones.*,
// history.
//
// MILESTONE 10. Byte-exact port of the old build's
// src/cli/handlers/{scheduling,registry,maintenance,orphans,clones}.ts +
// the run-registry-owned slice of src/capability-core.ts. Impure (fs) —
// this is the shell layer the capability-table's CLI/MCP handlers
// delegate to.
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
exports.scheduleCreateCli = scheduleCreateCli;
exports.scheduleListCli = scheduleListCli;
exports.scheduleDeleteCli = scheduleDeleteCli;
exports.scheduleDueCli = scheduleDueCli;
exports.scheduleCompleteCli = scheduleCompleteCli;
exports.schedulePauseCli = schedulePauseCli;
exports.scheduleResumeCli = scheduleResumeCli;
exports.scheduleRunNowCli = scheduleRunNowCli;
exports.scheduleHistoryCli = scheduleHistoryCli;
exports.scheduleDaemonTickCli = scheduleDaemonTickCli;
exports.scheduleDaemonRunForever = scheduleDaemonRunForever;
exports.routineCreateCli = routineCreateCli;
exports.routineListCli = routineListCli;
exports.routineDeleteCli = routineDeleteCli;
exports.routineFireCli = routineFireCli;
exports.resolveRoutineFirePayload = resolveRoutineFirePayload;
exports.routineEventsCli = routineEventsCli;
exports.registryRefreshCli = registryRefreshCli;
exports.registryShowCli = registryShowCli;
exports.runSearchCli = runSearchCli;
exports.runListCli = runListCli;
exports.runShowCli = runShowCli;
exports.runResumeCli = runResumeCli;
exports.runArchiveCli = runArchiveCli;
exports.runRerunCli = runRerunCli;
exports.historyCli = historyCli;
exports.queueAddCli = queueAddCli;
exports.queueListCli = queueListCli;
exports.queueShowCli = queueShowCli;
exports.queueDrainCli = queueDrainCli;
exports.gcPlanCli = gcPlanCli;
exports.gcRunCli = gcRunCli;
exports.gcVerifyCli = gcVerifyCli;
exports.orphansListCli = orphansListCli;
exports.orphansGcCli = orphansGcCli;
exports.clonesListCli = clonesListCli;
exports.clonesGcCli = clonesGcCli;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const numeric_flag_1 = require("../core/util/numeric-flag");
const run_registry_io_1 = require("./run-registry-io");
const pipeline_1 = require("./pipeline");
const workflow_app_loader_1 = require("./workflow-app-loader");
const scheduler_io_1 = require("./scheduler-io");
const reclamation_io_1 = require("./reclamation-io");
const pipeline_cli_1 = require("./pipeline-cli");
function resolveCwd(options) {
    return path.resolve(String(options.cwd || process.cwd()));
}
function optionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function scopeOf(options, fallback) {
    return options.scope === "repo" || options.scope === "home" ? options.scope : fallback;
}
// ---------------------------------------------------------------------
// schedule.* / cw loop
// ---------------------------------------------------------------------
function scheduleCreateCli(options = {}) {
    return new scheduler_io_1.Scheduler(resolveCwd(options)).create(options);
}
function scheduleListCli(options = {}) {
    return new scheduler_io_1.Scheduler(resolveCwd(options)).list(optionalString(options.status));
}
function scheduleDeleteCli(id, options = {}) {
    return new scheduler_io_1.Scheduler(resolveCwd(options)).delete(id);
}
function scheduleDueCli(options = {}) {
    return new scheduler_io_1.Scheduler(resolveCwd(options)).due();
}
function scheduleCompleteCli(id, options = {}) {
    return new scheduler_io_1.Scheduler(resolveCwd(options)).complete(id, options);
}
function schedulePauseCli(id, options = {}) {
    return new scheduler_io_1.Scheduler(resolveCwd(options)).pause(id);
}
function scheduleResumeCli(id, options = {}) {
    return new scheduler_io_1.Scheduler(resolveCwd(options)).resume(id);
}
function scheduleRunNowCli(id, options = {}) {
    return new scheduler_io_1.Scheduler(resolveCwd(options)).runNow(id);
}
function scheduleHistoryCli(id, options = {}) {
    return new scheduler_io_1.Scheduler(resolveCwd(options)).history(id);
}
function scheduleDaemonTickCli(options = {}) {
    return new scheduler_io_1.DesktopSchedulerDaemon({ cwd: resolveCwd(options), intervalSeconds: options.intervalSeconds ? Number(options.intervalSeconds) : options.interval ? Number(options.interval) : undefined }).tick();
}
function scheduleDaemonRunForever(options = {}) {
    return new scheduler_io_1.DesktopSchedulerDaemon({
        cwd: resolveCwd(options),
        intervalSeconds: options.intervalSeconds ? Number(options.intervalSeconds) : options.interval ? Number(options.interval) : undefined,
    }).run();
}
// ---------------------------------------------------------------------
// routine.*
// ---------------------------------------------------------------------
function routineCreateCli(options = {}) {
    return new scheduler_io_1.RoutineTriggerBridge(resolveCwd(options)).create(options);
}
function routineListCli(options = {}) {
    return new scheduler_io_1.RoutineTriggerBridge(resolveCwd(options)).list(optionalString(options.kind));
}
function routineDeleteCli(id, options = {}) {
    return new scheduler_io_1.RoutineTriggerBridge(resolveCwd(options)).delete(id);
}
function routineFireCli(kind, payload, options = {}) {
    return new scheduler_io_1.RoutineTriggerBridge(resolveCwd(options)).fire(kind, payload);
}
/** Resolves a `routine fire` payload: a `--payload-path`/positional file wins
 *  (parsed as JSON) over the raw CLI/MCP options bag. The file read lives
 *  here, in the shell layer, not in core/capability-table.ts. */
function resolveRoutineFirePayload(payloadPath, options) {
    if (!payloadPath)
        return options;
    try {
        return JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    }
    catch (e) {
        throw new Error(`Failed to parse payload file "${payloadPath}": ${String((e && e.message) || e)}`);
    }
}
function routineEventsCli(id, options = {}) {
    return new scheduler_io_1.RoutineTriggerBridge(resolveCwd(options)).events(id);
}
// ---------------------------------------------------------------------
// registry.* / run.* / queue.* / history
// ---------------------------------------------------------------------
function registryRefreshCli(options = {}) {
    return new run_registry_io_1.RunRegistry(resolveCwd(options)).refresh({ scope: scopeOf(options, "repo") });
}
function registryShowCli(options = {}) {
    return new run_registry_io_1.RunRegistry(resolveCwd(options)).show({ scope: scopeOf(options, "repo") });
}
function runSearchCli(options = {}) {
    return new run_registry_io_1.RunRegistry(resolveCwd(options)).search({
        scope: scopeOf(options, "home"),
        text: optionalString(options.text),
        app: optionalString(options.app),
        status: optionalString(options.status),
        repo: optionalString(options.repo),
        since: optionalString(options.since),
        until: optionalString(options.until),
        includeArchived: options.includeArchived === undefined ? undefined : Boolean(options.includeArchived),
        limit: (0, numeric_flag_1.requiredNumberFlag)(options.limit, "--limit"),
        offset: (0, numeric_flag_1.requiredNumberFlag)(options.offset, "--offset"),
    });
}
function runListCli(options = {}) {
    return new run_registry_io_1.RunRegistry(resolveCwd(options)).list({
        scope: scopeOf(options, "home"),
        includeArchived: options.includeArchived === undefined ? undefined : Boolean(options.includeArchived),
        limit: (0, numeric_flag_1.requiredNumberFlag)(options.limit, "--limit"),
        offset: (0, numeric_flag_1.requiredNumberFlag)(options.offset, "--offset"),
    });
}
function runShowCli(runId, options = {}) {
    return new run_registry_io_1.RunRegistry(resolveCwd(options)).showRun(runId, { scope: scopeOf(options, "home") });
}
/** `run resume <run-id> [--drive|--once]` — SPEC/pipeline-run.md: default
 *  is read-only and byte-identical to the registry resume payload; with
 *  `--drive`/`--once` the SAME run (nothing re-planned) is handed to the
 *  real drive loop and the payload gains a `drive: DriveResult` field. */
async function runResumeCli(runId, options = {}) {
    const base = new run_registry_io_1.RunRegistry(resolveCwd(options)).resume(runId, {
        scope: scopeOf(options, "home"),
        limit: (0, numeric_flag_1.requiredNumberFlag)(options.limit, "--limit"),
    });
    if (!options.drive && !options.once)
        return base;
    const drive = await (0, pipeline_cli_1.runDriveStep)({ ...options, runId: base.runId, repo: base.repo, once: Boolean(options.once) });
    return { ...base, drive };
}
function runArchiveCli(runId, options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    if (!runId) {
        const olderThanDays = (0, numeric_flag_1.requiredNumberFlag)(options.olderThanDays ?? options["older-than-days"], "--older-than-days");
        if (olderThanDays === undefined)
            throw new Error("Missing run id (or --older-than-days N for the retention policy path).");
        const states = Array.isArray(options.state) ? options.state : options.state ? [options.state] : undefined;
        return registry.archiveByPolicy({
            schemaVersion: 1,
            archiveOlderThanDays: olderThanDays,
            archiveStates: states || ["completed", "failed"],
            defaultQueuePriority: 100,
        }, { scope: scopeOf(options, "home") });
    }
    return registry.archive(runId, {
        reason: optionalString(options.reason),
        scope: scopeOf(options, "home"),
        unarchive: Boolean(options.unarchive),
    });
}
/** The CLI/MCP-path run planner: the old build injected the CoolWorkflowRunner
 *  (its `.plan(appId, inputs)`) as RunRegistry's planner so `cw run rerun` /
 *  `cw_run_rerun` could plan the new linked run. v2 dismantled that facade, so
 *  we rebuild the same `.plan(appId, inputs)` surface from the two pieces that
 *  replaced it: resolve the app object with loadWorkflowApp, then hand it to the
 *  pure pipeline plan(). Without this, RunRegistry.rerun throws
 *  "rerun requires a run planner (CoolWorkflowRunner)". */
function cliRunPlanner() {
    return { plan: (appId, inputs) => (0, pipeline_1.plan)((0, workflow_app_loader_1.loadWorkflowApp)(appId), inputs) };
}
function runRerunCli(runId, options = {}) {
    return new run_registry_io_1.RunRegistry(resolveCwd(options), cliRunPlanner()).rerun(runId, { reason: optionalString(options.reason), scope: scopeOf(options, "home") });
}
function historyCli(options = {}) {
    return new run_registry_io_1.RunRegistry(resolveCwd(options)).history({
        scope: scopeOf(options, "home"),
        app: optionalString(options.app),
        status: optionalString(options.status),
        limit: (0, numeric_flag_1.requiredNumberFlag)(options.limit, "--limit"),
        offset: (0, numeric_flag_1.requiredNumberFlag)(options.offset, "--offset"),
    });
}
function queueAddCli(options = {}) {
    return new run_registry_io_1.RunRegistry(resolveCwd(options)).queueAdd({
        runId: optionalString(options.runId),
        appId: optionalString(options.app || options.appId),
        workflowId: optionalString(options.workflow || options.workflowId),
        repo: optionalString(options.repo),
        priority: (0, numeric_flag_1.requiredNumberFlag)(options.priority, "--priority"),
        note: optionalString(options.note),
        id: optionalString(options.id),
    });
}
function queueListCli(options = {}) {
    return new run_registry_io_1.RunRegistry(resolveCwd(options)).queueList({ status: optionalString(options.status), repo: optionalString(options.repo) });
}
function queueShowCli(id, options = {}) {
    return new run_registry_io_1.RunRegistry(resolveCwd(options)).queueShow(id);
}
function queueDrainCli(options = {}) {
    return new run_registry_io_1.RunRegistry(resolveCwd(options)).queueDrain({
        limit: (0, numeric_flag_1.requiredNumberFlag)(options.limit, "--limit"),
        repo: optionalString(options.repo),
    });
}
// ---------------------------------------------------------------------
// gc.* / orphans.* / clones.*
// ---------------------------------------------------------------------
function gcPolicyOverridesFrom(options) {
    const overrides = {};
    const reclaimAfterArchiveDays = (0, numeric_flag_1.requiredNumberFlag)(options.reclaimAfterArchiveDays, "--reclaimAfterArchiveDays");
    if (reclaimAfterArchiveDays !== undefined)
        overrides.reclaimAfterArchiveDays = reclaimAfterArchiveDays;
    if (options.keepScratch !== undefined)
        overrides.keepScratch = Boolean(options.keepScratch);
    if (options["keep-scratch"] !== undefined)
        overrides.keepScratch = Boolean(options["keep-scratch"]);
    if (options.keepSnapshots !== undefined)
        overrides.keepSnapshots = Boolean(options.keepSnapshots);
    if (options["keep-snapshots"] !== undefined)
        overrides.keepSnapshots = Boolean(options["keep-snapshots"]);
    if (options.keepCommits !== undefined)
        overrides.keepCommits = Boolean(options.keepCommits);
    if (options["keep-commits"] !== undefined)
        overrides.keepCommits = Boolean(options["keep-commits"]);
    if (options.state !== undefined)
        overrides.reclaimStates = Array.isArray(options.state) ? options.state : [options.state];
    return overrides;
}
function gcPlanCli(runId, options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    return (0, reclamation_io_1.gcPlan)(registry, {
        scope: scopeOf(options, "home"),
        runId,
        policy: gcPolicyOverridesFrom(options),
        now: optionalString(options.now),
    });
}
function gcRunCli(runId, options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    return (0, reclamation_io_1.gcRun)(registry, {
        scope: scopeOf(options, "home"),
        runId,
        policy: gcPolicyOverridesFrom(options),
        now: optionalString(options.now),
        actor: optionalString(options.actor),
        limit: (0, numeric_flag_1.requiredNumberFlag)(options.limit, "--limit"),
    });
}
function gcVerifyCli(runId, options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    return (0, reclamation_io_1.gcVerify)(registry, runId, { scope: scopeOf(options, "home") });
}
function orphansListCli(options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    return (0, reclamation_io_1.listOrphanRuns)(registry, { scope: scopeOf(options, "home"), now: optionalString(options.now) });
}
function orphansGcCli(options = {}) {
    const registry = new run_registry_io_1.RunRegistry(resolveCwd(options));
    return (0, reclamation_io_1.gcOrphanRuns)(registry, {
        scope: scopeOf(options, "home"),
        minAgeMinutes: (0, numeric_flag_1.requiredNumberFlag)(options.minAgeMinutes ?? options["min-age-minutes"], "--min-age-minutes"),
        all: Boolean(options.all),
        now: optionalString(options.now),
    });
}
function clonesListCli() {
    return (0, reclamation_io_1.listClones)(process.env);
}
function clonesGcCli(options = {}) {
    return (0, reclamation_io_1.gcClones)({ olderThanDays: options.olderThanDays ?? options["older-than-days"], all: options.all, now: options.now }, process.env);
}
