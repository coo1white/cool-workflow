import fs from "node:fs";
import path from "node:path";
import { CommentRecord, DispatchManifest, LoadedWorkflowApp, MetricsReport, ReviewStatusReport, RunSummary, WorkflowAppSummary, WorkflowAppValidationResult, WorkflowRun } from "./types";
import { slugify } from "./workflow-api";
import { WorkflowAppValidationError, loadWorkflowAppFromEntrypoint, loadWorkflowAppFromManifest, renderWorkflowAppEntrypointTemplate, renderWorkflowAppManifestTemplate, renderWorkflowAppTemplate, summarizeWorkflowApp, validateWorkflowApp, workflowAppRunMetadata } from "./workflow-app-framework";
import { nextDispatchTasks } from "./dispatch";

import { loadRunFromCwd, saveCheckpoint, writeJson } from "./state";

import { loadCostPolicy, showMetricsReport } from "./observability";

import { createPipelineRunner } from "./pipeline-runner";
import { getWorkerScope, listWorkerScopes, reclaimOrphans, validateWorkerBoundary, writeWorkerManifest } from "./worker-isolation";
import { listBundledSandboxProfiles, sandboxContextForValidation, showBundledSandboxProfile, validateSandboxProfileFile } from "./sandbox-profile";
import { backendListPayload, backendProbePayload, backendShowPayload } from "./execution-backend";
import { buildOperatorGraph, summarizeOperatorCandidates, summarizeOperatorCommits, summarizeOperatorFeedback, summarizeOperatorRun, summarizeOperatorWorkers } from "./operator-ux";
import { evidenceProvenance, recordHostAttestation, recordSandboxPolicyDecision, summarizeTrustAudit, workerTrustAudit } from "./trust-audit";
import { summarizeMultiAgentTrust } from "./multi-agent-trust";
import { buildMultiAgentGraph, summarizeMultiAgent } from "./multi-agent";

import { buildMultiAgentOperatorGraph, summarizeMultiAgentOperator } from "./multi-agent-operator-ux";
import { compareMultiAgentReplay, createMultiAgentReplaySnapshot, gateMultiAgentEval, replayMultiAgentSnapshot, reportMultiAgentEval, scoreMultiAgentReplay } from "./multi-agent-eval";
import { snapshotNode, diffNodeSnapshots, replayNodeSnapshot, verifyNodeReplay, readNodeSnapshot, readNodeReplay } from "./node-snapshot";

import { buildCompactGraph, buildStateExplosionReport, loadStateExplosionSummaryIndex, refreshStateExplosionSummaries, showStateExplosionSummary, summarizeBlackboardDigest } from "./state-explosion";
import { buildEvidenceReasoningReport, loadEvidenceReasoningIndex, refreshEvidenceReasoning, showEvidenceReasoning } from "./evidence-reasoning";
import { summarizeRun, writeReport } from "./orchestrator/report";
import { graphViewOption, graphViewsOption, numberOption, stringOption, validationIssuesFromError, withoutHostRunKeys } from "./orchestrator/cli-options";
import * as auditOps from "./orchestrator/audit-operations";
import * as candidateOps from "./orchestrator/candidate-operations";
import * as collaborationOps from "./orchestrator/collaboration-operations";
import * as maOps from "./orchestrator/multi-agent-operations";
import * as hostOps from "./orchestrator/host-operations";
import * as feedbackOps from "./orchestrator/feedback-operations";
import * as topologyOps from "./orchestrator/topology-operations";
import * as lifecycleOps from "./orchestrator/lifecycle-operations";
import * as migrationOps from "./orchestrator/migration-operations";
import { bold, dim } from "./term";

// CoolWorkflowRunner — the single FACADE both surfaces (cli.ts and the MCP server)
// call through. It is deliberately WIDE but THIN: each method either
//   (a) loads the run's durable state and delegates to a domain function in
//       ./orchestrator/*-operations.ts — the v0.1.40 self-audit "router pattern":
//       one thin delegator per capability, NOT a god-object to dismantle; or
//   (b) holds a small amount of surface-shared logic (app/worker loaders, report
//       composition, read-snapshot-then-op).
// The high method count is INTENTIONAL — it is the union of every both-surface
// capability — and the fail-closed CLI<->MCP parity gate keeps each one honest (a
// method present on one surface but not the other is exactly the drift it forbids).
//
// FreeBSD-audit R3 ("142-method god-facade with no-op passthroughs") was assessed
// and CLOSED as won't-fix: of 141 public methods exactly ONE is a true
// runner->runner forward (collaborationReject -> collaborationApprove(...,"reject")),
// and it is kept on purpose — it is a registered capability `entry` bound to the
// parity gate AND an intent-revealing veto verb, so collapsing it would be a
// behavior-neutral readability LOSS touching both surfaces. Dismantling the facade
// is an explicit anti-goal (small kernel, explicit delegation — see DIRECTION.md).
export class CoolWorkflowRunner {
  pluginRoot: string;
  workflowsDir: string;
  appsDir: string;
  // F7: the directory a run is resolved against (replaces the former process.chdir
  // bracket in capability-core). undefined => fall back to process.cwd(). The runner
  // reads runs from disk per call (no in-memory run state), so withBaseDir hands back
  // a cheap scoped clone instead of mutating the global process cwd.
  readonly baseDir?: string;

  constructor({ pluginRoot, baseDir }: { pluginRoot: string; baseDir?: string }) {
    this.pluginRoot = resolvePluginRoot(pluginRoot);
    this.workflowsDir = path.join(this.pluginRoot, "workflows");
    this.appsDir = path.join(this.pluginRoot, "apps");
    this.baseDir = baseDir ? path.resolve(baseDir) : undefined;
  }

  /** Return a runner that resolves runs against `dir` instead of process.cwd(),
   *  WITHOUT chdir-ing the process (F7). Same instance when the dir is unchanged. */
  withBaseDir(dir: string | undefined): CoolWorkflowRunner {
    const resolved = dir ? path.resolve(dir) : undefined;
    if (resolved === this.baseDir) return this;
    return new CoolWorkflowRunner({ pluginRoot: this.pluginRoot, baseDir: resolved });
  }

