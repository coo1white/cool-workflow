// shell/multi-agent-cli.ts — CLI/MCP-facing entry points for milestone 9's
// multi-agent/topology/coordinator/candidate/collaboration/eval surface.
//
// MILESTONE 9. Wires the pure core/multi-agent/* modules + their shell IO
// wrappers (multi-agent-io.ts, topology-io.ts, coordinator-io.ts,
// candidate-scoring-io.ts, collaboration-io.ts, eval-io.ts,
// multi-agent-host.ts) into the shapes core/capability-table.ts's CLI
// bindings call, matching shell/pipeline-cli.ts's pattern.
//
// Evidence: SPEC/multi-agent.md section J ("CLI verbs and MCP tools").

import * as path from "node:path";
import { WorkflowRun } from "../core/state/types";
import { loadRunFromCwd, saveCheckpoint } from "./run-store";
import { writeReport } from "./report";
import * as mai from "./multi-agent-io";
import * as topio from "./topology-io";
import * as coord from "./coordinator-io";
import * as cs from "./candidate-scoring-io";
import * as collab from "./collaboration-io";
import * as evalio from "./eval-io";
import * as host from "./multi-agent-host";
import { getAgentFanin, getAgentFanout, getAgentGroup, getAgentMembership, getAgentRole, getMultiAgentRun } from "../core/multi-agent/runtime";
import { getTopologyDefinition, listTopologyDefinitions, validateTopologyDefinition } from "../core/multi-agent/topology";

function invocationCwd(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}

function loadRun(args: Record<string, unknown>, runId: string): WorkflowRun {
  return loadRunFromCwd(runId, invocationCwd(args));
}

function persist(run: WorkflowRun): void {
  saveCheckpoint(run);
  writeReport(run);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined;
}
function requireArg(value: unknown, label: string): string {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`Missing ${label}`);
  return parsed;
}
/** Byte-exact to the eval-replay harness's own thrown strings (SPEC/
 *  multi-agent.md "Eval harness exact outputs"): these three END with a
 *  period, unlike the generic `requireArg` messages elsewhere in this
 *  file. */
function requireArgDot(value: unknown, label: string): string {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`Missing ${label}.`);
  return parsed;
}
function arrayArg(value: unknown): string[] {
  if (value === undefined || value === null || value === true) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}
function numberArg(value: unknown): number | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function boolArg(value: unknown): boolean {
  return Boolean(value);
}
/** `--multi-agent-run <id>` — parseArgv keeps kebab-case option keys
 *  verbatim (no camelCase folding), so this must check the literal
 *  `"multi-agent-run"` key alongside the camelCase aliases the MCP
 *  surface also accepts. */
function multiAgentRunArg(args: Record<string, unknown>): string | undefined {
  return optionalString(args.multiAgentRunId ?? args.multiAgentRun ?? args["multi-agent-run"]);
}
function groupArg(args: Record<string, unknown>): string | undefined {
  return optionalString(args.groupId ?? args.group ?? args["multi-agent-group"]);
}
/** `--blackboard <id>` — byte-exact to the old build's
 *  `options.blackboard || options.blackboardId` read
 *  (orchestrator/multi-agent-operations.ts). parseArgv keeps `--blackboard`
 *  as the literal key `blackboard`; the MCP surface also accepts
 *  `blackboardId`. */
function blackboardIdArg(args: Record<string, unknown>): string | undefined {
  return optionalString(args.blackboard ?? args.blackboardId);
}
/** `--topic <id>` (repeatable) — byte-exact to the old build's
 *  `options.topic || options.topicId || options.topics` read. */
function topicIdsArg(args: Record<string, unknown>): string[] {
  const raw = args.topic ?? args.topicId ?? args.topics;
  return arrayArg(raw);
}
/** `--sandbox-choice role=profile` (repeatable) — byte-exact port of the old
 *  build's parseSandboxChoices (orchestrator/cli-options.ts): merges a
 *  structured `sandboxChoices`/`sandboxProfileChoices` object with repeated
 *  `--sandbox-choice`/`sandboxChoice` `key=value` pairs, then falls back to a
 *  bare `--sandbox` as the `default` choice only when no explicit choice was
 *  given. */
