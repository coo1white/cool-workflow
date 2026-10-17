// shell/registry-cli.ts — CLI/MCP-reachable bodies for the capability
// capability rows: schedule.*, routine.*, registry.*, run.search|list|
// show|resume|archive|rerun, queue.*, sched.*, gc.*, orphans.*, clones.*,
// history.
//
// Impure (fs) — this is the shell layer the capability-table's CLI/MCP
// handlers delegate to.
import * as fs from "node:fs";
import { cwdArg, optionalArg } from "../core/util/cli-args.js";
import { requiredNumberFlag } from "../core/util/numeric-flag.js";
import { RunRegistry } from "./run-registry-io.js";
import { recordRunLink } from "./run-link-io.js";
import { plan as pipelinePlan } from "./pipeline.js";
import { loadWorkflowApp } from "./workflow-app-loader.js";
import { DesktopSchedulerDaemon, RoutineTriggerBridge, Scheduler } from "./scheduler-io.js";
import { gcOrphanRuns, gcPlan, gcRun, gcVerify, gcClones, listClones, listOrphanRuns, } from "./reclamation-io.js";
import { runDriveStep } from "./pipeline-cli.js";
function scopeOf(options, fallback) {
    return options.scope === "repo" || options.scope === "home" ? options.scope : fallback;
}
// ---------------------------------------------------------------------
// schedule.* / cw loop
// ---------------------------------------------------------------------
export function scheduleCreateCli(options = {}) {
    return new Scheduler(cwdArg(options, ["cwd", "repo"], true)).create(options);
}
export function scheduleListCli(options = {}) {
    return new Scheduler(cwdArg(options, ["cwd", "repo"], true)).list(optionalArg(options.status));
}
export function scheduleDeleteCli(id, options = {}) {
    return new Scheduler(cwdArg(options, ["cwd", "repo"], true)).delete(id);
}
export function scheduleDueCli(options = {}) {
    return new Scheduler(cwdArg(options, ["cwd", "repo"], true)).due();
}
export function scheduleCompleteCli(id, options = {}) {
    return new Scheduler(cwdArg(options, ["cwd", "repo"], true)).complete(id, options);
}
export function schedulePauseCli(id, options = {}) {
    return new Scheduler(cwdArg(options, ["cwd", "repo"], true)).pause(id);
}
export function scheduleResumeCli(id, options = {}) {
    return new Scheduler(cwdArg(options, ["cwd", "repo"], true)).resume(id);
}
export function scheduleRunNowCli(id, options = {}) {
    return new Scheduler(cwdArg(options, ["cwd", "repo"], true)).runNow(id);
}
export function scheduleHistoryCli(id, options = {}) {
    return new Scheduler(cwdArg(options, ["cwd", "repo"], true)).history(id);
}
export function scheduleDaemonTickCli(options = {}) {
    return new DesktopSchedulerDaemon({ cwd: cwdArg(options, ["cwd", "repo"], true), intervalSeconds: options.intervalSeconds ? Number(options.intervalSeconds) : options.interval ? Number(options.interval) : undefined }).tick();
}
export function scheduleDaemonRunForever(options = {}) {
    return new DesktopSchedulerDaemon({
        cwd: cwdArg(options, ["cwd", "repo"], true),
        intervalSeconds: options.intervalSeconds ? Number(options.intervalSeconds) : options.interval ? Number(options.interval) : undefined,
    }).run();
}
// ---------------------------------------------------------------------
// routine.*
// ---------------------------------------------------------------------
export function routineCreateCli(options = {}) {
    return new RoutineTriggerBridge(cwdArg(options, ["cwd", "repo"], true)).create(options);
}
export function routineListCli(options = {}) {
    return new RoutineTriggerBridge(cwdArg(options, ["cwd", "repo"], true)).list(optionalArg(options.kind));
}
export function routineDeleteCli(id, options = {}) {
    return new RoutineTriggerBridge(cwdArg(options, ["cwd", "repo"], true)).delete(id);
}
export function routineFireCli(kind, payload, options = {}) {
    return new RoutineTriggerBridge(cwdArg(options, ["cwd", "repo"], true)).fire(kind, payload);
}
/** Resolves a `routine fire` payload: a `--payload-path`/positional file wins
 *  (parsed as JSON) over the raw CLI/MCP options bag. The file read lives
 *  here, in the shell layer, not in core/capability-table.ts. */
