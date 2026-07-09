"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeMultiAgentOperator = summarizeMultiAgentOperator;
exports.operatorDigestInput = operatorDigestInput;
exports.buildMultiAgentOperatorGraph = buildMultiAgentOperatorGraph;
exports.formatMultiAgentOperatorStatus = formatMultiAgentOperatorStatus;
exports.formatMultiAgentDependencies = formatMultiAgentDependencies;
exports.formatMultiAgentFailures = formatMultiAgentFailures;
exports.formatMultiAgentEvidence = formatMultiAgentEvidence;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const coordinator_io_1 = require("./coordinator-io");
const multi_agent_io_1 = require("./multi-agent-io");
const topology_io_1 = require("./topology-io");
const trust_audit_1 = require("./trust-audit");
const collate_1 = require("../core/util/collate");
function maOf(run) {
    return run.multiAgent || {};
}
function candidatesOf(run) {
    return (run.candidates || []);
}
function selectionsOf(run) {
    return (run.candidateSelections || []);
}
function commitsOf(run) {
    return (run.commits || []);
}
function workersOf(run) {
    return (run.workers || []);
}
function feedbackOf(run) {
    return (run.feedback || []);
}
function topologyRunsOf(run) {
    return (run.topologies?.runs || []);
}
function blackboardOf(run) {
    return (run.blackboard || {});
}
function summarizeMultiAgentOperator(run) {
    const topologies = (0, topology_io_1.summarizeTopologies)(run);
    const multiAgent = (0, multi_agent_io_1.summarizeMultiAgent)(run);
    const blackboard = (0, coordinator_io_1.summarizeBlackboard)(run);
    const trust = (0, trust_audit_1.summarizeTrustAudit)(run);
    const dependencies = deriveDependencies(run);
    const failures = deriveFailures(run, dependencies);
    const evidence = deriveEvidence(run);
    const missingEvidence = evidence.filter((entry) => entry.status === "missing" || entry.status === "pending" || entry.status === "conflicting");
    const adoptedEvidence = evidence.filter((entry) => entry.status === "adopted");
    const inspectableEvidence = missingEvidence.filter((entry) => entry.disposition === "inspectable");
    const activeTopologyIds = new Set(topologies.active.map((entry) => entry.id));
    const activeMultiAgentRunIds = new Set(topologies.active.map((entry) => entry.multiAgentRunId));
    const state = maOf(run);
    const nextAction = failures[0]?.nextCommand ||
        topologies.nextAction ||
        multiAgent.nextAction ||
        blackboard.nextAction ||
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
function operatorDigestInput(run) {
    const status = summarizeMultiAgentOperator(run);
    return {
        failures: status.failures.map((f) => ({ id: f.id, kind: f.kind, status: f.status, reason: f.reason, nextCommand: f.nextCommand })),
        evidence: status.evidence.map((e) => ({ id: e.id, ref: e.ref, status: e.status, sourceId: e.sourceId })),
        nextAction: status.nextAction,
        trustEvents: status.summaries.trust?.eventCount || 0,
    };
}
function buildMultiAgentOperatorGraph(run) {
    const nodes = new Map();
    const edges = [];
    const addNode = (id, kind, status, label, filePath) => {
        if (!id)
            return;
        if (!nodes.has(id))
            nodes.set(id, { id, kind, status, label, path: filePath });
    };
    const state = maOf(run);
    for (const topology of topologyRunsOf(run)) {
        const id = String(topology.id);
        addNode(`${run.id}:topology:${id}`, "topology-run", String(topology.status), `topology ${topology.topologyId}`);
    }
    for (const group of state.groups || [])
        addNode(`${run.id}:multi-agent:group:${group.id}`, "agent-group", "running", `group ${group.id}`);
    for (const role of state.roles || [])
        addNode(`${run.id}:multi-agent:role:${role.id}`, "agent-role", role.status, `role ${role.id}`);
    for (const membership of state.memberships || [])
        addNode(`${run.id}:multi-agent:membership:${membership.id}`, "agent-membership", membership.status, `membership ${membership.id}`);
    for (const fanout of state.fanouts || [])
        addNode(`${run.id}:multi-agent:fanout:${fanout.id}`, "agent-fanout", "running", `fanout ${fanout.id}`);
    for (const fanin of state.fanins || [])
        addNode(`${run.id}:multi-agent:fanin:${fanin.id}`, "agent-fanin", fanin.status, `fanin ${fanin.id}`);
    for (const candidate of candidatesOf(run))
        addNode(`${run.id}:candidate:${candidate.id}`, "candidate", String(candidate.status), `candidate ${candidate.id}`);
    for (const candidate of candidatesOf(run))
        for (const scoreId of candidate.scores || [])
            addNode(`${run.id}:score:${scoreId}`, "score", "completed", `score ${scoreId}`);
    for (const selection of selectionsOf(run))
        addNode(`${run.id}:selection:${selection.id}`, "selection", "accepted", `selection ${selection.id}`);
    for (const commit of commitsOf(run))
        addNode(String(commit.stateNodeId || `${run.id}:commit:${commit.id}`), "commit", commit.verifierGated ? "committed" : "checkpoint", `commit ${commit.id}`);
    for (const artifact of blackboardOf(run).artifacts || [])
        addNode(`${run.id}:blackboard:artifact:${artifact.id}`, "blackboard-artifact", String(artifact.status || "pending"), `artifact ${artifact.id}`, artifact.path);
    for (const dependency of deriveDependencies(run)) {
        edges.push({ from: dependency.from, to: dependency.to, label: relabel(dependency.label) });
    }
    return { runId: run.id, nodes: [...nodes.values()], edges: uniqueEdges(edges) };
}
function formatMultiAgentOperatorStatus(status) {
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
        formatEvidence(status.inspectableEvidence.length
            ? `Missing Evidence (blocking=${status.missingEvidence.length - status.inspectableEvidence.length}, inspectable=${status.inspectableEvidence.length}; a verifier-gated commit decided the selection — inspectable rows are not failures)`
            : "Missing Evidence", status.missingEvidence),
        "",
        "Next Action",
        `  ${status.nextAction}`,
    ].join("\n");
}
function formatMultiAgentDependencies(rows) {
    return formatDependencies(rows);
}
function formatMultiAgentFailures(rows) {
    return formatFailures(rows);
}
function formatMultiAgentEvidence(rows) {
    return formatEvidence("Evidence Adoption", rows);
}
function deriveDependencies(run) {
    const rows = [];
    const add = (from, to, label, status = "known", reason, nextCommand) => {
        if (!from || !to)
            return;
        rows.push({ id: `${from}->${to}:${label}`, from, to, label, status, reason, nextCommand });
    };
    const state = maOf(run);
    for (const topology of topologyRunsOf(run)) {
        const id = String(topology.id);
        add(`${run.id}:topology:${id}`, `${run.id}:multi-agent:${topology.multiAgentRunId}`, "owns");
        add(`${run.id}:topology:${id}`, `${run.id}:blackboard:${topology.blackboardId}`, "owns");
        for (const fanoutId of topology.fanoutIds || [])
            add(`${run.id}:topology:${id}`, `${run.id}:multi-agent:fanout:${fanoutId}`, "fanout");
        for (const faninId of topology.faninIds || [])
            add(`${run.id}:multi-agent:fanin:${faninId}`, `${run.id}:topology:${id}`, "reports");
        for (const candidateId of topology.candidateIds || [])
            add(`${run.id}:topology:${id}`, `${run.id}:candidate:${candidateId}`, "candidate");
        for (const selectionId of topology.selectionIds || [])
            add(`${run.id}:selection:${selectionId}`, `${run.id}:topology:${id}`, "selects");
    }
    for (const group of state.groups || []) {
        add(`${run.id}:multi-agent:${group.multiAgentRunId}`, `${run.id}:multi-agent:group:${group.id}`, "owns");
        for (const taskId of group.taskIds || [])
            add(`${run.id}:multi-agent:group:${group.id}`, `${run.id}:task:${taskId}`, "depends-on");
    }
    for (const fanout of state.fanouts || []) {
        add(`${run.id}:multi-agent:group:${fanout.groupId}`, `${run.id}:multi-agent:fanout:${fanout.id}`, "fanout");
        for (const roleId of fanout.roleIds || [])
            add(`${run.id}:multi-agent:fanout:${fanout.id}`, `${run.id}:multi-agent:role:${roleId}`, "depends-on");
        for (const dispatchId of fanout.dispatchIds || [])
            add(`${run.id}:multi-agent:fanout:${fanout.id}`, `${run.id}:dispatch:${dispatchId}`, "dispatches");
    }
    for (const membership of state.memberships || []) {
        add(`${run.id}:multi-agent:role:${membership.roleId}`, `${run.id}:multi-agent:membership:${membership.id}`, "owns");
        add(`${run.id}:multi-agent:membership:${membership.id}`, `${run.id}:task:${membership.taskId}`, "depends-on");
        add(`${run.id}:multi-agent:membership:${membership.id}`, membership.workerId ? `${run.id}:worker:${membership.workerId}` : undefined, "dispatches");
        add(membership.resultNodeId, `${run.id}:multi-agent:membership:${membership.id}`, "reports");
        add(membership.verifierNodeId, `${run.id}:multi-agent:membership:${membership.id}`, "gates");
        for (const artifactId of membership.blackboardArtifactRefIds || [])
            add(`${run.id}:blackboard:artifact:${artifactId}`, `${run.id}:multi-agent:membership:${membership.id}`, "cites");
        for (const messageId of membership.blackboardMessageIds || [])
            add(`${run.id}:blackboard:message:${messageId}`, `${run.id}:multi-agent:membership:${membership.id}`, "cites");
    }
    for (const fanin of state.fanins || []) {
        add(fanin.fanoutId ? `${run.id}:multi-agent:fanout:${fanin.fanoutId}` : `${run.id}:multi-agent:group:${fanin.groupId}`, `${run.id}:multi-agent:fanin:${fanin.id}`, "fanin");
        for (const coverage of fanin.evidenceCoverage || []) {
            add(`${run.id}:multi-agent:membership:${coverage.membershipId}`, `${run.id}:multi-agent:fanin:${fanin.id}`, coverage.complete ? "adopted-by" : "blocks", coverage.complete ? "ready" : "blocked", coverage.complete ? undefined : "membership has not reported required evidence", `cw worker manifest ${run.id} ${coverage.workerId || "<worker-id>"}`);
        }
    }
    for (const candidate of candidatesOf(run)) {
        add(candidate.workerId ? `${run.id}:worker:${candidate.workerId}` : candidate.resultNodeId, `${run.id}:candidate:${candidate.id}`, "reports", String(candidate.status));
        for (const scoreId of candidate.scores || [])
            add(`${run.id}:candidate:${candidate.id}`, `${run.id}:score:${scoreId}`, "scores", "completed");
    }
    for (const selection of selectionsOf(run)) {
        add(`${run.id}:candidate:${selection.candidateId}`, `${run.id}:selection:${selection.id}`, "selects", "accepted");
        add(selection.scoreId ? `${run.id}:score:${selection.scoreId}` : undefined, `${run.id}:selection:${selection.id}`, "scores", "accepted");
    }
    for (const commit of commitsOf(run)) {
        add(commit.selectionId ? `${run.id}:selection:${commit.selectionId}` : undefined, String(commit.stateNodeId || `${run.id}:commit:${commit.id}`), "commits", commit.verifierGated ? "committed" : "checkpoint");
    }
    return uniqueById(rows).sort((left, right) => (0, collate_1.stableCompare)(left.from, right.from) || (0, collate_1.stableCompare)(left.to, right.to));
}
function deriveFailures(run, dependencies) {
    const rows = [];
    const add = (id, kind, status, reason, nextCommand, owner, linked) => {
        rows.push({ id, kind, status, owner, linked, reason, nextCommand });
    };
    const state = maOf(run);
    // Grouped/indexed once instead of re-filtering/re-scanning the whole
    // memberships/workers array per role/membership below (O(roles x
    // memberships) and O(memberships x workers) otherwise -- the same
    // array-scan-per-item shape 024b007 fixed for phase/task selection).
    const membershipsByRole = new Map();
    for (const entry of state.memberships || []) {
        const list = membershipsByRole.get(entry.roleId);
        if (list)
            list.push(entry);
        else
            membershipsByRole.set(entry.roleId, [entry]);
    }
    const workersById = new Map(workersOf(run).map((entry) => [entry.id, entry]));
    for (const role of state.roles || []) {
        const memberships = membershipsByRole.get(role.id) || [];
        if (!memberships.length && role.status !== "completed" && role.status !== "cancelled") {
            add(role.id, "missing-role-coverage", role.status, `role ${role.id} has no membership`, `cw multi-agent step ${run.id}`, role.id);
        }
        if (role.status === "blocked" || role.status === "cancelled")
            add(role.id, "agent-role", role.status, `role ${role.id} is ${role.status}`, `cw multi-agent status ${run.id} --json`, role.id);
    }
    for (const membership of state.memberships || []) {
        const worker = membership.workerId ? workersById.get(membership.workerId) : undefined;
        if (membership.status === "failed" || membership.status === "cancelled")
            add(membership.id, "agent-membership", membership.status, `membership ${membership.id} is ${membership.status}`, `cw multi-agent membership ${run.id} ${membership.id}`, membership.roleId, membership.workerId);
        if (!membership.workerId)
            add(membership.id, "missing-worker", membership.status, `membership ${membership.id} has no worker`, `cw multi-agent step ${run.id}`, membership.roleId, membership.taskId);
        if (worker && (worker.status === "failed" || worker.status === "rejected"))
            add(String(worker.id), "worker", String(worker.status), worker.errors?.[0]?.message || `worker ${worker.id} is ${worker.status}`, `cw worker show ${run.id} ${worker.id}`, membership.roleId, membership.id);
        if (worker && (worker.status === "allocated" || worker.status === "running"))
            add(String(worker.id), "worker-output", String(worker.status), `worker ${worker.id} has not reported output`, `cw worker manifest ${run.id} ${worker.id}`, membership.roleId, membership.id);
    }
    for (const fanin of state.fanins || []) {
        for (const reason of fanin.blockedReasons || [])
            add(fanin.id, "fanin", fanin.status, reason, `cw multi-agent failures ${run.id}`, fanin.groupId, fanin.fanoutId);
        for (const roleId of fanin.missingRoleIds || [])
            add(`${fanin.id}:${roleId}`, "missing-role-evidence", "missing", `fanin ${fanin.id} is missing role ${roleId}`, `cw multi-agent step ${run.id}`, roleId, fanin.id);
        for (const membershipId of fanin.missingMembershipIds || [])
            add(`${fanin.id}:${membershipId}`, "missing-membership-evidence", "missing", `fanin ${fanin.id} is missing membership ${membershipId}`, `cw multi-agent membership ${run.id} ${membershipId}`, membershipId, fanin.id);
    }
    for (const topology of topologyRunsOf(run)) {
        for (const missing of topology.missingEvidence || [])
            add(`${topology.id}:${missing}`, "missing-topology-evidence", "missing", missing, topology.nextActions?.[0] || `cw topology summary ${run.id}`, String(topology.id));
        if (topology.status === "blocked" || topology.status === "failed")
            add(String(topology.id), "topology", String(topology.status), `topology ${topology.id} is ${topology.status}`, `cw topology summary ${run.id}`, String(topology.id));
    }
    for (const feedback of feedbackOf(run)) {
        if (feedback.status === "open" || feedback.status === "tasked")
            add(String(feedback.id), String(feedback.classification), String(feedback.status), String(feedback.message), `cw feedback show ${run.id} ${feedback.id}`, feedback.taskId, feedback.nodeId);
    }
    for (const candidate of candidatesOf(run)) {
        const scores = candidate.scores || [];
        if (candidate.status === "rejected" || candidate.status === "failed")
            add(String(candidate.id), "candidate", String(candidate.status), candidate.feedbackIds?.[0] || `candidate ${candidate.id} is ${candidate.status}`, `cw candidate show ${run.id} ${candidate.id}`, candidate.workerId, candidate.taskId);
        if (!scores.length && candidate.status !== "rejected" && candidate.status !== "failed")
            add(String(candidate.id), "candidate-score-gap", String(candidate.status), `candidate ${candidate.id} has no score`, `cw multi-agent score ${run.id} --candidate ${candidate.id} --evidence <path-or-ref>`, candidate.workerId, candidate.taskId);
        if (!candidate.verifierNodeId)
            add(`${candidate.id}:verifier`, "candidate-verifier-gap", String(candidate.status), `candidate ${candidate.id} has no verifier gate`, `cw candidate show ${run.id} ${candidate.id}`, candidate.workerId, candidate.taskId);
    }
    if (candidatesOf(run).some((candidate) => (candidate.scores || []).length) && !selectionsOf(run).length) {
        add("selection-gap", "selection", "missing", "scored candidates exist but no selection is recorded", `cw multi-agent select ${run.id} --candidate <candidate-id> --reason "<rationale>"`);
    }
    for (const dep of dependencies.filter((entry) => entry.status === "blocked"))
        add(dep.id, "ambiguous-dependency", dep.status, dep.reason || "dependency is blocked", dep.nextCommand || `cw multi-agent status ${run.id} --json`);
    const readySelection = firstUngatedSelection(run);
    if (readySelection)
        add(String(readySelection.id), "commit-gate", "not-ready", `selection ${readySelection.id} has no verifier-gated commit`, `cw commit ${run.id} --selection ${readySelection.id} --reason "<verified rationale>"`, readySelection.candidateId);
    return uniqueByFailure(rows).sort((left, right) => (0, collate_1.stableCompare)(left.kind, right.kind) || (0, collate_1.stableCompare)(left.id, right.id));
}
function deriveEvidence(run) {
    const rows = new Map();
    const ensure = (key, patch) => {
        const existing = rows.get(key);
        const next = existing || {
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
    const addEvidence = (evidence, patch) => {
        for (const item of evidence || []) {
            const key = evidenceKey(item);
            ensure(key, {
                ref: item.summary || item.locator || item.path || item.id,
                path: item.path,
                locator: item.locator,
                provenanceSource: item.provenance?.source,
                sourceId: provenanceSourceId(item) || patch.sourceId,
                sourceKind: sourceKindFromEvidence(item, patch.sourceKind),
                ...patch,
            });
        }
    };
    for (const worker of workersOf(run)) {
        const output = worker.output;
        if (output?.resultPath)
            ensure(output.resultPath, { path: output.resultPath, sourceKind: "worker", sourceId: String(worker.id), status: worker.status === "verified" ? "adopted" : "pending", adoptedBy: worker.status === "verified" ? [String(worker.id)] : [], pendingConsumers: worker.status === "verified" ? [] : [String(worker.id)] });
    }
    for (const membership of maOf(run).memberships || []) {
        for (const ref of membership.evidenceRefs || [])
            ensure(ref, { ref, sourceKind: "worker", sourceId: membership.workerId || membership.id, status: membership.status === "reported" || membership.status === "verified" ? "adopted" : "pending", adoptedBy: membership.status === "reported" || membership.status === "verified" ? [membership.id] : [], pendingConsumers: membership.status === "reported" || membership.status === "verified" ? [] : [membership.id] });
        for (const artifactId of membership.blackboardArtifactRefIds || [])
            ensure(artifactId, { ref: artifactId, sourceKind: "blackboard", sourceId: membership.id, status: "adopted", adoptedBy: [membership.id] });
        for (const messageId of membership.blackboardMessageIds || [])
            ensure(messageId, { ref: messageId, sourceKind: "blackboard", sourceId: membership.id, status: "adopted", adoptedBy: [membership.id] });
    }
    for (const artifact of blackboardOf(run).artifacts || []) {
        ensure(String(artifact.id), { ref: artifact.locator || artifact.path || String(artifact.id), path: artifact.path, locator: artifact.locator, sourceKind: "blackboard", sourceId: artifact.source, provenanceSource: artifact.provenance?.auditEventIds?.[0], status: artifact.status === "rejected" ? "rejected" : artifact.status === "superseded" ? "superseded" : artifact.status === "conflicting" ? "conflicting" : "pending" });
        for (const ref of artifact.evidenceRefs || [])
            ensure(ref, { ref, sourceKind: "blackboard", sourceId: String(artifact.id), status: "pending", pendingConsumers: [String(artifact.id)] });
    }
    for (const message of blackboardOf(run).messages || []) {
        ensure(String(message.id), { ref: String(message.id), sourceKind: "blackboard", sourceId: message.author?.id, status: message.status === "rejected" ? "rejected" : message.status === "superseded" ? "superseded" : "pending" });
        for (const ref of message.linkedEvidenceRefs || [])
            ensure(ref, { ref, sourceKind: "blackboard", sourceId: String(message.id), status: "pending", pendingConsumers: [String(message.id)] });
    }
    for (const decision of blackboardOf(run).decisions || []) {
        for (const ref of [...(decision.evidenceRefs || []), ...(decision.artifactRefIds || []), ...(decision.messageIds || [])]) {
            ensure(ref, { ref, sourceKind: "coordinator", sourceId: String(decision.id), status: evidenceStatusForDecision(String(decision.outcome)), adoptedBy: decision.outcome === "accepted" || decision.outcome === "ready" ? [String(decision.id)] : [], rejectedBy: decision.outcome === "rejected" ? [String(decision.id)] : [] });
        }
    }
    for (const fanin of maOf(run).fanins || []) {
        for (const coverage of fanin.evidenceCoverage || []) {
            for (const ref of [...coverage.evidenceRefs, ...(coverage.blackboardArtifactRefIds || []), ...(coverage.blackboardMessageIds || [])])
                ensure(ref, { ref, sourceKind: "worker", sourceId: coverage.workerId || coverage.membershipId, status: coverage.complete && fanin.verifierReady ? "adopted" : "pending", adoptedBy: coverage.complete ? [fanin.id] : [], pendingConsumers: coverage.complete ? [] : [fanin.id] });
        }
        for (const roleId of fanin.missingRoleIds || [])
            ensure(`${fanin.id}:missing-role:${roleId}`, { ref: roleId, sourceKind: "runtime", sourceId: fanin.id, status: "missing", pendingConsumers: [fanin.id], reason: `fanin ${fanin.id} requires role ${roleId}` });
        for (const membershipId of fanin.missingMembershipIds || [])
            ensure(`${fanin.id}:missing-membership:${membershipId}`, { ref: membershipId, sourceKind: "runtime", sourceId: fanin.id, status: "missing", pendingConsumers: [fanin.id], reason: `fanin ${fanin.id} requires membership ${membershipId}` });
    }
    for (const candidate of candidatesOf(run)) {
        addEvidence(candidate.evidence || [], { status: candidate.status === "rejected" || candidate.status === "failed" ? "rejected" : "pending", sourceKind: "worker", sourceId: candidate.workerId || String(candidate.id), candidateIds: [String(candidate.id)], rejectedBy: candidate.status === "rejected" || candidate.status === "failed" ? [String(candidate.id)] : [] });
        for (const score of readScores(run, String(candidate.id)))
            addEvidence(score.evidence, { status: score.verdict === "fail" ? "rejected" : "adopted", sourceKind: "operator", sourceId: score.scorer, candidateIds: [String(candidate.id)], scoreIds: [score.id], adoptedBy: score.verdict === "fail" ? [] : [score.id], rejectedBy: score.verdict === "fail" ? [score.id] : [] });
    }
    for (const selection of selectionsOf(run)) {
        addEvidence(selection.evidence || [], { status: "adopted", sourceKind: "verifier", sourceId: selection.verifierNodeId || String(selection.id), candidateIds: [String(selection.candidateId)], selectionIds: [String(selection.id)], scoreIds: selection.scoreId ? [String(selection.scoreId)] : [], adoptedBy: [String(selection.id)] });
    }
    for (const commit of commitsOf(run)) {
        addEvidence(commit.evidence || [], { status: commit.verifierGated ? "adopted" : "pending", sourceKind: "runtime", sourceId: String(commit.id), selectionIds: commit.selectionId ? [String(commit.selectionId)] : [], candidateIds: commit.candidateId ? [String(commit.candidateId)] : [], commitIds: [String(commit.id)], adoptedBy: commit.verifierGated ? [String(commit.id)] : [], pendingConsumers: commit.verifierGated ? [] : [String(commit.id)] });
    }
    for (const topology of topologyRunsOf(run)) {
        for (const missing of topology.missingEvidence || [])
            ensure(`${topology.id}:missing:${missing}`, { ref: missing, sourceKind: "runtime", sourceId: String(topology.id), status: "missing", pendingConsumers: [String(topology.id)], reason: missing });
    }
    const committed = commitsOf(run).some((commit) => commit.verifierGated);
    const blocks = (status) => status === "missing" || status === "pending" || status === "conflicting";
    const withDisposition = (row) => ({
        ...row,
        disposition: row.status === "adopted" ? "adopted" : blocks(row.status) && !committed ? "blocking" : "inspectable",
    });
    return [...rows.values()]
        .map(normalizeEvidenceStatus)
        .map(withDisposition)
        .sort((left, right) => statusRank(left.status) - statusRank(right.status) || (0, collate_1.stableCompare)(left.id, right.id));
}
function formatDependencies(rows) {
    const lines = ["Dependencies"];
    if (!rows.length)
        return [...lines, "  none"].join("\n");
    for (const row of rows.slice(0, 80))
        lines.push(`  [${row.status}] ${row.from} -> ${row.to} (${row.label})${row.reason ? `: ${row.reason}` : ""}`);
    if (rows.length > 80)
        lines.push(`  ... ${rows.length - 80} more`);
    return lines.join("\n");
}
function formatFailures(rows) {
    const lines = ["Failed / Blocked Agents"];
    if (!rows.length)
        return [...lines, "  none"].join("\n");
    for (const row of rows.slice(0, 40))
        lines.push(`  [${row.status}] ${row.kind} ${row.id}${row.owner ? ` owner=${row.owner}` : ""}${row.linked ? ` linked=${row.linked}` : ""}: ${row.reason}; next=${row.nextCommand}`);
    if (rows.length > 40)
        lines.push(`  ... ${rows.length - 40} more`);
    return lines.join("\n");
}
function formatEvidence(title, rows) {
    const lines = [title];
    if (!rows.length)
        return [...lines, "  none"].join("\n");
    for (const row of rows.slice(0, 60)) {
        const ref = row.locator || row.path || row.ref || row.id;
        const adopted = row.adoptedBy.length ? ` adoptedBy=${row.adoptedBy.join(",")}` : "";
        const rejected = row.rejectedBy.length ? ` rejectedBy=${row.rejectedBy.join(",")}` : "";
        const pending = row.pendingConsumers.length ? ` pending=${row.pendingConsumers.join(",")}` : "";
        const rationale = row.rationaleStatus ? ` rationale=${row.rationaleStatus}` : "";
        const disposition = row.disposition === "inspectable" ? " disposition=inspectable" : "";
        lines.push(`  [${row.status}] ${row.id} ${ref} source=${row.sourceKind}:${row.sourceId || "unknown"}${rationale}${disposition}${adopted}${rejected}${pending}`);
    }
    if (rows.length > 60)
        lines.push(`  ... ${rows.length - 60} more`);
    return lines.join("\n");
}
function readScores(run, candidateId) {
    const candidatesDir = run.paths.candidatesDir || path.join(run.paths.runDir, "candidates");
    const dir = path.join(candidatesDir, safeFileName(candidateId), "scores");
    if (!fs.existsSync(dir))
        return [];
    return fs
        .readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
}
/** The first selection with no verifier-gated commit yet, if any -- shared
 *  by deriveFailures and readyCommitCommand. A Set of already-gated
 *  selection ids, built once, replaces re-scanning ALL commits per
 *  selection (O(selections x commits) otherwise -- the same array-scan-
 *  per-item shape 024b007 fixed for phase/task selection). */
function firstUngatedSelection(run) {
    const gatedSelectionIds = new Set(commitsOf(run).filter((commit) => commit.verifierGated).map((commit) => commit.selectionId));
    return selectionsOf(run).find((entry) => !gatedSelectionIds.has(entry.id));
}
function readyCommitCommand(run) {
    const selection = firstUngatedSelection(run);
    return selection ? `cw commit ${run.id} --selection ${selection.id} --reason "<verified rationale>"` : undefined;
}
function normalizeEvidenceStatus(row) {
    if (row.rejectedBy.length)
        row.status = "rejected";
    else if (row.adoptedBy.length && row.commitIds.length)
        row.status = "adopted";
    else if (row.adoptedBy.length && row.status !== "missing" && row.status !== "conflicting" && row.status !== "superseded")
        row.status = "adopted";
    return row;
}
function evidenceKey(evidence) {
    return evidence.id || evidence.locator || evidence.path || evidence.summary || "evidence";
}
function provenanceSourceId(item) {
    const provenance = item.provenance;
    return provenance?.workerId || provenance?.candidateId || provenance?.selectionId || provenance?.commitId;
}
function sourceKindFromEvidence(evidence, fallback) {
    if (fallback)
        return fallback;
    const provenance = evidence.provenance;
    if (provenance?.workerId)
        return "worker";
    if (provenance?.verifierNodeId)
        return "verifier";
    if (provenance?.source === "operator-recorded")
        return "operator";
    return "runtime";
}
function statusRank(status) {
    return { adopted: 0, pending: 1, missing: 2, conflicting: 3, rejected: 4, superseded: 5 }[status];
}
function evidenceStatusForDecision(outcome) {
    if (outcome === "accepted" || outcome === "ready")
        return "adopted";
    if (outcome === "rejected")
        return "rejected";
    if (outcome === "superseded")
        return "superseded";
    if (outcome === "conflicting")
        return "conflicting";
    return "pending";
}
function safeFileName(value) {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
function relabel(label) {
    if (!label)
        return "depends-on";
    if (label === "blackboard" || label === "task")
        return "depends-on";
    if (label === "dispatch")
        return "dispatches";
    if (label === "reported" || label === "result" || label === "message")
        return "reports";
    if (label === "evidence")
        return "cites";
    return label;
}
function isTerminal(status) {
    return status === "completed" || status === "failed" || status === "cancelled";
}
function unique(values) {
    return [...new Set(values.filter(Boolean))].sort();
}
// Each dedup below keeps the FIRST occurrence of a duplicate key, same as
// the `values.findIndex(...) === index` shape it replaces -- a Set of seen
// keys does this in one O(N) pass instead of an O(N) findIndex per item
// (O(N^2) total; this was the dominant cost of deriveDependencies/
// deriveFailures at large membership counts, found while pinning perf
// cycle P1-1's review-fix regression test).
function uniqueById(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        if (seen.has(value.id))
            continue;
        seen.add(value.id);
        result.push(value);
    }
    return result;
}
function uniqueByFailure(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const key = `${value.id}\0${value.kind}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}
function uniqueEdges(edges) {
    const seen = new Set();
    return edges.filter((edge) => {
        const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
