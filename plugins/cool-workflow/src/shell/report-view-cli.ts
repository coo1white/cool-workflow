// shell/report-view-cli.ts — CLI/MCP-facing entry points for `cw report
// <run-id>`, `cw status`, `cw graph`, `cw operator status|report|graph`.
//
// MILESTONE 11 (reporting/observability). Wires shell/operator-ux.ts +
// shell/report.ts + shell/operator-ux-text.ts into the shapes
// core/capability-table.ts's CLI/MCP bindings call, matching shell/
// pipeline-cli.ts's pattern.
//
// Evidence: SPEC/reporting-ux.md "CLI commands" (`cw report`, `cw
// status`, `cw operator status|report`, `cw graph`).

import * as path from "node:path";
import { loadRunFromCwd } from "./run-store";
import { writeReport } from "./report";
import { adviseNoRun, buildOperatorGraph, summarizeOperatorRun, summarizeRun } from "./operator-ux";
import { formatOperatorGraph, formatOperatorReport, formatOperatorStatus, formatOperatorSummary } from "./operator-ux-text";

function invocationCwd(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** `cw report <run-id>` — writes report.md fresh and returns just its
 *  path (the CLI binding prints ONLY this path + "\n" to stdout; `--json`
 *  prints `{path}`). */
export function reportWriteCli(runId: string, args: Record<string, unknown>): { path: string } {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  return { path: writeReport(run) };
}

/** `cw status [<run-id>]` / `cw_status` — no id: the fixed advice shape;
 *  with an id: `summarizeRun`'s payload. */
export function statusCli(runId: string | undefined, args: Record<string, unknown>): unknown {
  if (!runId) return { runId: null, nextActions: adviseNoRun() };
  const run = loadRunFromCwd(runId, invocationCwd(args));
  return summarizeRun(run);
}

/** `cw status <id> --summary`/`--brief` human text. */
export function statusSummaryText(runId: string, args: Record<string, unknown>): string {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  return formatOperatorSummary(summarizeOperatorRun(run));
}

/** The full `cw status <id>` human text. */
export function statusFullText(runId: string, args: Record<string, unknown>): string {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  return formatOperatorStatus(summarizeOperatorRun(run));
}

/** `cw operator status <id> [--json]`. */
export function operatorStatusCli(runId: string, args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  return summarizeOperatorRun(run);
}

/** `cw operator report <id> [--json]` — also re-writes report.md as a
 *  side effect (byte-exact to the old build's operator report verb). */
export function operatorReportCli(runId: string, args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  writeReport(run);
  return summarizeOperatorRun(run);
}

export function operatorReportText(runId: string, args: Record<string, unknown>): string {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  writeReport(run);
  return formatOperatorReport(summarizeOperatorRun(run), []);
}

/** `cw graph <id> [--json]` / `cw operator graph`. */
export function graphCli(runId: string, args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  if (args.__cwWorkbenchReadOnlyProjection === true) (run as unknown as Record<string, unknown>).__cwWorkbenchReadOnlyProjection = true;
  return buildOperatorGraph(run);
}

export function graphText(runId: string, args: Record<string, unknown>): string {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  return formatOperatorGraph(buildOperatorGraph(run));
}

export { optionalString };
