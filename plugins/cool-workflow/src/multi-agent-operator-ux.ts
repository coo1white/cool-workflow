import fs from "node:fs";
import path from "node:path";
import {
  AgentFanin,
  AgentMembership,
  CandidateScore,
  StateEvidence,
  WorkflowRun
} from "./types";
import { buildBlackboardGraph, summarizeBlackboard } from "./coordinator";
import { buildMultiAgentGraph, summarizeMultiAgent } from "./multi-agent";
import { buildTopologyGraph, summarizeTopologies } from "./topology";
import { summarizeTrustAudit } from "./trust-audit";

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
  // v0.1.26: derived adoption-rationale status, attached by the runner from the
  // Evidence Adoption Reasoning Chain. Optional + additive so pre-v0.1.26
  // consumers and snapshots ignore it (STABLE INTERFACES & BACKWARD COMPAT).
  rationaleStatus?: "explained" | "unexplained" | "not-applicable";
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

export function summarizeMultiAgentOperator(run: WorkflowRun): MultiAgentOperatorStatus {
  const topologies = summarizeTopologies(run);
  const multiAgent = summarizeMultiAgent(run);
  const blackboard = summarizeBlackboard(run);
  const trust = summarizeTrustAudit(run);
  const dependencies = deriveDependencies(run);
  const failures = deriveFailures(run, dependencies);
  const evidence = deriveEvidence(run);
  const missingEvidence = evidence.filter((entry) => entry.status === "missing" || entry.status === "pending" || entry.status === "conflicting");
  const adoptedEvidence = evidence.filter((entry) => entry.status === "adopted");
  const activeTopologyIds = new Set(topologies.active.map((entry) => entry.id));
  const activeMultiAgentRunIds = new Set(topologies.active.map((entry) => entry.multiAgentRunId));
  const state = run.multiAgent;
  const nextAction = failures[0]?.nextCommand ||
    topologies.nextAction ||
    multiAgent.nextAction ||
    blackboard.nextAction ||
    readyCommitCommand(run) ||
    `node scripts/cw.js multi-agent status ${run.id} --json`;
  return {
    schemaVersion: 1,
    runId: run.id,
    activeMultiAgentRunIds: [...activeMultiAgentRunIds, ...((state?.runs || []).filter((entry) => !isTerminal(entry.status)).map((entry) => entry.id))].filter(uniqueFilter),
    topologyRunIds: [...activeTopologyIds],
    topologyIds: topologies.active.map((entry) => entry.topologyId).filter(uniqueFilter),
    groups: (state?.groups || []).map((entry) => entry.id).sort(),
    roles: (state?.roles || []).map((entry) => entry.id).sort(),
    memberships: (state?.memberships || []).map((entry) => entry.id).sort(),
    fanouts: (state?.fanouts || []).map((entry) => entry.id).sort(),
    fanins: (state?.fanins || []).map((entry) => entry.id).sort(),
    blocked: failures.length > 0,
    dependencies,
    failures,
    evidence,
    missingEvidence,
    adoptedEvidence,
    nextAction,
    summaries: { topologies, multiAgent, blackboard, trust }
  };
}

