"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callTool = callTool;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const orchestrator_1 = require("../orchestrator");
const ledger_1 = require("../ledger");
const scheduler_1 = require("../scheduler");
const triggers_1 = require("../triggers");
const workbench_1 = require("../workbench");
const capability_core_1 = require("../capability-core");
const baseRunner = new orchestrator_1.CoolWorkflowRunner({
    pluginRoot: node_path_1.default.resolve(__dirname, "../..")
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
    const cwd = resolveInvocationCwd(args);
    if (cwd)
        args = { ...args, cwd };
    const runner = baseRunner.withBaseDir(cwd);
    const workCwd = cwd || process.cwd();
    const scheduler = new scheduler_1.Scheduler(workCwd);
    const triggers = new triggers_1.RoutineTriggerBridge(workCwd);
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
        // ---- Cross-agent handoff ledger (stage 2 MCP surface) ----
        case "cw_ledger_propose":
            return (0, ledger_1.buildLedgerProposal)({
                from: String(args.from || ""),
                to: String(args.to || ""),
                title: String(args.title || ""),
                rationale: String(args.rationale || ""),
                targetFiles: String(args.files || "").split(",").map((f) => f.trim()).filter(Boolean),
                suggestedDiff: args.diff === undefined ? undefined : String(args.diff),
                createdAt: new Date().toISOString()
            });
        case "cw_ledger_review": {
            const verdict = String(args.verdict || "").toUpperCase();
            if (verdict !== "APPROVED" && verdict !== "REJECTED")
                throw new Error('verdict must be "approved" or "rejected".');
            return (0, ledger_1.buildLedgerReview)({
                from: String(args.from || ""),
                to: String(args.to || ""),
                target: String(args.target || ""),
                verdict,
                findings: String(args.findings || "").split(",").map((f) => f.trim()).filter(Boolean),
                createdAt: new Date().toISOString()
            });
        }
        case "cw_ledger_verify":
            return (0, ledger_1.verifyLedgerEntry)(args.entry);
        case "cw_ledger_list":
            return (0, ledger_1.listLedgerEntries)(String(args.dir || ""));
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
        case "cw_run_restore":
            return (0, capability_core_1.runRestoreArchive)(runner, args);
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
        case "cw_clones_list":
            return (0, capability_core_1.listClones)(args);
        case "cw_clones_gc":
            return (0, capability_core_1.gcClones)(args);
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
function resolveInvocationCwd(args) {
    const value = (0, capability_core_1.optionalString)(args.cwd);
    if (!value)
        return undefined;
    const resolved = node_path_1.default.resolve(value);
    if (!node_fs_1.default.statSync(resolved).isDirectory())
        throw new Error(`MCP cwd is not a directory: ${resolved}`);
    return resolved;
}
