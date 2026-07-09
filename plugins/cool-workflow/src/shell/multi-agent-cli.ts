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
import { requiredNumberFlag } from "../core/util/numeric-flag";
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
import { getWorkerScope } from "./worker-isolation";
import { getTopologyDefinition, listTopologyDefinitions, validateTopologyDefinition } from "../core/multi-agent/topology";
import {
  buildMultiAgentOperatorGraph,
  formatMultiAgentDependencies,
  formatMultiAgentEvidence,
  formatMultiAgentFailures,
  formatMultiAgentOperatorStatus,
  summarizeMultiAgentOperator,
  operatorDigestInput,
} from "./multi-agent-operator-ux";
import { formatOperatorGraph as formatOperatorGraphText } from "./operator-ux-text";
import { buildStateExplosionReport } from "../core/state/state-explosion/report";
import { buildCompactGraphFromView, runToGraphViewFromWorkflowRun } from "../core/state/state-explosion/graph";
import { summarizeBlackboardDigest } from "../core/state/state-explosion/digest";
import { loadStateExplosionSummaryIndex } from "./state-explosion-cli";
import { getRunContract } from "../core/pipeline/runner";
import { summarizeCandidateOperatorRecords } from "./operator-ux";
import * as reasoning from "./evidence-reasoning";

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
/** `--author-id`/`--author-kind`/`--author-name` (or the `worker`/`role`/
 *  `group` fallbacks) — byte-exact port of parseBlackboardAuthor
 *  (orchestrator/cli-options.ts). Threaded into every blackboard write so a
 *  message/context/artifact carries the posting role, not the default. */
function parseBlackboardAuthorCli(args: Record<string, unknown>): { kind?: string; id?: string; displayName?: string } | undefined {
  const structured = args.author;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) return structured as never;
  const id = optionalString(args.authorId ?? args.author ?? args.worker ?? args.workerId ?? args.role ?? args.roleId ?? args.group ?? args.groupId);
  const kind = optionalString(args.authorKind ?? args.sourceKind ?? args.source);
  const displayName = optionalString(args.authorName ?? args.displayName);
  if (!id && !kind && !displayName) return undefined;
  return { kind, id, displayName };
}
/** `--scope-kind`/`--scope-id` — byte-exact port of parseBlackboardScope. */
function parseBlackboardScopeCli(args: Record<string, unknown>): { kind?: string; id?: string } | undefined {
  const structured = args.scope;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) return structured as never;
  const kind = optionalString(args.scopeKind);
  const id = optionalString(args.scopeId);
  if (!kind && !id) return undefined;
  return { kind, id };
}
/** `--multi-agent-*`/`--task`/`--worker`/`--evidence` etc → BlackboardLinks —
 *  byte-exact port of parseBlackboardLinks (orchestrator/cli-options.ts). */
function parseBlackboardLinksCli(runId: string, args: Record<string, unknown>): Record<string, unknown> | undefined {
  const structured = args.provenance ?? args.links;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) return structured as Record<string, unknown>;
  const links: Record<string, unknown> = {
    workflowRunId: runId,
    multiAgentRunId: multiAgentRunArg(args),
    agentGroupId: groupArg(args),
    agentRoleId: optionalString(args.role ?? args.roleId ?? args["multi-agent-role"]),
    agentMembershipId: optionalString(args.membership ?? args.membershipId ?? args["multi-agent-membership"]),
    agentFanoutId: optionalString(args.fanout ?? args.fanoutId ?? args["multi-agent-fanout"]),
    agentFaninId: optionalString(args.fanin ?? args.faninId ?? args["multi-agent-fanin"]),
    taskId: optionalString(args.task ?? args.taskId),
    workerId: optionalString(args.worker ?? args.workerId),
    candidateId: optionalString(args.candidate ?? args.candidateId),
    verifierNodeId: optionalString(args.verifier ?? args.verifierNode ?? args.verifierNodeId),
    commitId: optionalString(args.commit ?? args.commitId),
    auditEventIds: arrayArg(args.audit ?? args.auditEvent ?? args.auditEventId ?? args["audit-event"]),
    evidenceRefs: arrayArg(args.evidence ?? args.evidenceRef ?? args["evidence-ref"]),
  };
  const entries = Object.entries(links).filter(([, value]) => value !== undefined && (!Array.isArray(value) || value.length));
  return entries.length > 1 ? Object.fromEntries(entries) : undefined;
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
  // `multi-agent run <run> <id> --status <status>` — port of the old CLI
  // handler's `id && args.options.status` arm (cli/handlers/multi-agent.ts):
  // transition the MultiAgentRun lifecycle (the core cascades completion to
  // owned roles/groups/fanouts/fanins, or fails closed when a fanin is not
  // verifier-ready). `multiAgentRunId` is the positional entity id the CLI
  // binding forwards (or the `--id`/`--multi-agent-run` alias the MCP peer
  // sends).
  const transitionId = optionalString(args.multiAgentRunId ?? args.id ?? args.multiAgentRun);
  const status = optionalString(args.status);
  const app = optionalString(args.app ?? args.appId);
  const workflow = optionalString(args.workflow ?? args.workflowId);
  const isHostRun = !runId || topology !== undefined || app !== undefined || workflow !== undefined;
  if (!isHostRun && transitionId && status && args.title === undefined && args.objective === undefined) {
    const record = mai.transitionMultiAgentRun(run, transitionId, status as never, {
      reason: optionalString(args.reason),
      actor: optionalString(args.actor),
    });
    persist(run);
    return record;
  }
  if (!isHostRun && transitionId && !status && args.title === undefined && args.objective === undefined && args.id === undefined) {
    // `multi-agent run <run> <id>` (positional id, no status/create flags) —
    // SHOW the MultiAgentRun record (old handler's showMultiAgentRun arm).
    const record = getMultiAgentRun(run, transitionId);
    if (!record) throw new Error(`Unknown MultiAgentRun id: ${transitionId}`);
    return record;
  }
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