export function resolveRoutineFirePayload(payloadPath, options) {
    if (!payloadPath)
        return options;
    try {
        return JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    }
    catch (e) {
        throw new Error(`Failed to parse payload file "${payloadPath}": ${String((e && e.message) || e)}`);
    }
}
export function routineEventsCli(id, options = {}) {
    return new RoutineTriggerBridge(cwdArg(options, ["cwd", "repo"], true)).events(id);
}
// ---------------------------------------------------------------------
// registry.* / run.* / queue.* / history
// ---------------------------------------------------------------------
export function registryRefreshCli(options = {}) {
    return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).refresh({ scope: scopeOf(options, "repo") });
}
export function registryShowCli(options = {}) {
    return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).show({ scope: scopeOf(options, "repo") });
}
export function runSearchCli(options = {}) {
    return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).search({
        scope: scopeOf(options, "home"),
        text: optionalArg(options.text),
        app: optionalArg(options.app),
        status: optionalArg(options.status),
        repo: optionalArg(options.repo),
        since: optionalArg(options.since),
        until: optionalArg(options.until),
        includeArchived: options.includeArchived === undefined ? undefined : Boolean(options.includeArchived),
        limit: requiredNumberFlag(options.limit, "--limit"),
        offset: requiredNumberFlag(options.offset, "--offset"),
    });
}
export function runListCli(options = {}) {
    return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).list({
        scope: scopeOf(options, "home"),
        includeArchived: options.includeArchived === undefined ? undefined : Boolean(options.includeArchived),
        limit: requiredNumberFlag(options.limit, "--limit"),
        offset: requiredNumberFlag(options.offset, "--offset"),
    });
}
export function runShowCli(runId, options = {}) {
    return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).showRun(runId, { scope: scopeOf(options, "home") });
}
/** `run resume <run-id> [--drive|--once]` — SPEC/pipeline-run.md: default
 *  is read-only and byte-identical to the registry resume payload; with
 *  `--drive`/`--once` the SAME run (nothing re-planned) is handed to the
 *  real drive loop and the payload gains a `drive: DriveResult` field. */
export async function runResumeCli(runId, options = {}) {
    // A folder named with --cwd/--repo (and no explicit --scope) holds the
    // lookup to that folder: no quiet registry-wide fallback. With no folder
    // named, or with --scope home given, resume finds the run by id across the
    // registry as before.
    const namedBy = options.scope === undefined ? (optionalArg(options.cwd) ? "--cwd" : optionalArg(options.repo) ? "--repo" : undefined) : undefined;
    const base = new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).resume(runId, {
        scope: scopeOf(options, "home"),
        limit: requiredNumberFlag(options.limit, "--limit"),
        namedBy,
    });
    if (!options.drive && !options.once)
        return base;
    const drive = await runDriveStep({ ...options, runId: base.runId, repo: base.repo, once: Boolean(options.once) }, { reopenParked: true });
    return { ...base, drive };
}
export function runArchiveCli(runId, options = {}) {
    const registry = new RunRegistry(cwdArg(options, ["cwd", "repo"], true));
    if (!runId) {
        const olderThanDays = requiredNumberFlag(options.olderThanDays ?? options["older-than-days"], "--older-than-days");
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
        reason: optionalArg(options.reason),
        scope: scopeOf(options, "home"),
        unarchive: Boolean(options.unarchive),
    });
}
/** The CLI/MCP-path run planner RunRegistry needs so `cw run rerun` /
 *  `cw_run_rerun` can plan the new linked run: a `.plan(appId, inputs)`
 *  surface built from loadWorkflowApp (resolve the app object) and the
 *  pure pipeline plan(). Without it, RunRegistry.rerun throws "rerun
 *  requires a run planner (CoolWorkflowRunner)". */
