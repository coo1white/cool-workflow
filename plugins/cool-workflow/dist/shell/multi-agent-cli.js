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
exports.multiAgentStatusText = multiAgentStatusText;
exports.multiAgentDependenciesCli = multiAgentDependenciesCli;
exports.multiAgentDependenciesText = multiAgentDependenciesText;
exports.multiAgentFailuresCli = multiAgentFailuresCli;
exports.multiAgentFailuresText = multiAgentFailuresText;
exports.multiAgentEvidenceCli = multiAgentEvidenceCli;
exports.multiAgentReasoningCli = multiAgentReasoningCli;
exports.multiAgentReasoningText = multiAgentReasoningText;
exports.multiAgentReasoningRefreshCli = multiAgentReasoningRefreshCli;
exports.multiAgentEvidenceText = multiAgentEvidenceText;
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
exports.multiAgentSummarizeCli = multiAgentSummarizeCli;
exports.multiAgentGraphCompactCli = multiAgentGraphCompactCli;
exports.blackboardSummarizeCli = blackboardSummarizeCli;
exports.contractShowCli = contractShowCli;
exports.multiAgentGraphCli = multiAgentGraphCli;
exports.multiAgentGraphText = multiAgentGraphText;
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
const worker_isolation_1 = require("./worker-isolation");
const topology_1 = require("../core/multi-agent/topology");
const multi_agent_operator_ux_1 = require("./multi-agent-operator-ux");
const operator_ux_text_1 = require("./operator-ux-text");
const report_2 = require("../core/state/state-explosion/report");
const graph_1 = require("../core/state/state-explosion/graph");
const digest_1 = require("../core/state/state-explosion/digest");
const state_explosion_cli_1 = require("./state-explosion-cli");
const runner_1 = require("../core/pipeline/runner");
const operator_ux_1 = require("./operator-ux");
const reasoning = __importStar(require("./evidence-reasoning"));
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
/** `--blackboard <id>` — byte-exact to the old build's
 *  `options.blackboard || options.blackboardId` read
 *  (orchestrator/multi-agent-operations.ts). parseArgv keeps `--blackboard`
 *  as the literal key `blackboard`; the MCP surface also accepts
 *  `blackboardId`. */
function blackboardIdArg(args) {
    return optionalString(args.blackboard ?? args.blackboardId);
}
/** `--topic <id>` (repeatable) — byte-exact to the old build's
 *  `options.topic || options.topicId || options.topics` read. */
function topicIdsArg(args) {
    const raw = args.topic ?? args.topicId ?? args.topics;
    return arrayArg(raw);
}
/** `--author-id`/`--author-kind`/`--author-name` (or the `worker`/`role`/
 *  `group` fallbacks) — byte-exact port of parseBlackboardAuthor
 *  (orchestrator/cli-options.ts). Threaded into every blackboard write so a
 *  message/context/artifact carries the posting role, not the default. */
function parseBlackboardAuthorCli(args) {
    const structured = args.author;
    if (structured && typeof structured === "object" && !Array.isArray(structured))
        return structured;
    const id = optionalString(args.authorId ?? args.author ?? args.worker ?? args.workerId ?? args.role ?? args.roleId ?? args.group ?? args.groupId);
    const kind = optionalString(args.authorKind ?? args.sourceKind ?? args.source);
    const displayName = optionalString(args.authorName ?? args.displayName);
    if (!id && !kind && !displayName)
        return undefined;
    return { kind, id, displayName };
}
/** `--scope-kind`/`--scope-id` — byte-exact port of parseBlackboardScope. */
function parseBlackboardScopeCli(args) {
    const structured = args.scope;
    if (structured && typeof structured === "object" && !Array.isArray(structured))
        return structured;
    const kind = optionalString(args.scopeKind);
    const id = optionalString(args.scopeId);
    if (!kind && !id)
        return undefined;
    return { kind, id };
}
/** `--multi-agent-*`/`--task`/`--worker`/`--evidence` etc → BlackboardLinks —
 *  byte-exact port of parseBlackboardLinks (orchestrator/cli-options.ts). */