function parseSandboxChoicesCli(args: Record<string, unknown>): Record<string, string> | undefined {
  const choices: Record<string, string> = {};
  const structured = args.sandboxChoices ?? args.sandboxProfileChoices;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    for (const [key, value] of Object.entries(structured as Record<string, unknown>)) choices[key] = String(value);
  }
  for (const entry of arrayArg(args.sandboxChoice ?? args["sandbox-choice"])) {
    const [key, ...rest] = String(entry).split("=");
    if (key && rest.length) choices[key] = rest.join("=");
  }
  const sandbox = optionalString(args.sandbox ?? args.sandboxProfile ?? args.sandboxProfileId);
  if (sandbox && !Object.keys(choices).length) choices.default = sandbox;
  return Object.keys(choices).length ? choices : undefined;
}

// ---------------------------------------------------------------------------
// Topology (catalog — no run needed)
// ---------------------------------------------------------------------------

export function topologyList(): unknown {
  return listTopologyDefinitions();
}

export function topologyShowCli(topologyId: string): unknown {
  const definition = getTopologyDefinition(topologyId);
  if (!definition) throw new Error(`Unknown topology id: ${topologyId}`);
  return definition;
}

export function topologyValidateCli(topologyId: string): { valid: boolean; topologyId: string; issues: unknown[] } {
  const result = validateTopologyDefinition(topologyId);
  return { valid: result.valid, topologyId: result.topologyId, issues: result.issues };
}

export function topologyApplyCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const topologyId = requireArg(args.topologyId ?? args.id, "topology id");
  const run = loadRun(args, runId);
  const record = topio.applyTopology(run, topologyId, {
    // #30: `topology apply <run> <topology> --id <custom>` — the custom
    // topology-run id arrives as `--id` (parseArgv key `id`), NOT `id2`
    // (which no CLI/MCP surface ever emits). On CLI the topology id comes
    // from positional[1] (capability-table), so `args.id` is free for the
    // run-id override; on MCP the handler pre-maps topologyId from
    // `topologyId ?? id`. Byte-exact to the old build's
    // `id: stringOption(options.id)` (orchestrator/topology-operations.ts).
    id: optionalString(args.id),
    task: undefined,
    taskIds: arrayArg(args.task ?? args.taskId),
    mapperCount: numberArg(args.mapperCount ?? args["mapper-count"] ?? args.mappers ?? args.mapper),
    judgeCount: numberArg(args.judgeCount ?? args["judge-count"] ?? args.judges ?? args.judge),
    debateRounds: numberArg(args.debateRounds ?? args["debate-rounds"] ?? args.rounds),
    blackboardId: blackboardIdArg(args),
    multiAgentRunId: multiAgentRunArg(args),
    collectInitialFanin: boolArg(args.collectInitialFanin ?? args["collect-initial-fanin"]),
  } as never);
  persist(run);
  return record;
}

export function topologySummaryCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return topio.summarizeTopologies(run);
}

export function topologyGraphCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return topio.buildTopologyGraph(run);
}

export function topologyRunShowCli(args: Record<string, unknown>, topologyRunId: string): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return topio.showTopologyRun(run, topologyRunId);
}

// ---------------------------------------------------------------------------
// Multi-agent kernel (CLI verbs: run/status/step/blackboard/score/select via
// the host, plus role/group/membership/fanout/fanin/show for direct kernel
// access, per SPEC/multi-agent.md section J).
// ---------------------------------------------------------------------------

export function multiAgentRunCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const topology = optionalString(args.topology);
  let result: unknown;
  if (topology === undefined && (args.id !== undefined || args.title !== undefined)) {
    // #28: forward `--blackboard`/`--topic` (plus the old build's
    // objective/parent/phase reads) into the kernel input so a plain
    // `multi-agent run <run> --id ma --blackboard bb --topic t` carries the
    // blackboard linkage. Byte-exact to the old build's createMultiAgentRun
    // option map (orchestrator/multi-agent-operations.ts).
    result = mai.createMultiAgentRun(run, {
      id: optionalString(args.id),
      title: optionalString(args.title),
      objective: optionalString(args.objective ?? args.reason),
      parentMultiAgentRunId: optionalString(args.parent ?? args.parentMultiAgentRunId),
      phase: optionalString(args.phase),
      phaseId: optionalString(args.phaseId),
      blackboardId: blackboardIdArg(args),
      topicIds: topicIdsArg(args),
    });
  } else {
    result = host.hostRun(run, args);
  }
  persist(run);
  return result;
}

