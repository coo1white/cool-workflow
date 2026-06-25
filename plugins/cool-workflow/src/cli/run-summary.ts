// Shared calm end-of-run summary helper, lifted out of command-surface.ts so the
// `audit-run`/`quickstart` path (still in the dispatcher) AND the carved `run`
// drive paths (src/cli/handlers/run.ts) emit ONE identical summary — no copy.
// Stderr/human-side ONLY: stdout (the `--json` payload) stays byte-exact.
import fs from "node:fs";
import path from "node:path";
import { CoolWorkflowRunner } from "../orchestrator";
import { collectRunFindings } from "../capability-core";
import { reporter } from "../reporter";

/** Emit the calm end-of-run summary (stderr, TTY-gated inside the reporter): the COMPACT findings
 *  table re-parsed from each completed worker's `cw:result`, the report path, where the per-worker
 *  transcripts live, and — under `--full` — the report inline. Stderr/human-side ONLY: stdout (the
 *  `--json` payload printed just before this) stays byte-exact. Shared by the quickstart and the
 *  two `run --drive` paths so all three render an identical summary. */
export function emitRunSummary(
  runner: CoolWorkflowRunner,
  options: Record<string, unknown>,
  fields: {
    runId: string;
    reportPath: string;
    status: string;
    statePath?: string;
    completedWorkers?: number;
    plannedWorkers?: number;
    agentConfigured?: boolean;
  }
): void {
  // Anchor run reads to the run's OWN repo (a drive/quickstart may run cross-directory): the run
  // dir is <repo>/.cw/runs/<id>/, holding each worker's transcript.md next to its result.md.
  const runDir = typeof fields.statePath === "string" ? path.dirname(fields.statePath) : undefined;
  const baseDir = runDir ? path.resolve(runDir, "..", "..", "..") : undefined;
  const findings = collectRunFindings(runner, fields.runId, baseDir);
  // --full ALSO prints the report inline at run end (the compact table stays the default summary).
  let fullReport: string | undefined;
  if (options.full && fields.reportPath && fs.existsSync(fields.reportPath)) {
    try { fullReport = fs.readFileSync(fields.reportPath, "utf8"); } catch { /* best-effort inline */ }
  }
  reporter.runSummary({
    runId: fields.runId,
    reportPath: fields.reportPath,
    status: fields.status,
    completedWorkers: fields.completedWorkers,
    plannedWorkers: fields.plannedWorkers,
    agentConfigured: fields.agentConfigured,
    findings,
    runDir,
    fullReport
  });
}
