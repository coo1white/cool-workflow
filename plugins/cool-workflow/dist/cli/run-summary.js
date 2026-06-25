"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitRunSummary = emitRunSummary;
// Shared calm end-of-run summary helper, lifted out of command-surface.ts so the
// `audit-run`/`quickstart` path (still in the dispatcher) AND the carved `run`
// drive paths (src/cli/handlers/run.ts) emit ONE identical summary — no copy.
// Stderr/human-side ONLY: stdout (the `--json` payload) stays byte-exact.
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const capability_core_1 = require("../capability-core");
const reporter_1 = require("../reporter");
/** Emit the calm end-of-run summary (stderr, TTY-gated inside the reporter): the COMPACT findings
 *  table re-parsed from each completed worker's `cw:result`, the report path, where the per-worker
 *  transcripts live, and — under `--full` — the report inline. Stderr/human-side ONLY: stdout (the
 *  `--json` payload printed just before this) stays byte-exact. Shared by the quickstart and the
 *  two `run --drive` paths so all three render an identical summary. */
function emitRunSummary(runner, options, fields) {
    // Anchor run reads to the run's OWN repo (a drive/quickstart may run cross-directory): the run
    // dir is <repo>/.cw/runs/<id>/, holding each worker's transcript.md next to its result.md.
    const runDir = typeof fields.statePath === "string" ? node_path_1.default.dirname(fields.statePath) : undefined;
    const baseDir = runDir ? node_path_1.default.resolve(runDir, "..", "..", "..") : undefined;
    const findings = (0, capability_core_1.collectRunFindings)(runner, fields.runId, baseDir);
    // --full ALSO prints the report inline at run end (the compact table stays the default summary).
    let fullReport;
    if (options.full && fields.reportPath && node_fs_1.default.existsSync(fields.reportPath)) {
        try {
            fullReport = node_fs_1.default.readFileSync(fields.reportPath, "utf8");
        }
        catch { /* best-effort inline */ }
    }
    reporter_1.reporter.runSummary({
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