  listWorkflows(): Array<{ id: string; title: string; summary: string; file: string }> {
    return this.loadWorkflowApps().map((record) => {
      const summary = summarizeWorkflowApp(record);
      return {
        id: summary.id,
        title: summary.title,
        summary: summary.summary,
        file: summary.file
      };
    });
  }

  listApps(): WorkflowAppSummary[] {
    return this.loadWorkflowApps().map((record) => summarizeWorkflowApp(record));
  }

  showApp(appId: string): Record<string, unknown> {
    const record = this.loadWorkflowAppById(appId);
    const summary = summarizeWorkflowApp(record);
    return {
      ...summary,
      source: record.source,
      app: {
        schemaVersion: record.app.schemaVersion,
        id: record.app.id,
        title: record.app.title,
        summary: record.app.summary || "",
        version: record.app.version,
        author: record.app.author,
        inputs: record.app.inputs || record.app.workflow.inputs,
        sandboxProfiles: record.app.sandboxProfiles || record.app.workflow.sandboxProfiles || [],
        compatibility: record.app.compatibility,
        metadata: record.app.metadata || {}
      },
      workflow: {
        id: record.app.workflow.id,
        title: record.app.workflow.title,
        summary: record.app.workflow.summary || "",
        limits: record.app.workflow.limits,
        inputs: record.app.workflow.inputs,
        sandboxProfiles: record.app.workflow.sandboxProfiles || [],
        phases: record.app.workflow.phases.map((phase) => ({
          id: phase.id,
          name: phase.name,
          status: phase.status,
          tasks: phase.tasks.map((task) => ({
            id: task.id,
            kind: task.kind,
            requiresEvidence: Boolean(task.requiresEvidence),
            sandboxProfileId: task.sandboxProfileId
          }))
        }))
      }
    };
  }

  validateApp(target: string): WorkflowAppValidationResult {
    try {
      const record = this.loadWorkflowAppTarget(target);
      const result = validateWorkflowApp(record.app, {
        appPath: record.source.manifestPath || record.source.entrypointPath || record.source.path
      });
      return {
        ...result,
        summary: summarizeWorkflowApp(record)
      };
    } catch (error) {
      const issues = validationIssuesFromError(error);
      return {
        valid: false,
        appId: target,
        appPath: this.resolveFromBase(target),
        issues
      };
    }
  }

  initApp(appId: string, options: Record<string, unknown>): { id: string; manifestPath: string; entrypointPath: string } {
    const id = slugify(appId);
    if (!id) throw new Error("App id must include at least one letter or digit");
    const title = String(options.title || titleize(id));
    const destinationDir = this.resolveFromBase(String(options.directory || options.output || path.join(this.appsDir, id)));
    const manifestPath = path.join(destinationDir, "app.json");
    const entrypointPath = path.join(destinationDir, "workflow.js");
    if (!options.force && (fs.existsSync(manifestPath) || fs.existsSync(entrypointPath))) {
      throw new Error(`Refusing to overwrite existing workflow app: ${destinationDir}`);
    }
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.writeFileSync(manifestPath, renderWorkflowAppManifestTemplate(id, title), "utf8");
    fs.writeFileSync(entrypointPath, renderWorkflowAppEntrypointTemplate(id, title), "utf8");
    const validation = this.validateApp(manifestPath);
    if (!validation.valid) {
      throw new WorkflowAppValidationError("Generated workflow app is invalid", validation.issues);
    }
    return { id, manifestPath, entrypointPath };
  }

  packageApp(appId: string, options: Record<string, unknown> = {}): { id: string; version: string; path: string } {
    const record = this.loadWorkflowAppById(appId);
    const destination = this.resolveFromBase(
      String(options.output || path.join(".cw", "packages", `${record.app.id}-${record.app.version}.cwapp.json`))
    );
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    writeJson(destination, {
      schemaVersion: 1,
      app: workflowAppRunMetadata(record),
      workflow: record.app.workflow,
      packagedAt: new Date().toISOString()
    });
    return { id: record.app.id, version: record.app.version, path: destination };
  }

