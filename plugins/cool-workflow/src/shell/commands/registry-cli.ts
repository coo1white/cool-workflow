// shell/commands/registry-cli.ts — CLI/MCP-reachable bodies for the capability
// rows registry.*, run.search|list|show|resume|archive|rerun|
// link, queue.*, history.
//
// Impure (fs, via RunRegistry) — this is the shell layer the capability-table's CLI/MCP
// handlers delegate to.

import { cwdArg, optionalArg } from "../../core/util/cli-args.js";
import { requiredNumberFlag } from "../../core/util/numeric-flag.js";
import { RunPlanner, RunRegistry } from "../run-registry-io.js";
import { recordRunLink } from "../run-link-io.js";
import { plan as pipelinePlan } from "../pipeline.js";
import { loadWorkflowApp } from "../workflow-app-loader.js";
import { runDriveStep } from "./pipeline-cli.js";

function scopeOf(options: Record<string, unknown>, fallback: "repo" | "home"): "repo" | "home" {
  return options.scope === "repo" || options.scope === "home" ? options.scope : fallback;
}

// ---------------------------------------------------------------------
// registry.* / run.* / queue.* / history
// ---------------------------------------------------------------------

export function registryRefreshCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).refresh({ scope: scopeOf(options, "repo") });
}
export function registryShowCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).show({ scope: scopeOf(options, "repo") });
}

export function runSearchCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).search({
    scope: scopeOf(options, "home"),
    text: optionalArg(options.text),
    app: optionalArg(options.app),
    status: optionalArg(options.status) as never,
    repo: optionalArg(options.repo),
    since: optionalArg(options.since),
    until: optionalArg(options.until),
    includeArchived: options.includeArchived === undefined ? undefined : Boolean(options.includeArchived),
    limit: requiredNumberFlag(options.limit, "--limit"),
    offset: requiredNumberFlag(options.offset, "--offset"),
  });
}
export function runListCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).list({
    scope: scopeOf(options, "home"),
    includeArchived: options.includeArchived === undefined ? undefined : Boolean(options.includeArchived),
    limit: requiredNumberFlag(options.limit, "--limit"),
    offset: requiredNumberFlag(options.offset, "--offset"),
  });
}
export function runShowCli(runId: string, options: Record<string, unknown> = {}) {
  return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).showRun(runId, { scope: scopeOf(options, "home") });
}
/** `run resume <run-id> [--drive|--once]` — SPEC/pipeline-run.md: default
 *  is read-only and byte-identical to the registry resume payload; with
 *  `--drive`/`--once` the SAME run (nothing re-planned) is handed to the
 *  real drive loop and the payload gains a `drive: DriveResult` field. */
export async function runResumeCli(runId: string, options: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
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
  if (!options.drive && !options.once) return base as unknown as Record<string, unknown>;
  const drive = await runDriveStep({ ...options, runId: base.runId, repo: base.repo, once: Boolean(options.once) }, { reopenParked: true });
  return { ...base, drive };
}
export function runArchiveCli(runId: string | undefined, options: Record<string, unknown> = {}) {
  const registry = new RunRegistry(cwdArg(options, ["cwd", "repo"], true));
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
    reason: optionalArg(options.reason),
    scope: scopeOf(options, "home"),
    unarchive: Boolean(options.unarchive),
  });
}
/** The CLI/MCP-path run planner RunRegistry needs so `cw run rerun` /
 *  `cw_run_rerun` can plan the new linked run: a `.plan(appId, inputs)`
 *  surface built from loadWorkflowApp (resolve the app object) and the
 *  pure pipeline plan(). Without it, RunRegistry.rerun throws "rerun
 *  requires a run planner (RunPlanner)". */
function cliRunPlanner(): RunPlanner {
  return { plan: (appId, inputs) => pipelinePlan(loadWorkflowApp(appId), inputs) };
}

export function runRerunCli(runId: string, options: Record<string, unknown> = {}) {
  return new RunRegistry(cwdArg(options, ["cwd", "repo"], true), cliRunPlanner()).rerun(runId, { reason: optionalArg(options.reason), scope: scopeOf(options, "home") });
}
export function runLinkCli(runId: string, options: Record<string, unknown> = {}) {
  const url = optionalArg(options.url);
  if (!url) throw new Error("Missing run link url (--url <url>)");
  return recordRunLink(
    new RunRegistry(cwdArg(options, ["cwd", "repo"], true)),
    runId,
    { url, kind: optionalArg(options.kind), note: optionalArg(options.note), actor: optionalArg(options.actor) },
    { scope: scopeOf(options, "home") }
  );
}
export function historyCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).history({
    scope: scopeOf(options, "home"),
    app: optionalArg(options.app),
    status: optionalArg(options.status) as never,
    limit: requiredNumberFlag(options.limit, "--limit"),
    offset: requiredNumberFlag(options.offset, "--offset"),
  });
}

export function queueAddCli(options: Record<string, unknown> = {}) {
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
export function queueListCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).queueList({ status: optionalArg(options.status) as never, repo: optionalArg(options.repo) });
}
export function queueShowCli(id: string, options: Record<string, unknown> = {}) {
  return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).queueShow(id);
}
export function queueDrainCli(options: Record<string, unknown> = {}) {
  return new RunRegistry(cwdArg(options, ["cwd", "repo"], true)).queueDrain({
    limit: requiredNumberFlag(options.limit, "--limit"),
    repo: optionalArg(options.repo),
  });
}
