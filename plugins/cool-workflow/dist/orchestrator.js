"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoolWorkflowRunner = void 0;
exports.parseArgv = parseArgv;
exports.formatHelp = formatHelp;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const workflow_api_1 = require("./workflow-api");
const workflow_app_sdk_1 = require("./workflow-app-sdk");
const dispatch_1 = require("./dispatch");
const harness_1 = require("./harness");
const commit_1 = require("./commit");
const verifier_1 = require("./verifier");
const state_1 = require("./state");
const pipeline_contract_1 = require("./pipeline-contract");
const observability_1 = require("./observability");
const error_feedback_1 = require("./error-feedback");
const state_node_1 = require("./state-node");
const pipeline_runner_1 = require("./pipeline-runner");
const worker_isolation_1 = require("./worker-isolation");
const candidate_scoring_1 = require("./candidate-scoring");
const collaboration_1 = require("./collaboration");
const sandbox_profile_1 = require("./sandbox-profile");
const execution_backend_1 = require("./execution-backend");
const operator_ux_1 = require("./operator-ux");
const trust_audit_1 = require("./trust-audit");
const multi_agent_trust_1 = require("./multi-agent-trust");
const multi_agent_1 = require("./multi-agent");
const coordinator_1 = require("./coordinator");
const topology_1 = require("./topology");
const multi_agent_host_1 = require("./multi-agent-host");
const multi_agent_operator_ux_1 = require("./multi-agent-operator-ux");
const multi_agent_eval_1 = require("./multi-agent-eval");
const state_explosion_1 = require("./state-explosion");
const evidence_reasoning_1 = require("./evidence-reasoning");
const report_1 = require("./orchestrator/report");
const cli_options_1 = require("./orchestrator/cli-options");
class CoolWorkflowRunner {
    pluginRoot;
    workflowsDir;
    appsDir;
    constructor({ pluginRoot }) {
        this.pluginRoot = resolvePluginRoot(pluginRoot);
        this.workflowsDir = node_path_1.default.join(this.pluginRoot, "workflows");
        this.appsDir = node_path_1.default.join(this.pluginRoot, "apps");
    }
    listWorkflows() {
        return this.loadWorkflowApps().map((record) => {
            const summary = (0, workflow_app_sdk_1.summarizeWorkflowApp)(record);
            return {
                id: summary.id,
                title: summary.title,
                summary: summary.summary,
                file: summary.file
            };
        });
    }
    listApps() {
        return this.loadWorkflowApps().map((record) => (0, workflow_app_sdk_1.summarizeWorkflowApp)(record));
    }
    showApp(appId) {
        const record = this.loadWorkflowAppById(appId);
        const summary = (0, workflow_app_sdk_1.summarizeWorkflowApp)(record);
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
    validateApp(target) {
        try {
            const record = this.loadWorkflowAppTarget(target);
            const result = (0, workflow_app_sdk_1.validateWorkflowApp)(record.app, {
                appPath: record.source.manifestPath || record.source.entrypointPath || record.source.path
            });
            return {
                ...result,
                summary: (0, workflow_app_sdk_1.summarizeWorkflowApp)(record)
            };
        }
        catch (error) {
            const issues = (0, cli_options_1.validationIssuesFromError)(error);
            return {
                valid: false,
                appId: target,
                appPath: node_path_1.default.resolve(target),
                issues
            };
        }
    }
    initApp(appId, options) {
        const id = (0, workflow_api_1.slugify)(appId);
        if (!id)
            throw new Error("App id must include at least one letter or digit");
        const title = String(options.title || titleize(id));
        const destinationDir = node_path_1.default.resolve(String(options.directory || options.output || node_path_1.default.join(this.appsDir, id)));
        const manifestPath = node_path_1.default.join(destinationDir, "app.json");
        const entrypointPath = node_path_1.default.join(destinationDir, "workflow.js");
        if (!options.force && (node_fs_1.default.existsSync(manifestPath) || node_fs_1.default.existsSync(entrypointPath))) {
            throw new Error(`Refusing to overwrite existing workflow app: ${destinationDir}`);
        }
        node_fs_1.default.mkdirSync(destinationDir, { recursive: true });
        node_fs_1.default.writeFileSync(manifestPath, (0, workflow_app_sdk_1.renderWorkflowAppManifestTemplate)(id, title), "utf8");
        node_fs_1.default.writeFileSync(entrypointPath, (0, workflow_app_sdk_1.renderWorkflowAppEntrypointTemplate)(id, title), "utf8");
        const validation = this.validateApp(manifestPath);
        if (!validation.valid) {
            throw new workflow_app_sdk_1.WorkflowAppValidationError("Generated workflow app is invalid", validation.issues);
        }
        return { id, manifestPath, entrypointPath };
    }
    packageApp(appId, options = {}) {
        const record = this.loadWorkflowAppById(appId);
        const destination = node_path_1.default.resolve(String(options.output ||
            node_path_1.default.join(process.cwd(), ".cw", "packages", `${record.app.id}-${record.app.version}.cwapp.json`)));
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(destination), { recursive: true });
        (0, state_1.writeJson)(destination, {
            schemaVersion: 1,
            app: (0, workflow_app_sdk_1.workflowAppRunMetadata)(record),
            workflow: record.app.workflow,
            packagedAt: new Date().toISOString()
        });
        return { id: record.app.id, version: record.app.version, path: destination };
    }
    init(workflowId, options) {
        const id = (0, workflow_api_1.slugify)(workflowId);
        if (!id)
            throw new Error("Workflow id must include at least one letter or digit");
        const title = String(options.title || titleize(id));
        const destination = node_path_1.default.resolve(String(options.output || node_path_1.default.join(this.workflowsDir, `${id}.workflow.js`)));
        if (node_fs_1.default.existsSync(destination) && !options.force) {
            throw new Error(`Refusing to overwrite existing workflow: ${destination}`);
        }
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(destination), { recursive: true });
        node_fs_1.default.writeFileSync(destination, (0, workflow_app_sdk_1.renderWorkflowAppTemplate)(id, title), "utf8");
        return { id, path: destination };
    }
    plan(workflowId, options) {
        const appRecord = this.loadWorkflowAppById(workflowId);
        const workflow = appRecord.app.workflow;
        const inputs = normalizeInputs(options);
        validateInputs(workflow, inputs);
        const cwd = node_path_1.default.resolve(String(inputs.cwd || inputs.repo || process.cwd()));
        const runId = createRunId(workflow.id);
        const runDir = node_path_1.default.join(cwd, ".cw", "runs", runId);
        const paths = (0, state_1.createRunPaths)(runDir);
        (0, state_1.ensureRunDirs)(paths);
        const tasks = flattenTasks(workflow, inputs);
        const run = {
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
                app: (0, workflow_app_sdk_1.workflowAppRunMetadata)(appRecord)
            },
            inputs,
            loopStage: "interpret",
            phases: workflow.phases.map((phase) => ({
                id: phase.id || (0, workflow_api_1.slugify)(phase.name),
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
                eventLogPath: paths.auditDir ? node_path_1.default.join(paths.auditDir, "events.jsonl") : undefined,
                summaryPath: paths.auditDir ? node_path_1.default.join(paths.auditDir, "summary.json") : undefined,
                indexPath: paths.auditDir ? node_path_1.default.join(paths.auditDir, "index.json") : undefined
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
        (0, trust_audit_1.ensureTrustAudit)(run);
        (0, multi_agent_1.ensureMultiAgentState)(run);
        (0, topology_1.ensureTopologyState)(run);
        (0, harness_1.writeTaskFiles)(run);
        const contract = (0, state_node_1.upsertRunContract)(run, (0, pipeline_contract_1.createDefaultPipelineContract)());
        const inputNode = (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
            id: `${run.id}:input`,
            kind: "input",
            status: "completed",
            loopStage: "interpret",
            outputs: run.inputs,
            artifacts: [{ id: "state", kind: "json", path: run.paths.state }],
            contractId: contract.id,
            metadata: { workflowId: workflow.id, app: (0, workflow_app_sdk_1.workflowAppRunMetadata)(appRecord) }
        }));
        (0, state_1.saveCheckpoint)(run);
        const pipeline = (0, pipeline_runner_1.createPipelineRunner)({ contractId: contract.id, persist: false });
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
        (0, report_1.writeReport)(run);
        (0, commit_1.commitState)(run, "initial-plan");
        (0, state_1.saveCheckpoint)(run);
        return run;
    }
    status(runId) {
        return (0, report_1.summarizeRun)(this.loadRun(runId));
    }
    operatorStatus(runId) {
        return (0, operator_ux_1.summarizeOperatorRun)(this.loadRun(runId));
    }
    next(runId, options) {
        return (0, dispatch_1.nextDispatchTasks)(this.loadRun(runId), (0, cli_options_1.numberOption)(options.limit));
    }
    dispatch(runId, options) {
        const run = this.loadRun(runId);
        try {
            const manifest = (0, dispatch_1.createDispatchManifest)(run, (0, cli_options_1.numberOption)(options.limit), {
                sandboxProfileId: (0, cli_options_1.stringOption)(options.sandbox) || (0, cli_options_1.stringOption)(options.sandboxProfile) || (0, cli_options_1.stringOption)(options.sandboxProfileId),
                backendId: (0, cli_options_1.stringOption)(options.backend) || (0, cli_options_1.stringOption)(options.backendId) || (0, cli_options_1.stringOption)(options.executionBackend),
                multiAgentRunId: (0, cli_options_1.stringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
                multiAgentGroupId: (0, cli_options_1.stringOption)(options.multiAgentGroup || options.multiAgentGroupId || options.group || options["multi-agent-group"]),
                multiAgentRoleId: (0, cli_options_1.stringOption)(options.multiAgentRole || options.multiAgentRoleId || options.role || options["multi-agent-role"]),
                multiAgentFanoutId: (0, cli_options_1.stringOption)(options.multiAgentFanout || options.multiAgentFanoutId || options.fanout || options["multi-agent-fanout"])
            });
            run.loopStage = "act";
            if (manifest.dispatchId)
                (0, commit_1.commitState)(run, `dispatch:${manifest.dispatchId}`);
            (0, state_1.saveCheckpoint)(run);
            (0, report_1.writeReport)(run);
            return manifest;
        }
        catch (error) {
            if ((0, cli_options_1.isSandboxProfileError)(error)) {
                run.loopStage = "adjust";
                (0, error_feedback_1.recordFeedback)(run, {
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
                    metadata: { sandboxProfileId: (0, cli_options_1.stringOption)(options.sandbox) || (0, cli_options_1.stringOption)(options.sandboxProfile) || (0, cli_options_1.stringOption)(options.sandboxProfileId) }
                }, { persist: false });
                (0, report_1.writeReport)(run);
                (0, state_1.saveCheckpoint)(run);
            }
            throw error;
        }
    }
    recordResult(runId, taskId, resultPath, options = {}) {
        const run = this.loadRun(runId);
        const task = run.tasks.find((candidate) => candidate.id === taskId);
        if (!task)
            throw new Error(`Unknown task id for run ${runId}: ${taskId}`);
        // Host-attested token usage (v0.1.31), if the caller supplied it. CW records
        // it verbatim as provenance and NEVER synthesizes it; absent ⇒ `unreported`.
        const usage = (0, observability_1.parseUsageFromArgs)(options, new Date().toISOString());
        try {
            (0, verifier_1.assertTaskCanComplete)(run, task);
            const absoluteResultPath = node_path_1.default.resolve(resultPath);
            if (!node_fs_1.default.existsSync(absoluteResultPath)) {
                throw new Error(`Result file does not exist: ${absoluteResultPath}`);
            }
            const rawResult = node_fs_1.default.readFileSync(absoluteResultPath, "utf8");
            run.loopStage = "observe";
            const parsedResult = (0, verifier_1.parseResultEnvelope)(rawResult);
            run.loopStage = "adjust";
            (0, verifier_1.validateResultEnvelope)(task, parsedResult);
            const destination = node_path_1.default.join(run.paths.resultsDir, `${(0, state_1.safeFileName)(taskId)}.md`);
            node_fs_1.default.copyFileSync(absoluteResultPath, destination);
            task.status = "completed";
            task.completedAt = new Date().toISOString();
            task.resultPath = destination;
            task.loopStage = "observe";
            task.result = parsedResult;
            if (usage)
                task.usage = usage;
            const resultNode = (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
                id: `${run.id}:result:${task.id}`,
                kind: "result",
                status: "completed",
                loopStage: "observe",
                inputs: { taskId: task.id, dispatchId: task.dispatchId },
                outputs: parsedResult,
                artifacts: [{ id: "result", kind: "markdown", path: destination }],
                evidence: parsedResult.evidence.map((entry, index) => ({
                    id: `result:${index + 1}`,
                    source: "cw:result",
                    locator: entry,
                    summary: entry
                })),
                parents: task.dispatchId ? [`${run.id}:dispatch:${task.dispatchId}`] : [task.stateNodeId || `${run.id}:task:${task.id}`],
                contractId: pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
                metadata: { taskId: task.id }
            }));
            task.resultNodeId = resultNode.id;
            (0, dispatch_1.updatePhaseStatuses)(run);
            (0, verifier_1.validateRunGates)(run);
            const verifierResult = (0, pipeline_runner_1.createPipelineRunner)({ persist: false }).runPipelineStage(run, "verify", resultNode.id, {
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
            (0, commit_1.commitState)(run, `result:${taskId}`);
            (0, report_1.writeReport)(run);
            (0, state_1.saveCheckpoint)(run);
            return (0, report_1.summarizeRun)(run);
        }
        catch (error) {
            (0, error_feedback_1.recordFeedback)(run, {
                source: "verifier",
                error: error instanceof Error ? error : String(error),
                taskId: task.id,
                path: resultPath ? node_path_1.default.resolve(resultPath) : undefined,
                retryable: false,
                metadata: {
                    taskStatus: task.status,
                    dispatchId: task.dispatchId,
                    stateNodeId: task.stateNodeId,
                    resultNodeId: task.resultNodeId
                }
            });
            (0, report_1.writeReport)(run);
            throw error;
        }
    }
    listWorkers(runId, options = {}) {
        return (0, worker_isolation_1.listWorkerScopes)(this.loadRun(runId), {
            status: options.status ? String(options.status) : undefined
        });
    }
    showWorker(runId, workerId) {
        const worker = (0, worker_isolation_1.getWorkerScope)(this.loadRun(runId), workerId);
        if (!worker)
            throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
        return worker;
    }
    showWorkerManifest(runId, workerId) {
        const run = this.loadRun(runId);
        const worker = (0, worker_isolation_1.getWorkerScope)(run, workerId);
        if (!worker)
            throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
        return (0, worker_isolation_1.writeWorkerManifest)(run, worker);
    }
    recordWorkerOutput(runId, workerId, resultPath, options = {}) {
        const run = this.loadRun(runId);
        const usage = (0, observability_1.parseUsageFromArgs)(options, new Date().toISOString());
        try {
            (0, worker_isolation_1.recordWorkerOutput)(run, workerId, resultPath, { persist: false });
            if (usage) {
                const worker = (0, worker_isolation_1.getWorkerScope)(run, workerId);
                // Host-attested token usage rides on the worker record as provenance.
                if (worker)
                    worker.usage = usage;
            }
            run.loopStage = "observe";
            (0, dispatch_1.updatePhaseStatuses)(run);
            (0, verifier_1.validateRunGates)(run);
            (0, commit_1.commitState)(run, `worker:${workerId}:result`);
            (0, report_1.writeReport)(run);
            (0, state_1.saveCheckpoint)(run);
            return (0, report_1.summarizeRun)(run);
        }
        catch (error) {
            run.loopStage = "adjust";
            (0, dispatch_1.updatePhaseStatuses)(run);
            (0, report_1.writeReport)(run);
            (0, state_1.saveCheckpoint)(run);
            throw error;
        }
    }
    recordWorkerFailure(runId, workerId, message, options = {}) {
        const run = this.loadRun(runId);
        const failure = (0, worker_isolation_1.recordWorkerFailure)(run, workerId, {
            code: String(options.code || "worker-runtime-error"),
            message,
            at: new Date().toISOString(),
            path: options.path ? node_path_1.default.resolve(String(options.path)) : undefined,
            retryable: Boolean(options.retryable)
        }, { persist: false });
        run.loopStage = "adjust";
        (0, dispatch_1.updatePhaseStatuses)(run);
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return failure;
    }
    validateWorker(runId, workerId, targetPath) {
        return (0, worker_isolation_1.validateWorkerBoundary)(this.loadRun(runId), workerId, targetPath ? { path: targetPath } : {});
    }
    auditSummary(runId) {
        return (0, trust_audit_1.summarizeTrustAudit)(this.loadRun(runId));
    }
    auditMultiAgent(runId) {
        return (0, multi_agent_trust_1.summarizeMultiAgentTrust)(this.loadRun(runId));
    }
    auditPolicy(runId) {
        const run = this.loadRun(runId);
        const summary = (0, multi_agent_trust_1.summarizeMultiAgentTrust)(run);
        return {
            schemaVersion: 1,
            runId,
            rolePolicies: summary.rolePolicies,
            permissionDecisions: summary.permissionDecisions,
            policyViolations: summary.policyViolations,
            nextAction: summary.nextAction
        };
    }
    auditRole(runId, roleId) {
        const run = this.loadRun(runId);
        const summary = (0, multi_agent_trust_1.summarizeMultiAgentTrust)(run);
        const events = (0, trust_audit_1.listTrustAuditEvents)(run).filter((event) => event.agentRoleId === roleId);
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
    auditBlackboard(runId) {
        const summary = (0, multi_agent_trust_1.summarizeMultiAgentTrust)(this.loadRun(runId));
        return {
            schemaVersion: 1,
            runId,
            blackboardWrites: summary.blackboardWrites,
            messageProvenance: summary.messageProvenance,
            policyViolations: summary.policyViolations.filter((event) => event.blackboardId),
            nextAction: summary.nextAction
        };
    }
    auditJudge(runId) {
        const summary = (0, multi_agent_trust_1.summarizeMultiAgentTrust)(this.loadRun(runId));
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
    workerAudit(runId, workerId) {
        return (0, trust_audit_1.workerTrustAudit)(this.loadRun(runId), workerId);
    }
    evidenceProvenance(runId, options = {}) {
        return (0, trust_audit_1.evidenceProvenance)(this.loadRun(runId), {
            workerId: (0, cli_options_1.stringOption)(options.worker || options.workerId),
            candidateId: (0, cli_options_1.stringOption)(options.candidate || options.candidateId),
            commitId: (0, cli_options_1.stringOption)(options.commit || options.commitId)
        });
    }
    recordAuditAttestation(runId, options = {}) {
        const run = this.loadRun(runId);
        const workerId = (0, cli_options_1.stringOption)(options.worker || options.workerId);
        const worker = workerId ? (0, worker_isolation_1.getWorkerScope)(run, workerId) : undefined;
        const event = (0, trust_audit_1.recordHostAttestation)(run, {
            actor: (0, cli_options_1.stringOption)(options.actor) || "host",
            workerId,
            taskId: worker?.taskId || (0, cli_options_1.stringOption)(options.task || options.taskId),
            sandboxProfileId: worker?.sandboxProfileId || (0, cli_options_1.stringOption)(options.sandboxProfileId),
            policySnapshot: worker?.sandboxPolicy,
            command: (0, cli_options_1.stringOption)(options.command),
            networkTarget: (0, cli_options_1.stringOption)(options.network || options.networkTarget),
            envVars: (0, cli_options_1.valuesOption)(options.env || options.envVar || options.envVars),
            metadata: {
                note: (0, cli_options_1.stringOption)(options.note || options.message),
                hostEnforced: options.hostEnforced === undefined ? undefined : Boolean(options.hostEnforced)
            }
        });
        (0, state_1.saveCheckpoint)(run);
        return event;
    }
    recordAuditDecision(runId, workerId, options = {}) {
        const run = this.loadRun(runId);
        const worker = (0, worker_isolation_1.getWorkerScope)(run, workerId);
        if (!worker)
            throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
        const kind = (0, cli_options_1.stringOption)(options.kind) || (0, cli_options_1.inferAuditDecisionKind)(options);
        const target = (0, cli_options_1.stringOption)(options.path || options.command || options.network || options.networkTarget || options.env || options.envVar);
        if (!target)
            throw new Error("Missing audit decision target: provide --path, --command, --network, or --env");
        const policy = worker.sandboxPolicy;
        let denied = null;
        if (kind === "sandbox.command") {
            denied = policy ? (0, sandbox_profile_1.validateSandboxCommand)(policy, target, workerId) : null;
        }
        else if (kind === "sandbox.network") {
            denied = policy ? (0, sandbox_profile_1.validateSandboxNetwork)(policy, target, workerId) : null;
        }
        else if (kind === "sandbox.env") {
            const name = target.includes("=") ? target.split("=")[0] : target;
            const allowed = Boolean(policy?.env.inherit || policy?.env.expose.includes(name));
            denied = allowed ? null : { code: "sandbox-env-denied", message: `Worker ${workerId} env var is outside sandbox profile ${policy?.id || "unknown"}: ${name}` };
        }
        else {
            denied = (0, worker_isolation_1.validateWorkerBoundary)(run, workerId, { path: target });
        }
        const feedbackIds = [];
        if (denied) {
            const failure = (0, worker_isolation_1.recordWorkerFailure)(run, workerId, {
                code: denied.code,
                message: denied.message,
                at: new Date().toISOString(),
                path: denied.path || (kind === "sandbox.path" ? node_path_1.default.resolve(target) : undefined),
                retryable: false
            }, { persist: false });
            feedbackIds.push(...(failure.feedbackIds || []));
        }
        const event = kind === "sandbox.path"
            ? (0, trust_audit_1.recordSandboxPathDecision)(run, {
                workerId,
                taskId: worker.taskId,
                sandboxProfileId: worker.sandboxProfileId,
                policySnapshot: policy,
                target,
                decision: denied ? "denied" : "allowed",
                feedbackIds,
                metadata: { code: denied?.code }
            })
            : (0, trust_audit_1.recordSandboxPolicyDecision)(run, {
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
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return event;
    }
    listSandboxProfiles(options = {}) {
        return (0, sandbox_profile_1.listBundledSandboxProfiles)((0, sandbox_profile_1.sandboxContextForValidation)(String(options.cwd || process.cwd())));
    }
    showSandboxProfile(profileId, options = {}) {
        return (0, sandbox_profile_1.showBundledSandboxProfile)(profileId, (0, sandbox_profile_1.sandboxContextForValidation)(String(options.cwd || process.cwd())));
    }
    validateSandboxProfile(profileFile, options = {}) {
        return (0, sandbox_profile_1.validateSandboxProfileFile)(profileFile, (0, sandbox_profile_1.sandboxContextForValidation)(String(options.cwd || process.cwd())));
    }
    listBackends(options = {}) {
        void options;
        return (0, execution_backend_1.backendListPayload)();
    }
    showBackend(backendId, options = {}) {
        void options;
        return (0, execution_backend_1.backendShowPayload)(backendId);
    }
    probeBackend(backendId, options = {}) {
        return (0, execution_backend_1.backendProbePayload)(backendId, { cwd: String(options.cwd || process.cwd()) });
    }
    listCandidates(runId, options = {}) {
        return (0, candidate_scoring_1.listCandidates)(this.loadRun(runId), {
            status: options.status ? String(options.status) : undefined,
            kind: options.kind ? String(options.kind) : undefined
        });
    }
    showCandidate(runId, candidateId) {
        const candidate = (0, candidate_scoring_1.getCandidate)(this.loadRun(runId), candidateId);
        if (!candidate)
            throw new Error(`Unknown candidate id for run ${runId}: ${candidateId}`);
        return candidate;
    }
    registerCandidate(runId, options = {}) {
        const run = this.loadRun(runId);
        const workerId = options.worker ? String(options.worker) : undefined;
        const worker = workerId ? (0, worker_isolation_1.getWorkerScope)(run, workerId) : undefined;
        if (workerId && !worker)
            throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
        const task = worker ? run.tasks.find((candidate) => candidate.id === worker.taskId) : undefined;
        const resultNodeId = (0, cli_options_1.stringOption)(options.resultNode) || worker?.resultNodeId || task?.resultNodeId;
        const verifierNodeId = (0, cli_options_1.stringOption)(options.verifierNode) || worker?.output?.verifierNodeId || task?.verifierNodeId;
        const resultPath = (0, cli_options_1.stringOption)(options.resultPath) || worker?.output?.resultPath || task?.resultPath;
        const resultNode = resultNodeId ? run.nodes?.find((node) => node.id === resultNodeId) : undefined;
        const verifierNode = verifierNodeId ? run.nodes?.find((node) => node.id === verifierNodeId) : undefined;
        const candidate = (0, candidate_scoring_1.registerCandidate)(run, {
            id: (0, cli_options_1.stringOption)(options.id),
            kind: (0, cli_options_1.stringOption)(options.kind),
            workerId,
            taskId: (0, cli_options_1.stringOption)(options.task) || worker?.taskId,
            resultNodeId,
            verifierNodeId,
            resultPath,
            artifacts: [
                ...(resultPath ? [{ id: "result", kind: "markdown", path: node_path_1.default.resolve(resultPath) }] : []),
                ...(worker ? [{ id: "worker", kind: "json", path: node_path_1.default.join(worker.workerDir, "worker.json") }] : [])
            ],
            evidence: (0, cli_options_1.mergeEvidence)(resultNode?.evidence || [], verifierNode?.evidence || []),
            metadata: {
                source: worker ? "worker" : "manual",
                workerDir: worker?.workerDir
            }
        }, { persist: false });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return candidate;
    }
    scoreCandidate(runId, candidateId, options = {}) {
        const run = this.loadRun(runId);
        const score = (0, candidate_scoring_1.scoreCandidate)(run, candidateId, {
            id: (0, cli_options_1.stringOption)(options.id),
            scorer: (0, cli_options_1.stringOption)(options.scorer),
            criteria: (0, cli_options_1.parseCriteria)(options),
            maxTotal: (0, cli_options_1.numberOption)(options.maxTotal || options.max),
            verdict: (0, cli_options_1.stringOption)(options.verdict),
            evidence: (0, cli_options_1.parseEvidence)(options.evidence),
            notes: (0, cli_options_1.stringOption)(options.notes)
        }, { persist: false });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return score;
    }
    rankCandidates(runId, options = {}) {
        const run = this.loadRun(runId);
        const ranking = (0, candidate_scoring_1.rankCandidates)(run, {
            includeRejected: Boolean(options.includeRejected),
            policy: {
                minNormalized: (0, cli_options_1.numberOption)(options.minNormalized),
                requireEvidence: options.requireEvidence === undefined ? undefined : Boolean(options.requireEvidence),
                requireVerifierGate: options.requireVerifierGate === undefined ? undefined : Boolean(options.requireVerifierGate),
                tieBreaker: (0, cli_options_1.stringOption)(options.tieBreaker)
            }
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return ranking;
    }
    selectCandidate(runId, candidateId, options = {}) {
        const run = this.loadRun(runId);
        const selection = (0, candidate_scoring_1.selectCandidate)(run, candidateId, {
            selectedBy: (0, cli_options_1.stringOption)(options.by) || (0, cli_options_1.stringOption)(options.selectedBy),
            reason: (0, cli_options_1.stringOption)(options.reason),
            scoreId: (0, cli_options_1.stringOption)(options.score),
            allowUnverified: Boolean(options.allowUnverified)
        }, {
            persist: false,
            policy: {
                minNormalized: (0, cli_options_1.numberOption)(options.minNormalized),
                requireVerifierGate: options.requireVerifierGate === undefined ? undefined : Boolean(options.requireVerifierGate)
            }
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return selection;
    }
    rejectCandidate(runId, candidateId, reason) {
        const run = this.loadRun(runId);
        const candidate = (0, candidate_scoring_1.rejectCandidate)(run, candidateId, reason, { persist: false });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return candidate;
    }
    // ---- Team Collaboration (v0.1.32) -------------------------------------
    // Append-only, host-attested (never authenticated) approvals/comments/handoffs
    // + a derived review state. Both CLI and MCP route through these methods, so
    // `cw <cmd> --json` is identical to `cw_<tool>` (the parity gate).
    collaborationApprove(runId, targetKind, targetId, options = {}, decision = "approve") {
        const run = this.loadRun(runId);
        const record = (0, collaboration_1.recordApproval)(run, {
            target: (0, cli_options_1.collaborationTarget)(targetKind, targetId),
            decision,
            ...(0, cli_options_1.actorInputFrom)(options),
            rationale: (0, cli_options_1.stringOption)(options.rationale) || (0, cli_options_1.stringOption)(options.reason) || (0, cli_options_1.stringOption)(options.message),
            supersedes: (0, cli_options_1.stringOption)(options.supersedes)
        }, { persist: false });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    collaborationReject(runId, targetKind, targetId, options = {}) {
        return this.collaborationApprove(runId, targetKind, targetId, options, "reject");
    }
    collaborationComment(runId, targetKind, targetId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, collaboration_1.recordComment)(run, {
            target: (0, cli_options_1.collaborationTarget)(targetKind, targetId),
            body: (0, cli_options_1.stringOption)(options.body) || (0, cli_options_1.stringOption)(options.message) || (0, cli_options_1.stringOption)(options.text) || "",
            threadId: (0, cli_options_1.stringOption)(options.thread) || (0, cli_options_1.stringOption)(options.threadId),
            parentId: (0, cli_options_1.stringOption)(options.parent) || (0, cli_options_1.stringOption)(options.parentId),
            ...(0, cli_options_1.actorInputFrom)(options)
        }, { persist: false });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    collaborationCommentList(runId, options = {}) {
        const run = this.loadRun(runId);
        const target = (0, cli_options_1.collaborationTargetMaybe)((0, cli_options_1.stringOption)(options.targetKind) || (0, cli_options_1.stringOption)(options.kind), (0, cli_options_1.stringOption)(options.target) || (0, cli_options_1.stringOption)(options.targetId));
        const comments = (0, collaboration_1.listComments)(run, target);
        return { schemaVersion: 1, surface: "collaboration", runId, target, count: comments.length, comments };
    }
    collaborationHandoff(runId, targetKind, targetId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, collaboration_1.recordHandoff)(run, {
            target: (0, cli_options_1.collaborationTarget)(targetKind, targetId),
            toActor: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "to", "toActor")),
            toActorKind: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "toKind", "to-kind", "toActorKind")),
            toRole: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "toRole", "to-role")),
            toDisplayName: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "toName", "to-name", "toDisplayName")),
            toAttested: Boolean((0, cli_options_1.firstDefined)(options, "toAttested", "to-attested")),
            fromActor: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "from", "fromActor")),
            fromActorKind: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "fromKind", "from-kind", "fromActorKind")),
            fromRole: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "fromRole", "from-role")),
            reason: (0, cli_options_1.stringOption)(options.reason) || (0, cli_options_1.stringOption)(options.message) || "handoff",
            ...(0, cli_options_1.actorInputFrom)(options)
        }, { persist: false });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    reviewStatus(runId, options = {}) {
        const run = this.loadRun(runId);
        const now = typeof options.now === "string" && options.now ? options.now : new Date().toISOString();
        const target = (0, cli_options_1.collaborationTargetMaybe)((0, cli_options_1.stringOption)(options.targetKind) || (0, cli_options_1.stringOption)(options.kind), (0, cli_options_1.stringOption)(options.target) || (0, cli_options_1.stringOption)(options.targetId));
        return (0, collaboration_1.buildReviewStatusReport)(run, { now, target });
    }
    reviewPolicy(runId, options = {}) {
        const run = this.loadRun(runId);
        const allowSelf = (0, cli_options_1.firstDefined)(options, "allowSelfApproval", "allow-self-approval");
        const requireAttested = (0, cli_options_1.firstDefined)(options, "requireAttestedActor", "require-attested-actor");
        const policy = (0, collaboration_1.setReviewPolicy)(run, {
            requiredApprovals: (0, cli_options_1.numberOption)((0, cli_options_1.firstDefined)(options, "requiredApprovals", "required-approvals", "required", "approvals")),
            authorizedRoles: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "authorizedRoles", "authorized-roles", "roles")),
            allowSelfApproval: allowSelf === undefined ? undefined : Boolean(allowSelf),
            requireAttestedActor: requireAttested === undefined ? undefined : Boolean(requireAttested),
            appliesTo: (0, cli_options_1.stringOption)((0, cli_options_1.firstDefined)(options, "appliesTo", "applies-to", "targets"))
        }, { persist: false });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return { schemaVersion: 1, surface: "collaboration", runId, policy };
    }
    formatReviewStatus(report) {
        return (0, collaboration_1.formatReviewStatus)(report);
    }
    formatCommentList(comments) {
        return (0, collaboration_1.formatCommentList)(comments);
    }
    summarizeCandidateRecords(runId) {
        return (0, candidate_scoring_1.summarizeCandidates)(this.loadRun(runId));
    }
    summarizeWorkerRecords(runId) {
        return (0, operator_ux_1.summarizeOperatorWorkers)(this.loadRun(runId));
    }
    summarizeCandidateOperatorRecords(runId) {
        return (0, operator_ux_1.summarizeOperatorCandidates)(this.loadRun(runId));
    }
    summarizeFeedbackRecords(runId) {
        return (0, operator_ux_1.summarizeOperatorFeedback)(this.loadRun(runId));
    }
    summarizeCommitRecords(runId) {
        return (0, operator_ux_1.summarizeOperatorCommits)(this.loadRun(runId));
    }
    report(runId) {
        const run = this.loadRun(runId);
        return { path: (0, report_1.writeReport)(run) };
    }
    operatorReport(runId) {
        const run = this.loadRun(runId);
        (0, report_1.writeReport)(run);
        return (0, operator_ux_1.summarizeOperatorRun)(run);
    }
    showContract(runId, contractId) {
        const run = this.loadRun(runId);
        return (0, pipeline_runner_1.createPipelineRunner)().getRunContract(run, contractId);
    }
    listNodes(runId) {
        return this.loadRun(runId).nodes || [];
    }
    showNode(runId, nodeId) {
        return (0, pipeline_runner_1.createPipelineRunner)().getRunNode(this.loadRun(runId), nodeId);
    }
    graphNodes(runId) {
        return (this.loadRun(runId).nodes || []).map((node) => ({
            id: node.id,
            kind: node.kind,
            status: node.status,
            parents: node.parents,
            children: node.children
        }));
    }
    operatorGraph(runId) {
        return (0, operator_ux_1.buildOperatorGraph)(this.loadRun(runId));
    }
    multiAgentSummary(runId) {
        return (0, multi_agent_1.summarizeMultiAgent)(this.loadRun(runId));
    }
    multiAgentGraph(runId) {
        return (0, multi_agent_1.buildMultiAgentGraph)(this.loadRun(runId));
    }
    multiAgentOperatorStatus(runId) {
        return (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(this.loadRun(runId));
    }
    multiAgentOperatorGraph(runId) {
        return (0, multi_agent_operator_ux_1.buildMultiAgentOperatorGraph)(this.loadRun(runId));
    }
    multiAgentDependencies(runId) {
        return (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(this.loadRun(runId)).dependencies;
    }
    multiAgentFailures(runId) {
        return (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(this.loadRun(runId)).failures;
    }
    multiAgentEvidence(runId) {
        const run = this.loadRun(runId);
        const rows = (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run).evidence;
        // Additive enrichment: attach the derived rationale status so `multi-agent
        // evidence` answers WHAT + whether the WHY is recorded, without changing the
        // existing row shape (POLA: old consumers ignore the new optional field).
        const report = (0, evidence_reasoning_1.buildEvidenceReasoningReport)(run, { index: (0, evidence_reasoning_1.loadEvidenceReasoningIndex)(run) });
        const byId = new Map(report.chains.map((chain) => [chain.id, chain.rationaleStatus]));
        for (const row of rows)
            row.rationaleStatus = byId.get(row.id);
        return rows;
    }
    multiAgentReasoning(runId, options = {}) {
        const run = this.loadRun(runId);
        if (options.refresh) {
            (0, evidence_reasoning_1.refreshEvidenceReasoning)(run);
            (0, state_1.saveCheckpoint)(run);
        }
        return (0, evidence_reasoning_1.showEvidenceReasoning)(run, { evidenceId: (0, cli_options_1.stringOption)(options.evidence || options.evidenceId || options.id) });
    }
    multiAgentReasoningRefresh(runId) {
        const run = this.loadRun(runId);
        const index = (0, evidence_reasoning_1.refreshEvidenceReasoning)(run);
        (0, state_1.saveCheckpoint)(run);
        return index;
    }
    summaryRefresh(runId, options = {}) {
        const run = this.loadRun(runId);
        const index = (0, state_explosion_1.refreshStateExplosionSummaries)(run, { views: (0, cli_options_1.graphViewsOption)(options) });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return index;
    }
    summaryShow(runId) {
        const run = this.loadRun(runId);
        const report = (0, state_explosion_1.showStateExplosionSummary)(run);
        (0, state_1.saveCheckpoint)(run);
        return report;
    }
    /** Observability + cost report for ONE run (v0.1.31). DERIVED from durable
     *  state; persists a fingerprinted snapshot under `metrics/` but NEVER mutates
     *  the run's own state.json (no saveCheckpoint), so the source — and therefore
     *  the report — is stable across repeated reads. `now` is injectable via
     *  `args.now` for eval/replay determinism; pricing is POLICY via `--pricing`. */
    metricsShow(runId, args = {}) {
        const run = this.loadRun(runId);
        const policy = (0, observability_1.loadCostPolicy)(args, this.pluginRoot);
        const now = typeof args.now === "string" && args.now ? args.now : new Date().toISOString();
        return (0, observability_1.showMetricsReport)(run, { now, policy });
    }
    blackboardSummarize(runId, options = {}) {
        return (0, state_explosion_1.summarizeBlackboardDigest)(this.loadRun(runId), (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId));
    }
    multiAgentSummarize(runId) {
        const run = this.loadRun(runId);
        const index = (0, state_explosion_1.loadStateExplosionSummaryIndex)(run);
        return (0, state_explosion_1.buildStateExplosionReport)(run, { index });
    }
    multiAgentGraphView(runId, options = {}) {
        const view = (0, cli_options_1.graphViewOption)(options.view);
        return (0, state_explosion_1.buildCompactGraph)(this.loadRun(runId), view, {
            focus: (0, cli_options_1.stringOption)(options.focus),
            depth: (0, cli_options_1.numberOption)(options.depth)
        });
    }
    stateExplosionReport(runId) {
        const run = this.loadRun(runId);
        const index = (0, state_explosion_1.loadStateExplosionSummaryIndex)(run);
        return (0, state_explosion_1.buildStateExplosionReport)(run, { index });
    }
    hostMultiAgentRun(runId, options = {}) {
        const workflowId = (0, cli_options_1.stringOption)(options.app || options.appId || options.workflow || options.workflowId);
        const run = runId
            ? this.loadRun(runId)
            : workflowId
                ? this.plan(workflowId, (0, cli_options_1.withoutHostRunKeys)(options))
                : undefined;
        if (!run)
            throw new Error("multi-agent run requires <run-id> or --app <app-id>");
        const response = (0, multi_agent_host_1.hostRun)(run, options);
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return response;
    }
    hostMultiAgentStatus(runId) {
        const run = this.loadRun(runId);
        (0, report_1.writeReport)(run);
        return (0, multi_agent_host_1.hostStatus)(run);
    }
    hostMultiAgentStep(runId, options = {}) {
        const run = this.loadRun(runId);
        const response = (0, multi_agent_host_1.hostStep)(run, options);
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return response;
    }
    hostMultiAgentBlackboard(runId, action, options = {}) {
        const run = this.loadRun(runId);
        const response = (0, multi_agent_host_1.hostBlackboard)(run, action, options);
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return response;
    }
    hostMultiAgentScore(runId, options = {}) {
        const run = this.loadRun(runId);
        const response = (0, multi_agent_host_1.hostScore)(run, options);
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return response;
    }
    hostMultiAgentSelect(runId, options = {}) {
        const run = this.loadRun(runId);
        const response = (0, multi_agent_host_1.hostSelect)(run, options);
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return response;
    }
    evalSnapshot(runId, options = {}) {
        return (0, multi_agent_eval_1.createMultiAgentReplaySnapshot)(this.loadRun(runId), options);
    }
    evalReplay(target, options = {}) {
        return (0, multi_agent_eval_1.replayMultiAgentSnapshot)(target, options);
    }
    evalCompare(baseline, replay) {
        return (0, multi_agent_eval_1.compareMultiAgentReplay)(baseline, replay);
    }
    evalScore(target) {
        return (0, multi_agent_eval_1.scoreMultiAgentReplay)(target);
    }
    evalGate(target) {
        return (0, multi_agent_eval_1.gateMultiAgentEval)(target);
    }
    evalReport(target) {
        return (0, multi_agent_eval_1.reportMultiAgentEval)(target);
    }
    listTopologies() {
        return (0, topology_1.listTopologyDefinitions)();
    }
    showTopology(topologyId) {
        const definition = (0, topology_1.getTopologyDefinition)(topologyId);
        if (!definition)
            throw new Error(`Unknown topology id: ${topologyId}`);
        return definition;
    }
    validateTopology(topologyId) {
        return (0, topology_1.validateTopologyDefinition)(topologyId);
    }
    applyTopology(runId, topologyId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, topology_1.applyTopology)(run, topologyId, {
            id: (0, cli_options_1.stringOption)(options.id),
            title: (0, cli_options_1.stringOption)(options.title),
            multiAgentRunId: (0, cli_options_1.stringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
            taskIds: (0, cli_options_1.arrayOption)(options.task || options.taskId || options.tasks).map(String),
            mapperCount: (0, cli_options_1.numberOption)(options.mapperCount || options["mapper-count"] || options.mappers || options.mapper),
            judgeCount: (0, cli_options_1.numberOption)(options.judgeCount || options["judge-count"] || options.judges || options.judge),
            debateRounds: (0, cli_options_1.numberOption)(options.debateRounds || options["debate-rounds"] || options.rounds),
            collectInitialFanin: Boolean(options.collectInitialFanin || options["collect-initial-fanin"]),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    showTopologyRun(runId, topologyRunId) {
        return (0, topology_1.showTopologyRun)(this.loadRun(runId), topologyRunId);
    }
    topologySummary(runId) {
        return (0, topology_1.summarizeTopologies)(this.loadRun(runId));
    }
    topologyGraph(runId) {
        return (0, topology_1.buildTopologyGraph)(this.loadRun(runId));
    }
    createMultiAgentRun(runId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.createMultiAgentRun)(run, {
            id: (0, cli_options_1.stringOption)(options.id),
            title: (0, cli_options_1.stringOption)(options.title),
            objective: (0, cli_options_1.stringOption)(options.objective || options.reason),
            parentMultiAgentRunId: (0, cli_options_1.stringOption)(options.parent || options.parentMultiAgentRunId),
            phase: (0, cli_options_1.stringOption)(options.phase),
            phaseId: (0, cli_options_1.stringOption)(options.phaseId),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
            topicIds: (0, cli_options_1.arrayOption)(options.topic || options.topicId || options.topics).map(String),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    transitionMultiAgentRun(runId, multiAgentRunId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.transitionMultiAgentRun)(run, multiAgentRunId, String(options.status || "running"), {
            reason: (0, cli_options_1.stringOption)(options.reason),
            actor: (0, cli_options_1.stringOption)(options.actor),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    createAgentRole(runId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.createAgentRole)(run, {
            id: (0, cli_options_1.stringOption)(options.id),
            multiAgentRunId: (0, cli_options_1.requiredStringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"], "multi-agent run id"),
            title: (0, cli_options_1.stringOption)(options.title),
            responsibilities: (0, cli_options_1.arrayOption)(options.responsibility || options.responsibilities).map(String),
            requiredEvidence: (0, cli_options_1.arrayOption)(options.requiredEvidence || options["required-evidence"]).map(String),
            sandboxProfileHints: (0, cli_options_1.arrayOption)(options.sandbox || options.sandboxProfile || options.sandboxProfileHint || options["sandbox-profile"]).map(String),
            expectedArtifacts: (0, cli_options_1.arrayOption)(options.expectedArtifact || options.expectedArtifacts || options["expected-artifact"]).map(String),
            faninObligations: (0, cli_options_1.arrayOption)(options.faninObligation || options.faninObligations || options["fanin-obligation"]).map(String),
            parentRoleId: (0, cli_options_1.stringOption)(options.parent || options.parentRoleId),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
            topicIds: (0, cli_options_1.arrayOption)(options.topic || options.topicId || options.topics).map(String),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    createAgentGroup(runId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.createAgentGroup)(run, {
            id: (0, cli_options_1.stringOption)(options.id),
            multiAgentRunId: (0, cli_options_1.requiredStringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"], "multi-agent run id"),
            title: (0, cli_options_1.stringOption)(options.title),
            phase: (0, cli_options_1.stringOption)(options.phase),
            phaseId: (0, cli_options_1.stringOption)(options.phaseId),
            taskIds: (0, cli_options_1.arrayOption)(options.task || options.taskId || options.tasks).map(String),
            parentGroupId: (0, cli_options_1.stringOption)(options.parent || options.parentGroupId),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
            topicIds: (0, cli_options_1.arrayOption)(options.topic || options.topicId || options.topics).map(String),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    assignAgentMembership(runId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.assignAgentMembership)(run, {
            id: (0, cli_options_1.stringOption)(options.id),
            multiAgentRunId: (0, cli_options_1.stringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
            groupId: (0, cli_options_1.requiredStringOption)(options.group || options.groupId || options["multi-agent-group"], "group id"),
            roleId: (0, cli_options_1.requiredStringOption)(options.role || options.roleId || options["multi-agent-role"], "role id"),
            taskId: (0, cli_options_1.requiredStringOption)(options.task || options.taskId, "task id"),
            workerId: (0, cli_options_1.stringOption)(options.worker || options.workerId),
            dispatchId: (0, cli_options_1.stringOption)(options.dispatch || options.dispatchId),
            fanoutId: (0, cli_options_1.stringOption)(options.fanout || options.fanoutId || options["multi-agent-fanout"]),
            status: (0, cli_options_1.stringOption)(options.status),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
            topicIds: (0, cli_options_1.arrayOption)(options.topic || options.topicId || options.topics).map(String),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    createAgentFanout(runId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.createAgentFanout)(run, {
            id: (0, cli_options_1.stringOption)(options.id),
            multiAgentRunId: (0, cli_options_1.stringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
            groupId: (0, cli_options_1.requiredStringOption)(options.group || options.groupId || options["multi-agent-group"], "group id"),
            reason: (0, cli_options_1.stringOption)(options.reason) || "work split",
            roleIds: (0, cli_options_1.arrayOption)(options.role || options.roleId || options.roles).map(String),
            taskIds: (0, cli_options_1.arrayOption)(options.task || options.taskId || options.tasks).map(String),
            workerIds: (0, cli_options_1.arrayOption)(options.worker || options.workerId || options.workers).map(String),
            membershipIds: (0, cli_options_1.arrayOption)(options.membership || options.membershipId || options.memberships).map(String),
            dispatchIds: (0, cli_options_1.arrayOption)(options.dispatch || options.dispatchId || options.dispatches).map(String),
            concurrencyLimit: (0, cli_options_1.numberOption)(options.limit || options.concurrency || options.concurrencyLimit),
            sandboxProfileChoices: (0, cli_options_1.parseSandboxChoices)(options),
            expectedReturnShape: (0, cli_options_1.stringOption)(options.expectedReturnShape || options["expected-return-shape"]),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
            topicIds: (0, cli_options_1.arrayOption)(options.topic || options.topicId || options.topics).map(String),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    collectAgentFanin(runId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.collectAgentFanin)(run, {
            id: (0, cli_options_1.stringOption)(options.id),
            multiAgentRunId: (0, cli_options_1.stringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
            groupId: (0, cli_options_1.stringOption)(options.group || options.groupId || options["multi-agent-group"]),
            fanoutId: (0, cli_options_1.stringOption)(options.fanout || options.fanoutId || options["multi-agent-fanout"]),
            requiredRoleIds: (0, cli_options_1.arrayOption)(options.requiredRole || options.requiredRoleId || options["required-role"]).map(String),
            strategy: (0, cli_options_1.stringOption)(options.strategy),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
            topicIds: (0, cli_options_1.arrayOption)(options.topic || options.topicId || options.topics).map(String),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    showMultiAgentRun(runId, multiAgentRunId) {
        const record = (0, multi_agent_1.getMultiAgentRun)(this.loadRun(runId), multiAgentRunId);
        if (!record)
            throw new Error(`Unknown MultiAgentRun id for run ${runId}: ${multiAgentRunId}`);
        return record;
    }
    showAgentRole(runId, roleId) {
        const record = (0, multi_agent_1.getAgentRole)(this.loadRun(runId), roleId);
        if (!record)
            throw new Error(`Unknown AgentRole id for run ${runId}: ${roleId}`);
        return record;
    }
    showAgentGroup(runId, groupId) {
        const record = (0, multi_agent_1.getAgentGroup)(this.loadRun(runId), groupId);
        if (!record)
            throw new Error(`Unknown AgentGroup id for run ${runId}: ${groupId}`);
        return record;
    }
    showAgentMembership(runId, membershipId) {
        const record = (0, multi_agent_1.getAgentMembership)(this.loadRun(runId), membershipId);
        if (!record)
            throw new Error(`Unknown AgentMembership id for run ${runId}: ${membershipId}`);
        return record;
    }
    showAgentFanout(runId, fanoutId) {
        const record = (0, multi_agent_1.getAgentFanout)(this.loadRun(runId), fanoutId);
        if (!record)
            throw new Error(`Unknown AgentFanout id for run ${runId}: ${fanoutId}`);
        return record;
    }
    showAgentFanin(runId, faninId) {
        const record = (0, multi_agent_1.getAgentFanin)(this.loadRun(runId), faninId);
        if (!record)
            throw new Error(`Unknown AgentFanin id for run ${runId}: ${faninId}`);
        return record;
    }
    blackboardSummary(runId, options = {}) {
        return (0, coordinator_1.summarizeBlackboard)(this.loadRun(runId), (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId));
    }
    coordinatorSummary(runId, options = {}) {
        return (0, coordinator_1.summarizeBlackboard)(this.loadRun(runId), (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId));
    }
    blackboardGraph(runId) {
        return (0, coordinator_1.buildBlackboardGraph)(this.loadRun(runId));
    }
    resolveRunBlackboard(runId, options = {}) {
        const run = this.loadRun(runId);
        const board = (0, coordinator_1.resolveBlackboard)(run, {
            id: (0, cli_options_1.stringOption)(options.id || options.blackboard || options.blackboardId),
            title: (0, cli_options_1.stringOption)(options.title),
            multiAgentRunId: (0, cli_options_1.stringOption)(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
            groupId: (0, cli_options_1.stringOption)(options.group || options.groupId || options["multi-agent-group"]),
            roleId: (0, cli_options_1.stringOption)(options.role || options.roleId || options["multi-agent-role"]),
            membershipId: (0, cli_options_1.stringOption)(options.membership || options.membershipId || options["multi-agent-membership"]),
            author: (0, cli_options_1.parseBlackboardAuthor)(options),
            scope: (0, cli_options_1.parseBlackboardScope)(options),
            tags: (0, cli_options_1.arrayOption)(options.tag || options.tags).map(String),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return board;
    }
    createBlackboardTopic(runId, options = {}) {
        const run = this.loadRun(runId);
        const topic = (0, coordinator_1.createBlackboardTopic)(run, {
            id: (0, cli_options_1.stringOption)(options.id),
            title: (0, cli_options_1.requiredStringOption)(options.title, "topic title"),
            description: (0, cli_options_1.stringOption)(options.description),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
            author: (0, cli_options_1.parseBlackboardAuthor)(options),
            scope: (0, cli_options_1.parseBlackboardScope)(options),
            tags: (0, cli_options_1.arrayOption)(options.tag || options.tags).map(String),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return topic;
    }
    postBlackboardMessage(runId, options = {}) {
        const run = this.loadRun(runId);
        const message = (0, coordinator_1.postBlackboardMessage)(run, {
            id: (0, cli_options_1.stringOption)(options.id),
            topicId: (0, cli_options_1.requiredStringOption)(options.topic || options.topicId, "topic id"),
            body: (0, cli_options_1.requiredStringOption)(options.body || options.message, "message body"),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
            replyToId: (0, cli_options_1.stringOption)(options.replyTo || options.replyToId || options.parent),
            visibility: (0, cli_options_1.stringOption)(options.visibility),
            author: (0, cli_options_1.parseBlackboardAuthor)(options),
            scope: (0, cli_options_1.parseBlackboardScope)(options),
            evidenceRefs: (0, cli_options_1.arrayOption)(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
            artifactRefIds: (0, cli_options_1.arrayOption)(options.artifact || options.artifactRef || options.artifactRefId || options["artifact-ref"]).map(String),
            auditEventIds: (0, cli_options_1.arrayOption)(options.audit || options.auditEvent || options.auditEventId || options["audit-event"]).map(String),
            parentIds: (0, cli_options_1.arrayOption)(options.parentId || options.parentIds).map(String),
            tags: (0, cli_options_1.arrayOption)(options.tag || options.tags).map(String),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return message;
    }
    listBlackboardMessages(runId, options = {}) {
        return (0, coordinator_1.listBlackboardMessages)(this.loadRun(runId), {
            topicId: (0, cli_options_1.stringOption)(options.topic || options.topicId),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId)
        });
    }
    putBlackboardContext(runId, options = {}) {
        const run = this.loadRun(runId);
        const context = (0, coordinator_1.putBlackboardContext)(run, {
            id: (0, cli_options_1.stringOption)(options.id),
            topicId: (0, cli_options_1.requiredStringOption)(options.topic || options.topicId, "topic id"),
            kind: (0, cli_options_1.requiredStringOption)(options.kind, "context kind"),
            key: (0, cli_options_1.stringOption)(options.key),
            value: (0, cli_options_1.requiredStringOption)(options.value || options.body, "context value"),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
            supersedesContextIds: (0, cli_options_1.arrayOption)(options.supersedes || options.supersedesContext || options.supersedesContextId).map(String),
            author: (0, cli_options_1.parseBlackboardAuthor)(options),
            scope: (0, cli_options_1.parseBlackboardScope)(options),
            evidenceRefs: (0, cli_options_1.arrayOption)(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
            artifactRefIds: (0, cli_options_1.arrayOption)(options.artifact || options.artifactRef || options.artifactRefId || options["artifact-ref"]).map(String),
            parentIds: (0, cli_options_1.arrayOption)(options.parent || options.parentId || options.parentIds).map(String),
            tags: (0, cli_options_1.arrayOption)(options.tag || options.tags).map(String),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return context;
    }
    addBlackboardArtifact(runId, options = {}) {
        const run = this.loadRun(runId);
        const artifact = (0, coordinator_1.addBlackboardArtifact)(run, {
            id: (0, cli_options_1.stringOption)(options.id),
            topicId: (0, cli_options_1.stringOption)(options.topic || options.topicId),
            kind: (0, cli_options_1.requiredStringOption)(options.kind, "artifact kind"),
            path: (0, cli_options_1.stringOption)(options.path),
            locator: (0, cli_options_1.stringOption)(options.locator),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
            owner: (0, cli_options_1.parseBlackboardAuthor)({ ...options, authorKind: options.ownerKind || options.authorKind, authorId: options.owner || options.ownerId || options.authorId }),
            author: (0, cli_options_1.parseBlackboardAuthor)(options),
            scope: (0, cli_options_1.parseBlackboardScope)(options),
            source: (0, cli_options_1.stringOption)(options.source),
            provenance: (0, cli_options_1.parseBlackboardLinks)(run.id, options),
            evidenceRefs: (0, cli_options_1.arrayOption)(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
            auditEventIds: (0, cli_options_1.arrayOption)(options.audit || options.auditEvent || options.auditEventId || options["audit-event"]).map(String),
            parentIds: (0, cli_options_1.arrayOption)(options.parent || options.parentId || options.parentIds).map(String),
            tags: (0, cli_options_1.arrayOption)(options.tag || options.tags).map(String),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return artifact;
    }
    listBlackboardArtifacts(runId, options = {}) {
        return (0, coordinator_1.listBlackboardArtifacts)(this.loadRun(runId), {
            topicId: (0, cli_options_1.stringOption)(options.topic || options.topicId),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId)
        });
    }
    snapshotBlackboard(runId, options = {}) {
        const run = this.loadRun(runId);
        const snapshot = (0, coordinator_1.createBlackboardSnapshot)(run, (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId));
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return snapshot;
    }
    recordCoordinatorDecision(runId, options = {}) {
        const run = this.loadRun(runId);
        const decision = (0, coordinator_1.recordCoordinatorDecision)(run, {
            id: (0, cli_options_1.stringOption)(options.id),
            blackboardId: (0, cli_options_1.stringOption)(options.blackboard || options.blackboardId),
            kind: (0, cli_options_1.requiredStringOption)(options.kind, "decision kind"),
            outcome: (0, cli_options_1.requiredStringOption)(options.outcome, "decision outcome"),
            reason: (0, cli_options_1.requiredStringOption)(options.reason, "decision reason"),
            subjectIds: (0, cli_options_1.arrayOption)(options.subject || options.subjectId || options.subjectIds).map(String),
            topicId: (0, cli_options_1.stringOption)(options.topic || options.topicId),
            author: (0, cli_options_1.parseBlackboardAuthor)({ ...options, authorKind: options.authorKind || "coordinator", authorId: options.authorId || "cw" }),
            scope: (0, cli_options_1.parseBlackboardScope)(options),
            evidenceRefs: (0, cli_options_1.arrayOption)(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String),
            artifactRefIds: (0, cli_options_1.arrayOption)(options.artifact || options.artifactRef || options.artifactRefId || options["artifact-ref"]).map(String),
            messageIds: (0, cli_options_1.arrayOption)(options.message || options.messageId || options.messageIds).map(String),
            parentIds: (0, cli_options_1.arrayOption)(options.parent || options.parentId || options.parentIds).map(String),
            tags: (0, cli_options_1.arrayOption)(options.tag || options.tags).map(String),
            metadata: (0, cli_options_1.metadataOption)(options)
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return decision;
    }
    checkState(runId, options = {}) {
        const cwd = node_path_1.default.resolve(String(options.cwd || process.cwd()));
        const statePath = options.state
            ? node_path_1.default.resolve(String(options.state))
            : node_path_1.default.join(cwd, ".cw", "runs", runId, "state.json");
        const result = (0, state_1.migrateRunStateFile)(statePath, { write: Boolean(options.write) });
        return result.report;
    }
    commit(runId, input = {}) {
        const run = this.loadRun(runId);
        run.loopStage = "checkpoint";
        const options = typeof input === "string" ? { reason: input } : input;
        const allowCheckpoint = Boolean(options.allowUnverifiedCheckpoint || options["allow-unverified-checkpoint"]);
        const hasGateOption = Boolean(options.verifier || options.verifierNode || options["verifier-node"] || options.candidate || options.selection);
        try {
            const commit = (0, commit_1.commitState)(run, {
                reason: (0, cli_options_1.stringOption)(options.reason) || "manual",
                verifierNodeId: (0, cli_options_1.stringOption)(options.verifier) || (0, cli_options_1.stringOption)(options.verifierNode) || (0, cli_options_1.stringOption)(options["verifier-node"]),
                candidateId: (0, cli_options_1.stringOption)(options.candidate),
                selectionId: (0, cli_options_1.stringOption)(options.selection),
                verifierGated: hasGateOption || !allowCheckpoint,
                allowUnverifiedCheckpoint: allowCheckpoint,
                source: "cli"
            });
            (0, report_1.writeReport)(run);
            (0, state_1.saveCheckpoint)(run);
            return { runId, commit };
        }
        catch (error) {
            (0, report_1.writeReport)(run);
            (0, state_1.saveCheckpoint)(run);
            throw error;
        }
    }
    collectFeedback(runId) {
        const run = this.loadRun(runId);
        const collected = (0, error_feedback_1.collectRunErrors)(run);
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return collected;
    }
    listFeedback(runId, options = {}) {
        return (0, error_feedback_1.listFeedback)(this.loadRun(runId), {
            status: options.status ? String(options.status) : undefined,
            severity: options.severity ? String(options.severity) : undefined,
            classification: options.classification ? String(options.classification) : undefined
        });
    }
    showFeedback(runId, feedbackId) {
        const feedback = (0, error_feedback_1.getFeedback)(this.loadRun(runId), feedbackId);
        if (!feedback)
            throw new Error(`Unknown feedback id for run ${runId}: ${feedbackId}`);
        return feedback;
    }
    createFeedbackTask(runId, feedbackId, options = {}) {
        const run = this.loadRun(runId);
        const feedback = (0, error_feedback_1.createCorrectionTask)(run, feedbackId, {
            verifierCommand: options.verify ? String(options.verify) : undefined,
            guidance: options.guidance ? String(options.guidance) : undefined
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return feedback;
    }
    resolveFeedback(runId, feedbackId, options = {}) {
        const run = this.loadRun(runId);
        const feedback = (0, error_feedback_1.resolveFeedback)(run, feedbackId, {
            status: options.status === "rejected" ? "rejected" : "resolved",
            nodeId: options.node ? String(options.node) : undefined,
            message: options.message ? String(options.message) : undefined
        });
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        return feedback;
    }
    loadRun(runId) {
        return (0, state_1.loadRunFromCwd)(runId);
    }
    loadWorkflowById(workflowId) {
        return this.loadWorkflowAppById(workflowId).app.workflow;
    }
    loadWorkflowAppById(appId) {
        const record = this.loadWorkflowApps().find((candidate) => candidate.app.id === appId);
        if (!record)
            throw new Error(`Workflow app not found: ${appId}`);
        return record;
    }
    loadWorkflowAppTarget(target) {
        if (!target)
            throw new Error("Missing workflow app path or id");
        const resolved = node_path_1.default.resolve(target);
        if (node_fs_1.default.existsSync(resolved)) {
            const stat = node_fs_1.default.statSync(resolved);
            if (stat.isDirectory())
                return (0, workflow_app_sdk_1.loadWorkflowAppFromManifest)(node_path_1.default.join(resolved, "app.json"));
            if (node_path_1.default.basename(resolved) === "app.json" || resolved.endsWith(".json"))
                return (0, workflow_app_sdk_1.loadWorkflowAppFromManifest)(resolved);
            return (0, workflow_app_sdk_1.loadWorkflowAppFromEntrypoint)(resolved);
        }
        return this.loadWorkflowAppById(target);
    }
    loadWorkflowApps() {
        const records = [
            ...this.loadWorkflowFiles().map((file) => (0, workflow_app_sdk_1.loadWorkflowAppFromEntrypoint)(file)),
            ...this.loadAppManifestFiles().map((file) => (0, workflow_app_sdk_1.loadWorkflowAppFromManifest)(file))
        ].sort((left, right) => {
            const byId = left.app.id.localeCompare(right.app.id);
            if (byId)
                return byId;
            return (left.source.manifestPath || left.source.entrypointPath || left.source.path)
                .localeCompare(right.source.manifestPath || right.source.entrypointPath || right.source.path);
        });
        const seen = new Map();
        for (const record of records) {
            const previous = seen.get(record.app.id);
            if (previous) {
                throw new Error(`Duplicate workflow app id ${record.app.id}: ${previous.source.manifestPath || previous.source.entrypointPath || previous.source.path} and ${record.source.manifestPath || record.source.entrypointPath || record.source.path}`);
            }
            seen.set(record.app.id, record);
        }
        return records;
    }
    loadWorkflowFiles() {
        if (!node_fs_1.default.existsSync(this.workflowsDir))
            return [];
        return node_fs_1.default
            .readdirSync(this.workflowsDir)
            .filter((file) => file.endsWith(".workflow.js"))
            .sort()
            .map((file) => node_path_1.default.join(this.workflowsDir, file));
    }
    loadAppManifestFiles() {
        if (!node_fs_1.default.existsSync(this.appsDir))
            return [];
        return node_fs_1.default
            .readdirSync(this.appsDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => node_path_1.default.join(this.appsDir, entry.name, "app.json"))
            .filter((file) => node_fs_1.default.existsSync(file))
            .sort();
    }
}
exports.CoolWorkflowRunner = CoolWorkflowRunner;
function parseArgv(argv) {
    const [command, ...rest] = argv;
    const options = {};
    const positionals = [];
    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index];
        if (!token.startsWith("--")) {
            positionals.push(token);
            continue;
        }
        const withoutPrefix = token.slice(2);
        const equalsIndex = withoutPrefix.indexOf("=");
        let key;
        let value;
        if (equalsIndex >= 0) {
            key = withoutPrefix.slice(0, equalsIndex);
            value = withoutPrefix.slice(equalsIndex + 1);
        }
        else {
            key = withoutPrefix;
            value = rest[index + 1] && !rest[index + 1].startsWith("--") ? rest[++index] : true;
        }
        appendOption(options, key, value);
    }
    return { command, positionals, options };
}
function formatHelp() {
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
function appendOption(options, key, value) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
        const current = options[key];
        options[key] = Array.isArray(current) ? [...current, value] : [current, value];
        return;
    }
    options[key] = value;
}
function normalizeInputs(options) {
    const inputs = {};
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
    if (inputs.repo && !inputs.cwd)
        inputs.cwd = inputs.repo;
    return inputs;
}
function validateInputs(workflow, inputs) {
    for (const input of workflow.inputs || []) {
        if (input.required && (0, cli_options_1.isMissing)(inputs[input.name])) {
            throw new Error(`Missing required input --${input.name}`);
        }
    }
}
function flattenTasks(workflow, inputs) {
    const seen = new Set();
    const tasks = [];
    for (const phase of workflow.phases) {
        for (const task of phase.tasks) {
            if (seen.has(task.id))
                throw new Error(`Duplicate task id: ${task.id}`);
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
function renderPrompt(prompt, inputs) {
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
function createRunId(workflowId) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${workflowId}-${stamp}-${suffix}`;
}
function resolvePluginRoot(candidate) {
    let current = node_path_1.default.resolve(candidate);
    for (let depth = 0; depth < 5; depth += 1) {
        if (node_fs_1.default.existsSync(node_path_1.default.join(current, "workflows")) && node_fs_1.default.existsSync(node_path_1.default.join(current, "package.json"))) {
            return current;
        }
        current = node_path_1.default.dirname(current);
    }
    throw new Error("Run cw.js from the cool-workflow plugin directory");
}
function renderWorkflowTemplate(id, title) {
    return `module.exports = ({ workflow, phase, agent, artifact }) =>\n  workflow({\n    id: ${JSON.stringify(id)},\n    title: ${JSON.stringify(title)},\n    summary: "Describe what this workflow does.",\n    limits: {\n      maxAgents: 8,\n      maxConcurrentAgents: 4\n    },\n    inputs: [\n      { name: "question", required: true }\n    ],\n    phases: [\n      phase("Map", [\n        agent("map:context", "Map the task context, constraints, and evidence needed for {{question}}.")\n      ]),\n      phase("Assess", [\n        agent("assess:risks", "Assess risks, tradeoffs, and unknowns for {{question}}.")\n      ]),\n      phase("Synthesize", [\n        artifact("synthesis:report", "Synthesize the final answer for {{question}}.", { requiresEvidence: true })\n      ])\n    ]\n  });\n`;
}
function titleize(value) {
    return value
        .split("-")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
