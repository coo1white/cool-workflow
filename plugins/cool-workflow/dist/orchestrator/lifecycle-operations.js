"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.plan = plan;
exports.dispatch = dispatch;
exports.recordResult = recordResult;
exports.recordWorkerOutput = recordWorkerOutput;
exports.recordWorkerFailure = recordWorkerFailure;
exports.checkState = checkState;
exports.commit = commit;
// Core run-lifecycle operations (v0.1.40 self-audit P3 router pattern).
//
// The engine core — plan / dispatch / recordResult / worker-output / commit /
// checkState — carved out of CoolWorkflowRunner so the runner is a pure router.
// plan() receives an already-resolved workflow app record (the runner still owns
// app loading, which is instance-stateful). Behavior is identical to the inline
// implementations; only the location changed.
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("../state");
const report_1 = require("./report");
const cli_options_1 = require("./cli-options");
const harness_1 = require("../harness");
const workflow_app_framework_1 = require("../workflow-app-framework");
const workflow_api_1 = require("../workflow-api");
const observability_1 = require("../observability");
const dispatch_1 = require("../dispatch");
const verifier_1 = require("../verifier");
const trust_audit_1 = require("../trust-audit");
const multi_agent_1 = require("../multi-agent");
const topology_1 = require("../topology");
const state_node_1 = require("../state-node");
const pipeline_contract_1 = require("../pipeline-contract");
const pipeline_runner_1 = require("../pipeline-runner");
const commit_1 = require("../commit");
const error_feedback_1 = require("../error-feedback");
const trust_audit_2 = require("../trust-audit");
const result_normalize_1 = require("../result-normalize");
const state_explosion_1 = require("../state-explosion");
const worker_isolation_1 = require("../worker-isolation");
function plan(appRecord, options) {
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
            app: (0, workflow_app_framework_1.workflowAppRunMetadata)(appRecord)
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
    // Use app's custom pipeline if defined; fall back to default (v0.1.56).
    const defaultContract = (0, pipeline_contract_1.createDefaultPipelineContract)();
    const appPipeline = appRecord.app.pipeline;
    const contract = appPipeline
        ? (0, state_node_1.upsertRunContract)(run, { ...defaultContract, ...appPipeline, id: defaultContract.id })
        : (0, state_node_1.upsertRunContract)(run, defaultContract);
    const inputNode = (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:input`,
        kind: "input",
        status: "completed",
        loopStage: "interpret",
        outputs: run.inputs,
        artifacts: [{ id: "state", kind: "json", path: run.paths.state }],
        contractId: contract.id,
        metadata: { workflowId: workflow.id, app: (0, workflow_app_framework_1.workflowAppRunMetadata)(appRecord) }
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
function dispatch(run, options) {
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
function recordResult(run, taskId, resultPath, options = {}) {
    const task = run.tasks.find((candidate) => candidate.id === taskId);
    if (!task)
        throw new Error(`Unknown task id for run ${run.id}: ${taskId}`);
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
            metadata: {
                taskId: task.id,
                // Empty-capture warning (v0.1.42): surfaced, never silently passed.
                ...((0, result_normalize_1.isEmptyCapture)(parsedResult) ? { captureWarning: "no findings or evidence captured from result.md" } : {})
            }
        }));
        task.resultNodeId = resultNode.id;
        if ((0, result_normalize_1.isEmptyCapture)(parsedResult)) {
            (0, trust_audit_2.recordTrustAuditEvent)(run, {
                kind: "worker.capture-warning",
                decision: "recorded",
                source: "cw-validated",
                taskId: task.id,
                nodeId: resultNode.id,
                metadata: { reason: "no findings or evidence captured from result.md", resultPath: destination }
            });
        }
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
function recordWorkerOutput(run, workerId, resultPath, options = {}) {
    const usage = (0, observability_1.parseUsageFromArgs)(options, new Date().toISOString());
    // Agent Delegation Drive (v0.1.38): the drive loop passes the agent-hop
    // attestation through verbatim so recordWorkerOutput can fold the digests +
    // model into provenance/trust-audit. Absent for a hand-fulfilled worker.
    const agentDelegation = options.agentDelegation || undefined;
    // Track 1 fail-closed (opt-in): forward the policy so recordWorkerOutput can
    // park a hop whose telemetry isn't attested. Default (absent) ⇒ flag-and-surface.
    const requireAttestedTelemetry = options.requireAttestedTelemetry === true;
    try {
        (0, worker_isolation_1.recordWorkerOutput)(run, workerId, resultPath, { persist: false, agentDelegation, requireAttestedTelemetry });
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
function recordWorkerFailure(run, workerId, message, options = {}) {
    const failure = (0, worker_isolation_1.recordWorkerFailure)(run, workerId, {
        code: String(options.code || "worker-runtime-error"),
        message,
        at: new Date().toISOString(),
        path: options.path ? node_path_1.default.resolve(String(options.path)) : undefined,
        retryable: Boolean(options.retryable)
    }, { persist: false, retryCount: typeof options.retryCount === "number" ? Number(options.retryCount) : undefined });
    run.loopStage = "adjust";
    (0, dispatch_1.updatePhaseStatuses)(run);
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return failure;
}
function checkState(runId, options = {}) {
    const cwd = node_path_1.default.resolve(String(options.cwd || process.cwd()));
    const statePath = options.state
        ? node_path_1.default.resolve(String(options.state))
        : node_path_1.default.join(cwd, ".cw", "runs", runId, "state.json");
    const result = (0, state_1.migrateRunStateFile)(statePath, { write: Boolean(options.write) });
    return result.report;
}
function commit(run, input = {}) {
    run.loopStage = "checkpoint";
    const options = typeof input === "string" ? { reason: input } : input;
    const allowCheckpoint = Boolean(options.allowUnverifiedCheckpoint || options["allow-unverified-checkpoint"]);
    const hasGateOption = Boolean(options.verifier || options.verifierNode || options["verifier-node"] || options.candidate || options.selection);
    try {
        const commitRecord = (0, commit_1.commitState)(run, {
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
        (0, state_explosion_1.maybeCompactRun)(run);
        return { runId: run.id, commit: commitRecord };
    }
    catch (error) {
        (0, report_1.writeReport)(run);
        (0, state_1.saveCheckpoint)(run);
        throw error;
    }
}
// ---- plan() private helpers (moved verbatim from the runner) ----------------
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
                resultPath: "",
                // Track 3: carry the declared output schema onto the run task so
                // validateResultEnvelope can enforce it at intake. Absent ⇒ no schema check.
                ...(task.schema ? { schema: task.schema } : {})
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
