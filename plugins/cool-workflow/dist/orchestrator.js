"use strict";
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
const workflow_app_framework_1 = require("./workflow-app-framework");
const dispatch_1 = require("./dispatch");
const state_1 = require("./state");
const observability_1 = require("./observability");
const pipeline_runner_1 = require("./pipeline-runner");
const worker_isolation_1 = require("./worker-isolation");
const sandbox_profile_1 = require("./sandbox-profile");
const execution_backend_1 = require("./execution-backend");
const operator_ux_1 = require("./operator-ux");
const multi_agent_1 = require("./multi-agent");
const multi_agent_operator_ux_1 = require("./multi-agent-operator-ux");
const multi_agent_eval_1 = require("./multi-agent-eval");
const node_snapshot_1 = require("./node-snapshot");
const state_explosion_1 = require("./state-explosion");
const evidence_reasoning_1 = require("./evidence-reasoning");
const report_1 = require("./orchestrator/report");
const cli_options_1 = require("./orchestrator/cli-options");
const auditOps = __importStar(require("./orchestrator/audit-operations"));
const candidateOps = __importStar(require("./orchestrator/candidate-operations"));
const collaborationOps = __importStar(require("./orchestrator/collaboration-operations"));
const maOps = __importStar(require("./orchestrator/multi-agent-operations"));
const hostOps = __importStar(require("./orchestrator/host-operations"));
const feedbackOps = __importStar(require("./orchestrator/feedback-operations"));
const topologyOps = __importStar(require("./orchestrator/topology-operations"));
const lifecycleOps = __importStar(require("./orchestrator/lifecycle-operations"));
const migrationOps = __importStar(require("./orchestrator/migration-operations"));
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
class CoolWorkflowRunner {
    pluginRoot;
    workflowsDir;
    appsDir;
    // F7: the directory a run is resolved against (replaces the former process.chdir
    // bracket in capability-core). undefined => fall back to process.cwd(). The runner
    // reads runs from disk per call (no in-memory run state), so withBaseDir hands back
    // a cheap scoped clone instead of mutating the global process cwd.
    baseDir;
    constructor({ pluginRoot, baseDir }) {
        this.pluginRoot = resolvePluginRoot(pluginRoot);
        this.workflowsDir = node_path_1.default.join(this.pluginRoot, "workflows");
        this.appsDir = node_path_1.default.join(this.pluginRoot, "apps");
        this.baseDir = baseDir ? node_path_1.default.resolve(baseDir) : undefined;
    }
    /** Return a runner that resolves runs against `dir` instead of process.cwd(),
     *  WITHOUT chdir-ing the process (F7). Same instance when the dir is unchanged. */
    withBaseDir(dir) {
        const resolved = dir ? node_path_1.default.resolve(dir) : undefined;
        if (resolved === this.baseDir)
            return this;
        return new CoolWorkflowRunner({ pluginRoot: this.pluginRoot, baseDir: resolved });
    }
    listWorkflows() {
        return this.loadWorkflowApps().map((record) => {
            const summary = (0, workflow_app_framework_1.summarizeWorkflowApp)(record);
            return {
                id: summary.id,
                title: summary.title,
                summary: summary.summary,
                file: summary.file
            };
        });
    }
    listApps() {
        return this.loadWorkflowApps().map((record) => (0, workflow_app_framework_1.summarizeWorkflowApp)(record));
    }
    showApp(appId) {
        const record = this.loadWorkflowAppById(appId);
        const summary = (0, workflow_app_framework_1.summarizeWorkflowApp)(record);
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
            const result = (0, workflow_app_framework_1.validateWorkflowApp)(record.app, {
                appPath: record.source.manifestPath || record.source.entrypointPath || record.source.path
            });
            return {
                ...result,
                summary: (0, workflow_app_framework_1.summarizeWorkflowApp)(record)
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
        node_fs_1.default.writeFileSync(manifestPath, (0, workflow_app_framework_1.renderWorkflowAppManifestTemplate)(id, title), "utf8");
        node_fs_1.default.writeFileSync(entrypointPath, (0, workflow_app_framework_1.renderWorkflowAppEntrypointTemplate)(id, title), "utf8");
        const validation = this.validateApp(manifestPath);
        if (!validation.valid) {
            throw new workflow_app_framework_1.WorkflowAppValidationError("Generated workflow app is invalid", validation.issues);
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
            app: (0, workflow_app_framework_1.workflowAppRunMetadata)(record),
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
        node_fs_1.default.writeFileSync(destination, (0, workflow_app_framework_1.renderWorkflowAppTemplate)(id, title), "utf8");
        return { id, path: destination };
    }
    // Core run lifecycle — delegated to ./orchestrator/lifecycle-operations. The
    // runner resolves the workflow app record (instance-stateful) then hands the
    // engine work to the module; the runner is now a pure router.
    plan(workflowId, options) {
        return lifecycleOps.plan(this.loadWorkflowAppById(workflowId), options);
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
        return lifecycleOps.dispatch(this.loadRun(runId), options);
    }
    recordResult(runId, taskId, resultPath, options = {}) {
        return lifecycleOps.recordResult(this.loadRun(runId), taskId, resultPath, options);
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
    reclaimOrphans(runId, now) {
        return (0, worker_isolation_1.reclaimOrphans)(this.loadRun(runId), now);
    }
    showWorkerManifest(runId, workerId) {
        const run = this.loadRun(runId);
        const worker = (0, worker_isolation_1.getWorkerScope)(run, workerId);
        if (!worker)
            throw new Error(`Unknown worker id for run ${runId}: ${workerId}`);
        return (0, worker_isolation_1.writeWorkerManifest)(run, worker);
    }
    recordWorkerOutput(runId, workerId, resultPath, options = {}) {
        return lifecycleOps.recordWorkerOutput(this.loadRun(runId), workerId, resultPath, options);
    }
    recordWorkerFailure(runId, workerId, message, options = {}) {
        return lifecycleOps.recordWorkerFailure(this.loadRun(runId), workerId, message, options);
    }
    validateWorker(runId, workerId, targetPath) {
        return (0, worker_isolation_1.validateWorkerBoundary)(this.loadRun(runId), workerId, targetPath ? { path: targetPath } : {});
    }
    // Audit domain — delegated to ./orchestrator/audit-operations (v0.1.40 P3
    // router pattern). The runner stays the routing surface; the logic lives in the
    // domain module. Public signatures are unchanged.
    auditSummary(runId) {
        return auditOps.auditSummary(this.loadRun(runId));
    }
    auditMultiAgent(runId) {
        return auditOps.auditMultiAgent(this.loadRun(runId));
    }
    auditPolicy(runId) {
        return auditOps.auditPolicy(this.loadRun(runId));
    }
    auditRole(runId, roleId) {
        return auditOps.auditRole(this.loadRun(runId), roleId);
    }
    auditBlackboard(runId) {
        return auditOps.auditBlackboard(this.loadRun(runId));
    }
    auditJudge(runId) {
        return auditOps.auditJudge(this.loadRun(runId));
    }
    workerAudit(runId, workerId) {
        return auditOps.workerAudit(this.loadRun(runId), workerId);
    }
    evidenceProvenance(runId, options = {}) {
        return auditOps.auditEvidenceProvenance(this.loadRun(runId), options);
    }
    recordAuditAttestation(runId, options = {}) {
        return auditOps.recordAuditAttestation(this.loadRun(runId), options);
    }
    recordAuditDecision(runId, workerId, options = {}) {
        return auditOps.recordAuditDecision(this.loadRun(runId), workerId, options);
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
    // Candidate domain — delegated to ./orchestrator/candidate-operations.
    listCandidates(runId, options = {}) {
        return candidateOps.listCandidates(this.loadRun(runId), options);
    }
    showCandidate(runId, candidateId) {
        return candidateOps.showCandidate(this.loadRun(runId), candidateId);
    }
    registerCandidate(runId, options = {}) {
        return candidateOps.registerCandidate(this.loadRun(runId), options);
    }
    scoreCandidate(runId, candidateId, options = {}) {
        return candidateOps.scoreCandidate(this.loadRun(runId), candidateId, options);
    }
    rankCandidates(runId, options = {}) {
        return candidateOps.rankCandidates(this.loadRun(runId), options);
    }
    selectCandidate(runId, candidateId, options = {}) {
        return candidateOps.selectCandidate(this.loadRun(runId), candidateId, options);
    }
    rejectCandidate(runId, candidateId, reason) {
        return candidateOps.rejectCandidate(this.loadRun(runId), candidateId, reason);
    }
    // ---- Team Collaboration (v0.1.32) — delegated to ./orchestrator/collaboration-operations.
    // Append-only, host-attested (never authenticated) approvals/comments/handoffs
    // + a derived review state. Both CLI and MCP route through these methods, so
    // `cw <cmd> --json` is identical to `cw_<tool>` (the parity gate).
    collaborationApprove(runId, targetKind, targetId, options = {}, decision = "approve") {
        return collaborationOps.collaborationApprove(this.loadRun(runId), targetKind, targetId, options, decision);
    }
    collaborationReject(runId, targetKind, targetId, options = {}) {
        return this.collaborationApprove(runId, targetKind, targetId, options, "reject");
    }
    collaborationComment(runId, targetKind, targetId, options = {}) {
        return collaborationOps.collaborationComment(this.loadRun(runId), targetKind, targetId, options);
    }
    collaborationCommentList(runId, options = {}) {
        return collaborationOps.collaborationCommentList(this.loadRun(runId), options);
    }
    collaborationHandoff(runId, targetKind, targetId, options = {}) {
        return collaborationOps.collaborationHandoff(this.loadRun(runId), targetKind, targetId, options);
    }
    reviewStatus(runId, options = {}) {
        return collaborationOps.reviewStatus(this.loadRun(runId), options);
    }
    reviewPolicy(runId, options = {}) {
        return collaborationOps.reviewPolicy(this.loadRun(runId), options);
    }
    formatReviewStatus(report) {
        return collaborationOps.formatReviewStatus(report);
    }
    formatCommentList(comments) {
        return collaborationOps.formatCommentList(comments);
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
    // Host multi-agent — delegated to ./orchestrator/host-operations. The runner
    // keeps the load-or-plan policy here because it owns plan().
    hostMultiAgentRun(runId, options = {}) {
        const workflowId = (0, cli_options_1.stringOption)(options.app || options.appId || options.workflow || options.workflowId);
        const run = runId
            ? this.loadRun(runId)
            : workflowId
                ? this.plan(workflowId, (0, cli_options_1.withoutHostRunKeys)(options))
                : undefined;
        if (!run)
            throw new Error("multi-agent run requires <run-id> or --app <app-id>");
        return hostOps.hostMultiAgentRun(run, options);
    }
    hostMultiAgentStatus(runId) {
        return hostOps.hostMultiAgentStatus(this.loadRun(runId));
    }
    hostMultiAgentStep(runId, options = {}) {
        return hostOps.hostMultiAgentStep(this.loadRun(runId), options);
    }
    hostMultiAgentBlackboard(runId, action, options = {}) {
        return hostOps.hostMultiAgentBlackboard(this.loadRun(runId), action, options);
    }
    hostMultiAgentScore(runId, options = {}) {
        return hostOps.hostMultiAgentScore(this.loadRun(runId), options);
    }
    hostMultiAgentSelect(runId, options = {}) {
        return hostOps.hostMultiAgentSelect(this.loadRun(runId), options);
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
    // ---- node snapshot / diff / replay (v0.1.35) ----------------------------
    nodeSnapshot(runId, nodeId, options = {}) {
        return (0, node_snapshot_1.snapshotNode)(this.loadRun(runId), nodeId, options);
    }
    nodeDiff(runId, baselineSnapshotId, candidateSnapshotId) {
        const run = this.loadRun(runId);
        return (0, node_snapshot_1.diffNodeSnapshots)((0, node_snapshot_1.readNodeSnapshot)(run, baselineSnapshotId), (0, node_snapshot_1.readNodeSnapshot)(run, candidateSnapshotId));
    }
    nodeReplay(runId, snapshotId, options = {}) {
        const run = this.loadRun(runId);
        return (0, node_snapshot_1.replayNodeSnapshot)(run, (0, node_snapshot_1.readNodeSnapshot)(run, snapshotId), options);
    }
    nodeReplayVerify(runId, replayId, options = {}) {
        const run = this.loadRun(runId);
        return (0, node_snapshot_1.verifyNodeReplay)(run, (0, node_snapshot_1.readNodeReplay)(run, replayId), options);
    }
    // ---- contract migration (v0.1.36) ---------------------------------------
    // Contract migration — delegated to ./orchestrator/migration-operations.
    migrationList() {
        return migrationOps.migrationList();
    }
    migrationCheck(target, options = {}) {
        return migrationOps.migrationCheck(target, options);
    }
    migrationProve(target, options = {}) {
        return migrationOps.migrationProve(target, options);
    }
    loadMigrationSnapshot(target, options) {
        return migrationOps.loadMigrationSnapshot(target, options);
    }
    // Topology — delegated to ./orchestrator/topology-operations.
    listTopologies() {
        return topologyOps.listTopologies();
    }
    showTopology(topologyId) {
        return topologyOps.showTopology(topologyId);
    }
    validateTopology(topologyId) {
        return topologyOps.validateTopology(topologyId);
    }
    applyTopology(runId, topologyId, options = {}) {
        return topologyOps.applyTopology(this.loadRun(runId), topologyId, options);
    }
    showTopologyRun(runId, topologyRunId) {
        return topologyOps.showTopologyRun(this.loadRun(runId), topologyRunId);
    }
    topologySummary(runId) {
        return topologyOps.topologySummary(this.loadRun(runId));
    }
    topologyGraph(runId) {
        return topologyOps.topologyGraph(this.loadRun(runId));
    }
    // Multi-agent lifecycle + blackboard — delegated to ./orchestrator/multi-agent-operations.
    createMultiAgentRun(runId, options = {}) {
        return maOps.createMultiAgentRun(this.loadRun(runId), options);
    }
    transitionMultiAgentRun(runId, multiAgentRunId, options = {}) {
        return maOps.transitionMultiAgentRun(this.loadRun(runId), multiAgentRunId, options);
    }
    createAgentRole(runId, options = {}) {
        return maOps.createAgentRole(this.loadRun(runId), options);
    }
    createAgentGroup(runId, options = {}) {
        return maOps.createAgentGroup(this.loadRun(runId), options);
    }
    assignAgentMembership(runId, options = {}) {
        return maOps.assignAgentMembership(this.loadRun(runId), options);
    }
    createAgentFanout(runId, options = {}) {
        return maOps.createAgentFanout(this.loadRun(runId), options);
    }
    collectAgentFanin(runId, options = {}) {
        return maOps.collectAgentFanin(this.loadRun(runId), options);
    }
    showMultiAgentRun(runId, multiAgentRunId) {
        return maOps.showMultiAgentRun(this.loadRun(runId), multiAgentRunId);
    }
    showAgentRole(runId, roleId) {
        return maOps.showAgentRole(this.loadRun(runId), roleId);
    }
    showAgentGroup(runId, groupId) {
        return maOps.showAgentGroup(this.loadRun(runId), groupId);
    }
    showAgentMembership(runId, membershipId) {
        return maOps.showAgentMembership(this.loadRun(runId), membershipId);
    }
    showAgentFanout(runId, fanoutId) {
        return maOps.showAgentFanout(this.loadRun(runId), fanoutId);
    }
    showAgentFanin(runId, faninId) {
        return maOps.showAgentFanin(this.loadRun(runId), faninId);
    }
    blackboardSummary(runId, options = {}) {
        return maOps.blackboardSummary(this.loadRun(runId), options);
    }
    coordinatorSummary(runId, options = {}) {
        return maOps.blackboardSummary(this.loadRun(runId), options);
    }
    blackboardGraph(runId) {
        return maOps.blackboardGraph(this.loadRun(runId));
    }
    resolveRunBlackboard(runId, options = {}) {
        return maOps.resolveRunBlackboard(this.loadRun(runId), options);
    }
    createBlackboardTopic(runId, options = {}) {
        return maOps.createBlackboardTopic(this.loadRun(runId), options);
    }
    postBlackboardMessage(runId, options = {}) {
        return maOps.postBlackboardMessage(this.loadRun(runId), options);
    }
    listBlackboardMessages(runId, options = {}) {
        return maOps.listBlackboardMessages(this.loadRun(runId), options);
    }
    putBlackboardContext(runId, options = {}) {
        return maOps.putBlackboardContext(this.loadRun(runId), options);
    }
    addBlackboardArtifact(runId, options = {}) {
        return maOps.addBlackboardArtifact(this.loadRun(runId), options);
    }
    listBlackboardArtifacts(runId, options = {}) {
        return maOps.listBlackboardArtifacts(this.loadRun(runId), options);
    }
    snapshotBlackboard(runId, options = {}) {
        return maOps.snapshotBlackboard(this.loadRun(runId), options);
    }
    recordCoordinatorDecision(runId, options = {}) {
        return maOps.recordCoordinatorDecision(this.loadRun(runId), options);
    }
    checkState(runId, options = {}) {
        return lifecycleOps.checkState(runId, options);
    }
    commit(runId, input = {}) {
        return lifecycleOps.commit(this.loadRun(runId), input);
    }
    // Feedback — delegated to ./orchestrator/feedback-operations.
    collectFeedback(runId) {
        return feedbackOps.collectFeedback(this.loadRun(runId));
    }
    listFeedback(runId, options = {}) {
        return feedbackOps.listFeedback(this.loadRun(runId), options);
    }
    showFeedback(runId, feedbackId) {
        return feedbackOps.showFeedback(this.loadRun(runId), feedbackId);
    }
    createFeedbackTask(runId, feedbackId, options = {}) {
        return feedbackOps.createFeedbackTask(this.loadRun(runId), feedbackId, options);
    }
    resolveFeedback(runId, feedbackId, options = {}) {
        return feedbackOps.resolveFeedback(this.loadRun(runId), feedbackId, options);
    }
    loadRun(runId) {
        return (0, state_1.loadRunFromCwd)(runId, this.baseDir);
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
                return (0, workflow_app_framework_1.loadWorkflowAppFromManifest)(node_path_1.default.join(resolved, "app.json"));
            if (node_path_1.default.basename(resolved) === "app.json" || resolved.endsWith(".json"))
                return (0, workflow_app_framework_1.loadWorkflowAppFromManifest)(resolved);
            return (0, workflow_app_framework_1.loadWorkflowAppFromEntrypoint)(resolved);
        }
        return this.loadWorkflowAppById(target);
    }
    loadWorkflowApps() {
        const records = [
            ...this.loadWorkflowFiles().map((file) => (0, workflow_app_framework_1.loadWorkflowAppFromEntrypoint)(file)),
            ...this.loadAppManifestFiles().map((file) => (0, workflow_app_framework_1.loadWorkflowAppFromManifest)(file))
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
        if (token === "--") {
            // POSIX end-of-options: everything after `--` is a positional, even if it
            // begins with `--`. Lets a legitimate value that starts with `--` through.
            for (let restIndex = index + 1; restIndex < rest.length; restIndex += 1)
                positionals.push(rest[restIndex]);
            break;
        }
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
        "  run search|list|show|resume|archive|rerun|export|import|verify-import [run-id|archive] [--scope repo|home] [--json]",
        "  queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]",
        "  history [--scope repo|home] [--app ID] [--status STATE] [--json]",
        "  audit-run <app-id> [--repo PATH] [--question TEXT] [--agent-command CMD]",
        "  metrics show|summary <run-id> [--scope repo|home] [--json]",
        "  telemetry verify <run-id> [--pubkey PEM|PATH] [--json]",
        "  gc plan|run|verify [run-id] [--json]",
        "  sched plan|lease|release|complete|reclaim|reset|policy [--json]",
        "  migration list|check|prove [target] [--json]",
        "  operator status|report <run-id> [--json]",
        "  review status|policy <run-id> [--json]",
        "  approve|reject|comment <kind> <run-id> <target-id> [--reason TEXT]",
        "  handoff <kind> <run-id> <target-id> [--to ROLE]",
        "  loop --prompt TEXT [--interval-minutes N]",
        "  demo tamper",
        "  workbench view <run-id> [--json]",
        "  workbench serve [--port N] [--scope repo|home] [--once|--json]",
        ""
    ].join("\n");
}
function appendOption(options, key, value) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
        const current = options[key];
        options[key] = Array.isArray(current) ? [...current, value] : [current, value];
        return;
    }
    options[key] = value;
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
function titleize(value) {
    return value
        .split("-")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