/** `cw multi-agent status <run>` human text — the operator-UX status panel
 *  (Agent Graph / Dependencies / Failed-Blocked / Adopted-Missing Evidence
 *  / Next Action). Port of the old CLI handler's non-`--json` status arm
 *  (cli/handlers/multi-agent.ts). */
export function multiAgentStatusText(args: Record<string, unknown>): string {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return formatMultiAgentOperatorStatus(summarizeMultiAgentOperator(run));
}

/** `cw multi-agent dependencies <run>` — derived dependency edges (JSON). */
export function multiAgentDependenciesCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return summarizeMultiAgentOperator(run).dependencies;
}
export function multiAgentDependenciesText(args: Record<string, unknown>): string {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return formatMultiAgentDependencies(summarizeMultiAgentOperator(run).dependencies);
}

/** `cw multi-agent failures <run>` — failed/blocked/rejected/ambiguous rows. */
export function multiAgentFailuresCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return summarizeMultiAgentOperator(run).failures;
}
export function multiAgentFailuresText(args: Record<string, unknown>): string {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return formatMultiAgentFailures(summarizeMultiAgentOperator(run).failures);
}

/** `cw multi-agent evidence <run>` — evidence adoption rows, each additively
 *  enriched with the derived rationaleStatus (explained|unexplained|
 *  not-applicable) from the reasoning report. Port of the old
 *  runner.multiAgentEvidence enrichment. */
export function multiAgentEvidenceCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const rows = summarizeMultiAgentOperator(run).evidence;
  const report = reasoning.buildEvidenceReasoningReport(run, { index: reasoning.loadEvidenceReasoningIndex(run) });
  const byId = new Map(report.chains.map((chain) => [chain.id, chain.rationaleStatus]));
  for (const row of rows) row.rationaleStatus = byId.get(row.id) ?? "not-applicable";
  return rows;
}

/** `cw multi-agent reasoning <run> [--refresh] [--evidence <id>]` — the
 *  evidence adoption reasoning report (or a durable-index refresh). Port of
 *  the old runner.multiAgentReasoning / multiAgentReasoningRefresh. */