export function multiAgentStatusCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return host.hostStatus(run);
}

export function multiAgentStepCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const result = host.hostStep(run, args);
  persist(run);
  return result;
}

export function multiAgentBlackboardCli(args: Record<string, unknown>, action: string | undefined): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const result = host.hostBlackboard(run, action, args);
  persist(run);
  return result;
}

export function multiAgentScoreCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const result = host.hostScore(run, args);
  persist(run);
  return result;
}

export function multiAgentSelectCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const result = host.hostSelect(run, args);
  persist(run);
  return result;
}

export function multiAgentRoleCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const roleId = optionalString(args.roleId);
  const multiAgentRunId = multiAgentRunArg(args);
  if (roleId && !args.id && !multiAgentRunId) {
    const role = getAgentRole(run, roleId);
    if (!role) throw new Error(`Unknown AgentRole id: ${roleId}`);
    return role;
  }
  // #29: parseArgv keeps `--required-evidence` etc. as their literal kebab
  // keys, so the old camelCase-only reads folded to []. Read BOTH the kebab
  // CLI key and the camelCase MCP alias, byte-exact to the old build's
  // createAgentRole option map (orchestrator/multi-agent-operations.ts).
  const role = mai.createAgentRole(run, {
    id: optionalString(args.id) ?? roleId,
    multiAgentRunId: requireArg(multiAgentRunId, "multi-agent run id"),
    title: optionalString(args.title),
    responsibilities: arrayArg(args.responsibility ?? args.responsibilities),
    requiredEvidence: arrayArg(args.requiredEvidence ?? args["required-evidence"]),
    sandboxProfileHints: arrayArg(args.sandbox ?? args.sandboxProfile ?? args.sandboxProfileHint ?? args["sandbox-profile"]),
    expectedArtifacts: arrayArg(args.expectedArtifact ?? args.expectedArtifacts ?? args["expected-artifact"]),
    faninObligations: arrayArg(args.faninObligation ?? args.faninObligations ?? args["fanin-obligation"]),
    parentRoleId: optionalString(args.parent ?? args.parentRoleId),
    blackboardId: blackboardIdArg(args),
    topicIds: topicIdsArg(args),
  });
  persist(run);
  return role;
}

export function multiAgentGroupCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const groupId = optionalString(args.groupId);
  const multiAgentRunId = multiAgentRunArg(args);
  if (groupId && !args.id && !multiAgentRunId) {
    const group = getAgentGroup(run, groupId);
    if (!group) throw new Error(`Unknown AgentGroup id: ${groupId}`);
    return group;
  }
  // #28: forward `--blackboard`/`--topic` (plus phaseId/parent) into the
  // kernel input. Byte-exact to the old createAgentGroup option map.
  const group = mai.createAgentGroup(run, {
    id: optionalString(args.id) ?? groupId,
    multiAgentRunId: requireArg(multiAgentRunId, "multi-agent run id"),
    title: optionalString(args.title),
    phase: optionalString(args.phase),
    phaseId: optionalString(args.phaseId),
    taskIds: arrayArg(args.task ?? args.taskId ?? args.tasks),
    parentGroupId: optionalString(args.parent ?? args.parentGroupId),
    blackboardId: blackboardIdArg(args),
    topicIds: topicIdsArg(args),
  });
  persist(run);
  return group;
}

