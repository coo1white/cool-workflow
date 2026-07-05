"use strict";
// shell/reporter.ts — the cw-side run reporter: drive progress lines +
// the end-of-run summary. Byte-exact port of the old build's
// src/reporter.ts.
//
// MILESTONE 11 (reporting/observability). Everything here goes to
// STDERR; stdout (the machine payload) carries NO term styling ever, so
// it stays byte-exact under any color env — this is gate point #1 of the
// Rule of Silence's three gate points (SPEC/reporting-ux.md rebuild risk
// #1): `Reporter.runSummary` writes nothing when the stream is not a TTY.
//
// Evidence: SPEC/reporting-ux.md "The Rule of Silence (TTY view vs
// pipes)"; plugins/cool-workflow/src/reporter.ts:1-84 (byte-exact
// source).
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
        this.s.write(`${line}\n`);
    }
    runSummary(f) {
        if (!isTTY(this.s))
            return;
        const s = this.s;
        const counts = typeof f.completedWorkers === "number" && typeof f.plannedWorkers === "number" ? ` — ${f.completedWorkers}/${f.plannedWorkers}` : "";
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
/** Build a reporter over an explicit stream. */
function createReporter(stream) {
    return new StderrReporter(stream);
}
/** The default reporter writes the orchestration view to stderr. */
exports.reporter = createReporter(process.stderr);
