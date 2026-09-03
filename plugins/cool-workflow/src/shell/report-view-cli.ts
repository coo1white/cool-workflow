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

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { loadRunFromCwd } from "./run-store";
import { writeReport } from "./report";
import { adviseNoRun, buildOperatorGraph, summarizeOperatorRun, summarizeRun } from "./operator-ux";
import { formatOperatorGraph, formatOperatorReport, formatOperatorStatus, formatOperatorSummary } from "./operator-ux-text";
import { reportToHtml } from "../core/format/report-html";

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

/** `cw report` with no run id: the newest run under this repo's
 *  `.cw/runs/`. Run ids sort chronologically (checked on three real
 *  runs: the largest id by plain string sort was also the latest
 *  `createdAt`), so "newest" is just the last name after a sort.
 *  Returns undefined when the repo has no run yet. */
export function resolveReportRunId(args: Record<string, unknown>): string | undefined {
  const runsDir = path.join(invocationCwd(args), ".cw", "runs");
  if (!fs.existsSync(runsDir)) return undefined;
  const ids = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(runsDir, entry.name, "state.json")))
    .map((entry) => entry.name)
    .sort();
  return ids.length ? ids[ids.length - 1] : undefined;
}

/** Writes/refreshes `report.html` beside `report.md` (only when missing
 *  or older) and opens it with the system viewer: `CW_OPENER` when set
 *  (the smoke test's stub), else `open`/`xdg-open`/`start` for macOS/
 *  Linux/Windows. Spawned argv-style, `shell: false` — never a shell
 *  string built from a path. A missing opener never throws (spawnSync's
 *  `error` field just carries it), so the caller still gets the path
 *  back and exits 0. */
export function ensureAndOpenReportHtml(mdPath: string): string {
  const htmlPath = mdPath.replace(/\.md$/, ".html");
  const mdMtime = fs.statSync(mdPath).mtimeMs;
  const htmlMtime = fs.existsSync(htmlPath) ? fs.statSync(htmlPath).mtimeMs : -1;
  if (htmlMtime < mdMtime) fs.writeFileSync(htmlPath, reportToHtml(fs.readFileSync(mdPath, "utf8")), "utf8");
  const opener = process.env.CW_OPENER || (process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open");
  spawnSync(opener, [htmlPath], { stdio: "ignore", shell: false });
  return htmlPath;
}

/** `cw report --open [run-id]` — a fresh report.md, then the html+open
 *  step above. */
export function reportOpenCli(runId: string, args: Record<string, unknown>): { path: string } {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  return { path: ensureAndOpenReportHtml(writeReport(run)) };
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
