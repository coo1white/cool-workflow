// shell/reporter.ts — the cw-side run reporter: drive progress lines +
// the end-of-run summary. Byte-exact port of the old build's
// reporter module.
//
// MILESTONE 11 (reporting/observability). Everything here goes to
// STDERR; stdout (the machine payload) carries NO term styling ever, so
// it stays byte-exact under any color env — this is gate point #1 of the
// Rule of Silence's three gate points (SPEC/reporting-ux.md rebuild risk
// #1): `Reporter.runSummary` writes nothing when the stream is not a TTY.
//
// Evidence: SPEC/reporting-ux.md "The Rule of Silence (TTY view vs
// pipes)".

import { dim, green, yellow, nextHint, tryHint, formatFindingsSummary, FindingRow } from "./term";

function isTTY(stream: NodeJS.WriteStream): boolean {
  return Boolean(stream.isTTY);
}

export interface RunSummaryFields {
  runId: string;
  reportPath: string;
  status: string;
  completedWorkers?: number;
  plannedWorkers?: number;
  agentConfigured?: boolean;
  findings?: FindingRow[];
  runDir?: string;
  fullReport?: string;
}

export interface Reporter {
  progress(line: string): void;
  runSummary(fields: RunSummaryFields): void;
}

class StderrReporter implements Reporter {
  constructor(private readonly s: NodeJS.WriteStream) {}

  progress(line: string): void {
    this.s.write(`${line}\n`);
  }

  runSummary(f: RunSummaryFields): void {
    if (!isTTY(this.s)) return;
    const s = this.s;
    const counts = typeof f.completedWorkers === "number" && typeof f.plannedWorkers === "number" ? ` — ${f.completedWorkers}/${f.plannedWorkers}` : "";
    s.write("\n");
    if (f.findings && f.findings.length) s.write(`${formatFindingsSummary(f.findings, s)}\n\n`);
    s.write(`${green("✓", s)} Report: ${f.reportPath}\n`);
    if (f.status === "complete") {
      s.write(`  ${green("✓", s)} Status: complete${counts}\n`);
      if (f.runDir) s.write(`  ${dim(`Transcript: ${f.runDir}`, s)}\n`);
      s.write(`  ${nextHint(`cw report ${f.runId} --show`, s)}\n`);
    } else {
      s.write(`  ${yellow("!", s)} Status: ${f.status}${counts}\n`);
      if (f.agentConfigured === false) s.write(`  ${tryHint("cw doctor", s)}\n`);
      else s.write(`  ${nextHint(`cw status ${f.runId}`, s)}\n`);
    }
    if (typeof f.fullReport === "string" && f.fullReport.trim()) {
      s.write(`\n${dim("──── full report ────", s)}\n${f.fullReport.trim()}\n`);
    }
  }
}

/** Build a reporter over an explicit stream. */
export function createReporter(stream: NodeJS.WriteStream): Reporter {
  return new StderrReporter(stream);
}

/** The default reporter writes the orchestration view to stderr. */
export const reporter: Reporter = createReporter(process.stderr);
