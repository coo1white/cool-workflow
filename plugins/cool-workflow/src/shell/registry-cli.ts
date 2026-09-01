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

import * as fs from "node:fs";
import * as path from "node:path";
import { requiredNumberFlag } from "../core/util/numeric-flag";
import { RunPlanner, RunRegistry } from "./run-registry-io";
import { recordRunLink } from "./run-link-io";
import { plan as pipelinePlan } from "./pipeline";
import { loadWorkflowApp } from "./workflow-app-loader";
import { DesktopSchedulerDaemon, RoutineTriggerBridge, Scheduler } from "./scheduler-io";
import {
  gcOrphanRuns,
  gcPlan,
  gcRun,
  gcVerify,
  gcClones,
  listClones,
  listOrphanRuns,
} from "./reclamation-io";
import { runDriveStep } from "./pipeline-cli";

function resolveCwd(options: Record<string, unknown>): string {
  return path.resolve(String(options.cwd || process.cwd()));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function scopeOf(options: Record<string, unknown>, fallback: "repo" | "home"): "repo" | "home" {
  return options.scope === "repo" || options.scope === "home" ? options.scope : fallback;
}

// ---------------------------------------------------------------------
// schedule.* / cw loop
// ---------------------------------------------------------------------

export function scheduleCreateCli(options: Record<string, unknown> = {}) {
  return new Scheduler(resolveCwd(options)).create(options);
}
export function scheduleListCli(options: Record<string, unknown> = {}) {
  return new Scheduler(resolveCwd(options)).list(optionalString(options.status));
}
export function scheduleDeleteCli(id: string, options: Record<string, unknown> = {}) {
  return new Scheduler(resolveCwd(options)).delete(id);
}
export function scheduleDueCli(options: Record<string, unknown> = {}) {
  return new Scheduler(resolveCwd(options)).due();
}
export function scheduleCompleteCli(id: string, options: Record<string, unknown> = {}) {
  return new Scheduler(resolveCwd(options)).complete(id, options);
}
export function schedulePauseCli(id: string, options: Record<string, unknown> = {}) {
  return new Scheduler(resolveCwd(options)).pause(id);
}
export function scheduleResumeCli(id: string, options: Record<string, unknown> = {}) {
  return new Scheduler(resolveCwd(options)).resume(id);
}
export function scheduleRunNowCli(id: string, options: Record<string, unknown> = {}) {
  return new Scheduler(resolveCwd(options)).runNow(id);
}
export function scheduleHistoryCli(id: string | undefined, options: Record<string, unknown> = {}) {
  return new Scheduler(resolveCwd(options)).history(id);
}
export function scheduleDaemonTickCli(options: Record<string, unknown> = {}) {
  return new DesktopSchedulerDaemon({ cwd: resolveCwd(options), intervalSeconds: options.intervalSeconds ? Number(options.intervalSeconds) : options.interval ? Number(options.interval) : undefined }).tick();
}
export function scheduleDaemonRunForever(options: Record<string, unknown> = {}): Promise<void> {
  return new DesktopSchedulerDaemon({
    cwd: resolveCwd(options),
    intervalSeconds: options.intervalSeconds ? Number(options.intervalSeconds) : options.interval ? Number(options.interval) : undefined,
  }).run();
}

// ---------------------------------------------------------------------
// routine.*
// ---------------------------------------------------------------------

export function routineCreateCli(options: Record<string, unknown> = {}) {
  return new RoutineTriggerBridge(resolveCwd(options)).create(options);
}
export function routineListCli(options: Record<string, unknown> = {}) {
  return new RoutineTriggerBridge(resolveCwd(options)).list(optionalString(options.kind));
}
export function routineDeleteCli(id: string, options: Record<string, unknown> = {}) {
  return new RoutineTriggerBridge(resolveCwd(options)).delete(id);
}
export function routineFireCli(kind: string, payload: unknown, options: Record<string, unknown> = {}) {
  return new RoutineTriggerBridge(resolveCwd(options)).fire(kind, payload);
}
/** Resolves a `routine fire` payload: a `--payload-path`/positional file wins
 *  (parsed as JSON) over the raw CLI/MCP options bag. The file read lives
 *  here, in the shell layer, not in core/capability-table.ts. */
export function resolveRoutineFirePayload(payloadPath: string | undefined, options: Record<string, unknown>): unknown {
  if (!payloadPath) return options;
  try {
    return JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  } catch (e) {
    throw new Error(`Failed to parse payload file "${payloadPath}": ${String((e && (e as Error).message) || e)}`);
  }
}
export function routineEventsCli(id: string | undefined, options: Record<string, unknown> = {}) {
  return new RoutineTriggerBridge(resolveCwd(options)).events(id);
}

// ---------------------------------------------------------------------
// registry.* / run.* / queue.* / history
// ---------------------------------------------------------------------

export function registryRefreshCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(resolveCwd(options)).refresh({ scope: scopeOf(options, "repo") });
}
export function registryShowCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(resolveCwd(options)).show({ scope: scopeOf(options, "repo") });
}