function parseBlackboardLinksCli(runId, args) {
    const structured = args.provenance ?? args.links;
    if (structured && typeof structured === "object" && !Array.isArray(structured))
        return structured;
    const links = {
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
function parseSandboxChoicesCli(args) {
    const choices = {};
    const structured = args.sandboxChoices ?? args.sandboxProfileChoices;
    if (structured && typeof structured === "object" && !Array.isArray(structured)) {
        for (const [key, value] of Object.entries(structured))
            choices[key] = String(value);
    }
    for (const entry of arrayArg(args.sandboxChoice ?? args["sandbox-choice"])) {
        const [key, ...rest] = String(entry).split("=");
        if (key && rest.length)
            choices[key] = rest.join("=");
    }
    const sandbox = optionalString(args.sandbox ?? args.sandboxProfile ?? args.sandboxProfileId);
    if (sandbox && !Object.keys(choices).length)
        choices.default = sandbox;
    return Object.keys(choices).length ? choices : undefined;
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
        const record = mai.transitionMultiAgentRun(run, transitionId, status, {
            reason: optionalString(args.reason),
            actor: optionalString(args.actor),
        });
        persist(run);
        return record;
    }
    if (!isHostRun && transitionId && !status && args.title === undefined && args.objective === undefined && args.id === undefined) {
        // `multi-agent run <run> <id>` (positional id, no status/create flags) —
        // SHOW the MultiAgentRun record (old handler's showMultiAgentRun arm).
        const record = (0, runtime_1.getMultiAgentRun)(run, transitionId);
        if (!record)
            throw new Error(`Unknown MultiAgentRun id: ${transitionId}`);
        return record;
    }
    let result;
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
/** `cw multi-agent status <run>` human text — the operator-UX status panel
 *  (Agent Graph / Dependencies / Failed-Blocked / Adopted-Missing Evidence
 *  / Next Action). Port of the old CLI handler's non-`--json` status arm
 *  (cli/handlers/multi-agent.ts). */
function multiAgentStatusText(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return (0, multi_agent_operator_ux_1.formatMultiAgentOperatorStatus)((0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run));
}
/** `cw multi-agent dependencies <run>` — derived dependency edges (JSON). */
function multiAgentDependenciesCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run).dependencies;
}
function multiAgentDependenciesText(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return (0, multi_agent_operator_ux_1.formatMultiAgentDependencies)((0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run).dependencies);
}
/** `cw multi-agent failures <run>` — failed/blocked/rejected/ambiguous rows. */
function multiAgentFailuresCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run).failures;
}
function multiAgentFailuresText(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return (0, multi_agent_operator_ux_1.formatMultiAgentFailures)((0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run).failures);
}
/** `cw multi-agent evidence <run>` — evidence adoption rows, each additively
 *  enriched with the derived rationaleStatus (explained|unexplained|
 *  not-applicable) from the reasoning report. Port of the old
 *  runner.multiAgentEvidence enrichment. */
function multiAgentEvidenceCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const rows = (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run).evidence;
    const report = reasoning.buildEvidenceReasoningReport(run, { index: reasoning.loadEvidenceReasoningIndex(run) });
    const byId = new Map(report.chains.map((chain) => [chain.id, chain.rationaleStatus]));
    for (const row of rows)
        row.rationaleStatus = byId.get(row.id) ?? "not-applicable";
    return rows;
}
/** `cw multi-agent reasoning <run> [--refresh] [--evidence <id>]` — the
 *  evidence adoption reasoning report (or a durable-index refresh). Port of
 *  the old runner.multiAgentReasoning / multiAgentReasoningRefresh. */
