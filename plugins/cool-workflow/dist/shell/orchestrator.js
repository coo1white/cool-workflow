// shell/orchestrator.ts — a THIN, SCOPED CoolWorkflowRunner facade for the two
// shipping tooling scripts (scripts/dogfood-release.mjs and
// scripts/dogfood-architecture-review.mjs) that drive a run through
// `new CoolWorkflowRunner({ pluginRoot }).<verb>(...)`.
//
// It holds ONLY the verbs those two scripts call, each a thin
// `loadRun -> delegate` over an EXISTING shell function (mostly the
// `*Cli(args)` functions, which already do the option-key normalization).
// It is a standalone tooling module: it is NOT wired into the CLI/MCP
// capability table and registers no capability, so the CLI<->MCP parity
// gate and the black-box conformance suite stay untouched.
//
// The facade is an intentional keep, not a god-class to dismantle.
import * as path from "node:path";
import { loadRunFromCwd } from "./run-store.js";
import { loadWorkflowApp } from "./workflow-app-loader.js";
import { plan as planRun } from "./pipeline.js";
import { createDispatchManifest } from "./dispatch.js";
import { getWorkerScope, writeWorkerManifest, recordWorkerOutput as recordWorkerOutputImpl } from "./worker-isolation.js";
import { saveCheckpoint, withRunStateLock } from "./run-store.js";
import { summarizeTrustAudit } from "./trust-audit.js";
import { evidenceProvenance } from "./audit-provenance.js";
import { auditAttestCli, auditDecisionCli } from "./audit-cli.js";
import { commitState } from "./commit.js";
import { writeReport } from "./report.js";
export class CoolWorkflowRunner {
    // Kept for API compatibility with the constructor shape the scripts use
    // (`new CoolWorkflowRunner({ pluginRoot })`). workflow-app-loader finds
    // the plugin root itself (walks up from import.meta.dirname), so this value is inert
    // here — the run-resolving cwd is `baseDir` (below).
    pluginRoot;
    // The directory a run is resolved against; undefined falls back to
    // process.cwd() (no process.chdir).
    baseDir;
    constructor(opts = {}) {
        this.pluginRoot = opts.pluginRoot;
        this.baseDir = opts.baseDir ? path.resolve(opts.baseDir) : undefined;
    }
    /** Return a runner that resolves runs against `dir` instead of
     *  process.cwd(), WITHOUT chdir-ing the process. Same instance when the dir
     *  is unchanged. */
    withBaseDir(dir) {
        const resolved = dir ? path.resolve(dir) : undefined;
        if (resolved === this.baseDir)
            return this;
        return new CoolWorkflowRunner({ pluginRoot: this.pluginRoot, baseDir: resolved });
    }
    /** The cwd a run is resolved against (baseDir or process.cwd()). */
    cwd() {
        return this.baseDir || process.cwd();
    }
    /** Load a run from the runner's baseDir (or process.cwd()). Public because
     *  dogfood-architecture-review and dogfood-release call `runner.loadRun(...)`. */
    loadRun(runId) {
        return loadRunFromCwd(runId, this.cwd());
    }
    /** `plan` — load the workflow app by id, then plan a brand-new run. */
    plan(workflowId, options = {}) {
        return planRun(loadWorkflowApp(workflowId), options);
    }
    /** `dispatch` — build the next dispatch manifest (persisting through
     *  createDispatchManifest's own writes) and checkpoint. */
    dispatch(runId, options = {}) {
        // Hold the state.json lock across the whole load -> change -> save so a
        // concurrent run mutation cannot drop this dispatch (lost-update class,
        // matching pipeline-cli.ts's dispatchRun).
        return withRunStateLock(runId, this.cwd(), (run) => {
            const limit = numberOption(options.limit);
            const manifest = createDispatchManifest(run, limit, {
                sandboxProfileId: stringOption(options.sandbox) || stringOption(options.sandboxProfile) || stringOption(options.sandboxProfileId),
                backendId: stringOption(options.backend) || stringOption(options.backendId) || stringOption(options.executionBackend),
            });
            saveCheckpoint(run);
            return manifest;
        });
    }
    /** `showWorkerManifest` — write + return a worker's manifest. */
    showWorkerManifest(runId, workerId) {
        const run = this.loadRun(runId);
        const scope = getWorkerScope(run, workerId);
        if (!scope)
            throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
        return writeWorkerManifest(run, scope);
    }
    /** `recordWorkerOutput` — accept a worker's result and checkpoint, as
     *  workerOutputCli does: recordWorkerOutput + saveCheckpoint. */
    recordWorkerOutput(runId, workerId, resultPath, options = {}) {
        // Hold the state.json lock across the whole load -> change -> save so a
        // concurrent run mutation cannot drop this worker output (lost-update class).
        return withRunStateLock(runId, this.cwd(), (run) => {
            const output = recordWorkerOutputImpl(run, workerId, this.resolveFromBase(resultPath), options);
            saveCheckpoint(run);
            return output;
        });
    }
    /** `auditSummary` — the trust-audit rollup. */
    auditSummary(runId) {
        return summarizeTrustAudit(this.loadRun(runId));
    }
    /** `evidenceProvenance` — the evidence chain + audit events, filtered. */
    evidenceProvenance(runId, options = {}) {
        return evidenceProvenance(this.loadRun(runId), {
            workerId: stringOption(options.worker || options.workerId),
            candidateId: stringOption(options.candidate || options.candidateId),
            commitId: stringOption(options.commit || options.commitId),
        });
    }
    /** `recordAuditAttestation` — host/operator sandbox attestation. Delegates
     *  to auditAttestCli, which loads the run, applies the option-key
     *  normalization, records the event, and checkpoints. */
    recordAuditAttestation(runId, options = {}) {
        return auditAttestCli(runId, { ...options, runId, cwd: this.cwd() });
    }
    /** `recordAuditDecision` — validate + record a sandbox policy decision.
     *  Delegates to auditDecisionCli (worker lookup + sandbox validation +
     *  fail-closed feedback + checkpoint). */
    recordAuditDecision(runId, workerId, options = {}) {
        return auditDecisionCli(runId, workerId, { ...options, runId, cwd: this.cwd() });
    }
    /** `commit` — verifier-gated (or explicit-checkpoint) state commit. Returns
     *  `{ runId, commit }` (the scripts read `commitResult.commit`). */
    commit(runId, input = {}) {
        // Hold the state.json lock across the whole load -> commit -> save (both
        // the success and the fail-closed catch persist) so a concurrent run
        // mutation cannot drop this commit (lost-update class).
        return withRunStateLock(runId, this.cwd(), (run) => {
            const options = typeof input === "string" ? { reason: input } : input;
            const allowCheckpoint = Boolean(options.allowUnverifiedCheckpoint || options["allow-unverified-checkpoint"]);
            const hasGateOption = Boolean(options.verifier || options.verifierNode || options["verifier-node"]);
            try {
                const commit = commitState(run, {
                    reason: stringOption(options.reason) || "manual",
                    verifierNodeId: stringOption(options.verifier) || stringOption(options.verifierNode) || stringOption(options["verifier-node"]),
                    verifierGated: hasGateOption || !allowCheckpoint,
                    allowUnverifiedCheckpoint: allowCheckpoint,
                    source: "cli",
                });
                writeReport(run);
                saveCheckpoint(run);
                return { runId: run.id, commit };
            }
            catch (error) {
                writeReport(run);
                saveCheckpoint(run);
                throw error;
            }
        });
    }
    /** `report` — write the run's report.md; returns `{ path }` (old shape). */
    report(runId) {
        return { path: writeReport(this.loadRun(runId)) };
    }
    /** Resolve a possibly-relative path against the runner's cwd (old
     *  resolveFromBase). */
    resolveFromBase(target) {
        return path.resolve(this.cwd(), target);
    }
}
function stringOption(value) {
    if (value === undefined || value === null || value === true)
        return undefined;
    return String(value);
}
function numberOption(value) {
    if (value === undefined || value === null || value === true)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
// `drive` for scripts/dogfood-architecture-review.mjs, which calls
// `drive(runner, run.id, { now, agentConfig })`. shell/drive.ts's drive is
// `drive(runId, cwd, options)` and resolves the run from cwd, so this
// adapter forwards the runner's cwd.
import { drive as driveImpl } from "./drive.js";
export function drive(runner, runId, options = {}) {
    const cwd = (runner && runner.baseDir) || process.cwd();
    return driveImpl(runId, cwd, options);
}
