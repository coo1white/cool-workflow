import fs from "node:fs";
import path from "node:path";
import {
  DispatchManifest,
  LoadedWorkflowApp,
  RunSummary,
  RunTask,
  WorkflowAppSummary,
  WorkflowAppValidationIssue,
  WorkflowAppValidationResult,
  WorkflowDefinition,
  WorkflowRun
} from "./types";
import { slugify } from "./workflow-api";
import {
  WorkflowAppValidationError,
  loadWorkflowAppFromEntrypoint,
  loadWorkflowAppFromManifest,
  renderWorkflowAppEntrypointTemplate,
  renderWorkflowAppManifestTemplate,
  renderWorkflowAppTemplate,
  summarizeWorkflowApp,
  validateWorkflowApp,
  workflowAppRunMetadata
} from "./workflow-app-sdk";
import { createDispatchManifest, firstRunnablePhase, nextDispatchTasks, updatePhaseStatuses } from "./dispatch";
import { writeTaskFiles } from "./harness";
import { commitState } from "./commit";
import { assertTaskCanComplete, parseResultEnvelope, validateResultEnvelope, validateRunGates } from "./verifier";
import {
  createRunPaths,
  ensureRunDirs,
  loadRunFromCwd,
  migrateRunStateFile,
  safeFileName,
  saveCheckpoint,
  writeJson
} from "./state";
import { createDefaultPipelineContract, DEFAULT_PIPELINE_CONTRACT_ID } from "./pipeline-contract";
import {
  collectRunErrors,
  createCorrectionTask,
  getFeedback,
  listFeedback,
  recordFeedback,
  resolveFeedback,
  summarizeFeedback
} from "./error-feedback";
import {
  appendRunNode,
  createStateNode,
  upsertRunContract
} from "./state-node";
import { createPipelineRunner } from "./pipeline-runner";
import {
  getWorkerScope,
  listWorkerScopes,
  recordWorkerFailure,
  recordWorkerOutput,
  summarizeWorkers,
  validateWorkerBoundary,
  writeWorkerManifest
} from "./worker-isolation";
import {
  getCandidate,
  listCandidates,
  rankCandidates,
  registerCandidate,
  rejectCandidate,
  scoreCandidate,
  selectCandidate,
  summarizeCandidates
} from "./candidate-scoring";
import {
  listBundledSandboxProfiles,
  SandboxProfileError,
  sandboxContextForValidation,
  showBundledSandboxProfile,
  validateSandboxCommand,
  validateSandboxNetwork,
  validateSandboxProfileFile
} from "./sandbox-profile";
import {
  buildOperatorGraph,
  summarizeOperatorCandidates,
  summarizeOperatorCommits,
  summarizeOperatorFeedback,
  summarizeOperatorRun,
  summarizeOperatorWorkers
} from "./operator-ux";
import {
  ensureTrustAudit,
  evidenceProvenance,
  listTrustAuditEvents,
  recordHostAttestation,
  recordSandboxPathDecision,
  recordSandboxPolicyDecision,
  summarizeTrustAudit,
  workerTrustAudit
} from "./trust-audit";
import { summarizeMultiAgentTrust } from "./multi-agent-trust";
import {
  assignAgentMembership,
  buildMultiAgentGraph,
  collectAgentFanin,
  createAgentFanout,
  createAgentGroup,
  createAgentRole,
  createMultiAgentRun,
  ensureMultiAgentState,
  getAgentFanin,
  getAgentFanout,
  getAgentGroup,
  getAgentMembership,
  getAgentRole,
  getMultiAgentRun,
  summarizeMultiAgent,
  transitionMultiAgentRun
} from "./multi-agent";
import {
  addBlackboardArtifact,
  buildBlackboardGraph,
  createBlackboardSnapshot,
  createBlackboardTopic,
  listBlackboardArtifacts,
  listBlackboardMessages,
  postBlackboardMessage,
  putBlackboardContext,
  recordCoordinatorDecision,
  resolveBlackboard,
  summarizeBlackboard
} from "./coordinator";
import {
  applyTopology,
  buildTopologyGraph,
  ensureTopologyState,
  getTopologyDefinition,
  listTopologyDefinitions,
  showTopologyRun,
  summarizeTopologies,
  validateTopologyDefinition
} from "./topology";
import {
  hostBlackboard,
  hostRun,
  hostScore,
  hostSelect,
  hostStatus,
  hostStep
} from "./multi-agent-host";
import {
  buildMultiAgentOperatorGraph,
  summarizeMultiAgentOperator
} from "./multi-agent-operator-ux";
import {
  compareMultiAgentReplay,
  createMultiAgentReplaySnapshot,
  gateMultiAgentEval,
  replayMultiAgentSnapshot,
  reportMultiAgentEval,
  scoreMultiAgentReplay
} from "./multi-agent-eval";
import {
  buildCompactGraph,
  buildStateExplosionReport,
  GRAPH_VIEWS,
  GraphView,
  loadStateExplosionSummaryIndex,
  refreshStateExplosionSummaries,
  showStateExplosionSummary,
  stateExplosionReportLines,
  summarizeBlackboardDigest
} from "./state-explosion";

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

  plan(workflowId: string, options: Record<string, unknown>): WorkflowRun {
    const appRecord = this.loadWorkflowAppById(workflowId);
    const workflow = appRecord.app.workflow;
    const inputs = normalizeInputs(options);
    validateInputs(workflow, inputs);

    const cwd = path.resolve(String(inputs.cwd || inputs.repo || process.cwd()));
    const runId = createRunId(workflow.id);
    const runDir = path.join(cwd, ".cw", "runs", runId);
    const paths = createRunPaths(runDir);
    ensureRunDirs(paths);

    const tasks = flattenTasks(workflow, inputs);
    const run: WorkflowRun = {
      schemaVersion: 1,
      id: runId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cwd,
      workflow: {
        id: workflow.id,
        title: workflow.title,
        summary: workflow.summary || "",
        limits: workflow.limits,
        app: workflowAppRunMetadata(appRecord)
      },
      inputs,
      loopStage: "interpret",
      phases: workflow.phases.map((phase) => ({
        id: phase.id || slugify(phase.name),
        name: phase.name,
        status: "pending",
        taskIds: phase.tasks.map((task) => task.id)
      })),
      tasks,
      dispatches: [],
      commits: [],
      paths,
      nodes: [],
      contracts: [],
      feedback: [],
      audit: {
        schemaVersion: 1,
        eventLogPath: paths.auditDir ? path.join(paths.auditDir, "events.jsonl") : undefined,
        summaryPath: paths.auditDir ? path.join(paths.auditDir, "summary.json") : undefined,
        indexPath: paths.auditDir ? path.join(paths.auditDir, "index.json") : undefined
      },
      workers: [],
      sandboxProfiles: [],
      candidates: [],
      candidateSelections: [],
      multiAgent: {
        schemaVersion: 1,
        runs: [],
        roles: [],
        groups: [],
        memberships: [],
        fanouts: [],
        fanins: []
      },
      blackboard: {
        schemaVersion: 1,
        boards: [],
        topics: [],
        messages: [],
        contexts: [],
        artifacts: [],
        snapshots: [],
        decisions: []
      },
      topologies: {
        schemaVersion: 1,
        runs: []
      }
    };
    ensureTrustAudit(run);
    ensureMultiAgentState(run);
    ensureTopologyState(run);

    writeTaskFiles(run);
    const contract = upsertRunContract(run, createDefaultPipelineContract());
    const inputNode = appendRunNode(
      run,
      createStateNode({
        id: `${run.id}:input`,
        kind: "input",
        status: "completed",
        loopStage: "interpret",
        outputs: run.inputs,
        artifacts: [{ id: "state", kind: "json", path: run.paths.state }],
        contractId: contract.id,
        metadata: { workflowId: workflow.id, app: workflowAppRunMetadata(appRecord) }
      })
    );
    saveCheckpoint(run);
    const pipeline = createPipelineRunner({ contractId: contract.id, persist: false });
    for (const task of run.tasks) {
      const taskResult = pipeline.runPipelineStage(run, "plan", inputNode.id, {
        outputNodeId: `${run.id}:task:${task.id}`,
        outputStatus: "pending",
        loopStage: "interpret",
        artifacts: [{ id: "task", kind: "markdown", path: task.taskPath }],
        metadata: {
          workflowId: workflow.id,
          appId: appRecord.app.id,
          appVersion: appRecord.app.version,
          taskId: task.id,
          phase: task.phase,
          taskKind: task.kind,
          requiresEvidence: task.requiresEvidence,
          sandboxProfileId: task.sandboxProfileId
        }
      });
      task.stateNodeId = taskResult.outputNodeId;
    }
    writeReport(run);
    commitState(run, "initial-plan");
    saveCheckpoint(run);
    return run;
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
    const run = this.loadRun(runId);
    try {
      const manifest = createDispatchManifest(run, numberOption(options.limit), {
        sandboxProfileId: stringOption(options.sandbox) || stringOption(options.sandboxProfile) || stringOption(options.sandboxProfileId),
        multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
        multiAgentGroupId: stringOption(options.multiAgentGroup || options.multiAgentGroupId || options.group || options["multi-agent-group"]),
        multiAgentRoleId: stringOption(options.multiAgentRole || options.multiAgentRoleId || options.role || options["multi-agent-role"]),
        multiAgentFanoutId: stringOption(options.multiAgentFanout || options.multiAgentFanoutId || options.fanout || options["multi-agent-fanout"])
      });
      run.loopStage = "act";
      if (manifest.dispatchId) commitState(run, `dispatch:${manifest.dispatchId}`);
      saveCheckpoint(run);
      writeReport(run);
      return manifest;
    } catch (error) {
      if (isSandboxProfileError(error)) {
        run.loopStage = "adjust";
        recordFeedback(run, {
          source: "cli",
          error: {
            code: error.code,
            message: error.message,
            at: new Date().toISOString(),
            path: error.path,
            retryable: false,
            details: error.details
          },
          retryable: false,
          metadata: { sandboxProfileId: stringOption(options.sandbox) || stringOption(options.sandboxProfile) || stringOption(options.sandboxProfileId) }
        }, { persist: false });
        writeReport(run);
        saveCheckpoint(run);
      }
      throw error;
    }
  }

  recordResult(runId: string, taskId: string, resultPath: string): RunSummary {
    const run = this.loadRun(runId);
    const task = run.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Unknown task id for run ${runId}: ${taskId}`);
    try {
      assertTaskCanComplete(run, task);

      const absoluteResultPath = path.resolve(resultPath);
      if (!fs.existsSync(absoluteResultPath)) {
        throw new Error(`Result file does not exist: ${absoluteResultPath}`);
      }
      const rawResult = fs.readFileSync(absoluteResultPath, "utf8");
      run.loopStage = "observe";
      const parsedResult = parseResultEnvelope(rawResult);
      run.loopStage = "adjust";
      validateResultEnvelope(task, parsedResult);

      const destination = path.join(run.paths.resultsDir, `${safeFileName(taskId)}.md`);
      fs.copyFileSync(absoluteResultPath, destination);
      task.status = "completed";
      task.completedAt = new Date().toISOString();
      task.resultPath = destination;
      task.loopStage = "observe";
      task.result = parsedResult;
      const resultNode = appendRunNode(
        run,
        createStateNode({
          id: `${run.id}:result:${task.id}`,
          kind: "result",
          status: "completed",
          loopStage: "observe",
          inputs: { taskId: task.id, dispatchId: task.dispatchId },
          outputs: parsedResult as unknown as Record<string, unknown>,
          artifacts: [{ id: "result", kind: "markdown", path: destination }],
          evidence: parsedResult.evidence.map((entry, index) => ({
            id: `result:${index + 1}`,
            source: "cw:result",
            locator: entry,
            summary: entry
          })),
          parents: task.dispatchId ? [`${run.id}:dispatch:${task.dispatchId}`] : [task.stateNodeId || `${run.id}:task:${task.id}`],
          contractId: DEFAULT_PIPELINE_CONTRACT_ID,
          metadata: { taskId: task.id }
        })
      );
      task.resultNodeId = resultNode.id;
      updatePhaseStatuses(run);
      validateRunGates(run);
      const verifierResult = createPipelineRunner({ persist: false }).runPipelineStage(run, "verify", resultNode.id, {
        outputNodeId: `${run.id}:verifier:${task.id}`,
        outputStatus: "verified",
        loopStage: "adjust",
        outputs: { accepted: true },
        artifacts: [{ id: "result", kind: "markdown", path: destination }],
        evidence: resultNode.evidence.length
          ? resultNode.evidence
          : [{ id: "result:summary", source: "summary", summary: parsedResult.summary }],
        metadata: { taskId: task.id, resultNodeId: resultNode.id }
      });
      task.verifierNodeId = verifierResult.outputNodeId;
      commitState(run, `result:${taskId}`);
      writeReport(run);
      saveCheckpoint(run);
      return summarizeRun(run);
    } catch (error) {
      recordFeedback(run, {
        source: "verifier",
        error: error instanceof Error ? error : String(error),
        taskId: task.id,
        path: resultPath ? path.resolve(resultPath) : undefined,
        retryable: false,
        metadata: {
          taskStatus: task.status,
          dispatchId: task.dispatchId,
          stateNodeId: task.stateNodeId,
          resultNodeId: task.resultNodeId
        }
      });
      writeReport(run);
      throw error;
    }
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

  showWorkerManifest(runId: string, workerId: string): ReturnType<typeof writeWorkerManifest> {
    const run = this.loadRun(runId);
    const worker = getWorkerScope(run, workerId);
    if (!worker) throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
    return writeWorkerManifest(run, worker);
  }

  recordWorkerOutput(runId: string, workerId: string, resultPath: string): RunSummary {
    const run = this.loadRun(runId);
    try {
      recordWorkerOutput(run, workerId, resultPath, { persist: false });
      run.loopStage = "observe";
      updatePhaseStatuses(run);
      validateRunGates(run);
      commitState(run, `worker:${workerId}:result`);
      writeReport(run);
      saveCheckpoint(run);
      return summarizeRun(run);
    } catch (error) {
      run.loopStage = "adjust";
      updatePhaseStatuses(run);
      writeReport(run);
      saveCheckpoint(run);
      throw error;
    }
  }

  recordWorkerFailure(
    runId: string,
    workerId: string,
    message: string,
    options: Record<string, unknown> = {}
  ): NonNullable<ReturnType<typeof getWorkerScope>> {
    const run = this.loadRun(runId);
    const failure = recordWorkerFailure(
      run,
      workerId,
      {
        code: String(options.code || "worker-runtime-error"),
        message,
        at: new Date().toISOString(),
        path: options.path ? path.resolve(String(options.path)) : undefined,
        retryable: Boolean(options.retryable)
      },
      { persist: false }
    );
    run.loopStage = "adjust";
    updatePhaseStatuses(run);
    writeReport(run);
    saveCheckpoint(run);
    return failure;
  }

  validateWorker(runId: string, workerId: string, targetPath?: string): ReturnType<typeof validateWorkerBoundary> {
    return validateWorkerBoundary(this.loadRun(runId), workerId, targetPath ? { path: targetPath } : {});
  }

  auditSummary(runId: string): ReturnType<typeof summarizeTrustAudit> {
    return summarizeTrustAudit(this.loadRun(runId));
  }

  auditMultiAgent(runId: string): ReturnType<typeof summarizeMultiAgentTrust> {
    return summarizeMultiAgentTrust(this.loadRun(runId));
  }

  auditPolicy(runId: string): Record<string, unknown> {
    const run = this.loadRun(runId);
    const summary = summarizeMultiAgentTrust(run);
    return {
      schemaVersion: 1,
      runId,
      rolePolicies: summary.rolePolicies,
      permissionDecisions: summary.permissionDecisions,
      policyViolations: summary.policyViolations,
      nextAction: summary.nextAction
    };
  }

  auditRole(runId: string, roleId: string): Record<string, unknown> {
    const run = this.loadRun(runId);
    const summary = summarizeMultiAgentTrust(run);
    const events = listTrustAuditEvents(run).filter((event) => event.agentRoleId === roleId);
    return {
      schemaVersion: 1,
      runId,
      roleId,
      role: run.multiAgent?.roles.find((entry) => entry.id === roleId),
      rolePolicies: summary.rolePolicies.filter((entry) => entry.subjectId === roleId),
      permissionDecisions: events.filter((event) => event.kind === "multi-agent.permission"),
      blackboardWrites: events.filter((event) => event.kind === "blackboard.write"),
      messageProvenance: events.filter((event) => event.kind === "blackboard.message-provenance"),
      judgeRationales: events.filter((event) => event.kind === "judge.rationale"),
      panelDecisions: events.filter((event) => event.kind === "judge.panel-decision"),
      policyViolations: events.filter((event) => event.kind === "policy.violation"),
      events,
      nextAction: `node scripts/cw.js audit multi-agent ${runId} --json`
    };
  }

  auditBlackboard(runId: string): Record<string, unknown> {
    const summary = summarizeMultiAgentTrust(this.loadRun(runId));
    return {
      schemaVersion: 1,
      runId,
      blackboardWrites: summary.blackboardWrites,
      messageProvenance: summary.messageProvenance,
      policyViolations: summary.policyViolations.filter((event) => event.blackboardId),
      nextAction: summary.nextAction
    };
  }

  auditJudge(runId: string): Record<string, unknown> {
    const summary = summarizeMultiAgentTrust(this.loadRun(runId));
    return {
      schemaVersion: 1,
      runId,
      judgeRationales: summary.judgeRationales,
      panelDecisions: summary.panelDecisions,
      permissionDecisions: summary.permissionDecisions.filter((event) => String(event.metadata?.operation || "").startsWith("judge.")),
      policyViolations: summary.policyViolations.filter((event) => String(event.metadata?.operation || "").startsWith("judge.")),
      nextAction: summary.nextAction
    };
  }

  workerAudit(runId: string, workerId: string): ReturnType<typeof workerTrustAudit> {
    return workerTrustAudit(this.loadRun(runId), workerId);
  }

  evidenceProvenance(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof evidenceProvenance> {
    return evidenceProvenance(this.loadRun(runId), {
      workerId: stringOption(options.worker || options.workerId),
      candidateId: stringOption(options.candidate || options.candidateId),
      commitId: stringOption(options.commit || options.commitId)
    });
  }

  recordAuditAttestation(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof recordHostAttestation> {
    const run = this.loadRun(runId);
    const workerId = stringOption(options.worker || options.workerId);
    const worker = workerId ? getWorkerScope(run, workerId) : undefined;
    const event = recordHostAttestation(run, {
      actor: stringOption(options.actor) || "host",
      workerId,
      taskId: worker?.taskId || stringOption(options.task || options.taskId),
      sandboxProfileId: worker?.sandboxProfileId || stringOption(options.sandboxProfileId),
      policySnapshot: worker?.sandboxPolicy,
      command: stringOption(options.command),
      networkTarget: stringOption(options.network || options.networkTarget),
      envVars: valuesOption(options.env || options.envVar || options.envVars),
      metadata: {
        note: stringOption(options.note || options.message),
        hostEnforced: options.hostEnforced === undefined ? undefined : Boolean(options.hostEnforced)
      }
    });
    saveCheckpoint(run);
    return event;
  }

  recordAuditDecision(runId: string, workerId: string, options: Record<string, unknown> = {}): ReturnType<typeof recordSandboxPolicyDecision> {
    const run = this.loadRun(runId);
    const worker = getWorkerScope(run, workerId);
    if (!worker) throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
    const kind = stringOption(options.kind) || inferAuditDecisionKind(options);
    const target = stringOption(options.path || options.command || options.network || options.networkTarget || options.env || options.envVar);
    if (!target) throw new Error("Missing audit decision target: provide --path, --command, --network, or --env");
    const policy = worker.sandboxPolicy;
    let denied: { code: string; message: string; path?: string } | null = null;
    if (kind === "sandbox.command") {
      denied = policy ? validateSandboxCommand(policy, target, workerId) : null;
    } else if (kind === "sandbox.network") {
      denied = policy ? validateSandboxNetwork(policy, target, workerId) : null;
    } else if (kind === "sandbox.env") {
      const name = target.includes("=") ? target.split("=")[0] : target;
      const allowed = Boolean(policy?.env.inherit || policy?.env.expose.includes(name));
      denied = allowed ? null : { code: "sandbox-env-denied", message: `Worker ${workerId} env var is outside sandbox profile ${policy?.id || "unknown"}: ${name}` };
    } else {
      denied = validateWorkerBoundary(run, workerId, { path: target });
    }
    const feedbackIds: string[] = [];
    if (denied) {
      const failure = recordWorkerFailure(
        run,
        workerId,
        {
          code: denied.code,
          message: denied.message,
          at: new Date().toISOString(),
          path: denied.path || (kind === "sandbox.path" ? path.resolve(target) : undefined),
          retryable: false
        },
        { persist: false }
      );
      feedbackIds.push(...(failure.feedbackIds || []));
    }
    const event = kind === "sandbox.path"
      ? recordSandboxPathDecision(run, {
          workerId,
          taskId: worker.taskId,
          sandboxProfileId: worker.sandboxProfileId,
          policySnapshot: policy,
          target,
          decision: denied ? "denied" : "allowed",
          feedbackIds,
          metadata: { code: denied?.code }
        })
      : recordSandboxPolicyDecision(run, {
          kind,
          decision: denied ? "denied" : "allowed",
          workerId,
          taskId: worker.taskId,
          sandboxProfileId: worker.sandboxProfileId,
          policySnapshot: policy,
          command: kind === "sandbox.command" ? target : undefined,
          networkTarget: kind === "sandbox.network" ? target : undefined,
          envVars: kind === "sandbox.env" ? [target.includes("=") ? target.split("=")[0] : target] : undefined,
          feedbackIds,
          metadata: { code: denied?.code }
        });
    writeReport(run);
    saveCheckpoint(run);
    return event;
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

  listCandidates(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof listCandidates> {
    return listCandidates(this.loadRun(runId), {
      status: options.status ? String(options.status) as never : undefined,
      kind: options.kind ? String(options.kind) as never : undefined
    });
  }

  showCandidate(runId: string, candidateId: string): NonNullable<ReturnType<typeof getCandidate>> {
    const candidate = getCandidate(this.loadRun(runId), candidateId);
    if (!candidate) throw new Error(`Unknown candidate id for run ${runId}: ${candidateId}`);
    return candidate;
  }

  registerCandidate(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof registerCandidate> {
    const run = this.loadRun(runId);
    const workerId = options.worker ? String(options.worker) : undefined;
    const worker = workerId ? getWorkerScope(run, workerId) : undefined;
    if (workerId && !worker) throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
    const task = worker ? run.tasks.find((candidate) => candidate.id === worker.taskId) : undefined;
    const resultNodeId = stringOption(options.resultNode) || worker?.resultNodeId || task?.resultNodeId;
    const verifierNodeId = stringOption(options.verifierNode) || worker?.output?.verifierNodeId || task?.verifierNodeId;
    const resultPath = stringOption(options.resultPath) || worker?.output?.resultPath || task?.resultPath;
    const resultNode = resultNodeId ? run.nodes?.find((node) => node.id === resultNodeId) : undefined;
    const verifierNode = verifierNodeId ? run.nodes?.find((node) => node.id === verifierNodeId) : undefined;
    const candidate = registerCandidate(run, {
      id: stringOption(options.id),
      kind: stringOption(options.kind) as never,
      workerId,
      taskId: stringOption(options.task) || worker?.taskId,
      resultNodeId,
      verifierNodeId,
      resultPath,
      artifacts: [
        ...(resultPath ? [{ id: "result", kind: "markdown", path: path.resolve(resultPath) }] : []),
        ...(worker ? [{ id: "worker", kind: "json", path: path.join(worker.workerDir, "worker.json") }] : [])
      ] as never,
      evidence: mergeEvidence(resultNode?.evidence || [], verifierNode?.evidence || []),
      metadata: {
        source: worker ? "worker" : "manual",
        workerDir: worker?.workerDir
      }
    }, { persist: false });
    writeReport(run);
    saveCheckpoint(run);
    return candidate;
  }

  scoreCandidate(runId: string, candidateId: string, options: Record<string, unknown> = {}): ReturnType<typeof scoreCandidate> {
    const run = this.loadRun(runId);
    const score = scoreCandidate(run, candidateId, {
      id: stringOption(options.id),
      scorer: stringOption(options.scorer),
      criteria: parseCriteria(options),
      maxTotal: numberOption(options.maxTotal || options.max),
      verdict: stringOption(options.verdict) as never,
      evidence: parseEvidence(options.evidence),
      notes: stringOption(options.notes)
    }, { persist: false });
    writeReport(run);
    saveCheckpoint(run);
    return score;
  }

  rankCandidates(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof rankCandidates> {
    const run = this.loadRun(runId);
    const ranking = rankCandidates(run, {
      includeRejected: Boolean(options.includeRejected),
      policy: {
        minNormalized: numberOption(options.minNormalized),
        requireEvidence: options.requireEvidence === undefined ? undefined : Boolean(options.requireEvidence),
        requireVerifierGate: options.requireVerifierGate === undefined ? undefined : Boolean(options.requireVerifierGate),
        tieBreaker: stringOption(options.tieBreaker) as never
      }
    });
    writeReport(run);
    saveCheckpoint(run);
    return ranking;
  }

  selectCandidate(runId: string, candidateId: string, options: Record<string, unknown> = {}): ReturnType<typeof selectCandidate> {
    const run = this.loadRun(runId);
    const selection = selectCandidate(run, candidateId, {
      selectedBy: stringOption(options.by) || stringOption(options.selectedBy),
      reason: stringOption(options.reason),
      scoreId: stringOption(options.score),
      allowUnverified: Boolean(options.allowUnverified)
    }, {
      persist: false,
      policy: {
        minNormalized: numberOption(options.minNormalized),
        requireVerifierGate: options.requireVerifierGate === undefined ? undefined : Boolean(options.requireVerifierGate)
      }
    });
    writeReport(run);
    saveCheckpoint(run);
    return selection;
  }

  rejectCandidate(runId: string, candidateId: string, reason: string): ReturnType<typeof rejectCandidate> {
    const run = this.loadRun(runId);
    const candidate = rejectCandidate(run, candidateId, reason, { persist: false });
    writeReport(run);
    saveCheckpoint(run);
    return candidate;
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
    return summarizeMultiAgentOperator(this.loadRun(runId)).evidence;
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

  hostMultiAgentRun(runId: string | undefined, options: Record<string, unknown> = {}): ReturnType<typeof hostRun> {
    const workflowId = stringOption(options.app || options.appId || options.workflow || options.workflowId);
    const run = runId
      ? this.loadRun(runId)
      : workflowId
        ? this.plan(workflowId, withoutHostRunKeys(options))
        : undefined;
    if (!run) throw new Error("multi-agent run requires <run-id> or --app <app-id>");
    const response = hostRun(run, options);
    writeReport(run);
    saveCheckpoint(run);
    return response;
  }

  hostMultiAgentStatus(runId: string): ReturnType<typeof hostStatus> {
    const run = this.loadRun(runId);
    writeReport(run);
    return hostStatus(run);
  }

  hostMultiAgentStep(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof hostStep> {
    const run = this.loadRun(runId);
    const response = hostStep(run, options);
    writeReport(run);
    saveCheckpoint(run);
    return response;
  }

  hostMultiAgentBlackboard(runId: string, action?: string, options: Record<string, unknown> = {}): ReturnType<typeof hostBlackboard> {
    const run = this.loadRun(runId);
    const response = hostBlackboard(run, action, options);
    writeReport(run);
    saveCheckpoint(run);
    return response;
  }

  hostMultiAgentScore(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof hostScore> {
    const run = this.loadRun(runId);
    const response = hostScore(run, options);
    writeReport(run);
    saveCheckpoint(run);
    return response;
  }

  hostMultiAgentSelect(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof hostSelect> {
    const run = this.loadRun(runId);
    const response = hostSelect(run, options);
    writeReport(run);
    saveCheckpoint(run);
    return response;
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

  listTopologies(): ReturnType<typeof listTopologyDefinitions> {
    return listTopologyDefinitions();
  }

  showTopology(topologyId: string): NonNullable<ReturnType<typeof getTopologyDefinition>> {
    const definition = getTopologyDefinition(topologyId);
    if (!definition) throw new Error(`Unknown topology id: ${topologyId}`);
    return definition;
  }

  validateTopology(topologyId: string): ReturnType<typeof validateTopologyDefinition> {
    return validateTopologyDefinition(topologyId);
  }

  applyTopology(runId: string, topologyId: string, options: Record<string, unknown> = {}): ReturnType<typeof applyTopology> {
    const run = this.loadRun(runId);
    const record = applyTopology(run, topologyId, {
      id: stringOption(options.id),
      title: stringOption(options.title),
      multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
      blackboardId: stringOption(options.blackboard || options.blackboardId),
      taskIds: arrayOption(options.task || options.taskId || options.tasks).map(String),
      mapperCount: numberOption(options.mapperCount || options["mapper-count"] || options.mappers || options.mapper),
      judgeCount: numberOption(options.judgeCount || options["judge-count"] || options.judges || options.judge),
      debateRounds: numberOption(options.debateRounds || options["debate-rounds"] || options.rounds),
      collectInitialFanin: Boolean(options.collectInitialFanin || options["collect-initial-fanin"]),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return record;
  }

  showTopologyRun(runId: string, topologyRunId: string): ReturnType<typeof showTopologyRun> {
    return showTopologyRun(this.loadRun(runId), topologyRunId);
  }

  topologySummary(runId: string): ReturnType<typeof summarizeTopologies> {
    return summarizeTopologies(this.loadRun(runId));
  }

  topologyGraph(runId: string): ReturnType<typeof buildTopologyGraph> {
    return buildTopologyGraph(this.loadRun(runId));
  }

  createMultiAgentRun(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof createMultiAgentRun> {
    const run = this.loadRun(runId);
    const record = createMultiAgentRun(run, {
      id: stringOption(options.id),
      title: stringOption(options.title),
      objective: stringOption(options.objective || options.reason),
      parentMultiAgentRunId: stringOption(options.parent || options.parentMultiAgentRunId),
      phase: stringOption(options.phase),
      phaseId: stringOption(options.phaseId),
      blackboardId: stringOption(options.blackboard || options.blackboardId),
      topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return record;
  }

  transitionMultiAgentRun(runId: string, multiAgentRunId: string, options: Record<string, unknown> = {}): ReturnType<typeof transitionMultiAgentRun> {
    const run = this.loadRun(runId);
    const record = transitionMultiAgentRun(run, multiAgentRunId, String(options.status || "running") as never, {
      reason: stringOption(options.reason),
      actor: stringOption(options.actor),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return record;
  }

  createAgentRole(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof createAgentRole> {
    const run = this.loadRun(runId);
    const record = createAgentRole(run, {
      id: stringOption(options.id),
      multiAgentRunId: requiredStringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"], "multi-agent run id"),
      title: stringOption(options.title),
      responsibilities: arrayOption(options.responsibility || options.responsibilities).map(String),
      requiredEvidence: arrayOption(options.requiredEvidence || options["required-evidence"]).map(String),
      sandboxProfileHints: arrayOption(options.sandbox || options.sandboxProfile || options.sandboxProfileHint || options["sandbox-profile"]).map(String),
      expectedArtifacts: arrayOption(options.expectedArtifact || options.expectedArtifacts || options["expected-artifact"]).map(String),
      faninObligations: arrayOption(options.faninObligation || options.faninObligations || options["fanin-obligation"]).map(String),
      parentRoleId: stringOption(options.parent || options.parentRoleId),
      blackboardId: stringOption(options.blackboard || options.blackboardId),
      topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return record;
  }

  createAgentGroup(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof createAgentGroup> {
    const run = this.loadRun(runId);
    const record = createAgentGroup(run, {
      id: stringOption(options.id),
      multiAgentRunId: requiredStringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"], "multi-agent run id"),
      title: stringOption(options.title),
      phase: stringOption(options.phase),
      phaseId: stringOption(options.phaseId),
      taskIds: arrayOption(options.task || options.taskId || options.tasks).map(String),
      parentGroupId: stringOption(options.parent || options.parentGroupId),
      blackboardId: stringOption(options.blackboard || options.blackboardId),
      topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return record;
  }

  assignAgentMembership(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof assignAgentMembership> {
    const run = this.loadRun(runId);
    const record = assignAgentMembership(run, {
      id: stringOption(options.id),
      multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
      groupId: requiredStringOption(options.group || options.groupId || options["multi-agent-group"], "group id"),
      roleId: requiredStringOption(options.role || options.roleId || options["multi-agent-role"], "role id"),
      taskId: requiredStringOption(options.task || options.taskId, "task id"),
      workerId: stringOption(options.worker || options.workerId),
      dispatchId: stringOption(options.dispatch || options.dispatchId),
      fanoutId: stringOption(options.fanout || options.fanoutId || options["multi-agent-fanout"]),
      status: stringOption(options.status) as never,
      blackboardId: stringOption(options.blackboard || options.blackboardId),
      topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return record;
  }

  createAgentFanout(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof createAgentFanout> {
    const run = this.loadRun(runId);
    const record = createAgentFanout(run, {
      id: stringOption(options.id),
      multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
      groupId: requiredStringOption(options.group || options.groupId || options["multi-agent-group"], "group id"),
      reason: stringOption(options.reason) || "work split",
      roleIds: arrayOption(options.role || options.roleId || options.roles).map(String),
      taskIds: arrayOption(options.task || options.taskId || options.tasks).map(String),
      workerIds: arrayOption(options.worker || options.workerId || options.workers).map(String),
      membershipIds: arrayOption(options.membership || options.membershipId || options.memberships).map(String),
      dispatchIds: arrayOption(options.dispatch || options.dispatchId || options.dispatches).map(String),
      concurrencyLimit: numberOption(options.limit || options.concurrency || options.concurrencyLimit),
      sandboxProfileChoices: parseSandboxChoices(options),
      expectedReturnShape: stringOption(options.expectedReturnShape || options["expected-return-shape"]),
      blackboardId: stringOption(options.blackboard || options.blackboardId),
      topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return record;
  }

  collectAgentFanin(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof collectAgentFanin> {
    const run = this.loadRun(runId);
    const record = collectAgentFanin(run, {
      id: stringOption(options.id),
      multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
      groupId: stringOption(options.group || options.groupId || options["multi-agent-group"]),
      fanoutId: stringOption(options.fanout || options.fanoutId || options["multi-agent-fanout"]),
      requiredRoleIds: arrayOption(options.requiredRole || options.requiredRoleId || options["required-role"]).map(String),
      strategy: stringOption(options.strategy),
      blackboardId: stringOption(options.blackboard || options.blackboardId),
      topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return record;
  }

  showMultiAgentRun(runId: string, multiAgentRunId: string): NonNullable<ReturnType<typeof getMultiAgentRun>> {
    const record = getMultiAgentRun(this.loadRun(runId), multiAgentRunId);
    if (!record) throw new Error(`Unknown MultiAgentRun id for run ${runId}: ${multiAgentRunId}`);
    return record;
  }

  showAgentRole(runId: string, roleId: string): NonNullable<ReturnType<typeof getAgentRole>> {
    const record = getAgentRole(this.loadRun(runId), roleId);
    if (!record) throw new Error(`Unknown AgentRole id for run ${runId}: ${roleId}`);
    return record;
  }

  showAgentGroup(runId: string, groupId: string): NonNullable<ReturnType<typeof getAgentGroup>> {
    const record = getAgentGroup(this.loadRun(runId), groupId);
    if (!record) throw new Error(`Unknown AgentGroup id for run ${runId}: ${groupId}`);
    return record;
  }

  showAgentMembership(runId: string, membershipId: string): NonNullable<ReturnType<typeof getAgentMembership>> {
    const record = getAgentMembership(this.loadRun(runId), membershipId);
    if (!record) throw new Error(`Unknown AgentMembership id for run ${runId}: ${membershipId}`);
    return record;
  }

  showAgentFanout(runId: string, fanoutId: string): NonNullable<ReturnType<typeof getAgentFanout>> {
    const record = getAgentFanout(this.loadRun(runId), fanoutId);
    if (!record) throw new Error(`Unknown AgentFanout id for run ${runId}: ${fanoutId}`);
    return record;
  }

  showAgentFanin(runId: string, faninId: string): NonNullable<ReturnType<typeof getAgentFanin>> {
    const record = getAgentFanin(this.loadRun(runId), faninId);
    if (!record) throw new Error(`Unknown AgentFanin id for run ${runId}: ${faninId}`);
    return record;
  }

  blackboardSummary(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof summarizeBlackboard> {
    return summarizeBlackboard(this.loadRun(runId), stringOption(options.blackboard || options.blackboardId));
  }

  coordinatorSummary(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof summarizeBlackboard> {
    return summarizeBlackboard(this.loadRun(runId), stringOption(options.blackboard || options.blackboardId));
  }

  blackboardGraph(runId: string): ReturnType<typeof buildBlackboardGraph> {
    return buildBlackboardGraph(this.loadRun(runId));
  }

  resolveRunBlackboard(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof resolveBlackboard> {
    const run = this.loadRun(runId);
    const board = resolveBlackboard(run, {
      id: stringOption(options.id || options.blackboard || options.blackboardId),
      title: stringOption(options.title),
      multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
      groupId: stringOption(options.group || options.groupId || options["multi-agent-group"]),
      roleId: stringOption(options.role || options.roleId || options["multi-agent-role"]),
      membershipId: stringOption(options.membership || options.membershipId || options["multi-agent-membership"]),
      author: parseBlackboardAuthor(options),
      scope: parseBlackboardScope(options),
      tags: arrayOption(options.tag || options.tags).map(String),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return board;
  }

  createBlackboardTopic(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof createBlackboardTopic> {
    const run = this.loadRun(runId);
    const topic = createBlackboardTopic(run, {
      id: stringOption(options.id),
      title: requiredStringOption(options.title, "topic title"),
      description: stringOption(options.description),
      blackboardId: stringOption(options.blackboard || options.blackboardId),
      author: parseBlackboardAuthor(options),
      scope: parseBlackboardScope(options),
      tags: arrayOption(options.tag || options.tags).map(String),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return topic;
  }

  postBlackboardMessage(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof postBlackboardMessage> {
    const run = this.loadRun(runId);
    const message = postBlackboardMessage(run, {
      id: stringOption(options.id),
      topicId: requiredStringOption(options.topic || options.topicId, "topic id"),
      body: requiredStringOption(options.body || options.message, "message body"),
      blackboardId: stringOption(options.blackboard || options.blackboardId),
      replyToId: stringOption(options.replyTo || options.replyToId || options.parent),
      visibility: stringOption(options.visibility) as never,
      author: parseBlackboardAuthor(options),
      scope: parseBlackboardScope(options),
      evidenceRefs: arrayOption(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
      artifactRefIds: arrayOption(options.artifact || options.artifactRef || options.artifactRefId || options["artifact-ref"]).map(String),
      auditEventIds: arrayOption(options.audit || options.auditEvent || options.auditEventId || options["audit-event"]).map(String),
      parentIds: arrayOption(options.parentId || options.parentIds).map(String),
      tags: arrayOption(options.tag || options.tags).map(String),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return message;
  }

  listBlackboardMessages(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof listBlackboardMessages> {
    return listBlackboardMessages(this.loadRun(runId), {
      topicId: stringOption(options.topic || options.topicId),
      blackboardId: stringOption(options.blackboard || options.blackboardId)
    });
  }

  putBlackboardContext(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof putBlackboardContext> {
    const run = this.loadRun(runId);
    const context = putBlackboardContext(run, {
      id: stringOption(options.id),
      topicId: requiredStringOption(options.topic || options.topicId, "topic id"),
      kind: requiredStringOption(options.kind, "context kind") as never,
      key: stringOption(options.key),
      value: requiredStringOption(options.value || options.body, "context value"),
      blackboardId: stringOption(options.blackboard || options.blackboardId),
      supersedesContextIds: arrayOption(options.supersedes || options.supersedesContext || options.supersedesContextId).map(String),
      author: parseBlackboardAuthor(options),
      scope: parseBlackboardScope(options),
      evidenceRefs: arrayOption(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
      artifactRefIds: arrayOption(options.artifact || options.artifactRef || options.artifactRefId || options["artifact-ref"]).map(String),
      parentIds: arrayOption(options.parent || options.parentId || options.parentIds).map(String),
      tags: arrayOption(options.tag || options.tags).map(String),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return context;
  }

  addBlackboardArtifact(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof addBlackboardArtifact> {
    const run = this.loadRun(runId);
    const artifact = addBlackboardArtifact(run, {
      id: stringOption(options.id),
      topicId: stringOption(options.topic || options.topicId),
      kind: requiredStringOption(options.kind, "artifact kind"),
      path: stringOption(options.path),
      locator: stringOption(options.locator),
      blackboardId: stringOption(options.blackboard || options.blackboardId),
      owner: parseBlackboardAuthor({ ...options, authorKind: options.ownerKind || options.authorKind, authorId: options.owner || options.ownerId || options.authorId }),
      author: parseBlackboardAuthor(options),
      scope: parseBlackboardScope(options),
      source: stringOption(options.source),
      provenance: parseBlackboardLinks(run.id, options),
      evidenceRefs: arrayOption(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
      auditEventIds: arrayOption(options.audit || options.auditEvent || options.auditEventId || options["audit-event"]).map(String),
      parentIds: arrayOption(options.parent || options.parentId || options.parentIds).map(String),
      tags: arrayOption(options.tag || options.tags).map(String),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return artifact;
  }

  listBlackboardArtifacts(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof listBlackboardArtifacts> {
    return listBlackboardArtifacts(this.loadRun(runId), {
      topicId: stringOption(options.topic || options.topicId),
      blackboardId: stringOption(options.blackboard || options.blackboardId)
    });
  }

  snapshotBlackboard(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof createBlackboardSnapshot> {
    const run = this.loadRun(runId);
    const snapshot = createBlackboardSnapshot(run, stringOption(options.blackboard || options.blackboardId));
    writeReport(run);
    saveCheckpoint(run);
    return snapshot;
  }

  recordCoordinatorDecision(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof recordCoordinatorDecision> {
    const run = this.loadRun(runId);
    const decision = recordCoordinatorDecision(run, {
      id: stringOption(options.id),
      blackboardId: stringOption(options.blackboard || options.blackboardId),
      kind: requiredStringOption(options.kind, "decision kind") as never,
      outcome: requiredStringOption(options.outcome, "decision outcome") as never,
      reason: requiredStringOption(options.reason, "decision reason"),
      subjectIds: arrayOption(options.subject || options.subjectId || options.subjectIds).map(String),
      topicId: stringOption(options.topic || options.topicId),
      author: parseBlackboardAuthor({ ...options, authorKind: options.authorKind || "coordinator", authorId: options.authorId || "cw" }),
      scope: parseBlackboardScope(options),
      evidenceRefs: arrayOption(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
      artifactRefIds: arrayOption(options.artifact || options.artifactRef || options.artifactRefId || options["artifact-ref"]).map(String),
      messageIds: arrayOption(options.message || options.messageId || options.messageIds).map(String),
      parentIds: arrayOption(options.parent || options.parentId || options.parentIds).map(String),
      tags: arrayOption(options.tag || options.tags).map(String),
      metadata: metadataOption(options)
    });
    writeReport(run);
    saveCheckpoint(run);
    return decision;
  }

  checkState(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof migrateRunStateFile>["report"] {
    const cwd = path.resolve(String(options.cwd || process.cwd()));
    const statePath = options.state
      ? path.resolve(String(options.state))
      : path.join(cwd, ".cw", "runs", runId, "state.json");
    const result = migrateRunStateFile(statePath, { write: Boolean(options.write) });
    return result.report;
  }

  commit(runId: string, input: string | Record<string, unknown> = {}): StateCommitResult {
    const run = this.loadRun(runId);
    run.loopStage = "checkpoint";
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
        source: "cli"
      });
      writeReport(run);
      saveCheckpoint(run);
      return { runId, commit };
    } catch (error) {
      writeReport(run);
      saveCheckpoint(run);
      throw error;
    }
  }

  collectFeedback(runId: string): ReturnType<typeof collectRunErrors> {
    const run = this.loadRun(runId);
    const collected = collectRunErrors(run);
    writeReport(run);
    saveCheckpoint(run);
    return collected;
  }

  listFeedback(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof listFeedback> {
    return listFeedback(this.loadRun(runId), {
      status: options.status ? String(options.status) as never : undefined,
      severity: options.severity ? String(options.severity) as never : undefined,
      classification: options.classification ? String(options.classification) as never : undefined
    });
  }

  showFeedback(runId: string, feedbackId: string): NonNullable<ReturnType<typeof getFeedback>> {
    const feedback = getFeedback(this.loadRun(runId), feedbackId);
    if (!feedback) throw new Error(`Unknown feedback id for run ${runId}: ${feedbackId}`);
    return feedback;
  }

  createFeedbackTask(runId: string, feedbackId: string, options: Record<string, unknown> = {}): ReturnType<typeof createCorrectionTask> {
    const run = this.loadRun(runId);
    const feedback = createCorrectionTask(run, feedbackId, {
      verifierCommand: options.verify ? String(options.verify) : undefined,
      guidance: options.guidance ? String(options.guidance) : undefined
    });
    writeReport(run);
    saveCheckpoint(run);
    return feedback;
  }

  resolveFeedback(runId: string, feedbackId: string, options: Record<string, unknown> = {}): ReturnType<typeof resolveFeedback> {
    const run = this.loadRun(runId);
    const feedback = resolveFeedback(run, feedbackId, {
      status: options.status === "rejected" ? "rejected" : "resolved",
      nodeId: options.node ? String(options.node) : undefined,
      message: options.message ? String(options.message) : undefined
    });
    writeReport(run);
    saveCheckpoint(run);
    return feedback;
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

interface StateCommitResult {
  runId: string;
  commit: WorkflowRun["commits"][number];
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
    "Commands:",
    "  list",
    "  init <workflow-id> [--title TEXT] [--output PATH]",
    "  plan <workflow-id> [--repo PATH] [--question TEXT] [--invariant TEXT]",
    "  status <run-id> [--json|--format json]",
    "  next <run-id> [--limit N]",
    "  graph <run-id> [--json]",
    "  dispatch <run-id> [--limit N] [--sandbox PROFILE]",
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

function normalizeInputs(options: Record<string, unknown>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === "arg") {
      const pairs = Array.isArray(value) ? value : [value];
      for (const pair of pairs) {
        const [argKey, ...rest] = String(pair).split("=");
        inputs[argKey] = rest.join("=");
      }
      continue;
    }
    inputs[key] = value;
  }
  if (inputs.repo && !inputs.cwd) inputs.cwd = inputs.repo;
  return inputs;
}

function validateInputs(workflow: WorkflowDefinition, inputs: Record<string, unknown>): void {
  for (const input of workflow.inputs || []) {
    if (input.required && isMissing(inputs[input.name])) {
      throw new Error(`Missing required input --${input.name}`);
    }
  }
}

function flattenTasks(workflow: WorkflowDefinition, inputs: Record<string, unknown>): RunTask[] {
  const seen = new Set<string>();
  const tasks: RunTask[] = [];
  for (const phase of workflow.phases) {
    for (const task of phase.tasks) {
      if (seen.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
      seen.add(task.id);
      tasks.push({
        id: task.id,
        kind: task.kind,
        phase: phase.name,
        status: "pending",
        loopStage: "interpret",
        requiresEvidence: Boolean(task.requiresEvidence),
        sandboxProfileId: task.sandboxProfileId,
        prompt: renderPrompt(task.prompt, inputs),
        taskPath: "",
        resultPath: ""
      });
    }
  }
  return tasks;
}

function writeReport(run: WorkflowRun): string {
  updatePhaseStatuses(run);
  const workerSummary = summarizeWorkers(run);
  const candidateSummary = summarizeCandidates(run);
  const report = [
    `# ${run.workflow.title}`,
    "",
    `- Run: ${run.id}`,
    `- Workflow: ${run.workflow.id}`,
    ...(run.workflow.app
      ? [
          `- Workflow App: ${run.workflow.app.id}@${run.workflow.app.version}`,
          `- Workflow App Source: ${run.workflow.app.source?.manifestPath || run.workflow.app.source?.entrypointPath || run.workflow.app.source?.path || ""}`
        ]
      : []),
    `- Created: ${run.createdAt}`,
    `- Updated: ${run.updatedAt}`,
    `- Repository: ${String(run.inputs.repo || run.cwd)}`,
    `- Question: ${String(run.inputs.question || "")}`,
    `- Invariants: ${formatInputList(run.inputs.invariant)}`,
    `- Loop Stage: ${run.loopStage}`,
    "",
    "## Phase Status",
    "",
    "| Phase | Status | Completed | Total |",
    "| --- | --- | ---: | ---: |",
    ...run.phases.map((phase) => {
      const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
      const completed = phaseTasks.filter((task) => task.status === "completed").length;
      return `| ${phase.name} | ${phase.status} | ${completed} | ${phaseTasks.length} |`;
    }),
    "",
    "## State Commits",
    "",
    ...renderCommits(run),
    "",
    "## Error Feedback",
    "",
    ...renderFeedback(run),
    "",
    "## Workers",
    "",
    ...renderWorkers(workerSummary),
    "",
    "## State Size & Compaction",
    "",
    ...renderStateSize(run),
    "",
    "## Multi-Agent Runtime",
    "",
    ...renderMultiAgent(run),
    "",
    "## Blackboard / Coordinator",
    "",
    ...renderBlackboard(run),
    "",
    "## Sandbox Profiles",
    "",
    ...renderSandboxProfiles(run),
    "",
    "## Trust Audit",
    "",
    ...renderTrustAudit(run),
    "",
    "## Acceptance Rationale",
    "",
    ...renderAcceptanceRationale(run),
    "",
    "## Candidates",
    "",
    ...renderCandidates(candidateSummary),
    "",
    "## Pending Tasks",
    "",
    ...renderPendingTasks(run),
    "",
    "## Results",
    "",
    ...renderResults(run)
  ].join("\n");
  fs.writeFileSync(run.paths.report, report, "utf8");
  return run.paths.report;
}

