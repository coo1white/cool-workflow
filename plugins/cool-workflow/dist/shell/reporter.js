// shell/reporter.ts — the cw-side run reporter: drive progress lines +
// the end-of-run summary.
//
// Everything here goes to
// STDERR; stdout (the machine payload) carries NO term styling ever, so
// it stays byte-exact under any color env. The end-of-run summary
// (formatQuickstartSummary) is printed only on a real terminal.
//
// Evidence: SPEC/reporting-ux.md "The Rule of Silence (TTY view vs
// pipes)".
import { dim, green, yellow, nextHint, tryHint } from "./term.js";
class StderrReporter {
    s;
    constructor(s) {
        this.s = s;
    }
    progress(line) {
        this.s.write(`${line}\n`);
    }
}
/** Build a reporter over an explicit stream. */
export function createReporter(stream) {
    return new StderrReporter(stream);
}
/** The default reporter writes the orchestration view to stderr. */
export const reporter = createReporter(process.stderr);
/** The `cw -q`/`cw quickstart` end-of-run summary: wired in by
 *  shell/pipeline-cli.ts's formatQuickstartHuman, called ONLY on a real
 *  terminal, never for --json or a piped run (the CLI dispatcher's own
 *  TTY gate — cli/dispatch.ts's shouldRenderHuman). Styled against
 *  stdout, since that is the stream this text lands on (unlike the
 *  stderr-only StderrReporter above). `opened` says whether the report
 *  was just opened in the browser, so the hint line matches what really
 *  happened. */
export function formatQuickstartSummary(f, opened) {
    const out = process.stdout;
    // "workers": this is the whole run's count, so it does not read as the
    // same number as a phase line's "(done/total)" (D1 in unix-principles.md).
    const counts = typeof f.completedWorkers === "number" && typeof f.plannedWorkers === "number" ? ` — ${f.completedWorkers}/${f.plannedWorkers} workers` : "";
    const lines = [`${green("✓", out)} Report: ${f.reportPath}`];
    if (f.status === "complete") {
        lines.push(`  ${green("✓", out)} Status: complete${counts}`);
    }
    else {
        lines.push(`  ${yellow("!", out)} Status: ${f.status}${counts}`);
        if (f.agentConfigured === false)
            lines.push(`  ${tryHint("cw doctor", out)}`);
        else if (f.status === "parked" || f.status === "blocked") {
            // A stop with an agent set: say why, and name the one command that
            // goes on from here (D2 in docs/unix-principles.md).
            const why = (f.why || []).filter((line) => line.trim());
            why.forEach((line, index) => lines.push(`  ${index === 0 ? `${dim("Why:", out)} ` : "     "}${line}`));
            lines.push(opened ? `  ${green("✓", out)} Report opened. Again later: cw report --open` : `  ${tryHint("cw report --open", out)}`);
            lines.push(`  ${nextHint(`cw --resume --run ${f.runId}`, out)}`);
            return lines.join("\n");
        }
    }
    lines.push(opened ? `  ${green("✓", out)} Report opened. Again later: cw report --open` : `  ${nextHint("cw report --open", out)}`);
    lines.push(`  ${dim("Try:", out)} cw report --show`);
    return lines.join("\n");
}
