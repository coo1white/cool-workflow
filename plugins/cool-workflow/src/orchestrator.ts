import fs from "node:fs";
import path from "node:path";
import { CommentRecord, DispatchManifest, LoadedWorkflowApp, MetricsReport, ReviewStatusReport, RunSummary, WorkflowAppSummary, WorkflowAppValidationResult, WorkflowDefinition, WorkflowRun } from "./types";
import { slugify } from "./workflow-api";
import { WorkflowAppValidationError, loadWorkflowAppFromEntrypoint, loadWorkflowAppFromManifest, renderWorkflowAppEntrypointTemplate, renderWorkflowAppManifestTemplate, renderWorkflowAppTemplate, summarizeWorkflowApp, validateWorkflowApp, workflowAppRunMetadata } from "./workflow-app-framework";
import { nextDispatchTasks } from "./dispatch";

import { loadRunFromCwd, saveCheckpoint, writeJson } from "./state";

import { loadCostPolicy, showMetricsReport } from "./observability";

import { createPipelineRunner } from "./pipeline-runner";
import { getWorkerScope, listWorkerScopes, reclaimOrphans, validateWorkerBoundary, writeWorkerManifest } from "./worker-isolation";
import { summarizeCandidates } from "./candidate-scoring";
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

export class CoolWorkflowRunner {
  pluginRoot: string;
  workflowsDir: string;
  appsDir: string;

