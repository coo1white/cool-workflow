"use strict";
// CLI option parsing & coercion utilities — extracted from orchestrator.ts.
//
// Pure functions that turn the raw parsed-argv option bag into typed values
// (strings, numbers, arrays, actors, blackboard scopes, sandbox choices, …).
// No run state, no I/O. The orchestrator imports the subset it uses.
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLLABORATION_TARGET_KINDS = void 0;
exports.isMissing = isMissing;
exports.numberOption = numberOption;
exports.stringOption = stringOption;
exports.requiredStringOption = requiredStringOption;
exports.collaborationTarget = collaborationTarget;
exports.collaborationTargetMaybe = collaborationTargetMaybe;
exports.actorInputFrom = actorInputFrom;
exports.firstDefined = firstDefined;
exports.graphViewOption = graphViewOption;
exports.graphViewsOption = graphViewsOption;
exports.metadataOption = metadataOption;
exports.withoutHostRunKeys = withoutHostRunKeys;
exports.optionsRecord = optionsRecord;
exports.parseBlackboardAuthor = parseBlackboardAuthor;
exports.parseBlackboardScope = parseBlackboardScope;
exports.parseBlackboardLinks = parseBlackboardLinks;
exports.parseSandboxChoices = parseSandboxChoices;
exports.parseCriteria = parseCriteria;
exports.parseEvidence = parseEvidence;
exports.mergeEvidence = mergeEvidence;
exports.arrayOption = arrayOption;
exports.valuesOption = valuesOption;
exports.inferAuditDecisionKind = inferAuditDecisionKind;
exports.isSandboxProfileError = isSandboxProfileError;
exports.validationIssuesFromError = validationIssuesFromError;
const sandbox_profile_1 = require("../sandbox-profile");
const state_explosion_1 = require("../state-explosion");
const workflow_app_framework_1 = require("../workflow-app-framework");
function isMissing(value) {
    return value === undefined || value === null || value === "";
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
function requiredStringOption(value, label) {
    const parsed = stringOption(value);
    if (!parsed)
        throw new Error(`Missing ${label}`);
    return parsed;
}
exports.COLLABORATION_TARGET_KINDS = ["run", "task", "candidate", "selection", "commit", "node"];
function collaborationTarget(kind, id) {
    const normalizedKind = stringOption(kind);
    const normalizedId = stringOption(id);
    if (!normalizedKind || !exports.COLLABORATION_TARGET_KINDS.includes(normalizedKind)) {
        throw new Error(`Target kind must be one of ${exports.COLLABORATION_TARGET_KINDS.join("|")}`);
    }
    if (!normalizedId)
        throw new Error("Missing target id");
    return { kind: normalizedKind, id: normalizedId };
}
function collaborationTargetMaybe(kind, id) {
    if (!kind && !id)
        return undefined;
    return collaborationTarget(String(kind || ""), String(id || ""));
}
function actorInputFrom(options) {
    return {
        actor: stringOption(firstDefined(options, "actor", "by")),
        actorKind: stringOption(firstDefined(options, "actorKind", "actor-kind", "kind")),
        role: stringOption(firstDefined(options, "role", "roleId", "role-id")),
        displayName: stringOption(firstDefined(options, "displayName", "display-name", "name")),
        attested: Boolean(options.attested),
        attestation: stringOption(options.attestation)
    };
}
/** First option value present under any of the given keys (camelCase or dashed). */
function firstDefined(options, ...keys) {
    for (const key of keys) {
        if (options[key] !== undefined)
            return options[key];
    }
    return undefined;
}
function graphViewOption(value) {
    const parsed = stringOption(value);
    if (!parsed)
        return "compact";
    if (!state_explosion_1.GRAPH_VIEWS.includes(parsed)) {
        throw new Error(`Unknown graph view: ${parsed}. Valid views: ${state_explosion_1.GRAPH_VIEWS.join(", ")}`);
    }
    return parsed;
}
function graphViewsOption(options) {
    const raw = arrayOption(options.view || options.views).map(String);
    if (!raw.length)
        return undefined;
    for (const view of raw) {
        if (!state_explosion_1.GRAPH_VIEWS.includes(view)) {
            throw new Error(`Unknown graph view: ${view}. Valid views: ${state_explosion_1.GRAPH_VIEWS.join(", ")}`);
        }
    }
    return raw;
}
function metadataOption(options) {
    const raw = options.metadata;
    if (raw && typeof raw === "object" && !Array.isArray(raw))
        return raw;
    if (typeof raw === "string")
        return JSON.parse(raw);
    return undefined;
}
function withoutHostRunKeys(args) {
    const copy = { ...args };
    for (const key of [
        "app",
        "appId",
        "workflow",
        "workflowId",
        "inputs",
        "topology",
        "topologyId",
        "topologyRun",
        "topologyRunId",
        "multiAgentRun",
        "multiAgentRunId",
        "blackboard",
        "blackboardId",
        "mapperCount",
        "mappers",
        "mapper",
        "judgeCount",
        "judges",
        "judge",
        "debateRounds",
        "rounds",
        "collectInitialFanin",
        "collect-initial-fanin"
    ]) {
        delete copy[key];
    }
    return { ...copy, ...(optionsRecord(args.inputs) || {}) };
}
function optionsRecord(value) {
    if (value && typeof value === "object" && !Array.isArray(value))
        return value;
    return undefined;
}
function parseBlackboardAuthor(options) {
    const structured = options.author;
    if (structured && typeof structured === "object" && !Array.isArray(structured))
        return structured;
    const id = stringOption(options.authorId || options.author || options.worker || options.workerId || options.role || options.roleId || options.group || options.groupId);
    const kind = stringOption(options.authorKind || options.sourceKind || options.source);
    const displayName = stringOption(options.authorName || options.displayName);
    if (!id && !kind && !displayName)
        return undefined;
    return { kind: kind, id, displayName };
}
function parseBlackboardScope(options) {
    const structured = options.scope;
    if (structured && typeof structured === "object" && !Array.isArray(structured))
        return structured;
    const kind = stringOption(options.scopeKind);
    const id = stringOption(options.scopeId);
    if (!kind && !id)
        return undefined;
    return { kind: kind, id };
}
function parseBlackboardLinks(runId, options) {
    const structured = options.provenance || options.links;
    if (structured && typeof structured === "object" && !Array.isArray(structured))
        return structured;
    const links = {
        workflowRunId: runId,
        multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
        agentGroupId: stringOption(options.group || options.groupId || options["multi-agent-group"]),
        agentRoleId: stringOption(options.role || options.roleId || options["multi-agent-role"]),
        agentMembershipId: stringOption(options.membership || options.membershipId || options["multi-agent-membership"]),
        agentFanoutId: stringOption(options.fanout || options.fanoutId || options["multi-agent-fanout"]),
        agentFaninId: stringOption(options.fanin || options.faninId || options["multi-agent-fanin"]),
        taskId: stringOption(options.task || options.taskId),
        workerId: stringOption(options.worker || options.workerId),
        candidateId: stringOption(options.candidate || options.candidateId),
        verifierNodeId: stringOption(options.verifier || options.verifierNode || options.verifierNodeId),
        commitId: stringOption(options.commit || options.commitId),
        auditEventIds: arrayOption(options.audit || options.auditEvent || options.auditEventId || options["audit-event"]).map(String),
        evidenceRefs: arrayOption(options.evidence || options.evidenceRef || options["evidence-ref"]).map(String)
    };
    const entries = Object.entries(links).filter(([, value]) => value !== undefined && (!Array.isArray(value) || value.length));
    return entries.length > 1 ? Object.fromEntries(entries) : undefined;
}
function parseSandboxChoices(options) {
    const choices = {};
    const structured = options.sandboxChoices || options.sandboxProfileChoices;
    if (structured && typeof structured === "object" && !Array.isArray(structured)) {
        for (const [key, value] of Object.entries(structured))
            choices[key] = String(value);
    }
    for (const entry of arrayOption(options.sandboxChoice || options["sandbox-choice"])) {
        const [key, ...rest] = String(entry).split("=");
        if (key && rest.length)
            choices[key] = rest.join("=");
    }
    const sandbox = stringOption(options.sandbox || options.sandboxProfile || options.sandboxProfileId);
    if (sandbox && !Object.keys(choices).length)
        choices.default = sandbox;
    return Object.keys(choices).length ? choices : undefined;
}
function parseCriteria(options) {
    const criteria = {};
    const structured = options.criteria;
    if (structured && typeof structured === "object" && !Array.isArray(structured)) {
        for (const [key, value] of Object.entries(structured)) {
            const parsed = Number(value);
            if (key && Number.isFinite(parsed))
                criteria[key] = parsed;
        }
    }
    const rawCriteria = options.criterion || (typeof structured === "object" && !Array.isArray(structured) ? undefined : structured) || options.score;
    for (const entry of arrayOption(rawCriteria)) {
        const [key, value] = String(entry).split("=");
        if (!key || value === undefined)
            continue;
        criteria[key] = Number(value);
    }
    if (!Object.keys(criteria).length && options.total !== undefined) {
        criteria.total = Number(options.total);
    }
    if (!Object.keys(criteria).length)
        throw new Error("Missing score criteria. Use --criterion name=value");
    return criteria;
}
function parseEvidence(value) {
    return arrayOption(value).map((entry, index) => ({
        id: `score:${index + 1}`,
        source: "candidate-score",
        locator: String(entry),
        summary: String(entry)
    }));
}
function mergeEvidence(left, right) {
    const merged = [...left];
    for (const item of right) {
        const index = merged.findIndex((entry) => entry.id === item.id);
        if (index >= 0)
            merged[index] = item;
        else
            merged.push(item);
    }
    return merged;
}
function arrayOption(value) {
    if (value === undefined || value === null || value === true)
        return [];
    return Array.isArray(value) ? value : [value];
}
function valuesOption(value) {
    return arrayOption(value).map((entry) => String(entry).split("=")[0]).filter(Boolean);
}
function inferAuditDecisionKind(options) {
    if (options.command)
        return "sandbox.command";
    if (options.network || options.networkTarget)
        return "sandbox.network";
    if (options.env || options.envVar)
        return "sandbox.env";
    return "sandbox.path";
}
function isSandboxProfileError(error) {
    return error instanceof sandbox_profile_1.SandboxProfileError || Boolean(error && typeof error === "object" && "code" in error && String(error.code).startsWith("sandbox-"));
}
function validationIssuesFromError(error) {
    if (error instanceof workflow_app_framework_1.WorkflowAppValidationError)
        return error.issues;
    return [
        {
            code: "workflow-app-invalid",
            message: error instanceof Error ? error.message : String(error)
        }
    ];
}