export function runSearchCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(resolveCwd(options)).search({
    scope: scopeOf(options, "home"),
    text: optionalString(options.text),
    app: optionalString(options.app),
    status: optionalString(options.status) as never,
    repo: optionalString(options.repo),
    since: optionalString(options.since),
    until: optionalString(options.until),
    includeArchived: options.includeArchived === undefined ? undefined : Boolean(options.includeArchived),
    limit: requiredNumberFlag(options.limit, "--limit"),
    offset: requiredNumberFlag(options.offset, "--offset"),
  });
}
export function runListCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(resolveCwd(options)).list({
    scope: scopeOf(options, "home"),
    includeArchived: options.includeArchived === undefined ? undefined : Boolean(options.includeArchived),
    limit: requiredNumberFlag(options.limit, "--limit"),
    offset: requiredNumberFlag(options.offset, "--offset"),
  });
}
export function runShowCli(runId: string, options: Record<string, unknown> = {}) {
  return new RunRegistry(resolveCwd(options)).showRun(runId, { scope: scopeOf(options, "home") });
}
/** `run resume <run-id> [--drive|--once]` — SPEC/pipeline-run.md: default
 *  is read-only and byte-identical to the registry resume payload; with
 *  `--drive`/`--once` the SAME run (nothing re-planned) is handed to the
 *  real drive loop and the payload gains a `drive: DriveResult` field. */
export async function runResumeCli(runId: string, options: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const base = new RunRegistry(resolveCwd(options)).resume(runId, {
    scope: scopeOf(options, "home"),
    limit: requiredNumberFlag(options.limit, "--limit"),
  });
  if (!options.drive && !options.once) return base as unknown as Record<string, unknown>;
  const drive = await runDriveStep({ ...options, runId: base.runId, repo: base.repo, once: Boolean(options.once) });
  return { ...base, drive };
}
export function runArchiveCli(runId: string | undefined, options: Record<string, unknown> = {}) {
  const registry = new RunRegistry(resolveCwd(options));
  if (!runId) {
    const olderThanDays = requiredNumberFlag(options.olderThanDays ?? options["older-than-days"], "--older-than-days");
    if (olderThanDays === undefined) throw new Error("Missing run id (or --older-than-days N for the retention policy path).");
    const states = Array.isArray(options.state) ? options.state : options.state ? [options.state] : undefined;
    return registry.archiveByPolicy(
      {
        schemaVersion: 1,
        archiveOlderThanDays: olderThanDays,
        archiveStates: (states as never) || ["completed", "failed"],
        defaultQueuePriority: 100,
      },
      { scope: scopeOf(options, "home") }
    );
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
function cliRunPlanner(): RunPlanner {
  return { plan: (appId, inputs) => pipelinePlan(loadWorkflowApp(appId), inputs) };
}

export function runRerunCli(runId: string, options: Record<string, unknown> = {}) {
  return new RunRegistry(resolveCwd(options), cliRunPlanner()).rerun(runId, { reason: optionalString(options.reason), scope: scopeOf(options, "home") });
}
export function runLinkCli(runId: string, options: Record<string, unknown> = {}) {
  const url = optionalString(options.url);
  if (!url) throw new Error("Missing run link url (--url <url>)");
  return recordRunLink(
    new RunRegistry(resolveCwd(options)),
    runId,
    { url, kind: optionalString(options.kind), note: optionalString(options.note), actor: optionalString(options.actor) },
    { scope: scopeOf(options, "home") }
  );
}
export function historyCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(resolveCwd(options)).history({
    scope: scopeOf(options, "home"),
    app: optionalString(options.app),
    status: optionalString(options.status) as never,
    limit: requiredNumberFlag(options.limit, "--limit"),
    offset: requiredNumberFlag(options.offset, "--offset"),
  });
}

export function queueAddCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(resolveCwd(options)).queueAdd({
    runId: optionalString(options.runId),
    appId: optionalString(options.app || options.appId),
    workflowId: optionalString(options.workflow || options.workflowId),
    repo: optionalString(options.repo),
    priority: requiredNumberFlag(options.priority, "--priority"),
    note: optionalString(options.note),
    id: optionalString(options.id),
  });
}
export function queueListCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(resolveCwd(options)).queueList({ status: optionalString(options.status) as never, repo: optionalString(options.repo) });
}
export function queueShowCli(id: string, options: Record<string, unknown> = {}) {
  return new RunRegistry(resolveCwd(options)).queueShow(id);
}
export function queueDrainCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(resolveCwd(options)).queueDrain({
    limit: requiredNumberFlag(options.limit, "--limit"),
    repo: optionalString(options.repo),
  });
}

