#!/usr/bin/env node
import path from "node:path";
import { CoolWorkflowRunner } from "./orchestrator";
import { Scheduler } from "./scheduler";
import { RoutineTriggerBridge } from "./triggers";
import { CURRENT_COOL_WORKFLOW_VERSION } from "./version";
import {
  appRun,
  commitEnvelope,
  isRecord,
  optionalString,
  planSummary,
  queueAdd,
  queueDrain,
  queueList,
  queueShow,
  runArchive,
  runHistory,
  runList,
  runRegistryFor,
  runRegistryRefresh,
  runRegistryShow,
  runRerun,
  runResume,
  runSearch,
  runShow,
  sandboxChoose
} from "./capability-core";

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

const runner = new CoolWorkflowRunner({
  pluginRoot: path.resolve(__dirname, "..")
});

process.stdin.setEncoding("utf8");
let buffer = "";

process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newlineIndex: number;
  while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) handleLine(line);
  }
});

function handleLine(line: string): void {
  let message: JsonRpcRequest;
  try {
    message = JSON.parse(line) as JsonRpcRequest;
  } catch (error) {
    sendError(null, -32700, `Parse error: ${messageOf(error)}`);
    return;
  }
  try {
    if (message.method === "initialize") {
      sendResult(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "cool-workflow", version: CURRENT_COOL_WORKFLOW_VERSION }
      });
      return;
    }
    if (message.method === "tools/list") {
      sendResult(message.id, { tools: toolDefinitions() });
      return;
    }
    if (message.method === "tools/call") {
      const toolName = requiredToolName(message.params?.name);
      const toolArgs = requiredToolArguments(toolName, message.params?.arguments);
      const result = callTool(toolName, toolArgs);
      sendResult(message.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      });
      return;
    }
    if (message.id !== undefined) sendError(message.id, -32601, `Unknown method: ${message.method}`);
  } catch (error) {
    sendError(message.id, -32000, messageOf(error));
  }
}

function callTool(name: string, args: Record<string, unknown>): unknown {
  const previousCwd = process.cwd();
  if (args.cwd) process.chdir(String(args.cwd));
  const scheduler = new Scheduler(process.cwd());
  const triggers = new RoutineTriggerBridge(process.cwd());
  try {
    switch (name) {
      case "cw_list":
        return runner.listWorkflows();
      case "cw_plan":
        return planSummary(runner, String(args.workflowId || ""), args);
      case "cw_app_run":
        return appRun(runner, args);
      case "cw_status":
        return runner.status(String(args.runId || ""));
      case "cw_init":
        return runner.init(String(args.workflowId || ""), args);
      case "cw_next":
        return runner.next(String(args.runId || ""), args);
      case "cw_state_check":
        return runner.checkState(String(args.runId || ""), args);
      case "cw_contract_show":
        return runner.showContract(String(args.runId || ""), optionalString(args.contractId));
      case "cw_node_list":
        return runner.listNodes(String(args.runId || ""));
      case "cw_node_show":
        return runner.showNode(String(args.runId || ""), String(args.nodeId || ""));
      case "cw_node_graph":
        return runner.graphNodes(String(args.runId || ""));
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
        return runner.hostMultiAgentRun(optionalString(args.runId), args);
      case "cw_multi_agent_status":
        return runner.hostMultiAgentStatus(String(args.runId || ""));
      case "cw_multi_agent_step":
        return runner.hostMultiAgentStep(String(args.runId || ""), args);
      case "cw_multi_agent_blackboard":
        return runner.hostMultiAgentBlackboard(String(args.runId || ""), optionalString(args.action || args.operation), args);
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
        if (args.runId && (args.topologyRunId || args.id)) return runner.showTopologyRun(String(args.runId || ""), String(args.topologyRunId || args.id || ""));
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
        return sandboxChoose(runner, args);
      case "cw_result":
        return runner.recordResult(String(args.runId || ""), String(args.taskId || ""), String(args.resultPath || ""));
      case "cw_commit":
        return commitEnvelope(runner, String(args.runId || ""), args);
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
        return runner.recordWorkerOutput(String(args.runId || ""), String(args.workerId || ""), String(args.resultPath || ""));
      case "cw_worker_fail":
        return runner.recordWorkerFailure(
          String(args.runId || ""),
          String(args.workerId || ""),
          String(args.message || ""),
          args
        );
      case "cw_worker_validate":
        return runner.validateWorker(String(args.runId || ""), String(args.workerId || ""), optionalString(args.path || args.resultPath));
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
        return runRegistryRefresh(runRegistryFor(args, runner), args);
      case "cw_registry_show":
        return runRegistryShow(runRegistryFor(args, runner), args);
      case "cw_run_search":
        return runSearch(runRegistryFor(args, runner), args);
      case "cw_run_list":
        return runList(runRegistryFor(args, runner), args);
      case "cw_run_show":
        return runShow(runRegistryFor(args, runner), String(args.runId || ""), args);
      case "cw_run_resume":
        return runResume(runRegistryFor(args, runner), String(args.runId || ""), args);
      case "cw_run_archive":
        return runArchive(runRegistryFor(args, runner), optionalString(args.runId), args);
      case "cw_run_rerun":
        return runRerun(runRegistryFor(args, runner), String(args.runId || ""), args);
      case "cw_queue_add":
        return queueAdd(runRegistryFor(args, runner), args);
      case "cw_queue_list":
        return queueList(runRegistryFor(args, runner), args);
      case "cw_queue_drain":
        return queueDrain(runRegistryFor(args, runner), args);
      case "cw_queue_show":
        return queueShow(runRegistryFor(args, runner), String(args.id || ""));
      case "cw_history":
        return runHistory(runRegistryFor(args, runner), args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } finally {
    process.chdir(previousCwd);
  }
}

function requiredToolName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("MCP tools/call missing required field: name");
  return value;
}

function requiredToolArguments(name: string, value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) value = {};
  if (!isRecord(value)) throw new Error(`MCP tool ${name} arguments must be an object.`);
  const args = value as Record<string, unknown>;
  for (const group of requiredArgsForTool(name)) {
    const keys = group.split("|");
    if (!keys.some((key) => args[key] !== undefined && args[key] !== null && args[key] !== "")) {
      throw new Error(`MCP tool ${name} missing required argument: ${keys.join(" or ")}`);
    }
  }
  return args;
}

