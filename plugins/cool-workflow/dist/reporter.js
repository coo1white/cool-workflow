"use strict";
// src/reporter.ts — the cw-side run reporter.
//
// Rendering lives behind a small interface so the drive/command-surface stay logic-only: the
// orchestrator emits events (progress lines, the end-of-run summary) and the Reporter decides how
// to draw them. The live AGENT view (spinner / streamed tokens / folding tool lines) is rendered
// by the async agent wrapper — cw is blocked in spawnSync during a run, so cw only renders the
// calm orchestration BETWEEN agents plus the final summary. Everything goes to STDERR (stdout
// stays the byte-exact data channel); TTY-gated; honors NO_COLOR/FORCE_COLOR/--no-color via term.
Object.defineProperty(exports, "__esModule", { value: true });
exports.reporter = void 0;
exports.createReporter = createReporter;
const term_1 = require("./term");
function isTTY(stream) {
    return Boolean(stream.isTTY);
}
class StderrReporter {
    s;
    constructor(s) {
        this.s = s;
    }
    progress(line) {
        // The caller already decided WHETHER to emit (drive's CW_DRIVE_PROGRESS/TTY gate) and has
        // already styled the line (phaseProgressLine etc.) — the reporter just centralizes the write
        // so all orchestration output flows through one interface. No extra styling (avoids ANSI nesting).
        this.s.write(`${line}\n`);
    }
    runSummary(f) {
        if (!isTTY(this.s))
            return; // summary is human chrome; piped/--json stdout already carries the data
        const s = this.s;
        const counts = (typeof f.completedWorkers === "number" && typeof f.plannedWorkers === "number")
            ? ` — ${f.completedWorkers}/${f.plannedWorkers}` : "";
        s.write("\n");
        if (f.findings && f.findings.length)
            s.write(`${(0, term_1.formatFindingsSummary)(f.findings, s)}\n\n`);
        s.write(`${(0, term_1.green)("✓", s)} Report: ${f.reportPath}\n`);
        if (f.status === "complete") {
            s.write(`  ${(0, term_1.green)("✓", s)} Status: complete${counts}\n`);
            if (f.runDir)
                s.write(`  ${(0, term_1.dim)(`Transcript: ${f.runDir}`, s)}\n`);
            s.write(`  ${(0, term_1.nextHint)(`cw report ${f.runId} --show`, s)}\n`);
        }
        else {
            s.write(`  ${(0, term_1.yellow)("!", s)} Status: ${f.status}${counts}\n`);
            if (f.agentConfigured === false)
                s.write(`  ${(0, term_1.tryHint)("cw doctor", s)}\n`);
            else
                s.write(`  ${(0, term_1.nextHint)(`cw status ${f.runId}`, s)}\n`);
        }
        if (typeof f.fullReport === "string" && f.fullReport.trim()) {
            s.write(`\n${(0, term_1.dim)("──── full report ────", s)}\n${f.fullReport.trim()}\n`);
        }
    }
}
/** Build a reporter over an explicit stream. Used by the default singleton and by tests, which
 *  drive a fake `{ isTTY, write }` stream to assert the TTY path renders (findings table + report
 *  path + hints) and the non-TTY path stays silent. */
function createReporter(stream) {
    return new StderrReporter(stream);
}
/** The default reporter writes the orchestration view to stderr. (A future non-TTY-specific
 *  reporter could differ; today the single impl gates internally on isTTY, matching emitProgress.) */
exports.reporter = createReporter(process.stderr);