export function multiAgentReasoningCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const evidenceId = optionalString(args.evidence ?? args.evidenceId ?? args.id);
  if (args.refresh && !evidenceId) {
    const index = reasoning.refreshEvidenceReasoning(run);
    persist(run);
    return index;
  }
  return reasoning.showEvidenceReasoning(run, { evidenceId });
}
export function multiAgentReasoningText(args: Record<string, unknown>): string {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const evidenceId = optionalString(args.evidence ?? args.evidenceId ?? args.id);
  return reasoning.formatEvidenceReasoningReport(reasoning.showEvidenceReasoning(run, { evidenceId }));
}
export function multiAgentReasoningRefreshCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const index = reasoning.refreshEvidenceReasoning(run);
  persist(run);
  return index;
}
export function multiAgentEvidenceText(args: Record<string, unknown>): string {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const rows = summarizeMultiAgentOperator(run).evidence;
  const report = reasoning.buildEvidenceReasoningReport(run, { index: reasoning.loadEvidenceReasoningIndex(run) });
  const byId = new Map(report.chains.map((chain) => [chain.id, chain.rationaleStatus]));
  for (const row of rows) row.rationaleStatus = byId.get(row.id) ?? "not-applicable";
  return formatMultiAgentEvidence(rows);
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
    // This one flag (aliased --limit/--concurrency/--concurrencyLimit) goes
    // through requiredNumberFlag, not the file's own lenient numberArg — a
    // bare flag here used to silently mean "no limit" (fan out unbounded),
    // the opposite of the "silently means 1" bug the same audit found in
    // metrics-cli.ts/registry-cli.ts's own --limit handling; both now fail
    // loud instead of guessing in either direction.
    concurrencyLimit: requiredNumberFlag(args.limit ?? args.concurrency ?? args.concurrencyLimit, "--limit"),
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

/** `cw multi-agent summarize <run>` / `cw_multi_agent_summarize` — the
 *  combined state-explosion report (loads the persisted summary index when
 *  present). Port of the old runner.multiAgentSummarize. */
export function multiAgentSummarizeCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return buildStateExplosionReport(run, { index: loadStateExplosionSummaryIndex(run), operator: operatorDigestInput(run) });
}

/** `cw_multi_agent_graph_compact` — a compact/focused multi-agent graph
 *  view. Port of the old runner.multiAgentGraphView. */
export function multiAgentGraphCompactCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const view = optionalString(args.view);
  // Protect every reasoning-chain decision-gate node from collapse (the old
  // build fed reasoningCriticalNodeIds into buildCompactGraph so an adopted
  // chain's score/selection/commit/fanin nodes survive compaction).
  return buildCompactGraphFromView(run.id, runToGraphViewFromWorkflowRun(run), (view as never) || "compact", {
    focus: optionalString(args.focus),
    depth: numberArg(args.depth),
    reasoningCriticalIds: reasoning.reasoningCriticalNodeIds(run),
  });
}

/** `cw blackboard summarize <run>` / `cw_blackboard_summarize` — a blackboard
 *  digest with conflicts/evidence. Port of the old runner.blackboardSummarize. */
export function blackboardSummarizeCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return summarizeBlackboardDigest({ id: run.id, blackboard: run.blackboard as never }, blackboardIdArg(args));
}

/** `cw contract show <run> [contract-id]` / `cw_contract_show` — the run's
 *  resolved pipeline contract. Port of the old runner.showContract. */
export function contractShowCli(args: Record<string, unknown>, contractId?: string): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return getRunContract(run, contractId ?? optionalString(args.contractId));
}

export function multiAgentGraphCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return buildMultiAgentOperatorGraph(run);
}

/** `cw multi-agent graph <run>` human text — the operator graph render
 *  (nodes grouped by kind, then edges). Reuses the operator-ux graph
 *  formatter so `cw graph` and `cw multi-agent graph` render identically. */
export function multiAgentGraphText(args: Record<string, unknown>): string {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  return formatOperatorGraphText(buildMultiAgentOperatorGraph(run));
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
  const topic = coord.createBlackboardTopic(run, { id: optionalString(args.id), title: requireArg(args.title, "topic title"), description: optionalString(args.description), blackboardId: optionalString(args.blackboardId), author: parseBlackboardAuthorCli(args) as never, scope: parseBlackboardScopeCli(args) as never, tags: arrayArg(args.tag) });
  persist(run);
  return topic;
}

export function blackboardMessagePostCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const message = coord.postBlackboardMessage(run, { id: optionalString(args.id), topicId: requireArg(args.topic ?? args.topicId, "topic id"), blackboardId: optionalString(args.blackboardId), body: requireArg(args.body, "message body"), replyToId: optionalString(args.replyTo), visibility: optionalString(args.visibility) as never, author: parseBlackboardAuthorCli(args) as never, scope: parseBlackboardScopeCli(args) as never, links: parseBlackboardLinksCli(runId, args) as never, tags: arrayArg(args.tag), evidenceRefs: arrayArg(args.evidence), artifactRefIds: arrayArg(args.artifact) });
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
  const context = coord.putBlackboardContext(run, { id: optionalString(args.id), topicId: requireArg(args.topic ?? args.topicId, "topic id"), kind: requireArg(args.kind, "context kind") as never, key: optionalString(args.key), value: requireArg(args.value ?? args.body, "context value"), blackboardId: optionalString(args.blackboardId), supersedesContextIds: arrayArg(args.supersedes), author: parseBlackboardAuthorCli(args) as never, scope: parseBlackboardScopeCli(args) as never, links: parseBlackboardLinksCli(runId, args) as never, tags: arrayArg(args.tag), evidenceRefs: arrayArg(args.evidence), artifactRefIds: arrayArg(args.artifact) });
  persist(run);
  return context;
}