function requiredArgsForTool(name: string): string[] {
  if (name === "cw_plan" || name === "cw_init") return ["workflowId"];
  if (name === "cw_app_run") return ["appId"];
  if (name === "cw_node_show") return ["runId", "nodeId"];
  if (name === "cw_eval_replay") return ["snapshot|snapshotId|path"];
  if (name === "cw_eval_compare") return ["baseline|baselinePath", "replay|replayPath"];
  if (name === "cw_eval_score" || name === "cw_eval_report") return ["replay|replayPath|path"];
  if (name === "cw_eval_gate") return ["suite|suiteId|path"];
  if (name === "cw_topology_show" || name === "cw_topology_validate") return ["topologyId|id"];
  if (name === "cw_topology_apply") return ["runId", "topologyId|id"];
  if (name === "cw_sandbox_show") return ["profileId"];
  if (name === "cw_sandbox_validate") return ["profileFile"];
  if (name === "cw_schedule_delete" || name === "cw_schedule_complete" || name === "cw_schedule_pause" || name === "cw_schedule_resume" || name === "cw_schedule_run_now") return ["id"];
  if (name === "cw_routine_delete") return ["id"];
  if (name === "cw_routine_fire") return ["kind"];
  if (name === "cw_run_show" || name === "cw_run_resume" || name === "cw_run_rerun") return ["runId"];
  if (name === "cw_run_archive") return ["runId|olderThanDays"];
  if (name === "cw_queue_show") return ["id"];
  if (name.endsWith("_show")) {
    if (name.includes("_role_")) return ["runId", "roleId"];
    if (name.includes("_group_")) return ["runId", "groupId"];
    if (name.includes("_membership_")) return ["runId", "membershipId"];
    if (name.includes("_fanout_")) return ["runId", "fanoutId"];
    if (name.includes("_fanin_")) return ["runId", "faninId"];
    if (name.includes("_candidate_")) return ["runId", "candidateId"];
    if (name.includes("_feedback_")) return ["runId", "feedbackId"];
    if (name.includes("_worker_")) return ["runId", "workerId"];
  }
  if (name.startsWith("cw_") && [
    "cw_status",
    "cw_next",
    "cw_state_check",
    "cw_contract_show",
    "cw_node_list",
    "cw_node_graph",
    "cw_operator_status",
    "cw_operator_graph",
    "cw_operator_report",
    "cw_worker_summary",
    "cw_candidate_summary",
    "cw_feedback_summary",
    "cw_commit_summary",
    "cw_multi_agent_summary",
    "cw_multi_agent_graph",
    "cw_multi_agent_dependencies",
    "cw_multi_agent_failures",
    "cw_multi_agent_evidence",
    "cw_evidence_reasoning",
    "cw_evidence_reasoning_refresh",
    "cw_summary_refresh",
    "cw_summary_show",
    "cw_blackboard_summarize",
    "cw_multi_agent_summarize",
    "cw_multi_agent_graph_compact",
    "cw_multi_agent_status",
    "cw_multi_agent_step",
    "cw_multi_agent_blackboard",
    "cw_multi_agent_score",
    "cw_multi_agent_select",
    "cw_eval_snapshot",
    "cw_multi_agent_run_create",
    "cw_multi_agent_run_transition",
    "cw_multi_agent_run_show",
    "cw_multi_agent_role_create",
    "cw_multi_agent_group_create",
    "cw_multi_agent_membership_create",
    "cw_multi_agent_fanout_create",
    "cw_multi_agent_fanin_collect",
    "cw_topology_summary",
    "cw_topology_graph",
    "cw_blackboard_summary",
    "cw_blackboard_graph",
    "cw_blackboard_resolve",
    "cw_blackboard_topic_create",
    "cw_blackboard_message_post",
    "cw_blackboard_message_list",
    "cw_blackboard_context_put",
    "cw_blackboard_artifact_add",
    "cw_blackboard_artifact_list",
    "cw_blackboard_snapshot",
    "cw_coordinator_summary",
    "cw_coordinator_decision",
    "cw_audit_summary",
    "cw_audit_worker",
    "cw_audit_provenance",
    "cw_audit_multi_agent",
    "cw_audit_policy",
    "cw_audit_role",
    "cw_audit_blackboard",
    "cw_audit_judge",
    "cw_audit_attest",
    "cw_audit_decision",
    "cw_dispatch",
    "cw_result",
    "cw_commit",
    "cw_report",
    "cw_worker_list",
    "cw_worker_manifest",
    "cw_worker_output",
    "cw_worker_fail",
    "cw_worker_validate",
    "cw_candidate_list",
    "cw_candidate_register",
    "cw_candidate_score",
    "cw_candidate_rank",
    "cw_candidate_select",
    "cw_candidate_reject",
    "cw_feedback_list",
    "cw_feedback_collect",
    "cw_feedback_task",
    "cw_feedback_resolve"
  ].includes(name)) return ["runId"];
  return [];
}

