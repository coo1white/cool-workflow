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

import * as path from "node:path";
import { WorkflowRun } from "../core/state/types";
import { loadRunFromCwd } from "./run-store";
import { loadWorkflowApp } from "./workflow-app-loader";
import { plan as planRun } from "./pipeline";
import { createDispatchManifest } from "./dispatch";
import { getWorkerScope, writeWorkerManifest, recordWorkerOutput as recordWorkerOutputImpl } from "./worker-isolation";
import { saveCheckpoint, withRunStateLock } from "./run-store";
import { summarizeTrustAudit } from "./trust-audit";
import { evidenceProvenance } from "./audit-provenance";
import { auditAttestCli, auditDecisionCli } from "./audit-cli";
import { candidateRegisterCli, candidateScoreCli, candidateSelectCli } from "./multi-agent-cli";
import { commitState } from "./commit";
import { writeReport } from "./report";

export interface CoolWorkflowRunnerOptions {
  pluginRoot?: string;
  baseDir?: string;
}

export class CoolWorkflowRunner {
  // Kept for API compatibility with the old constructor shape the scripts use
  // (`new CoolWorkflowRunner({ pluginRoot })`). v2's workflow-app-loader finds
  // the plugin root itself (walks up from __dirname), so this value is inert
  // here — the run-resolving cwd is `baseDir` (below).
  readonly pluginRoot?: string;
  // The directory a run is resolved against; undefined falls back to
  // process.cwd(). Mirrors the old F7 withBaseDir (no process.chdir).
  readonly baseDir?: string;

  constructor(opts: CoolWorkflowRunnerOptions = {}) {
    this.pluginRoot = opts.pluginRoot;
    this.baseDir = opts.baseDir ? path.resolve(opts.baseDir) : undefined;
  }

  /** Return a runner that resolves runs against `dir` instead of
   *  process.cwd(), WITHOUT chdir-ing the process. Same instance when the dir
   *  is unchanged. Matches the old orchestrator withBaseDir. */
  withBaseDir(dir: string | undefined): CoolWorkflowRunner {
    const resolved = dir ? path.resolve(dir) : undefined;
    if (resolved === this.baseDir) return this;
    return new CoolWorkflowRunner({ pluginRoot: this.pluginRoot, baseDir: resolved });
  }

  /** The cwd a run is resolved against (baseDir or process.cwd()). */
  private cwd(): string {
    return this.baseDir || process.cwd();
  }

  /** Load a run from the runner's baseDir (or process.cwd()). Public because
   *  dogfood-architecture-review calls `runner.loadRun(run.id)`. */
  loadRun(runId: string): WorkflowRun {
    return loadRunFromCwd(runId, this.cwd());
  }

  /** `plan` — load the workflow app by id, then plan a brand-new run. */
  plan(workflowId: string, options: Record<string, unknown> = {}): WorkflowRun {
    return planRun(loadWorkflowApp(workflowId), options);
  }