function summarizeRun(run: WorkflowRun): RunSummary {
  updatePhaseStatuses(run);
  const workerSummary = summarizeWorkers(run);
  return {
    runId: run.id,
    workflowId: run.workflow.id,
    app: run.workflow.app,
    phases: run.phases,
    tasks: {
      total: run.tasks.length,
      pending: run.tasks.filter((task) => task.status === "pending").length,
      running: run.tasks.filter((task) => task.status === "running").length,
      failed: run.tasks.filter((task) => task.status === "failed").length,
      completed: run.tasks.filter((task) => task.status === "completed").length
    },
    loopStage: run.loopStage,
    next: firstRunnablePhase(run)?.name || null,
    reportPath: run.paths.report,
    commits: run.commits,
    workers: {
      total: workerSummary.total,
      byStatus: workerSummary.byStatus
    }
  };
}

function renderPendingTasks(run: WorkflowRun): string[] {
  const pending = run.tasks.filter((task) => task.status === "pending" || task.status === "running");
  if (!pending.length) return ["No pending tasks."];
  return pending.map((task) => `- ${task.id} (${task.phase}, ${task.status}): ${task.taskPath}`);
}

function renderResults(run: WorkflowRun): string[] {
  const completed = run.tasks.filter((task) => task.status === "completed");
  if (!completed.length) return ["No completed results yet."];
  const lines: string[] = [];
  for (const task of completed) {
    lines.push(`### ${task.id}`, "", `Result: ${task.resultPath}`, "");
    if (task.resultPath && fs.existsSync(task.resultPath)) {
      lines.push(fs.readFileSync(task.resultPath, "utf8").trim(), "");
    } else {
      lines.push("_Result file is not present on this host; state metadata remains inspectable._", "");
    }
  }
  return lines;
}