function toolDefinitions(): unknown[] {
  return [
    tool("cw_list", "List bundled CW workflows.", {}),
    tool("cw_plan", "Create a CW run.", {
      workflowId: stringSchema("Workflow id"),
      repo: stringSchema("Repository path"),
      question: stringSchema("User question")
    }),
    tool("cw_app_run", "Create a CW run from a Workflow App SDK app id and structured inputs.", {
      cwd: stringSchema("Workspace"),
      appId: stringSchema("Workflow app id"),
      inputs: objectSchema("Workflow app inputs such as repo, question, version, source, or dryRun"),
      sandbox: stringSchema("Optional sandbox profile id to validate for this run"),
      sandboxProfile: stringSchema("Optional sandbox profile id to validate for this run"),
      sandboxProfileId: stringSchema("Optional sandbox profile id to validate for this run")
    }),
    tool("cw_status", "Read run checkpoint status.", {
      runId: stringSchema("Run id"),
      cwd: stringSchema("Run workspace")
    }),
    tool("cw_init", "Scaffold a new workflow definition. Peer of `cw init`.", {
      workflowId: stringSchema("Workflow id"),
      title: stringSchema("Workflow title"),
      output: stringSchema("Output directory")
    }),
    tool("cw_next", "Read the next recommended tasks for a run. Peer of `cw next`.", {
      ...runIdSchema(),
      limit: numberSchema("Maximum tasks to return")
    }),
    tool("cw_state_check", "Check run-state schema compatibility. Peer of `cw state check`.", {
      ...runIdSchema(),
      state: stringSchema("Explicit state file path"),
      write: booleanSchema("Persist a migrated copy when supported")
    }),
    tool("cw_contract_show", "Show a run's pipeline contract. Peer of `cw contract show`.", {
      ...runIdSchema(),
      contractId: stringSchema("Optional contract id")
    }),
    tool("cw_node_list", "List state nodes for a run. Peer of `cw node list`.", runIdSchema()),
    tool("cw_node_show", "Show one state node for a run. Peer of `cw node show`.", {
      ...runIdSchema(),
      nodeId: stringSchema("Node id")
    }),
    tool("cw_node_graph", "Read the state-node graph for a run. Peer of `cw node graph`.", runIdSchema()),
    tool("cw_operator_status", "Read the structured Operator UX run status.", runIdSchema()),
    tool("cw_operator_graph", "Read the structured Operator UX run graph.", runIdSchema()),
    tool("cw_operator_report", "Refresh and read the structured Operator UX report summary.", runIdSchema()),
    tool("cw_worker_summary", "Read the structured worker summary for a run.", runIdSchema()),
    tool("cw_candidate_summary", "Read the structured candidate summary for a run.", runIdSchema()),
    tool("cw_feedback_summary", "Read the structured feedback summary for a run.", runIdSchema()),
    tool("cw_commit_summary", "Read the structured commit summary for a run.", runIdSchema()),
    tool("cw_multi_agent_summary", "Read the structured multi-agent runtime summary for a run.", runIdSchema()),
    tool("cw_multi_agent_graph", "Read the structured multi-agent operator graph for a run.", runIdSchema()),
    tool("cw_multi_agent_dependencies", "Read derived multi-agent dependency edges for operator inspection.", runIdSchema()),
    tool("cw_multi_agent_failures", "Read failed, blocked, rejected, and ambiguous multi-agent records.", runIdSchema()),
    tool("cw_multi_agent_evidence", "Read evidence adoption status from worker output through selection and commit. Each row carries a derived rationaleStatus (explained|unexplained|not-applicable).", runIdSchema()),
    tool("cw_evidence_reasoning", "Explain WHY each evidence item was adopted/rejected/superseded/conflicting: a derived, fingerprinted reasoning chain with decision, basis, authority, rationale, and counterfactual per gate (fanin, candidate-score, selection, verifier, commit). Fails closed to `unexplained` when a rationale cannot be traced. Reads valid|stale|absent freshness against current source state.", {
      ...runIdSchema(),
      evidence: stringSchema("Optional evidence id/ref to explain a single adoption"),
      refresh: stringSchema("Set to refresh the durable reasoning index before reading")
    }),
    tool("cw_evidence_reasoning_refresh", "Refresh the durable, versioned, provenance-backed Evidence Adoption Reasoning Chain index under .cw/runs/<id>/reasoning/ (index.json + per-chain records) without mutating raw state.", runIdSchema()),
    tool("cw_summary_refresh", "Refresh durable, versioned, provenance-backed state-explosion summaries (blackboard digest, compact graph views, operator digest) without deleting raw records. Response includes source refs and expansion hints.", {
      ...runIdSchema(),
      cwd: stringSchema("Run workspace"),
      view: arraySchema("Optional graph views to materialize (full, compact, critical-path, failures, evidence, trust, topology, blackboard, candidate, commit-gate)")
    }),
    tool("cw_summary_show", "Read the persisted state-explosion report and detect stale or missing summaries against current source state. Fails closed (status=stale) when source records changed.", runIdSchema()),
    tool("cw_blackboard_summarize", "Read a deterministic blackboard digest (topic rollups, threads, conflicts, decisions, missing evidence, judge rationale) with source refs preserved.", {
      ...runIdSchema(),
      blackboardId: stringSchema("Optional blackboard id; omitted when unambiguous")
    }),
    tool("cw_multi_agent_summarize", "Read the combined state-explosion report (state size, compact graph, blackboard digest, critical path, failures, evidence, trust digest, hidden source records, expansion commands).", runIdSchema()),
    tool("cw_multi_agent_graph_compact", "Read a compact or focused multi-agent graph view with synthetic summary nodes that expose collapsed counts, dominant status, blocked reason, and an expansion command.", {
      ...runIdSchema(),
      view: stringSchema("full, compact, critical-path, failures, evidence, trust, topology, blackboard, candidate, or commit-gate"),
      focus: stringSchema("Optional node id to center the view on"),
      depth: numberSchema("Neighborhood depth when focusing, defaults to 1")
    }),
    tool("cw_multi_agent_run", "Preferred host API: create or attach a high-level multi-agent run from an app/workflow run and topology without dispatching workers.", {
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
    tool("cw_multi_agent_status", "Preferred host API: read combined topology, multi-agent, blackboard, worker, candidate, commit, and audit status.", runIdSchema()),
    tool("cw_multi_agent_step", "Preferred host API: perform one deterministic safe step without spawning agents.", {
      ...runIdSchema(),
      sandbox: stringSchema("Sandbox profile for any dispatch manifest created by this step"),
      limit: numberSchema("Maximum dispatch tasks, defaults to 1")
    }),
    tool("cw_multi_agent_blackboard", "Preferred host API: operate on the active multi-agent blackboard while preserving provenance.", {
      ...runIdSchema(),
      action: stringSchema("summary, topics, messages, post, artifacts, add-artifact, context, or snapshot"),
      blackboardId: stringSchema("Optional blackboard id; omitted only when unambiguous"),
      topicId: stringSchema("Optional topic id; omitted only when unambiguous"),
      body: stringSchema("Message or context body"),
      kind: stringSchema("Artifact or context kind"),
      path: stringSchema("Artifact path"),
      evidence: arraySchema("Evidence refs")
    }),
    tool("cw_multi_agent_score", "Preferred host API: score a candidate with evidence; never selects automatically.", {
      ...runIdSchema(),
      candidate: stringSchema("Candidate id"),
      candidateId: stringSchema("Alias for candidate"),
      worker: stringSchema("Optional worker id to register as a candidate first"),
      criterion: arraySchema("Score criteria as name=value"),
      criteria: objectSchema("Structured score criteria"),
      evidence: arraySchema("Required evidence refs"),
      maxTotal: numberSchema("Optional max total")
    }),
    tool("cw_multi_agent_select", "Preferred host API: select a scored candidate only when verifier and score gates pass.", {
      ...runIdSchema(),
      candidate: stringSchema("Candidate id"),
      candidateId: stringSchema("Alias for candidate"),
      score: stringSchema("Optional score id"),
      scoreId: stringSchema("Alias for score"),
      reason: stringSchema("Acceptance rationale"),
      allowUnverified: booleanSchema("Explicitly bypass verifier gate")
    }),
    tool("cw_eval_snapshot", "Create a deterministic multi-agent replay snapshot for a run.", {
      ...runIdSchema(),
      cwd: stringSchema("Run workspace"),
      id: stringSchema("Snapshot or suite id")
    }),
    tool("cw_eval_replay", "Replay a multi-agent snapshot in an isolated replay directory without live agents.", {
      cwd: stringSchema("Workspace"),
      snapshot: stringSchema("Snapshot id or path"),
      snapshotId: stringSchema("Alias for snapshot"),
      path: stringSchema("Snapshot path"),
      id: stringSchema("Replay id")
    }),
    tool("cw_eval_compare", "Compare a baseline snapshot and replay run with normalized deterministic rules.", {
      cwd: stringSchema("Workspace"),
      baseline: stringSchema("Baseline snapshot id or path"),
      baselinePath: stringSchema("Baseline snapshot path"),
      replay: stringSchema("Replay run id or path"),
      replayPath: stringSchema("Replay run path")
    }),
    tool("cw_eval_score", "Score replay quality with explicit deterministic metrics.", {
      cwd: stringSchema("Workspace"),
      replay: stringSchema("Replay run id or path"),
      replayPath: stringSchema("Replay run path"),
      path: stringSchema("Replay run path")
    }),
    tool("cw_eval_gate", "Run the multi-agent eval/replay regression gate for a suite.", {
      cwd: stringSchema("Workspace"),
      suite: stringSchema("Suite id or path"),
      suiteId: stringSchema("Alias for suite"),
      path: stringSchema("Suite path")
    }),
    tool("cw_eval_report", "Render the multi-agent eval/replay report and return its path.", {
      cwd: stringSchema("Workspace"),
      replay: stringSchema("Replay run id or path"),
      replayPath: stringSchema("Replay run path"),
      path: stringSchema("Replay run path")
    }),
    tool("cw_multi_agent_run_create", "Create a MultiAgentRun state record.", {
      ...runIdSchema(),
      id: stringSchema("Optional MultiAgentRun id"),
      title: stringSchema("Short title"),
      objective: stringSchema("Objective or reason")
    }),
    tool("cw_multi_agent_run_transition", "Transition a MultiAgentRun lifecycle status.", {
      ...runIdSchema(),
      multiAgentRunId: stringSchema("MultiAgentRun id"),
      id: stringSchema("Alias for multiAgentRunId"),
      status: stringSchema("planned, forming, running, collecting, verifying, completed, failed, or cancelled"),
      reason: stringSchema("Transition reason")
    }),
    tool("cw_multi_agent_run_show", "Show one MultiAgentRun record.", {
      ...runIdSchema(),
      multiAgentRunId: stringSchema("MultiAgentRun id"),
      id: stringSchema("Alias for multiAgentRunId")
    }),
    tool("cw_multi_agent_role_create", "Create an AgentRole record.", {
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
    tool("cw_multi_agent_role_show", "Show one AgentRole record.", {
      ...runIdSchema(),
      roleId: stringSchema("AgentRole id"),
      id: stringSchema("Alias for roleId")
    }),
    tool("cw_multi_agent_group_create", "Create an AgentGroup record.", {
      ...runIdSchema(),
      id: stringSchema("Optional AgentGroup id"),
      multiAgentRunId: stringSchema("MultiAgentRun id"),
      multiAgentRun: stringSchema("Alias for multiAgentRunId"),
      title: stringSchema("Group title"),
      phase: stringSchema("Workflow phase"),
      task: arraySchema("Task ids")
    }),
    tool("cw_multi_agent_group_show", "Show one AgentGroup record.", {
      ...runIdSchema(),
      groupId: stringSchema("AgentGroup id"),
      id: stringSchema("Alias for groupId")
    }),
    tool("cw_multi_agent_membership_create", "Create an AgentMembership record.", {
      ...runIdSchema(),
      id: stringSchema("Optional AgentMembership id"),
      groupId: stringSchema("AgentGroup id"),
      roleId: stringSchema("AgentRole id"),
      taskId: stringSchema("Task id"),
      workerId: stringSchema("Optional worker id"),
      dispatchId: stringSchema("Optional dispatch id"),
      fanoutId: stringSchema("Optional fanout id")
    }),
    tool("cw_multi_agent_membership_show", "Show one AgentMembership record.", {
      ...runIdSchema(),
      membershipId: stringSchema("AgentMembership id"),
      id: stringSchema("Alias for membershipId")
    }),
    tool("cw_multi_agent_fanout_create", "Create an AgentFanout record.", {
      ...runIdSchema(),
      id: stringSchema("Optional AgentFanout id"),
      groupId: stringSchema("AgentGroup id"),
      reason: stringSchema("Why work was split"),
      role: arraySchema("Role ids"),
      task: arraySchema("Task ids"),
      limit: numberSchema("Concurrency limit"),
      sandboxChoice: arraySchema("Sandbox choices as key=value")
    }),
    tool("cw_multi_agent_fanout_show", "Show one AgentFanout record.", {
      ...runIdSchema(),
      fanoutId: stringSchema("AgentFanout id"),
      id: stringSchema("Alias for fanoutId")
    }),
    tool("cw_multi_agent_fanin_collect", "Collect AgentFanin evidence coverage and fail closed on missing role evidence.", {
      ...runIdSchema(),
      id: stringSchema("Optional AgentFanin id"),
      groupId: stringSchema("AgentGroup id"),
      fanoutId: stringSchema("Optional fanout id"),
      requiredRole: arraySchema("Required role ids"),
      strategy: stringSchema("Aggregation strategy")
    }),
    tool("cw_multi_agent_fanin_show", "Show one AgentFanin record.", {
      ...runIdSchema(),
      faninId: stringSchema("AgentFanin id"),
      id: stringSchema("Alias for faninId")
    }),
    tool("cw_topology_list", "List official multi-agent topology definitions.", {}),
    tool("cw_topology_show", "Show an official topology definition or a topology run when runId is provided.", {
      ...runIdSchema(),
      topologyId: stringSchema("Official topology id"),
      topologyRunId: stringSchema("Topology run id"),
      id: stringSchema("Alias for topologyId or topologyRunId")
    }),
    tool("cw_topology_validate", "Validate an official topology definition.", {
      topologyId: stringSchema("Official topology id"),
      id: stringSchema("Alias for topologyId")
    }),
    tool("cw_topology_apply", "Apply an official topology to a CW run using multi-agent and blackboard records.", {
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
    tool("cw_topology_summary", "Read topology progress and next actions for a run.", runIdSchema()),
    tool("cw_topology_graph", "Read topology graph nodes and edges for a run.", runIdSchema()),
    tool("cw_blackboard_summary", "Read blackboard/coordinator summary for a run.", runIdSchema()),
    tool("cw_blackboard_graph", "Read blackboard/coordinator graph nodes and edges.", runIdSchema()),
    tool("cw_blackboard_resolve", "Create or resolve the blackboard for a run or MultiAgentRun.", {
      ...runIdSchema(),
      id: stringSchema("Optional blackboard id"),
      title: stringSchema("Blackboard title"),
      multiAgentRunId: stringSchema("Optional MultiAgentRun id"),
      groupId: stringSchema("Optional AgentGroup id"),
      roleId: stringSchema("Optional AgentRole id"),
      membershipId: stringSchema("Optional AgentMembership id")
    }),
    tool("cw_blackboard_topic_create", "Create a blackboard topic.", {
      ...runIdSchema(),
      id: stringSchema("Optional topic id"),
      title: stringSchema("Topic title"),
      description: stringSchema("Topic description"),
      blackboardId: stringSchema("Optional blackboard id"),
      tag: arraySchema("Tags")
    }),
    tool("cw_blackboard_message_post", "Post a blackboard message.", {
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
    tool("cw_blackboard_message_list", "List blackboard messages.", {
      ...runIdSchema(),
      topic: stringSchema("Optional topic id"),
      topicId: stringSchema("Optional topic id"),
      blackboardId: stringSchema("Optional blackboard id")
    }),
    tool("cw_blackboard_context_put", "Publish a shared context frame.", {
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
    tool("cw_blackboard_artifact_add", "Index an artifact in the blackboard.", {
      ...runIdSchema(),
      id: stringSchema("Optional artifact ref id"),
      topic: stringSchema("Optional topic id"),
      kind: stringSchema("Artifact kind"),
      path: stringSchema("Local artifact path"),
      locator: stringSchema("External or logical locator"),
      source: stringSchema("Artifact source"),
      evidence: arraySchema("Evidence refs")
    }),
    tool("cw_blackboard_artifact_list", "List blackboard artifact refs.", {
      ...runIdSchema(),
      topic: stringSchema("Optional topic id"),
      blackboardId: stringSchema("Optional blackboard id")
    }),
    tool("cw_blackboard_snapshot", "Create a durable blackboard snapshot.", {
      ...runIdSchema(),
      blackboardId: stringSchema("Optional blackboard id")
    }),
    tool("cw_coordinator_summary", "Read coordinator summary for a run.", runIdSchema()),
    tool("cw_coordinator_decision", "Record a coordinator decision.", {
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
    tool("cw_audit_summary", "Read durable trust/audit summary for a run.", runIdSchema()),
    tool("cw_audit_worker", "Read trust/audit events for one worker.", workerIdSchema()),
    tool("cw_audit_provenance", "Inspect evidence provenance for a run, worker, candidate, or commit.", {
      ...runIdSchema(),
      workerId: stringSchema("Optional worker id"),
      worker: stringSchema("Optional worker id"),
      candidateId: stringSchema("Optional candidate id"),
      candidate: stringSchema("Optional candidate id"),
      commitId: stringSchema("Optional commit id"),
      commit: stringSchema("Optional commit id")
    }),
    tool("cw_audit_multi_agent", "Read multi-agent trust, policy, blackboard write, provenance, judge, and violation audit projections.", runIdSchema()),
    tool("cw_audit_policy", "Read role policies, permission decisions, and policy violations for a run.", runIdSchema()),
    tool("cw_audit_role", "Read policy and audit events for one multi-agent role.", {
      ...runIdSchema(),
      roleId: stringSchema("Agent role id"),
      id: stringSchema("Agent role id")
    }),
    tool("cw_audit_blackboard", "Read blackboard write audit and message provenance for a run.", runIdSchema()),
    tool("cw_audit_judge", "Read judge rationale and panel decision audit records for a run.", runIdSchema()),
    tool("cw_audit_attest", "Record a host/operator sandbox attestation without storing secrets.", {
      ...runIdSchema(),
      workerId: stringSchema("Optional worker id"),
      worker: stringSchema("Optional worker id"),
      actor: stringSchema("Host/operator actor"),
      hostEnforced: booleanSchema("Whether the host says enforcement was active"),
      env: arraySchema("Environment variable names only"),
      note: stringSchema("Short attestation note")
    }),
    tool("cw_audit_decision", "Validate and record a sandbox path/command/network/env decision.", {
      ...workerIdSchema(),
      path: stringSchema("Path to validate"),
      command: stringSchema("Command to validate"),
      network: stringSchema("Network target to validate"),
      env: stringSchema("Environment variable name to validate"),
      kind: stringSchema("sandbox.path, sandbox.command, sandbox.network, or sandbox.env")
    }),
    tool("cw_dispatch", "Create a subagent dispatch manifest.", {
      runId: stringSchema("Run id"),
      cwd: stringSchema("Run workspace"),
      limit: numberSchema("Max tasks to dispatch"),
      sandbox: stringSchema("Sandbox profile id"),
      sandboxProfile: stringSchema("Sandbox profile id"),
      sandboxProfileId: stringSchema("Sandbox profile id")
    }),
    tool("cw_sandbox_list", "List bundled sandbox profiles.", {
      cwd: stringSchema("Workspace used to resolve profile paths")
    }),
    tool("cw_sandbox_show", "Show a resolved sandbox profile.", {
      cwd: stringSchema("Workspace used to resolve profile paths"),
      profileId: stringSchema("Sandbox profile id")
    }),
    tool("cw_sandbox_validate", "Validate a sandbox profile JSON file.", {
      cwd: stringSchema("Workspace used to resolve profile paths"),
      profileFile: stringSchema("Sandbox profile JSON file")
    }),
    tool("cw_sandbox_choose", "Resolve and validate a sandbox profile without dispatching work.", {
      cwd: stringSchema("Workspace used to resolve profile paths"),
      profileId: stringSchema("Sandbox profile id"),
      sandbox: stringSchema("Sandbox profile id"),
      sandboxProfile: stringSchema("Sandbox profile id"),
      sandboxProfileId: stringSchema("Sandbox profile id")
    }),
    tool("cw_sandbox_resolve", "Alias for cw_sandbox_choose.", {
      cwd: stringSchema("Workspace used to resolve profile paths"),
      profileId: stringSchema("Sandbox profile id"),
      sandbox: stringSchema("Sandbox profile id"),
      sandboxProfile: stringSchema("Sandbox profile id"),
      sandboxProfileId: stringSchema("Sandbox profile id")
    }),
    tool("cw_result", "Record a subagent result.", {
      runId: stringSchema("Run id"),
      taskId: stringSchema("Task id"),
      resultPath: stringSchema("Result markdown path"),
      cwd: stringSchema("Run workspace")
    }),
    tool("cw_commit", "Create a verifier-gated commit or explicit checkpoint.", {
      runId: stringSchema("Run id"),
      reason: stringSchema("Commit reason"),
      verifier: stringSchema("Verified verifier node id"),
      verifierNode: stringSchema("Verified verifier node id"),
      candidate: stringSchema("Verified candidate id"),
      selection: stringSchema("Verified candidate selection id"),
      allowUnverifiedCheckpoint: { type: "boolean", description: "Write a non-gated checkpoint instead of committed state" },
      cwd: stringSchema("Run workspace")
    }),
    tool("cw_report", "Render a run report.", {
      runId: stringSchema("Run id"),
      cwd: stringSchema("Run workspace")
    }),
    tool("cw_app_list", "List CW workflow apps and legacy workflow files.", {
      cwd: stringSchema("Workspace")
    }),
    tool("cw_app_show", "Show a CW workflow app contract.", {
      cwd: stringSchema("Workspace"),
      appId: stringSchema("Workflow app id")
    }),
    tool("cw_app_validate", "Validate a CW workflow app by path or id.", {
      cwd: stringSchema("Workspace"),
      target: stringSchema("Workflow app path or id")
    }),
    tool("cw_app_init", "Create a CW workflow app directory.", {
      cwd: stringSchema("Workspace"),
      appId: stringSchema("Workflow app id"),
      title: stringSchema("Workflow app title"),
      directory: stringSchema("Destination directory")
    }),
    tool("cw_app_package", "Package a CW workflow app as a JSON artifact.", {
      cwd: stringSchema("Workspace"),
      appId: stringSchema("Workflow app id"),
      output: stringSchema("Output package path")
    }),
    tool("cw_worker_list", "List worker isolation scopes for a run.", {
      ...runIdSchema(),
      status: stringSchema("Optional worker status filter")
    }),
    tool("cw_worker_show", "Show one worker isolation scope.", workerIdSchema()),
    tool("cw_worker_manifest", "Write and return one worker manifest.", workerIdSchema()),
    tool("cw_worker_output", "Record worker output from a result markdown path.", {
      ...workerIdSchema(),
      resultPath: stringSchema("Worker result markdown path")
    }),
    tool("cw_worker_fail", "Record a structured worker failure.", {
      ...workerIdSchema(),
      message: stringSchema("Failure message"),
      code: stringSchema("Failure code"),
      path: stringSchema("Related file path"),
      retryable: booleanSchema("Whether the failure can be retried")
    }),
    tool("cw_worker_validate", "Validate a worker output path against its sandbox boundary.", {
      ...workerIdSchema(),
      path: stringSchema("Path to validate"),
      resultPath: stringSchema("Result path to validate")
    }),
    tool("cw_candidate_list", "List candidates for a run.", {
      ...runIdSchema(),
      status: stringSchema("Optional candidate status filter"),
      kind: stringSchema("Optional candidate kind filter")
    }),
    tool("cw_candidate_show", "Show one candidate.", candidateIdSchema()),
    tool("cw_candidate_register", "Register a candidate from worker, task, or result evidence.", {
      ...runIdSchema(),
      id: stringSchema("Optional candidate id"),
      kind: stringSchema("Candidate kind"),
      worker: stringSchema("Worker id"),
      task: stringSchema("Task id"),
      resultNode: stringSchema("Result node id"),
      verifierNode: stringSchema("Verifier node id"),
      resultPath: stringSchema("Result markdown path")
    }),
    tool("cw_candidate_score", "Score a candidate with structured criteria and evidence locators.", {
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
    tool("cw_candidate_rank", "Rank candidates with evidence and verifier gate policy.", {
      ...runIdSchema(),
      includeRejected: booleanSchema("Include rejected candidates"),
      minNormalized: numberSchema("Minimum normalized score"),
      requireEvidence: booleanSchema("Require score evidence"),
      requireVerifierGate: booleanSchema("Require verified verifier node"),
      tieBreaker: stringSchema("Tie breaker policy")
    }),
    tool("cw_candidate_select", "Select a candidate with verifier-gated policy.", {
      ...candidateIdSchema(),
      reason: stringSchema("Selection reason"),
      selectedBy: stringSchema("Selector id"),
      by: stringSchema("Alias for selectedBy"),
      score: stringSchema("Score id"),
      allowUnverified: booleanSchema("Allow selection without a verifier gate"),
      minNormalized: numberSchema("Minimum normalized score"),
      requireVerifierGate: booleanSchema("Require verified verifier node")
    }),
    tool("cw_candidate_reject", "Reject a candidate with a durable reason.", {
      ...candidateIdSchema(),
      reason: stringSchema("Rejection reason")
    }),
    tool("cw_feedback_list", "List run feedback records.", {
      runId: stringSchema("Run id"),
      cwd: stringSchema("Run workspace"),
      status: stringSchema("Optional status filter")
    }),
    tool("cw_feedback_show", "Show a run feedback record.", {
      runId: stringSchema("Run id"),
      feedbackId: stringSchema("Feedback id"),
      cwd: stringSchema("Run workspace")
    }),
    tool("cw_feedback_collect", "Collect feedback from failed state nodes.", {
      runId: stringSchema("Run id"),
      cwd: stringSchema("Run workspace")
    }),
    tool("cw_feedback_task", "Create a correction task for a feedback record.", {
      runId: stringSchema("Run id"),
      feedbackId: stringSchema("Feedback id"),
      cwd: stringSchema("Run workspace"),
      verify: stringSchema("Expected verification command")
    }),
    tool("cw_feedback_resolve", "Resolve or reject a feedback record.", {
      runId: stringSchema("Run id"),
      feedbackId: stringSchema("Feedback id"),
      cwd: stringSchema("Run workspace"),
      node: stringSchema("Verified or committed node id"),
      status: stringSchema("resolved or rejected")
    }),
    tool("cw_schedule_create", "Create a scheduled CW task.", {
      cwd: stringSchema("Workspace"),
      kind: stringSchema("loop, cron, or reminder"),
      prompt: stringSchema("Prompt to run"),
      intervalMinutes: numberSchema("Loop interval in minutes"),
      cron: stringSchema("5-field cron expression"),
      delayMinutes: numberSchema("Reminder delay in minutes")
    }),
    tool("cw_schedule_list", "List scheduled CW tasks.", {
      cwd: stringSchema("Workspace"),
      status: stringSchema("Optional status filter")
    }),
    tool("cw_schedule_due", "List due scheduled CW tasks.", {
      cwd: stringSchema("Workspace")
    }),
    tool("cw_schedule_complete", "Mark a scheduled CW task run complete and advance it.", {
      cwd: stringSchema("Workspace"),
      id: stringSchema("Schedule id")
    }),
    tool("cw_schedule_pause", "Pause a scheduled CW task.", {
      cwd: stringSchema("Workspace"),
      id: stringSchema("Schedule id")
    }),
    tool("cw_schedule_resume", "Resume a scheduled CW task.", {
      cwd: stringSchema("Workspace"),
      id: stringSchema("Schedule id")
    }),
    tool("cw_schedule_run_now", "Create an immediate scheduled-task run record.", {
      cwd: stringSchema("Workspace"),
      id: stringSchema("Schedule id")
    }),
    tool("cw_schedule_history", "List scheduled-task run history.", {
      cwd: stringSchema("Workspace"),
      id: stringSchema("Optional schedule id")
    }),
    tool("cw_schedule_delete", "Delete a scheduled CW task.", {
      cwd: stringSchema("Workspace"),
      id: stringSchema("Schedule id")
    }),
    tool("cw_routine_create", "Create a routine-style API or GitHub trigger.", {
      cwd: stringSchema("Workspace"),
      kind: stringSchema("api or github"),
      prompt: stringSchema("Prompt to run when the trigger matches"),
      match: stringSchema("Optional JSON object match rule")
    }),
    tool("cw_routine_list", "List routine-style triggers.", {
      cwd: stringSchema("Workspace"),
      kind: stringSchema("Optional api or github filter")
    }),
    tool("cw_routine_fire", "Record an API or GitHub trigger event.", {
      cwd: stringSchema("Workspace"),
      kind: stringSchema("api or github"),
      payload: { type: "object", description: "Event payload" }
    }),
    tool("cw_routine_events", "List routine trigger events.", {
      cwd: stringSchema("Workspace"),
      id: stringSchema("Optional trigger id")
    }),
    tool("cw_routine_delete", "Delete a routine-style trigger.", {
      cwd: stringSchema("Workspace"),
      id: stringSchema("Trigger id")
    }),
    tool("cw_registry_refresh", "Recompute and persist the derived run registry index from source state.json. Registers the current repo for cross-repo discovery. Never mutates source state.", {
      cwd: stringSchema("Repo workspace"),
      scope: stringSchema("repo (default) or home (cross-repo)")
    }),
    tool("cw_registry_show", "Read the run registry index with valid|stale|absent freshness against current source state. Fails closed: tampered/missing source surfaces as stale/missing with rebuild guidance, never a fabricated status.", {
      cwd: stringSchema("Repo workspace"),
      scope: stringSchema("repo (default) or home (cross-repo)")
    }),
    tool("cw_run_search", "Search runs by app, lifecycle status, time range, repo, and free-text over metadata. Deterministic and paginated; cross-repo by default. Re-derived from source.", {
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
    tool("cw_run_list", "List indexed runs across repos (search with no filters), deterministic and paginated.", {
      cwd: stringSchema("Repo workspace"),
      scope: stringSchema("home (default, cross-repo) or repo"),
      includeArchived: booleanSchema("Include archived runs (default true)"),
      limit: numberSchema("Page size (default 50)"),
      offset: numberSchema("Page offset (default 0)")
    }),
    tool("cw_run_show", "Resolve one run by id across the registry; fail closed with found=false/freshness=missing when source state is gone (never a fabricated status).", {
      runId: stringSchema("Run id"),
      cwd: stringSchema("Repo workspace"),
      scope: stringSchema("home (default, cross-repo) or repo")
    }),
    tool("cw_run_resume", "Resolve a run by id and continue it from durable state: returns next runnable tasks and next actions. Read-only over source state.", {
      runId: stringSchema("Run id"),
      cwd: stringSchema("Repo workspace"),
      scope: stringSchema("home (default, cross-repo) or repo"),
      limit: numberSchema("Max next tasks to return (default 5)")
    }),
    tool("cw_run_archive", "Archive or unarchive a run via an overlay mark (never deletes source). With olderThanDays instead of runId, apply a retention policy. Archived runs stay searchable.", {
      runId: stringSchema("Run id to archive (omit to use a retention policy)"),
      cwd: stringSchema("Repo workspace"),
      scope: stringSchema("home (default, cross-repo) or repo"),
      reason: stringSchema("Archive reason"),
      unarchive: booleanSchema("Clear the archive overlay instead of setting it"),
      olderThanDays: numberSchema("Retention window: archive eligible runs older than N days"),
      state: stringSchema("Lifecycle states eligible for retention archiving")
    }),
    tool("cw_run_rerun", "Re-run a failed run as a NEW run that links to the original via provenance (inputs reused). The original failed run is preserved for audit.", {
      runId: stringSchema("Failed run id to rerun"),
      cwd: stringSchema("Repo workspace"),
      scope: stringSchema("home (default, cross-repo) or repo"),
      reason: stringSchema("Rerun reason")
    }),
    tool("cw_queue_add", "Enqueue a pending/planned run with explicit ordering policy (lower priority drains first). Plain files; the host still executes workers.", {
      cwd: stringSchema("Repo workspace"),
      runId: stringSchema("Optional existing planned run id"),
      appId: stringSchema("App id to run"),
      workflowId: stringSchema("Workflow id to run"),
      repo: stringSchema("Repo root that owns the run (default cwd)"),
      priority: numberSchema("Ordering priority (lower drains first, default 100)"),
      note: stringSchema("Free-text note")
    }),
    tool("cw_queue_list", "List the durable run queue in policy order (priority asc, then enqueuedAt).", {
      cwd: stringSchema("Repo workspace"),
      status: stringSchema("pending|ready|draining|drained|cancelled"),
      repo: stringSchema("Repo root filter")
    }),
    tool("cw_queue_drain", "Mark the next ready queue entries drained in policy order and return them; the host executes the workers.", {
      cwd: stringSchema("Repo workspace"),
      limit: numberSchema("How many entries to drain (default 1)"),
      repo: stringSchema("Repo root filter")
    }),
    tool("cw_queue_show", "Show one durable queue entry.", {
      cwd: stringSchema("Repo workspace"),
      id: stringSchema("Queue entry id")
    }),
    tool("cw_history", "Read a cross-repo unified run timeline (newest first), deterministic and paginated, with provenance links.", {
      cwd: stringSchema("Repo workspace"),
      scope: stringSchema("home (default, cross-repo) or repo"),
      app: stringSchema("App or workflow id filter"),
      status: stringSchema("Lifecycle status filter"),
      limit: numberSchema("Page size (default 50)"),
      offset: numberSchema("Page offset (default 0)")
    })
  ];
}

function tool(name: string, description: string, properties: Record<string, unknown>): unknown {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      additionalProperties: true
    }
  };
}

function stringSchema(description: string): unknown {
  return { type: "string", description };
}

function numberSchema(description: string): unknown {
  return { type: "number", description };
}

function booleanSchema(description: string): unknown {
  return { type: "boolean", description };
}

function objectSchema(description: string): unknown {
  return { type: "object", description, additionalProperties: true };
}

function arraySchema(description: string): unknown {
  return { type: "array", description, items: {} };
}

function runIdSchema(): Record<string, unknown> {
  return {
    runId: stringSchema("Run id"),
    cwd: stringSchema("Run workspace")
  };
}

function workerIdSchema(): Record<string, unknown> {
  return {
    ...runIdSchema(),
    workerId: stringSchema("Worker id")
  };
}

function candidateIdSchema(): Record<string, unknown> {
  return {
    ...runIdSchema(),
    candidateId: stringSchema("Candidate id")
  };
}

function sendResult(id: JsonRpcRequest["id"], result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id: JsonRpcRequest["id"], code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