  /** `dispatch` — build the next dispatch manifest (persisting through
   *  createDispatchManifest's own writes) and checkpoint. */
  dispatch(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof createDispatchManifest> {
    // Hold the state.json lock across the whole load -> change -> save so a
    // concurrent run mutation cannot drop this dispatch (lost-update class,
    // matching pipeline-cli.ts's dispatchRun).
    return withRunStateLock(runId, this.cwd(), (run) => {
      const limit = numberOption(options.limit);
      const manifest = createDispatchManifest(run, limit, {
        sandboxProfileId: stringOption(options.sandbox) || stringOption(options.sandboxProfile) || stringOption(options.sandboxProfileId),
        backendId: stringOption(options.backend) || stringOption(options.backendId) || stringOption(options.executionBackend),
        multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
        multiAgentGroupId: stringOption(options.multiAgentGroup || options.multiAgentGroupId || options.group || options["multi-agent-group"]),
        multiAgentRoleId: stringOption(options.multiAgentRole || options.multiAgentRoleId || options.role || options["multi-agent-role"]),
        multiAgentFanoutId: stringOption(options.multiAgentFanout || options.multiAgentFanoutId || options.fanout || options["multi-agent-fanout"]),
      });
      saveCheckpoint(run);
      return manifest;
    });
  }

  /** `showWorkerManifest` — write + return a worker's manifest. */
  showWorkerManifest(runId: string, workerId: string): ReturnType<typeof writeWorkerManifest> {
    const run = this.loadRun(runId);
    const scope = getWorkerScope(run, workerId);
    if (!scope) throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
    return writeWorkerManifest(run, scope);
  }

  /** `recordWorkerOutput` — accept a worker's result and checkpoint. Mirrors
   *  v2's workerOutputCli: recordWorkerOutput + saveCheckpoint. */
  recordWorkerOutput(runId: string, workerId: string, resultPath: string, options: Record<string, unknown> = {}): ReturnType<typeof recordWorkerOutputImpl> {
    // Hold the state.json lock across the whole load -> change -> save so a
    // concurrent run mutation cannot drop this worker output (lost-update class).
    return withRunStateLock(runId, this.cwd(), (run) => {
      const output = recordWorkerOutputImpl(run, workerId, this.resolveFromBase(resultPath), options);
      saveCheckpoint(run);
      return output;
    });
  }

  /** `auditSummary` — the trust-audit rollup. */
  auditSummary(runId: string): ReturnType<typeof summarizeTrustAudit> {
    return summarizeTrustAudit(this.loadRun(runId));
  }

  /** `evidenceProvenance` — the evidence chain + audit events, filtered. */
  evidenceProvenance(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof evidenceProvenance> {
    return evidenceProvenance(this.loadRun(runId), {
      workerId: stringOption(options.worker || options.workerId),
      candidateId: stringOption(options.candidate || options.candidateId),
      commitId: stringOption(options.commit || options.commitId),
    });
  }

  /** `recordAuditAttestation` — host/operator sandbox attestation. Delegates
   *  to auditAttestCli, which loads the run, applies the old option-key
   *  normalization, records the event, and checkpoints. */
  recordAuditAttestation(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof auditAttestCli> {
    return auditAttestCli(runId, { ...options, runId, cwd: this.cwd() });
  }

  /** `recordAuditDecision` — validate + record a sandbox policy decision.
   *  Delegates to auditDecisionCli (worker lookup + sandbox validation +
   *  fail-closed feedback + checkpoint). */
  recordAuditDecision(runId: string, workerId: string, options: Record<string, unknown> = {}): ReturnType<typeof auditDecisionCli> {
    return auditDecisionCli(runId, workerId, { ...options, runId, cwd: this.cwd() });
  }

  /** `registerCandidate` — register a candidate from a worker/manual source.
   *  Delegates to candidateRegisterCli (old worker-scope read + persist). */
  registerCandidate(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof candidateRegisterCli> {
    return candidateRegisterCli({ ...options, runId, cwd: this.cwd() });
  }

  /** `scoreCandidate` — score a candidate. Delegates to candidateScoreCli. */
  scoreCandidate(runId: string, candidateId: string, options: Record<string, unknown> = {}): ReturnType<typeof candidateScoreCli> {
    return candidateScoreCli({ ...options, runId, cwd: this.cwd() }, candidateId);
  }

  /** `selectCandidate` — select a candidate. Delegates to candidateSelectCli. */
  selectCandidate(runId: string, candidateId: string, options: Record<string, unknown> = {}): ReturnType<typeof candidateSelectCli> {
    return candidateSelectCli({ ...options, runId, cwd: this.cwd() }, candidateId);
  }

  /** `commit` — verifier-gated (or explicit-checkpoint) state commit. Returns
   *  `{ runId, commit }` to match the old orchestrator's shape (the scripts
   *  read `commitResult.commit`). */
  commit(runId: string, input: string | Record<string, unknown> = {}): { runId: string; commit: ReturnType<typeof commitState> } {
    // Hold the state.json lock across the whole load -> commit -> save (both
    // the success and the fail-closed catch persist) so a concurrent run
    // mutation cannot drop this commit (lost-update class).
    return withRunStateLock(runId, this.cwd(), (run) => {
      const options = typeof input === "string" ? { reason: input } : input;
      const allowCheckpoint = Boolean(options.allowUnverifiedCheckpoint || options["allow-unverified-checkpoint"]);
      const hasGateOption = Boolean(options.verifier || options.verifierNode || options["verifier-node"] || options.candidate || options.selection);
      try {
        const commit = commitState(run, {
          reason: stringOption(options.reason) || "manual",
          verifierNodeId: stringOption(options.verifier) || stringOption(options.verifierNode) || stringOption(options["verifier-node"]),
          candidateId: stringOption(options.candidate),
          selectionId: stringOption(options.selection),
          verifierGated: hasGateOption || !allowCheckpoint,
          allowUnverifiedCheckpoint: allowCheckpoint,
          source: "cli",
        });
        writeReport(run);
        saveCheckpoint(run);
        return { runId: run.id, commit };
      } catch (error) {
        writeReport(run);
        saveCheckpoint(run);
        throw error;
      }
    });
  }

  /** `report` — write the run's report.md; returns `{ path }` (old shape). */
  report(runId: string): { path: string } {
    return { path: writeReport(this.loadRun(runId)) };
  }

  /** Resolve a possibly-relative path against the runner's cwd (old
   *  resolveFromBase). */
  private resolveFromBase(target: string): string {
    return path.resolve(this.cwd(), target);
  }
}

function stringOption(value: unknown): string | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  return String(value);
}

function numberOption(value: unknown): number | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Back-compat `drive` for scripts/dogfood-architecture-review.js, which calls
// `drive(runner, run.id, { now, agentConfig })` — the OLD drive arg order.
// v2's shell/drive.ts drive is `drive(runId, cwd, options)` and never uses a
// runner object (it resolves the run from cwd), so this adapter forwards the
// runner's cwd. The script's require for `drive` points at THIS module so its
// call shape stays unchanged (require-path change only).
import { drive as driveImpl, DriveOptions, DriveResult } from "./drive";

export function drive(runner: CoolWorkflowRunner, runId: string, options: DriveOptions = {}): DriveResult {
  const cwd = (runner && (runner as unknown as { baseDir?: string }).baseDir) || process.cwd();
  return driveImpl(runId, cwd, options);
}
