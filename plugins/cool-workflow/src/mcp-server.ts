#!/usr/bin/env node
import path from "node:path";
import { CoolWorkflowRunner } from "./orchestrator";
import { Scheduler } from "./scheduler";
import { RoutineTriggerBridge } from "./triggers";
import { OperatorRecommendation, OperatorRunSummary } from "./operator-ux";
import { CURRENT_COOL_WORKFLOW_VERSION } from "./version";

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
      const result = callTool(message.params?.name || "", message.params?.arguments || {});
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
        return runner.plan(String(args.workflowId || ""), args);
      case "cw_app_run":
        return appRun(args);
      case "cw_status":
        return runner.status(String(args.runId || ""));
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
        return runner.multiAgentGraph(String(args.runId || ""));
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
      case "cw_audit_summary":
        return runner.auditSummary(String(args.runId || ""));
      case "cw_audit_worker":
        return runner.workerAudit(String(args.runId || ""), String(args.workerId || ""));
      case "cw_audit_provenance":
        return runner.evidenceProvenance(String(args.runId || ""), args);
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
        return sandboxResolve(args);
      case "cw_result":
        return runner.recordResult(String(args.runId || ""), String(args.taskId || ""), String(args.resultPath || ""));
      case "cw_commit":
        return commitResult(String(args.runId || ""), args);
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
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } finally {
    process.chdir(previousCwd);
  }
}

function appRun(args: Record<string, unknown>): unknown {
  const appId = String(args.appId || args.workflowId || "");
  const inputs = isRecord(args.inputs) ? args.inputs : {};
  const planOptions = { ...inputs, ...withoutRuntimeKeys(args) };
  const sandboxProfileId = sandboxProfileIdFrom(args);
  const resolvedSandbox = sandboxProfileId ? runner.showSandboxProfile(sandboxProfileId, args) : undefined;
  const run = runner.plan(appId, planOptions);
  const status = runner.operatorStatus(run.id);
  return {
    runId: run.id,
    workflowId: run.workflow.id,
    appId: run.workflow.app?.id || appId,
    appVersion: run.workflow.app?.version,
    statePath: run.paths.state,
    reportPath: run.paths.report,
    pendingTasks: run.tasks.filter((task) => task.status === "pending").length,
    operatorStatus: compactOperatorStatus(status),
    nextActions: status.nextActions,
    sandboxProfileId,
    sandboxProfile: resolvedSandbox
  };
}

function sandboxResolve(args: Record<string, unknown>): unknown {
  const profileId = sandboxProfileIdFrom(args) || "readonly";
  const profile = runner.showSandboxProfile(profileId, args);
  return {
    profileId,
    sandboxProfileId: profile.id,
    valid: true,
    profile
  };
}

function commitResult(runId: string, args: Record<string, unknown>): unknown {
  const result = runner.commit(runId, args);
  const commit = result.commit;
  const status = runner.operatorStatus(runId);
  return {
    runId,
    commitId: commit.id,
    verifierGated: commit.verifierGated,
    checkpoint: commit.checkpoint,
    verifierNodeId: commit.verifierNodeId,
    candidateId: commit.candidateId,
    selectionId: commit.selectionId,
    evidenceCount: (commit.evidence || []).length,
    snapshotPath: commit.snapshotPath,
    nextActions: status.nextActions,
    commit
  };
}

function compactOperatorStatus(status: OperatorRunSummary): Record<string, unknown> {
  return {
    runId: status.runId,
    workflowId: status.workflowId,
    appId: status.appId,
    appVersion: status.appVersion,
    loopStage: status.loopStage,
    activePhase: status.activePhase,
    blocked: status.blocked,
    blockedReasons: status.blockedReasons,
    pendingTasks: status.tasks.pending.length,
    runningTasks: status.tasks.running.length,
    completedTasks: status.tasks.completed.length,
    nextActions: status.nextActions as OperatorRecommendation[]
  };
}

function sandboxProfileIdFrom(args: Record<string, unknown>): string | undefined {
  return optionalString(args.sandbox || args.sandboxProfile || args.sandboxProfileId || args.profileId);
}

function withoutRuntimeKeys(args: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...args };
  for (const key of ["appId", "workflowId", "inputs", "sandbox", "sandboxProfile", "sandboxProfileId", "profileId"]) {
    delete copy[key];
  }
  return copy;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
    tool("cw_operator_status", "Read the structured Operator UX run status.", runIdSchema()),
    tool("cw_operator_graph", "Read the structured Operator UX run graph.", runIdSchema()),
    tool("cw_operator_report", "Refresh and read the structured Operator UX report summary.", runIdSchema()),
    tool("cw_worker_summary", "Read the structured worker summary for a run.", runIdSchema()),
    tool("cw_candidate_summary", "Read the structured candidate summary for a run.", runIdSchema()),
    tool("cw_feedback_summary", "Read the structured feedback summary for a run.", runIdSchema()),
    tool("cw_commit_summary", "Read the structured commit summary for a run.", runIdSchema()),
    tool("cw_multi_agent_summary", "Read the structured multi-agent runtime summary for a run.", runIdSchema()),
    tool("cw_multi_agent_graph", "Read the structured multi-agent runtime graph for a run.", runIdSchema()),
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
