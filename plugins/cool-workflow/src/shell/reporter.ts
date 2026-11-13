// shell/reporter.ts — drive progress lines (stderr) and the end-of-run
// summary (a real terminal only). stdout never carries styling.

import { dim, green, yellow, nextHint, tryHint } from "./term.js";

export interface RunSummaryFields {
  runId: string;
  reportPath: string;
  status: string;
  completedWorkers?: number;
  plannedWorkers?: number;
  agentConfigured?: boolean;
  /** Why the run stopped, then the agent's last stderr line if any. */
  why?: string[];
}

export interface Reporter {
  progress(line: string): void;
}

class StderrReporter implements Reporter {
  constructor(private readonly s: NodeJS.WriteStream) {}

  progress(line: string): void {
    this.s.write(`${line}\n`);
  }
}

/** Build a reporter over an explicit stream. */
export function createReporter(stream: NodeJS.WriteStream): Reporter {
  return new StderrReporter(stream);
}

/** The default reporter writes the orchestration view to stderr. */
export const reporter: Reporter = createReporter(process.stderr);

/** The `cw -q` end-of-run summary, on a terminal only, styled for stdout.
 *  `opened`: the report was just opened, so the hint says so. */
export function formatQuickstartSummary(f: RunSummaryFields, opened: boolean): string {
  const out = process.stdout;
  // "workers": the whole run's count, not a phase line's (done/total).
  const counts = typeof f.completedWorkers === "number" && typeof f.plannedWorkers === "number" ? ` — ${f.completedWorkers}/${f.plannedWorkers} workers` : "";
  // A stopped run (blocked or parked) does not get a finished run's green mark.
  const stopped = f.status === "parked" || f.status === "blocked";
  const lines = [`${stopped ? yellow("!", out) : green("✓", out)} Report: ${f.reportPath}`];
  const openedLine = `  ${green("✓", out)} Report opened. Again later: cw report --open`;
  if (f.status === "complete") {
    lines.push(`  ${green("✓", out)} Status: complete${counts}`);
  } else {
    lines.push(`  ${yellow("!", out)} Status: ${f.status}${counts}`);
    if (f.agentConfigured === false) {
      lines.push(`  ${nextHint('cw -q "<question>" -claude', out)}`);
      if (opened) lines.push(openedLine);
      lines.push(`  ${dim("Try:", out)} cw report --show`);
      return lines.join("\n");
    }
    if (stopped) {
      // Say why, and the one command that goes on from here.
      const why = (f.why || []).filter((line) => line.trim());
      why.forEach((line, index) => lines.push(`  ${index === 0 ? `${dim("Why:", out)} ` : "     "}${line}`));
      lines.push(opened ? openedLine : `  ${tryHint("cw report --open", out)}`);
      lines.push(`  ${nextHint(`cw --resume --run ${f.runId}`, out)}`);
      return lines.join("\n");
    }
  }
  lines.push(opened ? openedLine : `  ${nextHint("cw report --open", out)}`);
  lines.push(`  ${dim("Try:", out)} cw report --show`);
  return lines.join("\n");
}