function renderCommits(run: WorkflowRun): string[] {
  if (!run.commits.length) return ["No state commits yet."];
  return run.commits.map((commit) => {
    const kind = commit.verifierGated ? "verifier-gated commit" : "checkpoint";
    const gate = commit.verifierGated ? formatCommitGate(commit) : "verifierGated=false";
    return `- ${commit.id}: ${commit.reason} [${commit.loopStage}; ${kind}; ${gate}] (${commit.snapshotPath})`;
  });
}

function renderFeedback(run: WorkflowRun): string[] {
  const summary = summarizeFeedback(run);
  if (!summary.total) return ["No feedback records."];
  return [
    `- Total: ${summary.total}`,
    `- By status: ${formatCounts(summary.byStatus)}`,
    `- By severity: ${formatCounts(summary.bySeverity)}`,
    `- By classification: ${formatCounts(summary.byClassification)}`,
    "",
    ...summary.artifacts.map((artifact) => `- ${artifact}`)
  ];
}

function renderWorkers(summary: ReturnType<typeof summarizeWorkers>): string[] {
  if (!summary.total) return ["No worker scopes yet."];
  const lines = [
    `- Total: ${summary.total}`,
    `- By status: ${formatCounts(summary.byStatus)}`,
    "",
    ...summary.manifestPaths.map((artifact) => `- ${artifact}`)
  ];
  if (summary.failed.length) {
    lines.push("", "Failed or rejected:");
    for (const worker of summary.failed) {
      lines.push(`- ${worker.id} (${worker.status}) feedback=${worker.feedbackIds.join(",") || "none"}`);
    }
  }
  return lines;
}