export function multiAgentMembershipCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const membershipId = optionalString(args.membershipId);
  const groupId = groupArg(args);
  const roleId = optionalString(args.roleId ?? args.role);
  if (membershipId && !args.id && !groupId && !roleId) {
    const membership = getAgentMembership(run, membershipId);
    if (!membership) throw new Error(`Unknown AgentMembership id: ${membershipId}`);
    return membership;
  }
  // #28: forward `--blackboard`/`--topic` (plus multiAgentRunId/status) into
  // the kernel input. Byte-exact to the old assignAgentMembership option map.
  const membership = mai.assignAgentMembership(run, {
    id: optionalString(args.id) ?? membershipId,
    multiAgentRunId: multiAgentRunArg(args),
    groupId: requireArg(groupId, "group id"),
    roleId: requireArg(roleId, "role id"),
    taskId: requireArg(args.taskId ?? args.task, "task id"),
    workerId: optionalString(args.workerId ?? args.worker),
    dispatchId: optionalString(args.dispatchId ?? args.dispatch),
    fanoutId: optionalString(args.fanoutId ?? args.fanout ?? args["multi-agent-fanout"]),
    status: optionalString(args.status) as never,
    blackboardId: blackboardIdArg(args),
    topicIds: topicIdsArg(args),
  });
  persist(run);
  return membership;
}

export function multiAgentFanoutCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const fanoutId = optionalString(args.fanoutId);
  const groupId = groupArg(args);
  if (fanoutId && !args.id && !groupId) {
    const fanout = getAgentFanout(run, fanoutId);
    if (!fanout) throw new Error(`Unknown AgentFanout id: ${fanoutId}`);
    return fanout;
  }
  // #28: forward `--blackboard`/`--topic` so `fanout.blackboardId` inherits
  // the board (kernel: input.blackboardId || group.blackboardId ||
  // multiAgentRun.blackboardId). Also port the old build's fuller fanout
  // reads (multiAgentRunId, workerIds/membershipIds/dispatchIds,
  // sandboxProfileChoices, expectedReturnShape).
  const fanout = mai.createAgentFanout(run, {
    id: optionalString(args.id) ?? fanoutId,
    multiAgentRunId: multiAgentRunArg(args),
    groupId: requireArg(groupId, "group id"),
    reason: requireArg(args.reason, "reason"),
    roleIds: arrayArg(args.role ?? args.roleId ?? args.roles),
    taskIds: arrayArg(args.task ?? args.taskId ?? args.tasks),
    workerIds: arrayArg(args.worker ?? args.workerId ?? args.workers),
    membershipIds: arrayArg(args.membership ?? args.membershipId ?? args.memberships),
    dispatchIds: arrayArg(args.dispatch ?? args.dispatchId ?? args.dispatches),
    concurrencyLimit: numberArg(args.limit ?? args.concurrency ?? args.concurrencyLimit),
    sandboxProfileChoices: parseSandboxChoicesCli(args),
    expectedReturnShape: optionalString(args.expectedReturnShape ?? args["expected-return-shape"]),
    blackboardId: blackboardIdArg(args),
    topicIds: topicIdsArg(args),
  });
  persist(run);
  return fanout;
}

export function multiAgentFaninCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const faninId = optionalString(args.faninId);
  const groupId = groupArg(args);
  const fanoutId = optionalString(args.fanoutId ?? args.fanout);
  if (faninId && !args.id && !groupId && !fanoutId) {
    const fanin = getAgentFanin(run, faninId);
    if (!fanin) throw new Error(`Unknown AgentFanin id: ${faninId}`);
    return fanin;
  }
  // #29: `--required-role` folds to the kebab key `required-role`; read the
  // kebab + camelCase aliases. #28: forward `--blackboard`/`--topic` +
  // multiAgentRunId. Byte-exact to the old collectAgentFanin option map.
  const fanin = mai.collectAgentFanin(run, {
    id: optionalString(args.id) ?? faninId,
    multiAgentRunId: multiAgentRunArg(args),
    groupId,
    fanoutId,
    requiredRoleIds: arrayArg(args.requiredRole ?? args.requiredRoleId ?? args["required-role"]),
    strategy: optionalString(args.strategy),
    blackboardId: blackboardIdArg(args),
    topicIds: topicIdsArg(args),
  });
  persist(run);
  return fanin;
}

export function multiAgentShowCli(args: Record<string, unknown>, id: string): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const record = getMultiAgentRun(run, id);
  if (!record) throw new Error(`Unknown MultiAgentRun id: ${id}`);
  return record;
}

export function multiAgentSummaryCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return mai.summarizeMultiAgent(run);
}