// ---------------------------------------------------------------------
// gc.* / orphans.* / clones.*
// ---------------------------------------------------------------------

function gcPolicyOverridesFrom(options: Record<string, unknown>) {
  const overrides: Record<string, unknown> = {};
  const reclaimAfterArchiveDays = requiredNumberFlag(options.reclaimAfterArchiveDays, "--reclaimAfterArchiveDays");
  if (reclaimAfterArchiveDays !== undefined) overrides.reclaimAfterArchiveDays = reclaimAfterArchiveDays;
  if (options.keepScratch !== undefined) overrides.keepScratch = Boolean(options.keepScratch);
  if (options["keep-scratch"] !== undefined) overrides.keepScratch = Boolean(options["keep-scratch"]);
  if (options.keepSnapshots !== undefined) overrides.keepSnapshots = Boolean(options.keepSnapshots);
  if (options["keep-snapshots"] !== undefined) overrides.keepSnapshots = Boolean(options["keep-snapshots"]);
  if (options.keepCommits !== undefined) overrides.keepCommits = Boolean(options.keepCommits);
  if (options["keep-commits"] !== undefined) overrides.keepCommits = Boolean(options["keep-commits"]);
  if (options.state !== undefined) overrides.reclaimStates = Array.isArray(options.state) ? options.state : [options.state];
  return overrides;
}

export function gcPlanCli(runId: string | undefined, options: Record<string, unknown> = {}) {
  const registry = new RunRegistry(resolveCwd(options));
  return gcPlan(registry, {
    scope: scopeOf(options, "home"),
    runId,
    policy: gcPolicyOverridesFrom(options),
    now: optionalString(options.now),
  });
}
export function gcRunCli(runId: string | undefined, options: Record<string, unknown> = {}) {
  const registry = new RunRegistry(resolveCwd(options));
  return gcRun(registry, {
    scope: scopeOf(options, "home"),
    runId,
    policy: gcPolicyOverridesFrom(options),
    now: optionalString(options.now),
    actor: optionalString(options.actor),
    limit: requiredNumberFlag(options.limit, "--limit"),
  });
}
export function gcVerifyCli(runId: string, options: Record<string, unknown> = {}) {
  const registry = new RunRegistry(resolveCwd(options));
  return gcVerify(registry, runId, { scope: scopeOf(options, "home") });
}

export function orphansListCli(options: Record<string, unknown> = {}) {
  const registry = new RunRegistry(resolveCwd(options));
  return listOrphanRuns(registry, { scope: scopeOf(options, "home"), now: optionalString(options.now) });
}
export function orphansGcCli(options: Record<string, unknown> = {}) {
  const registry = new RunRegistry(resolveCwd(options));
  return gcOrphanRuns(registry, {
    scope: scopeOf(options, "home"),
    minAgeMinutes: requiredNumberFlag(options.minAgeMinutes ?? options["min-age-minutes"], "--min-age-minutes"),
    all: Boolean(options.all),
    now: optionalString(options.now),
  });
}

export function clonesListCli(): ReturnType<typeof listClones> {
  return listClones(process.env);
}
export function clonesGcCli(options: Record<string, unknown> = {}): ReturnType<typeof gcClones> {
  return gcClones(
    { olderThanDays: options.olderThanDays ?? options["older-than-days"], all: options.all, now: options.now },
    process.env
  );
}
