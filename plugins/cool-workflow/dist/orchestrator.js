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
const error_feedback_1 = require("./error-feedback");
const state_node_1 = require("./state-node");
const pipeline_runner_1 = require("./pipeline-runner");
const worker_isolation_1 = require("./worker-isolation");
const candidate_scoring_1 = require("./candidate-scoring");
const sandbox_profile_1 = require("./sandbox-profile");
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
            const issues = validationIssuesFromError(error);
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
        writeReport(run);
        (0, commit_1.commitState)(run, "initial-plan");
        (0, state_1.saveCheckpoint)(run);
        return run;
    }
    status(runId) {
        return summarizeRun(this.loadRun(runId));
    }
    operatorStatus(runId) {
        return (0, operator_ux_1.summarizeOperatorRun)(this.loadRun(runId));
    }
    next(runId, options) {
        return (0, dispatch_1.nextDispatchTasks)(this.loadRun(runId), numberOption(options.limit));
    }
    dispatch(runId, options) {
        const run = this.loadRun(runId);
        try {
            const manifest = (0, dispatch_1.createDispatchManifest)(run, numberOption(options.limit), {
                sandboxProfileId: stringOption(options.sandbox) || stringOption(options.sandboxProfile) || stringOption(options.sandboxProfileId),
                multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
                multiAgentGroupId: stringOption(options.multiAgentGroup || options.multiAgentGroupId || options.group || options["multi-agent-group"]),
                multiAgentRoleId: stringOption(options.multiAgentRole || options.multiAgentRoleId || options.role || options["multi-agent-role"]),
                multiAgentFanoutId: stringOption(options.multiAgentFanout || options.multiAgentFanoutId || options.fanout || options["multi-agent-fanout"])
            });
            run.loopStage = "act";
            if (manifest.dispatchId)
                (0, commit_1.commitState)(run, `dispatch:${manifest.dispatchId}`);
            (0, state_1.saveCheckpoint)(run);
            writeReport(run);
            return manifest;
        }
        catch (error) {
            if (isSandboxProfileError(error)) {
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
                    metadata: { sandboxProfileId: stringOption(options.sandbox) || stringOption(options.sandboxProfile) || stringOption(options.sandboxProfileId) }
                }, { persist: false });
                writeReport(run);
                (0, state_1.saveCheckpoint)(run);
            }
            throw error;
        }
    }
    recordResult(runId, taskId, resultPath) {
        const run = this.loadRun(runId);
        const task = run.tasks.find((candidate) => candidate.id === taskId);
        if (!task)
            throw new Error(`Unknown task id for run ${runId}: ${taskId}`);
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
            writeReport(run);
            (0, state_1.saveCheckpoint)(run);
            return summarizeRun(run);
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
            writeReport(run);
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
    recordWorkerOutput(runId, workerId, resultPath) {
        const run = this.loadRun(runId);
        try {
            (0, worker_isolation_1.recordWorkerOutput)(run, workerId, resultPath, { persist: false });
            run.loopStage = "observe";
            (0, dispatch_1.updatePhaseStatuses)(run);
            (0, verifier_1.validateRunGates)(run);
            (0, commit_1.commitState)(run, `worker:${workerId}:result`);
            writeReport(run);
            (0, state_1.saveCheckpoint)(run);
            return summarizeRun(run);
        }
        catch (error) {
            run.loopStage = "adjust";
            (0, dispatch_1.updatePhaseStatuses)(run);
            writeReport(run);
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
        writeReport(run);
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
            workerId: stringOption(options.worker || options.workerId),
            candidateId: stringOption(options.candidate || options.candidateId),
            commitId: stringOption(options.commit || options.commitId)
        });
    }
    recordAuditAttestation(runId, options = {}) {
        const run = this.loadRun(runId);
        const workerId = stringOption(options.worker || options.workerId);
        const worker = workerId ? (0, worker_isolation_1.getWorkerScope)(run, workerId) : undefined;
        const event = (0, trust_audit_1.recordHostAttestation)(run, {
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
        (0, state_1.saveCheckpoint)(run);
        return event;
    }
    recordAuditDecision(runId, workerId, options = {}) {
        const run = this.loadRun(runId);
        const worker = (0, worker_isolation_1.getWorkerScope)(run, workerId);
        if (!worker)
            throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
        const kind = stringOption(options.kind) || inferAuditDecisionKind(options);
        const target = stringOption(options.path || options.command || options.network || options.networkTarget || options.env || options.envVar);
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
        writeReport(run);
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
        const resultNodeId = stringOption(options.resultNode) || worker?.resultNodeId || task?.resultNodeId;
        const verifierNodeId = stringOption(options.verifierNode) || worker?.output?.verifierNodeId || task?.verifierNodeId;
        const resultPath = stringOption(options.resultPath) || worker?.output?.resultPath || task?.resultPath;
        const resultNode = resultNodeId ? run.nodes?.find((node) => node.id === resultNodeId) : undefined;
        const verifierNode = verifierNodeId ? run.nodes?.find((node) => node.id === verifierNodeId) : undefined;
        const candidate = (0, candidate_scoring_1.registerCandidate)(run, {
            id: stringOption(options.id),
            kind: stringOption(options.kind),
            workerId,
            taskId: stringOption(options.task) || worker?.taskId,
            resultNodeId,
            verifierNodeId,
            resultPath,
            artifacts: [
                ...(resultPath ? [{ id: "result", kind: "markdown", path: node_path_1.default.resolve(resultPath) }] : []),
                ...(worker ? [{ id: "worker", kind: "json", path: node_path_1.default.join(worker.workerDir, "worker.json") }] : [])
            ],
            evidence: mergeEvidence(resultNode?.evidence || [], verifierNode?.evidence || []),
            metadata: {
                source: worker ? "worker" : "manual",
                workerDir: worker?.workerDir
            }
        }, { persist: false });
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return candidate;
    }
    scoreCandidate(runId, candidateId, options = {}) {
        const run = this.loadRun(runId);
        const score = (0, candidate_scoring_1.scoreCandidate)(run, candidateId, {
            id: stringOption(options.id),
            scorer: stringOption(options.scorer),
            criteria: parseCriteria(options),
            maxTotal: numberOption(options.maxTotal || options.max),
            verdict: stringOption(options.verdict),
            evidence: parseEvidence(options.evidence),
            notes: stringOption(options.notes)
        }, { persist: false });
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return score;
    }
    rankCandidates(runId, options = {}) {
        const run = this.loadRun(runId);
        const ranking = (0, candidate_scoring_1.rankCandidates)(run, {
            includeRejected: Boolean(options.includeRejected),
            policy: {
                minNormalized: numberOption(options.minNormalized),
                requireEvidence: options.requireEvidence === undefined ? undefined : Boolean(options.requireEvidence),
                requireVerifierGate: options.requireVerifierGate === undefined ? undefined : Boolean(options.requireVerifierGate),
                tieBreaker: stringOption(options.tieBreaker)
            }
        });
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return ranking;
    }
    selectCandidate(runId, candidateId, options = {}) {
        const run = this.loadRun(runId);
        const selection = (0, candidate_scoring_1.selectCandidate)(run, candidateId, {
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
        (0, state_1.saveCheckpoint)(run);
        return selection;
    }
    rejectCandidate(runId, candidateId, reason) {
        const run = this.loadRun(runId);
        const candidate = (0, candidate_scoring_1.rejectCandidate)(run, candidateId, reason, { persist: false });
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return candidate;
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
        return { path: writeReport(run) };
    }
    operatorReport(runId) {
        const run = this.loadRun(runId);
        writeReport(run);
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
        return (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(this.loadRun(runId)).evidence;
    }
    summaryRefresh(runId, options = {}) {
        const run = this.loadRun(runId);
        const index = (0, state_explosion_1.refreshStateExplosionSummaries)(run, { views: graphViewsOption(options) });
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return index;
    }
    summaryShow(runId) {
        const run = this.loadRun(runId);
        const report = (0, state_explosion_1.showStateExplosionSummary)(run);
        (0, state_1.saveCheckpoint)(run);
        return report;
    }
    blackboardSummarize(runId, options = {}) {
        return (0, state_explosion_1.summarizeBlackboardDigest)(this.loadRun(runId), stringOption(options.blackboard || options.blackboardId));
    }
    multiAgentSummarize(runId) {
        const run = this.loadRun(runId);
        const index = (0, state_explosion_1.loadStateExplosionSummaryIndex)(run);
        return (0, state_explosion_1.buildStateExplosionReport)(run, { index });
    }
    multiAgentGraphView(runId, options = {}) {
        const view = graphViewOption(options.view);
        return (0, state_explosion_1.buildCompactGraph)(this.loadRun(runId), view, {
            focus: stringOption(options.focus),
            depth: numberOption(options.depth)
        });
    }
    stateExplosionReport(runId) {
        const run = this.loadRun(runId);
        const index = (0, state_explosion_1.loadStateExplosionSummaryIndex)(run);
        return (0, state_explosion_1.buildStateExplosionReport)(run, { index });
    }
    hostMultiAgentRun(runId, options = {}) {
        const workflowId = stringOption(options.app || options.appId || options.workflow || options.workflowId);
        const run = runId
            ? this.loadRun(runId)
            : workflowId
                ? this.plan(workflowId, withoutHostRunKeys(options))
                : undefined;
        if (!run)
            throw new Error("multi-agent run requires <run-id> or --app <app-id>");
        const response = (0, multi_agent_host_1.hostRun)(run, options);
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return response;
    }
    hostMultiAgentStatus(runId) {
        const run = this.loadRun(runId);
        writeReport(run);
        return (0, multi_agent_host_1.hostStatus)(run);
    }
    hostMultiAgentStep(runId, options = {}) {
        const run = this.loadRun(runId);
        const response = (0, multi_agent_host_1.hostStep)(run, options);
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return response;
    }
    hostMultiAgentBlackboard(runId, action, options = {}) {
        const run = this.loadRun(runId);
        const response = (0, multi_agent_host_1.hostBlackboard)(run, action, options);
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return response;
    }
    hostMultiAgentScore(runId, options = {}) {
        const run = this.loadRun(runId);
        const response = (0, multi_agent_host_1.hostScore)(run, options);
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return response;
    }
    hostMultiAgentSelect(runId, options = {}) {
        const run = this.loadRun(runId);
        const response = (0, multi_agent_host_1.hostSelect)(run, options);
        writeReport(run);
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
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    transitionMultiAgentRun(runId, multiAgentRunId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.transitionMultiAgentRun)(run, multiAgentRunId, String(options.status || "running"), {
            reason: stringOption(options.reason),
            actor: stringOption(options.actor),
            metadata: metadataOption(options)
        });
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    createAgentRole(runId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.createAgentRole)(run, {
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
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    createAgentGroup(runId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.createAgentGroup)(run, {
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
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    assignAgentMembership(runId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.assignAgentMembership)(run, {
            id: stringOption(options.id),
            multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
            groupId: requiredStringOption(options.group || options.groupId || options["multi-agent-group"], "group id"),
            roleId: requiredStringOption(options.role || options.roleId || options["multi-agent-role"], "role id"),
            taskId: requiredStringOption(options.task || options.taskId, "task id"),
            workerId: stringOption(options.worker || options.workerId),
            dispatchId: stringOption(options.dispatch || options.dispatchId),
            fanoutId: stringOption(options.fanout || options.fanoutId || options["multi-agent-fanout"]),
            status: stringOption(options.status),
            blackboardId: stringOption(options.blackboard || options.blackboardId),
            topicIds: arrayOption(options.topic || options.topicId || options.topics).map(String),
            metadata: metadataOption(options)
        });
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    createAgentFanout(runId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.createAgentFanout)(run, {
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
        (0, state_1.saveCheckpoint)(run);
        return record;
    }
    collectAgentFanin(runId, options = {}) {
        const run = this.loadRun(runId);
        const record = (0, multi_agent_1.collectAgentFanin)(run, {
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
        return (0, coordinator_1.summarizeBlackboard)(this.loadRun(runId), stringOption(options.blackboard || options.blackboardId));
    }
    coordinatorSummary(runId, options = {}) {
        return (0, coordinator_1.summarizeBlackboard)(this.loadRun(runId), stringOption(options.blackboard || options.blackboardId));
    }
    blackboardGraph(runId) {
        return (0, coordinator_1.buildBlackboardGraph)(this.loadRun(runId));
    }
    resolveRunBlackboard(runId, options = {}) {
        const run = this.loadRun(runId);
        const board = (0, coordinator_1.resolveBlackboard)(run, {
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
        (0, state_1.saveCheckpoint)(run);
        return board;
    }
    createBlackboardTopic(runId, options = {}) {
        const run = this.loadRun(runId);
        const topic = (0, coordinator_1.createBlackboardTopic)(run, {
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
        (0, state_1.saveCheckpoint)(run);
        return topic;
    }
    postBlackboardMessage(runId, options = {}) {
        const run = this.loadRun(runId);
        const message = (0, coordinator_1.postBlackboardMessage)(run, {
            id: stringOption(options.id),
            topicId: requiredStringOption(options.topic || options.topicId, "topic id"),
            body: requiredStringOption(options.body || options.message, "message body"),
            blackboardId: stringOption(options.blackboard || options.blackboardId),
            replyToId: stringOption(options.replyTo || options.replyToId || options.parent),
            visibility: stringOption(options.visibility),
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
        (0, state_1.saveCheckpoint)(run);
        return message;
    }
    listBlackboardMessages(runId, options = {}) {
        return (0, coordinator_1.listBlackboardMessages)(this.loadRun(runId), {
            topicId: stringOption(options.topic || options.topicId),
            blackboardId: stringOption(options.blackboard || options.blackboardId)
        });
    }
    putBlackboardContext(runId, options = {}) {
        const run = this.loadRun(runId);
        const context = (0, coordinator_1.putBlackboardContext)(run, {
            id: stringOption(options.id),
            topicId: requiredStringOption(options.topic || options.topicId, "topic id"),
            kind: requiredStringOption(options.kind, "context kind"),
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
        (0, state_1.saveCheckpoint)(run);
        return context;
    }
    addBlackboardArtifact(runId, options = {}) {
        const run = this.loadRun(runId);
        const artifact = (0, coordinator_1.addBlackboardArtifact)(run, {
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
        (0, state_1.saveCheckpoint)(run);
        return artifact;
    }
    listBlackboardArtifacts(runId, options = {}) {
        return (0, coordinator_1.listBlackboardArtifacts)(this.loadRun(runId), {
            topicId: stringOption(options.topic || options.topicId),
            blackboardId: stringOption(options.blackboard || options.blackboardId)
        });
    }
    snapshotBlackboard(runId, options = {}) {
        const run = this.loadRun(runId);
        const snapshot = (0, coordinator_1.createBlackboardSnapshot)(run, stringOption(options.blackboard || options.blackboardId));
        writeReport(run);
        (0, state_1.saveCheckpoint)(run);
        return snapshot;
    }
    recordCoordinatorDecision(runId, options = {}) {
        const run = this.loadRun(runId);
        const decision = (0, coordinator_1.recordCoordinatorDecision)(run, {
            id: stringOption(options.id),
            blackboardId: stringOption(options.blackboard || options.blackboardId),
            kind: requiredStringOption(options.kind, "decision kind"),
            outcome: requiredStringOption(options.outcome, "decision outcome"),
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
                reason: stringOption(options.reason) || "manual",
                verifierNodeId: stringOption(options.verifier) || stringOption(options.verifierNode) || stringOption(options["verifier-node"]),
                candidateId: stringOption(options.candidate),
                selectionId: stringOption(options.selection),
                verifierGated: hasGateOption || !allowCheckpoint,
                allowUnverifiedCheckpoint: allowCheckpoint,
                source: "cli"
            });
            writeReport(run);
            (0, state_1.saveCheckpoint)(run);
            return { runId, commit };
        }
        catch (error) {
            writeReport(run);
            (0, state_1.saveCheckpoint)(run);
            throw error;
        }
    }
    collectFeedback(runId) {
        const run = this.loadRun(runId);
        const collected = (0, error_feedback_1.collectRunErrors)(run);
        writeReport(run);
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
        writeReport(run);
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
        writeReport(run);
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
        if (input.required && isMissing(inputs[input.name])) {
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
function writeReport(run) {
    (0, dispatch_1.updatePhaseStatuses)(run);
    const workerSummary = (0, worker_isolation_1.summarizeWorkers)(run);
    const candidateSummary = (0, candidate_scoring_1.summarizeCandidates)(run);
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
    node_fs_1.default.writeFileSync(run.paths.report, report, "utf8");
    return run.paths.report;
}
function summarizeRun(run) {
    (0, dispatch_1.updatePhaseStatuses)(run);
    const workerSummary = (0, worker_isolation_1.summarizeWorkers)(run);
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
        next: (0, dispatch_1.firstRunnablePhase)(run)?.name || null,
        reportPath: run.paths.report,
        commits: run.commits,
        workers: {
            total: workerSummary.total,
            byStatus: workerSummary.byStatus
        }
    };
}
function renderPendingTasks(run) {
    const pending = run.tasks.filter((task) => task.status === "pending" || task.status === "running");
    if (!pending.length)
        return ["No pending tasks."];
    return pending.map((task) => `- ${task.id} (${task.phase}, ${task.status}): ${task.taskPath}`);
}
function renderResults(run) {
    const completed = run.tasks.filter((task) => task.status === "completed");
    if (!completed.length)
        return ["No completed results yet."];
    const lines = [];
    for (const task of completed) {
        lines.push(`### ${task.id}`, "", `Result: ${task.resultPath}`, "");
        if (task.resultPath && node_fs_1.default.existsSync(task.resultPath)) {
            lines.push(node_fs_1.default.readFileSync(task.resultPath, "utf8").trim(), "");
        }
        else {
            lines.push("_Result file is not present on this host; state metadata remains inspectable._", "");
        }
    }
    return lines;
}
function renderCommits(run) {
    if (!run.commits.length)
        return ["No state commits yet."];
    return run.commits.map((commit) => {
        const kind = commit.verifierGated ? "verifier-gated commit" : "checkpoint";
        const gate = commit.verifierGated ? formatCommitGate(commit) : "verifierGated=false";
        return `- ${commit.id}: ${commit.reason} [${commit.loopStage}; ${kind}; ${gate}] (${commit.snapshotPath})`;
    });
}
function renderFeedback(run) {
    const summary = (0, error_feedback_1.summarizeFeedback)(run);
    if (!summary.total)
        return ["No feedback records."];
    return [
        `- Total: ${summary.total}`,
        `- By status: ${formatCounts(summary.byStatus)}`,
        `- By severity: ${formatCounts(summary.bySeverity)}`,
        `- By classification: ${formatCounts(summary.byClassification)}`,
        "",
        ...summary.artifacts.map((artifact) => `- ${artifact}`)
    ];
}
function renderWorkers(summary) {
    if (!summary.total)
        return ["No worker scopes yet."];
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
function renderStateSize(run) {
    const index = (0, state_explosion_1.loadStateExplosionSummaryIndex)(run);
    const report = (0, state_explosion_1.buildStateExplosionReport)(run, { index });
    return (0, state_explosion_1.stateExplosionReportLines)(report);
}
function renderMultiAgent(run) {
    const summary = (0, multi_agent_1.summarizeMultiAgent)(run);
    if (!summary.totalRuns)
        return ["No multi-agent runtime records yet."];
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
        for (const reason of summary.blockedReasons.slice(0, 8))
            lines.push(`- ${reason}`);
    }
    for (const group of summary.groupsDetail.slice(0, 8)) {
        lines.push("", `Group ${group.id}: status=${group.status}, phase=${group.phase || "none"}, run=${group.multiAgentRunId}`);
        for (const role of group.roles) {
            lines.push(`- role=${role.roleId}, memberships=${role.memberships}, reported=${role.reported}, missing=${role.missing}, requiredEvidence=${role.requiredEvidence}`);
        }
        lines.push(`- fanouts=${group.fanouts.join(", ") || "none"}`);
        lines.push(`- fanins=${group.fanins.join(", ") || "none"}`);
    }
    if (summary.nextAction)
        lines.push("", `Next multi-agent action: ${summary.nextAction}`);
    return lines;
}
function renderBlackboard(run) {
    const summary = (0, coordinator_1.summarizeBlackboard)(run);
    if (!summary.blackboardId)
        return ["No blackboard records yet."];
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
        for (const question of summary.openQuestions.slice(0, 8))
            lines.push(`- ${question.id}: ${question.key}=${question.value}`);
    }
    if (summary.conflicts.length) {
        lines.push("", "Conflicts:");
        for (const conflict of summary.conflicts.slice(0, 8)) {
            lines.push(`- ${conflict.id}: ${conflict.key} conflicts with ${conflict.conflictingContextIds.join(", ") || "unknown"}`);
        }
    }
    if (summary.missingEvidence.length) {
        lines.push("", "Missing evidence:");
        for (const item of summary.missingEvidence.slice(0, 8))
            lines.push(`- ${item}`);
    }
    if (summary.nextAction)
        lines.push("", `Next coordinator action: ${summary.nextAction}`);
    return lines;
}
function renderSandboxProfiles(run) {
    const profiles = run.sandboxProfiles || [];
    if (!profiles.length)
        return ["No sandbox profiles selected yet."];
    return profiles.map((profile) => [
        `- ${profile.id}: read=${profile.readPaths.length}, write=${profile.writePaths.length}, execute=${profile.execute.mode}, network=${profile.network.mode}`,
        `  enforcedByCW=${profile.enforcement.enforcedByCW.join("; ")}`,
        `  hostRequired=${profile.enforcement.hostRequired.join("; ")}`
    ].join("\n"));
}
function renderCandidates(summary) {
    if (!summary.total)
        return ["No candidates yet."];
    return [
        `- Total: ${summary.total}`,
        `- By status: ${formatCounts(summary.byStatus)}`,
        `- By kind: ${formatCounts(summary.byKind)}`,
        `- Selections: ${summary.selections}`,
        `- Index: ${summary.indexPath}`,
        `- Ranking: ${summary.rankingPath}`
    ];
}
function renderTrustAudit(run) {
    const summary = (0, trust_audit_1.summarizeTrustAudit)(run);
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
function renderAcceptanceRationale(run) {
    const lines = [];
    for (const selection of run.candidateSelections || []) {
        const rationale = selection.acceptanceRationale;
        if (!rationale)
            continue;
        lines.push(`- Selection ${selection.id}: candidate=${rationale.selectedCandidateId || selection.candidateId}, score=${rationale.scoreId || "none"}, verifier=${rationale.verifierNodeId || "none"}, evidence=${rationale.evidenceCount}, sandbox=${rationale.sandboxProfileId || "none"}, worker=${rationale.workerId || "none"}`);
    }
    for (const commit of run.commits || []) {
        if (!commit.acceptanceRationale)
            continue;
        const rationale = commit.acceptanceRationale;
        lines.push(`- Commit ${commit.id}: gate=${rationale.commitGateResult || "unknown"}, candidate=${rationale.selectedCandidateId || commit.candidateId || "none"}, score=${rationale.scoreId || "none"}, verifier=${rationale.verifierNodeId || commit.verifierNodeId || "none"}, evidence=${rationale.evidenceCount}, sandbox=${rationale.sandboxProfileId || "none"}, worker=${rationale.workerId || "none"}`);
    }
    return lines.length ? lines : ["No accepted candidate or verifier-gated commit rationale yet."];
}
function formatCommitGate(commit) {
    return [
        `verifier=${commit.verifierNodeId || "unknown"}`,
        commit.candidateId ? `candidate=${commit.candidateId}` : "",
        commit.selectionId ? `selection=${commit.selectionId}` : "",
        `evidence=${commit.evidence?.length || 0}`
    ]
        .filter(Boolean)
        .join(", ");
}
function formatCounts(counts) {
    const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
    if (!entries.length)
        return "none";
    return entries.map(([key, value]) => `${key}=${value}`).join(", ");
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
function formatInputList(value) {
    if (Array.isArray(value))
        return value.join("; ");
    return value ? String(value) : "";
}
function isMissing(value) {
    return value === undefined || value === null || value === "";
}
function numberOption(value) {
    if (value === undefined || value === null || value === true)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function stringOption(value) {
    if (value === undefined || value === null || value === true)
        return undefined;
    return String(value);
}
function requiredStringOption(value, label) {
    const parsed = stringOption(value);
    if (!parsed)
        throw new Error(`Missing ${label}`);
    return parsed;
}
function graphViewOption(value) {
    const parsed = stringOption(value);
    if (!parsed)
        return "compact";
    if (!state_explosion_1.GRAPH_VIEWS.includes(parsed)) {
        throw new Error(`Unknown graph view: ${parsed}. Valid views: ${state_explosion_1.GRAPH_VIEWS.join(", ")}`);
    }
    return parsed;
}
function graphViewsOption(options) {
    const raw = arrayOption(options.view || options.views).map(String);
    if (!raw.length)
        return undefined;
    for (const view of raw) {
        if (!state_explosion_1.GRAPH_VIEWS.includes(view)) {
            throw new Error(`Unknown graph view: ${view}. Valid views: ${state_explosion_1.GRAPH_VIEWS.join(", ")}`);
        }
    }
    return raw;
}
function metadataOption(options) {
    const raw = options.metadata;
    if (raw && typeof raw === "object" && !Array.isArray(raw))
        return raw;
    if (typeof raw === "string")
        return JSON.parse(raw);
    return undefined;
}
function withoutHostRunKeys(args) {
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
function optionsRecord(value) {
    if (value && typeof value === "object" && !Array.isArray(value))
        return value;
    return undefined;
}
function parseBlackboardAuthor(options) {
    const structured = options.author;
    if (structured && typeof structured === "object" && !Array.isArray(structured))
        return structured;
    const id = stringOption(options.authorId || options.author || options.worker || options.workerId || options.role || options.roleId || options.group || options.groupId);
    const kind = stringOption(options.authorKind || options.sourceKind || options.source);
    const displayName = stringOption(options.authorName || options.displayName);
    if (!id && !kind && !displayName)
        return undefined;
    return { kind: kind, id, displayName };
}
function parseBlackboardScope(options) {
    const structured = options.scope;
    if (structured && typeof structured === "object" && !Array.isArray(structured))
        return structured;
    const kind = stringOption(options.scopeKind);
    const id = stringOption(options.scopeId);
    if (!kind && !id)
        return undefined;
    return { kind: kind, id };
}
function parseBlackboardLinks(runId, options) {
    const structured = options.provenance || options.links;
    if (structured && typeof structured === "object" && !Array.isArray(structured))
        return structured;
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
function parseSandboxChoices(options) {
    const choices = {};
    const structured = options.sandboxChoices || options.sandboxProfileChoices;
    if (structured && typeof structured === "object" && !Array.isArray(structured)) {
        for (const [key, value] of Object.entries(structured))
            choices[key] = String(value);
    }
    for (const entry of arrayOption(options.sandboxChoice || options["sandbox-choice"])) {
        const [key, ...rest] = String(entry).split("=");
        if (key && rest.length)
            choices[key] = rest.join("=");
    }
    const sandbox = stringOption(options.sandbox || options.sandboxProfile || options.sandboxProfileId);
    if (sandbox && !Object.keys(choices).length)
        choices.default = sandbox;
    return Object.keys(choices).length ? choices : undefined;
}
function parseCriteria(options) {
    const criteria = {};
    const structured = options.criteria;
    if (structured && typeof structured === "object" && !Array.isArray(structured)) {
        for (const [key, value] of Object.entries(structured)) {
            const parsed = Number(value);
            if (key && Number.isFinite(parsed))
                criteria[key] = parsed;
        }
    }
    const rawCriteria = options.criterion || (typeof structured === "object" && !Array.isArray(structured) ? undefined : structured) || options.score;
    for (const entry of arrayOption(rawCriteria)) {
        const [key, value] = String(entry).split("=");
        if (!key || value === undefined)
            continue;
        criteria[key] = Number(value);
    }
    if (!Object.keys(criteria).length && options.total !== undefined) {
        criteria.total = Number(options.total);
    }
    if (!Object.keys(criteria).length)
        throw new Error("Missing score criteria. Use --criterion name=value");
    return criteria;
}
function parseEvidence(value) {
    return arrayOption(value).map((entry, index) => ({
        id: `score:${index + 1}`,
        source: "candidate-score",
        locator: String(entry),
        summary: String(entry)
    }));
}
function mergeEvidence(left, right) {
    const merged = [...left];
    for (const item of right) {
        const index = merged.findIndex((entry) => entry.id === item.id);
        if (index >= 0)
            merged[index] = item;
        else
            merged.push(item);
    }
    return merged;
}
function arrayOption(value) {
    if (value === undefined || value === null || value === true)
        return [];
    return Array.isArray(value) ? value : [value];
}
function valuesOption(value) {
    return arrayOption(value).map((entry) => String(entry).split("=")[0]).filter(Boolean);
}
function inferAuditDecisionKind(options) {
    if (options.command)
        return "sandbox.command";
    if (options.network || options.networkTarget)
        return "sandbox.network";
    if (options.env || options.envVar)
        return "sandbox.env";
    return "sandbox.path";
}
function isSandboxProfileError(error) {
    return error instanceof sandbox_profile_1.SandboxProfileError || Boolean(error && typeof error === "object" && "code" in error && String(error.code).startsWith("sandbox-"));
}
function validationIssuesFromError(error) {
    if (error instanceof workflow_app_sdk_1.WorkflowAppValidationError)
        return error.issues;
    return [
        {
            code: "workflow-app-invalid",
            message: error instanceof Error ? error.message : String(error)
        }
    ];
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
