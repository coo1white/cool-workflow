"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hostRun = hostRun;
exports.hostStatus = hostStatus;
exports.hostStep = hostStep;
exports.hostBlackboard = hostBlackboard;
exports.hostScore = hostScore;
exports.hostSelect = hostSelect;
// Multi-Agent Host — the high-level orchestrator for topology-backed multi-agent
// workflows. Delegates common lifecycle steps (plan, dispatch, commit) to
// orchestrator/lifecycle-operations.ts; handles ONLY multi-agent-specific steps
// here (fanin collection, judge rationale, topology application). Adding a new
// lifecycle step: prefer adding it to lifecycle-operations.ts and calling it
// from here — keep the single-agent and multi-agent paths sharing one mechanism.
// See P2-2 (v0.1.48) and src/orchestrator/lifecycle-operations.ts.
const dispatch_1 = require("./dispatch");
const coordinator_1 = require("./coordinator");
const multi_agent_1 = require("./multi-agent");
const topology_1 = require("./topology");
const operator_ux_1 = require("./operator-ux");
const multi_agent_operator_ux_1 = require("./multi-agent-operator-ux");
const candidate_scoring_1 = require("./candidate-scoring");
const trust_audit_1 = require("./trust-audit");
const multi_agent_trust_1 = require("./multi-agent-trust");
function hostRun(run, options = {}) {
    const topologyId = stringOption(options.topology || options.topologyId || options.id);
    if (!topologyId)
        return hostStatus(run, "run");
    const existing = activeTopologies(run).find((entry) => entry.topologyId === topologyId && !isTerminalTopology(entry));
    const topologyRun = existing || (0, topology_1.applyTopology)(run, topologyId, {
        id: stringOption(options.topologyRun || options.topologyRunId || options["topology-run"] || options["topology-run-id"] || options.name),
        title: stringOption(options.title),
        multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId),
        blackboardId: stringOption(options.blackboard || options.blackboardId),
        taskIds: arrayOption(options.task || options.taskId || options.tasks).map(String),
        mapperCount: numberOption(options.mapperCount || options["mapper-count"] || options.mappers || options.mapper),
        judgeCount: numberOption(options.judgeCount || options["judge-count"] || options.judges || options.judge),
        debateRounds: numberOption(options.debateRounds || options["debate-rounds"] || options.rounds),
        collectInitialFanin: Boolean(options.collectInitialFanin || options["collect-initial-fanin"]),
        metadata: { hostSurface: "multi-agent.run" }
    });
    return envelope(run, "run", {
        performed: existing ? "attached-topology" : "applied-topology",
        data: {
            topologyRun,
            dispatchCreated: false,
            note: "Workers are not dispatched by multi-agent run; call multi-agent step or dispatch explicitly."
        }
    });
}
function hostStatus(run, command = "status") {
    return envelope(run, command);
}
function hostStep(run, options = {}) {
    const state = classifyHostState(run);
    if (state === "complete") {
        return envelope(run, "step", {
            performed: "none",
            requiredHostAction: "Review the completed run report; no further host step is available."
        });
    }
    if (state === "ready-for-commit") {
        return envelope(run, "step", {
            performed: "none",
            requiredHostAction: "Run the recommended verifier-gated commit command before taking more steps."
        });
    }
    if (state === "needs-run") {
        return envelope(run, "step", {
            performed: "none",
            requiredHostAction: "Create or attach a multi-agent run before stepping."
        });
    }
    if (state === "blocked" || state === "failed")
        return envelope(run, "step", { performed: "none", requiredHostAction: "Resolve blocked reasons, then rerun multi-agent status." });
    const topology = requireSingleActiveTopology(run);
    const runningWorkers = (run.workers || []).filter((worker) => worker.status === "allocated" || worker.status === "running");
    if (runningWorkers.length) {
        return envelope(run, "step", {
            performed: "none",
            requiredHostAction: `Execute ${runningWorkers.length} worker(s), write result.md, then record output with worker output or result.`,
            extraBlockedReasons: runningWorkers.map((worker) => `worker ${worker.id} is ${worker.status}`)
        });
    }
    const faninPlan = nextFaninPlan(run, topology);
    if (faninPlan) {
        const fanin = (0, multi_agent_1.collectAgentFanin)(run, faninPlan);
        linkTopologyRecord(topology, { faninIds: [fanin.id] });
        return envelope(run, "step", {
            performed: fanin.status === "ready" ? "collected-fanin" : "collected-blocked-fanin",
            data: fanin,
            requiredHostAction: fanin.status === "ready" ? undefined : "Add missing worker evidence or blackboard artifacts before continuing.",
            extraBlockedReasons: fanin.status === "ready" ? [] : fanin.blockedReasons
        });
    }
    const dispatchPlan = nextDispatchPlan(run, topology, options);
    if (dispatchPlan) {
        const manifest = (0, dispatch_1.createDispatchManifest)(run, dispatchPlan.limit, {
            sandboxProfileId: dispatchPlan.sandboxProfileId,
            backendId: dispatchPlan.backendId,
            multiAgentRunId: topology.multiAgentRunId,
            multiAgentGroupId: dispatchPlan.groupId,
            multiAgentRoleId: dispatchPlan.roleId,
            multiAgentFanoutId: dispatchPlan.fanoutId
        });
        return envelope(run, "step", {
            performed: manifest.dispatchId ? "created-dispatch-manifest" : "none",
            data: manifest,
            requiredHostAction: manifest.dispatchId ? "Spawn the worker described by the manifest and record its result." : "No runnable pending task is available for dispatch."
        });
    }
    const snapshotPlan = activeBlackboardId(run, topology);
    if (snapshotPlan && !(run.blackboard?.snapshots || []).some((snapshot) => snapshot.blackboardId === snapshotPlan)) {
        const snapshot = (0, coordinator_1.createBlackboardSnapshot)(run, snapshotPlan);
        return envelope(run, "step", { performed: "created-blackboard-snapshot", data: snapshot });
    }
    const candidatePlan = nextCandidatePlan(run);
    if (candidatePlan) {
        const candidate = (0, candidate_scoring_1.registerCandidate)(run, {
            id: stringOption(options.candidate || options.candidateId),
            kind: "worker-output",
            workerId: candidatePlan.id,
            taskId: candidatePlan.taskId,
            resultNodeId: candidatePlan.resultNodeId,
            verifierNodeId: candidatePlan.output?.verifierNodeId,
            resultPath: candidatePlan.resultPath,
            metadata: { hostSurface: "multi-agent.step" }
        }, { persist: false });
        linkTopologyRecord(topology, { candidateIds: [candidate.id] });
        return envelope(run, "step", { performed: "registered-candidate", data: candidate });
    }
    const scorePlan = nextScorePlan(run, options);
    if (scorePlan) {
        const score = (0, candidate_scoring_1.scoreCandidate)(run, scorePlan.candidate.id, {
            scorer: stringOption(options.scorer) || "multi-agent-host",
            criteria: parseCriteria(options, { correctness: 1, evidence: 1, fit: 1 }),
            maxTotal: numberOption(options.maxTotal || options.max) || 3,
            verdict: stringOption(options.verdict),
            evidence: scorePlan.evidence,
            notes: stringOption(options.notes) || "Host step scored candidate with existing verifier evidence.",
            metadata: { hostSurface: "multi-agent.step", topologyRunId: topology.id }
        }, { persist: false });
        (0, coordinator_1.recordCoordinatorDecision)(run, {
            blackboardId: topology.blackboardId,
            topicId: topology.topicIds[0],
            kind: "candidate-synthesis",
            outcome: score.verdict === "fail" ? "blocked" : "ready",
            reason: `Candidate ${score.candidateId} scored ${score.total}/${score.maxTotal}.`,
            subjectIds: [score.candidateId, score.id],
            evidenceRefs: score.evidence.map((entry) => entry.locator || entry.summary || entry.id).filter(Boolean),
            metadata: { hostSurface: "multi-agent.step", scoreId: score.id }
        });
        return envelope(run, "step", { performed: "scored-candidate", data: score });
    }
    const selectionPlan = nextSelectionPlan(run, options);
    if (selectionPlan) {
        const selection = (0, candidate_scoring_1.selectCandidate)(run, selectionPlan.candidate.id, {
            selectedBy: stringOption(options.by || options.selectedBy) || "multi-agent-host",
            reason: stringOption(options.reason) || "Selected by high-level multi-agent host step after scoring and verifier evidence.",
            scoreId: selectionPlan.scoreId,
            allowUnverified: Boolean(options.allowUnverified)
        }, { persist: false });
        linkTopologyRecord(topology, { selectionIds: [selection.id] });
        (0, coordinator_1.recordCoordinatorDecision)(run, {
            blackboardId: topology.blackboardId,
            topicId: topology.topicIds.at(-1),
            kind: "candidate-synthesis",
            outcome: "accepted",
            reason: selection.reason,
            subjectIds: [selection.candidateId, selection.id],
            evidenceRefs: selection.evidence.map((entry) => entry.locator || entry.summary || entry.id).filter(Boolean),
            metadata: { hostSurface: "multi-agent.step", selectionId: selection.id }
        });
        return envelope(run, "step", { performed: "selected-candidate", data: selection });
    }
    return envelope(run, "step", {
        performed: "none",
        requiredHostAction: "No safe deterministic step is available. Use multi-agent status for the next explicit command."
    });
}
function hostBlackboard(run, action, options = {}) {
    const topology = optionalSingleActiveTopology(run);
    const blackboardId = resolveHostBlackboardId(run, topology, options);
    const topicId = stringOption(options.topic || options.topicId) || resolveHostTopicId(run, blackboardId, options, action);
    let data;
    let performed = "read-blackboard";
    switch (action || "summary") {
        case "summary":
        case "board":
            data = (0, coordinator_1.summarizeBlackboard)(run, blackboardId);
            break;
        case "topics":
        case "list-topics":
            data = (run.blackboard?.topics || []).filter((topic) => topic.blackboardId === blackboardId);
            break;
        case "messages":
        case "list-messages":
            data = (0, coordinator_1.listBlackboardMessages)(run, { blackboardId, topicId });
            break;
        case "post":
        case "message":
            data = (0, coordinator_1.postBlackboardMessage)(run, {
                topicId: requireString(topicId, "topic id"),
                blackboardId,
                body: requireString(options.body || options.message, "message body"),
                evidenceRefs: arrayOption(options.evidence || options.evidenceRef).map(String),
                artifactRefIds: arrayOption(options.artifact || options.artifactRef || options.artifactRefId).map(String),
                metadata: { hostSurface: "multi-agent.blackboard" }
            });
            performed = "posted-message";
            break;
        case "artifacts":
        case "list-artifacts":
            data = (0, coordinator_1.listBlackboardArtifacts)(run, { blackboardId, topicId });
            break;
        case "add-artifact":
        case "artifact":
            data = (0, coordinator_1.addBlackboardArtifact)(run, {
                id: stringOption(options.id),
                blackboardId,
                topicId,
                kind: requireString(options.kind, "artifact kind"),
                path: stringOption(options.path),
                locator: stringOption(options.locator),
                source: stringOption(options.source) || "multi-agent-host",
                evidenceRefs: arrayOption(options.evidence || options.evidenceRef).map(String),
                metadata: { hostSurface: "multi-agent.blackboard" }
            });
            performed = "added-artifact";
            break;
        case "context":
        case "put-context":
            data = (0, coordinator_1.putBlackboardContext)(run, {
                blackboardId,
                topicId: requireString(topicId, "topic id"),
                kind: requireString(options.kind, "context kind"),
                key: stringOption(options.key),
                value: requireString(options.value || options.body, "context value"),
                evidenceRefs: arrayOption(options.evidence || options.evidenceRef).map(String),
                artifactRefIds: arrayOption(options.artifact || options.artifactRef || options.artifactRefId).map(String),
                metadata: { hostSurface: "multi-agent.blackboard" }
            });
            performed = "put-context";
            break;
        case "snapshot":
            data = (0, coordinator_1.createBlackboardSnapshot)(run, blackboardId);
            performed = "created-snapshot";
            break;
        default:
            throw new Error("Usage: multi-agent blackboard <run-id> [summary|topics|messages|post|artifacts|add-artifact|context|snapshot]");
    }
    return envelope(run, "blackboard", { performed, data });
}
function hostScore(run, options = {}) {
    const topology = optionalSingleActiveTopology(run);
    let candidate = resolveCandidate(run, options);
    if (!candidate && stringOption(options.worker || options.workerId)) {
        candidate = (0, candidate_scoring_1.registerCandidate)(run, {
            id: stringOption(options.candidate || options.candidateId || options.id),
            kind: "worker-output",
            workerId: requireString(options.worker || options.workerId, "worker id"),
            metadata: { hostSurface: "multi-agent.score" }
        }, { persist: false });
    }
    if (!candidate)
        throw new Error("multi-agent score requires --candidate or --worker when a single candidate cannot be inferred");
    const evidence = explicitEvidence(options);
    if (!evidence.length)
        throw new Error(`Candidate ${candidate.id} score requires evidence`);
    const authority = authorityOptions(options);
    if (authority.agentRoleId || authority.agentMembershipId) {
        const rationale = stringOption(options.rationale || options.notes || options.reason);
        if (!rationale)
            throw new Error(`Candidate ${candidate.id} judge score requires rationale`);
        const permission = (0, multi_agent_trust_1.assertMultiAgentActionAllowed)(run, {
            operation: "judge.rationale",
            actor: authority.actor,
            multiAgentRunId: authority.multiAgentRunId || topology?.multiAgentRunId,
            agentRoleId: authority.agentRoleId,
            agentGroupId: authority.agentGroupId,
            agentMembershipId: authority.agentMembershipId,
            blackboardId: topology?.blackboardId,
            blackboardTopicId: topology?.topicIds[0],
            candidateId: candidate.id,
            evidenceRefs: evidence.map((entry) => entry.locator || entry.summary || entry.id).filter(Boolean)
        });
        (0, multi_agent_trust_1.recordJudgeRationaleAudit)(run, {
            kind: "judge.rationale",
            actor: authority.actor,
            multiAgentRunId: authority.multiAgentRunId || topology?.multiAgentRunId,
            agentRoleId: authority.agentRoleId,
            agentGroupId: authority.agentGroupId,
            agentMembershipId: authority.agentMembershipId,
            blackboardId: topology?.blackboardId,
            blackboardTopicId: topology?.topicIds[0],
            candidateId: candidate.id,
            evidenceRefs: evidence.map((entry) => entry.locator || entry.summary || entry.id).filter(Boolean),
            rationale,
            policyRef: permission.policyRef,
            parentEventIds: [permission.event.id]
        });
    }
    const score = (0, candidate_scoring_1.scoreCandidate)(run, candidate.id, {
        id: stringOption(options.score || options.scoreId),
        scorer: stringOption(options.scorer) || "multi-agent-host",
        criteria: parseCriteria(options),
        maxTotal: numberOption(options.maxTotal || options.max),
        verdict: stringOption(options.verdict),
        evidence,
        notes: stringOption(options.notes),
        metadata: { hostSurface: "multi-agent.score", topologyRunId: topology?.id }
    }, { persist: false });
    if (topology) {
        linkTopologyRecord(topology, { candidateIds: [candidate.id] });
        (0, coordinator_1.recordCoordinatorDecision)(run, {
            blackboardId: topology.blackboardId,
            topicId: topology.topicIds[0],
            kind: "candidate-synthesis",
            outcome: score.verdict === "fail" ? "blocked" : "ready",
            reason: `Host scored candidate ${candidate.id} with score ${score.id}.`,
            subjectIds: [candidate.id, score.id],
            evidenceRefs: score.evidence.map((entry) => entry.locator || entry.summary || entry.id).filter(Boolean),
            metadata: { hostSurface: "multi-agent.score", scoreId: score.id }
        });
    }
    return envelope(run, "score", { performed: "scored-candidate", data: score });
}
function hostSelect(run, options = {}) {
    const topology = optionalSingleActiveTopology(run);
    const candidate = resolveCandidate(run, options) || topRankedCandidate(run);
    if (!candidate)
        throw new Error("multi-agent select requires a scored candidate");
    const authority = authorityOptions(options);
    if (authority.agentRoleId || authority.agentMembershipId) {
        const scoreId = stringOption(options.score || options.scoreId) || candidate.scores.at(-1);
        if (!(0, multi_agent_trust_1.hasAcceptedJudgeRationale)(run, { multiAgentRunId: authority.multiAgentRunId || topology?.multiAgentRunId, candidateId: candidate.id, scoreId })) {
            throw new Error(`Candidate ${candidate.id} selection requires accepted judge rationale with evidence`);
        }
        (0, multi_agent_trust_1.assertMultiAgentActionAllowed)(run, {
            operation: "candidate.select",
            actor: authority.actor,
            multiAgentRunId: authority.multiAgentRunId || topology?.multiAgentRunId,
            agentRoleId: authority.agentRoleId,
            agentGroupId: authority.agentGroupId,
            agentMembershipId: authority.agentMembershipId,
            blackboardId: topology?.blackboardId,
            blackboardTopicId: topology?.topicIds.at(-1),
            candidateId: candidate.id,
            scoreId,
            evidenceRefs: explicitEvidence(options).map((entry) => entry.locator || entry.summary || entry.id).filter(Boolean)
        });
    }
    const selection = (0, candidate_scoring_1.selectCandidate)(run, candidate.id, {
        selectedBy: stringOption(options.by || options.selectedBy) || "multi-agent-host",
        reason: requireString(options.reason || "Selected by high-level multi-agent host surface.", "selection reason"),
        scoreId: stringOption(options.score || options.scoreId),
        allowUnverified: Boolean(options.allowUnverified)
    }, {
        persist: false,
        policy: {
            requireVerifierGate: options.requireVerifierGate === undefined ? undefined : Boolean(options.requireVerifierGate),
            minNormalized: numberOption(options.minNormalized)
        }
    });
    if (topology) {
        linkTopologyRecord(topology, { candidateIds: [candidate.id], selectionIds: [selection.id] });
        (0, coordinator_1.recordCoordinatorDecision)(run, {
            blackboardId: topology.blackboardId,
            topicId: topology.topicIds.at(-1),
            kind: "candidate-synthesis",
            outcome: "accepted",
            reason: selection.reason,
            subjectIds: [selection.candidateId, selection.id],
            evidenceRefs: selection.evidence.map((entry) => entry.locator || entry.summary || entry.id).filter(Boolean),
            author: authority.actor,
            links: {
                multiAgentRunId: authority.multiAgentRunId || topology.multiAgentRunId,
                agentGroupId: authority.agentGroupId,
                agentRoleId: authority.agentRoleId,
                agentMembershipId: authority.agentMembershipId
            },
            metadata: { hostSurface: "multi-agent.select", selectionId: selection.id }
        });
    }
    return envelope(run, "select", { performed: "selected-candidate", data: selection });
}
function memoize(compute) {
    let cached;
    return (run) => (cached ??= { value: compute(run) }).value;
}
function createHostSummaryCache(run) {
    const topologies = memoize(topology_1.summarizeTopologies);
    const multiAgent = memoize(multi_agent_1.summarizeMultiAgent);
    const blackboard = memoize(coordinator_1.summarizeBlackboard);
    const workers = memoize(operator_ux_1.summarizeOperatorWorkers);
    const candidates = memoize(operator_ux_1.summarizeOperatorCandidates);
    const feedback = memoize(operator_ux_1.summarizeOperatorFeedback);
    const commits = memoize(operator_ux_1.summarizeOperatorCommits);
    const trust = memoize(trust_audit_1.summarizeTrustAudit);
    const operator = memoize(operator_ux_1.summarizeOperatorRun);
    const multiAgentOperator = memoize(multi_agent_operator_ux_1.summarizeMultiAgentOperator);
    const active = memoize(activeTopologies);
    return {
        run,
        topologies: () => topologies(run),
        multiAgent: () => multiAgent(run),
        blackboard: () => blackboard(run),
        workers: () => workers(run),
        candidates: () => candidates(run),
        feedback: () => feedback(run),
        commits: () => commits(run),
        trust: () => trust(run),
        operator: () => operator(run),
        multiAgentOperator: () => multiAgentOperator(run),
        active: () => active(run)
    };
}
function envelope(run, command, options = {}) {
    const cache = createHostSummaryCache(run);
    const topologies = cache.topologies();
    const multiAgent = cache.multiAgent();
    const blackboard = cache.blackboard();
    const workers = cache.workers();
    const candidates = cache.candidates();
    const feedback = cache.feedback();
    const commits = cache.commits();
    const trust = cache.trust();
    const operator = cache.operator();
    const multiAgentOperator = cache.multiAgentOperator();
    const active = cache.active();
    const blockedReasons = unique([...operator.blockedReasons, ...(options.extraBlockedReasons || [])]);
    const state = blockedReasons.length ? "blocked" : classifyHostState(run, cache);
    const ids = activeIds(run, active);
    const nextActions = hostNextActions(run, state, active, options.requiredHostAction, cache);
    return {
        schemaVersion: 1,
        surface: "multi-agent-host",
        command,
        runId: run.id,
        state,
        performed: options.performed,
        nextAction: nextActions[0]?.command,
        nextActions,
        blockedReasons,
        requiredHostAction: options.requiredHostAction,
        evidenceRequirements: evidenceRequirements(active, multiAgent.blockedReasons),
        ids,
        paths: {
            statePath: run.paths.state,
            reportPath: run.paths.report,
            blackboardIndexPath: blackboard.indexPath,
            auditSummaryPath: run.audit?.summaryPath,
            auditEventLogPath: run.audit?.eventLogPath,
            candidateRankingPath: candidates.latestRankingPath,
            workerManifestPaths: workers.manifestPaths,
            workerResultPaths: workers.resultPaths
        },
        summaries: { topologies, multiAgent, multiAgentOperator, blackboard, workers, candidates, feedback, commits, trust },
        data: options.data
    };
}
function classifyHostState(run, cache = createHostSummaryCache(run)) {
    const active = cache.active();
    const feedback = cache.feedback();
    const workers = cache.workers();
    const candidates = cache.candidates();
    const commits = cache.commits();
    if (!active.length && !(run.multiAgent?.runs || []).length)
        return "needs-run";
    if (feedback.open.some((entry) => !entry.retryable))
        return "failed";
    if (feedback.open.length)
        return "blocked";
    if (commits.verifierGated > 0 && candidates.readyForCommit.length === 0)
        return "complete";
    if (candidates.readyForCommit.length)
        return "ready-for-commit";
    if ((run.candidateSelections || []).length === 0 && (run.candidates || []).some((candidate) => candidate.status === "scored" || candidate.status === "verified")) {
        return "ready-for-selection";
    }
    if ((run.candidates || []).some((candidate) => candidate.status === "registered"))
        return "ready-for-scoring";
    if (workers.workers.some((worker) => worker.status === "allocated" || worker.status === "running"))
        return "awaiting-worker-output";
    if (nextCandidatePlan(run))
        return "ready-for-scoring";
    if (nextFaninPlan(run, active[0]))
        return "ready-for-fanin";
    if (nextDispatchPlan(run, active[0], {}))
        return "ready-for-dispatch";
    return "blocked";
}
function activeIds(run, active) {
    return {
        topologyRunIds: active.map((entry) => entry.id),
        topologyIds: active.map((entry) => entry.topologyId),
        multiAgentRunIds: unique([...active.map((entry) => entry.multiAgentRunId), ...(run.multiAgent?.runs || []).map((entry) => entry.id)]),
        blackboardIds: unique([...active.map((entry) => entry.blackboardId), ...(run.blackboard?.boards || []).map((entry) => entry.id)]),
        topicIds: unique(active.flatMap((entry) => entry.topicIds)),
        groupIds: unique(active.flatMap((entry) => entry.groupIds)),
        roleIds: unique(active.flatMap((entry) => entry.roleIds)),
        fanoutIds: unique(active.flatMap((entry) => entry.fanoutIds)),
        faninIds: unique(active.flatMap((entry) => entry.faninIds)),
        candidateIds: unique([...(run.candidates || []).map((entry) => entry.id), ...active.flatMap((entry) => entry.candidateIds)]),
        selectionIds: unique([...(run.candidateSelections || []).map((entry) => entry.id), ...active.flatMap((entry) => entry.selectionIds)]),
        commitIds: (run.commits || []).map((entry) => entry.id),
        auditEventIds: unique(active.flatMap((entry) => entry.links.auditEventIds))
    };
}
function hostNextActions(run, state, active, requiredHostAction, cache = createHostSummaryCache(run)) {
    if (requiredHostAction)
        return [{ command: "host-action", reason: requiredHostAction, priority: "high" }];
    const runId = run.id;
    switch (state) {
        case "needs-run":
            return [{ command: `node scripts/cw.js multi-agent run ${runId} --topology map-reduce`, reason: "Materialize a host-facing multi-agent topology.", priority: "high" }];
        case "ready-for-dispatch":
            return [{ command: `node scripts/cw.js multi-agent step ${runId}`, reason: "Create the next dispatch manifest without spawning workers.", priority: "high" }];
        case "awaiting-worker-output":
            return [{ command: `node scripts/cw.js worker output ${runId} <worker-id> <result.md>`, reason: "A host-executed worker must report result evidence.", priority: "high" }];
        case "ready-for-fanin":
            return [{ command: `node scripts/cw.js multi-agent step ${runId}`, reason: "Collect fanin once required worker evidence is present.", priority: "high" }];
        case "ready-for-scoring":
            return [{ command: `node scripts/cw.js multi-agent score ${runId} --candidate <candidate-id> --criterion correctness=1 --evidence <path-or-ref>`, reason: "Score a candidate with explicit evidence.", priority: "high" }];
        case "ready-for-selection":
            return [{ command: `node scripts/cw.js multi-agent select ${runId} --candidate <candidate-id> --reason "<rationale>"`, reason: "Select a scored candidate after verifier gates pass.", priority: "high" }];
        case "ready-for-commit": {
            const ready = cache.candidates().readyForCommit[0];
            return [{ command: `node scripts/cw.js commit ${runId} --selection ${ready.selectionId} --reason "<verified rationale>"`, reason: "Create a verifier-gated CW state commit.", priority: "high" }];
        }
        case "complete":
            return [{ command: `node scripts/cw.js report ${runId} --show`, reason: "Review the completed run report.", priority: "normal" }];
        case "failed":
        case "blocked":
        default:
            return [{ command: `node scripts/cw.js multi-agent status ${runId}`, reason: active.length > 1 ? "Resolve ambiguous active topology state." : "Inspect specific blocked reasons.", priority: "high" }];
    }
}
function nextDispatchPlan(run, topology, options) {
    if (!topology)
        return undefined;
    if (topology.faninIds.length)
        return undefined;
    const fanout = (run.multiAgent?.fanouts || []).find((entry) => topology.fanoutIds.includes(entry.id));
    const group = (run.multiAgent?.groups || []).find((entry) => topology.groupIds.includes(entry.id));
    if (!fanout || !group)
        return undefined;
    const pending = run.tasks.filter((task) => task.status === "pending");
    if (!pending.length)
        return undefined;
    const membershipRoleIds = new Set((run.multiAgent?.memberships || []).filter((entry) => entry.fanoutId === fanout.id).map((entry) => entry.roleId));
    const roleId = fanout.roleIds.find((id) => !membershipRoleIds.has(id));
    if (!roleId)
        return undefined;
    return {
        limit: numberOption(options.limit) || 1,
        sandboxProfileId: stringOption(options.sandbox || options.sandboxProfile || options.sandboxProfileId) || "readonly",
        backendId: stringOption(options.backend || options.backendId || options.executionBackend),
        groupId: group.id,
        fanoutId: fanout.id,
        roleId
    };
}
function nextFaninPlan(run, topology) {
    if (!topology || topology.faninIds.length)
        return undefined;
    const fanout = (run.multiAgent?.fanouts || []).find((entry) => topology.fanoutIds.includes(entry.id));
    const group = (run.multiAgent?.groups || []).find((entry) => topology.groupIds.includes(entry.id));
    if (!fanout || !group || !fanout.membershipIds.length)
        return undefined;
    const memberships = (run.multiAgent?.memberships || []).filter((entry) => entry.fanoutId === fanout.id);
    if (!memberships.length || memberships.some((entry) => entry.status !== "reported" && !entry.verifierNodeId))
        return undefined;
    const membershipRoleIds = new Set(memberships.map((entry) => entry.roleId));
    if (fanout.roleIds.some((roleId) => !membershipRoleIds.has(roleId)))
        return undefined;
    return {
        id: `${topology.id}-fanin`,
        multiAgentRunId: topology.multiAgentRunId,
        groupId: group.id,
        fanoutId: fanout.id,
        requiredRoleIds: fanout.roleIds,
        strategy: "host step fanin requires all dispatched role evidence",
        blackboardId: topology.blackboardId,
        topicIds: topology.topicIds,
        metadata: { hostSurface: "multi-agent.step", topologyRunId: topology.id }
    };
}
function nextCandidatePlan(run) {
    const candidateWorkerIds = new Set((run.candidates || []).map((entry) => entry.workerId).filter(Boolean));
    return (run.workers || []).find((worker) => worker.status === "verified" &&
        worker.id &&
        !candidateWorkerIds.has(worker.id) &&
        worker.output?.verifierNodeId);
}
function nextScorePlan(run, options) {
    const explicit = resolveCandidate(run, options);
    const candidate = explicit || (run.candidates || []).filter((entry) => entry.status === "registered").at(0);
    if (!candidate || candidate.scores.length)
        return undefined;
    const evidence = explicitEvidence(options);
    return { candidate, evidence: evidence.length ? evidence : candidateEvidence(candidate) };
}
function nextSelectionPlan(run, options) {
    const candidate = resolveCandidate(run, options) || topRankedCandidate(run);
    if (!candidate || (run.candidateSelections || []).some((entry) => entry.candidateId === candidate.id))
        return undefined;
    if (!candidate.scores.length)
        return undefined;
    return { candidate, scoreId: stringOption(options.score || options.scoreId) };
}
function resolveCandidate(run, options) {
    const id = stringOption(options.candidate || options.candidateId || options.id);
    if (id) {
        const candidate = (run.candidates || []).find((entry) => entry.id === id);
        if (!candidate)
            throw new Error(`Unknown candidate id for run ${run.id}: ${id}`);
        return candidate;
    }
    const candidates = (run.candidates || []).filter((entry) => entry.status !== "rejected" && entry.status !== "failed");
    return candidates.length === 1 ? candidates[0] : undefined;
}
function topRankedCandidate(run) {
    const ranking = (0, candidate_scoring_1.rankCandidates)(run);
    const first = ranking.candidates.find((entry) => entry.scoreCount > 0 && entry.verdict !== "fail");
    return first ? (run.candidates || []).find((candidate) => candidate.id === first.candidateId) : undefined;
}
function activeTopologies(run) {
    return [...(run.topologies?.runs || [])].filter((entry) => !isTerminalTopology(entry));
}
function optionalSingleActiveTopology(run) {
    const active = activeTopologies(run);
    if (active.length > 1)
        throw new Error(`Ambiguous active topology state: ${active.map((entry) => entry.id).join(", ")}`);
    return active[0];
}
function requireSingleActiveTopology(run) {
    const active = activeTopologies(run);
    if (!active.length)
        throw new Error(`Run ${run.id} has no active multi-agent topology. Use multi-agent run --topology <id>.`);
    if (active.length > 1)
        throw new Error(`Ambiguous active topology state: ${active.map((entry) => entry.id).join(", ")}`);
    return active[0];
}
function resolveHostBlackboardId(run, topology, options) {
    const explicit = stringOption(options.blackboard || options.blackboardId);
    if (explicit)
        return explicit;
    if (topology?.blackboardId)
        return topology.blackboardId;
    const boards = run.blackboard?.boards || [];
    if (boards.length === 1)
        return boards[0].id;
    if (!boards.length)
        throw new Error(`Run ${run.id} has no blackboard. Use multi-agent run --topology <id> first.`);
    throw new Error(`Ambiguous blackboard state: ${boards.map((board) => board.id).join(", ")}`);
}
function resolveHostTopicId(run, blackboardId, options, action) {
    const explicit = stringOption(options.topic || options.topicId);
    if (explicit)
        return explicit;
    if (action === "summary" || action === "board" || action === "topics" || action === "artifacts" || action === "list-artifacts" || action === "snapshot") {
        return undefined;
    }
    const topics = (run.blackboard?.topics || []).filter((topic) => topic.blackboardId === blackboardId);
    if (topics.length === 1)
        return topics[0].id;
    if (!topics.length)
        throw new Error(`Blackboard ${blackboardId} has no topics`);
    throw new Error(`Ambiguous blackboard topic state: ${topics.map((topic) => topic.id).join(", ")}`);
}
function activeBlackboardId(run, topology) {
    const board = (run.blackboard?.boards || []).find((entry) => entry.id === topology.blackboardId);
    return board?.id;
}
function linkTopologyRecord(topology, links) {
    const faninIds = links.faninIds || [];
    const candidateIds = links.candidateIds || [];
    const selectionIds = links.selectionIds || [];
    topology.faninIds = unique([...topology.faninIds, ...faninIds]);
    topology.candidateIds = unique([...topology.candidateIds, ...candidateIds]);
    topology.selectionIds = unique([...topology.selectionIds, ...selectionIds]);
    topology.links.agentFaninIds = unique([...topology.links.agentFaninIds, ...faninIds]);
    topology.links.candidateIds = unique([...topology.links.candidateIds, ...candidateIds]);
    topology.links.selectionIds = unique([...topology.links.selectionIds, ...selectionIds]);
    topology.updatedAt = new Date().toISOString();
}
function evidenceRequirements(active, extra) {
    return unique([...active.flatMap((entry) => entry.missingEvidence), ...extra]);
}
function isTerminalTopology(topology) {
    return topology.status === "completed" || topology.status === "failed";
}
function parseCriteria(options, fallback) {
    const criteria = {};
    const structured = options.criteria;
    if (structured && typeof structured === "object" && !Array.isArray(structured)) {
        for (const [key, value] of Object.entries(structured)) {
            const parsed = Number(value);
            if (key && Number.isFinite(parsed))
                criteria[key] = parsed;
        }
    }
    for (const entry of arrayOption(options.criterion || (typeof structured === "string" ? structured : undefined) || options.score)) {
        const [key, value] = String(entry).split("=");
        if (!key || value === undefined)
            continue;
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            criteria[key] = parsed;
    }
    if (!Object.keys(criteria).length && options.total !== undefined)
        criteria.total = Number(options.total);
    if (!Object.keys(criteria).length && fallback)
        return fallback;
    if (!Object.keys(criteria).length)
        throw new Error("Missing score criteria. Use --criterion name=value");
    return criteria;
}
function explicitEvidence(options) {
    return arrayOption(options.evidence || options.evidenceRef || options["evidence-ref"]).map((entry, index) => ({
        id: `host-score:${index + 1}`,
        source: "multi-agent-host",
        locator: String(entry),
        summary: String(entry)
    }));
}
function authorityOptions(options) {
    const agentRoleId = stringOption(options.role || options.roleId || options["multi-agent-role"]);
    const agentGroupId = stringOption(options.group || options.groupId || options["multi-agent-group"]);
    const agentMembershipId = stringOption(options.membership || options.membershipId || options["multi-agent-membership"]);
    const actor = agentMembershipId
        ? { kind: "membership", id: agentMembershipId }
        : agentRoleId
            ? { kind: "role", id: agentRoleId }
            : agentGroupId
                ? { kind: "group", id: agentGroupId }
                : undefined;
    return {
        actor,
        multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
        agentRoleId,
        agentGroupId,
        agentMembershipId
    };
}
function candidateEvidence(candidate) {
    return (candidate.evidence || []).map((entry, index) => ({
        ...entry,
        id: entry.id || `candidate:${index + 1}`
    }));
}
function numberOption(value) {
    if (value === undefined || value === null || value === true)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function stringOption(value) {
    if (value === undefined || value === null || value === true)
        return undefined;
    return String(value);
}
function requireString(value, label) {
    const parsed = stringOption(value);
    if (!parsed)
        throw new Error(`Missing ${label}`);
    return parsed;
}
function arrayOption(value) {
    if (value === undefined || value === null || value === true)
        return [];
    return Array.isArray(value) ? value : [value];
}
function unique(values) {
    return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}