function multiAgentReasoningCli(args) {
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
function multiAgentReasoningText(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const evidenceId = optionalString(args.evidence ?? args.evidenceId ?? args.id);
    return reasoning.formatEvidenceReasoningReport(reasoning.showEvidenceReasoning(run, { evidenceId }));
}
function multiAgentReasoningRefreshCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const index = reasoning.refreshEvidenceReasoning(run);
    persist(run);
    return index;
}
function multiAgentEvidenceText(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const rows = (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run).evidence;
    const report = reasoning.buildEvidenceReasoningReport(run, { index: reasoning.loadEvidenceReasoningIndex(run) });
    const byId = new Map(report.chains.map((chain) => [chain.id, chain.rationaleStatus]));
    for (const row of rows)
        row.rationaleStatus = byId.get(row.id) ?? "not-applicable";
    return (0, multi_agent_operator_ux_1.formatMultiAgentEvidence)(rows);
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
        status: optionalString(args.status),
        blackboardId: blackboardIdArg(args),
        topicIds: topicIdsArg(args),
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
/** `cw multi-agent summarize <run>` / `cw_multi_agent_summarize` — the
 *  combined state-explosion report (loads the persisted summary index when
 *  present). Port of the old runner.multiAgentSummarize. */
function multiAgentSummarizeCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return (0, report_2.buildStateExplosionReport)(run, { index: (0, state_explosion_cli_1.loadStateExplosionSummaryIndex)(run), operator: (0, multi_agent_operator_ux_1.operatorDigestInput)(run) });
}
/** `cw_multi_agent_graph_compact` — a compact/focused multi-agent graph
 *  view. Port of the old runner.multiAgentGraphView. */
function multiAgentGraphCompactCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const view = optionalString(args.view);
    // Protect every reasoning-chain decision-gate node from collapse (the old
    // build fed reasoningCriticalNodeIds into buildCompactGraph so an adopted
    // chain's score/selection/commit/fanin nodes survive compaction).
    return (0, graph_1.buildCompactGraphFromView)(run.id, (0, graph_1.runToGraphViewFromWorkflowRun)(run), view || "compact", {
        focus: optionalString(args.focus),
        depth: numberArg(args.depth),
        reasoningCriticalIds: reasoning.reasoningCriticalNodeIds(run),
    });
}
/** `cw blackboard summarize <run>` / `cw_blackboard_summarize` — a blackboard
 *  digest with conflicts/evidence. Port of the old runner.blackboardSummarize. */
function blackboardSummarizeCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return (0, digest_1.summarizeBlackboardDigest)({ id: run.id, blackboard: run.blackboard }, blackboardIdArg(args));
}
/** `cw contract show <run> [contract-id]` / `cw_contract_show` — the run's
 *  resolved pipeline contract. Port of the old runner.showContract. */
function contractShowCli(args, contractId) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return (0, runner_1.getRunContract)(run, contractId ?? optionalString(args.contractId));
}
function multiAgentGraphCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return (0, multi_agent_operator_ux_1.buildMultiAgentOperatorGraph)(run);
}
/** `cw multi-agent graph <run>` human text — the operator graph render
 *  (nodes grouped by kind, then edges). Reuses the operator-ux graph
 *  formatter so `cw graph` and `cw multi-agent graph` render identically. */
