"use strict";
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
exports.topologyList = topologyList;
exports.topologyShowCli = topologyShowCli;
exports.topologyValidateCli = topologyValidateCli;
exports.topologyApplyCli = topologyApplyCli;
exports.topologySummaryCli = topologySummaryCli;
exports.topologyGraphCli = topologyGraphCli;
exports.topologyRunShowCli = topologyRunShowCli;
exports.multiAgentRunCli = multiAgentRunCli;
exports.multiAgentStatusCli = multiAgentStatusCli;
exports.multiAgentStepCli = multiAgentStepCli;
exports.multiAgentBlackboardCli = multiAgentBlackboardCli;
exports.multiAgentScoreCli = multiAgentScoreCli;
exports.multiAgentSelectCli = multiAgentSelectCli;
exports.multiAgentRoleCli = multiAgentRoleCli;
exports.multiAgentGroupCli = multiAgentGroupCli;
exports.multiAgentMembershipCli = multiAgentMembershipCli;
exports.multiAgentFanoutCli = multiAgentFanoutCli;
exports.multiAgentFaninCli = multiAgentFaninCli;
exports.multiAgentShowCli = multiAgentShowCli;
exports.multiAgentSummaryCli = multiAgentSummaryCli;
exports.multiAgentGraphCli = multiAgentGraphCli;
exports.blackboardSummaryCli = blackboardSummaryCli;
exports.blackboardGraphCli = blackboardGraphCli;
exports.blackboardResolveCli = blackboardResolveCli;
exports.blackboardTopicCreateCli = blackboardTopicCreateCli;
exports.blackboardMessagePostCli = blackboardMessagePostCli;
exports.blackboardMessageListCli = blackboardMessageListCli;
exports.blackboardContextPutCli = blackboardContextPutCli;
exports.blackboardArtifactAddCli = blackboardArtifactAddCli;
exports.blackboardArtifactListCli = blackboardArtifactListCli;
exports.blackboardSnapshotCli = blackboardSnapshotCli;
exports.coordinatorSummaryCli = coordinatorSummaryCli;
exports.coordinatorDecisionCli = coordinatorDecisionCli;
exports.candidateListCli = candidateListCli;
exports.candidateShowCli = candidateShowCli;
exports.candidateRegisterCli = candidateRegisterCli;
exports.candidateScoreCli = candidateScoreCli;
exports.candidateRankCli = candidateRankCli;
exports.candidateSelectCli = candidateSelectCli;
exports.candidateRejectCli = candidateRejectCli;
exports.candidateSummaryCli = candidateSummaryCli;
exports.approveCli = approveCli;
exports.rejectCollabCli = rejectCollabCli;
exports.commentAddCli = commentAddCli;
exports.commentListCli = commentListCli;
exports.handoffCli = handoffCli;
exports.reviewStatusCli = reviewStatusCli;
exports.reviewPolicyCli = reviewPolicyCli;
exports.evalSnapshotCli = evalSnapshotCli;
exports.evalReplayCli = evalReplayCli;
exports.evalCompareCli = evalCompareCli;
exports.evalScoreCli = evalScoreCli;
exports.evalGateCli = evalGateCli;
exports.evalReportCli = evalReportCli;
const path = __importStar(require("node:path"));
const run_store_1 = require("./run-store");
const report_1 = require("./report");
const mai = __importStar(require("./multi-agent-io"));
const topio = __importStar(require("./topology-io"));
const coord = __importStar(require("./coordinator-io"));
const cs = __importStar(require("./candidate-scoring-io"));
const collab = __importStar(require("./collaboration-io"));
const evalio = __importStar(require("./eval-io"));
const host = __importStar(require("./multi-agent-host"));
const runtime_1 = require("../core/multi-agent/runtime");
const topology_1 = require("../core/multi-agent/topology");
function invocationCwd(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}
function loadRun(args, runId) {
    return (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
}
function persist(run) {
    (0, run_store_1.saveCheckpoint)(run);
    (0, report_1.writeReport)(run);
}
function optionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined;
}
function requireArg(value, label) {
    const parsed = optionalString(value);
    if (!parsed)
        throw new Error(`Missing ${label}`);
    return parsed;
}
/** Byte-exact to the eval-replay harness's own thrown strings (SPEC/
 *  multi-agent.md "Eval harness exact outputs"): these three END with a
 *  period, unlike the generic `requireArg` messages elsewhere in this
 *  file. */