export function buildMultiAgentOperatorGraph(run: WorkflowRun): MultiAgentOperatorGraph {
  const nodes = new Map<string, MultiAgentOperatorGraph["nodes"][number]>();
  const edges: MultiAgentOperatorGraph["edges"] = [];
  const addNode = (id: string | undefined, kind: string, status: string, label: string, pathValue?: string) => {
    if (!id) return;
    nodes.set(id, { id, kind, status, label, path: pathValue });
  };
  const addEdge = (from: string | undefined, to: string | undefined, label?: string) => {
    if (!from || !to) return;
    edges.push({ from, to, label });
  };

  addNode(`${run.id}:run`, "multi-agent-run-root", run.loopStage, run.id, run.paths.state);
  for (const graph of [buildTopologyGraph(run), buildMultiAgentGraph(run), buildBlackboardGraph(run)]) {
    for (const node of graph.nodes) addNode(node.id, node.kind, node.status, node.label, node.path);
    for (const edge of graph.edges) addEdge(edge.from, edge.to, relabel(edge.label));
  }
  for (const task of run.tasks || []) {
    addNode(`${run.id}:task:${task.id}`, "task", task.status, task.id, task.taskPath);
    addEdge(`${run.id}:run`, `${run.id}:task:${task.id}`, "owns");
    addEdge(`${run.id}:task:${task.id}`, task.dispatchId ? `${run.id}:dispatch:${task.dispatchId}` : undefined, "dispatches");
    addEdge(`${run.id}:task:${task.id}`, task.resultNodeId, "reports");
    addEdge(`${run.id}:task:${task.id}`, task.verifierNodeId, "gates");
  }
  for (const dispatch of run.dispatches || []) {
    addNode(`${run.id}:dispatch:${dispatch.id}`, "dispatch", "completed", dispatch.id, dispatch.manifestPath);
    for (const workerId of dispatch.workerIds || []) addEdge(`${run.id}:dispatch:${dispatch.id}`, `${run.id}:worker:${workerId}`, "dispatches");
  }
  for (const worker of run.workers || []) {
    addNode(`${run.id}:worker:${worker.id}`, "worker", worker.status, worker.id, worker.inputPath);
    addEdge(`${run.id}:worker:${worker.id}`, worker.resultNodeId, "reports");
    addEdge(`${run.id}:worker:${worker.id}`, worker.output?.verifierNodeId, "gates");
    for (const feedbackId of worker.feedbackIds || []) addEdge(`${run.id}:worker:${worker.id}`, `${run.id}:feedback:${feedbackId}`, "blocks");
  }
  for (const candidate of run.candidates || []) {
    const candidateId = `${run.id}:candidate:${candidate.id}`;
    addNode(candidateId, "candidate", candidate.status, candidate.id, candidate.resultPath);
    addEdge(candidate.workerId ? `${run.id}:worker:${candidate.workerId}` : candidate.resultNodeId, candidateId, "reports");
    addEdge(candidate.verifierNodeId, candidateId, "gates");
    for (const scoreId of candidate.scores || []) {
      const nodeId = `${run.id}:score:${scoreId}`;
      addNode(nodeId, "score", "completed", scoreId, scorePath(run, candidate.id, scoreId));
      addEdge(candidateId, nodeId, "scores");
    }
    for (const feedbackId of candidate.feedbackIds || []) addEdge(candidateId, `${run.id}:feedback:${feedbackId}`, "blocks");
  }
  for (const selection of run.candidateSelections || []) {
    const nodeId = `${run.id}:selection:${selection.id}`;
    addNode(nodeId, "selection", "accepted", selection.id, selection.rankingPath);
    addEdge(`${run.id}:candidate:${selection.candidateId}`, nodeId, "selects");
    if (selection.scoreId) addEdge(`${run.id}:score:${selection.scoreId}`, nodeId, "selects");
    addEdge(selection.verifierNodeId, nodeId, "gates");
  }
  for (const commit of run.commits || []) {
    const nodeId = commit.stateNodeId || `${run.id}:commit:${commit.id}`;
    addNode(nodeId, "commit", commit.verifierGated ? "committed" : "checkpoint", commit.id, commit.snapshotPath);
    addEdge(commit.selectionId ? `${run.id}:selection:${commit.selectionId}` : undefined, nodeId, "commits");
    addEdge(commit.verifierNodeId, nodeId, "gates");
  }
  for (const feedback of run.feedback || []) {
    addNode(`${run.id}:feedback:${feedback.id}`, "feedback", feedback.status, `${feedback.severity} ${feedback.classification}`);
    addEdge(feedback.nodeId, `${run.id}:feedback:${feedback.id}`, "blocks");
    addEdge(feedback.taskId ? `${run.id}:task:${feedback.taskId}` : undefined, `${run.id}:feedback:${feedback.id}`, "blocks");
  }
  for (const dep of deriveDependencies(run)) addEdge(dep.from, dep.to, dep.label);
  return {
    runId: run.id,
    nodes: [...nodes.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)),
    edges: uniqueEdges(edges).sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || (left.label || "").localeCompare(right.label || ""))
  };
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
    formatEvidence("Missing Evidence", status.missingEvidence),
    "",
    "Next Action",
    `  ${status.nextAction}`
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
  const state = run.multiAgent;
  for (const topology of run.topologies?.runs || []) {
    add(`${run.id}:topology:${topology.id}`, `${run.id}:multi-agent:${topology.multiAgentRunId}`, "owns");
    add(`${run.id}:topology:${topology.id}`, `${run.id}:blackboard:${topology.blackboardId}`, "owns");
    for (const fanoutId of topology.fanoutIds) add(`${run.id}:topology:${topology.id}`, `${run.id}:multi-agent:fanout:${fanoutId}`, "fanout");
    for (const faninId of topology.faninIds) add(`${run.id}:multi-agent:fanin:${faninId}`, `${run.id}:topology:${topology.id}`, "reports");
    for (const candidateId of topology.candidateIds) add(`${run.id}:topology:${topology.id}`, `${run.id}:candidate:${candidateId}`, "candidate");
    for (const selectionId of topology.selectionIds) add(`${run.id}:selection:${selectionId}`, `${run.id}:topology:${topology.id}`, "selects");
  }
  for (const group of state?.groups || []) {
    add(`${run.id}:multi-agent:${group.multiAgentRunId}`, `${run.id}:multi-agent:group:${group.id}`, "owns");
    for (const taskId of group.taskIds) add(`${run.id}:multi-agent:group:${group.id}`, `${run.id}:task:${taskId}`, "depends-on");
  }
  for (const fanout of state?.fanouts || []) {
    add(`${run.id}:multi-agent:group:${fanout.groupId}`, `${run.id}:multi-agent:fanout:${fanout.id}`, "fanout");
    for (const roleId of fanout.roleIds) add(`${run.id}:multi-agent:fanout:${fanout.id}`, `${run.id}:multi-agent:role:${roleId}`, "depends-on");
    for (const dispatchId of fanout.dispatchIds) add(`${run.id}:multi-agent:fanout:${fanout.id}`, `${run.id}:dispatch:${dispatchId}`, "dispatches");
  }
  for (const membership of state?.memberships || []) {
    add(`${run.id}:multi-agent:role:${membership.roleId}`, `${run.id}:multi-agent:membership:${membership.id}`, "owns");
    add(`${run.id}:multi-agent:membership:${membership.id}`, `${run.id}:task:${membership.taskId}`, "depends-on");
    add(`${run.id}:multi-agent:membership:${membership.id}`, membership.workerId ? `${run.id}:worker:${membership.workerId}` : undefined, "dispatches");
    add(membership.resultNodeId, `${run.id}:multi-agent:membership:${membership.id}`, "reports");
    add(membership.verifierNodeId, `${run.id}:multi-agent:membership:${membership.id}`, "gates");
    for (const artifactId of membership.blackboardArtifactRefIds || []) add(`${run.id}:blackboard:artifact:${artifactId}`, `${run.id}:multi-agent:membership:${membership.id}`, "cites");
    for (const messageId of membership.blackboardMessageIds || []) add(`${run.id}:blackboard:message:${messageId}`, `${run.id}:multi-agent:membership:${membership.id}`, "cites");
  }
  for (const fanin of state?.fanins || []) {
    add(fanin.fanoutId ? `${run.id}:multi-agent:fanout:${fanin.fanoutId}` : `${run.id}:multi-agent:group:${fanin.groupId}`, `${run.id}:multi-agent:fanin:${fanin.id}`, "fanin");
    for (const coverage of fanin.evidenceCoverage) {
      add(`${run.id}:multi-agent:membership:${coverage.membershipId}`, `${run.id}:multi-agent:fanin:${fanin.id}`, coverage.complete ? "adopted-by" : "blocks", coverage.complete ? "ready" : "blocked", coverage.complete ? undefined : "membership has not reported required evidence", `node scripts/cw.js worker manifest ${run.id} ${coverage.workerId || "<worker-id>"}`);
    }
  }
  for (const candidate of run.candidates || []) {
    add(candidate.workerId ? `${run.id}:worker:${candidate.workerId}` : candidate.resultNodeId, `${run.id}:candidate:${candidate.id}`, "reports", candidate.status);
    for (const scoreId of candidate.scores || []) add(`${run.id}:candidate:${candidate.id}`, `${run.id}:score:${scoreId}`, "scores", "completed");
  }
  for (const selection of run.candidateSelections || []) {
    add(`${run.id}:candidate:${selection.candidateId}`, `${run.id}:selection:${selection.id}`, "selects", "accepted");
    add(selection.scoreId ? `${run.id}:score:${selection.scoreId}` : undefined, `${run.id}:selection:${selection.id}`, "scores", "accepted");
  }
  for (const commit of run.commits || []) {
    add(commit.selectionId ? `${run.id}:selection:${commit.selectionId}` : undefined, commit.stateNodeId || `${run.id}:commit:${commit.id}`, "commits", commit.verifierGated ? "committed" : "checkpoint");
  }
  return rows.filter(uniqueById).sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
}