  constructor({ pluginRoot }: { pluginRoot: string }) {
    this.pluginRoot = resolvePluginRoot(pluginRoot);
    this.workflowsDir = path.join(this.pluginRoot, "workflows");
    this.appsDir = path.join(this.pluginRoot, "apps");
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
        appPath: path.resolve(target),
        issues
      };
    }
  }

  initApp(appId: string, options: Record<string, unknown>): { id: string; manifestPath: string; entrypointPath: string } {
    const id = slugify(appId);
    if (!id) throw new Error("App id must include at least one letter or digit");
    const title = String(options.title || titleize(id));
    const destinationDir = path.resolve(String(options.directory || options.output || path.join(this.appsDir, id)));
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
    const destination = path.resolve(
      String(
        options.output ||
          path.join(process.cwd(), ".cw", "packages", `${record.app.id}-${record.app.version}.cwapp.json`)
      )
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
    const destination = path.resolve(
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
    return lifecycleOps.recordResult(this.loadRun(runId), taskId, resultPath, options);
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
    return lifecycleOps.recordWorkerOutput(this.loadRun(runId), workerId, resultPath, options);
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
    return validateWorkerBoundary(this.loadRun(runId), workerId, targetPath ? { path: targetPath } : {});
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
    return listBundledSandboxProfiles(sandboxContextForValidation(String(options.cwd || process.cwd())));
  }

  showSandboxProfile(profileId: string, options: Record<string, unknown> = {}): ReturnType<typeof showBundledSandboxProfile> {
    return showBundledSandboxProfile(profileId, sandboxContextForValidation(String(options.cwd || process.cwd())));
  }

  validateSandboxProfile(profileFile: string, options: Record<string, unknown> = {}): ReturnType<typeof validateSandboxProfileFile> {
    return validateSandboxProfileFile(profileFile, sandboxContextForValidation(String(options.cwd || process.cwd())));
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
    return backendProbePayload(backendId, { cwd: String(options.cwd || process.cwd()) });
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

  summarizeCandidateRecords(runId: string): ReturnType<typeof summarizeCandidates> {
    return summarizeCandidates(this.loadRun(runId));
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
    return loadRunFromCwd(runId);
  }

  loadWorkflowById(workflowId: string): WorkflowDefinition {
    return this.loadWorkflowAppById(workflowId).app.workflow;
  }

  private loadWorkflowAppById(appId: string): LoadedWorkflowApp {
    const record = this.loadWorkflowApps().find((candidate) => candidate.app.id === appId);
    if (!record) throw new Error(`Workflow app not found: ${appId}`);
    return record;
  }

  private loadWorkflowAppTarget(target: string): LoadedWorkflowApp {
    if (!target) throw new Error("Missing workflow app path or id");
    const resolved = path.resolve(target);
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
    if (!token.startsWith("--")) {
      positionals.push(token);
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

export function formatHelp(): string {
  return [
    "Cool Workflow",
    "",
    "Quick start (ONE command — plan -> drive -> report):",
    "  quickstart [architecture-review] --repo PATH --question TEXT --agent-command \"claude -p\"",
    "    (delegates each worker to YOUR configured agent backend; --preview for a dry run)",
    "",
    "Commands:",
    "  list",
    "  init <workflow-id> [--title TEXT] [--output PATH]",
    "  quickstart [app-id] [--repo PATH] [--question TEXT] [--agent-command CMD] [--once] [--preview]",
    "  plan <workflow-id> [--repo PATH] [--question TEXT] [--invariant TEXT]",
    "  status <run-id> [--json|--format json]",
    "  next <run-id> [--limit N]",
    "  graph <run-id> [--json]",
    "  dispatch <run-id> [--limit N] [--sandbox PROFILE] [--backend node|bun|shell|container|remote|ci]",
    "  result <run-id> <task-id> <result-file>",
    "  state check <run-id> [--state PATH] [--write]",
    "  commit <run-id> --verifier <node-id> [--reason TEXT]",
    "  commit <run-id> --candidate <candidate-id> [--reason TEXT]",
    "  commit <run-id> --selection <selection-id> [--reason TEXT]",
    "  commit <run-id> --allow-unverified-checkpoint [--reason TEXT]",
    "  commit summary <run-id> [--json]",
    "  report <run-id> [--show|--summary]",
    "  app list|show|validate|init|package",
    "  sandbox list|show|validate",
    "  backend list|show|probe [backend-id]",
    "  contract show <run-id> [contract-id]",
    "  node list|show|graph <run-id>",
    "  feedback list|summary|show|collect|task|resolve <run-id>",
    "  worker list|summary|show|manifest|output|fail|validate <run-id>",
    "  audit summary <run-id>",
    "  audit worker <run-id> <worker-id>",
    "  audit provenance <run-id> [--worker ID|--candidate ID|--commit ID]",
    "  audit multi-agent <run-id> [--json]",
    "  audit policy <run-id> [--json]",
    "  audit role <run-id> <role-id> [--json]",
    "  audit blackboard <run-id> [--json]",
    "  audit judge <run-id> [--json]",
    "  audit attest <run-id> [--worker ID] [--hostEnforced true] [--env NAME]",
    "  audit decision <run-id> <worker-id> [--path PATH|--command CMD|--network TARGET|--env NAME]",
    "  candidate list|summary|register|score|rank|select|reject <run-id>",
    "  eval snapshot|replay|compare|score|gate|report",
    "  summary refresh|show <run-id> [--json]",
    "  blackboard summary|summarize|graph|resolve <run-id>",
    "  blackboard topic create <run-id> --id <topic-id> --title TEXT",
    "  blackboard message post|list <run-id>",
    "  blackboard context put <run-id>",
    "  blackboard artifact add|list <run-id>",
    "  blackboard snapshot <run-id>",
    "  coordinator summary <run-id>",
    "  coordinator decision <run-id> --kind KIND --outcome OUTCOME --reason TEXT",
    "  multi-agent run|status|step|blackboard|score|select|summary|summarize|graph|dependencies|failures|evidence <run-id>",
    "  multi-agent graph <run-id> --view full|compact|critical-path|failures|evidence|trust|topology|blackboard|candidate|commit-gate [--focus ID] [--depth N]",
    "  topology list|show|validate|apply|summary|graph",
    "  schedule create|list|due|complete|pause|resume|run-now|history|daemon|delete",
    "  routine create|fire|list|events|delete",
    "  registry refresh|show [--scope repo|home] [--json]",
    "  run search|list|show|resume|archive|rerun [run-id] [--scope repo|home] [--json]",
    "  queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]",
    "  history [--scope repo|home] [--app ID] [--status STATE] [--json]",
    "  workbench view <run-id> [--json]",
    "  workbench serve [--port N] [--scope repo|home] [--once|--json]",
    ""
  ].join("\n");
  return `Cool Workflow\n\nCommands:\n  list\n  init <workflow-id> [--title TEXT] [--output PATH]\n  plan <workflow-id> [--repo PATH] [--question TEXT] [--invariant TEXT]\n  status <run-id> [--json|--format json]\n  next <run-id> [--limit N]\n  graph <run-id> [--json]\n  dispatch <run-id> [--limit N] [--sandbox PROFILE]\n  result <run-id> <task-id> <result-file>\n  state check <run-id> [--state PATH] [--write]\n  commit <run-id> --verifier <node-id> [--reason TEXT]\n  commit <run-id> --candidate <candidate-id> [--reason TEXT]\n  commit <run-id> --selection <selection-id> [--reason TEXT]\n  commit <run-id> --allow-unverified-checkpoint [--reason TEXT]\n  commit summary <run-id> [--json]\n  report <run-id> [--show|--summary]\n  app list\n  app show <app-id>\n  app validate <path-or-app-id>\n  app init <app-id> --title TEXT\n  app package <app-id> [--output PATH]\n  sandbox list\n  sandbox show <profile-id>\n  sandbox validate <profile-file>\n  contract show <run-id> [contract-id]\n  node list <run-id>\n  node show <run-id> <node-id>\n  node graph <run-id> [--json]\n  feedback list <run-id> [--status open]\n  feedback summary <run-id> [--json]\n  feedback show <run-id> <feedback-id>\n  feedback collect <run-id>\n  feedback task <run-id> <feedback-id> [--verify CMD]\n  feedback resolve <run-id> <feedback-id> --node <node-id>\n  worker list <run-id> [--status running]\n  worker summary <run-id> [--json]\n  worker show <run-id> <worker-id>\n  worker manifest <run-id> <worker-id>\n  worker output <run-id> <worker-id> <result-file>\n  worker fail <run-id> <worker-id> --message TEXT\n  worker validate <run-id> <worker-id> [path]\n  audit summary <run-id>\n  audit worker <run-id> <worker-id>\n  audit provenance <run-id> [--worker ID|--candidate ID|--commit ID]\n  audit attest <run-id> [--worker ID] [--hostEnforced true] [--env NAME]\n  audit decision <run-id> <worker-id> [--path PATH|--command CMD|--network TARGET|--env NAME]\n  candidate list <run-id> [--status scored]\n  candidate summary <run-id> [--json]\n  candidate register <run-id> --worker <worker-id>\n  candidate score <run-id> <candidate-id> --criterion name=value --evidence PATH\n  candidate rank <run-id>\n  candidate select <run-id> <candidate-id> [--reason TEXT]\n  candidate reject <run-id> <candidate-id> --reason TEXT\n  blackboard summary <run-id>\n  blackboard graph <run-id>\n  blackboard topic create <run-id> --id <topic-id> --title TEXT\n  blackboard message post <run-id> --topic <topic-id> --body TEXT\n  blackboard message list <run-id> [--topic <topic-id>]\n  blackboard context put <run-id> --topic <topic-id> --kind fact|constraint|assumption|question|decision --value TEXT\n  blackboard artifact add <run-id> --path PATH --kind KIND\n  blackboard artifact list <run-id>\n  blackboard snapshot <run-id>\n  coordinator summary <run-id>\n  coordinator decision <run-id> --kind KIND --outcome OUTCOME --reason TEXT\n  loop --intervalMinutes 30 --prompt TEXT\n  schedule create --kind loop --intervalMinutes 30 --prompt TEXT\n  schedule list [--status active]\n  schedule due\n  schedule complete <schedule-id>\n  schedule pause <schedule-id>\n  schedule resume <schedule-id>\n  schedule run-now <schedule-id>\n  schedule history [schedule-id]\n  schedule daemon [--once] [--intervalSeconds 60]\n  schedule delete <schedule-id>\n  routine create --kind api|github --prompt TEXT [--match JSON]\n  routine fire api|github [payload.json]\n  routine list\n  routine events [trigger-id]\n  routine delete <trigger-id>\n\n`;
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