  init(workflowId: string, options: Record<string, unknown>): { id: string; path: string } {
    const id = slugify(workflowId);
    if (!id) throw new Error("Workflow id must include at least one letter or digit");
    const title = String(options.title || titleize(id));
    const destination = this.resolveFromBase(
      String(options.output || path.join(this.workflowsDir, `${id}.workflow.js`))
    );
    if (fs.existsSync(destination) && !options.force) {
      throw new Error(`Refusing to overwrite existing workflow: ${destination}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, renderWorkflowAppTemplate(id, title), "utf8");
    return { id, path: destination };
  }

  // Core run lifecycle — delegated to ./orchestrator/lifecycle-operations. The
  // runner resolves the workflow app record (instance-stateful) then hands the
  // engine work to the module; the runner is now a pure router.
  plan(workflowId: string, options: Record<string, unknown>): WorkflowRun {
    return lifecycleOps.plan(this.loadWorkflowAppById(workflowId), options);
  }

  status(runId: string): RunSummary {
    return summarizeRun(this.loadRun(runId));
  }

  operatorStatus(runId: string): ReturnType<typeof summarizeOperatorRun> {
    return summarizeOperatorRun(this.loadRun(runId));
  }

  next(runId: string, options: Record<string, unknown>): ReturnType<typeof nextDispatchTasks> {
    return nextDispatchTasks(this.loadRun(runId), numberOption(options.limit));
  }

  dispatch(runId: string, options: Record<string, unknown>): DispatchManifest {
    return lifecycleOps.dispatch(this.loadRun(runId), options);
  }

  recordResult(runId: string, taskId: string, resultPath: string, options: Record<string, unknown> = {}): RunSummary {
    return lifecycleOps.recordResult(this.loadRun(runId), taskId, this.resolveFromBase(resultPath), options);
  }

  listWorkers(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof listWorkerScopes> {
    return listWorkerScopes(this.loadRun(runId), {
      status: options.status ? String(options.status) as never : undefined
    });
  }

  showWorker(runId: string, workerId: string): NonNullable<ReturnType<typeof getWorkerScope>> {
    const worker = getWorkerScope(this.loadRun(runId), workerId);
    if (!worker) throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
    return worker;
  }

  reclaimOrphans(runId: string, now?: string): ReturnType<typeof reclaimOrphans> {
    return reclaimOrphans(this.loadRun(runId), now);
  }

  showWorkerManifest(runId: string, workerId: string): ReturnType<typeof writeWorkerManifest> {
    const run = this.loadRun(runId);
    const worker = getWorkerScope(run, workerId);
    if (!worker) throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
    return writeWorkerManifest(run, worker);
  }

  recordWorkerOutput(runId: string, workerId: string, resultPath: string, options: Record<string, unknown> = {}): RunSummary {
    return lifecycleOps.recordWorkerOutput(this.loadRun(runId), workerId, this.resolveFromBase(resultPath), options);
  }

  recordWorkerFailure(
    runId: string,
    workerId: string,
    message: string,
    options: Record<string, unknown> = {}
  ): ReturnType<typeof lifecycleOps.recordWorkerFailure> {
    return lifecycleOps.recordWorkerFailure(this.loadRun(runId), workerId, message, options);
  }

  validateWorker(runId: string, workerId: string, targetPath?: string): ReturnType<typeof validateWorkerBoundary> {
    return validateWorkerBoundary(this.loadRun(runId), workerId, targetPath ? { path: this.resolveFromBase(targetPath) } : {});
  }

  // Audit domain — delegated to ./orchestrator/audit-operations (v0.1.40 P3
  // router pattern). The runner stays the routing surface; the logic lives in the
  // domain module. Public signatures are unchanged.
  auditSummary(runId: string): ReturnType<typeof summarizeTrustAudit> {
    return auditOps.auditSummary(this.loadRun(runId));
  }

  auditMultiAgent(runId: string): ReturnType<typeof summarizeMultiAgentTrust> {
    return auditOps.auditMultiAgent(this.loadRun(runId));
  }

  auditPolicy(runId: string): Record<string, unknown> {
    return auditOps.auditPolicy(this.loadRun(runId));
  }

  auditRole(runId: string, roleId: string): Record<string, unknown> {
    return auditOps.auditRole(this.loadRun(runId), roleId);
  }

  auditBlackboard(runId: string): Record<string, unknown> {
    return auditOps.auditBlackboard(this.loadRun(runId));
  }

  auditJudge(runId: string): Record<string, unknown> {
    return auditOps.auditJudge(this.loadRun(runId));
  }

  workerAudit(runId: string, workerId: string): ReturnType<typeof workerTrustAudit> {
    return auditOps.workerAudit(this.loadRun(runId), workerId);
  }

  evidenceProvenance(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof evidenceProvenance> {
    return auditOps.auditEvidenceProvenance(this.loadRun(runId), options);
  }

  recordAuditAttestation(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof recordHostAttestation> {
    return auditOps.recordAuditAttestation(this.loadRun(runId), options);
  }

  recordAuditDecision(runId: string, workerId: string, options: Record<string, unknown> = {}): ReturnType<typeof recordSandboxPolicyDecision> {
    return auditOps.recordAuditDecision(this.loadRun(runId), workerId, options);
  }

  listSandboxProfiles(options: Record<string, unknown> = {}): ReturnType<typeof listBundledSandboxProfiles> {
    return listBundledSandboxProfiles(sandboxContextForValidation(String(options.cwd || this.invocationCwd())));
  }

  showSandboxProfile(profileId: string, options: Record<string, unknown> = {}): ReturnType<typeof showBundledSandboxProfile> {
    return showBundledSandboxProfile(profileId, sandboxContextForValidation(String(options.cwd || this.invocationCwd())));
  }

  validateSandboxProfile(profileFile: string, options: Record<string, unknown> = {}): ReturnType<typeof validateSandboxProfileFile> {
    return validateSandboxProfileFile(this.resolveFromBase(profileFile), sandboxContextForValidation(String(options.cwd || this.invocationCwd())));
  }

  listBackends(options: Record<string, unknown> = {}): ReturnType<typeof backendListPayload> {
    void options;
    return backendListPayload();
  }

  showBackend(backendId: string, options: Record<string, unknown> = {}): ReturnType<typeof backendShowPayload> {
    void options;
    return backendShowPayload(backendId);
  }

  probeBackend(backendId: string | undefined, options: Record<string, unknown> = {}): ReturnType<typeof backendProbePayload> {
    return backendProbePayload(backendId, { cwd: String(options.cwd || this.invocationCwd()) });
  }

  // Candidate domain — delegated to ./orchestrator/candidate-operations.
  listCandidates(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof candidateOps.listCandidates> {
    return candidateOps.listCandidates(this.loadRun(runId), options);
  }

  showCandidate(runId: string, candidateId: string): ReturnType<typeof candidateOps.showCandidate> {
    return candidateOps.showCandidate(this.loadRun(runId), candidateId);
  }

  registerCandidate(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof candidateOps.registerCandidate> {
    return candidateOps.registerCandidate(this.loadRun(runId), options);
  }

  scoreCandidate(runId: string, candidateId: string, options: Record<string, unknown> = {}): ReturnType<typeof candidateOps.scoreCandidate> {
    return candidateOps.scoreCandidate(this.loadRun(runId), candidateId, options);
  }

  rankCandidates(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof candidateOps.rankCandidates> {
    return candidateOps.rankCandidates(this.loadRun(runId), options);
  }

  selectCandidate(runId: string, candidateId: string, options: Record<string, unknown> = {}): ReturnType<typeof candidateOps.selectCandidate> {
    return candidateOps.selectCandidate(this.loadRun(runId), candidateId, options);
  }

  rejectCandidate(runId: string, candidateId: string, reason: string): ReturnType<typeof candidateOps.rejectCandidate> {
    return candidateOps.rejectCandidate(this.loadRun(runId), candidateId, reason);
  }

  // ---- Team Collaboration (v0.1.32) — delegated to ./orchestrator/collaboration-operations.
  // Append-only, host-attested (never authenticated) approvals/comments/handoffs
  // + a derived review state. Both CLI and MCP route through these methods, so
  // `cw <cmd> --json` is identical to `cw_<tool>` (the parity gate).
  collaborationApprove(runId: string, targetKind: string, targetId: string, options: Record<string, unknown> = {}, decision: "approve" | "reject" = "approve") {
    return collaborationOps.collaborationApprove(this.loadRun(runId), targetKind, targetId, options, decision);
  }

  collaborationReject(runId: string, targetKind: string, targetId: string, options: Record<string, unknown> = {}) {
    return this.collaborationApprove(runId, targetKind, targetId, options, "reject");
  }

  collaborationComment(runId: string, targetKind: string, targetId: string, options: Record<string, unknown> = {}) {
    return collaborationOps.collaborationComment(this.loadRun(runId), targetKind, targetId, options);
  }

  collaborationCommentList(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof collaborationOps.collaborationCommentList> {
    return collaborationOps.collaborationCommentList(this.loadRun(runId), options);
  }

  collaborationHandoff(runId: string, targetKind: string, targetId: string, options: Record<string, unknown> = {}) {
    return collaborationOps.collaborationHandoff(this.loadRun(runId), targetKind, targetId, options);
  }

  reviewStatus(runId: string, options: Record<string, unknown> = {}): ReviewStatusReport {
    return collaborationOps.reviewStatus(this.loadRun(runId), options);
  }

  reviewPolicy(runId: string, options: Record<string, unknown> = {}) {
    return collaborationOps.reviewPolicy(this.loadRun(runId), options);
  }

  formatReviewStatus(report: ReviewStatusReport): string {
    return collaborationOps.formatReviewStatus(report);
  }

  formatCommentList(comments: CommentRecord[]): string {
    return collaborationOps.formatCommentList(comments);
  }

  summarizeWorkerRecords(runId: string): ReturnType<typeof summarizeOperatorWorkers> {
    return summarizeOperatorWorkers(this.loadRun(runId));
  }

  summarizeCandidateOperatorRecords(runId: string): ReturnType<typeof summarizeOperatorCandidates> {
    return summarizeOperatorCandidates(this.loadRun(runId));
  }

  summarizeFeedbackRecords(runId: string): ReturnType<typeof summarizeOperatorFeedback> {
    return summarizeOperatorFeedback(this.loadRun(runId));
  }

  summarizeCommitRecords(runId: string): ReturnType<typeof summarizeOperatorCommits> {
    return summarizeOperatorCommits(this.loadRun(runId));
  }

  report(runId: string): { path: string } {
    const run = this.loadRun(runId);
    return { path: writeReport(run) };
  }

  operatorReport(runId: string): ReturnType<typeof summarizeOperatorRun> {
    const run = this.loadRun(runId);
    writeReport(run);
    return summarizeOperatorRun(run);
  }

  showContract(runId: string, contractId?: string): ReturnType<ReturnType<typeof createPipelineRunner>["getRunContract"]> {
    const run = this.loadRun(runId);
    return createPipelineRunner().getRunContract(run, contractId);
  }

  listNodes(runId: string): NonNullable<WorkflowRun["nodes"]> {
    return this.loadRun(runId).nodes || [];
  }

  showNode(runId: string, nodeId: string): NonNullable<WorkflowRun["nodes"]>[number] {
    return createPipelineRunner().getRunNode(this.loadRun(runId), nodeId);
  }

  graphNodes(runId: string): Array<{ id: string; kind: string; status: string; parents: string[]; children: string[] }> {
    return (this.loadRun(runId).nodes || []).map((node) => ({
      id: node.id,
      kind: node.kind,
      status: node.status,
      parents: node.parents,
      children: node.children
    }));
  }

  operatorGraph(runId: string): ReturnType<typeof buildOperatorGraph> {
    return buildOperatorGraph(this.loadRun(runId));
  }

  multiAgentSummary(runId: string): ReturnType<typeof summarizeMultiAgent> {
    return summarizeMultiAgent(this.loadRun(runId));
  }

  multiAgentGraph(runId: string): ReturnType<typeof buildMultiAgentGraph> {
    return buildMultiAgentGraph(this.loadRun(runId));
  }

  multiAgentOperatorStatus(runId: string): ReturnType<typeof summarizeMultiAgentOperator> {
    return summarizeMultiAgentOperator(this.loadRun(runId));
  }

  multiAgentOperatorGraph(runId: string): ReturnType<typeof buildMultiAgentOperatorGraph> {
    return buildMultiAgentOperatorGraph(this.loadRun(runId));
  }

  multiAgentDependencies(runId: string): ReturnType<typeof summarizeMultiAgentOperator>["dependencies"] {
    return summarizeMultiAgentOperator(this.loadRun(runId)).dependencies;
  }

  multiAgentFailures(runId: string): ReturnType<typeof summarizeMultiAgentOperator>["failures"] {
    return summarizeMultiAgentOperator(this.loadRun(runId)).failures;
  }

  multiAgentEvidence(runId: string): ReturnType<typeof summarizeMultiAgentOperator>["evidence"] {
    const run = this.loadRun(runId);
    const rows = summarizeMultiAgentOperator(run).evidence;
    // Additive enrichment: attach the derived rationale status so `multi-agent
    // evidence` answers WHAT + whether the WHY is recorded, without changing the
    // existing row shape (POLA: old consumers ignore the new optional field).
    const report = buildEvidenceReasoningReport(run, { index: loadEvidenceReasoningIndex(run) });
    const byId = new Map(report.chains.map((chain) => [chain.id, chain.rationaleStatus]));
    for (const row of rows) row.rationaleStatus = byId.get(row.id);
    return rows;
  }

  multiAgentReasoning(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof buildEvidenceReasoningReport> {
    const run = this.loadRun(runId);
    if (options.refresh) {
      refreshEvidenceReasoning(run);
      saveCheckpoint(run);
    }
    return showEvidenceReasoning(run, { evidenceId: stringOption(options.evidence || options.evidenceId || options.id) });
  }

  multiAgentReasoningRefresh(runId: string): ReturnType<typeof refreshEvidenceReasoning> {
    const run = this.loadRun(runId);
    const index = refreshEvidenceReasoning(run);
    saveCheckpoint(run);
    return index;
  }

  summaryRefresh(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof refreshStateExplosionSummaries> {
    const run = this.loadRun(runId);
    const index = refreshStateExplosionSummaries(run, { views: graphViewsOption(options) });
    writeReport(run);
    saveCheckpoint(run);
    return index;
  }

  summaryShow(runId: string): ReturnType<typeof showStateExplosionSummary> {
    const run = this.loadRun(runId);
    const report = showStateExplosionSummary(run);
    saveCheckpoint(run);
    return report;
  }

  /** Observability + cost report for ONE run (v0.1.31). DERIVED from durable
   *  state; persists a fingerprinted snapshot under `metrics/` but NEVER mutates
   *  the run's own state.json (no saveCheckpoint), so the source — and therefore
   *  the report — is stable across repeated reads. `now` is injectable via
   *  `args.now` for eval/replay determinism; pricing is POLICY via `--pricing`. */
  metricsShow(runId: string, args: Record<string, unknown> = {}): MetricsReport {
    const run = this.loadRun(runId);
    const policy = loadCostPolicy(args, this.pluginRoot);
    const now = typeof args.now === "string" && args.now ? args.now : new Date().toISOString();
    return showMetricsReport(run, { now, policy });
  }

  blackboardSummarize(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof summarizeBlackboardDigest> {
    return summarizeBlackboardDigest(this.loadRun(runId), stringOption(options.blackboard || options.blackboardId));
  }

  multiAgentSummarize(runId: string): ReturnType<typeof buildStateExplosionReport> {
    const run = this.loadRun(runId);
    const index = loadStateExplosionSummaryIndex(run);
    return buildStateExplosionReport(run, { index });
  }

  multiAgentGraphView(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof buildCompactGraph> {
    const view = graphViewOption(options.view);
    return buildCompactGraph(this.loadRun(runId), view, {
      focus: stringOption(options.focus),
      depth: numberOption(options.depth)
    });
  }

  stateExplosionReport(runId: string): ReturnType<typeof buildStateExplosionReport> {
    const run = this.loadRun(runId);
    const index = loadStateExplosionSummaryIndex(run);
    return buildStateExplosionReport(run, { index });
  }

  // Host multi-agent — delegated to ./orchestrator/host-operations. The runner
  // keeps the load-or-plan policy here because it owns plan().
  hostMultiAgentRun(runId: string | undefined, options: Record<string, unknown> = {}): ReturnType<typeof hostOps.hostMultiAgentRun> {
    const workflowId = stringOption(options.app || options.appId || options.workflow || options.workflowId);
    const run = runId
      ? this.loadRun(runId)
      : workflowId
        ? this.plan(workflowId, withoutHostRunKeys(options))
        : undefined;
    if (!run) throw new Error("multi-agent run requires <run-id> or --app <app-id>");
    return hostOps.hostMultiAgentRun(run, options);
  }

  hostMultiAgentStatus(runId: string): ReturnType<typeof hostOps.hostMultiAgentStatus> {
    return hostOps.hostMultiAgentStatus(this.loadRun(runId));
  }

  hostMultiAgentStep(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof hostOps.hostMultiAgentStep> {
    return hostOps.hostMultiAgentStep(this.loadRun(runId), options);
  }

  hostMultiAgentBlackboard(runId: string, action?: string, options: Record<string, unknown> = {}): ReturnType<typeof hostOps.hostMultiAgentBlackboard> {
    return hostOps.hostMultiAgentBlackboard(this.loadRun(runId), action, options);
  }

  hostMultiAgentScore(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof hostOps.hostMultiAgentScore> {
    return hostOps.hostMultiAgentScore(this.loadRun(runId), options);
  }

  hostMultiAgentSelect(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof hostOps.hostMultiAgentSelect> {
    return hostOps.hostMultiAgentSelect(this.loadRun(runId), options);
  }

  evalSnapshot(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof createMultiAgentReplaySnapshot> {
    return createMultiAgentReplaySnapshot(this.loadRun(runId), options);
  }

  evalReplay(target: string, options: Record<string, unknown> = {}): ReturnType<typeof replayMultiAgentSnapshot> {
    return replayMultiAgentSnapshot(target, options);
  }

  evalCompare(baseline: string, replay: string): ReturnType<typeof compareMultiAgentReplay> {
    return compareMultiAgentReplay(baseline, replay);
  }

  evalScore(target: string): ReturnType<typeof scoreMultiAgentReplay> {
    return scoreMultiAgentReplay(target);
  }

  evalGate(target: string): ReturnType<typeof gateMultiAgentEval> {
    return gateMultiAgentEval(target);
  }

  evalReport(target: string): ReturnType<typeof reportMultiAgentEval> {
    return reportMultiAgentEval(target);
  }

  // ---- node snapshot / diff / replay (v0.1.35) ----------------------------
  nodeSnapshot(runId: string, nodeId: string, options: Record<string, unknown> = {}): ReturnType<typeof snapshotNode> {
    return snapshotNode(this.loadRun(runId), nodeId, options);
  }

  nodeDiff(runId: string, baselineSnapshotId: string, candidateSnapshotId: string): ReturnType<typeof diffNodeSnapshots> {
    const run = this.loadRun(runId);
    return diffNodeSnapshots(readNodeSnapshot(run, baselineSnapshotId), readNodeSnapshot(run, candidateSnapshotId));
  }

  nodeReplay(runId: string, snapshotId: string, options: Record<string, unknown> = {}): ReturnType<typeof replayNodeSnapshot> {
    const run = this.loadRun(runId);
    return replayNodeSnapshot(run, readNodeSnapshot(run, snapshotId), options);
  }

  nodeReplayVerify(runId: string, replayId: string, options: Record<string, unknown> = {}): ReturnType<typeof verifyNodeReplay> {
    const run = this.loadRun(runId);
    return verifyNodeReplay(run, readNodeReplay(run, replayId), options);
  }

  // ---- contract migration (v0.1.36) ---------------------------------------
  // Contract migration — delegated to ./orchestrator/migration-operations.
  migrationList(): ReturnType<typeof migrationOps.migrationList> {
    return migrationOps.migrationList();
  }

  migrationCheck(target: string, options: Record<string, unknown> = {}): ReturnType<typeof migrationOps.migrationCheck> {
    return migrationOps.migrationCheck(target, options);
  }

  migrationProve(target: string, options: Record<string, unknown> = {}): ReturnType<typeof migrationOps.migrationProve> {
    return migrationOps.migrationProve(target, options);
  }

  loadMigrationSnapshot(target: string, options: Record<string, unknown>): ReturnType<typeof migrationOps.loadMigrationSnapshot> {
    return migrationOps.loadMigrationSnapshot(target, options);
  }

  // Topology — delegated to ./orchestrator/topology-operations.
  listTopologies(): ReturnType<typeof topologyOps.listTopologies> {
    return topologyOps.listTopologies();
  }

  showTopology(topologyId: string): ReturnType<typeof topologyOps.showTopology> {
    return topologyOps.showTopology(topologyId);
  }

  validateTopology(topologyId: string): ReturnType<typeof topologyOps.validateTopology> {
    return topologyOps.validateTopology(topologyId);
  }

  applyTopology(runId: string, topologyId: string, options: Record<string, unknown> = {}): ReturnType<typeof topologyOps.applyTopology> {
    return topologyOps.applyTopology(this.loadRun(runId), topologyId, options);
  }

  showTopologyRun(runId: string, topologyRunId: string): ReturnType<typeof topologyOps.showTopologyRun> {
    return topologyOps.showTopologyRun(this.loadRun(runId), topologyRunId);
  }

  topologySummary(runId: string): ReturnType<typeof topologyOps.topologySummary> {
    return topologyOps.topologySummary(this.loadRun(runId));
  }

  topologyGraph(runId: string): ReturnType<typeof topologyOps.topologyGraph> {
    return topologyOps.topologyGraph(this.loadRun(runId));
  }

  // Multi-agent lifecycle + blackboard — delegated to ./orchestrator/multi-agent-operations.
  createMultiAgentRun(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.createMultiAgentRun> {
    return maOps.createMultiAgentRun(this.loadRun(runId), options);
  }

  transitionMultiAgentRun(runId: string, multiAgentRunId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.transitionMultiAgentRun> {
    return maOps.transitionMultiAgentRun(this.loadRun(runId), multiAgentRunId, options);
  }

  createAgentRole(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.createAgentRole> {
    return maOps.createAgentRole(this.loadRun(runId), options);
  }

  createAgentGroup(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.createAgentGroup> {
    return maOps.createAgentGroup(this.loadRun(runId), options);
  }

  assignAgentMembership(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.assignAgentMembership> {
    return maOps.assignAgentMembership(this.loadRun(runId), options);
  }

  createAgentFanout(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.createAgentFanout> {
    return maOps.createAgentFanout(this.loadRun(runId), options);
  }

  collectAgentFanin(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.collectAgentFanin> {
    return maOps.collectAgentFanin(this.loadRun(runId), options);
  }

  showMultiAgentRun(runId: string, multiAgentRunId: string): ReturnType<typeof maOps.showMultiAgentRun> {
    return maOps.showMultiAgentRun(this.loadRun(runId), multiAgentRunId);
  }

  showAgentRole(runId: string, roleId: string): ReturnType<typeof maOps.showAgentRole> {
    return maOps.showAgentRole(this.loadRun(runId), roleId);
  }

  showAgentGroup(runId: string, groupId: string): ReturnType<typeof maOps.showAgentGroup> {
    return maOps.showAgentGroup(this.loadRun(runId), groupId);
  }

  showAgentMembership(runId: string, membershipId: string): ReturnType<typeof maOps.showAgentMembership> {
    return maOps.showAgentMembership(this.loadRun(runId), membershipId);
  }

  showAgentFanout(runId: string, fanoutId: string): ReturnType<typeof maOps.showAgentFanout> {
    return maOps.showAgentFanout(this.loadRun(runId), fanoutId);
  }

  showAgentFanin(runId: string, faninId: string): ReturnType<typeof maOps.showAgentFanin> {
    return maOps.showAgentFanin(this.loadRun(runId), faninId);
  }

  blackboardSummary(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.blackboardSummary> {
    return maOps.blackboardSummary(this.loadRun(runId), options);
  }

  coordinatorSummary(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.blackboardSummary> {
    return maOps.blackboardSummary(this.loadRun(runId), options);
  }

  blackboardGraph(runId: string): ReturnType<typeof maOps.blackboardGraph> {
    return maOps.blackboardGraph(this.loadRun(runId));
  }

  resolveRunBlackboard(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.resolveRunBlackboard> {
    return maOps.resolveRunBlackboard(this.loadRun(runId), options);
  }

  createBlackboardTopic(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.createBlackboardTopic> {
    return maOps.createBlackboardTopic(this.loadRun(runId), options);
  }

  postBlackboardMessage(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.postBlackboardMessage> {
    return maOps.postBlackboardMessage(this.loadRun(runId), options);
  }

  listBlackboardMessages(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.listBlackboardMessages> {
    return maOps.listBlackboardMessages(this.loadRun(runId), options);
  }

  putBlackboardContext(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.putBlackboardContext> {
    return maOps.putBlackboardContext(this.loadRun(runId), options);
  }

  addBlackboardArtifact(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.addBlackboardArtifact> {
    return maOps.addBlackboardArtifact(this.loadRun(runId), options);
  }

  listBlackboardArtifacts(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.listBlackboardArtifacts> {
    return maOps.listBlackboardArtifacts(this.loadRun(runId), options);
  }

  snapshotBlackboard(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.snapshotBlackboard> {
    return maOps.snapshotBlackboard(this.loadRun(runId), options);
  }

  recordCoordinatorDecision(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof maOps.recordCoordinatorDecision> {
    return maOps.recordCoordinatorDecision(this.loadRun(runId), options);
  }

  checkState(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof lifecycleOps.checkState> {
    return lifecycleOps.checkState(runId, options);
  }

  commit(runId: string, input: string | Record<string, unknown> = {}): ReturnType<typeof lifecycleOps.commit> {
    return lifecycleOps.commit(this.loadRun(runId), input);
  }

  // Feedback — delegated to ./orchestrator/feedback-operations.
  collectFeedback(runId: string): ReturnType<typeof feedbackOps.collectFeedback> {
    return feedbackOps.collectFeedback(this.loadRun(runId));
  }

  listFeedback(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof feedbackOps.listFeedback> {
    return feedbackOps.listFeedback(this.loadRun(runId), options);
  }

  showFeedback(runId: string, feedbackId: string): ReturnType<typeof feedbackOps.showFeedback> {
    return feedbackOps.showFeedback(this.loadRun(runId), feedbackId);
  }

  createFeedbackTask(runId: string, feedbackId: string, options: Record<string, unknown> = {}): ReturnType<typeof feedbackOps.createFeedbackTask> {
    return feedbackOps.createFeedbackTask(this.loadRun(runId), feedbackId, options);
  }

  resolveFeedback(runId: string, feedbackId: string, options: Record<string, unknown> = {}): ReturnType<typeof feedbackOps.resolveFeedback> {
    return feedbackOps.resolveFeedback(this.loadRun(runId), feedbackId, options);
  }

  loadRun(runId: string): WorkflowRun {
    return loadRunFromCwd(runId, this.baseDir);
  }

  private invocationCwd(): string {
    return this.baseDir || process.cwd();
  }

  private resolveFromBase(target: string): string {
    return path.resolve(this.invocationCwd(), target);
  }

  private loadWorkflowAppById(appId: string): LoadedWorkflowApp {
    const record = this.loadWorkflowApps().find((candidate) => candidate.app.id === appId);
    if (!record) throw new Error(`Workflow app not found: ${appId}`);
    return record;
  }

  private loadWorkflowAppTarget(target: string): LoadedWorkflowApp {
    if (!target) throw new Error("Missing workflow app path or id");
    const resolved = this.resolveFromBase(target);
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) return loadWorkflowAppFromManifest(path.join(resolved, "app.json"));
      if (path.basename(resolved) === "app.json" || resolved.endsWith(".json")) return loadWorkflowAppFromManifest(resolved);
      return loadWorkflowAppFromEntrypoint(resolved);
    }
    return this.loadWorkflowAppById(target);
  }

  private loadWorkflowApps(): LoadedWorkflowApp[] {
    const records = [
      ...this.loadWorkflowFiles().map((file) => loadWorkflowAppFromEntrypoint(file)),
      ...this.loadAppManifestFiles().map((file) => loadWorkflowAppFromManifest(file))
    ].sort((left, right) => {
      const byId = left.app.id.localeCompare(right.app.id);
      if (byId) return byId;
      return (left.source.manifestPath || left.source.entrypointPath || left.source.path)
        .localeCompare(right.source.manifestPath || right.source.entrypointPath || right.source.path);
    });
    const seen = new Map<string, LoadedWorkflowApp>();
    for (const record of records) {
      const previous = seen.get(record.app.id);
      if (previous) {
        throw new Error(
          `Duplicate workflow app id ${record.app.id}: ${previous.source.manifestPath || previous.source.entrypointPath || previous.source.path} and ${record.source.manifestPath || record.source.entrypointPath || record.source.path}`
        );
      }
      seen.set(record.app.id, record);
    }
    return records;
  }

  private loadWorkflowFiles(): string[] {
    if (!fs.existsSync(this.workflowsDir)) return [];
    return fs
      .readdirSync(this.workflowsDir)
      .filter((file) => file.endsWith(".workflow.js"))
      .sort()
      .map((file) => path.join(this.workflowsDir, file));
  }

  private loadAppManifestFiles(): string[] {
    if (!fs.existsSync(this.appsDir)) return [];
    return fs
      .readdirSync(this.appsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.appsDir, entry.name, "app.json"))
      .filter((file) => fs.existsSync(file))
      .sort();
  }
}

export function parseArgv(argv: string[]): {
  command?: string;
  positionals: string[];
  options: Record<string, unknown>;
} {
  const [command, ...rest] = argv;
  const options: Record<string, unknown> = {};
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--") {
      // POSIX end-of-options: everything after `--` is a positional, even if it
      // begins with `--`. Lets a legitimate value that starts with `--` through.
      for (let restIndex = index + 1; restIndex < rest.length; restIndex += 1) positionals.push(rest[restIndex]);
      break;
    }
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    if (!token.startsWith("--")) {
      // Single-dash short flag aliases: -q → question, -r → repo, -a → agent-command, -h → help, -v → version
      const shortMap: Record<string, string> = { q: "question", r: "repo", a: "agent-command", h: "help", v: "version" };
      const flag = token.slice(1);
      // Handle combined short flags like -qr (not common but safe to ignore)
      const key = shortMap[flag] || flag;
      const val = rest[index + 1] && !rest[index + 1].startsWith("-") ? rest[++index] : true;
      appendOption(options, key, val);
      continue;
    }
    const withoutPrefix = token.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    let key: string;
    let value: string | boolean;
    if (equalsIndex >= 0) {
      key = withoutPrefix.slice(0, equalsIndex);
      value = withoutPrefix.slice(equalsIndex + 1);
    } else {
      key = withoutPrefix;
      value = rest[index + 1] && !rest[index + 1].startsWith("--") ? rest[++index] : true;
    }
    appendOption(options, key, value);
  }
  return { command, positionals, options };
}

/** All known top-level CW commands. Used for "did you mean?" suggestions. */
export const KNOWN_COMMANDS = new Set([
  "help", "list", "doctor", "info", "search", "man", "init", "quickstart", "plan", "status", "next",
  "dispatch", "result", "state", "commit", "report", "app", "sandbox",
  "backend", "contract", "node", "feedback", "worker", "audit", "candidate",
  "review", "loop", "schedule", "routine", "registry", "run", "queue",
  "history", "audit-run", "multi-agent", "topology", "summary", "blackboard",
  "coordinator", "metrics", "operator", "sched", "gc", "telemetry",
  "migration", "demo", "workbench", "approve", "reject", "comment", "handoff",
  "graph", "eval", "version", "update", "fix"
]);

/** Levenshtein distance between two short strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Suggest the closest known command for a typo. Returns undefined if no match
 *  within half the length of the input (avoiding wild guesses on short strings). */
export function suggestCommand(input: string): string | undefined {
  if (!input || input.length < 2) return undefined;
  const lower = input.toLowerCase();
  let best = "";
  let bestDist = Infinity;
  for (const cmd of KNOWN_COMMANDS) {
    const dist = levenshtein(lower, cmd);
    if (dist < bestDist) { best = cmd; bestDist = dist; }
  }
  // Threshold: distance must be <= half the input length AND <= 3
  if (bestDist <= 3 && bestDist <= lower.length / 2) return best;
  return undefined;
}

export function formatSearchResults(keyword: string, results: Array<{ id: string; title: string; summary: string }>): string {
  if (!results.length) return `No workflows matched "${keyword}".\n  Tip: cw list for all available workflows.`;
  return [
    bold(`${results.length} workflow${results.length !== 1 ? "s" : ""} matching "${keyword}"`),
    ...results.map((r) => `  ${r.id} — ${r.title}\n    ${dim(r.summary.slice(0, 120))}${r.summary.length > 120 ? "…" : ""}`),
    "",
    dim("Use cw info <id> for full details.")
  ].join("\n");
}

export function formatInfo(appId: string, data: Record<string, unknown>): string {
  const app = (data.app || {}) as Record<string, unknown>;
  const inputs = (Array.isArray(data.inputs) ? data.inputs : []) as Array<Record<string, unknown>>;
  const phases = (Array.isArray(data.phases) ? data.phases : []) as Array<Record<string, unknown>>;
  const lines: string[] = [bold(`cw info ${appId}`)];
  if (data.title) lines.push(`  Title: ${data.title}`);
  if (data.version) lines.push(`  Version: ${data.version}`);
  if (data.summary) lines.push(`  Summary: ${data.summary}`);
  if (data.author) lines.push(`  Author: ${typeof data.author === "object" ? (data.author as Record<string, string>).name : data.author}`);
  if (data.compatible !== undefined) lines.push(`  Compatible: ${data.compatible ? "yes" : "no"}`);
  if (inputs.length > 0) {
    lines.push("  Inputs:");
    for (const input of inputs) {
      const name = input.name || "";
      const type = input.type || "string";
      const required = input.required ? ", required" : "";
      const def = input.default ? `, default: ${input.default}` : "";
      const desc = input.description ? ` — ${input.description}` : "";
      lines.push(`    - ${name} (${type}${required}${def})${desc}`);
    }
  }
  if (Array.isArray(data.sandboxProfiles) && data.sandboxProfiles.length > 0) {
    lines.push(`  Sandbox: ${data.sandboxProfiles.join(", ")}`);
  }
  const taskCount = data.taskCount || 0;
  if (phases.length > 0) {
    lines.push(`  Phases: ${phases.length} phase${phases.length !== 1 ? "s" : ""}, ${taskCount} task${taskCount !== 1 ? "s" : ""}`);
  }
  lines.push(`  Run: cw quickstart ${appId} --repo . --question "..."`);
  return lines.join("\n");
}

export function formatHelp(): string {
  // Help is written to stdout, so color must key off stdout (not the term default).
  const out = process.stdout;
  const moreCommands = (
    "list search info init plan status next dispatch result state commit report app " +
    "sandbox backend contract node feedback worker audit candidate review loop schedule " +
    "routine registry run queue history quickstart audit-run multi-agent topology summary " +
    "blackboard coordinator metrics operator sched gc telemetry migration demo workbench " +
    "approve reject comment handoff graph eval man version update fix"
  ).split(" ");
  // Wrap the command list into clean, indented, pipe-joined lines (<=76 cols) instead of
  // one 400-char line that wraps raggedly and merges with the next shell prompt. Pipe-joined
  // (no internal spaces) keeps it parseable by the CLI/MCP parity help-token check.
  const wrapped: string[] = [];
  let line = "  ";
  for (const cmd of moreCommands) {
    const sep = line.length > 2 ? "|" : "";
    if (line.length + sep.length + cmd.length > 76) { wrapped.push(line); line = "  "; }
    line += (line.length > 2 ? "|" : "") + cmd;
  }
  if (line.length > 2) wrapped.push(line);
  return [
    bold("Cool Workflow", out),
    "",
    "  -q \"question\" [-claude|-codex|-deepseek]  Ask a question, get a report",
    "  version                                   Show version",
    "  update                                    Update to latest release",
    "  doctor                                    Check setup",
    "  fix                                       Show fix commands for setup issues",
    "",
    bold("Flags", out),
    "  -q, --question TEXT    The task or question to answer",
    "  -r, --repo PATH        Target repository path (default: .)",
    "  -claude                Use Claude agent",
    "  -codex                 Use Codex agent",
    "  -deepseek              Use DeepSeek (via opencode)",
    "",
    bold("More commands", out),
    ...wrapped
  ].join("\n");
}

function appendOption(options: Record<string, unknown>, key: string, value: string | boolean): void {
  if (Object.prototype.hasOwnProperty.call(options, key)) {
    const current = options[key];
    options[key] = Array.isArray(current) ? [...current, value] : [current, value];
    return;
  }
  options[key] = value;
}

function resolvePluginRoot(candidate: string): string {
  let current = path.resolve(candidate);
  for (let depth = 0; depth < 5; depth += 1) {
    if (fs.existsSync(path.join(current, "workflows")) && fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error("Run cw.js from the cool-workflow plugin directory");
}

function titleize(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
