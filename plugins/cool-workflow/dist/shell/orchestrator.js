"use strict";
// shell/orchestrator.ts — a THIN, SCOPED CoolWorkflowRunner facade for the two
// shipping tooling scripts (scripts/dogfood-release.js and
// scripts/dogfood-architecture-review.js) that still `require` the old flat
// build's `dist/orchestrator.js` and drive a run through
// `new CoolWorkflowRunner({ pluginRoot }).<verb>(...)`.
//
// v2 dismantled the old wide facade into core/shell functions, so this module
// restores ONLY the ~15 verbs those two scripts call, each a thin
// `loadRun -> delegate` over an EXISTING v2 shell function (mostly the
// `*Cli(args)` byte-behavior ports, which already replicate the old build's
// option-key normalization). It is a standalone tooling module: it is NOT wired
// into the CLI/MCP capability table and registers no capability, so the
// CLI<->MCP parity gate and the black-box conformance suite stay untouched.
//
// The facade is an intentional keep, not a god-class to dismantle (see the
// project memory note "Orchestrator facade is intentional").
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoolWorkflowRunner = void 0;
exports.drive = drive;
const path = __importStar(require("node:path"));
const run_store_1 = require("./run-store");
const workflow_app_loader_1 = require("./workflow-app-loader");
const pipeline_1 = require("./pipeline");
const dispatch_1 = require("./dispatch");
const worker_isolation_1 = require("./worker-isolation");
const run_store_2 = require("./run-store");
const trust_audit_1 = require("./trust-audit");
const audit_provenance_1 = require("./audit-provenance");
const audit_cli_1 = require("./audit-cli");
const multi_agent_cli_1 = require("./multi-agent-cli");
const commit_1 = require("./commit");
const report_1 = require("./report");
class CoolWorkflowRunner {
    // Kept for API compatibility with the old constructor shape the scripts use
    // (`new CoolWorkflowRunner({ pluginRoot })`). v2's workflow-app-loader finds
    // the plugin root itself (walks up from __dirname), so this value is inert
    // here — the run-resolving cwd is `baseDir` (below).
    pluginRoot;
    // The directory a run is resolved against; undefined falls back to
    // process.cwd(). Mirrors the old F7 withBaseDir (no process.chdir).
    baseDir;
    constructor(opts = {}) {
        this.pluginRoot = opts.pluginRoot;
        this.baseDir = opts.baseDir ? path.resolve(opts.baseDir) : undefined;
    }
    /** Return a runner that resolves runs against `dir` instead of
     *  process.cwd(), WITHOUT chdir-ing the process. Same instance when the dir
     *  is unchanged. Matches the old orchestrator withBaseDir. */
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
     *  dogfood-architecture-review calls `runner.loadRun(run.id)`. */
    loadRun(runId) {
        return (0, run_store_1.loadRunFromCwd)(runId, this.cwd());
    }
    /** `plan` — load the workflow app by id, then plan a brand-new run. */
    plan(workflowId, options = {}) {
        return (0, pipeline_1.plan)((0, workflow_app_loader_1.loadWorkflowApp)(workflowId), options);
    }
    /** `dispatch` — build the next dispatch manifest (persisting through
     *  createDispatchManifest's own writes) and checkpoint. */
    dispatch(runId, options = {}) {
        // Hold the state.json lock across the whole load -> change -> save so a
        // concurrent run mutation cannot drop this dispatch (lost-update class,
        // matching pipeline-cli.ts's dispatchRun).
        return (0, run_store_2.withRunStateLock)(runId, this.cwd(), (run) => {
            const limit = numberOption(options.limit);
            const manifest = (0, dispatch_1.createDispatchManifest)(run, limit, {
                sandboxProfileId: stringOption(options.sandbox) || stringOption(options.sandboxProfile) || stringOption(options.sandboxProfileId),
                backendId: stringOption(options.backend) || stringOption(options.backendId) || stringOption(options.executionBackend),
                multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
                multiAgentGroupId: stringOption(options.multiAgentGroup || options.multiAgentGroupId || options.group || options["multi-agent-group"]),
                multiAgentRoleId: stringOption(options.multiAgentRole || options.multiAgentRoleId || options.role || options["multi-agent-role"]),
                multiAgentFanoutId: stringOption(options.multiAgentFanout || options.multiAgentFanoutId || options.fanout || options["multi-agent-fanout"]),
            });
            (0, run_store_2.saveCheckpoint)(run);
            return manifest;
        });
    }
    /** `showWorkerManifest` — write + return a worker's manifest. */
    showWorkerManifest(runId, workerId) {
        const run = this.loadRun(runId);
        const scope = (0, worker_isolation_1.getWorkerScope)(run, workerId);
        if (!scope)
            throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
        return (0, worker_isolation_1.writeWorkerManifest)(run, scope);
    }
    /** `recordWorkerOutput` — accept a worker's result and checkpoint. Mirrors
     *  v2's workerOutputCli: recordWorkerOutput + saveCheckpoint. */
    recordWorkerOutput(runId, workerId, resultPath, options = {}) {
        // Hold the state.json lock across the whole load -> change -> save so a
        // concurrent run mutation cannot drop this worker output (lost-update class).
        return (0, run_store_2.withRunStateLock)(runId, this.cwd(), (run) => {
            const output = (0, worker_isolation_1.recordWorkerOutput)(run, workerId, this.resolveFromBase(resultPath), options);
            (0, run_store_2.saveCheckpoint)(run);
            return output;
        });
    }
    /** `auditSummary` — the trust-audit rollup. */
    auditSummary(runId) {
        return (0, trust_audit_1.summarizeTrustAudit)(this.loadRun(runId));
    }
    /** `evidenceProvenance` — the evidence chain + audit events, filtered. */
    evidenceProvenance(runId, options = {}) {
        return (0, audit_provenance_1.evidenceProvenance)(this.loadRun(runId), {
            workerId: stringOption(options.worker || options.workerId),
            candidateId: stringOption(options.candidate || options.candidateId),
            commitId: stringOption(options.commit || options.commitId),
        });
    }
    /** `recordAuditAttestation` — host/operator sandbox attestation. Delegates
     *  to auditAttestCli, which loads the run, applies the old option-key
     *  normalization, records the event, and checkpoints. */
    recordAuditAttestation(runId, options = {}) {
        return (0, audit_cli_1.auditAttestCli)(runId, { ...options, runId, cwd: this.cwd() });
    }
    /** `recordAuditDecision` — validate + record a sandbox policy decision.
     *  Delegates to auditDecisionCli (worker lookup + sandbox validation +
     *  fail-closed feedback + checkpoint). */
    recordAuditDecision(runId, workerId, options = {}) {
        return (0, audit_cli_1.auditDecisionCli)(runId, workerId, { ...options, runId, cwd: this.cwd() });
    }
    /** `registerCandidate` — register a candidate from a worker/manual source.
     *  Delegates to candidateRegisterCli (old worker-scope read + persist). */
    registerCandidate(runId, options = {}) {
        return (0, multi_agent_cli_1.candidateRegisterCli)({ ...options, runId, cwd: this.cwd() });
    }
    /** `scoreCandidate` — score a candidate. Delegates to candidateScoreCli. */
    scoreCandidate(runId, candidateId, options = {}) {
        return (0, multi_agent_cli_1.candidateScoreCli)({ ...options, runId, cwd: this.cwd() }, candidateId);
    }
    /** `selectCandidate` — select a candidate. Delegates to candidateSelectCli. */
    selectCandidate(runId, candidateId, options = {}) {
        return (0, multi_agent_cli_1.candidateSelectCli)({ ...options, runId, cwd: this.cwd() }, candidateId);
    }
    /** `commit` — verifier-gated (or explicit-checkpoint) state commit. Returns
     *  `{ runId, commit }` to match the old orchestrator's shape (the scripts
     *  read `commitResult.commit`). */
    commit(runId, input = {}) {
        // Hold the state.json lock across the whole load -> commit -> save (both
        // the success and the fail-closed catch persist) so a concurrent run
        // mutation cannot drop this commit (lost-update class).
        return (0, run_store_2.withRunStateLock)(runId, this.cwd(), (run) => {
            const options = typeof input === "string" ? { reason: input } : input;
            const allowCheckpoint = Boolean(options.allowUnverifiedCheckpoint || options["allow-unverified-checkpoint"]);
            const hasGateOption = Boolean(options.verifier || options.verifierNode || options["verifier-node"] || options.candidate || options.selection);
            try {
                const commit = (0, commit_1.commitState)(run, {
                    reason: stringOption(options.reason) || "manual",
                    verifierNodeId: stringOption(options.verifier) || stringOption(options.verifierNode) || stringOption(options["verifier-node"]),
                    candidateId: stringOption(options.candidate),
                    selectionId: stringOption(options.selection),
                    verifierGated: hasGateOption || !allowCheckpoint,
                    allowUnverifiedCheckpoint: allowCheckpoint,
                    source: "cli",
                });
                (0, report_1.writeReport)(run);
                (0, run_store_2.saveCheckpoint)(run);
                return { runId: run.id, commit };
            }
            catch (error) {
                (0, report_1.writeReport)(run);
                (0, run_store_2.saveCheckpoint)(run);
                throw error;
            }
        });
    }
    /** `report` — write the run's report.md; returns `{ path }` (old shape). */
    report(runId) {
        return { path: (0, report_1.writeReport)(this.loadRun(runId)) };
    }
    /** Resolve a possibly-relative path against the runner's cwd (old
     *  resolveFromBase). */
    resolveFromBase(target) {
        return path.resolve(this.cwd(), target);
    }
}
exports.CoolWorkflowRunner = CoolWorkflowRunner;
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
// Back-compat `drive` for scripts/dogfood-architecture-review.js, which calls
// `drive(runner, run.id, { now, agentConfig })` — the OLD drive arg order.
// v2's shell/drive.ts drive is `drive(runId, cwd, options)` and never uses a
// runner object (it resolves the run from cwd), so this adapter forwards the
// runner's cwd. The script's require for `drive` points at THIS module so its
// call shape stays unchanged (require-path change only).
const drive_1 = require("./drive");
function drive(runner, runId, options = {}) {
    const cwd = (runner && runner.baseDir) || process.cwd();
    return (0, drive_1.drive)(runId, cwd, options);
}
