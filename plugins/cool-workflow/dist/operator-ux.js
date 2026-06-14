"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatMultiAgentTrustAudit = exports.formatTopologySummary = exports.formatMultiAgentSummary = exports.formatCommitSummary = exports.formatFeedbackSummary = exports.formatCandidateSummary = exports.formatWorkerSummary = exports.formatOperatorGraph = exports.formatOperatorReport = exports.formatOperatorStatus = void 0;
exports.summarizeOperatorRun = summarizeOperatorRun;
exports.adviseNoRun = adviseNoRun;
exports.summarizeOperatorWorkers = summarizeOperatorWorkers;
exports.summarizeOperatorCandidates = summarizeOperatorCandidates;
exports.summarizeOperatorFeedback = summarizeOperatorFeedback;
exports.summarizeOperatorCommits = summarizeOperatorCommits;
exports.buildOperatorGraph = buildOperatorGraph;
const node_path_1 = __importDefault(require("node:path"));
const trust_audit_1 = require("./trust-audit");
const multi_agent_trust_1 = require("./multi-agent-trust");
const multi_agent_1 = require("./multi-agent");
const coordinator_1 = require("./coordinator");
const topology_1 = require("./topology");
const multi_agent_operator_ux_1 = require("./multi-agent-operator-ux");
function summarizeOperatorRun(run) {
    const tasks = summarizeTasks(run.tasks || []);
    const phases = summarizePhases(run);
    const workers = summarizeOperatorWorkers(run);
    const candidates = summarizeOperatorCandidates(run);
    const feedback = summarizeOperatorFeedback(run);
    const commits = summarizeOperatorCommits(run);
    const topologies = (0, topology_1.summarizeTopologies)(run);
    const multiAgent = (0, multi_agent_1.summarizeMultiAgent)(run);
    const multiAgentOperator = (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run);
    const blackboard = (0, coordinator_1.summarizeBlackboard)(run);
    const trust = (0, trust_audit_1.summarizeTrustAudit)(run);
    const multiAgentTrust = (0, multi_agent_trust_1.summarizeMultiAgentTrust)(run);
    const activePhase = phases.find((phase) => phase.status === "running") || phases.find((phase) => phase.status === "pending");
    const blockedReasons = blockedReasonsFor(run, feedback, workers, candidates, topologies, multiAgent, blackboard);
    return {
        runId: run.id,
        workflowId: run.workflow.id,
        workflowTitle: run.workflow.title,
        appId: run.workflow.app?.id,
        appVersion: run.workflow.app?.version,
        loopStage: run.loopStage,
        activePhase: activePhase?.name,
        blocked: blockedReasons.length > 0,
        blockedReasons,
        phases,
        tasks,
        workers,
        candidates,
        feedback,
        commits,
        topologies,
        multiAgent,
        multiAgentOperator,
        blackboard,
        trust,
        multiAgentTrust,
        reportPath: run.paths.report,
        evidencePaths: evidencePathsFor(run),
        nextActions: adviseNextSteps(run, { tasks, workers, candidates, feedback, commits, topologies, blackboard })
    };
}
function adviseNoRun() {
    return [
        {
            command: "node scripts/cw.js plan <workflow-id> --repo <path>",
            reason: "No run id is available yet; create a workflow run before dispatching or recording evidence.",
            priority: "high"
        }
    ];
}
function summarizeOperatorWorkers(run) {
    const workers = sortedWorkers(run.workers || []);
    return {
        total: workers.length,
        byStatus: countByKnown(workers, (worker) => worker.status, ["allocated", "running", "completed", "failed", "rejected", "verified"]),
        bySandboxProfile: countBy(workers, (worker) => worker.sandboxProfileId || "none"),
        byBackend: countBy(workers, (worker) => worker.backendId || "none"),
        manifestPaths: workers.map(workerManifestPath),
        resultPaths: workers.map((worker) => worker.output?.resultPath || worker.resultPath).filter(Boolean),
        failed: workers
            .filter((worker) => worker.status === "failed" || worker.status === "rejected")
            .map((worker) => ({
            id: worker.id,
            status: worker.status,
            taskId: worker.taskId,
            feedbackIds: worker.feedbackIds || [],
            errors: (worker.errors || []).map((error) => error.message)
        })),
        workers: workers.map((worker) => ({
            id: worker.id,
            taskId: worker.taskId,
            status: worker.status,
            sandboxProfileId: worker.sandboxProfileId,
            backendId: worker.backendId,
            backendAttestationStatus: worker.backendAttestation?.status,
            manifestPath: workerManifestPath(worker),
            resultPath: worker.output?.resultPath || worker.resultPath,
            feedbackIds: worker.feedbackIds || []
        }))
    };
}
function summarizeOperatorCandidates(run) {
    const candidates = [...(run.candidates || [])].sort((left, right) => left.id.localeCompare(right.id));
    const selections = [...(run.candidateSelections || [])].sort((left, right) => left.id.localeCompare(right.id));
    const selectedIds = new Set(selections.map((selection) => selection.candidateId));
    const latestRankingPath = run.paths.candidatesDir ? node_path_1.default.join(run.paths.candidatesDir, "ranking.json") : undefined;
    const readyForCommit = selections
        .filter((selection) => {
        const candidate = candidates.find((item) => item.id === selection.candidateId);
        if (!candidate || candidate.status !== "verified" || !selection.scoreId)
            return false;
        return !(run.commits || []).some((commit) => commit.verifierGated && commit.selectionId === selection.id);
    })
        .map((selection) => ({
        candidateId: selection.candidateId,
        selectionId: selection.id,
        scoreId: selection.scoreId,
        verifierNodeId: selection.verifierNodeId
    }));
    return {
        total: candidates.length,
        byStatus: countBy(candidates, (candidate) => candidate.status),
        byKind: countBy(candidates, (candidate) => candidate.kind),
        latestRankingPath,
        selected: selections.map((selection) => ({
            selectionId: selection.id,
            candidateId: selection.candidateId,
            scoreId: selection.scoreId,
            verifierNodeId: selection.verifierNodeId
        })),
        readyForCommit,
        problems: candidateProblems(candidates, selections),
        candidates: candidates.map((candidate) => ({
            id: candidate.id,
            kind: candidate.kind,
            status: candidate.status,
            scoreCount: candidate.scores.length,
            selected: selectedIds.has(candidate.id),
            feedbackIds: candidate.feedbackIds || [],
            resultPath: candidate.resultPath
        }))
    };
}
function summarizeOperatorFeedback(run) {
    const feedback = [...(run.feedback || [])].sort((left, right) => left.id.localeCompare(right.id));
    const open = feedback.filter((record) => record.status === "open" || record.status === "tasked");
    return {
        total: feedback.length,
        byStatus: countByKnown(feedback, (record) => record.status, ["open", "tasked", "resolved", "rejected"]),
        bySeverity: countByKnown(feedback, (record) => record.severity, ["critical", "high", "medium", "low", "info"]),
        byClassification: countByKnown(feedback, (record) => record.classification, [
            "contract-violation",
            "verifier-failure",
            "state-transition",
            "missing-artifact",
            "missing-evidence",
            "parse-error",
            "pipeline-failure",
            "sandbox-policy",
            "runtime-error",
            "unknown"
        ]),
        retryable: feedback.filter((record) => record.retryable).length,
        nonRetryable: feedback.filter((record) => !record.retryable).length,
        open: open.map((record) => ({
            id: record.id,
            severity: record.severity,
            classification: record.classification,
            retryable: record.retryable,
            message: record.message,
            taskId: record.taskId,
            nodeId: record.nodeId
        }))
    };
}
function summarizeOperatorCommits(run) {
    const commits = [...(run.commits || [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const rows = commits.map(formatCommitRow);
    return {
        total: rows.length,
        verifierGated: rows.filter((commit) => commit.kind === "verifier-gated").length,
        checkpoints: rows.filter((commit) => commit.kind === "checkpoint").length,
        latest: rows.at(-1),
        commits: rows
    };
}
function buildOperatorGraph(run) {
    const nodes = new Map();
    const edges = [];
    const addNode = (id, kind, status, label, pathValue) => {
        nodes.set(id, { id, kind, status, label, path: pathValue });
    };
    const addEdge = (from, to, label) => {
        if (!from || !to)
            return;
        edges.push({ from, to, label });
    };
    addNode(`${run.id}:run`, "run", run.loopStage, run.id, run.paths.state);
    for (const phase of run.phases || []) {
        const status = phaseStatusFromTasks(run, phase.taskIds);
        const phaseId = `${run.id}:phase:${safeId(phase.id)}`;
        addNode(phaseId, "phase", status, phase.name);
        addEdge(`${run.id}:run`, phaseId);
        for (const taskId of phase.taskIds)
            addEdge(phaseId, `${run.id}:task:${taskId}`);
    }
    for (const task of run.tasks || []) {
        addNode(`${run.id}:task:${task.id}`, "task", task.status, task.id, task.taskPath);
        addEdge(`${run.id}:task:${task.id}`, task.dispatchId ? `${run.id}:dispatch:${task.dispatchId}` : undefined);
        addEdge(`${run.id}:task:${task.id}`, task.resultNodeId);
        addEdge(`${run.id}:task:${task.id}`, task.verifierNodeId);
    }
    for (const dispatch of run.dispatches || []) {
        addNode(`${run.id}:dispatch:${dispatch.id}`, "dispatch", "completed", dispatch.id, dispatch.manifestPath);
        for (const workerId of dispatch.workerIds || [])
            addEdge(`${run.id}:dispatch:${dispatch.id}`, `${run.id}:worker:${workerId}`);
    }
    for (const worker of run.workers || []) {
        addNode(`${run.id}:worker:${worker.id}`, "worker", worker.status, worker.id, workerManifestPath(worker));
        addEdge(`${run.id}:worker:${worker.id}`, worker.resultNodeId);
        for (const feedbackId of worker.feedbackIds || [])
            addEdge(`${run.id}:worker:${worker.id}`, `${run.id}:feedback:${feedbackId}`);
    }
    for (const node of run.nodes || []) {
        addNode(node.id, node.kind, operatorNodeStatus(run, node), shortNodeLabel(node), node.artifacts[0]?.path);
        for (const parent of node.parents || [])
            addEdge(parent, node.id);
    }
    for (const candidate of run.candidates || []) {
        addNode(`${run.id}:candidate:${candidate.id}`, "candidate", candidate.status, candidate.id, candidate.resultPath);
        addEdge(candidate.resultNodeId, `${run.id}:candidate:${candidate.id}`);
        addEdge(candidate.verifierNodeId, `${run.id}:candidate:${candidate.id}`, "gate");
        for (const feedbackId of candidate.feedbackIds || [])
            addEdge(`${run.id}:candidate:${candidate.id}`, `${run.id}:feedback:${feedbackId}`);
    }
    for (const selection of run.candidateSelections || []) {
        addNode(`${run.id}:selection:${selection.id}`, "selection", "verified", selection.id, selection.rankingPath);
        addEdge(`${run.id}:candidate:${selection.candidateId}`, `${run.id}:selection:${selection.id}`);
        addEdge(selection.verifierNodeId, `${run.id}:selection:${selection.id}`, "verifier");
    }
    for (const commit of run.commits || []) {
        const commitNodeId = commit.stateNodeId || `${run.id}:commit:${commit.id}`;
        addNode(commitNodeId, "commit", commit.verifierGated ? "committed" : "completed", commit.id, commit.snapshotPath);
        addEdge(commit.verifierNodeId, commitNodeId, "verifier");
        addEdge(commit.selectionId ? `${run.id}:selection:${commit.selectionId}` : undefined, commitNodeId, "selection");
    }
    for (const feedback of run.feedback || []) {
        addNode(`${run.id}:feedback:${feedback.id}`, "feedback", feedback.status, `${feedback.severity} ${feedback.classification}`);
        addEdge(feedback.nodeId, `${run.id}:feedback:${feedback.id}`);
        addEdge(feedback.taskId ? `${run.id}:task:${feedback.taskId}` : undefined, `${run.id}:feedback:${feedback.id}`);
    }
    const multiAgentGraph = (0, multi_agent_1.buildMultiAgentGraph)(run);
    for (const node of multiAgentGraph.nodes)
        addNode(node.id, node.kind, node.status, node.label, node.path);
    for (const edge of multiAgentGraph.edges)
        addEdge(edge.from, edge.to, edge.label);
    const topologyGraph = (0, topology_1.buildTopologyGraph)(run);
    for (const node of topologyGraph.nodes)
        addNode(node.id, node.kind, node.status, node.label, node.path);
    for (const edge of topologyGraph.edges)
        addEdge(edge.from, edge.to, edge.label);
    const blackboardGraph = (0, coordinator_1.buildBlackboardGraph)(run);
    for (const node of blackboardGraph.nodes)
        addNode(node.id, node.kind, node.status, node.label, node.path);
    for (const edge of blackboardGraph.edges)
        addEdge(edge.from, edge.to, edge.label);
    return {
        runId: run.id,
        nodes: [...nodes.values()].sort(compareGraphNodes),
        edges: uniqueEdges(edges).sort(compareEdges)
    };
}
// Human formatting (CLI-only) for the operator status / report / graph surfaces
// plus the worker/candidate/feedback/commit/trust/topology/multi-agent panels now
// lives in ./operator-ux/format.ts (FreeBSD-audit R-series, run-registry/format.ts
// template). Re-exported below so importers of "./operator-ux" see an unchanged
// surface. The pure data summarizers and the run-graph builder stay here.
function adviseNextSteps(run, summary) {
    const actions = [];
    if (summary.feedback.open.length) {
        const feedback = summary.feedback.open[0];
        actions.push({
            command: `node scripts/cw.js feedback show ${run.id} ${feedback.id}`,
            reason: `Open ${feedback.severity} ${feedback.classification} feedback should be inspected before more dispatch.`,
            priority: "high"
        });
        actions.push({
            command: `node scripts/cw.js feedback task ${run.id} ${feedback.id}`,
            reason: "Create a correction task if the feedback is actionable.",
            priority: "normal"
        });
        return actions;
    }
    const failedWorker = summary.workers.failed[0];
    if (failedWorker) {
        actions.push({
            command: `node scripts/cw.js feedback list ${run.id}`,
            reason: `Worker ${failedWorker.id} is ${failedWorker.status}; inspect linked feedback before retrying.`,
            priority: "high"
        });
        return actions;
    }
    if (summary.tasks.running.length) {
        const worker = summary.workers.workers.find((item) => item.status === "running" || item.status === "allocated");
        actions.push({
            command: worker ? `node scripts/cw.js worker manifest ${run.id} ${worker.id}` : `node scripts/cw.js worker list ${run.id}`,
            reason: "Running workers need their manifests inspected and final output recorded.",
            priority: "high"
        });
        if (worker) {
            actions.push({
                command: `node scripts/cw.js worker output ${run.id} ${worker.id} ${worker.resultPath}`,
                reason: "Record the worker result after its result.md is ready.",
                priority: "normal"
            });
        }
        return actions;
    }
    const activeTopology = summary.topologies.active[0];
    if (activeTopology && activeTopology.status !== "completed" && activeTopology.status !== "failed") {
        actions.push({
            command: `node scripts/cw.js multi-agent status ${run.id}`,
            reason: "Use the high-level multi-agent host surface for topology-backed work.",
            priority: "high"
        });
        actions.push({
            command: `node scripts/cw.js multi-agent step ${run.id}`,
            reason: "Perform the next safe host step without spawning agents implicitly.",
            priority: "normal"
        });
        return actions;
    }
    if (summary.tasks.pending.length) {
        const limit = Math.min(summary.tasks.pending.length, run.workflow.limits.maxConcurrentAgents || 4);
        actions.push({
            command: `node scripts/cw.js dispatch ${run.id} --limit ${limit}`,
            reason: `${summary.tasks.pending.length} pending task(s) are ready for the active phase.`,
            priority: "high"
        });
        return actions;
    }
    if (summary.blackboard.blackboardId && summary.blackboard.nextAction && !summary.blackboard.readyForFanin) {
        actions.push({
            command: summary.blackboard.nextAction,
            reason: "Blackboard shared context is not ready for fanin yet.",
            priority: "high"
        });
        return actions;
    }
    const topologyAction = summary.topologies.active.find((topology) => topology.nextActions.length)?.nextActions[0];
    if (topologyAction) {
        actions.push({
            command: topologyAction,
            reason: "An active topology has a deterministic next action.",
            priority: "high"
        });
        return actions;
    }
    if (summary.tasks.total > 0 && summary.tasks.completed.length === summary.tasks.total && summary.commits.verifierGated > 0) {
        actions.push({
            command: `node scripts/cw.js report ${run.id} --show`,
            reason: "All tracked phases are complete and verifier-gated committed state exists.",
            priority: "normal"
        });
        return actions;
    }
    const completedWithoutCandidate = (run.tasks || []).find((task) => task.status === "completed" && task.workerId && !(run.candidates || []).some((candidate) => candidate.workerId === task.workerId));
    if (completedWithoutCandidate?.workerId) {
        actions.push({
            command: `node scripts/cw.js candidate register ${run.id} --worker ${completedWithoutCandidate.workerId}`,
            reason: "A completed worker result is available but has not been registered as a candidate.",
            priority: "high"
        });
        return actions;
    }
    const unscored = (run.candidates || []).find((candidate) => candidate.status === "registered" && !candidate.scores.length);
    if (unscored) {
        actions.push({
            command: `node scripts/cw.js candidate score ${run.id} ${unscored.id} --criterion correctness=1 --evidence <path-or-locator>`,
            reason: "Registered candidates need score evidence before ranking or selection.",
            priority: "high"
        });
        return actions;
    }
    const scoredWithoutSelection = (run.candidates || []).find((candidate) => candidate.status === "scored" && !(run.candidateSelections || []).some((selection) => selection.candidateId === candidate.id));
    if (scoredWithoutSelection) {
        actions.push({
            command: `node scripts/cw.js candidate rank ${run.id}`,
            reason: "Scored candidates can be ranked before selection.",
            priority: "high"
        });
        actions.push({
            command: `node scripts/cw.js candidate select ${run.id} ${scoredWithoutSelection.id}`,
            reason: "Select the candidate once the ranking supports it.",
            priority: "normal"
        });
        return actions;
    }
    if (summary.candidates.readyForCommit.length) {
        const ready = summary.candidates.readyForCommit[0];
        actions.push({
            command: `node scripts/cw.js commit ${run.id} --selection ${ready.selectionId}`,
            reason: "A verified selected candidate is ready for a verifier-gated commit.",
            priority: "high"
        });
        return actions;
    }
    actions.push({
        command: `node scripts/cw.js report ${run.id} --show`,
        reason: "All tracked phases are complete or no further operator action is currently available.",
        priority: "normal"
    });
    return actions;
}
function summarizeTasks(tasks) {
    const byStatus = countByKnown(tasks, (task) => task.status, ["pending", "running", "completed", "failed"]);
    return {
        total: tasks.length,
        byStatus,
        pending: tasks.filter((task) => task.status === "pending").map((task) => task.id).sort(),
        running: tasks.filter((task) => task.status === "running").map((task) => task.id).sort(),
        failed: tasks.filter((task) => task.status === "failed").map((task) => task.id).sort(),
        completed: tasks.filter((task) => task.status === "completed").map((task) => task.id).sort()
    };
}
function summarizePhases(run) {
    return (run.phases || []).map((phase) => {
        const tasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
        return {
            id: phase.id,
            name: phase.name,
            status: phaseStatusFromTasks(run, phase.taskIds),
            tasks: {
                total: tasks.length,
                ...countByKnown(tasks, (task) => task.status, ["pending", "running", "completed", "failed"])
            }
        };
    });
}
function phaseStatusFromTasks(run, taskIds) {
    const tasks = run.tasks.filter((task) => taskIds.includes(task.id));
    if (!tasks.length)
        return "pending";
    if (tasks.every((task) => task.status === "completed"))
        return "completed";
    if (tasks.some((task) => task.status === "running" || task.status === "completed"))
        return "running";
    if (tasks.some((task) => task.status === "failed"))
        return "blocked";
    return "pending";
}
function blockedReasonsFor(run, feedback, workers, candidates, topologies, multiAgent, blackboard) {
    const reasons = [];
    if (feedback.open.length)
        reasons.push(`${feedback.open.length} open/tasked feedback record(s)`);
    if (workers.failed.length)
        reasons.push(`${workers.failed.length} failed/rejected worker(s)`);
    if (run.tasks.some((task) => task.status === "failed"))
        reasons.push("failed task(s)");
    if (candidates.problems.length)
        reasons.push(...candidates.problems.slice(0, 2));
    for (const topology of topologies.active) {
        if (topology.status === "blocked")
            reasons.push(`topology ${topology.id} blocked: ${topology.missingEvidence[0] || "missing evidence"}`);
    }
    if (multiAgent.blockedReasons.length)
        reasons.push(...multiAgent.blockedReasons.slice(0, 2));
    if (blackboard.conflicts.length)
        reasons.push(`${blackboard.conflicts.length} blackboard conflict(s)`);
    if (blackboard.missingEvidence.length)
        reasons.push(...blackboard.missingEvidence.slice(0, 2));
    return reasons;
}
function candidateProblems(candidates, selections) {
    const problems = [];
    for (const candidate of candidates) {
        if ((candidate.status === "registered" || candidate.status === "scored") && !candidate.evidence.length) {
            problems.push(`candidate ${candidate.id} has no evidence`);
        }
        if (candidate.status === "registered" && !candidate.scores.length) {
            problems.push(`candidate ${candidate.id} has not been scored`);
        }
        if ((candidate.status === "selected" || candidate.status === "verified") && !selections.some((selection) => selection.candidateId === candidate.id)) {
            problems.push(`candidate ${candidate.id} status is ${candidate.status} but no selection record exists`);
        }
    }
    return problems.sort();
}
function evidencePathsFor(run) {
    const values = new Set();
    for (const task of run.tasks || []) {
        if (task.taskPath)
            values.add(task.taskPath);
        if (task.resultPath)
            values.add(task.resultPath);
        if (task.workerManifestPath)
            values.add(task.workerManifestPath);
    }
    for (const dispatch of run.dispatches || [])
        if (dispatch.manifestPath)
            values.add(dispatch.manifestPath);
    for (const worker of run.workers || []) {
        values.add(workerManifestPath(worker));
        if (worker.output?.resultPath)
            values.add(worker.output.resultPath);
    }
    for (const candidate of run.candidates || []) {
        if (candidate.resultPath)
            values.add(candidate.resultPath);
        for (const artifact of candidate.artifacts || [])
            if (artifact.path)
                values.add(artifact.path);
    }
    for (const commit of run.commits || [])
        values.add(commit.snapshotPath);
    for (const node of run.nodes || []) {
        for (const artifact of node.artifacts || [])
            if (artifact.path)
                values.add(artifact.path);
        for (const evidence of node.evidence || []) {
            if (evidence.path)
                values.add(evidence.path);
            if (evidence.locator)
                values.add(evidence.locator);
            if (!evidence.path && !evidence.locator && evidence.summary)
                values.add(evidence.summary);
        }
    }
    if (run.paths.report)
        values.add(run.paths.report);
    return [...values].sort();
}
function formatCommitRow(commit) {
    return {
        id: commit.id,
        kind: commit.verifierGated ? "verifier-gated" : "checkpoint",
        reason: commit.reason,
        createdAt: commit.createdAt,
        snapshotPath: commit.snapshotPath,
        stateNodeId: commit.stateNodeId,
        verifierNodeId: commit.verifierNodeId,
        candidateId: commit.candidateId,
        selectionId: commit.selectionId,
        evidenceCount: commit.evidence?.length || 0
    };
}
function sortedWorkers(workers) {
    return [...workers].sort((left, right) => left.id.localeCompare(right.id));
}
function workerManifestPath(worker) {
    return node_path_1.default.join(worker.workerDir, "manifest.json");
}
function shortNodeLabel(node) {
    const taskId = typeof node.metadata?.taskId === "string" ? node.metadata.taskId : undefined;
    return taskId || node.id;
}
function operatorNodeStatus(run, node) {
    if (node.kind !== "task")
        return node.status;
    const taskId = typeof node.metadata?.taskId === "string" ? node.metadata.taskId : taskIdFromNodeId(node.id);
    return run.tasks.find((task) => task.id === taskId)?.status || node.status;
}
function taskIdFromNodeId(nodeId) {
    const marker = ":task:";
    const index = nodeId.indexOf(marker);
    return index >= 0 ? nodeId.slice(index + marker.length) : undefined;
}
function compareGraphNodes(left, right) {
    const byKind = left.kind.localeCompare(right.kind);
    if (byKind)
        return byKind;
    return left.id.localeCompare(right.id);
}
function compareEdges(left, right) {
    const byFrom = left.from.localeCompare(right.from);
    if (byFrom)
        return byFrom;
    const byTo = left.to.localeCompare(right.to);
    if (byTo)
        return byTo;
    return (left.label || "").localeCompare(right.label || "");
}
function uniqueEdges(edges) {
    const seen = new Set();
    const unique = [];
    for (const edge of edges) {
        const key = `${edge.from}\u001f${edge.to}\u001f${edge.label || ""}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        unique.push(edge);
    }
    return unique;
}
function countBy(items, getKey) {
    const counts = {};
    for (const item of items) {
        const key = getKey(item);
        counts[key] = (counts[key] || 0) + 1;
    }
    return sortRecord(counts);
}
function countByKnown(items, getKey, keys) {
    const counts = Object.fromEntries(keys.map((key) => [key, 0]));
    for (const item of items)
        counts[getKey(item)] += 1;
    return counts;
}
function sortRecord(record) {
    return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}
function safeId(value) {
    return String(value).replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
// Human formatting (CLI-only) now lives in ./operator-ux/format.ts (FreeBSD-audit
// R-series: rendering carved out of the operator module, run-registry/format.ts
// template). Re-exported so that importers of "./operator-ux" see an unchanged
// surface.
var format_1 = require("./operator-ux/format");
Object.defineProperty(exports, "formatOperatorStatus", { enumerable: true, get: function () { return format_1.formatOperatorStatus; } });
Object.defineProperty(exports, "formatOperatorReport", { enumerable: true, get: function () { return format_1.formatOperatorReport; } });
Object.defineProperty(exports, "formatOperatorGraph", { enumerable: true, get: function () { return format_1.formatOperatorGraph; } });
Object.defineProperty(exports, "formatWorkerSummary", { enumerable: true, get: function () { return format_1.formatWorkerSummary; } });
Object.defineProperty(exports, "formatCandidateSummary", { enumerable: true, get: function () { return format_1.formatCandidateSummary; } });
Object.defineProperty(exports, "formatFeedbackSummary", { enumerable: true, get: function () { return format_1.formatFeedbackSummary; } });
Object.defineProperty(exports, "formatCommitSummary", { enumerable: true, get: function () { return format_1.formatCommitSummary; } });
Object.defineProperty(exports, "formatMultiAgentSummary", { enumerable: true, get: function () { return format_1.formatMultiAgentSummary; } });
Object.defineProperty(exports, "formatTopologySummary", { enumerable: true, get: function () { return format_1.formatTopologySummary; } });
Object.defineProperty(exports, "formatMultiAgentTrustAudit", { enumerable: true, get: function () { return format_1.formatMultiAgentTrustAudit; } });