function cliRunPlanner() {
    return { plan: (appId, inputs) => pipelinePlan(loadWorkflowApp(appId), inputs) };
}
export function runRerunCli(runId, options = {}) {
    return new RunRegistry(cwdArg(options, ["cwd", "repo"], true), cliRunPlanner()).rerun(runId, { reason: optionalArg(options.reason), scope: scopeOf(options, "home") });
}
export function runLinkCli(runId, options = {}) {
    const url = optionalArg(options.url);
    if (!url)
        throw new Error("Missing run link url (--url <url>)");
    return recordRunLink(new RunRegistry(cwdArg(options, ["cwd", "repo"], true)), runId, { url, kind: optionalArg(options.kind), note: optionalArg(options.note), actor: optionalArg(options.actor) }, { scope: scopeOf(options, "home") });
}
export function historyCli(options = {}) {
    return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).history({
        scope: scopeOf(options, "home"),
        app: optionalArg(options.app),
        status: optionalArg(options.status),
        limit: requiredNumberFlag(options.limit, "--limit"),
        offset: requiredNumberFlag(options.offset, "--offset"),
    });
}
export function queueAddCli(options = {}) {
    return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).queueAdd({
        runId: optionalArg(options.runId),
        appId: optionalArg(options.app || options.appId),
        workflowId: optionalArg(options.workflow || options.workflowId),
        repo: optionalArg(options.repo),
        priority: requiredNumberFlag(options.priority, "--priority"),
        note: optionalArg(options.note),
        id: optionalArg(options.id),
    });
}
export function queueListCli(options = {}) {
    return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).queueList({ status: optionalArg(options.status), repo: optionalArg(options.repo) });
}
export function queueShowCli(id, options = {}) {
    return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).queueShow(id);
}
export function queueDrainCli(options = {}) {
    return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).queueDrain({
        limit: requiredNumberFlag(options.limit, "--limit"),
        repo: optionalArg(options.repo),
    });
}
// ---------------------------------------------------------------------
// gc.* / orphans.* / clones.*
// ---------------------------------------------------------------------
function gcPolicyOverridesFrom(options) {
    const overrides = {};
    const reclaimAfterArchiveDays = requiredNumberFlag(options.reclaimAfterArchiveDays, "--reclaimAfterArchiveDays");
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
export function gcPlanCli(runId, options = {}) {
    const registry = new RunRegistry(cwdArg(options, ["cwd", "repo"], true));
    return gcPlan(registry, {
        scope: scopeOf(options, "home"),
        runId,
        policy: gcPolicyOverridesFrom(options),
        now: optionalArg(options.now),
    });
}
export function gcRunCli(runId, options = {}) {
    const registry = new RunRegistry(cwdArg(options, ["cwd", "repo"], true));
    return gcRun(registry, {
        scope: scopeOf(options, "home"),
        runId,
        policy: gcPolicyOverridesFrom(options),
        now: optionalArg(options.now),
        actor: optionalArg(options.actor),
        limit: requiredNumberFlag(options.limit, "--limit"),
    });
}
export function gcVerifyCli(runId, options = {}) {
    const registry = new RunRegistry(cwdArg(options, ["cwd", "repo"], true));
    return gcVerify(registry, runId, { scope: scopeOf(options, "home") });
}
export function orphansListCli(options = {}) {
    const registry = new RunRegistry(cwdArg(options, ["cwd", "repo"], true));
    return listOrphanRuns(registry, { scope: scopeOf(options, "home"), now: optionalArg(options.now) });
}
export function orphansGcCli(options = {}) {
    const registry = new RunRegistry(cwdArg(options, ["cwd", "repo"], true));
    return gcOrphanRuns(registry, {
        scope: scopeOf(options, "home"),
        minAgeMinutes: requiredNumberFlag(options.minAgeMinutes ?? options["min-age-minutes"], "--min-age-minutes"),
        all: Boolean(options.all),
        now: optionalArg(options.now),
    });
}
export function clonesListCli() {
    return listClones(process.env);
}
export function clonesGcCli(options = {}) {
    return gcClones({ olderThanDays: options.olderThanDays ?? options["older-than-days"], all: options.all, now: options.now }, process.env);
}