export function multiAgentGraphCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return mai.buildMultiAgentGraph(run);
}

// ---------------------------------------------------------------------------
// Blackboard / coordinator
// ---------------------------------------------------------------------------

export function blackboardSummaryCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return coord.summarizeBlackboard(run, optionalString(args.blackboardId));
}

export function blackboardGraphCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return coord.buildBlackboardGraph(run);
}

export function blackboardResolveCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const board = coord.resolveBlackboard(run, { id: optionalString(args.id), title: optionalString(args.title), multiAgentRunId: optionalString(args.multiAgentRunId), groupId: optionalString(args.groupId), roleId: optionalString(args.roleId), membershipId: optionalString(args.membershipId) });
  persist(run);
  return board;
}

export function blackboardTopicCreateCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const topic = coord.createBlackboardTopic(run, { id: optionalString(args.id), title: requireArg(args.title, "topic title"), description: optionalString(args.description), blackboardId: optionalString(args.blackboardId), tags: arrayArg(args.tag) });
  persist(run);
  return topic;
}

export function blackboardMessagePostCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const message = coord.postBlackboardMessage(run, { id: optionalString(args.id), topicId: requireArg(args.topic ?? args.topicId, "topic id"), blackboardId: optionalString(args.blackboardId), body: requireArg(args.body, "message body"), replyToId: optionalString(args.replyTo), evidenceRefs: arrayArg(args.evidence), artifactRefIds: arrayArg(args.artifact) });
  persist(run);
  return message;
}

export function blackboardMessageListCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return coord.listBlackboardMessages(run, { topicId: optionalString(args.topic ?? args.topicId), blackboardId: optionalString(args.blackboardId) });
}

export function blackboardContextPutCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const context = coord.putBlackboardContext(run, { id: optionalString(args.id), topicId: requireArg(args.topic ?? args.topicId, "topic id"), kind: requireArg(args.kind, "context kind") as never, key: optionalString(args.key), value: requireArg(args.value ?? args.body, "context value"), blackboardId: optionalString(args.blackboardId), supersedesContextIds: arrayArg(args.supersedes), evidenceRefs: arrayArg(args.evidence), artifactRefIds: arrayArg(args.artifact) });
  persist(run);
  return context;
}

export function blackboardArtifactAddCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const artifact = coord.addBlackboardArtifact(run, { id: optionalString(args.id), topicId: optionalString(args.topic), kind: requireArg(args.kind, "artifact kind"), path: optionalString(args.path), locator: optionalString(args.locator), blackboardId: optionalString(args.blackboardId), source: optionalString(args.source), evidenceRefs: arrayArg(args.evidence) });
  persist(run);
  return artifact;
}

export function blackboardArtifactListCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return coord.listBlackboardArtifacts(run, { topicId: optionalString(args.topic), blackboardId: optionalString(args.blackboardId) });
}

export function blackboardSnapshotCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const snapshot = coord.createBlackboardSnapshot(run, optionalString(args.blackboardId));
  persist(run);
  return snapshot;
}

export function coordinatorSummaryCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return coord.summarizeBlackboard(run, optionalString(args.blackboardId));
}

export function coordinatorDecisionCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const decision = coord.recordCoordinatorDecision(run, { id: optionalString(args.id), blackboardId: optionalString(args.blackboardId), kind: requireArg(args.kind, "decision kind") as never, outcome: requireArg(args.outcome, "decision outcome") as never, reason: requireArg(args.reason, "decision reason"), subjectIds: arrayArg(args.subject), evidenceRefs: arrayArg(args.evidence), artifactRefIds: arrayArg(args.artifact), messageIds: arrayArg(args.message) });
  persist(run);
  return decision;
}

// ---------------------------------------------------------------------------
// Candidate scoring
// ---------------------------------------------------------------------------

export function candidateListCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return cs.listCandidates(run, { status: optionalString(args.status) as never, kind: optionalString(args.kind) as never });
}

export function candidateShowCli(args: Record<string, unknown>, candidateId: string): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const candidate = cs.getCandidate(run, candidateId);
  if (!candidate) throw new Error(`Unknown candidate for run ${runId}: ${candidateId}`);
  return candidate;
}

