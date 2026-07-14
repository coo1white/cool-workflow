// shell/multi-agent-operator-ux.ts — the "Multi-Agent Operator UX" family
// (v0.1.21 + v0.1.27): the dependency / failure / evidence panels that the
// `multi-agent status|dependencies|failures|evidence` surfaces render.
//
// GAP #17. Port of the old build's src/multi-agent-operator-ux.ts data layer
// (summarizeMultiAgentOperator + deriveDependencies/deriveFailures/
// deriveEvidence + the three text formatters + graph). Byte-behavior
// preserved; adapted to v2's core/shell split:
//   - StateEvidence lives in core/state/types;
//   - CandidateScore lives in core/multi-agent/candidate-scoring;
//   - scores are read from disk the same way candidate-scoring-io.ts's
//     private readScores does (there is no validateCandidateScore in v2 —
//     the on-disk record is trusted, matching the io reader).
//
// Evidence: SPEC/multi-agent.md "Multi-Agent Operator UX";
// plugins/cool-workflow/src/multi-agent-operator-ux.ts (byte-exact source).

import * as fs from "node:fs";
import * as path from "node:path";
import { StateEvidence, WorkflowRun } from "../core/state/types";
import { CandidateScore } from "../core/multi-agent/candidate-scoring";
import { summarizeBlackboard } from "./coordinator-io";
import { summarizeMultiAgent } from "./multi-agent-io";
import { summarizeTopologies } from "./topology-io";
import { summarizeTrustAudit } from "./trust-audit";
import type { OperatorDigestInput } from "../core/state/state-explosion/report";
import { stableCompare } from "../core/util/collate";

export type MultiAgentOperatorEvidenceStatus =
  | "adopted"
  | "rejected"
  | "pending"
  | "superseded"
  | "conflicting"
  | "missing";

export interface MultiAgentOperatorDependency {
  id: string;
  from: string;
  to: string;
  label: string;
  status: string;
  reason?: string;
  nextCommand?: string;
}

export interface MultiAgentOperatorFailure {
  id: string;
  kind: string;
  status: string;
  owner?: string;
  linked?: string;
  reason: string;
  nextCommand: string;
}

export interface MultiAgentOperatorEvidence {
  id: string;
  ref?: string;
  path?: string;
  locator?: string;
  sourceKind: "worker" | "blackboard" | "coordinator" | "verifier" | "operator" | "runtime";
  sourceId?: string;
  adoptedBy: string[];
  rejectedBy: string[];
  pendingConsumers: string[];
  candidateIds: string[];
  scoreIds: string[];
  selectionIds: string[];
  commitIds: string[];
  provenanceSource?: string;
  status: MultiAgentOperatorEvidenceStatus;
  reason?: string;
  rationaleStatus?: "explained" | "unexplained" | "not-applicable";
  // v0.1.27: derived disposition separating evidence that BLOCKS progress
  // from evidence that is merely INSPECTABLE. After a verifier-gated commit
  // the decided selection path is done; pending/missing rows for sibling
  // roles that were never driven as separate workers are inspectable
  // operator state, not hidden failures.
  disposition?: "adopted" | "blocking" | "inspectable";
}

export interface MultiAgentOperatorStatus {
  schemaVersion: 1;
  runId: string;
  activeMultiAgentRunIds: string[];
  topologyRunIds: string[];
  topologyIds: string[];
  groups: string[];
  roles: string[];
  memberships: string[];
  fanouts: string[];
  fanins: string[];
  blocked: boolean;
  dependencies: MultiAgentOperatorDependency[];
  failures: MultiAgentOperatorFailure[];
  evidence: MultiAgentOperatorEvidence[];
  missingEvidence: MultiAgentOperatorEvidence[];
  adoptedEvidence: MultiAgentOperatorEvidence[];
  inspectableEvidence: MultiAgentOperatorEvidence[];
  nextAction: string;
  summaries: {
    topologies: ReturnType<typeof summarizeTopologies>;
    multiAgent: ReturnType<typeof summarizeMultiAgent>;
    blackboard: ReturnType<typeof summarizeBlackboard>;
    trust: ReturnType<typeof summarizeTrustAudit>;
  };
}

