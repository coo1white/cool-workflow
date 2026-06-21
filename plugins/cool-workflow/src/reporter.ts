// src/reporter.ts — the cw-side run reporter.
//
// Rendering lives behind a small interface so the drive/command-surface stay logic-only: the
// orchestrator emits events (progress lines, the end-of-run summary) and the Reporter decides how
// to draw them. The live AGENT view (spinner / streamed tokens / folding tool lines) is rendered
// by the async agent wrapper — cw is blocked in spawnSync during a run, so cw only renders the
// calm orchestration BETWEEN agents plus the final summary. Everything goes to STDERR (stdout
// stays the byte-exact data channel); TTY-gated; honors NO_COLOR/FORCE_COLOR/--no-color via term.

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
  /** Run dir holding the per-worker `transcript.md` (full reasoning + tool I/O). */
  runDir?: string;
  /** When `--full`, the full report text to also print inline. */
  fullReport?: string;
}

export interface Reporter {
  /** A drive progress line (a phase boundary or an accept step). stderr, already TTY-gated by
   *  the caller; the reporter only decides styling. */
  progress(line: string): void;
  /** The clean end-of-run summary: report path, status, a COMPACT findings table (not the full
   *  prose), where the transcript lives, and the next command. */
  runSummary(fields: RunSummaryFields): void;
}

class StderrReporter implements Reporter {
  constructor(private readonly s: NodeJS.WriteStream) {}

  progress(line: string): void {
    // The caller already decided WHETHER to emit (drive's CW_DRIVE_PROGRESS/TTY gate) and has
    // already styled the line (phaseProgressLine etc.) — the reporter just centralizes the write
    // so all orchestration output flows through one interface. No extra styling (avoids ANSI nesting).
    this.s.write(`${line}\n`);
  }

  runSummary(f: RunSummaryFields): void {
    if (!isTTY(this.s)) return; // summary is human chrome; piped/--json stdout already carries the data
    const s = this.s;
    const counts = (typeof f.completedWorkers === "number" && typeof f.plannedWorkers === "number")
      ? ` — ${f.completedWorkers}/${f.plannedWorkers}` : "";
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

/** Build a reporter over an explicit stream. Used by the default singleton and by tests, which
 *  drive a fake `{ isTTY, write }` stream to assert the TTY path renders (findings table + report
 *  path + hints) and the non-TTY path stays silent. */
export function createReporter(stream: NodeJS.WriteStream): Reporter {
  return new StderrReporter(stream);
}

/** The default reporter writes the orchestration view to stderr. (A future non-TTY-specific
 *  reporter could differ; today the single impl gates internally on isTTY, matching emitProgress.) */
export const reporter: Reporter = createReporter(process.stderr);