function renderStateSize(run: WorkflowRun): string[] {
  const index = loadStateExplosionSummaryIndex(run);
  const report = buildStateExplosionReport(run, { index });
  return stateExplosionReportLines(report);
}

function renderMultiAgent(run: WorkflowRun): string[] {
  const summary = summarizeMultiAgent(run);
  if (!summary.totalRuns) return ["No multi-agent runtime records yet."];
  const lines = [
    `- Runs: ${summary.totalRuns} (${formatCounts(summary.runsByStatus)})`,
    `- Roles: ${summary.roles}`,
    `- Groups: ${summary.groups} (${formatCounts(summary.groupsByStatus)})`,
    `- Memberships: ${summary.memberships} (${formatCounts(summary.membershipsByStatus)})`,
    `- Fanouts: ${summary.fanouts}`,
    `- Fanins: ${summary.fanins} (${formatCounts(summary.faninsByStatus)})`
  ];
  if (summary.blockedReasons.length) {
    lines.push("", "Blocked:");
    for (const reason of summary.blockedReasons.slice(0, 8)) lines.push(`- ${reason}`);
  }
  for (const group of summary.groupsDetail.slice(0, 8)) {
    lines.push("", `Group ${group.id}: status=${group.status}, phase=${group.phase || "none"}, run=${group.multiAgentRunId}`);
    for (const role of group.roles) {
      lines.push(`- role=${role.roleId}, memberships=${role.memberships}, reported=${role.reported}, missing=${role.missing}, requiredEvidence=${role.requiredEvidence}`);
    }
    lines.push(`- fanouts=${group.fanouts.join(", ") || "none"}`);
    lines.push(`- fanins=${group.fanins.join(", ") || "none"}`);
  }
  if (summary.nextAction) lines.push("", `Next multi-agent action: ${summary.nextAction}`);
  return lines;
}

