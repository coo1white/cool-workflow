"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callTool = callTool;
exports.requiredToolArguments = requiredToolArguments;
exports.toolDefinitions = toolDefinitions;
const node_path_1 = __importDefault(require("node:path"));
const orchestrator_1 = require("./orchestrator");
const capability_registry_1 = require("./capability-registry");
const scheduler_1 = require("./scheduler");
const triggers_1 = require("./triggers");
const workbench_1 = require("./workbench");
const capability_core_1 = require("./capability-core");
const runner = new orchestrator_1.CoolWorkflowRunner({
    pluginRoot: node_path_1.default.resolve(__dirname, "..")
});
// This is an EXPLICIT switch by design, NOT a descriptor-driven generic dispatcher
// (FreeBSD-audit R1, assessed & closed as won't-do). A data-routing rewrite is
// ACTIVELY DANGEROUS here, not just risky: (1) `descriptor.entry` does NOT reliably
// name the function an arm calls (e.g. cw_app_run entry="validateApp" actually calls
// appRun; cw_commit entry="commit" calls commitEnvelope), so `runner[entry](args)`
// would silently call the WRONG method; (2) the parity gate is token-set-only +
// payload-probes ~30 read-only runId caps, so ~150 multi-positional/write arms are
// UNPROBED — a mis-marshalling generic dispatcher would pass BOTH gates green = the
// existential public false-green (a CW red line — see DIRECTION.md). The arms
// work and parity guards the surface; the real defect the audit flagged (a DEAD
// dispatcher) was already removed (#131). Cheap safe hardening, if ever wanted:
// broaden parity-check payload probes to cover multi-positional/write arms, and
// correct the wrong `entry` metadata — NOT a dispatch rewrite.
function callTool(name, args) {
    const previousCwd = process.cwd();
    if (args.cwd)
        process.chdir(String(args.cwd));
    const scheduler = new scheduler_1.Scheduler(process.cwd());
    const triggers = new triggers_1.RoutineTriggerBridge(process.cwd());
    try {
        switch (name) {
            case "cw_list":
                return runner.listWorkflows();
            case "cw_plan":
                return (0, capability_core_1.planSummary)(runner, String(args.workflowId || ""), args);
            case "cw_app_run":
                return (0, capability_core_1.appRun)(runner, args);
            case "cw_status":
                return runner.status(String(args.runId || ""));
            case "cw_init":
                return runner.init(String(args.workflowId || ""), args);
            case "cw_next":
                return runner.next(String(args.runId || ""), args);
            case "cw_state_check":
                return runner.checkState(String(args.runId || ""), args);
            case "cw_contract_show":
                return runner.showContract(String(args.runId || ""), (0, capability_core_1.optionalString)(args.contractId));
            case "cw_node_list":
                return runner.listNodes(String(args.runId || ""));
            case "cw_node_show":
                return runner.showNode(String(args.runId || ""), String(args.nodeId || ""));
            case "cw_node_graph":
                return runner.graphNodes(String(args.runId || ""));
            case "cw_node_snapshot":
                return runner.nodeSnapshot(String(args.runId || ""), String(args.nodeId || ""), args);
            case "cw_node_diff":
                return runner.nodeDiff(String(args.runId || ""), String(args.baselineSnapshotId || args.baseline || ""), String(args.candidateSnapshotId || args.candidate || ""));
            case "cw_node_replay":
                return runner.nodeReplay(String(args.runId || ""), String(args.snapshotId || ""), args);
            case "cw_node_replay_verify":
                return runner.nodeReplayVerify(String(args.runId || ""), String(args.replayId || ""), args);
            case "cw_migration_list":
                return runner.migrationList();
            case "cw_migration_check":
                return runner.migrationCheck(String(args.target || args.runId || ""), args);
            case "cw_migration_prove":
                return runner.migrationProve(String(args.target || args.runId || ""), args);
            case "cw_operator_status":
                return runner.operatorStatus(String(args.runId || ""));
            case "cw_operator_graph":
                return runner.operatorGraph(String(args.runId || ""));
            case "cw_operator_report":
                return runner.operatorReport(String(args.runId || ""));
            case "cw_worker_summary":
                return runner.summarizeWorkerRecords(String(args.runId || ""));
            case "cw_candidate_summary":
                return runner.summarizeCandidateOperatorRecords(String(args.runId || ""));
            case "cw_feedback_summary":
                return runner.summarizeFeedbackRecords(String(args.runId || ""));
            case "cw_commit_summary":
                return runner.summarizeCommitRecords(String(args.runId || ""));
            case "cw_multi_agent_summary":
                return runner.multiAgentSummary(String(args.runId || ""));
            case "cw_multi_agent_graph":
                return runner.multiAgentOperatorGraph(String(args.runId || ""));
            case "cw_multi_agent_dependencies":
                return runner.multiAgentDependencies(String(args.runId || ""));
            case "cw_multi_agent_failures":
                return runner.multiAgentFailures(String(args.runId || ""));
            case "cw_multi_agent_evidence":
                return runner.multiAgentEvidence(String(args.runId || ""));
            case "cw_evidence_reasoning":
                return runner.multiAgentReasoning(String(args.runId || ""), args);
            case "cw_evidence_reasoning_refresh":
                return runner.multiAgentReasoningRefresh(String(args.runId || ""));
            case "cw_multi_agent_run":
                return runner.hostMultiAgentRun((0, capability_core_1.optionalString)(args.runId), args);
            case "cw_multi_agent_status":
                return runner.hostMultiAgentStatus(String(args.runId || ""));
            case "cw_multi_agent_step":
                return runner.hostMultiAgentStep(String(args.runId || ""), args);
            case "cw_multi_agent_blackboard":
                return runner.hostMultiAgentBlackboard(String(args.runId || ""), (0, capability_core_1.optionalString)(args.action || args.operation), args);
            case "cw_multi_agent_score":
                return runner.hostMultiAgentScore(String(args.runId || ""), args);
            case "cw_multi_agent_select":
                return runner.hostMultiAgentSelect(String(args.runId || ""), args);
            case "cw_summary_refresh":
                return runner.summaryRefresh(String(args.runId || ""), args);
            case "cw_summary_show":
                return runner.summaryShow(String(args.runId || ""));
            case "cw_blackboard_summarize":
                return runner.blackboardSummarize(String(args.runId || ""), args);
            case "cw_multi_agent_summarize":
                return runner.multiAgentSummarize(String(args.runId || ""));
            case "cw_multi_agent_graph_compact":
                return runner.multiAgentGraphView(String(args.runId || ""), args);
            case "cw_eval_snapshot":
                return runner.evalSnapshot(String(args.runId || ""), args);
            case "cw_eval_replay":
                return runner.evalReplay(String(args.snapshot || args.snapshotId || args.path || ""), args);
            case "cw_eval_compare":
                return runner.evalCompare(String(args.baseline || args.baselinePath || ""), String(args.replay || args.replayPath || ""));
            case "cw_eval_score":
                return runner.evalScore(String(args.replay || args.replayPath || args.path || ""));
            case "cw_eval_gate":
                return runner.evalGate(String(args.suite || args.suiteId || args.path || ""));
            case "cw_eval_report":
                return runner.evalReport(String(args.replay || args.replayPath || args.path || ""));
            case "cw_multi_agent_run_create":
                return runner.createMultiAgentRun(String(args.runId || ""), args);
            case "cw_multi_agent_run_transition":
                return runner.transitionMultiAgentRun(String(args.runId || ""), String(args.multiAgentRunId || args.id || ""), args);
            case "cw_multi_agent_run_show":
                return runner.showMultiAgentRun(String(args.runId || ""), String(args.multiAgentRunId || args.id || ""));
            case "cw_multi_agent_role_create":
                return runner.createAgentRole(String(args.runId || ""), args);
            case "cw_multi_agent_role_show":
                return runner.showAgentRole(String(args.runId || ""), String(args.roleId || args.id || ""));
            case "cw_multi_agent_group_create":
                return runner.createAgentGroup(String(args.runId || ""), args);
            case "cw_multi_agent_group_show":
                return runner.showAgentGroup(String(args.runId || ""), String(args.groupId || args.id || ""));
            case "cw_multi_agent_membership_create":
                return runner.assignAgentMembership(String(args.runId || ""), args);
            case "cw_multi_agent_membership_show":
                return runner.showAgentMembership(String(args.runId || ""), String(args.membershipId || args.id || ""));
            case "cw_multi_agent_fanout_create":
                return runner.createAgentFanout(String(args.runId || ""), args);
            case "cw_multi_agent_fanout_show":
                return runner.showAgentFanout(String(args.runId || ""), String(args.fanoutId || args.id || ""));
            case "cw_multi_agent_fanin_collect":
                return runner.collectAgentFanin(String(args.runId || ""), args);
            case "cw_multi_agent_fanin_show":
                return runner.showAgentFanin(String(args.runId || ""), String(args.faninId || args.id || ""));
            case "cw_topology_list":
                return runner.listTopologies();
            case "cw_topology_show":
                if (args.runId && (args.topologyRunId || args.id))
                    return runner.showTopologyRun(String(args.runId || ""), String(args.topologyRunId || args.id || ""));
                return runner.showTopology(String(args.topologyId || args.id || ""));
            case "cw_topology_validate":
                return runner.validateTopology(String(args.topologyId || args.id || ""));
            case "cw_topology_apply":
                return runner.applyTopology(String(args.runId || ""), String(args.topologyId || args.id || ""), args);
            case "cw_topology_summary":
                return runner.topologySummary(String(args.runId || ""));
            case "cw_topology_graph":
                return runner.topologyGraph(String(args.runId || ""));
            case "cw_blackboard_summary":
                return runner.blackboardSummary(String(args.runId || ""), args);
            case "cw_blackboard_graph":
                return runner.blackboardGraph(String(args.runId || ""));
            case "cw_blackboard_resolve":
                return runner.resolveRunBlackboard(String(args.runId || ""), args);
            case "cw_blackboard_topic_create":
                return runner.createBlackboardTopic(String(args.runId || ""), args);
            case "cw_blackboard_message_post":
                return runner.postBlackboardMessage(String(args.runId || ""), args);
            case "cw_blackboard_message_list":
                return runner.listBlackboardMessages(String(args.runId || ""), args);
            case "cw_blackboard_context_put":
                return runner.putBlackboardContext(String(args.runId || ""), args);
            case "cw_blackboard_artifact_add":
                return runner.addBlackboardArtifact(String(args.runId || ""), args);
            case "cw_blackboard_artifact_list":
                return runner.listBlackboardArtifacts(String(args.runId || ""), args);
            case "cw_blackboard_snapshot":
                return runner.snapshotBlackboard(String(args.runId || ""), args);
            case "cw_coordinator_summary":
                return runner.coordinatorSummary(String(args.runId || ""), args);
            case "cw_coordinator_decision":
                return runner.recordCoordinatorDecision(String(args.runId || ""), args);
            case "cw_audit_summary":
                return runner.auditSummary(String(args.runId || ""));
            case "cw_audit_verify":
                return (0, capability_core_1.auditVerify)(runner, args);
            case "cw_audit_worker":
                return runner.workerAudit(String(args.runId || ""), String(args.workerId || ""));
            case "cw_audit_provenance":
                return runner.evidenceProvenance(String(args.runId || ""), args);
            case "cw_audit_multi_agent":
                return runner.auditMultiAgent(String(args.runId || ""));
            case "cw_audit_policy":
                return runner.auditPolicy(String(args.runId || ""));
            case "cw_audit_role":
                return runner.auditRole(String(args.runId || ""), String(args.roleId || args.id || ""));
            case "cw_audit_blackboard":
                return runner.auditBlackboard(String(args.runId || ""));
            case "cw_audit_judge":
                return runner.auditJudge(String(args.runId || ""));
            case "cw_audit_attest":
                return runner.recordAuditAttestation(String(args.runId || ""), args);
            case "cw_audit_decision":
                return runner.recordAuditDecision(String(args.runId || ""), String(args.workerId || ""), args);
            case "cw_dispatch":
                return runner.dispatch(String(args.runId || ""), args);
            case "cw_sandbox_list":
                return runner.listSandboxProfiles(args);
            case "cw_sandbox_show":
                return runner.showSandboxProfile(String(args.profileId || ""), args);
            case "cw_sandbox_validate":
                return runner.validateSandboxProfile(String(args.profileFile || ""), args);
            case "cw_sandbox_choose":
            case "cw_sandbox_resolve":
                return (0, capability_core_1.sandboxChoose)(runner, args);
            case "cw_backend_list":
                return runner.listBackends(args);
            case "cw_backend_show":
                return runner.showBackend(String(args.backendId || args.backend || ""), args);
            case "cw_backend_probe":
                return runner.probeBackend((0, capability_core_1.optionalString)(args.backendId || args.backend), args);
            case "cw_backend_agent_config_show":
                return (0, capability_core_1.backendAgentConfigShow)(args);
            case "cw_backend_agent_config_set":
                return (0, capability_core_1.backendAgentConfigSet)(args);
            case "cw_result":
                return runner.recordResult(String(args.runId || ""), String(args.taskId || ""), String(args.resultPath || ""), args);
            case "cw_commit":
                return (0, capability_core_1.commitEnvelope)(runner, String(args.runId || ""), args);
            case "cw_report":
                return runner.report(String(args.runId || ""));
            case "cw_app_list":
                return runner.listApps();
            case "cw_app_show":
                return runner.showApp(String(args.appId || ""));
            case "cw_app_validate":
                return runner.validateApp(String(args.target || args.appId || args.path || ""));
            case "cw_app_init":
                return runner.initApp(String(args.appId || ""), args);
            case "cw_app_package":
                return runner.packageApp(String(args.appId || ""), args);
            case "cw_worker_list":
                return runner.listWorkers(String(args.runId || ""), args);
            case "cw_worker_show":
                return runner.showWorker(String(args.runId || ""), String(args.workerId || ""));
            case "cw_worker_manifest":
                return runner.showWorkerManifest(String(args.runId || ""), String(args.workerId || ""));
            case "cw_worker_output":
                return runner.recordWorkerOutput(String(args.runId || ""), String(args.workerId || ""), String(args.resultPath || ""), args);
            case "cw_worker_fail":
                return runner.recordWorkerFailure(String(args.runId || ""), String(args.workerId || ""), String(args.message || ""), args);
            case "cw_worker_validate":
                return runner.validateWorker(String(args.runId || ""), String(args.workerId || ""), (0, capability_core_1.optionalString)(args.path || args.resultPath));
            case "cw_candidate_list":
                return runner.listCandidates(String(args.runId || ""), args);
            case "cw_candidate_show":
                return runner.showCandidate(String(args.runId || ""), String(args.candidateId || ""));
            case "cw_candidate_register":
                return runner.registerCandidate(String(args.runId || ""), args);
            case "cw_candidate_score":
                return runner.scoreCandidate(String(args.runId || ""), String(args.candidateId || ""), args);
            case "cw_candidate_rank":
                return runner.rankCandidates(String(args.runId || ""), args);
            case "cw_candidate_select":
                return runner.selectCandidate(String(args.runId || ""), String(args.candidateId || ""), args);
            case "cw_candidate_reject":
                return runner.rejectCandidate(String(args.runId || ""), String(args.candidateId || ""), String(args.reason || "rejected"));
            // ---- Team Collaboration (v0.1.32) ----
            case "cw_approve":
                return runner.collaborationApprove(String(args.runId || ""), String(args.targetKind || args.kind || ""), String(args.targetId || args.target || ""), args);
            case "cw_reject":
                return runner.collaborationReject(String(args.runId || ""), String(args.targetKind || args.kind || ""), String(args.targetId || args.target || ""), args);
            case "cw_comment_add":
                return runner.collaborationComment(String(args.runId || ""), String(args.targetKind || args.kind || ""), String(args.targetId || args.target || ""), args);
            case "cw_comment_list":
                return runner.collaborationCommentList(String(args.runId || ""), args);
            case "cw_handoff":
                return runner.collaborationHandoff(String(args.runId || ""), String(args.targetKind || args.kind || ""), String(args.targetId || args.target || ""), args);
            case "cw_review_status":
                return runner.reviewStatus(String(args.runId || ""), args);
            case "cw_review_policy":
                return runner.reviewPolicy(String(args.runId || ""), args);
            case "cw_feedback_list":
                return runner.listFeedback(String(args.runId || ""), args);
            case "cw_feedback_show":
                return runner.showFeedback(String(args.runId || ""), String(args.feedbackId || ""));
            case "cw_feedback_collect":
                return runner.collectFeedback(String(args.runId || ""));
            case "cw_feedback_task":
                return runner.createFeedbackTask(String(args.runId || ""), String(args.feedbackId || ""), args);
            case "cw_feedback_resolve":
                return runner.resolveFeedback(String(args.runId || ""), String(args.feedbackId || ""), args);
            case "cw_schedule_create":
                return scheduler.create(args);
            case "cw_schedule_list":
                return scheduler.list(args.status ? String(args.status) : undefined);
            case "cw_schedule_delete":
                return scheduler.delete(String(args.id || ""));
            case "cw_schedule_due":
                return scheduler.due();
            case "cw_schedule_complete":
                return scheduler.complete(String(args.id || ""), args);
            case "cw_schedule_pause":
                return scheduler.pause(String(args.id || ""));
            case "cw_schedule_resume":
                return scheduler.resume(String(args.id || ""));
            case "cw_schedule_run_now":
                return scheduler.runNow(String(args.id || ""));
            case "cw_schedule_history":
                return scheduler.history(args.id ? String(args.id) : undefined);
            case "cw_routine_create":
                return triggers.create(args);
            case "cw_routine_list":
                return triggers.list(args.kind ? String(args.kind) : undefined);
            case "cw_routine_delete":
                return triggers.delete(String(args.id || ""));
            case "cw_routine_fire":
                return triggers.fire(String(args.kind || "api"), args.payload || args);
            case "cw_routine_events":
                return triggers.events(args.id ? String(args.id) : undefined);
            case "cw_registry_refresh":
                return (0, capability_core_1.runRegistryRefresh)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_registry_show":
                return (0, capability_core_1.runRegistryShow)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_metrics_show":
                return runner.metricsShow(String(args.runId || ""), args);
            case "cw_metrics_summary":
                return (0, capability_core_1.metricsSummary)((0, capability_core_1.runRegistryFor)(args, runner), runner, args);
            case "cw_run_search":
                return (0, capability_core_1.runSearch)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_run_list":
                return (0, capability_core_1.runList)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_run_show":
                return (0, capability_core_1.runShow)((0, capability_core_1.runRegistryFor)(args, runner), String(args.runId || ""), args);
            case "cw_run_resume":
                return (0, capability_core_1.runResume)((0, capability_core_1.runRegistryFor)(args, runner), runner, String(args.runId || ""), args);
            case "cw_run_archive":
                return (0, capability_core_1.runArchive)((0, capability_core_1.runRegistryFor)(args, runner), (0, capability_core_1.optionalString)(args.runId), args);
            case "cw_run_rerun":
                return (0, capability_core_1.runRerun)((0, capability_core_1.runRegistryFor)(args, runner), String(args.runId || ""), args);
            case "cw_run_export":
                return (0, capability_core_1.runExportArchive)(runner, String(args.runId || ""), args);
            case "cw_run_import":
                return (0, capability_core_1.runImportArchive)(runner, args);
            case "cw_run_verify_import":
                return (0, capability_core_1.runVerifyImport)(runner, String(args.runId || ""), args);
            case "cw_run_inspect_archive":
                return (0, capability_core_1.runInspectArchive)(runner, args);
            case "cw_report_verify_bundle":
                return (0, capability_core_1.runVerifyReportBundle)(runner, args);
            case "cw_report_bundle":
                return (0, capability_core_1.reportBundle)(runner, String(args.runId || ""), args);
            case "cw_run_drive":
                return (0, capability_core_1.runDrivePreview)(runner, args);
            case "cw_run_drive_step":
                return (0, capability_core_1.runDrive)(runner, args);
            case "cw_queue_add":
                return (0, capability_core_1.queueAdd)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_queue_list":
                return (0, capability_core_1.queueList)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_queue_drain":
                return (0, capability_core_1.queueDrain)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_queue_show":
                return (0, capability_core_1.queueShow)((0, capability_core_1.runRegistryFor)(args, runner), String(args.id || ""));
            case "cw_sched_plan":
                return (0, capability_core_1.schedPlan)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_sched_lease":
                return (0, capability_core_1.schedLease)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_sched_release":
                return (0, capability_core_1.schedRelease)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_sched_complete":
                return (0, capability_core_1.schedComplete)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_sched_reclaim":
                return (0, capability_core_1.schedReclaim)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_sched_reset":
                return (0, capability_core_1.schedReset)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_sched_policy_show":
                return (0, capability_core_1.schedPolicyShow)((0, capability_core_1.runRegistryFor)(args, runner));
            case "cw_sched_policy_set":
                return (0, capability_core_1.schedPolicySet)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_gc_plan":
                return (0, capability_core_1.gcPlan)((0, capability_core_1.runRegistryFor)(args, runner), (0, capability_core_1.optionalString)(args.runId), args);
            case "cw_gc_run":
                return (0, capability_core_1.gcRun)((0, capability_core_1.runRegistryFor)(args, runner), (0, capability_core_1.optionalString)(args.runId), args);
            case "cw_gc_verify":
                return (0, capability_core_1.gcVerify)((0, capability_core_1.runRegistryFor)(args, runner), String(args.runId || ""), args);
            case "cw_telemetry_verify":
                return (0, capability_core_1.telemetryVerify)(runner, args);
            case "cw_history":
                return (0, capability_core_1.runHistory)((0, capability_core_1.runRegistryFor)(args, runner), args);
            case "cw_workbench_view":
                return (0, workbench_1.buildWorkbenchRunView)(runner, String(args.runId || ""));
            case "cw_workbench_serve":
                // MCP cannot start a blocking server; it returns the descriptor only
                // (identical to `cw workbench serve --json`). The CLI default additionally
                // starts the localhost host — declared divergence (see capability-registry).
                return (0, workbench_1.buildWorkbenchServeDescriptor)(runner, { ...args, once: true });
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    finally {
        process.chdir(previousCwd);
    }
}
function requiredToolArguments(name, value) {
    if (value === undefined || value === null)
        value = {};
    if (!(0, capability_core_1.isRecord)(value))
        throw new Error(`MCP tool ${name} arguments must be an object.`);
    const args = value;
    for (const group of requiredArgsForTool(name)) {
        const keys = group.split("|");
        if (!keys.some((key) => args[key] !== undefined && args[key] !== null && args[key] !== "")) {
            throw new Error(`MCP tool ${name} missing required argument: ${keys.join(" or ")}`);
        }
    }
    return args;
}
function requiredArgsForTool(name) {
    // Required args are declared once per capability as data on the mcp binding
    // (McpBinding.requiredArgs). This is a pure data read of the parity-gated
    // registry — no string-pattern ladder.
    return (0, capability_registry_1.mcpRequiredArgsForTool)(name);
}
function toolDefinitions() {
    return [
        capabilityTool("list", "List bundled CW workflows.", {}),
        capabilityTool("plan", "Create a CW run.", {
            workflowId: stringSchema("Workflow id"),
            repo: stringSchema("Repository path"),
            question: stringSchema("User question")
        }),
        capabilityTool("app.run", "Create a CW run from a Workflow App framework app id and structured inputs.", {
            cwd: stringSchema("Workspace"),
            appId: stringSchema("Workflow app id"),
            inputs: objectSchema("Workflow app inputs such as repo, question, version, source, or dryRun"),
            sandbox: stringSchema("Optional sandbox profile id to validate for this run"),
            sandboxProfile: stringSchema("Optional sandbox profile id to validate for this run"),
            sandboxProfileId: stringSchema("Optional sandbox profile id to validate for this run")
        }),
        capabilityTool("status", "Read run checkpoint status.", {
            runId: stringSchema("Run id"),
            cwd: stringSchema("Run workspace")
        }),
        capabilityTool("init", "Scaffold a new workflow definition. Peer of `cw init`.", {
            workflowId: stringSchema("Workflow id"),
            title: stringSchema("Workflow title"),
            output: stringSchema("Output directory")
        }),
        capabilityTool("next", "Read the next recommended tasks for a run. Peer of `cw next`.", {
            ...runIdSchema(),
            limit: numberSchema("Maximum tasks to return")
        }),
        capabilityTool("state.check", "Check run-state schema compatibility. Peer of `cw state check`.", {
            ...runIdSchema(),
            state: stringSchema("Explicit state file path"),
            write: booleanSchema("Persist a migrated copy when supported")
        }),
        capabilityTool("contract.show", "Show a run's pipeline contract. Peer of `cw contract show`.", {
            ...runIdSchema(),
            contractId: stringSchema("Optional contract id")
        }),
        capabilityTool("node.list", "List state nodes for a run. Peer of `cw node list`.", runIdSchema()),
        capabilityTool("node.show", "Show one state node for a run. Peer of `cw node show`.", {
            ...runIdSchema(),
            nodeId: stringSchema("Node id")
        }),
        capabilityTool("node.graph", "Read the state-node graph for a run. Peer of `cw node graph`.", runIdSchema()),
        capabilityTool("node.snapshot", "Snapshot one state node into a derived, sha256-fingerprinted projection. Peer of `cw node snapshot`.", {
            ...runIdSchema(),
            nodeId: stringSchema("Node id")
        }),
        capabilityTool("node.diff", "Structurally diff two node snapshots (stable, sorted). Peer of `cw node diff`.", {
            ...runIdSchema(),
            baselineSnapshotId: stringSchema("Baseline snapshot id"),
            candidateSnapshotId: stringSchema("Candidate snapshot id")
        }),
        capabilityTool("node.replay", "Deterministically replay one node from a snapshot; fail-closed on source drift. Peer of `cw node replay`.", {
            ...runIdSchema(),
            snapshotId: stringSchema("Snapshot id")
        }),
        capabilityTool("node.replay.verify", "Verify a node replay against a fresh snapshot of its source. Peer of `cw node verify`.", {
            ...runIdSchema(),
            replayId: stringSchema("Replay id")
        }),
        capabilityTool("migration.list", "List the declared migration registry (contracts + edges + compatibility proofs). Peer of `cw migration list`.", {}),
        capabilityTool("migration.check", "Dry-run migration verdict for a run-state or workflow-app target; fail-closed on an unreachable version. Peer of `cw migration check`.", {
            target: stringSchema("Run id, or path to a state.json / app.json"),
            contract: stringSchema("run-state | workflow-app (default run-state)"),
            cwd: stringSchema("Run workspace")
        }),
        capabilityTool("migration.prove", "Round-trip / non-destruction migration proof for a target (validates-at-current, append-only, idempotent, source-immutable). Peer of `cw migration prove`.", {
            target: stringSchema("Run id, or path to a state.json / app.json"),
            contract: stringSchema("run-state | workflow-app (default run-state)"),
            cwd: stringSchema("Run workspace")
        }),
        ...runIdCapabilityTools(["operator.status", "graph", "operator.report", "worker.summary"]),
        capabilityTool("workbench.view", "Read the read-only five-panel Workbench view (graph, blackboard, worker, candidate, audit) for one run. Each panel embeds the verbatim `cw <cmd> --json` payload of one existing capability; absent panels are surfaced honestly. Peer of `cw workbench view`.", runIdSchema()),
        capabilityTool("workbench.serve", "Describe the optional localhost-only, read-only Workbench host (bind, scope, routes). Returns the serve descriptor identical to `cw workbench serve --json`; MCP never starts the blocking server.", {
            cwd: stringSchema("Run workspace"),
            port: numberSchema("Optional loopback port, defaults to 7717"),
            scope: stringSchema("Registry scope: repo|home")
        }),
        ...runIdCapabilityTools([
            "candidate.summary",
            "feedback.summary",
            "commit.summary",
            "multi-agent.summary",
            "multi-agent.graph",
            "multi-agent.dependencies",
            "multi-agent.failures",
            "multi-agent.evidence"
        ]),
        capabilityTool("multi-agent.reasoning", "Explain WHY each evidence item was adopted/rejected/superseded/conflicting: a derived, fingerprinted reasoning chain with decision, basis, authority, rationale, and counterfactual per gate (fanin, candidate-score, selection, verifier, commit). Fails closed to `unexplained` when a rationale cannot be traced. Reads valid|stale|absent freshness against current source state.", {
            ...runIdSchema(),
            evidence: stringSchema("Optional evidence id/ref to explain a single adoption"),
            refresh: stringSchema("Set to refresh the durable reasoning index before reading")
        }),
        capabilityTool("multi-agent.reasoning.refresh", "Refresh the durable, versioned, provenance-backed Evidence Adoption Reasoning Chain index under .cw/runs/<id>/reasoning/ (index.json + per-chain records) without mutating raw state.", runIdSchema()),
        capabilityTool("summary.refresh", "Refresh durable, versioned, provenance-backed state-explosion summaries (blackboard digest, compact graph views, operator digest) without deleting raw records. Response includes source refs and expansion hints.", {
            ...runIdSchema(),
            cwd: stringSchema("Run workspace"),
            view: arraySchema("Optional graph views to materialize (full, compact, critical-path, failures, evidence, trust, topology, blackboard, candidate, commit-gate)")
        }),
        capabilityTool("summary.show", "Read the persisted state-explosion report and detect stale or missing summaries against current source state. Fails closed (status=stale) when source records changed.", runIdSchema()),
        capabilityTool("blackboard.summarize", "Read a deterministic blackboard digest (topic rollups, threads, conflicts, decisions, missing evidence, judge rationale) with source refs preserved.", {
            ...runIdSchema(),
            blackboardId: stringSchema("Optional blackboard id; omitted when unambiguous")
        }),
        capabilityTool("multi-agent.summarize", "Read the combined state-explosion report (state size, compact graph, blackboard digest, critical path, failures, evidence, trust digest, hidden source records, expansion commands).", runIdSchema()),
        capabilityTool("multi-agent.graph.compact", "Read a compact or focused multi-agent graph view with synthetic summary nodes that expose collapsed counts, dominant status, blocked reason, and an expansion command.", {
            ...runIdSchema(),
            view: stringSchema("full, compact, critical-path, failures, evidence, trust, topology, blackboard, candidate, or commit-gate"),
            focus: stringSchema("Optional node id to center the view on"),
            depth: numberSchema("Neighborhood depth when focusing, defaults to 1")
        }),
        capabilityTool("multi-agent.run", "Preferred host API: create or attach a high-level multi-agent run from an app/workflow run and topology without dispatching workers.", {
            ...runIdSchema(),
            cwd: stringSchema("Run workspace"),
            app: stringSchema("Optional workflow app id when creating a new workflow run"),
            appId: stringSchema("Optional workflow app id when creating a new workflow run"),
            workflow: stringSchema("Optional workflow id when creating a new workflow run"),
            workflowId: stringSchema("Optional workflow id when creating a new workflow run"),
            topology: stringSchema("map-reduce, debate, or judge-panel"),
            topologyId: stringSchema("Alias for topology"),
            task: arraySchema("Optional task ids for topology materialization"),
            mapperCount: numberSchema("Mapper count for map-reduce"),
            judgeCount: numberSchema("Judge count for judge-panel"),
            debateRounds: numberSchema("Debate rounds for debate")
        }),
        capabilityTool("multi-agent.status", "Preferred host API: read combined topology, multi-agent, blackboard, worker, candidate, commit, and audit status.", runIdSchema()),
        capabilityTool("multi-agent.step", "Preferred host API: perform one deterministic safe step without spawning agents.", {
            ...runIdSchema(),
            sandbox: stringSchema("Sandbox profile for any dispatch manifest created by this step"),
            backend: stringSchema("Execution backend for any dispatch manifest created by this step (node, bun, shell, container, remote, ci)"),
            limit: numberSchema("Maximum dispatch tasks, defaults to 1")
        }),
        capabilityTool("multi-agent.blackboard", "Preferred host API: operate on the active multi-agent blackboard while preserving provenance.", {
            ...runIdSchema(),
            action: stringSchema("summary, topics, messages, post, artifacts, add-artifact, context, or snapshot"),
            blackboardId: stringSchema("Optional blackboard id; omitted only when unambiguous"),
            topicId: stringSchema("Optional topic id; omitted only when unambiguous"),
            body: stringSchema("Message or context body"),
            kind: stringSchema("Artifact or context kind"),
            path: stringSchema("Artifact path"),
            evidence: arraySchema("Evidence refs")
        }),
        capabilityTool("multi-agent.score", "Preferred host API: score a candidate with evidence; never selects automatically.", {
            ...runIdSchema(),
            candidate: stringSchema("Candidate id"),
            candidateId: stringSchema("Alias for candidate"),
            worker: stringSchema("Optional worker id to register as a candidate first"),
            criterion: arraySchema("Score criteria as name=value"),
            criteria: objectSchema("Structured score criteria"),
            evidence: arraySchema("Required evidence refs"),
            maxTotal: numberSchema("Optional max total")
        }),
        capabilityTool("multi-agent.select", "Preferred host API: select a scored candidate only when verifier and score gates pass.", {
            ...runIdSchema(),
            candidate: stringSchema("Candidate id"),
            candidateId: stringSchema("Alias for candidate"),
            score: stringSchema("Optional score id"),
            scoreId: stringSchema("Alias for score"),
            reason: stringSchema("Acceptance rationale"),
            allowUnverified: booleanSchema("Explicitly bypass verifier gate")
        }),
        capabilityTool("eval.snapshot", "Create a deterministic multi-agent replay snapshot for a run.", {
            ...runIdSchema(),
            cwd: stringSchema("Run workspace"),
            id: stringSchema("Snapshot or suite id")
        }),
        capabilityTool("eval.replay", "Replay a multi-agent snapshot in an isolated replay directory without live agents.", {
            cwd: stringSchema("Workspace"),
            snapshot: stringSchema("Snapshot id or path"),
            snapshotId: stringSchema("Alias for snapshot"),
            path: stringSchema("Snapshot path"),
            id: stringSchema("Replay id")
        }),
        capabilityTool("eval.compare", "Compare a baseline snapshot and replay run with normalized deterministic rules.", {
            cwd: stringSchema("Workspace"),
            baseline: stringSchema("Baseline snapshot id or path"),
            baselinePath: stringSchema("Baseline snapshot path"),
            replay: stringSchema("Replay run id or path"),
            replayPath: stringSchema("Replay run path")
        }),
        capabilityTool("eval.score", "Score replay quality with explicit deterministic metrics.", {
            cwd: stringSchema("Workspace"),
            replay: stringSchema("Replay run id or path"),
            replayPath: stringSchema("Replay run path"),
            path: stringSchema("Replay run path")
        }),
        capabilityTool("eval.gate", "Run the multi-agent eval/replay regression gate for a suite.", {
            cwd: stringSchema("Workspace"),
            suite: stringSchema("Suite id or path"),
            suiteId: stringSchema("Alias for suite"),
            path: stringSchema("Suite path")
        }),
        capabilityTool("eval.report", "Render the multi-agent eval/replay report and return its path.", {
            cwd: stringSchema("Workspace"),
            replay: stringSchema("Replay run id or path"),
            replayPath: stringSchema("Replay run path"),
            path: stringSchema("Replay run path")
        }),
        capabilityTool("multi-agent.run.create", "Create a MultiAgentRun state record.", {
            ...runIdSchema(),
            id: stringSchema("Optional MultiAgentRun id"),
            title: stringSchema("Short title"),
            objective: stringSchema("Objective or reason")
        }),
        capabilityTool("multi-agent.run.transition", "Transition a MultiAgentRun lifecycle status.", {
            ...runIdSchema(),
            multiAgentRunId: stringSchema("MultiAgentRun id"),
            id: stringSchema("Alias for multiAgentRunId"),
            status: stringSchema("planned, forming, running, collecting, verifying, completed, failed, or cancelled"),
            reason: stringSchema("Transition reason")
        }),
        capabilityTool("multi-agent.run.show", "Show one MultiAgentRun record.", {
            ...runIdSchema(),
            multiAgentRunId: stringSchema("MultiAgentRun id"),
            id: stringSchema("Alias for multiAgentRunId")
        }),
        capabilityTool("multi-agent.role.create", "Create an AgentRole record.", {
            ...runIdSchema(),
            id: stringSchema("Optional AgentRole id"),
            multiAgentRunId: stringSchema("MultiAgentRun id"),
            multiAgentRun: stringSchema("Alias for multiAgentRunId"),
            title: stringSchema("Role title"),
            responsibility: arraySchema("Responsibilities"),
            requiredEvidence: arraySchema("Required evidence locators or descriptions"),
            sandboxProfileHint: arraySchema("Sandbox profile hints"),
            expectedArtifact: arraySchema("Expected artifacts"),
            faninObligation: arraySchema("Fanin obligations")
        }),
        capabilityTool("multi-agent.role.show", "Show one AgentRole record.", {
            ...runIdSchema(),
            roleId: stringSchema("AgentRole id"),
            id: stringSchema("Alias for roleId")
        }),
        capabilityTool("multi-agent.group.create", "Create an AgentGroup record.", {
            ...runIdSchema(),
            id: stringSchema("Optional AgentGroup id"),
            multiAgentRunId: stringSchema("MultiAgentRun id"),
            multiAgentRun: stringSchema("Alias for multiAgentRunId"),
            title: stringSchema("Group title"),
            phase: stringSchema("Workflow phase"),
            task: arraySchema("Task ids")
        }),
        capabilityTool("multi-agent.group.show", "Show one AgentGroup record.", {
            ...runIdSchema(),
            groupId: stringSchema("AgentGroup id"),
            id: stringSchema("Alias for groupId")
        }),
        capabilityTool("multi-agent.membership.create", "Create an AgentMembership record.", {
            ...runIdSchema(),
            id: stringSchema("Optional AgentMembership id"),
            groupId: stringSchema("AgentGroup id"),
            roleId: stringSchema("AgentRole id"),
            taskId: stringSchema("Task id"),
            workerId: stringSchema("Optional worker id"),
            dispatchId: stringSchema("Optional dispatch id"),
            fanoutId: stringSchema("Optional fanout id")
        }),
        capabilityTool("multi-agent.membership.show", "Show one AgentMembership record.", {
            ...runIdSchema(),
            membershipId: stringSchema("AgentMembership id"),
            id: stringSchema("Alias for membershipId")
        }),
        capabilityTool("multi-agent.fanout.create", "Create an AgentFanout record.", {
            ...runIdSchema(),
            id: stringSchema("Optional AgentFanout id"),
            groupId: stringSchema("AgentGroup id"),
            reason: stringSchema("Why work was split"),
            role: arraySchema("Role ids"),
            task: arraySchema("Task ids"),
            limit: numberSchema("Concurrency limit"),
            sandboxChoice: arraySchema("Sandbox choices as key=value")
        }),
        capabilityTool("multi-agent.fanout.show", "Show one AgentFanout record.", {
            ...runIdSchema(),
            fanoutId: stringSchema("AgentFanout id"),
            id: stringSchema("Alias for fanoutId")
        }),
        capabilityTool("multi-agent.fanin.collect", "Collect AgentFanin evidence coverage and fail closed on missing role evidence.", {
            ...runIdSchema(),
            id: stringSchema("Optional AgentFanin id"),
            groupId: stringSchema("AgentGroup id"),
            fanoutId: stringSchema("Optional fanout id"),
            requiredRole: arraySchema("Required role ids"),
            strategy: stringSchema("Aggregation strategy")
        }),
        capabilityTool("multi-agent.fanin.show", "Show one AgentFanin record.", {
            ...runIdSchema(),
            faninId: stringSchema("AgentFanin id"),
            id: stringSchema("Alias for faninId")
        }),
        capabilityTool("topology.list", "List official multi-agent topology definitions.", {}),
        capabilityTool("topology.show", "Show an official topology definition or a topology run when runId is provided.", {
            ...runIdSchema(),
            topologyId: stringSchema("Official topology id"),
            topologyRunId: stringSchema("Topology run id"),
            id: stringSchema("Alias for topologyId or topologyRunId")
        }),
        capabilityTool("topology.validate", "Validate an official topology definition.", {
            topologyId: stringSchema("Official topology id"),
            id: stringSchema("Alias for topologyId")
        }),
        capabilityTool("topology.apply", "Apply an official topology to a CW run using multi-agent and blackboard records.", {
            ...runIdSchema(),
            topologyId: stringSchema("map-reduce, debate, or judge-panel"),
            id: stringSchema("Optional topology run id"),
            task: arraySchema("Task ids"),
            mapperCount: numberSchema("Mapper count for map-reduce"),
            judgeCount: numberSchema("Judge count for judge-panel"),
            debateRounds: numberSchema("Debate rounds for debate"),
            blackboardId: stringSchema("Optional blackboard id"),
            multiAgentRunId: stringSchema("Optional MultiAgentRun id"),
            collectInitialFanin: booleanSchema("Collect an initial fail-closed fanin immediately")
        }),
        capabilityTool("topology.summary", "Read topology progress and next actions for a run.", runIdSchema()),
        capabilityTool("topology.graph", "Read topology graph nodes and edges for a run.", runIdSchema()),
        capabilityTool("blackboard.summary", "Read blackboard/coordinator summary for a run.", runIdSchema()),
        capabilityTool("blackboard.graph", "Read blackboard/coordinator graph nodes and edges.", runIdSchema()),
        capabilityTool("blackboard.resolve", "Create or resolve the blackboard for a run or MultiAgentRun.", {
            ...runIdSchema(),
            id: stringSchema("Optional blackboard id"),
            title: stringSchema("Blackboard title"),
            multiAgentRunId: stringSchema("Optional MultiAgentRun id"),
            groupId: stringSchema("Optional AgentGroup id"),
            roleId: stringSchema("Optional AgentRole id"),
            membershipId: stringSchema("Optional AgentMembership id")
        }),
        capabilityTool("blackboard.topic.create", "Create a blackboard topic.", {
            ...runIdSchema(),
            id: stringSchema("Optional topic id"),
            title: stringSchema("Topic title"),
            description: stringSchema("Topic description"),
            blackboardId: stringSchema("Optional blackboard id"),
            tag: arraySchema("Tags")
        }),
        capabilityTool("blackboard.message.post", "Post a blackboard message.", {
            ...runIdSchema(),
            id: stringSchema("Optional message id"),
            topic: stringSchema("Topic id"),
            topicId: stringSchema("Topic id"),
            body: stringSchema("Message body"),
            replyTo: stringSchema("Optional parent message id"),
            visibility: stringSchema("public, group, role, or private"),
            evidence: arraySchema("Linked evidence refs"),
            artifact: arraySchema("Linked blackboard artifact ref ids")
        }),
        capabilityTool("blackboard.message.list", "List blackboard messages.", {
            ...runIdSchema(),
            topic: stringSchema("Optional topic id"),
            topicId: stringSchema("Optional topic id"),
            blackboardId: stringSchema("Optional blackboard id")
        }),
        capabilityTool("blackboard.context.put", "Publish a shared context frame.", {
            ...runIdSchema(),
            id: stringSchema("Optional context id"),
            topic: stringSchema("Topic id"),
            topicId: stringSchema("Topic id"),
            kind: stringSchema("fact, constraint, assumption, question, or decision"),
            key: stringSchema("Context key"),
            value: stringSchema("Context value"),
            supersedes: arraySchema("Context ids superseded by this update"),
            evidence: arraySchema("Evidence refs"),
            artifact: arraySchema("Blackboard artifact ref ids")
        }),
        capabilityTool("blackboard.artifact.add", "Index an artifact in the blackboard.", {
            ...runIdSchema(),
            id: stringSchema("Optional artifact ref id"),
            topic: stringSchema("Optional topic id"),
            kind: stringSchema("Artifact kind"),
            path: stringSchema("Local artifact path"),
            locator: stringSchema("External or logical locator"),
            source: stringSchema("Artifact source"),
            evidence: arraySchema("Evidence refs")
        }),
        capabilityTool("blackboard.artifact.list", "List blackboard artifact refs.", {
            ...runIdSchema(),
            topic: stringSchema("Optional topic id"),
            blackboardId: stringSchema("Optional blackboard id")
        }),
        capabilityTool("blackboard.snapshot", "Create a durable blackboard snapshot.", {
            ...runIdSchema(),
            blackboardId: stringSchema("Optional blackboard id")
        }),
        capabilityTool("coordinator.summary", "Read coordinator summary for a run.", runIdSchema()),
        capabilityTool("coordinator.decision", "Record a coordinator decision.", {
            ...runIdSchema(),
            id: stringSchema("Optional decision id"),
            kind: stringSchema("Decision kind"),
            outcome: stringSchema("accepted, rejected, superseded, conflicting, ready, or blocked"),
            reason: stringSchema("Decision rationale"),
            subject: arraySchema("Subject record ids"),
            evidence: arraySchema("Evidence refs"),
            artifact: arraySchema("Blackboard artifact ref ids"),
            message: arraySchema("Blackboard message ids")
        }),
        capabilityTool("audit.summary", "Read durable trust/audit summary for a run.", runIdSchema()),
        capabilityTool("audit.verify", "Re-prove a run's trust-audit hash chain offline: recompute every event hash from genesis + check chain linkage; a forged, edited, truncated, or unchained-injected event fails it. Peer of `cw audit verify`; fail-closed.", runIdSchema()),
        capabilityTool("audit.worker", "Read trust/audit events for one worker.", workerIdSchema()),
        capabilityTool("audit.provenance", "Inspect evidence provenance for a run, worker, candidate, or commit.", {
            ...runIdSchema(),
            workerId: stringSchema("Optional worker id"),
            worker: stringSchema("Optional worker id"),
            candidateId: stringSchema("Optional candidate id"),
            candidate: stringSchema("Optional candidate id"),
            commitId: stringSchema("Optional commit id"),
            commit: stringSchema("Optional commit id")
        }),
        capabilityTool("audit.multi-agent", "Read multi-agent trust, policy, blackboard write, provenance, judge, and violation audit projections.", runIdSchema()),
        capabilityTool("audit.policy", "Read role policies, permission decisions, and policy violations for a run.", runIdSchema()),
        capabilityTool("audit.role", "Read policy and audit events for one multi-agent role.", {
            ...runIdSchema(),
            roleId: stringSchema("Agent role id"),
            id: stringSchema("Agent role id")
        }),
        capabilityTool("audit.blackboard", "Read blackboard write audit and message provenance for a run.", runIdSchema()),
        capabilityTool("audit.judge", "Read judge rationale and panel decision audit records for a run.", runIdSchema()),
        capabilityTool("audit.attest", "Record a host/operator sandbox attestation without storing secrets.", {
            ...runIdSchema(),
            workerId: stringSchema("Optional worker id"),
            worker: stringSchema("Optional worker id"),
            actor: stringSchema("Host/operator actor"),
            hostEnforced: booleanSchema("Whether the host says enforcement was active"),
            env: arraySchema("Environment variable names only"),
            note: stringSchema("Short attestation note")
        }),
        capabilityTool("audit.decision", "Validate and record a sandbox path/command/network/env decision.", {
            ...workerIdSchema(),
            path: stringSchema("Path to validate"),
            command: stringSchema("Command to validate"),
            network: stringSchema("Network target to validate"),
            env: stringSchema("Environment variable name to validate"),
            kind: stringSchema("sandbox.path, sandbox.command, sandbox.network, or sandbox.env")
        }),
        capabilityTool("dispatch", "Create a subagent dispatch manifest.", {
            runId: stringSchema("Run id"),
            cwd: stringSchema("Run workspace"),
            limit: numberSchema("Max tasks to dispatch"),
            sandbox: stringSchema("Sandbox profile id"),
            sandboxProfile: stringSchema("Sandbox profile id"),
            sandboxProfileId: stringSchema("Sandbox profile id"),
            backend: stringSchema("Execution backend id (node, bun, shell, container, remote, ci)"),
            backendId: stringSchema("Execution backend id")
        }),
        capabilityTool("sandbox.list", "List bundled sandbox profiles.", {
            cwd: stringSchema("Workspace used to resolve profile paths")
        }),
        capabilityTool("sandbox.show", "Show a resolved sandbox profile.", {
            cwd: stringSchema("Workspace used to resolve profile paths"),
            profileId: stringSchema("Sandbox profile id")
        }),
        capabilityTool("sandbox.validate", "Validate a sandbox profile JSON file.", {
            cwd: stringSchema("Workspace used to resolve profile paths"),
            profileFile: stringSchema("Sandbox profile JSON file")
        }),
        capabilityTool("sandbox.choose", "Resolve and validate a sandbox profile without dispatching work.", {
            cwd: stringSchema("Workspace used to resolve profile paths"),
            profileId: stringSchema("Sandbox profile id"),
            sandbox: stringSchema("Sandbox profile id"),
            sandboxProfile: stringSchema("Sandbox profile id"),
            sandboxProfileId: stringSchema("Sandbox profile id")
        }),
        capabilityTool("sandbox.resolve", "Alias for cw_sandbox_choose.", {
            cwd: stringSchema("Workspace used to resolve profile paths"),
            profileId: stringSchema("Sandbox profile id"),
            sandbox: stringSchema("Sandbox profile id"),
            sandboxProfile: stringSchema("Sandbox profile id"),
            sandboxProfileId: stringSchema("Sandbox profile id")
        }),
        capabilityTool("backend.list", "List available execution backends and their capabilities.", {
            cwd: stringSchema("Workspace")
        }),
        capabilityTool("backend.show", "Show one execution backend descriptor.", {
            cwd: stringSchema("Workspace"),
            backendId: stringSchema("Execution backend id (node, bun, shell, container, remote, ci)")
        }),
        capabilityTool("backend.probe", "Probe execution backend readiness (live, deterministic).", {
            cwd: stringSchema("Workspace"),
            backendId: stringSchema("Execution backend id; omit to probe all backends")
        }),
        capabilityTool("backend.agent.config.show", "Show the effective agent delegation config (flags>env>file, secret-stripped, host-stable). Read-only.", {
            cwd: stringSchema("Workspace"),
            agentCommand: stringSchema("Override: agent command-template (e.g. 'claude -p --output-format json {{manifest}}')"),
            agentEndpoint: stringSchema("Override: agent HTTP endpoint"),
            agentModel: stringSchema("Override: operator-chosen model (policy, NOT the attested model)")
        }),
        capabilityTool("backend.agent.config.set", "Persist the durable agent delegation config under $CW_HOME (command-template/endpoint/model). API keys are NEVER written — they come from the agent's own env. Mutating.", {
            cwd: stringSchema("Workspace"),
            agentCommand: stringSchema("Agent command-template (binary + argv with {{manifest}}/{{input}}/{{result}}/{{model}})"),
            agentEndpoint: stringSchema("Agent HTTP endpoint to POST the manifest to"),
            agentModel: stringSchema("Operator-chosen model interpolated into {{model}} (policy, not attested)")
        }),
        capabilityTool("result", "Record a subagent result.", {
            runId: stringSchema("Run id"),
            taskId: stringSchema("Task id"),
            resultPath: stringSchema("Result markdown path"),
            cwd: stringSchema("Run workspace")
        }),
        capabilityTool("commit", "Create a verifier-gated commit or explicit checkpoint.", {
            runId: stringSchema("Run id"),
            reason: stringSchema("Commit reason"),
            verifier: stringSchema("Verified verifier node id"),
            verifierNode: stringSchema("Verified verifier node id"),
            candidate: stringSchema("Verified candidate id"),
            selection: stringSchema("Verified candidate selection id"),
            allowUnverifiedCheckpoint: { type: "boolean", description: "Write a non-gated checkpoint instead of committed state" },
            cwd: stringSchema("Run workspace")
        }),
        capabilityTool("report", "Render a run report.", {
            runId: stringSchema("Run id"),
            cwd: stringSchema("Run workspace")
        }),
        capabilityTool("app.list", "List CW workflow apps and legacy workflow files.", {
            cwd: stringSchema("Workspace")
        }),
        capabilityTool("app.show", "Show a CW workflow app contract.", {
            cwd: stringSchema("Workspace"),
            appId: stringSchema("Workflow app id")
        }),
        capabilityTool("app.validate", "Validate a CW workflow app by path or id.", {
            cwd: stringSchema("Workspace"),
            target: stringSchema("Workflow app path or id")
        }),
        capabilityTool("app.init", "Create a CW workflow app directory.", {
            cwd: stringSchema("Workspace"),
            appId: stringSchema("Workflow app id"),
            title: stringSchema("Workflow app title"),
            directory: stringSchema("Destination directory")
        }),
        capabilityTool("app.package", "Package a CW workflow app as a JSON artifact.", {
            cwd: stringSchema("Workspace"),
            appId: stringSchema("Workflow app id"),
            output: stringSchema("Output package path")
        }),
        capabilityTool("worker.list", "List worker isolation scopes for a run.", {
            ...runIdSchema(),
            status: stringSchema("Optional worker status filter")
        }),
        capabilityTool("worker.show", "Show one worker isolation scope.", workerIdSchema()),
        capabilityTool("worker.manifest", "Write and return one worker manifest.", workerIdSchema()),
        capabilityTool("worker.output", "Record worker output from a result markdown path.", {
            ...workerIdSchema(),
            resultPath: stringSchema("Worker result markdown path")
        }),
        capabilityTool("worker.fail", "Record a structured worker failure.", {
            ...workerIdSchema(),
            message: stringSchema("Failure message"),
            code: stringSchema("Failure code"),
            path: stringSchema("Related file path"),
            retryable: booleanSchema("Whether the failure can be retried")
        }),
        capabilityTool("worker.validate", "Validate a worker output path against its sandbox boundary.", {
            ...workerIdSchema(),
            path: stringSchema("Path to validate"),
            resultPath: stringSchema("Result path to validate")
        }),
        capabilityTool("candidate.list", "List candidates for a run.", {
            ...runIdSchema(),
            status: stringSchema("Optional candidate status filter"),
            kind: stringSchema("Optional candidate kind filter")
        }),
        capabilityTool("candidate.show", "Show one candidate.", candidateIdSchema()),
        capabilityTool("candidate.register", "Register a candidate from worker, task, or result evidence.", {
            ...runIdSchema(),
            id: stringSchema("Optional candidate id"),
            kind: stringSchema("Candidate kind"),
            worker: stringSchema("Worker id"),
            task: stringSchema("Task id"),
            resultNode: stringSchema("Result node id"),
            verifierNode: stringSchema("Verifier node id"),
            resultPath: stringSchema("Result markdown path")
        }),
        capabilityTool("candidate.score", "Score a candidate with structured criteria and evidence locators.", {
            ...candidateIdSchema(),
            criteria: objectSchema("Criterion numeric values, for example { correctness: 4 }"),
            criterion: arraySchema("CLI-compatible name=value criterion strings"),
            evidence: arraySchema("Evidence locators"),
            maxTotal: numberSchema("Maximum possible total score"),
            max: numberSchema("Alias for maxTotal"),
            verdict: stringSchema("pass, warn, or fail"),
            notes: stringSchema("Score notes"),
            scorer: stringSchema("Scorer id")
        }),
        capabilityTool("candidate.rank", "Rank candidates with evidence and verifier gate policy.", {
            ...runIdSchema(),
            includeRejected: booleanSchema("Include rejected candidates"),
            minNormalized: numberSchema("Minimum normalized score"),
            requireEvidence: booleanSchema("Require score evidence"),
            requireVerifierGate: booleanSchema("Require verified verifier node"),
            tieBreaker: stringSchema("Tie breaker policy")
        }),
        capabilityTool("candidate.select", "Select a candidate with verifier-gated policy.", {
            ...candidateIdSchema(),
            reason: stringSchema("Selection reason"),
            selectedBy: stringSchema("Selector id"),
            by: stringSchema("Alias for selectedBy"),
            score: stringSchema("Score id"),
            allowUnverified: booleanSchema("Allow selection without a verifier gate"),
            minNormalized: numberSchema("Minimum normalized score"),
            requireVerifierGate: booleanSchema("Require verified verifier node")
        }),
        capabilityTool("candidate.reject", "Reject a candidate with a durable reason.", {
            ...candidateIdSchema(),
            reason: stringSchema("Rejection reason")
        }),
        capabilityTool("approve", "Append a host-attested approval of a candidate/commit/selection (review gate counts it).", {
            ...runIdSchema(),
            ...collaborationTargetSchema(),
            ...actorSchema(),
            rationale: stringSchema("Approval rationale"),
            supersedes: stringSchema("Prior approval record this revises")
        }),
        capabilityTool("reject", "Append a host-attested rejection (a blocking veto) of a candidate/commit/selection.", {
            ...runIdSchema(),
            ...collaborationTargetSchema(),
            ...actorSchema(),
            rationale: stringSchema("Rejection rationale")
        }),
        capabilityTool("comment.add", "Append a comment to a durable target (run/task/candidate/selection/commit/node).", {
            ...runIdSchema(),
            ...collaborationTargetSchema(),
            ...actorSchema(),
            body: stringSchema("Comment body"),
            thread: stringSchema("Thread id"),
            parent: stringSchema("Parent comment id")
        }),
        capabilityTool("comment.list", "List append-only comments for a run (optionally one target).", {
            ...runIdSchema(),
            targetKind: stringSchema("Optional target kind filter"),
            target: stringSchema("Optional target id filter")
        }),
        capabilityTool("handoff", "Record an ownership transfer (from-actor → to-actor) of a run/task.", {
            ...runIdSchema(),
            ...collaborationTargetSchema(),
            ...actorSchema(),
            to: stringSchema("To-actor id"),
            toRole: stringSchema("To-actor role"),
            from: stringSchema("From-actor id (defaults to recorder)"),
            reason: stringSchema("Handoff reason")
        }),
        capabilityTool("review.status", "Read the derived per-target review state + collaboration timeline for a run.", {
            ...runIdSchema(),
            targetKind: stringSchema("Optional target kind filter"),
            target: stringSchema("Optional target id filter"),
            now: stringSchema("Injected ISO timestamp (deterministic reports)")
        }),
        capabilityTool("review.policy", "Set the run's review-gate policy (data, not kernel): required approvals, authorized roles.", {
            ...runIdSchema(),
            requiredApprovals: numberSchema("Approvals required (0 = no gate)"),
            authorizedRoles: stringSchema("Comma-separated authorized roles; * = any"),
            allowSelfApproval: booleanSchema("Allow producers to approve their own work"),
            requireAttestedActor: booleanSchema("Require host-attested approvers"),
            appliesTo: stringSchema("Comma-separated target kinds (e.g. commit,selection)")
        }),
        capabilityTool("feedback.list", "List run feedback records.", {
            runId: stringSchema("Run id"),
            cwd: stringSchema("Run workspace"),
            status: stringSchema("Optional status filter")
        }),
        capabilityTool("feedback.show", "Show a run feedback record.", {
            runId: stringSchema("Run id"),
            feedbackId: stringSchema("Feedback id"),
            cwd: stringSchema("Run workspace")
        }),
        capabilityTool("feedback.collect", "Collect feedback from failed state nodes.", {
            runId: stringSchema("Run id"),
            cwd: stringSchema("Run workspace")
        }),
        capabilityTool("feedback.task", "Create a correction task for a feedback record.", {
            runId: stringSchema("Run id"),
            feedbackId: stringSchema("Feedback id"),
            cwd: stringSchema("Run workspace"),
            verify: stringSchema("Expected verification command")
        }),
        capabilityTool("feedback.resolve", "Resolve or reject a feedback record.", {
            runId: stringSchema("Run id"),
            feedbackId: stringSchema("Feedback id"),
            cwd: stringSchema("Run workspace"),
            node: stringSchema("Verified or committed node id"),
            status: stringSchema("resolved or rejected")
        }),
        capabilityTool("schedule.create", "Create a scheduled CW task.", {
            cwd: stringSchema("Workspace"),
            kind: stringSchema("loop, cron, or reminder"),
            prompt: stringSchema("Prompt to run"),
            intervalMinutes: numberSchema("Loop interval in minutes"),
            cron: stringSchema("5-field cron expression"),
            delayMinutes: numberSchema("Reminder delay in minutes")
        }),
        capabilityTool("schedule.list", "List scheduled CW tasks.", {
            cwd: stringSchema("Workspace"),
            status: stringSchema("Optional status filter")
        }),
        capabilityTool("schedule.due", "List due scheduled CW tasks.", {
            cwd: stringSchema("Workspace")
        }),
        capabilityTool("schedule.complete", "Mark a scheduled CW task run complete and advance it.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Schedule id")
        }),
        capabilityTool("schedule.pause", "Pause a scheduled CW task.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Schedule id")
        }),
        capabilityTool("schedule.resume", "Resume a scheduled CW task.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Schedule id")
        }),
        capabilityTool("schedule.run-now", "Create an immediate scheduled-task run record.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Schedule id")
        }),
        capabilityTool("schedule.history", "List scheduled-task run history.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Optional schedule id")
        }),
        capabilityTool("schedule.delete", "Delete a scheduled CW task.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Schedule id")
        }),
        capabilityTool("routine.create", "Create a routine-style API or GitHub trigger.", {
            cwd: stringSchema("Workspace"),
            kind: stringSchema("api or github"),
            prompt: stringSchema("Prompt to run when the trigger matches"),
            match: stringSchema("Optional JSON object match rule")
        }),
        capabilityTool("routine.list", "List routine-style triggers.", {
            cwd: stringSchema("Workspace"),
            kind: stringSchema("Optional api or github filter")
        }),
        capabilityTool("routine.fire", "Record an API or GitHub trigger event.", {
            cwd: stringSchema("Workspace"),
            kind: stringSchema("api or github"),
            payload: { type: "object", description: "Event payload" }
        }),
        capabilityTool("routine.events", "List routine trigger events.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Optional trigger id")
        }),
        capabilityTool("routine.delete", "Delete a routine-style trigger.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Trigger id")
        }),
        capabilityTool("registry.refresh", "Recompute and persist the derived run registry index from source state.json. Registers the current repo for cross-repo discovery. Never mutates source state.", {
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("repo (default) or home (cross-repo)")
        }),
        capabilityTool("registry.show", "Read the run registry index with valid|stale|absent freshness against current source state. Fails closed: tampered/missing source surfaces as stale/missing with rebuild guidance, never a fabricated status.", {
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("repo (default) or home (cross-repo)")
        }),
        capabilityTool("metrics.show", "Read the DERIVED per-run observability + attested-cost report: durations from recorded timestamps, failure/verifier/acceptance rates with sample counts (n/a on zero samples), attested token usage with coverage, and cost (attested vs estimated vs unreported). Deterministic over a fixed snapshot; never fabricates a counter.", {
            runId: stringSchema("Run id"),
            cwd: stringSchema("Repo workspace"),
            pricing: stringSchema("Pricing policy path, or 'default' for the bundled example (POLICY, optional). Absent ⇒ cost is unpriced/unreported, never guessed."),
            now: stringSchema("Optional injected ISO wall-clock for deterministic eval/replay (only affects generatedAt).")
        }),
        capabilityTool("metrics.summary", "Read the cross-repo observability + cost rollup over the run registry, with per-app and per-backend breakdowns. Rates pool samples; usage/cost sum attested values with explicit coverage and unreported. Unreadable runs are counted, never dropped.", {
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("repo (default) or home (cross-repo)"),
            pricing: stringSchema("Pricing policy path or 'default' (POLICY, optional)."),
            now: stringSchema("Optional injected ISO wall-clock for deterministic eval/replay.")
        }),
        capabilityTool("run.search", "Search runs by app, lifecycle status, time range, repo, and free-text over metadata. Deterministic and paginated; cross-repo by default. Re-derived from source.", {
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("home (default, cross-repo) or repo"),
            text: stringSchema("Free-text over runId/app/workflow/title/repo/lifecycle/inputs"),
            app: stringSchema("App or workflow id filter"),
            status: stringSchema("queued|running|blocked|completed|failed|archived"),
            repo: stringSchema("Repo root filter"),
            since: stringSchema("ISO lower bound on createdAt"),
            until: stringSchema("ISO upper bound on createdAt"),
            includeArchived: booleanSchema("Include archived runs (default true)"),
            limit: numberSchema("Page size (default 50)"),
            offset: numberSchema("Page offset (default 0)")
        }),
        capabilityTool("run.list", "List indexed runs across repos (search with no filters), deterministic and paginated.", {
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("home (default, cross-repo) or repo"),
            includeArchived: booleanSchema("Include archived runs (default true)"),
            limit: numberSchema("Page size (default 50)"),
            offset: numberSchema("Page offset (default 0)")
        }),
        capabilityTool("run.show", "Resolve one run by id across the registry; fail closed with found=false/freshness=missing when source state is gone (never a fabricated status).", {
            runId: stringSchema("Run id"),
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("home (default, cross-repo) or repo")
        }),
        capabilityTool("run.resume", "Resolve a run by id and continue it from durable state: returns next runnable tasks and next actions. Read-only over source state.", {
            runId: stringSchema("Run id"),
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("home (default, cross-repo) or repo"),
            limit: numberSchema("Max next tasks to return (default 5)")
        }),
        capabilityTool("run.archive", "Archive or unarchive a run via an overlay mark (never deletes source). With olderThanDays instead of runId, apply a retention policy. Archived runs stay searchable.", {
            runId: stringSchema("Run id to archive (omit to use a retention policy)"),
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("home (default, cross-repo) or repo"),
            reason: stringSchema("Archive reason"),
            unarchive: booleanSchema("Clear the archive overlay instead of setting it"),
            olderThanDays: numberSchema("Retention window: archive eligible runs older than N days"),
            state: stringSchema("Lifecycle states eligible for retention archiving")
        }),
        capabilityTool("run.rerun", "Re-run a failed run as a NEW run that links to the original via provenance (inputs reused). The original failed run is preserved for audit.", {
            runId: stringSchema("Failed run id to rerun"),
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("home (default, cross-repo) or repo"),
            reason: stringSchema("Rerun reason")
        }),
        capabilityTool("run.export", "Export a run to a portable, digest-checked archive containing run-local artifacts, audit overlays, telemetry, reports, workers, and commit snapshots.", {
            runId: stringSchema("Run id to export"),
            cwd: stringSchema("Repo workspace containing .cw/runs/<run-id>"),
            output: stringSchema("Archive output path"),
            path: stringSchema("Alias for output"),
            archive: stringSchema("Alias for output"),
            trustKey: stringSchema("Optional ed25519 PUBLIC key (inline PEM or path) to embed so the bundle re-verifies offline; defaults to CW_AGENT_ATTEST_PUBKEY"),
            withTrustKey: stringSchema("Alias for trustKey")
        }),
        capabilityTool("run.import", "Restore a portable run archive into a target repo and immediately verify restored file digests.", {
            archive: stringSchema("Archive path"),
            path: stringSchema("Alias for archive"),
            file: stringSchema("Alias for archive"),
            target: stringSchema("Restore target repo directory"),
            repo: stringSchema("Alias for target"),
            cwd: stringSchema("Invocation workspace")
        }),
        capabilityTool("run.verify-import", "Verify an imported run against its restore manifest and telemetry chain; detects missing or tampered restored files.", {
            runId: stringSchema("Imported run id to verify"),
            cwd: stringSchema("Restored repo workspace")
        }),
        capabilityTool("run.inspect-archive", "Read-only integrity inspection of a portable run archive without importing it: re-proves every file digest/size, the manifest digest + file count, and the whole-archive sha256, naming any offending file. Writes nothing.", {
            archive: stringSchema("Archive path"),
            path: stringSchema("Alias for archive"),
            file: stringSchema("Alias for archive"),
            cwd: stringSchema("Invocation workspace")
        }),
        capabilityTool("report.verify-bundle", "Offline, self-contained verify of a portable run bundle: proves the archive bytes, the telemetry hash chain, the trust-audit chain, and (with the bundle's embedded public key) the ed25519 signatures — no source repo, no pre-existing .cw tree, no out-of-band key. Restores into a throwaway tmpdir and writes nothing. A forged or edited bundle fails it. Peer of `cw report verify-bundle`.", {
            archive: stringSchema("Bundle (.cwrun.json) path"),
            path: stringSchema("Alias for archive"),
            file: stringSchema("Alias for archive"),
            bundle: stringSchema("Alias for archive"),
            pubkey: stringSchema("Optional public key (inline PEM or path); used only when the bundle embeds no trust key"),
            extractReport: stringSchema("Optional path to write the bundle's report.md to"),
            strictSignatures: booleanSchema("Fail when the bundle claims attested telemetry but no key is available to re-verify it"),
            cwd: stringSchema("Invocation workspace")
        }),
        capabilityTool("report.bundle", "Produce-and-prove: export a run to a portable bundle sealed with the operator's ed25519 public key (defaults to CW_AGENT_ATTEST_PUBKEY), then immediately self-verify it offline the way a recipient will. Fail-closed: the producer learns now whether the artifact is verifiable before shipping it. Peer of `cw report bundle`.", {
            runId: stringSchema("Run id to bundle"),
            cwd: stringSchema("Repo workspace containing .cw/runs/<run-id>"),
            output: stringSchema("Bundle output path"),
            path: stringSchema("Alias for output"),
            trustKey: stringSchema("Optional ed25519 PUBLIC key (inline PEM or path) to seal; defaults to CW_AGENT_ATTEST_PUBKEY"),
            withTrustKey: stringSchema("Alias for trustKey"),
            extractReport: stringSchema("Optional path to also write the human-readable report.md to"),
            strictSignatures: booleanSchema("Refuse to call the bundle ok if attested telemetry cannot be re-verified (no key)")
        }),
        capabilityTool("run.drive", "Preview the next agent-delegation drive step for a run (read-only, deterministic). Counts come from state; no spawn, no mutation.", {
            runId: stringSchema("Run id to preview"),
            cwd: stringSchema("Run workspace")
        }),
        capabilityTool("run.drive.step", "Drive a run by delegating each worker to the agent backend (plan->dispatch->fulfill->accept->commit). The model runs in the external agent's process, never in CW. --once advances exactly one step. Mutating.", {
            runId: stringSchema("Run id to continue (omit to plan a fresh run for appId)"),
            appId: stringSchema("App id to plan + drive (e.g. architecture-review)"),
            repo: stringSchema("Target repository to analyze"),
            question: stringSchema("The question the audited report answers"),
            once: booleanSchema("Advance exactly one step then stop"),
            now: stringSchema("Injected ISO timestamp for deterministic scheduling"),
            cwd: stringSchema("Run workspace")
        }),
        capabilityTool("queue.add", "Enqueue a pending/planned run with explicit ordering policy (lower priority drains first). Plain files; the host still executes workers.", {
            cwd: stringSchema("Repo workspace"),
            runId: stringSchema("Optional existing planned run id"),
            appId: stringSchema("App id to run"),
            workflowId: stringSchema("Workflow id to run"),
            repo: stringSchema("Repo root that owns the run (default cwd)"),
            priority: numberSchema("Ordering priority (lower drains first, default 100)"),
            note: stringSchema("Free-text note")
        }),
        capabilityTool("queue.list", "List the durable run queue in policy order (priority asc, then enqueuedAt).", {
            cwd: stringSchema("Repo workspace"),
            status: stringSchema("pending|ready|draining|drained|cancelled"),
            repo: stringSchema("Repo root filter")
        }),
        capabilityTool("queue.drain", "Mark the next ready queue entries drained in policy order and return them; the host executes the workers.", {
            cwd: stringSchema("Repo workspace"),
            limit: numberSchema("How many entries to drain (default 1)"),
            repo: stringSchema("Repo root filter")
        }),
        capabilityTool("queue.show", "Show one durable queue entry.", {
            cwd: stringSchema("Repo workspace"),
            id: stringSchema("Queue entry id")
        }),
        capabilityTool("sched.plan", "Read-only control-plane lease plan for the queue+policy+now (deterministic; concurrency-bounded). Peer of `cw sched plan`.", {
            cwd: stringSchema("Repo workspace")
        }),
        capabilityTool("sched.lease", "Claim eligible queue entries as leases; never exceeds the concurrency ceiling. Peer of `cw sched lease`.", {
            cwd: stringSchema("Repo workspace"),
            limit: stringSchema("Max leases to grant")
        }),
        capabilityTool("sched.release", "Release a held lease; failed=true increments attempts (retry/backoff or park). Peer of `cw sched release`.", {
            cwd: stringSchema("Repo workspace"),
            leaseId: stringSchema("Lease id"),
            failed: stringSchema("true to count a failed attempt"),
            reason: stringSchema("Release reason")
        }),
        capabilityTool("sched.complete", "Complete a held lease (terminal success). Peer of `cw sched complete`.", {
            cwd: stringSchema("Repo workspace"),
            leaseId: stringSchema("Lease id")
        }),
        capabilityTool("sched.reclaim", "Reclaim expired leases (host died); each counts one failed attempt. Peer of `cw sched reclaim`.", {
            cwd: stringSchema("Repo workspace")
        }),
        capabilityTool("sched.reset", "Reset a parked entry back to ready (operator recovery; the only way back). Peer of `cw sched reset`.", {
            cwd: stringSchema("Repo workspace"),
            id: stringSchema("Queue entry id")
        }),
        capabilityTool("sched.policy.show", "Show the scheduling policy (file or conservative default). Peer of `cw sched policy show`.", {
            cwd: stringSchema("Repo workspace")
        }),
        capabilityTool("sched.policy.set", "Set scheduling policy fields (concurrency, attempts, lease TTL, backoff). Peer of `cw sched policy set`.", {
            cwd: stringSchema("Repo workspace"),
            maxConcurrent: stringSchema("Hard concurrency ceiling"),
            maxAttempts: stringSchema("Retry budget before park"),
            leaseTtlMs: stringSchema("Lease TTL (ms)"),
            backoffBaseMs: stringSchema("Backoff base (ms)"),
            backoffFactor: stringSchema("Backoff factor"),
            backoffCapMs: stringSchema("Backoff cap (ms)")
        }),
        capabilityTool("gc.plan", "Read-only dry-run of run reclamation: eligible runs, per-kind bytes that WOULD be freed, and the capability downgrade. Frees NOTHING. Peer of `cw gc plan`.", {
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("home (default, cross-repo) or repo"),
            runId: stringSchema("Plan a single run (optional)"),
            reclaimAfterArchiveDays: stringSchema("Only reclaim runs archived at least this many days"),
            keepScratch: stringSchema("true to retain worker scratch"),
            keepSnapshots: stringSchema("true to retain node snapshots")
        }),
        capabilityTool("gc.run", "Execute the write-ahead reclamation transaction (skeleton -> tombstone -> fsync -> free) for eligible runs. Bounded, fail-closed. Peer of `cw gc run`.", {
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("home (default, cross-repo) or repo"),
            runId: stringSchema("Reclaim a single run (optional)"),
            reclaimAfterArchiveDays: stringSchema("Only reclaim runs archived at least this many days"),
            keepScratch: stringSchema("true to retain worker scratch"),
            keepSnapshots: stringSchema("true to retain node snapshots"),
            limit: stringSchema("Max runs to reclaim in this pass"),
            actor: stringSchema("Operator recorded on the reclamation attestation")
        }),
        capabilityTool("gc.verify", "Re-prove a reclaimed run: skeleton schema-complete, tombstone chain untampered, reconstructable artifacts re-derived from retained inputs. Peer of `cw gc verify`.", {
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("home (default, cross-repo) or repo"),
            runId: stringSchema("Run id to verify")
        }),
        capabilityTool("telemetry.verify", "Re-prove a run's telemetry attestation ledger offline: prevHash chain linkage + independent per-record hash recompute (never trusts the stored hash), and optionally re-run ed25519 checks with a public key. A forged or edited record fails it. Peer of `cw telemetry verify`.", {
            cwd: stringSchema("Repo workspace"),
            runId: stringSchema("Run id to verify"),
            pubkey: stringSchema("Optional inline PEM or path to a public key for re-checking attested signatures")
        }),
        capabilityTool("history", "Read a cross-repo unified run timeline (newest first), deterministic and paginated, with provenance links.", {
            cwd: stringSchema("Repo workspace"),
            scope: stringSchema("home (default, cross-repo) or repo"),
            app: stringSchema("App or workflow id filter"),
            status: stringSchema("Lifecycle status filter"),
            limit: numberSchema("Page size (default 50)"),
            offset: numberSchema("Page offset (default 0)")
        })
    ];
}
function runIdCapabilityTools(capabilityIds) {
    return capabilityIds.map((capabilityId) => capabilityTool(capabilityId, runIdSchema()));
}
function capabilityTool(capabilityId, descriptionOrProperties, maybeProperties) {
    if (typeof descriptionOrProperties === "string") {
        return (0, capability_registry_1.mcpToolDefinition)(capabilityId, descriptionOrProperties, maybeProperties ?? {});
    }
    return (0, capability_registry_1.mcpToolDefinition)(capabilityId, descriptionOrProperties);
}
function stringSchema(description) {
    return { type: "string", description };
}
function numberSchema(description) {
    return { type: "number", description };
}
function booleanSchema(description) {
    return { type: "boolean", description };
}
function objectSchema(description) {
    return { type: "object", description, additionalProperties: true };
}
function arraySchema(description) {
    return { type: "array", description, items: {} };
}
function runIdSchema() {
    return {
        runId: stringSchema("Run id"),
        cwd: stringSchema("Run workspace")
    };
}
function workerIdSchema() {
    return {
        ...runIdSchema(),
        workerId: stringSchema("Worker id")
    };
}
function candidateIdSchema() {
    return {
        ...runIdSchema(),
        candidateId: stringSchema("Candidate id")
    };
}
function collaborationTargetSchema() {
    return {
        targetKind: stringSchema("Target kind: run|task|candidate|selection|commit|node"),
        targetId: stringSchema("Target id")
    };
}
function actorSchema() {
    return {
        actor: stringSchema("Actor id (absent => unattributed)"),
        actorKind: stringSchema("Actor kind: operator|worker|role|membership|group|host|service"),
        role: stringSchema("Authorizing role id/title"),
        displayName: stringSchema("Actor display name"),
        attested: booleanSchema("Host attests this identity's provenance"),
        attestation: stringSchema("Attestation: host-attested|operator-recorded")
    };
}
