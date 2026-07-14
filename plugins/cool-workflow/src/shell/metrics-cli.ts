// shell/metrics-cli.ts — CLI/MCP-facing entry points for `cw metrics
// show`/`cw metrics summary`.
//
// MILESTONE 11 (reporting/observability). Wires shell/observability.ts
// into the shapes core/capability-table.ts's CLI/MCP bindings call.
//
// Evidence: SPEC/reporting-ux.md "cw metrics show" / "cw metrics
// summary".

import * as path from "node:path";
import { requiredNumberFlag } from "../core/util/numeric-flag";
import { loadRunFromCwd, loadRunStateFile } from "./run-store";
import { loadCostPolicy, loadPersistedMetricsFingerprint, showMetricsReport, deriveMetricsSummary, SummaryRunInput } from "./observability";
import { RunRegistry } from "./run-registry-io";

function invocationCwd(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}

function pluginRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "plugins", "cool-workflow");
    if (require("node:fs").existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function nowOf(args: Record<string, unknown>): string {
  return typeof args.now === "string" && args.now.trim() ? args.now : new Date().toISOString();
}

/** `cw metrics show <run-id> [--json] [--pricing ...] [--now ISO]`. */
export function metricsShowCli(runId: string, args: Record<string, unknown>): ReturnType<typeof showMetricsReport> {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const policy = loadCostPolicy(args, pluginRoot());
  return showMetricsReport(run, { now: nowOf(args), policy, persist: args.__cwWorkbenchReadOnlyProjection !== true });
}

/** `cw metrics summary [--scope repo|home] [--pricing ...] [--now ISO] [--limit N]`.
 *  `--limit` defaults to RunRegistry.list()'s own 50-record floor when omitted. */
export function metricsSummaryCli(args: Record<string, unknown>): ReturnType<typeof deriveMetricsSummary> {
  const cwd = invocationCwd(args);
  const scope = args.scope === "home" ? "home" : "repo";
  const registry = new RunRegistry(cwd);
  const limit = requiredNumberFlag(args.limit, "--limit");
  const listing = registry.list({ scope, includeArchived: true, limit });
  const inputs: SummaryRunInput[] = [];
  let unreadableRuns = 0;
  for (const record of listing.records as Array<{ statePath: string; repo?: string }>) {
    try {
      const result = loadRunStateFile(record.statePath, { dryRun: true });
      if (result.report.status === "unsupported") {
        unreadableRuns++;
        continue;
      }
      inputs.push({ run: result.run, repo: record.repo, persistedFingerprint: loadPersistedMetricsFingerprint(result.run) });
    } catch {
      unreadableRuns++;
    }
  }
  const policy = loadCostPolicy(args, pluginRoot());
  return deriveMetricsSummary(inputs, { now: nowOf(args), scope, policy, unreadableRuns });
}