function renderBlackboard(run: WorkflowRun): string[] {
  const summary = summarizeBlackboard(run);
  if (!summary.blackboardId) return ["No blackboard records yet."];
  const lines = [
    `- Blackboard: ${summary.blackboardId}`,
    `- Topics: ${summary.topics}`,
    `- Messages: ${summary.messages}`,
    `- Contexts: ${summary.contexts}`,
    `- Artifacts: ${summary.artifacts}`,
    `- Snapshots: ${summary.snapshots}`,
    `- Decisions: ${summary.decisions}`,
    `- Ready for fanin: ${summary.readyForFanin ? "yes" : "no"}`,
    `- Index: ${summary.indexPath || "none"}`,
    `- Latest snapshot: ${summary.latestSnapshotPath || "none"}`
  ];
  if (summary.openQuestions.length) {
    lines.push("", "Open questions:");
    for (const question of summary.openQuestions.slice(0, 8)) lines.push(`- ${question.id}: ${question.key}=${question.value}`);
  }
  if (summary.conflicts.length) {
    lines.push("", "Conflicts:");
    for (const conflict of summary.conflicts.slice(0, 8)) {
      lines.push(`- ${conflict.id}: ${conflict.key} conflicts with ${conflict.conflictingContextIds.join(", ") || "unknown"}`);
    }
  }
  if (summary.missingEvidence.length) {
    lines.push("", "Missing evidence:");
    for (const item of summary.missingEvidence.slice(0, 8)) lines.push(`- ${item}`);
  }
  if (summary.nextAction) lines.push("", `Next coordinator action: ${summary.nextAction}`);
  return lines;
}