export function blackboardArtifactAddCli(args: Record<string, unknown>): unknown {
  const runId = requireArg(args.runId, "run id");
  const run = loadRun(args, runId);
  const artifact = coord.addBlackboardArtifact(run, { id: optionalString(args.id), topicId: optionalString(args.topic ?? args.topicId), kind: requireArg(args.kind, "artifact kind"), path: optionalString(args.path), locator: optionalString(args.locator), blackboardId: optionalString(args.blackboardId), source: optionalString(args.source), author: parseBlackboardAuthorCli(args) as never, scope: parseBlackboardScopeCli(args) as never, links: parseBlackboardLinksCli(runId, args) as never, tags: arrayArg(args.tag), evidenceRefs: arrayArg(args.evidence) });
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
  // `candidate register --worker <id>` — derive the worker's accepted
  // result/verifier state nodes (and result path) from the worker scope +
  // its backing task, so a candidate registered from a verified worker
  // carries the verifier gate the selection gate requires. Port of the old
  // orchestrator/candidate-operations.ts registerCandidate worker read
  // (v2's candidateRegisterCli only forwarded --result-node/--verifier-node).
  const workerId = optionalString(args.worker ?? args.workerId);
  const worker = workerId ? getWorkerScope(run, workerId) : undefined;
  if (workerId && !worker) throw new Error(`Unknown worker id for run ${run.id}: ${workerId}`);
  const workerOutput = worker?.output as { verifierNodeId?: string; resultPath?: string } | undefined;
  const task = worker ? run.tasks.find((entry) => entry.id === worker.taskId) : undefined;
  const resultNodeId = optionalString(args.resultNode) || worker?.resultNodeId || task?.resultNodeId;
  const verifierNodeId = optionalString(args.verifierNode) || workerOutput?.verifierNodeId || task?.verifierNodeId;
  const resultPath = optionalString(args.resultPath) || workerOutput?.resultPath || task?.resultPath;
  const candidate = cs.registerCandidate(run, {
    id: optionalString(args.id),
    kind: optionalString(args.kind) as never,
    workerId,
    taskId: optionalString(args.task ?? args.taskId) || worker?.taskId,
    resultNodeId,
    verifierNodeId,
    resultPath,
  });
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
  // `candidate summary` returns the operator candidate summary (with
  // readyForCommit/selected/problems/candidates), matching the old build's
  // summarizeCandidateOperatorRecords — not the bare counts.
  return summarizeCandidateOperatorRecords(run);
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
  // Read BOTH the MCP camelCase keys and the CLI kebab-case flags: the CLI
  // parser emits `--required-approvals` as `required-approvals`, not
  // `requiredApprovals`, so without the fallback every flag was silently
  // dropped and the CLI wrote the default policy (caught by parity-check's
  // cw --json vs cw_review_policy payload probe).
  const requiredApprovals = args.requiredApprovals ?? args["required-approvals"];
  const authorizedRoles = args.authorizedRoles ?? args["authorized-roles"];
  const allowSelfApproval = args.allowSelfApproval ?? args["allow-self-approval"];
  const requireAttestedActor = args.requireAttestedActor ?? args["require-attested-actor"];
  const appliesTo = args.appliesTo ?? args["applies-to"];
  const policy = collab.setReviewPolicy(run, { requiredApprovals: numberArg(requiredApprovals), authorizedRoles: arrayArg(authorizedRoles).length ? arrayArg(authorizedRoles) : optionalString(authorizedRoles), allowSelfApproval: allowSelfApproval === undefined ? undefined : boolArg(allowSelfApproval), requireAttestedActor: requireAttestedActor === undefined ? undefined : boolArg(requireAttestedActor), appliesTo: arrayArg(appliesTo).length ? (arrayArg(appliesTo) as never) : (optionalString(appliesTo) as never) });
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