export function candidateRegisterCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const candidate = cs.registerCandidate(run, { id: optionalString(args.id), kind: optionalString(args.kind) as never, workerId: optionalString(args.worker ?? args.workerId), taskId: optionalString(args.task ?? args.taskId), resultNodeId: optionalString(args.resultNode), verifierNodeId: optionalString(args.verifierNode), resultPath: optionalString(args.resultPath) });
  persist(run);
  return candidate;
}

function parseCriteriaCli(args: Record<string, unknown>): Record<string, number> {
  const criteria: Record<string, number> = {};
  const structured = args.criteria;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    for (const [key, value] of Object.entries(structured as Record<string, unknown>)) {
      const parsed = Number(value);
      if (key && Number.isFinite(parsed)) criteria[key] = parsed;
    }
  }
  for (const entry of arrayArg(args.criterion)) {
    const [key, value] = entry.split("=");
    if (!key || value === undefined) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) criteria[key] = parsed;
  }
  if (!Object.keys(criteria).length) throw new Error("Missing score criteria. Use --criterion name=value");
  return criteria;
}

export function candidateScoreCli(args: Record<string, unknown>, candidateId: string): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const evidence = arrayArg(args.evidence).map((entry, index) => ({ id: `score:${index + 1}`, source: "cli", locator: entry, summary: entry }));
  const score = cs.scoreCandidate(run, candidateId, { id: optionalString(args.id), scorer: optionalString(args.scorer), criteria: parseCriteriaCli(args), maxTotal: numberArg(args.maxTotal ?? args.max), verdict: optionalString(args.verdict) as never, evidence, notes: optionalString(args.notes) });
  persist(run);
  return score;
}

export function candidateRankCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const ranking = cs.rankCandidates(run, { includeRejected: boolArg(args.includeRejected), policy: { minNormalized: numberArg(args.minNormalized), requireEvidence: args.requireEvidence === undefined ? undefined : boolArg(args.requireEvidence), requireVerifierGate: args.requireVerifierGate === undefined ? undefined : boolArg(args.requireVerifierGate), tieBreaker: optionalString(args.tieBreaker) as never } });
  persist(run);
  return ranking;
}

export function candidateSelectCli(args: Record<string, unknown>, candidateId: string): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const selection = cs.selectCandidate(run, candidateId, { selectedBy: optionalString(args.selectedBy ?? args.by), reason: optionalString(args.reason), scoreId: optionalString(args.score), allowUnverified: boolArg(args.allowUnverified) }, { policy: { minNormalized: numberArg(args.minNormalized), requireVerifierGate: args.requireVerifierGate === undefined ? undefined : boolArg(args.requireVerifierGate) } });
  persist(run);
  return selection;
}

export function candidateRejectCli(args: Record<string, unknown>, candidateId: string): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const candidate = cs.rejectCandidate(run, candidateId, requireArg(args.reason, "reject reason"));
  persist(run);
  return candidate;
}

export function candidateSummaryCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return cs.summarizeCandidates(run);
}

// ---------------------------------------------------------------------------
// Collaboration
// ---------------------------------------------------------------------------

function targetFromArgs(args: Record<string, unknown>, positionalKind?: string, positionalId?: string): { kind: string; id: string } {
  const kind = optionalString(args.targetKind ?? args.kind ?? positionalKind);
  const id = optionalString(args.targetId ?? args.target ?? positionalId);
  if (!kind || !id) throw new Error("Collaboration target requires a kind and id");
  return { kind, id };
}

export function approveCli(args: Record<string, unknown>, positionalKind?: string, positionalId?: string): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const target = targetFromArgs(args, positionalKind, positionalId);
  const record = collab.recordApproval(run, { target: target as never, decision: "approve", actor: optionalString(args.actor), actorKind: optionalString(args.actorKind), role: optionalString(args.role), displayName: optionalString(args.displayName), attested: boolArg(args.attested), attestation: optionalString(args.attestation) as never, rationale: optionalString(args.rationale), supersedes: optionalString(args.supersedes) });
  return record;
}