function renderSandboxProfiles(run: WorkflowRun): string[] {
  const profiles = run.sandboxProfiles || [];
  if (!profiles.length) return ["No sandbox profiles selected yet."];
  return profiles.map((profile) =>
    [
      `- ${profile.id}: read=${profile.readPaths.length}, write=${profile.writePaths.length}, execute=${profile.execute.mode}, network=${profile.network.mode}`,
      `  enforcedByCW=${profile.enforcement.enforcedByCW.join("; ")}`,
      `  hostRequired=${profile.enforcement.hostRequired.join("; ")}`
    ].join("\n")
  );
}

function renderCandidates(summary: ReturnType<typeof summarizeCandidates>): string[] {
  if (!summary.total) return ["No candidates yet."];
  return [
    `- Total: ${summary.total}`,
    `- By status: ${formatCounts(summary.byStatus)}`,
    `- By kind: ${formatCounts(summary.byKind)}`,
    `- Selections: ${summary.selections}`,
    `- Index: ${summary.indexPath}`,
    `- Ranking: ${summary.rankingPath}`
  ];
}

function renderTrustAudit(run: WorkflowRun): string[] {
  const summary = summarizeTrustAudit(run);
  return [
    `- Events: ${summary.eventCount}`,
    `- Decisions: ${formatCounts(summary.byDecision)}`,
    `- Sources: ${formatCounts(summary.bySource)}`,
    `- Sandbox profiles: ${formatCounts(summary.bySandboxProfile)}`,
    `- Event log: ${summary.eventLogPath}`,
    `- Summary: ${summary.summaryPath}`,
    `- Index: ${summary.indexPath}`
  ];
}

