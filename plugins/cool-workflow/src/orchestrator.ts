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
import { createRunPaths, ensureRunDirs, loadRunFromCwd, safeFileName, saveCheckpoint, writeJson } from "./state";
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
      workers: [],
      sandboxProfiles: [],
      candidates: [],
      candidateSelections: []
    };

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
        sandboxProfileId: stringOption(options.sandbox) || stringOption(options.sandboxProfile) || stringOption(options.sandboxProfileId)
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
  return `Cool Workflow\n\nCommands:\n  list\n  init <workflow-id> [--title TEXT] [--output PATH]\n  plan <workflow-id> [--repo PATH] [--question TEXT] [--invariant TEXT]\n  status <run-id> [--json|--format json]\n  next <run-id> [--limit N]\n  graph <run-id> [--json]\n  dispatch <run-id> [--limit N] [--sandbox PROFILE]\n  result <run-id> <task-id> <result-file>\n  commit <run-id> --verifier <node-id> [--reason TEXT]\n  commit <run-id> --candidate <candidate-id> [--reason TEXT]\n  commit <run-id> --selection <selection-id> [--reason TEXT]\n  commit <run-id> --allow-unverified-checkpoint [--reason TEXT]\n  commit summary <run-id> [--json]\n  report <run-id> [--show|--summary]\n  app list\n  app show <app-id>\n  app validate <path-or-app-id>\n  app init <app-id> --title TEXT\n  app package <app-id> [--output PATH]\n  sandbox list\n  sandbox show <profile-id>\n  sandbox validate <profile-file>\n  contract show <run-id> [contract-id]\n  node list <run-id>\n  node show <run-id> <node-id>\n  node graph <run-id> [--json]\n  feedback list <run-id> [--status open]\n  feedback summary <run-id> [--json]\n  feedback show <run-id> <feedback-id>\n  feedback collect <run-id>\n  feedback task <run-id> <feedback-id> [--verify CMD]\n  feedback resolve <run-id> <feedback-id> --node <node-id>\n  worker list <run-id> [--status running]\n  worker summary <run-id> [--json]\n  worker show <run-id> <worker-id>\n  worker manifest <run-id> <worker-id>\n  worker output <run-id> <worker-id> <result-file>\n  worker fail <run-id> <worker-id> --message TEXT\n  worker validate <run-id> <worker-id> [path]\n  candidate list <run-id> [--status scored]\n  candidate summary <run-id> [--json]\n  candidate register <run-id> --worker <worker-id>\n  candidate score <run-id> <candidate-id> --criterion name=value --evidence PATH\n  candidate rank <run-id>\n  candidate select <run-id> <candidate-id> [--reason TEXT]\n  candidate reject <run-id> <candidate-id> --reason TEXT\n  loop --intervalMinutes 30 --prompt TEXT\n  schedule create --kind loop --intervalMinutes 30 --prompt TEXT\n  schedule list [--status active]\n  schedule due\n  schedule complete <schedule-id>\n  schedule pause <schedule-id>\n  schedule resume <schedule-id>\n  schedule run-now <schedule-id>\n  schedule history [schedule-id]\n  schedule daemon [--once] [--intervalSeconds 60]\n  schedule delete <schedule-id>\n  routine create --kind api|github --prompt TEXT [--match JSON]\n  routine fire api|github [payload.json]\n  routine list\n  routine events [trigger-id]\n  routine delete <trigger-id>\n\n`;
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
    "## Sandbox Profiles",
    "",
    ...renderSandboxProfiles(run),
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
    lines.push(fs.readFileSync(task.resultPath, "utf8").trim(), "");
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