export function rejectCollabCli(args: Record<string, unknown>, positionalKind?: string, positionalId?: string): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const target = targetFromArgs(args, positionalKind, positionalId);
  const record = collab.recordApproval(run, { target: target as never, decision: "reject", actor: optionalString(args.actor), actorKind: optionalString(args.actorKind), role: optionalString(args.role), displayName: optionalString(args.displayName), attested: boolArg(args.attested), attestation: optionalString(args.attestation) as never, rationale: optionalString(args.rationale) });
  return record;
}

export function commentAddCli(args: Record<string, unknown>, positionalKind?: string, positionalId?: string): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const target = targetFromArgs(args, positionalKind, positionalId);
  const record = collab.recordComment(run, { target: target as never, body: requireArg(args.body ?? args.message ?? args.text, "comment body"), actor: optionalString(args.actor), actorKind: optionalString(args.actorKind), role: optionalString(args.role), threadId: optionalString(args.thread), parentId: optionalString(args.parent) });
  return record;
}

export function commentListCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const targetKind = optionalString(args.targetKind);
  const targetId = optionalString(args.target);
  return collab.listComments(run, targetKind && targetId ? ({ kind: targetKind, id: targetId } as never) : undefined);
}

export function handoffCli(args: Record<string, unknown>, positionalKind?: string, positionalId?: string): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const target = targetFromArgs(args, positionalKind, positionalId);
  const record = collab.recordHandoff(run, { target: target as never, toActor: optionalString(args.to ?? args.toActor), toRole: optionalString(args.toRole), fromActor: optionalString(args.from), reason: requireArg(args.reason, "handoff reason"), actor: optionalString(args.actor), actorKind: optionalString(args.actorKind), role: optionalString(args.role) });
  return record;
}

export function reviewStatusCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const targetKind = optionalString(args.targetKind);
  const targetId = optionalString(args.target);
  return collab.buildReviewStatusReport(run, { now: new Date().toISOString(), target: targetKind && targetId ? ({ kind: targetKind, id: targetId } as never) : undefined });
}

export function reviewPolicyCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const policy = collab.setReviewPolicy(run, { requiredApprovals: numberArg(args.requiredApprovals), authorizedRoles: arrayArg(args.authorizedRoles).length ? arrayArg(args.authorizedRoles) : optionalString(args.authorizedRoles), allowSelfApproval: args.allowSelfApproval === undefined ? undefined : boolArg(args.allowSelfApproval), requireAttestedActor: args.requireAttestedActor === undefined ? undefined : boolArg(args.requireAttestedActor), appliesTo: arrayArg(args.appliesTo).length ? (arrayArg(args.appliesTo) as never) : (optionalString(args.appliesTo) as never) });
  return policy;
}

// ---------------------------------------------------------------------------
// Eval replay
// ---------------------------------------------------------------------------

export function evalSnapshotCli(args: Record<string, unknown>): unknown {
  const runId = requireArgDot(args.runId, "run id");
  const run = loadRun(args, runId);
  return evalio.createMultiAgentReplaySnapshot(run, args);
}

export function evalReplayCli(args: Record<string, unknown>): unknown {
  const target = requireArgDot(args.snapshot ?? args.snapshotId ?? args.path, "snapshot id or path");
  return evalio.replayMultiAgentSnapshot(target, args);
}

export function evalCompareCli(args: Record<string, unknown>): unknown {
  const baseline = requireArgDot(args.baseline ?? args.baselinePath, "baseline id or path");
  const replay = requireArgDot(args.replay ?? args.replayPath, "replay id or path");
  return evalio.compareMultiAgentReplay(baseline, replay);
}

export function evalScoreCli(args: Record<string, unknown>): unknown {
  const target = requireArg(args.replay ?? args.replayPath ?? args.path, "replay id or path");
  return evalio.scoreMultiAgentReplay(target);
}

export function evalGateCli(args: Record<string, unknown>): unknown {
  const target = requireArg(args.suite ?? args.suiteId ?? args.path, "suite id or path");
  return evalio.gateMultiAgentEval(target);
}

export function evalReportCli(args: Record<string, unknown>): unknown {
  const target = requireArg(args.replay ?? args.replayPath ?? args.path, "replay id or path");
  return evalio.reportMultiAgentEval(target);
}