function renderAcceptanceRationale(run: WorkflowRun): string[] {
  const lines: string[] = [];
  for (const selection of run.candidateSelections || []) {
    const rationale = selection.acceptanceRationale;
    if (!rationale) continue;
    lines.push(
      `- Selection ${selection.id}: candidate=${rationale.selectedCandidateId || selection.candidateId}, score=${rationale.scoreId || "none"}, verifier=${rationale.verifierNodeId || "none"}, evidence=${rationale.evidenceCount}, sandbox=${rationale.sandboxProfileId || "none"}, worker=${rationale.workerId || "none"}`
    );
  }
  for (const commit of run.commits || []) {
    if (!commit.acceptanceRationale) continue;
    const rationale = commit.acceptanceRationale;
    lines.push(
      `- Commit ${commit.id}: gate=${rationale.commitGateResult || "unknown"}, candidate=${rationale.selectedCandidateId || commit.candidateId || "none"}, score=${rationale.scoreId || "none"}, verifier=${rationale.verifierNodeId || commit.verifierNodeId || "none"}, evidence=${rationale.evidenceCount}, sandbox=${rationale.sandboxProfileId || "none"}, worker=${rationale.workerId || "none"}`
    );
  }
  return lines.length ? lines : ["No accepted candidate or verifier-gated commit rationale yet."];
}