function deriveFailures(run: WorkflowRun, dependencies: MultiAgentOperatorDependency[]): MultiAgentOperatorFailure[] {
  const rows: MultiAgentOperatorFailure[] = [];
  const add = (id: string, kind: string, status: string, reason: string, nextCommand: string, owner?: string, linked?: string) => {
    rows.push({ id, kind, status, owner, linked, reason, nextCommand });
  };
  const state = run.multiAgent;
  for (const role of state?.roles || []) {
    const memberships = (state?.memberships || []).filter((entry) => entry.roleId === role.id);
    if (!memberships.length && role.status !== "completed" && role.status !== "cancelled") {
      add(role.id, "missing-role-coverage", role.status, `role ${role.id} has no membership`, `node scripts/cw.js multi-agent step ${run.id}`, role.id);
    }
    if (role.status === "blocked" || role.status === "cancelled") add(role.id, "agent-role", role.status, `role ${role.id} is ${role.status}`, `node scripts/cw.js multi-agent status ${run.id} --json`, role.id);
  }
  for (const membership of state?.memberships || []) {
    const worker = membership.workerId ? (run.workers || []).find((entry) => entry.id === membership.workerId) : undefined;
    if (membership.status === "failed" || membership.status === "cancelled") add(membership.id, "agent-membership", membership.status, `membership ${membership.id} is ${membership.status}`, `node scripts/cw.js multi-agent membership ${run.id} ${membership.id}`, membership.roleId, membership.workerId);
    if (!membership.workerId) add(membership.id, "missing-worker", membership.status, `membership ${membership.id} has no worker`, `node scripts/cw.js multi-agent step ${run.id}`, membership.roleId, membership.taskId);
    if (worker && (worker.status === "failed" || worker.status === "rejected")) add(worker.id, "worker", worker.status, worker.errors[0]?.message || `worker ${worker.id} is ${worker.status}`, `node scripts/cw.js worker show ${run.id} ${worker.id}`, membership.roleId, membership.id);
    if (worker && (worker.status === "allocated" || worker.status === "running")) add(worker.id, "worker-output", worker.status, `worker ${worker.id} has not reported output`, `node scripts/cw.js worker manifest ${run.id} ${worker.id}`, membership.roleId, membership.id);
  }
  for (const fanin of state?.fanins || []) {
    for (const reason of fanin.blockedReasons) add(fanin.id, "fanin", fanin.status, reason, `node scripts/cw.js multi-agent failures ${run.id}`, fanin.groupId, fanin.fanoutId);
    for (const roleId of fanin.missingRoleIds) add(`${fanin.id}:${roleId}`, "missing-role-evidence", "missing", `fanin ${fanin.id} is missing role ${roleId}`, `node scripts/cw.js multi-agent step ${run.id}`, roleId, fanin.id);
    for (const membershipId of fanin.missingMembershipIds) add(`${fanin.id}:${membershipId}`, "missing-membership-evidence", "missing", `fanin ${fanin.id} is missing membership ${membershipId}`, `node scripts/cw.js multi-agent membership ${run.id} ${membershipId}`, membershipId, fanin.id);
  }
  for (const topology of run.topologies?.runs || []) {
    for (const missing of topology.missingEvidence || []) add(`${topology.id}:${missing}`, "missing-topology-evidence", "missing", missing, topology.nextActions[0] || `node scripts/cw.js topology summary ${run.id}`, topology.id);
    if (topology.status === "blocked" || topology.status === "failed") add(topology.id, "topology", topology.status, `topology ${topology.id} is ${topology.status}`, `node scripts/cw.js topology summary ${run.id}`, topology.id);
  }
  for (const feedback of run.feedback || []) {
    if (feedback.status === "open" || feedback.status === "tasked") add(feedback.id, feedback.classification, feedback.status, feedback.message, `node scripts/cw.js feedback show ${run.id} ${feedback.id}`, feedback.taskId, feedback.nodeId);
  }
  for (const candidate of run.candidates || []) {
    if (candidate.status === "rejected" || candidate.status === "failed") add(candidate.id, "candidate", candidate.status, candidate.feedbackIds[0] || `candidate ${candidate.id} is ${candidate.status}`, `node scripts/cw.js candidate show ${run.id} ${candidate.id}`, candidate.workerId, candidate.taskId);
    if (!candidate.scores.length && candidate.status !== "rejected" && candidate.status !== "failed") add(candidate.id, "candidate-score-gap", candidate.status, `candidate ${candidate.id} has no score`, `node scripts/cw.js multi-agent score ${run.id} --candidate ${candidate.id} --evidence <path-or-ref>`, candidate.workerId, candidate.taskId);
    if (!candidate.verifierNodeId) add(`${candidate.id}:verifier`, "candidate-verifier-gap", candidate.status, `candidate ${candidate.id} has no verifier gate`, `node scripts/cw.js candidate show ${run.id} ${candidate.id}`, candidate.workerId, candidate.taskId);
  }
  if ((run.candidates || []).some((candidate) => candidate.scores.length) && !(run.candidateSelections || []).length) {
    add("selection-gap", "selection", "missing", "scored candidates exist but no selection is recorded", `node scripts/cw.js multi-agent select ${run.id} --candidate <candidate-id> --reason "<rationale>"`);
  }
  for (const dep of dependencies.filter((entry) => entry.status === "blocked")) add(dep.id, "ambiguous-dependency", dep.status, dep.reason || "dependency is blocked", dep.nextCommand || `node scripts/cw.js multi-agent status ${run.id} --json`);
  const readySelection = (run.candidateSelections || []).find((selection) => !(run.commits || []).some((commit) => commit.selectionId === selection.id && commit.verifierGated));
  if (readySelection) add(readySelection.id, "commit-gate", "not-ready", `selection ${readySelection.id} has no verifier-gated commit`, `node scripts/cw.js commit ${run.id} --selection ${readySelection.id} --reason "<verified rationale>"`, readySelection.candidateId);
  return rows.filter(uniqueByFailure).sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
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
      status: "pending"
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
        provenanceSource: item.provenance?.source,
        sourceId: item.provenance?.workerId || item.provenance?.candidateId || item.provenance?.selectionId || item.provenance?.commitId || patch.sourceId,
        sourceKind: sourceKindFromEvidence(item, patch.sourceKind),
        ...patch
      });
    }
  };
  for (const worker of run.workers || []) {
    if (worker.output?.resultPath) ensure(worker.output.resultPath, { path: worker.output.resultPath, sourceKind: "worker", sourceId: worker.id, status: worker.status === "verified" ? "adopted" : "pending", adoptedBy: worker.status === "verified" ? [worker.id] : [], pendingConsumers: worker.status === "verified" ? [] : [worker.id] });
  }
  for (const membership of run.multiAgent?.memberships || []) {
    for (const ref of membership.evidenceRefs || []) ensure(ref, { ref, sourceKind: "worker", sourceId: membership.workerId || membership.id, status: membership.status === "reported" || membership.status === "verified" ? "adopted" : "pending", adoptedBy: membership.status === "reported" || membership.status === "verified" ? [membership.id] : [], pendingConsumers: membership.status === "reported" || membership.status === "verified" ? [] : [membership.id] });
    for (const artifactId of membership.blackboardArtifactRefIds || []) ensure(artifactId, { ref: artifactId, sourceKind: "blackboard", sourceId: membership.id, status: "adopted", adoptedBy: [membership.id] });
    for (const messageId of membership.blackboardMessageIds || []) ensure(messageId, { ref: messageId, sourceKind: "blackboard", sourceId: membership.id, status: "adopted", adoptedBy: [membership.id] });
  }
  for (const artifact of run.blackboard?.artifacts || []) {
    ensure(artifact.id, { ref: artifact.locator || artifact.path || artifact.id, path: artifact.path, locator: artifact.locator, sourceKind: "blackboard", sourceId: artifact.source, provenanceSource: artifact.provenance.auditEventIds?.[0], status: artifact.status === "rejected" ? "rejected" : artifact.status === "superseded" ? "superseded" : artifact.status === "conflicting" ? "conflicting" : "pending" });
    for (const ref of artifact.evidenceRefs || []) ensure(ref, { ref, sourceKind: "blackboard", sourceId: artifact.id, status: "pending", pendingConsumers: [artifact.id] });
  }
  for (const message of run.blackboard?.messages || []) {
    ensure(message.id, { ref: message.id, sourceKind: "blackboard", sourceId: message.author.id, status: message.status === "rejected" ? "rejected" : message.status === "superseded" ? "superseded" : "pending" });
    for (const ref of message.linkedEvidenceRefs || []) ensure(ref, { ref, sourceKind: "blackboard", sourceId: message.id, status: "pending", pendingConsumers: [message.id] });
  }
  for (const decision of run.blackboard?.decisions || []) {
    for (const ref of [...(decision.evidenceRefs || []), ...(decision.artifactRefIds || []), ...(decision.messageIds || [])]) {
      ensure(ref, { ref, sourceKind: "coordinator", sourceId: decision.id, status: evidenceStatusForDecision(decision.outcome), adoptedBy: decision.outcome === "accepted" || decision.outcome === "ready" ? [decision.id] : [], rejectedBy: decision.outcome === "rejected" ? [decision.id] : [] });
    }
  }
  for (const fanin of run.multiAgent?.fanins || []) {
    for (const coverage of fanin.evidenceCoverage) {
      for (const ref of [...coverage.evidenceRefs, ...(coverage.blackboardArtifactRefIds || []), ...(coverage.blackboardMessageIds || [])]) ensure(ref, { ref, sourceKind: "worker", sourceId: coverage.workerId || coverage.membershipId, status: coverage.complete && fanin.verifierReady ? "adopted" : "pending", adoptedBy: coverage.complete ? [fanin.id] : [], pendingConsumers: coverage.complete ? [] : [fanin.id] });
    }
    for (const roleId of fanin.missingRoleIds) ensure(`${fanin.id}:missing-role:${roleId}`, { ref: roleId, sourceKind: "runtime", sourceId: fanin.id, status: "missing", pendingConsumers: [fanin.id], reason: `fanin ${fanin.id} requires role ${roleId}` });
    for (const membershipId of fanin.missingMembershipIds) ensure(`${fanin.id}:missing-membership:${membershipId}`, { ref: membershipId, sourceKind: "runtime", sourceId: fanin.id, status: "missing", pendingConsumers: [fanin.id], reason: `fanin ${fanin.id} requires membership ${membershipId}` });
  }
  for (const candidate of run.candidates || []) {
    addEvidence(candidate.evidence, { status: candidate.status === "rejected" || candidate.status === "failed" ? "rejected" : "pending", sourceKind: "worker", sourceId: candidate.workerId || candidate.id, candidateIds: [candidate.id], rejectedBy: candidate.status === "rejected" || candidate.status === "failed" ? [candidate.id] : [] });
    for (const score of readScores(run, candidate.id)) addEvidence(score.evidence, { status: score.verdict === "fail" ? "rejected" : "adopted", sourceKind: "operator", sourceId: score.scorer, candidateIds: [candidate.id], scoreIds: [score.id], adoptedBy: score.verdict === "fail" ? [] : [score.id], rejectedBy: score.verdict === "fail" ? [score.id] : [] });
  }
  for (const selection of run.candidateSelections || []) {
    addEvidence(selection.evidence, { status: "adopted", sourceKind: "verifier", sourceId: selection.verifierNodeId || selection.id, candidateIds: [selection.candidateId], selectionIds: [selection.id], scoreIds: selection.scoreId ? [selection.scoreId] : [], adoptedBy: [selection.id] });
  }
  for (const commit of run.commits || []) {
    addEvidence(commit.evidence || [], { status: commit.verifierGated ? "adopted" : "pending", sourceKind: "runtime", sourceId: commit.id, selectionIds: commit.selectionId ? [commit.selectionId] : [], candidateIds: commit.candidateId ? [commit.candidateId] : [], commitIds: [commit.id], adoptedBy: commit.verifierGated ? [commit.id] : [], pendingConsumers: commit.verifierGated ? [] : [commit.id] });
  }
  for (const topology of run.topologies?.runs || []) {
    for (const missing of topology.missingEvidence || []) ensure(`${topology.id}:missing:${missing}`, { ref: missing, sourceKind: "runtime", sourceId: topology.id, status: "missing", pendingConsumers: [topology.id], reason: missing });
  }
  return [...rows.values()].map(normalizeEvidenceStatus).sort((left, right) => statusRank(left.status) - statusRank(right.status) || left.id.localeCompare(right.id));
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
    lines.push(`  [${row.status}] ${row.id} ${ref} source=${row.sourceKind}:${row.sourceId || "unknown"}${rationale}${adopted}${rejected}${pending}`);
  }
  if (rows.length > 60) lines.push(`  ... ${rows.length - 60} more`);
  return lines.join("\n");
}