function multiAgentGraphText(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    return (0, operator_ux_text_1.formatOperatorGraph)((0, multi_agent_operator_ux_1.buildMultiAgentOperatorGraph)(run));
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
    const topic = coord.createBlackboardTopic(run, { id: optionalString(args.id), title: requireArg(args.title, "topic title"), description: optionalString(args.description), blackboardId: optionalString(args.blackboardId), author: parseBlackboardAuthorCli(args), scope: parseBlackboardScopeCli(args), tags: arrayArg(args.tag) });
    persist(run);
    return topic;
}
function blackboardMessagePostCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const message = coord.postBlackboardMessage(run, { id: optionalString(args.id), topicId: requireArg(args.topic ?? args.topicId, "topic id"), blackboardId: optionalString(args.blackboardId), body: requireArg(args.body, "message body"), replyToId: optionalString(args.replyTo), visibility: optionalString(args.visibility), author: parseBlackboardAuthorCli(args), scope: parseBlackboardScopeCli(args), links: parseBlackboardLinksCli(runId, args), tags: arrayArg(args.tag), evidenceRefs: arrayArg(args.evidence), artifactRefIds: arrayArg(args.artifact) });
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
    const context = coord.putBlackboardContext(run, { id: optionalString(args.id), topicId: requireArg(args.topic ?? args.topicId, "topic id"), kind: requireArg(args.kind, "context kind"), key: optionalString(args.key), value: requireArg(args.value ?? args.body, "context value"), blackboardId: optionalString(args.blackboardId), supersedesContextIds: arrayArg(args.supersedes), author: parseBlackboardAuthorCli(args), scope: parseBlackboardScopeCli(args), links: parseBlackboardLinksCli(runId, args), tags: arrayArg(args.tag), evidenceRefs: arrayArg(args.evidence), artifactRefIds: arrayArg(args.artifact) });
    persist(run);
    return context;
}
function blackboardArtifactAddCli(args) {
    const runId = requireArg(args.runId, "run id");
    const run = loadRun(args, runId);
    const artifact = coord.addBlackboardArtifact(run, { id: optionalString(args.id), topicId: optionalString(args.topic ?? args.topicId), kind: requireArg(args.kind, "artifact kind"), path: optionalString(args.path), locator: optionalString(args.locator), blackboardId: optionalString(args.blackboardId), source: optionalString(args.source), author: parseBlackboardAuthorCli(args), scope: parseBlackboardScopeCli(args), links: parseBlackboardLinksCli(runId, args), tags: arrayArg(args.tag), evidenceRefs: arrayArg(args.evidence) });
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
    // `candidate register --worker <id>` — derive the worker's accepted
    // result/verifier state nodes (and result path) from the worker scope +
    // its backing task, so a candidate registered from a verified worker
    // carries the verifier gate the selection gate requires. Port of the old
    // orchestrator/candidate-operations.ts registerCandidate worker read
    // (v2's candidateRegisterCli only forwarded --result-node/--verifier-node).
    const workerId = optionalString(args.worker ?? args.workerId);
    const worker = workerId ? (0, worker_isolation_1.getWorkerScope)(run, workerId) : undefined;
    if (workerId && !worker)
        throw new Error(`Unknown worker id for run ${run.id}: ${workerId}`);
    const workerOutput = worker?.output;
    const task = worker ? run.tasks.find((entry) => entry.id === worker.taskId) : undefined;
    const resultNodeId = optionalString(args.resultNode) || worker?.resultNodeId || task?.resultNodeId;
    const verifierNodeId = optionalString(args.verifierNode) || workerOutput?.verifierNodeId || task?.verifierNodeId;
    const resultPath = optionalString(args.resultPath) || workerOutput?.resultPath || task?.resultPath;
    const candidate = cs.registerCandidate(run, {
        id: optionalString(args.id),
        kind: optionalString(args.kind),
        workerId,
        taskId: optionalString(args.task ?? args.taskId) || worker?.taskId,
        resultNodeId,
        verifierNodeId,
        resultPath,
    });
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
    // `candidate summary` returns the operator candidate summary (with
    // readyForCommit/selected/problems/candidates), matching the old build's
    // summarizeCandidateOperatorRecords — not the bare counts.
    return (0, operator_ux_1.summarizeCandidateOperatorRecords)(run);
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
    const policy = collab.setReviewPolicy(run, { requiredApprovals: numberArg(requiredApprovals), authorizedRoles: arrayArg(authorizedRoles).length ? arrayArg(authorizedRoles) : optionalString(authorizedRoles), allowSelfApproval: allowSelfApproval === undefined ? undefined : boolArg(allowSelfApproval), requireAttestedActor: requireAttestedActor === undefined ? undefined : boolArg(requireAttestedActor), appliesTo: arrayArg(appliesTo).length ? arrayArg(appliesTo) : optionalString(appliesTo) });
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