function formatCommitGate(commit: WorkflowRun["commits"][number]): string {
  return [
    `verifier=${commit.verifierNodeId || "unknown"}`,
    commit.candidateId ? `candidate=${commit.candidateId}` : "",
    commit.selectionId ? `selection=${commit.selectionId}` : "",
    `evidence=${commit.evidence?.length || 0}`
  ]
    .filter(Boolean)
    .join(", ");
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return "none";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function renderPrompt(prompt: string, inputs: Record<string, unknown>): string {
  const invariant = Array.isArray(inputs.invariant)
    ? inputs.invariant.join("; ")
    : String(inputs.invariant || "");
  let rendered = String(prompt)
    .replaceAll("{{repo}}", String(inputs.repo || ""))
    .replaceAll("{{question}}", String(inputs.question || ""))
    .replaceAll("{{invariant}}", invariant);
  for (const [key, value] of Object.entries(inputs)) {
    const replacement = Array.isArray(value) ? value.join("; ") : String(value ?? "");
    rendered = rendered.replaceAll(`{{${key}}}`, replacement);
  }
  return rendered;
}

function formatInputList(value: unknown): string {
  if (Array.isArray(value)) return value.join("; ");
  return value ? String(value) : "";
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function numberOption(value: unknown): number | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringOption(value: unknown): string | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  return String(value);
}

function requiredStringOption(value: unknown, label: string): string {
  const parsed = stringOption(value);
  if (!parsed) throw new Error(`Missing ${label}`);
  return parsed;
}

function graphViewOption(value: unknown): GraphView {
  const parsed = stringOption(value);
  if (!parsed) return "compact";
  if (!(GRAPH_VIEWS as string[]).includes(parsed)) {
    throw new Error(`Unknown graph view: ${parsed}. Valid views: ${GRAPH_VIEWS.join(", ")}`);
  }
  return parsed as GraphView;
}

function graphViewsOption(options: Record<string, unknown>): GraphView[] | undefined {
  const raw = arrayOption(options.view || options.views).map(String);
  if (!raw.length) return undefined;
  for (const view of raw) {
    if (!(GRAPH_VIEWS as string[]).includes(view)) {
      throw new Error(`Unknown graph view: ${view}. Valid views: ${GRAPH_VIEWS.join(", ")}`);
    }
  }
  return raw as GraphView[];
}

function metadataOption(options: Record<string, unknown>): Record<string, unknown> | undefined {
  const raw = options.metadata;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") return JSON.parse(raw) as Record<string, unknown>;
  return undefined;
}

function withoutHostRunKeys(args: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...args };
  for (const key of [
    "app",
    "appId",
    "workflow",
    "workflowId",
    "inputs",
    "topology",
    "topologyId",
    "topologyRun",
    "topologyRunId",
    "multiAgentRun",
    "multiAgentRunId",
    "blackboard",
    "blackboardId",
    "mapperCount",
    "mappers",
    "mapper",
    "judgeCount",
    "judges",
    "judge",
    "debateRounds",
    "rounds",
    "collectInitialFanin",
    "collect-initial-fanin"
  ]) {
    delete copy[key];
  }
  return { ...copy, ...(optionsRecord(args.inputs) || {}) };
}

function optionsRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function parseBlackboardAuthor(options: Record<string, unknown>): { kind?: never; id?: string; displayName?: string } | undefined {
  const structured = options.author;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) return structured as never;
  const id = stringOption(options.authorId || options.author || options.worker || options.workerId || options.role || options.roleId || options.group || options.groupId);
  const kind = stringOption(options.authorKind || options.sourceKind || options.source);
  const displayName = stringOption(options.authorName || options.displayName);
  if (!id && !kind && !displayName) return undefined;
  return { kind: kind as never, id, displayName };
}

function parseBlackboardScope(options: Record<string, unknown>): { kind?: never; id?: string } | undefined {
  const structured = options.scope;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) return structured as never;
  const kind = stringOption(options.scopeKind);
  const id = stringOption(options.scopeId);
  if (!kind && !id) return undefined;
  return { kind: kind as never, id };
}

function parseBlackboardLinks(runId: string, options: Record<string, unknown>): Record<string, unknown> | undefined {
  const structured = options.provenance || options.links;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) return structured as Record<string, unknown>;
  const links = {
    workflowRunId: runId,
    multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
    agentGroupId: stringOption(options.group || options.groupId || options["multi-agent-group"]),
    agentRoleId: stringOption(options.role || options.roleId || options["multi-agent-role"]),
    agentMembershipId: stringOption(options.membership || options.membershipId || options["multi-agent-membership"]),
    agentFanoutId: stringOption(options.fanout || options.fanoutId || options["multi-agent-fanout"]),
    agentFaninId: stringOption(options.fanin || options.faninId || options["multi-agent-fanin"]),
    taskId: stringOption(options.task || options.taskId),
    workerId: stringOption(options.worker || options.workerId),
    candidateId: stringOption(options.candidate || options.candidateId),
    verifierNodeId: stringOption(options.verifier || options.verifierNode || options.verifierNodeId),
    commitId: stringOption(options.commit || options.commitId),
    auditEventIds: arrayOption(options.audit || options.auditEvent || options.auditEventId || options["audit-event"]).map(String),
    evidenceRefs: arrayOption(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String)
  };
  const entries = Object.entries(links).filter(([, value]) => value !== undefined && (!Array.isArray(value) || value.length));
  return entries.length > 1 ? Object.fromEntries(entries) : undefined;
}

function parseSandboxChoices(options: Record<string, unknown>): Record<string, string> | undefined {
  const choices: Record<string, string> = {};
  const structured = options.sandboxChoices || options.sandboxProfileChoices;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    for (const [key, value] of Object.entries(structured as Record<string, unknown>)) choices[key] = String(value);
  }
  for (const entry of arrayOption(options.sandboxChoice || options["sandbox-choice"])) {
    const [key, ...rest] = String(entry).split("=");
    if (key && rest.length) choices[key] = rest.join("=");
  }
  const sandbox = stringOption(options.sandbox || options.sandboxProfile || options.sandboxProfileId);
  if (sandbox && !Object.keys(choices).length) choices.default = sandbox;
  return Object.keys(choices).length ? choices : undefined;
}

function parseCriteria(options: Record<string, unknown>): Record<string, number> {
  const criteria: Record<string, number> = {};
  const structured = options.criteria;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    for (const [key, value] of Object.entries(structured as Record<string, unknown>)) {
      const parsed = Number(value);
      if (key && Number.isFinite(parsed)) criteria[key] = parsed;
    }
  }
  const rawCriteria = options.criterion || (typeof structured === "object" && !Array.isArray(structured) ? undefined : structured) || options.score;
  for (const entry of arrayOption(rawCriteria)) {
    const [key, value] = String(entry).split("=");
    if (!key || value === undefined) continue;
    criteria[key] = Number(value);
  }
  if (!Object.keys(criteria).length && options.total !== undefined) {
    criteria.total = Number(options.total);
  }
  if (!Object.keys(criteria).length) throw new Error("Missing score criteria. Use --criterion name=value");
  return criteria;
}

function parseEvidence(value: unknown) {
  return arrayOption(value).map((entry, index) => ({
    id: `score:${index + 1}`,
    source: "candidate-score",
    locator: String(entry),
    summary: String(entry)
  }));
}

function mergeEvidence<T extends { id: string }>(left: T[], right: T[]): T[] {
  const merged = [...left];
  for (const item of right) {
    const index = merged.findIndex((entry) => entry.id === item.id);
    if (index >= 0) merged[index] = item;
    else merged.push(item);
  }
  return merged;
}

function arrayOption(value: unknown): unknown[] {
  if (value === undefined || value === null || value === true) return [];
  return Array.isArray(value) ? value : [value];
}

function valuesOption(value: unknown): string[] {
  return arrayOption(value).map((entry) => String(entry).split("=")[0]).filter(Boolean);
}

function inferAuditDecisionKind(options: Record<string, unknown>): string {
  if (options.command) return "sandbox.command";
  if (options.network || options.networkTarget) return "sandbox.network";
  if (options.env || options.envVar) return "sandbox.env";
  return "sandbox.path";
}

function isSandboxProfileError(error: unknown): error is SandboxProfileError {
  return error instanceof SandboxProfileError || Boolean(error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code).startsWith("sandbox-"));
}

function validationIssuesFromError(error: unknown): WorkflowAppValidationIssue[] {
  if (error instanceof WorkflowAppValidationError) return error.issues;
  return [
    {
      code: "workflow-app-invalid",
      message: error instanceof Error ? error.message : String(error)
    }
  ];
}

function createRunId(workflowId: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${workflowId}-${stamp}-${suffix}`;
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

function renderWorkflowTemplate(id: string, title: string): string {
  return `module.exports = ({ workflow, phase, agent, artifact }) =>\n  workflow({\n    id: ${JSON.stringify(id)},\n    title: ${JSON.stringify(title)},\n    summary: "Describe what this workflow does.",\n    limits: {\n      maxAgents: 8,\n      maxConcurrentAgents: 4\n    },\n    inputs: [\n      { name: "question", required: true }\n    ],\n    phases: [\n      phase("Map", [\n        agent("map:context", "Map the task context, constraints, and evidence needed for {{question}}.")\n      ]),\n      phase("Assess", [\n        agent("assess:risks", "Assess risks, tradeoffs, and unknowns for {{question}}.")\n      ]),\n      phase("Synthesize", [\n        artifact("synthesis:report", "Synthesize the final answer for {{question}}.", { requiresEvidence: true })\n      ])\n    ]\n  });\n`;
}

function titleize(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