function requireArgDot(value, label) {
    const parsed = optionalString(value);
    if (!parsed)
        throw new Error(`Missing ${label}.`);
    return parsed;
}
function arrayArg(value) {
    if (value === undefined || value === null || value === true)
        return [];
    return (Array.isArray(value) ? value : [value]).map(String);
}
function numberArg(value) {
    if (value === undefined || value === null || value === true)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function boolArg(value) {
    return Boolean(value);
}
/** `--multi-agent-run <id>` — parseArgv keeps kebab-case option keys
 *  verbatim (no camelCase folding), so this must check the literal
 *  `"multi-agent-run"` key alongside the camelCase aliases the MCP
 *  surface also accepts. */
function multiAgentRunArg(args) {
    return optionalString(args.multiAgentRunId ?? args.multiAgentRun ?? args["multi-agent-run"]);
}
function groupArg(args) {
    return optionalString(args.groupId ?? args.group ?? args["multi-agent-group"]);
}
// ---------------------------------------------------------------------------
// Topology (catalog — no run needed)
// ---------------------------------------------------------------------------
function topologyList() {
    return (0, topology_1.listTopologyDefinitions)();
}
function topologyShowCli(topologyId) {
    const definition = (0, topology_1.getTopologyDefinition)(topologyId);
    if (!definition)
        throw new Error(`Unknown topology id: ${topologyId}`);
    return definition;
}
function topologyValidateCli(topologyId) {
    const result = (0, topology_1.validateTopologyDefinition)(topologyId);
    return { valid: result.valid, topologyId: result.topologyId, issues: result.issues };
}
function topologyApplyCli(args) {
    const runId = requireArg(args.runId, "run id");
    const topologyId = requireArg(args.topologyId ?? args.id, "topology id");
    const run = loadRun(args, runId);
    const record = topio.applyTopology(run, topologyId, {
        id: optionalString(args.id2),
        task: undefined,
        taskIds: arrayArg(args.task ?? args.taskId),
        mapperCount: numberArg(args.mapperCount ?? args["mapper-count"] ?? args.mappers ?? args.mapper),
        judgeCount: numberArg(args.judgeCount ?? args["judge-count"] ?? args.judges ?? args.judge),
        debateRounds: numberArg(args.debateRounds ?? args["debate-rounds"] ?? args.rounds),
        blackboardId: optionalString(args.blackboardId),
        multiAgentRunId: optionalString(args.multiAgentRunId),
        collectInitialFanin: boolArg(args.collectInitialFanin ?? args["collect-initial-fanin"]),
    });
    persist(run);
    return record;
}
function topologySummaryCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return topio.summarizeTopologies(run);
}
function topologyGraphCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return topio.buildTopologyGraph(run);
}
function topologyRunShowCli(args, topologyRunId) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return topio.showTopologyRun(run, topologyRunId);
}
// ---------------------------------------------------------------------------
// Multi-agent kernel (CLI verbs: run/status/step/blackboard/score/select via
// the host, plus role/group/membership/fanout/fanin/show for direct kernel
// access, per SPEC/multi-agent.md section J).
// ---------------------------------------------------------------------------
function multiAgentRunCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const topology = optionalString(args.topology);
    let result;
    if (topology === undefined && (args.id !== undefined || args.title !== undefined)) {
        result = mai.createMultiAgentRun(run, { id: optionalString(args.id), title: optionalString(args.title), objective: optionalString(args.objective) });
    }
    else {
        result = host.hostRun(run, args);
    }
    persist(run);
    return result;
}
function multiAgentStatusCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return host.hostStatus(run);
}
function multiAgentStepCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const result = host.hostStep(run, args);
    persist(run);
    return result;
}
function multiAgentBlackboardCli(args, action) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const result = host.hostBlackboard(run, action, args);
    persist(run);
    return result;
}
function multiAgentScoreCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const result = host.hostScore(run, args);
    persist(run);
    return result;
}
function multiAgentSelectCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const result = host.hostSelect(run, args);
    persist(run);
    return result;
}
function multiAgentRoleCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const roleId = optionalString(args.roleId);
    const multiAgentRunId = multiAgentRunArg(args);
    if (roleId && !args.id && !multiAgentRunId) {
        const role = (0, runtime_1.getAgentRole)(run, roleId);
        if (!role)
            throw new Error(`Unknown AgentRole id: ${roleId}`);
        return role;
    }
    const role = mai.createAgentRole(run, {
        id: optionalString(args.id) ?? roleId,
        multiAgentRunId: requireArg(multiAgentRunId, "multi-agent run id"),
        title: optionalString(args.title),
        responsibilities: arrayArg(args.responsibility ?? args.responsibilities),
        requiredEvidence: arrayArg(args.requiredEvidence),
        sandboxProfileHints: arrayArg(args.sandboxProfileHint),
        expectedArtifacts: arrayArg(args.expectedArtifact),
        faninObligations: arrayArg(args.faninObligation),
    });
    persist(run);
    return role;
}
function multiAgentGroupCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const groupId = optionalString(args.groupId);
    const multiAgentRunId = multiAgentRunArg(args);
    if (groupId && !args.id && !multiAgentRunId) {
        const group = (0, runtime_1.getAgentGroup)(run, groupId);
        if (!group)
            throw new Error(`Unknown AgentGroup id: ${groupId}`);
        return group;
    }
    const group = mai.createAgentGroup(run, {
        id: optionalString(args.id) ?? groupId,
        multiAgentRunId: requireArg(multiAgentRunId, "multi-agent run id"),
        title: optionalString(args.title),
        phase: optionalString(args.phase),
        taskIds: arrayArg(args.task ?? args.taskId),
    });
    persist(run);
    return group;
}
function multiAgentMembershipCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const membershipId = optionalString(args.membershipId);
    const groupId = groupArg(args);
    const roleId = optionalString(args.roleId ?? args.role);
    if (membershipId && !args.id && !groupId && !roleId) {
        const membership = (0, runtime_1.getAgentMembership)(run, membershipId);
        if (!membership)
            throw new Error(`Unknown AgentMembership id: ${membershipId}`);
        return membership;
    }
    const membership = mai.assignAgentMembership(run, {
        id: optionalString(args.id) ?? membershipId,
        groupId: requireArg(groupId, "group id"),
        roleId: requireArg(roleId, "role id"),
        taskId: requireArg(args.taskId ?? args.task, "task id"),
        workerId: optionalString(args.workerId ?? args.worker),
        dispatchId: optionalString(args.dispatchId),
        fanoutId: optionalString(args.fanoutId),
    });
    persist(run);
    return membership;
}
function multiAgentFanoutCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const fanoutId = optionalString(args.fanoutId);
    const groupId = groupArg(args);
    if (fanoutId && !args.id && !groupId) {
        const fanout = (0, runtime_1.getAgentFanout)(run, fanoutId);
        if (!fanout)
            throw new Error(`Unknown AgentFanout id: ${fanoutId}`);
        return fanout;
    }
    const fanout = mai.createAgentFanout(run, {
        id: optionalString(args.id) ?? fanoutId,
        groupId: requireArg(groupId, "group id"),
        reason: requireArg(args.reason, "reason"),
        roleIds: arrayArg(args.role ?? args.roleId),
        taskIds: arrayArg(args.task ?? args.taskId),
        concurrencyLimit: numberArg(args.limit),
    });
    persist(run);
    return fanout;
}
function multiAgentFaninCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const faninId = optionalString(args.faninId);
    const groupId = groupArg(args);
    const fanoutId = optionalString(args.fanoutId ?? args.fanout);
    if (faninId && !args.id && !groupId && !fanoutId) {
        const fanin = (0, runtime_1.getAgentFanin)(run, faninId);
        if (!fanin)
            throw new Error(`Unknown AgentFanin id: ${faninId}`);
        return fanin;
    }
    const fanin = mai.collectAgentFanin(run, {
        id: optionalString(args.id) ?? faninId,
        groupId,
        fanoutId,
        requiredRoleIds: arrayArg(args.requiredRole),
        strategy: optionalString(args.strategy),
    });
    persist(run);
    return fanin;
}
function multiAgentShowCli(args, id) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const record = (0, runtime_1.getMultiAgentRun)(run, id);
    if (!record)
        throw new Error(`Unknown MultiAgentRun id: ${id}`);
    return record;
}
function multiAgentSummaryCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return mai.summarizeMultiAgent(run);
}
function multiAgentGraphCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return mai.buildMultiAgentGraph(run);
}
// ---------------------------------------------------------------------------
// Blackboard / coordinator
// ---------------------------------------------------------------------------
function blackboardSummaryCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return coord.summarizeBlackboard(run, optionalString(args.blackboardId));
}
function blackboardGraphCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return coord.buildBlackboardGraph(run);
}
function blackboardResolveCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const board = coord.resolveBlackboard(run, { id: optionalString(args.id), title: optionalString(args.title), multiAgentRunId: optionalString(args.multiAgentRunId), groupId: optionalString(args.groupId), roleId: optionalString(args.roleId), membershipId: optionalString(args.membershipId) });
    persist(run);
    return board;
}
function blackboardTopicCreateCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const topic = coord.createBlackboardTopic(run, { id: optionalString(args.id), title: requireArg(args.title, "topic title"), description: optionalString(args.description), blackboardId: optionalString(args.blackboardId), tags: arrayArg(args.tag) });
    persist(run);
    return topic;
}
function blackboardMessagePostCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const message = coord.postBlackboardMessage(run, { id: optionalString(args.id), topicId: requireArg(args.topic ?? args.topicId, "topic id"), blackboardId: optionalString(args.blackboardId), body: requireArg(args.body, "message body"), replyToId: optionalString(args.replyTo), evidenceRefs: arrayArg(args.evidence), artifactRefIds: arrayArg(args.artifact) });
    persist(run);
    return message;
}
function blackboardMessageListCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return coord.listBlackboardMessages(run, { topicId: optionalString(args.topic ?? args.topicId), blackboardId: optionalString(args.blackboardId) });
}
function blackboardContextPutCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const context = coord.putBlackboardContext(run, { id: optionalString(args.id), topicId: requireArg(args.topic ?? args.topicId, "topic id"), kind: requireArg(args.kind, "context kind"), key: optionalString(args.key), value: requireArg(args.value ?? args.body, "context value"), blackboardId: optionalString(args.blackboardId), supersedesContextIds: arrayArg(args.supersedes), evidenceRefs: arrayArg(args.evidence), artifactRefIds: arrayArg(args.artifact) });
    persist(run);
    return context;
}
function blackboardArtifactAddCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const artifact = coord.addBlackboardArtifact(run, { id: optionalString(args.id), topicId: optionalString(args.topic), kind: requireArg(args.kind, "artifact kind"), path: optionalString(args.path), locator: optionalString(args.locator), blackboardId: optionalString(args.blackboardId), source: optionalString(args.source), evidenceRefs: arrayArg(args.evidence) });
    persist(run);
    return artifact;
}
function blackboardArtifactListCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return coord.listBlackboardArtifacts(run, { topicId: optionalString(args.topic), blackboardId: optionalString(args.blackboardId) });
}
function blackboardSnapshotCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const snapshot = coord.createBlackboardSnapshot(run, optionalString(args.blackboardId));
    persist(run);
    return snapshot;
}
function coordinatorSummaryCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return coord.summarizeBlackboard(run, optionalString(args.blackboardId));
}
function coordinatorDecisionCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const decision = coord.recordCoordinatorDecision(run, { id: optionalString(args.id), blackboardId: optionalString(args.blackboardId), kind: requireArg(args.kind, "decision kind"), outcome: requireArg(args.outcome, "decision outcome"), reason: requireArg(args.reason, "decision reason"), subjectIds: arrayArg(args.subject), evidenceRefs: arrayArg(args.evidence), artifactRefIds: arrayArg(args.artifact), messageIds: arrayArg(args.message) });
    persist(run);
    return decision;
}
// ---------------------------------------------------------------------------
// Candidate scoring
// ---------------------------------------------------------------------------
function candidateListCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return cs.listCandidates(run, { status: optionalString(args.status), kind: optionalString(args.kind) });
}
function candidateShowCli(args, candidateId) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const candidate = cs.getCandidate(run, candidateId);
    if (!candidate)
        throw new Error(`Unknown candidate for run ${runId}: ${candidateId}`);
    return candidate;
}
function candidateRegisterCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const candidate = cs.registerCandidate(run, { id: optionalString(args.id), kind: optionalString(args.kind), workerId: optionalString(args.worker ?? args.workerId), taskId: optionalString(args.task ?? args.taskId), resultNodeId: optionalString(args.resultNode), verifierNodeId: optionalString(args.verifierNode), resultPath: optionalString(args.resultPath) });
    persist(run);
    return candidate;
}
function parseCriteriaCli(args) {
    const criteria = {};
    const structured = args.criteria;
    if (structured && typeof structured === "object" && !Array.isArray(structured)) {
        for (const [key, value] of Object.entries(structured)) {
            const parsed = Number(value);
            if (key && Number.isFinite(parsed))
                criteria[key] = parsed;
        }
    }
    for (const entry of arrayArg(args.criterion)) {
        const [key, value] = entry.split("=");
        if (!key || value === undefined)
            continue;
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            criteria[key] = parsed;
    }
    if (!Object.keys(criteria).length)
        throw new Error("Missing score criteria. Use --criterion name=value");
    return criteria;
}
function candidateScoreCli(args, candidateId) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const evidence = arrayArg(args.evidence).map((entry, index) => ({ id: `score:${index + 1}`, source: "cli", locator: entry, summary: entry }));
    const score = cs.scoreCandidate(run, candidateId, { id: optionalString(args.id), scorer: optionalString(args.scorer), criteria: parseCriteriaCli(args), maxTotal: numberArg(args.maxTotal ?? args.max), verdict: optionalString(args.verdict), evidence, notes: optionalString(args.notes) });
    persist(run);
    return score;
}
function candidateRankCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const ranking = cs.rankCandidates(run, { includeRejected: boolArg(args.includeRejected), policy: { minNormalized: numberArg(args.minNormalized), requireEvidence: args.requireEvidence === undefined ? undefined : boolArg(args.requireEvidence), requireVerifierGate: args.requireVerifierGate === undefined ? undefined : boolArg(args.requireVerifierGate), tieBreaker: optionalString(args.tieBreaker) } });
    persist(run);
    return ranking;
}
function candidateSelectCli(args, candidateId) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const selection = cs.selectCandidate(run, candidateId, { selectedBy: optionalString(args.selectedBy ?? args.by), reason: optionalString(args.reason), scoreId: optionalString(args.score), allowUnverified: boolArg(args.allowUnverified) }, { policy: { minNormalized: numberArg(args.minNormalized), requireVerifierGate: args.requireVerifierGate === undefined ? undefined : boolArg(args.requireVerifierGate) } });
    persist(run);
    return selection;
}
function candidateRejectCli(args, candidateId) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const candidate = cs.rejectCandidate(run, candidateId, requireArg(args.reason, "reject reason"));
    persist(run);
    return candidate;
}
function candidateSummaryCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return cs.summarizeCandidates(run);
}
// ---------------------------------------------------------------------------
// Collaboration
// ---------------------------------------------------------------------------
function targetFromArgs(args, positionalKind, positionalId) {
    const kind = optionalString(args.targetKind ?? args.kind ?? positionalKind);
    const id = optionalString(args.targetId ?? args.target ?? positionalId);
    if (!kind || !id)
        throw new Error("Collaboration target requires a kind and id");
    return { kind, id };
}
function approveCli(args, positionalKind, positionalId) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const target = targetFromArgs(args, positionalKind, positionalId);
    const record = collab.recordApproval(run, { target: target, decision: "approve", actor: optionalString(args.actor), actorKind: optionalString(args.actorKind), role: optionalString(args.role), displayName: optionalString(args.displayName), attested: boolArg(args.attested), attestation: optionalString(args.attestation), rationale: optionalString(args.rationale), supersedes: optionalString(args.supersedes) });
    return record;
}
function rejectCollabCli(args, positionalKind, positionalId) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const target = targetFromArgs(args, positionalKind, positionalId);
    const record = collab.recordApproval(run, { target: target, decision: "reject", actor: optionalString(args.actor), actorKind: optionalString(args.actorKind), role: optionalString(args.role), displayName: optionalString(args.displayName), attested: boolArg(args.attested), attestation: optionalString(args.attestation), rationale: optionalString(args.rationale) });
    return record;
}
function commentAddCli(args, positionalKind, positionalId) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const target = targetFromArgs(args, positionalKind, positionalId);
    const record = collab.recordComment(run, { target: target, body: requireArg(args.body ?? args.message ?? args.text, "comment body"), actor: optionalString(args.actor), actorKind: optionalString(args.actorKind), role: optionalString(args.role), threadId: optionalString(args.thread), parentId: optionalString(args.parent) });
    return record;
}
function commentListCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const targetKind = optionalString(args.targetKind);
    const targetId = optionalString(args.target);
    return collab.listComments(run, targetKind && targetId ? { kind: targetKind, id: targetId } : undefined);
}
function handoffCli(args, positionalKind, positionalId) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const target = targetFromArgs(args, positionalKind, positionalId);
    const record = collab.recordHandoff(run, { target: target, toActor: optionalString(args.to ?? args.toActor), toRole: optionalString(args.toRole), fromActor: optionalString(args.from), reason: requireArg(args.reason, "handoff reason"), actor: optionalString(args.actor), actorKind: optionalString(args.actorKind), role: optionalString(args.role) });
    return record;
}
function reviewStatusCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const targetKind = optionalString(args.targetKind);
    const targetId = optionalString(args.target);
    return collab.buildReviewStatusReport(run, { now: new Date().toISOString(), target: targetKind && targetId ? { kind: targetKind, id: targetId } : undefined });
}
function reviewPolicyCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const policy = collab.setReviewPolicy(run, { requiredApprovals: numberArg(args.requiredApprovals), authorizedRoles: arrayArg(args.authorizedRoles).length ? arrayArg(args.authorizedRoles) : optionalString(args.authorizedRoles), allowSelfApproval: args.allowSelfApproval === undefined ? undefined : boolArg(args.allowSelfApproval), requireAttestedActor: args.requireAttestedActor === undefined ? undefined : boolArg(args.requireAttestedActor), appliesTo: arrayArg(args.appliesTo).length ? arrayArg(args.appliesTo) : optionalString(args.appliesTo) });
    return policy;
}
// ---------------------------------------------------------------------------
// Eval replay
// ---------------------------------------------------------------------------
function evalSnapshotCli(args) {
    const runId = requireArgDot(args.runId, "run id");
    const run = loadRun(args, runId);
    return evalio.createMultiAgentReplaySnapshot(run, args);
}
function evalReplayCli(args) {
    const target = requireArgDot(args.snapshot ?? args.snapshotId ?? args.path, "snapshot id or path");
    return evalio.replayMultiAgentSnapshot(target, args);
}
function evalCompareCli(args) {
    const baseline = requireArgDot(args.baseline ?? args.baselinePath, "baseline id or path");
    const replay = requireArgDot(args.replay ?? args.replayPath, "replay id or path");
    return evalio.compareMultiAgentReplay(baseline, replay);
}
function evalScoreCli(args) {
    const target = requireArg(args.replay ?? args.replayPath ?? args.path, "replay id or path");
    return evalio.scoreMultiAgentReplay(target);
}
function evalGateCli(args) {
    const target = requireArg(args.suite ?? args.suiteId ?? args.path, "suite id or path");
    return evalio.gateMultiAgentEval(target);
}
function evalReportCli(args) {
    const target = requireArg(args.replay ?? args.replayPath ?? args.path, "replay id or path");
    return evalio.reportMultiAgentEval(target);
}