function readScores(run: WorkflowRun, candidateId: string): CandidateScore[] {
  const dir = path.join(run.paths.candidatesDir || path.join(run.paths.runDir, "candidates"), safeFileName(candidateId), "scores");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as CandidateScore);
}

function scorePath(run: WorkflowRun, candidateId: string, scoreId: string): string | undefined {
  const file = path.join(run.paths.candidatesDir || path.join(run.paths.runDir, "candidates"), safeFileName(candidateId), "scores", `${safeFileName(scoreId)}.json`);
  return fs.existsSync(file) ? file : undefined;
}

function readyCommitCommand(run: WorkflowRun): string | undefined {
  const selection = (run.candidateSelections || []).find((entry) => !(run.commits || []).some((commit) => commit.selectionId === entry.id && commit.verifierGated));
  return selection ? `node scripts/cw.js commit ${run.id} --selection ${selection.id} --reason "<verified rationale>"` : undefined;
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

function sourceKindFromEvidence(evidence: StateEvidence, fallback?: MultiAgentOperatorEvidence["sourceKind"]): MultiAgentOperatorEvidence["sourceKind"] {
  if (fallback) return fallback;
  if (evidence.provenance?.workerId) return "worker";
  if (evidence.provenance?.verifierNodeId) return "verifier";
  if (evidence.provenance?.source === "operator-recorded") return "operator";
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
  return values.filter(Boolean).filter(uniqueFilter).sort();
}

function uniqueFilter(value: string, index: number, values: string[]): boolean {
  return values.indexOf(value) === index;
}

function uniqueById<T extends { id: string }>(value: T, index: number, values: T[]): boolean {
  return values.findIndex((entry) => entry.id === value.id) === index;
}

function uniqueByFailure(value: MultiAgentOperatorFailure, index: number, values: MultiAgentOperatorFailure[]): boolean {
  return values.findIndex((entry) => entry.id === value.id && entry.kind === value.kind) === index;
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