export interface MultiAgentOperatorGraph {
  runId: string;
  nodes: Array<{ id: string; kind: string; status: string; label: string; path?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

// Loose views over the run state (v2 stores these subsystems on the run as
// `unknown`-typed arrays; the operator-ux derivation only needs the fields
// below and treats everything else structurally).
interface MA {
  runs?: Array<{ id: string; status: string }>;
  roles?: Array<{ id: string; status: string }>;
  groups?: Array<{ id: string; multiAgentRunId: string; taskIds: string[] }>;
  memberships?: Array<{
    id: string;
    roleId: string;
    taskId: string;
    workerId?: string;
    status: string;
    resultNodeId?: string;
    verifierNodeId?: string;
    evidenceRefs?: string[];
    blackboardArtifactRefIds?: string[];
    blackboardMessageIds?: string[];
  }>;
  fanouts?: Array<{ id: string; groupId: string; roleIds: string[]; dispatchIds: string[] }>;
  fanins?: Array<{
    id: string;
    groupId: string;
    fanoutId?: string;
    status: string;
    verifierReady: boolean;
    blockedReasons: string[];
    missingRoleIds: string[];
    missingMembershipIds: string[];
    evidenceCoverage: Array<{
      membershipId: string;
      workerId?: string;
      complete: boolean;
      evidenceRefs: string[];
      blackboardArtifactRefIds?: string[];
      blackboardMessageIds?: string[];
    }>;
  }>;
}
function maOf(run: WorkflowRun): MA {
  return (run.multiAgent as unknown as MA | undefined) || {};
}
type Anys = Array<Record<string, unknown>>;
function candidatesOf(run: WorkflowRun): Anys {
  return ((run as unknown as { candidates?: Anys }).candidates || []);
}
function selectionsOf(run: WorkflowRun): Anys {
  return ((run as unknown as { candidateSelections?: Anys }).candidateSelections || []);
}
function commitsOf(run: WorkflowRun): Anys {
  return ((run as unknown as { commits?: Anys }).commits || []);
}
function workersOf(run: WorkflowRun): Anys {
  return ((run as unknown as { workers?: Anys }).workers || []);
}
function feedbackOf(run: WorkflowRun): Anys {
  return ((run as unknown as { feedback?: Anys }).feedback || []);
}
function topologyRunsOf(run: WorkflowRun): Anys {
  return ((run as unknown as { topologies?: { runs?: Anys } }).topologies?.runs || []);
}
function blackboardOf(run: WorkflowRun): {
  artifacts?: Anys;
  messages?: Anys;
  decisions?: Anys;
} {
  return ((run as unknown as { blackboard?: { artifacts?: Anys; messages?: Anys; decisions?: Anys } }).blackboard || {});
}

export function summarizeMultiAgentOperator(run: WorkflowRun): MultiAgentOperatorStatus {
  const topologies = summarizeTopologies(run);
  const multiAgent = summarizeMultiAgent(run);
  const blackboard = summarizeBlackboard(run);
  const trust = summarizeTrustAudit(run, { persist: (run as unknown as Record<string, unknown>).__cwWorkbenchReadOnlyProjection !== true });
  const dependencies = deriveDependencies(run);
  const failures = deriveFailures(run, dependencies);
  const evidence = deriveEvidence(run);
  const missingEvidence = evidence.filter((entry) => entry.status === "missing" || entry.status === "pending" || entry.status === "conflicting");
  const adoptedEvidence = evidence.filter((entry) => entry.status === "adopted");
  const inspectableEvidence = missingEvidence.filter((entry) => entry.disposition === "inspectable");
  const activeTopologyIds = new Set(topologies.active.map((entry) => entry.id));
  const activeMultiAgentRunIds = new Set(topologies.active.map((entry) => entry.multiAgentRunId));
  const state = maOf(run);
  const nextAction =
    failures[0]?.nextCommand ||
    topologies.nextAction ||
    (multiAgent as { nextAction?: string }).nextAction ||
    (blackboard as { nextAction?: string }).nextAction ||
    readyCommitCommand(run) ||
    `cw multi-agent status ${run.id} --json`;
  return {
    schemaVersion: 1,
    runId: run.id,
    activeMultiAgentRunIds: [...new Set([...activeMultiAgentRunIds, ...((state.runs || []).filter((entry) => !isTerminal(entry.status)).map((entry) => entry.id))])],
    topologyRunIds: [...activeTopologyIds],
    topologyIds: [...new Set(topologies.active.map((entry) => entry.topologyId))],
    groups: (state.groups || []).map((entry) => entry.id).sort(),
    roles: (state.roles || []).map((entry) => entry.id).sort(),
    memberships: (state.memberships || []).map((entry) => entry.id).sort(),
    fanouts: (state.fanouts || []).map((entry) => entry.id).sort(),
    fanins: (state.fanins || []).map((entry) => entry.id).sort(),
    blocked: failures.length > 0,
    dependencies,
    failures,
    evidence,
    missingEvidence,
    adoptedEvidence,
    inspectableEvidence,
    nextAction,
    summaries: { topologies, multiAgent, blackboard, trust },
  };
}

/** Adapt the operator status into the structural input `buildOperatorDigest`
 *  (core) folds into the state-explosion digest — the shell-side bridge that
 *  lets core stay free of `summarizeMultiAgentOperator`. */
export function operatorDigestInput(run: WorkflowRun): OperatorDigestInput {
  const status = summarizeMultiAgentOperator(run);
  return {
    failures: status.failures.map((f) => ({ id: f.id, kind: f.kind, status: f.status, reason: f.reason, nextCommand: f.nextCommand })),
    evidence: status.evidence.map((e) => ({ id: e.id, ref: e.ref, status: e.status, sourceId: e.sourceId })),
    nextAction: status.nextAction,
    trustEvents: (status.summaries.trust as { eventCount?: number } | undefined)?.eventCount || 0,
  };
}

export function buildMultiAgentOperatorGraph(run: WorkflowRun): MultiAgentOperatorGraph {
  const nodes = new Map<string, MultiAgentOperatorGraph["nodes"][number]>();
  const edges: MultiAgentOperatorGraph["edges"] = [];
  const addNode = (id: string, kind: string, status: string, label: string, filePath?: string) => {
    if (!id) return;
    if (!nodes.has(id)) nodes.set(id, { id, kind, status, label, path: filePath });
  };
  const state = maOf(run);
  for (const topology of topologyRunsOf(run)) {
    const id = String(topology.id);
    addNode(`${run.id}:topology:${id}`, "topology-run", String(topology.status), `topology ${topology.topologyId}`);
  }
  for (const group of state.groups || []) addNode(`${run.id}:multi-agent:group:${group.id}`, "agent-group", "running", `group ${group.id}`);
  for (const role of state.roles || []) addNode(`${run.id}:multi-agent:role:${role.id}`, "agent-role", role.status, `role ${role.id}`);
  for (const membership of state.memberships || []) addNode(`${run.id}:multi-agent:membership:${membership.id}`, "agent-membership", membership.status, `membership ${membership.id}`);
  for (const fanout of state.fanouts || []) addNode(`${run.id}:multi-agent:fanout:${fanout.id}`, "agent-fanout", "running", `fanout ${fanout.id}`);
  for (const fanin of state.fanins || []) addNode(`${run.id}:multi-agent:fanin:${fanin.id}`, "agent-fanin", fanin.status, `fanin ${fanin.id}`);
  for (const candidate of candidatesOf(run)) addNode(`${run.id}:candidate:${candidate.id}`, "candidate", String(candidate.status), `candidate ${candidate.id}`);
  for (const candidate of candidatesOf(run)) for (const scoreId of (candidate.scores as string[] | undefined) || []) addNode(`${run.id}:score:${scoreId}`, "score", "completed", `score ${scoreId}`);
  for (const selection of selectionsOf(run)) addNode(`${run.id}:selection:${selection.id}`, "selection", "accepted", `selection ${selection.id}`);
  for (const commit of commitsOf(run)) addNode(String(commit.stateNodeId || `${run.id}:commit:${commit.id}`), "commit", commit.verifierGated ? "committed" : "checkpoint", `commit ${commit.id}`);
  for (const artifact of blackboardOf(run).artifacts || []) addNode(`${run.id}:blackboard:artifact:${artifact.id}`, "blackboard-artifact", String(artifact.status || "pending"), `artifact ${artifact.id}`, artifact.path as string | undefined);
  for (const dependency of deriveDependencies(run)) {
    edges.push({ from: dependency.from, to: dependency.to, label: relabel(dependency.label) });
  }
  return { runId: run.id, nodes: [...nodes.values()], edges: uniqueEdges(edges) };
}

export function formatMultiAgentOperatorStatus(status: MultiAgentOperatorStatus): string {
  return [
    `Multi-Agent Operator Status: ${status.runId}`,
    `Active Runs: ${status.activeMultiAgentRunIds.join(", ") || "none"}`,
    `Topologies: ${status.topologyIds.join(", ") || "none"} (${status.topologyRunIds.join(", ") || "none"})`,
    `Blocked: ${status.blocked ? "yes" : "no"}`,
    "",
    "Agent Graph",
    `  roles=${status.roles.length}; groups=${status.groups.length}; memberships=${status.memberships.length}; fanout=${status.fanouts.length}; fanin=${status.fanins.length}`,
    "",
    formatDependencies(status.dependencies),
    "",
    formatFailures(status.failures),
    "",
    formatEvidence("Adopted Evidence", status.adoptedEvidence),
    "",
    formatEvidence(
      status.inspectableEvidence.length
        ? `Missing Evidence (blocking=${status.missingEvidence.length - status.inspectableEvidence.length}, inspectable=${status.inspectableEvidence.length}; a verifier-gated commit decided the selection — inspectable rows are not failures)`
        : "Missing Evidence",
      status.missingEvidence
    ),
    "",
    "Next Action",
    `  ${status.nextAction}`,
  ].join("\n");
}

export function formatMultiAgentDependencies(rows: MultiAgentOperatorDependency[]): string {
  return formatDependencies(rows);
}

export function formatMultiAgentFailures(rows: MultiAgentOperatorFailure[]): string {
  return formatFailures(rows);
}

export function formatMultiAgentEvidence(rows: MultiAgentOperatorEvidence[]): string {
  return formatEvidence("Evidence Adoption", rows);
}

function deriveDependencies(run: WorkflowRun): MultiAgentOperatorDependency[] {
  const rows: MultiAgentOperatorDependency[] = [];
  const add = (from: string | undefined, to: string | undefined, label: string, status = "known", reason?: string, nextCommand?: string) => {
    if (!from || !to) return;
    rows.push({ id: `${from}->${to}:${label}`, from, to, label, status, reason, nextCommand });
  };
  const state = maOf(run);
  for (const topology of topologyRunsOf(run)) {
    const id = String(topology.id);
    add(`${run.id}:topology:${id}`, `${run.id}:multi-agent:${topology.multiAgentRunId}`, "owns");
    add(`${run.id}:topology:${id}`, `${run.id}:blackboard:${topology.blackboardId}`, "owns");
    for (const fanoutId of (topology.fanoutIds as string[] | undefined) || []) add(`${run.id}:topology:${id}`, `${run.id}:multi-agent:fanout:${fanoutId}`, "fanout");
    for (const faninId of (topology.faninIds as string[] | undefined) || []) add(`${run.id}:multi-agent:fanin:${faninId}`, `${run.id}:topology:${id}`, "reports");
    for (const candidateId of (topology.candidateIds as string[] | undefined) || []) add(`${run.id}:topology:${id}`, `${run.id}:candidate:${candidateId}`, "candidate");
    for (const selectionId of (topology.selectionIds as string[] | undefined) || []) add(`${run.id}:selection:${selectionId}`, `${run.id}:topology:${id}`, "selects");
  }
  for (const group of state.groups || []) {
    add(`${run.id}:multi-agent:${group.multiAgentRunId}`, `${run.id}:multi-agent:group:${group.id}`, "owns");
    for (const taskId of group.taskIds || []) add(`${run.id}:multi-agent:group:${group.id}`, `${run.id}:task:${taskId}`, "depends-on");
  }
  for (const fanout of state.fanouts || []) {
    add(`${run.id}:multi-agent:group:${fanout.groupId}`, `${run.id}:multi-agent:fanout:${fanout.id}`, "fanout");
    for (const roleId of fanout.roleIds || []) add(`${run.id}:multi-agent:fanout:${fanout.id}`, `${run.id}:multi-agent:role:${roleId}`, "depends-on");
    for (const dispatchId of fanout.dispatchIds || []) add(`${run.id}:multi-agent:fanout:${fanout.id}`, `${run.id}:dispatch:${dispatchId}`, "dispatches");
  }
  for (const membership of state.memberships || []) {
    add(`${run.id}:multi-agent:role:${membership.roleId}`, `${run.id}:multi-agent:membership:${membership.id}`, "owns");
    add(`${run.id}:multi-agent:membership:${membership.id}`, `${run.id}:task:${membership.taskId}`, "depends-on");
    add(`${run.id}:multi-agent:membership:${membership.id}`, membership.workerId ? `${run.id}:worker:${membership.workerId}` : undefined, "dispatches");
    add(membership.resultNodeId, `${run.id}:multi-agent:membership:${membership.id}`, "reports");
    add(membership.verifierNodeId, `${run.id}:multi-agent:membership:${membership.id}`, "gates");
    for (const artifactId of membership.blackboardArtifactRefIds || []) add(`${run.id}:blackboard:artifact:${artifactId}`, `${run.id}:multi-agent:membership:${membership.id}`, "cites");
    for (const messageId of membership.blackboardMessageIds || []) add(`${run.id}:blackboard:message:${messageId}`, `${run.id}:multi-agent:membership:${membership.id}`, "cites");
  }
  for (const fanin of state.fanins || []) {
    add(fanin.fanoutId ? `${run.id}:multi-agent:fanout:${fanin.fanoutId}` : `${run.id}:multi-agent:group:${fanin.groupId}`, `${run.id}:multi-agent:fanin:${fanin.id}`, "fanin");
    for (const coverage of fanin.evidenceCoverage || []) {
      add(`${run.id}:multi-agent:membership:${coverage.membershipId}`, `${run.id}:multi-agent:fanin:${fanin.id}`, coverage.complete ? "adopted-by" : "blocks", coverage.complete ? "ready" : "blocked", coverage.complete ? undefined : "membership has not reported required evidence", `cw worker manifest ${run.id} ${coverage.workerId || "<worker-id>"}`);
    }
  }
  for (const candidate of candidatesOf(run)) {
    add(candidate.workerId ? `${run.id}:worker:${candidate.workerId}` : (candidate.resultNodeId as string | undefined), `${run.id}:candidate:${candidate.id}`, "reports", String(candidate.status));
    for (const scoreId of (candidate.scores as string[] | undefined) || []) add(`${run.id}:candidate:${candidate.id}`, `${run.id}:score:${scoreId}`, "scores", "completed");
  }
  for (const selection of selectionsOf(run)) {
    add(`${run.id}:candidate:${selection.candidateId}`, `${run.id}:selection:${selection.id}`, "selects", "accepted");
    add(selection.scoreId ? `${run.id}:score:${selection.scoreId}` : undefined, `${run.id}:selection:${selection.id}`, "scores", "accepted");
  }
  for (const commit of commitsOf(run)) {
    add(commit.selectionId ? `${run.id}:selection:${commit.selectionId}` : undefined, String(commit.stateNodeId || `${run.id}:commit:${commit.id}`), "commits", commit.verifierGated ? "committed" : "checkpoint");
  }
  return uniqueById(rows).sort((left, right) => stableCompare(left.from, right.from) || stableCompare(left.to, right.to));
}

function deriveFailures(run: WorkflowRun, dependencies: MultiAgentOperatorDependency[]): MultiAgentOperatorFailure[] {
  const rows: MultiAgentOperatorFailure[] = [];
  const add = (id: string, kind: string, status: string, reason: string, nextCommand: string, owner?: string, linked?: string) => {
    rows.push({ id, kind, status, owner, linked, reason, nextCommand });
  };
  const state = maOf(run);
  // Grouped/indexed once instead of re-filtering/re-scanning the whole
  // memberships/workers array per role/membership below (O(roles x
  // memberships) and O(memberships x workers) otherwise -- the same
  // array-scan-per-item shape 024b007 fixed for phase/task selection).
  const membershipsByRole = new Map<string, typeof state.memberships>();
  for (const entry of state.memberships || []) {
    const list = membershipsByRole.get(entry.roleId);
    if (list) list.push(entry);
    else membershipsByRole.set(entry.roleId, [entry]);
  }
  const workersById = new Map(workersOf(run).map((entry) => [entry.id, entry]));
  for (const role of state.roles || []) {
    const memberships = membershipsByRole.get(role.id) || [];
    if (!memberships.length && role.status !== "completed" && role.status !== "cancelled") {
      add(role.id, "missing-role-coverage", role.status, `role ${role.id} has no membership`, `cw multi-agent step ${run.id}`, role.id);
    }
    if (role.status === "blocked" || role.status === "cancelled") add(role.id, "agent-role", role.status, `role ${role.id} is ${role.status}`, `cw multi-agent status ${run.id} --json`, role.id);
  }
  for (const membership of state.memberships || []) {
    const worker = membership.workerId ? workersById.get(membership.workerId) : undefined;
    if (membership.status === "failed" || membership.status === "cancelled") add(membership.id, "agent-membership", membership.status, `membership ${membership.id} is ${membership.status}`, `cw multi-agent membership ${run.id} ${membership.id}`, membership.roleId, membership.workerId);
    if (!membership.workerId) add(membership.id, "missing-worker", membership.status, `membership ${membership.id} has no worker`, `cw multi-agent step ${run.id}`, membership.roleId, membership.taskId);
    if (worker && (worker.status === "failed" || worker.status === "rejected")) add(String(worker.id), "worker", String(worker.status), (worker.errors as Array<{ message?: string }> | undefined)?.[0]?.message || `worker ${worker.id} is ${worker.status}`, `cw worker show ${run.id} ${worker.id}`, membership.roleId, membership.id);
    if (worker && (worker.status === "allocated" || worker.status === "running")) add(String(worker.id), "worker-output", String(worker.status), `worker ${worker.id} has not reported output`, `cw worker manifest ${run.id} ${worker.id}`, membership.roleId, membership.id);
  }
  for (const fanin of state.fanins || []) {
    for (const reason of fanin.blockedReasons || []) add(fanin.id, "fanin", fanin.status, reason, `cw multi-agent failures ${run.id}`, fanin.groupId, fanin.fanoutId);
    for (const roleId of fanin.missingRoleIds || []) add(`${fanin.id}:${roleId}`, "missing-role-evidence", "missing", `fanin ${fanin.id} is missing role ${roleId}`, `cw multi-agent step ${run.id}`, roleId, fanin.id);
    for (const membershipId of fanin.missingMembershipIds || []) add(`${fanin.id}:${membershipId}`, "missing-membership-evidence", "missing", `fanin ${fanin.id} is missing membership ${membershipId}`, `cw multi-agent membership ${run.id} ${membershipId}`, membershipId, fanin.id);
  }
  for (const topology of topologyRunsOf(run)) {
    for (const missing of (topology.missingEvidence as string[] | undefined) || []) add(`${topology.id}:${missing}`, "missing-topology-evidence", "missing", missing, (topology.nextActions as string[] | undefined)?.[0] || `cw topology summary ${run.id}`, String(topology.id));
    if (topology.status === "blocked" || topology.status === "failed") add(String(topology.id), "topology", String(topology.status), `topology ${topology.id} is ${topology.status}`, `cw topology summary ${run.id}`, String(topology.id));
  }
  for (const feedback of feedbackOf(run)) {
    if (feedback.status === "open" || feedback.status === "tasked") add(String(feedback.id), String(feedback.classification), String(feedback.status), String(feedback.message), `cw feedback show ${run.id} ${feedback.id}`, feedback.taskId as string | undefined, feedback.nodeId as string | undefined);
  }
  for (const candidate of candidatesOf(run)) {
    const scores = (candidate.scores as string[] | undefined) || [];
    if (candidate.status === "rejected" || candidate.status === "failed") add(String(candidate.id), "candidate", String(candidate.status), (candidate.feedbackIds as string[] | undefined)?.[0] || `candidate ${candidate.id} is ${candidate.status}`, `cw candidate show ${run.id} ${candidate.id}`, candidate.workerId as string | undefined, candidate.taskId as string | undefined);
    if (!scores.length && candidate.status !== "rejected" && candidate.status !== "failed") add(String(candidate.id), "candidate-score-gap", String(candidate.status), `candidate ${candidate.id} has no score`, `cw multi-agent score ${run.id} --candidate ${candidate.id} --evidence <path-or-ref>`, candidate.workerId as string | undefined, candidate.taskId as string | undefined);
    if (!candidate.verifierNodeId) add(`${candidate.id}:verifier`, "candidate-verifier-gap", String(candidate.status), `candidate ${candidate.id} has no verifier gate`, `cw candidate show ${run.id} ${candidate.id}`, candidate.workerId as string | undefined, candidate.taskId as string | undefined);
  }
  if (candidatesOf(run).some((candidate) => ((candidate.scores as string[] | undefined) || []).length) && !selectionsOf(run).length) {
    add("selection-gap", "selection", "missing", "scored candidates exist but no selection is recorded", `cw multi-agent select ${run.id} --candidate <candidate-id> --reason "<rationale>"`);
  }
  for (const dep of dependencies.filter((entry) => entry.status === "blocked")) add(dep.id, "ambiguous-dependency", dep.status, dep.reason || "dependency is blocked", dep.nextCommand || `cw multi-agent status ${run.id} --json`);
  const readySelection = firstUngatedSelection(run);
  if (readySelection) add(String(readySelection.id), "commit-gate", "not-ready", `selection ${readySelection.id} has no verifier-gated commit`, `cw commit ${run.id} --selection ${readySelection.id} --reason "<verified rationale>"`, readySelection.candidateId as string | undefined);
  return uniqueByFailure(rows).sort((left, right) => stableCompare(left.kind, right.kind) || stableCompare(left.id, right.id));
}

function deriveEvidence(run: WorkflowRun): MultiAgentOperatorEvidence[] {
  const rows = new Map<string, MultiAgentOperatorEvidence>();
  const ensure = (key: string, patch: Partial<MultiAgentOperatorEvidence>): MultiAgentOperatorEvidence => {
    const existing = rows.get(key);
    const next: MultiAgentOperatorEvidence = existing || {
      id: key,
      sourceKind: "runtime",
      adoptedBy: [],
      rejectedBy: [],
      pendingConsumers: [],
      candidateIds: [],
      scoreIds: [],
      selectionIds: [],
      commitIds: [],
      status: "pending",
    };
    Object.assign(next, patch);
    next.adoptedBy = unique([...(next.adoptedBy || []), ...(patch.adoptedBy || [])]);
    next.rejectedBy = unique([...(next.rejectedBy || []), ...(patch.rejectedBy || [])]);
    next.pendingConsumers = unique([...(next.pendingConsumers || []), ...(patch.pendingConsumers || [])]);
    next.candidateIds = unique([...(next.candidateIds || []), ...(patch.candidateIds || [])]);
    next.scoreIds = unique([...(next.scoreIds || []), ...(patch.scoreIds || [])]);
    next.selectionIds = unique([...(next.selectionIds || []), ...(patch.selectionIds || [])]);
    next.commitIds = unique([...(next.commitIds || []), ...(patch.commitIds || [])]);
    rows.set(key, next);
    return next;
  };
  const addEvidence = (evidence: StateEvidence[], patch: Partial<MultiAgentOperatorEvidence>) => {
    for (const item of evidence || []) {
      const key = evidenceKey(item);
      ensure(key, {
        ref: item.summary || item.locator || item.path || item.id,
        path: item.path,
        locator: item.locator,
        provenanceSource: (item as { provenance?: { source?: string } }).provenance?.source,
        sourceId: provenanceSourceId(item) || patch.sourceId,
        sourceKind: sourceKindFromEvidence(item, patch.sourceKind),
        ...patch,
      });
    }
  };
  for (const worker of workersOf(run)) {
    const output = worker.output as { resultPath?: string } | undefined;
    if (output?.resultPath) ensure(output.resultPath, { path: output.resultPath, sourceKind: "worker", sourceId: String(worker.id), status: worker.status === "verified" ? "adopted" : "pending", adoptedBy: worker.status === "verified" ? [String(worker.id)] : [], pendingConsumers: worker.status === "verified" ? [] : [String(worker.id)] });
  }
  for (const membership of maOf(run).memberships || []) {
    for (const ref of membership.evidenceRefs || []) ensure(ref, { ref, sourceKind: "worker", sourceId: membership.workerId || membership.id, status: membership.status === "reported" || membership.status === "verified" ? "adopted" : "pending", adoptedBy: membership.status === "reported" || membership.status === "verified" ? [membership.id] : [], pendingConsumers: membership.status === "reported" || membership.status === "verified" ? [] : [membership.id] });
    for (const artifactId of membership.blackboardArtifactRefIds || []) ensure(artifactId, { ref: artifactId, sourceKind: "blackboard", sourceId: membership.id, status: "adopted", adoptedBy: [membership.id] });
    for (const messageId of membership.blackboardMessageIds || []) ensure(messageId, { ref: messageId, sourceKind: "blackboard", sourceId: membership.id, status: "adopted", adoptedBy: [membership.id] });
  }
  for (const artifact of blackboardOf(run).artifacts || []) {
    ensure(String(artifact.id), { ref: (artifact.locator as string | undefined) || (artifact.path as string | undefined) || String(artifact.id), path: artifact.path as string | undefined, locator: artifact.locator as string | undefined, sourceKind: "blackboard", sourceId: artifact.source as string | undefined, provenanceSource: (artifact.provenance as { auditEventIds?: string[] } | undefined)?.auditEventIds?.[0], status: artifact.status === "rejected" ? "rejected" : artifact.status === "superseded" ? "superseded" : artifact.status === "conflicting" ? "conflicting" : "pending" });
    for (const ref of (artifact.evidenceRefs as string[] | undefined) || []) ensure(ref, { ref, sourceKind: "blackboard", sourceId: String(artifact.id), status: "pending", pendingConsumers: [String(artifact.id)] });
  }
  for (const message of blackboardOf(run).messages || []) {
    ensure(String(message.id), { ref: String(message.id), sourceKind: "blackboard", sourceId: (message.author as { id?: string } | undefined)?.id, status: message.status === "rejected" ? "rejected" : message.status === "superseded" ? "superseded" : "pending" });
    for (const ref of (message.linkedEvidenceRefs as string[] | undefined) || []) ensure(ref, { ref, sourceKind: "blackboard", sourceId: String(message.id), status: "pending", pendingConsumers: [String(message.id)] });
  }
  for (const decision of blackboardOf(run).decisions || []) {
    for (const ref of [...((decision.evidenceRefs as string[] | undefined) || []), ...((decision.artifactRefIds as string[] | undefined) || []), ...((decision.messageIds as string[] | undefined) || [])]) {
      ensure(ref, { ref, sourceKind: "coordinator", sourceId: String(decision.id), status: evidenceStatusForDecision(String(decision.outcome)), adoptedBy: decision.outcome === "accepted" || decision.outcome === "ready" ? [String(decision.id)] : [], rejectedBy: decision.outcome === "rejected" ? [String(decision.id)] : [] });
    }
  }
  for (const fanin of maOf(run).fanins || []) {
    for (const coverage of fanin.evidenceCoverage || []) {
      for (const ref of [...coverage.evidenceRefs, ...(coverage.blackboardArtifactRefIds || []), ...(coverage.blackboardMessageIds || [])]) ensure(ref, { ref, sourceKind: "worker", sourceId: coverage.workerId || coverage.membershipId, status: coverage.complete && fanin.verifierReady ? "adopted" : "pending", adoptedBy: coverage.complete ? [fanin.id] : [], pendingConsumers: coverage.complete ? [] : [fanin.id] });
    }
    for (const roleId of fanin.missingRoleIds || []) ensure(`${fanin.id}:missing-role:${roleId}`, { ref: roleId, sourceKind: "runtime", sourceId: fanin.id, status: "missing", pendingConsumers: [fanin.id], reason: `fanin ${fanin.id} requires role ${roleId}` });
    for (const membershipId of fanin.missingMembershipIds || []) ensure(`${fanin.id}:missing-membership:${membershipId}`, { ref: membershipId, sourceKind: "runtime", sourceId: fanin.id, status: "missing", pendingConsumers: [fanin.id], reason: `fanin ${fanin.id} requires membership ${membershipId}` });
  }
  for (const candidate of candidatesOf(run)) {
    addEvidence((candidate.evidence as StateEvidence[] | undefined) || [], { status: candidate.status === "rejected" || candidate.status === "failed" ? "rejected" : "pending", sourceKind: "worker", sourceId: (candidate.workerId as string | undefined) || String(candidate.id), candidateIds: [String(candidate.id)], rejectedBy: candidate.status === "rejected" || candidate.status === "failed" ? [String(candidate.id)] : [] });
    for (const score of readScores(run, String(candidate.id))) addEvidence(score.evidence, { status: score.verdict === "fail" ? "rejected" : "adopted", sourceKind: "operator", sourceId: score.scorer, candidateIds: [String(candidate.id)], scoreIds: [score.id], adoptedBy: score.verdict === "fail" ? [] : [score.id], rejectedBy: score.verdict === "fail" ? [score.id] : [] });
  }
  for (const selection of selectionsOf(run)) {
    addEvidence((selection.evidence as StateEvidence[] | undefined) || [], { status: "adopted", sourceKind: "verifier", sourceId: (selection.verifierNodeId as string | undefined) || String(selection.id), candidateIds: [String(selection.candidateId)], selectionIds: [String(selection.id)], scoreIds: selection.scoreId ? [String(selection.scoreId)] : [], adoptedBy: [String(selection.id)] });
  }
  for (const commit of commitsOf(run)) {
    addEvidence((commit.evidence as StateEvidence[] | undefined) || [], { status: commit.verifierGated ? "adopted" : "pending", sourceKind: "runtime", sourceId: String(commit.id), selectionIds: commit.selectionId ? [String(commit.selectionId)] : [], candidateIds: commit.candidateId ? [String(commit.candidateId)] : [], commitIds: [String(commit.id)], adoptedBy: commit.verifierGated ? [String(commit.id)] : [], pendingConsumers: commit.verifierGated ? [] : [String(commit.id)] });
  }
  for (const topology of topologyRunsOf(run)) {
    for (const missing of (topology.missingEvidence as string[] | undefined) || []) ensure(`${topology.id}:missing:${missing}`, { ref: missing, sourceKind: "runtime", sourceId: String(topology.id), status: "missing", pendingConsumers: [String(topology.id)], reason: missing });
  }
  const committed = commitsOf(run).some((commit) => commit.verifierGated);
  const blocks = (status: MultiAgentOperatorEvidenceStatus): boolean => status === "missing" || status === "pending" || status === "conflicting";
  const withDisposition = (row: MultiAgentOperatorEvidence): MultiAgentOperatorEvidence => ({
    ...row,
    disposition: row.status === "adopted" ? "adopted" : blocks(row.status) && !committed ? "blocking" : "inspectable",
  });
  return [...rows.values()]
    .map(normalizeEvidenceStatus)
    .map(withDisposition)
    .sort((left, right) => statusRank(left.status) - statusRank(right.status) || stableCompare(left.id, right.id));
}

function formatDependencies(rows: MultiAgentOperatorDependency[]): string {
  const lines = ["Dependencies"];
  if (!rows.length) return [...lines, "  none"].join("\n");
  for (const row of rows.slice(0, 80)) lines.push(`  [${row.status}] ${row.from} -> ${row.to} (${row.label})${row.reason ? `: ${row.reason}` : ""}`);
  if (rows.length > 80) lines.push(`  ... ${rows.length - 80} more`);
  return lines.join("\n");
}

function formatFailures(rows: MultiAgentOperatorFailure[]): string {
  const lines = ["Failed / Blocked Agents"];
  if (!rows.length) return [...lines, "  none"].join("\n");
  for (const row of rows.slice(0, 40)) lines.push(`  [${row.status}] ${row.kind} ${row.id}${row.owner ? ` owner=${row.owner}` : ""}${row.linked ? ` linked=${row.linked}` : ""}: ${row.reason}; next=${row.nextCommand}`);
  if (rows.length > 40) lines.push(`  ... ${rows.length - 40} more`);
  return lines.join("\n");
}

function formatEvidence(title: string, rows: MultiAgentOperatorEvidence[]): string {
  const lines = [title];
  if (!rows.length) return [...lines, "  none"].join("\n");
  for (const row of rows.slice(0, 60)) {
    const ref = row.locator || row.path || row.ref || row.id;
    const adopted = row.adoptedBy.length ? ` adoptedBy=${row.adoptedBy.join(",")}` : "";
    const rejected = row.rejectedBy.length ? ` rejectedBy=${row.rejectedBy.join(",")}` : "";
    const pending = row.pendingConsumers.length ? ` pending=${row.pendingConsumers.join(",")}` : "";
    const rationale = row.rationaleStatus ? ` rationale=${row.rationaleStatus}` : "";
    const disposition = row.disposition === "inspectable" ? " disposition=inspectable" : "";
    lines.push(`  [${row.status}] ${row.id} ${ref} source=${row.sourceKind}:${row.sourceId || "unknown"}${rationale}${disposition}${adopted}${rejected}${pending}`);
  }
  if (rows.length > 60) lines.push(`  ... ${rows.length - 60} more`);
  return lines.join("\n");
}

function readScores(run: WorkflowRun, candidateId: string): CandidateScore[] {
  const candidatesDir = run.paths.candidatesDir || path.join(run.paths.runDir, "candidates");
  const dir = path.join(candidatesDir, safeFileName(candidateId), "scores");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as CandidateScore);
}

/** The first selection with no verifier-gated commit yet, if any -- shared
 *  by deriveFailures and readyCommitCommand. A Set of already-gated
 *  selection ids, built once, replaces re-scanning ALL commits per
 *  selection (O(selections x commits) otherwise -- the same array-scan-
 *  per-item shape 024b007 fixed for phase/task selection). */
function firstUngatedSelection(run: WorkflowRun): ReturnType<typeof selectionsOf>[number] | undefined {
  const gatedSelectionIds = new Set(commitsOf(run).filter((commit) => commit.verifierGated).map((commit) => commit.selectionId));
  return selectionsOf(run).find((entry) => !gatedSelectionIds.has(entry.id));
}

function readyCommitCommand(run: WorkflowRun): string | undefined {
  const selection = firstUngatedSelection(run);
  return selection ? `cw commit ${run.id} --selection ${selection.id} --reason "<verified rationale>"` : undefined;
}

function normalizeEvidenceStatus(row: MultiAgentOperatorEvidence): MultiAgentOperatorEvidence {
  if (row.rejectedBy.length) row.status = "rejected";
  else if (row.adoptedBy.length && row.commitIds.length) row.status = "adopted";
  else if (row.adoptedBy.length && row.status !== "missing" && row.status !== "conflicting" && row.status !== "superseded") row.status = "adopted";
  return row;
}

function evidenceKey(evidence: StateEvidence): string {
  return evidence.id || evidence.locator || evidence.path || evidence.summary || "evidence";
}

function provenanceSourceId(item: StateEvidence): string | undefined {
  const provenance = (item as { provenance?: { workerId?: string; candidateId?: string; selectionId?: string; commitId?: string } }).provenance;
  return provenance?.workerId || provenance?.candidateId || provenance?.selectionId || provenance?.commitId;
}

function sourceKindFromEvidence(evidence: StateEvidence, fallback?: MultiAgentOperatorEvidence["sourceKind"]): MultiAgentOperatorEvidence["sourceKind"] {
  if (fallback) return fallback;
  const provenance = (evidence as { provenance?: { workerId?: string; verifierNodeId?: string; source?: string } }).provenance;
  if (provenance?.workerId) return "worker";
  if (provenance?.verifierNodeId) return "verifier";
  if (provenance?.source === "operator-recorded") return "operator";
  return "runtime";
}

function statusRank(status: MultiAgentOperatorEvidenceStatus): number {
  return { adopted: 0, pending: 1, missing: 2, conflicting: 3, rejected: 4, superseded: 5 }[status];
}

function evidenceStatusForDecision(outcome: string): MultiAgentOperatorEvidenceStatus {
  if (outcome === "accepted" || outcome === "ready") return "adopted";
  if (outcome === "rejected") return "rejected";
  if (outcome === "superseded") return "superseded";
  if (outcome === "conflicting") return "conflicting";
  return "pending";
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function relabel(label?: string): string | undefined {
  if (!label) return "depends-on";
  if (label === "blackboard" || label === "task") return "depends-on";
  if (label === "dispatch") return "dispatches";
  if (label === "reported" || label === "result" || label === "message") return "reports";
  if (label === "evidence") return "cites";
  return label;
}

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

// Each dedup below keeps the FIRST occurrence of a duplicate key, same as
// the `values.findIndex(...) === index` shape it replaces -- a Set of seen
// keys does this in one O(N) pass instead of an O(N) findIndex per item
// (O(N^2) total; this was the dominant cost of deriveDependencies/
// deriveFailures at large membership counts, found while pinning perf
// cycle P1-1's review-fix regression test).
function uniqueById<T extends { id: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    if (seen.has(value.id)) continue;
    seen.add(value.id);
    result.push(value);
  }
  return result;
}

function uniqueByFailure(values: MultiAgentOperatorFailure[]): MultiAgentOperatorFailure[] {
  const seen = new Set<string>();
  const result: MultiAgentOperatorFailure[] = [];
  for (const value of values) {
    const key = `${value.id}\0${value.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function uniqueEdges(edges: MultiAgentOperatorGraph["edges"]): MultiAgentOperatorGraph["edges"] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
