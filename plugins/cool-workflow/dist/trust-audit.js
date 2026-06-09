"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRUST_AUDIT_SCHEMA_VERSION = void 0;
exports.ensureTrustAudit = ensureTrustAudit;
exports.recordTrustAuditEvent = recordTrustAuditEvent;
exports.recordSandboxPathDecision = recordSandboxPathDecision;
exports.recordSandboxPolicyDecision = recordSandboxPolicyDecision;
exports.recordHostAttestation = recordHostAttestation;
exports.listTrustAuditEvents = listTrustAuditEvents;
exports.summarizeTrustAudit = summarizeTrustAudit;
exports.refreshTrustAudit = refreshTrustAudit;
exports.workerTrustAudit = workerTrustAudit;
exports.normalizeEvidence = normalizeEvidence;
exports.evidenceProvenance = evidenceProvenance;
exports.validateAcceptanceRationale = validateAcceptanceRationale;
exports.buildAcceptanceRationale = buildAcceptanceRationale;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
const evidence_grounding_1 = require("./evidence-grounding");
exports.TRUST_AUDIT_SCHEMA_VERSION = 1;
function ensureTrustAudit(run) {
    const auditDir = auditRoot(run);
    node_fs_1.default.mkdirSync(auditDir, { recursive: true });
    run.paths.auditDir = auditDir;
    const audit = {
        schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
        eventLogPath: node_path_1.default.join(auditDir, "events.jsonl"),
        summaryPath: node_path_1.default.join(auditDir, "summary.json"),
        indexPath: node_path_1.default.join(auditDir, "index.json")
    };
    run.audit = audit;
    if (!node_fs_1.default.existsSync(audit.eventLogPath))
        node_fs_1.default.writeFileSync(audit.eventLogPath, "", "utf8");
    return audit;
}
function recordTrustAuditEvent(run, input) {
    const audit = ensureTrustAudit(run);
    const event = compact({
        schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
        id: createEventId(run, input.kind),
        createdAt: new Date().toISOString(),
        runId: run.id,
        kind: input.kind,
        decision: input.decision,
        source: input.source,
        actor: input.actor,
        workerId: input.workerId,
        taskId: input.taskId,
        nodeId: input.nodeId,
        feedbackIds: input.feedbackIds?.filter(Boolean).sort(),
        candidateId: input.candidateId,
        scoreId: input.scoreId,
        selectionId: input.selectionId,
        commitId: input.commitId,
        multiAgentRunId: input.multiAgentRunId,
        agentRoleId: input.agentRoleId,
        agentGroupId: input.agentGroupId,
        agentMembershipId: input.agentMembershipId,
        agentFanoutId: input.agentFanoutId,
        agentFaninId: input.agentFaninId,
        blackboardId: input.blackboardId,
        blackboardTopicId: input.blackboardTopicId,
        blackboardMessageId: input.blackboardMessageId,
        blackboardContextId: input.blackboardContextId,
        blackboardArtifactRefId: input.blackboardArtifactRefId,
        blackboardSnapshotId: input.blackboardSnapshotId,
        coordinatorDecisionId: input.coordinatorDecisionId,
        topologyId: input.topologyId,
        topologyRunId: input.topologyRunId,
        sandboxProfileId: input.sandboxProfileId || input.policySnapshot?.id,
        policyRef: input.policyRef || (input.policySnapshot?.id ? `run.sandboxProfiles.${input.policySnapshot.id}` : undefined),
        multiAgentPolicyRef: input.policyRef,
        policySnapshot: redactPolicy(input.policySnapshot),
        normalizedPath: input.normalizedPath ? node_path_1.default.resolve(input.normalizedPath) : undefined,
        command: input.command,
        networkTarget: input.networkTarget,
        envVars: input.envVars ? unique(input.envVars.map(String)).sort() : undefined,
        evidence: normalizeEvidence(run, input.evidence || [], {
            source: input.source,
            workerId: input.workerId,
            taskId: input.taskId,
            resultNodeId: input.nodeId
        }),
        evidenceRefs: unique(input.evidenceRefs || []).sort(),
        parentEventIds: unique(input.parentEventIds || []).sort(),
        metadata: scrubMetadata(input.metadata || {})
    });
    // DURABLE append (v0.1.40 self-audit P1): the audit log is the one artifact
    // whose loss breaks audit-completeness, so fsync it before returning — never a
    // bare appendFileSync, which can drop the last event on power loss.
    (0, state_1.durableAppendFileSync)(audit.eventLogPath, `${JSON.stringify(event)}\n`);
    refreshTrustAudit(run);
    return event;
}
function recordSandboxPathDecision(run, input) {
    return recordTrustAuditEvent(run, {
        kind: input.kind || "sandbox.path",
        decision: input.decision,
        source: input.source || "cw-validated",
        workerId: input.workerId,
        taskId: input.taskId,
        sandboxProfileId: input.sandboxProfileId,
        policySnapshot: input.policySnapshot,
        normalizedPath: input.target,
        feedbackIds: input.feedbackIds,
        metadata: input.metadata
    });
}
function recordSandboxPolicyDecision(run, input) {
    return recordTrustAuditEvent(run, {
        ...input,
        source: input.source || "cw-validated"
    });
}
function recordHostAttestation(run, input) {
    return recordTrustAuditEvent(run, {
        ...input,
        kind: input.kind || "sandbox.host-attestation",
        decision: "recorded",
        source: "host-attested"
    });
}
function listTrustAuditEvents(run) {
    const audit = ensureTrustAudit(run);
    if (!node_fs_1.default.existsSync(audit.eventLogPath))
        return [];
    return node_fs_1.default
        .readFileSync(audit.eventLogPath, "utf8")
        .split(/\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .sort(compareEvents);
}
function summarizeTrustAudit(run) {
    const audit = ensureTrustAudit(run);
    const events = readEvents(audit.eventLogPath);
    const summary = {
        schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
        runId: run.id,
        generatedAt: new Date().toISOString(),
        eventCount: events.length,
        eventLogPath: audit.eventLogPath,
        indexPath: audit.indexPath,
        summaryPath: audit.summaryPath,
        byKind: countBy(events, (event) => event.kind),
        byDecision: countBy(events, (event) => event.decision),
        bySource: countBy(events, (event) => event.source),
        bySandboxProfile: countBy(events.filter((event) => event.sandboxProfileId), (event) => event.sandboxProfileId || "none"),
        workers: workerRows(events, run),
        candidates: candidateRows(events, run),
        commits: commitRows(events, run),
        multiAgent: {
            runs: run.multiAgent?.runs.length || 0,
            roles: run.multiAgent?.roles.length || 0,
            groups: run.multiAgent?.groups.length || 0,
            memberships: run.multiAgent?.memberships.length || 0,
            fanouts: run.multiAgent?.fanouts.length || 0,
            fanins: run.multiAgent?.fanins.length || 0,
            events: events.filter((event) => Boolean(event.multiAgentRunId ||
                event.agentRoleId ||
                event.agentGroupId ||
                event.agentMembershipId ||
                event.agentFanoutId ||
                event.agentFaninId)).length
        },
        blackboard: {
            boards: run.blackboard?.boards.length || 0,
            topics: run.blackboard?.topics.length || 0,
            messages: run.blackboard?.messages.length || 0,
            contexts: run.blackboard?.contexts.length || 0,
            artifacts: run.blackboard?.artifacts.length || 0,
            snapshots: run.blackboard?.snapshots.length || 0,
            decisions: run.blackboard?.decisions.length || 0,
            events: events.filter((event) => Boolean(event.blackboardId ||
                event.blackboardTopicId ||
                event.blackboardMessageId ||
                event.blackboardContextId ||
                event.blackboardArtifactRefId ||
                event.blackboardSnapshotId ||
                event.coordinatorDecisionId)).length
        },
        topologies: {
            runs: run.topologies?.runs.length || 0,
            events: events.filter((event) => Boolean(event.topologyId || event.topologyRunId || event.kind.startsWith("topology."))).length
        },
        multiAgentTrust: {
            rolePolicies: events.filter((event) => event.kind === "multi-agent.role-policy").length,
            permissionDecisions: events.filter((event) => event.kind === "multi-agent.permission").length,
            blackboardWrites: events.filter((event) => event.kind === "blackboard.write").length,
            messageProvenance: events.filter((event) => event.kind === "blackboard.message-provenance").length,
            judgeRationales: events.filter((event) => event.kind === "judge.rationale").length,
            panelDecisions: events.filter((event) => event.kind === "judge.panel-decision").length,
            policyViolations: events.filter((event) => event.kind === "policy.violation").length
        }
    };
    // Durable (v0.1.40 self-audit P1): the summary/index are the read-side view of
    // the audit log; persist them durably so a crash can't leave them pointing past
    // the last durably-appended event.
    (0, state_1.writeJson)(audit.summaryPath, summary, { durable: true });
    (0, state_1.writeJson)(audit.indexPath, {
        schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
        runId: run.id,
        events: events.map((event) => ({
            id: event.id,
            createdAt: event.createdAt,
            kind: event.kind,
            decision: event.decision,
            source: event.source,
            workerId: event.workerId,
            taskId: event.taskId,
            candidateId: event.candidateId,
            selectionId: event.selectionId,
            commitId: event.commitId,
            multiAgentRunId: event.multiAgentRunId,
            agentRoleId: event.agentRoleId,
            agentGroupId: event.agentGroupId,
            agentMembershipId: event.agentMembershipId,
            agentFanoutId: event.agentFanoutId,
            agentFaninId: event.agentFaninId,
            blackboardId: event.blackboardId,
            blackboardTopicId: event.blackboardTopicId,
            blackboardMessageId: event.blackboardMessageId,
            blackboardContextId: event.blackboardContextId,
            blackboardArtifactRefId: event.blackboardArtifactRefId,
            blackboardSnapshotId: event.blackboardSnapshotId,
            coordinatorDecisionId: event.coordinatorDecisionId,
            topologyId: event.topologyId,
            topologyRunId: event.topologyRunId,
            sandboxProfileId: event.sandboxProfileId,
            policyRef: event.policyRef,
            multiAgentPolicyRef: event.multiAgentPolicyRef
        }))
    }, { durable: true });
    run.audit = audit;
    return summary;
}
function refreshTrustAudit(run) {
    const audit = {
        schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
        eventLogPath: node_path_1.default.join(auditRoot(run), "events.jsonl"),
        summaryPath: node_path_1.default.join(auditRoot(run), "summary.json"),
        indexPath: node_path_1.default.join(auditRoot(run), "index.json")
    };
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(audit.eventLogPath), { recursive: true });
    if (!node_fs_1.default.existsSync(audit.eventLogPath))
        node_fs_1.default.writeFileSync(audit.eventLogPath, "", "utf8");
    run.audit = audit;
    return summarizeTrustAudit(run);
}
function workerTrustAudit(run, workerId) {
    return { workerId, events: listTrustAuditEvents(run).filter((event) => event.workerId === workerId) };
}
function normalizeEvidence(run, evidence, provenance) {
    const baseDirs = [run.cwd, run.paths.runDir].filter(Boolean);
    return evidence.map((entry) => ({
        ...entry,
        // Auto-compute confidence tier from locator shape + (in strict mode) filesystem.
        // "verified" is never auto-assigned — requires explicit host attestation (v0.1.55).
        confidence: entry.confidence || (0, evidence_grounding_1.computeEvidenceConfidence)(entry.locator || entry.path || entry.summary, baseDirs),
        provenance: {
            schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
            runId: run.id,
            source: provenance.source || entry.provenance?.source || "runtime-derived",
            workerId: provenance.workerId || entry.provenance?.workerId,
            taskId: provenance.taskId || entry.provenance?.taskId,
            resultNodeId: provenance.resultNodeId || entry.provenance?.resultNodeId,
            verifierNodeId: provenance.verifierNodeId || entry.provenance?.verifierNodeId,
            candidateId: provenance.candidateId || entry.provenance?.candidateId,
            scoreId: provenance.scoreId || entry.provenance?.scoreId,
            selectionId: provenance.selectionId || entry.provenance?.selectionId,
            commitId: provenance.commitId || entry.provenance?.commitId,
            parentEvidenceIds: unique([...(entry.provenance?.parentEvidenceIds || []), ...(provenance.parentEvidenceIds || [])]).sort(),
            auditEventIds: unique([...(entry.provenance?.auditEventIds || []), ...(provenance.auditEventIds || [])]).sort(),
            note: provenance.note || entry.provenance?.note
        }
    }));
}
function evidenceProvenance(run, options = {}) {
    const events = listTrustAuditEvents(run).filter((event) => {
        if (options.candidateId && event.candidateId !== options.candidateId)
            return false;
        if (options.commitId && event.commitId !== options.commitId)
            return false;
        if (options.workerId && event.workerId !== options.workerId)
            return false;
        return true;
    });
    const evidence = [];
    for (const node of run.nodes || [])
        evidence.push(...(node.evidence || []));
    for (const candidate of run.candidates || [])
        evidence.push(...(candidate.evidence || []));
    for (const selection of run.candidateSelections || [])
        evidence.push(...(selection.evidence || []));
    for (const commit of run.commits || [])
        evidence.push(...(commit.evidence || []));
    const filtered = evidence.filter((entry) => {
        if (options.candidateId && entry.provenance?.candidateId !== options.candidateId)
            return false;
        if (options.commitId && entry.provenance?.commitId !== options.commitId)
            return false;
        if (options.workerId && entry.provenance?.workerId !== options.workerId)
            return false;
        return true;
    });
    return { runId: run.id, evidence: filtered, events };
}
function validateAcceptanceRationale(rationale) {
    if (!rationale)
        return ["acceptance rationale is missing"];
    const failures = [];
    if (!rationale.selectedCandidateId)
        failures.push("selected candidate id is missing");
    if (!rationale.scoreId)
        failures.push("score id is missing");
    if (!rationale.verifierNodeId)
        failures.push("verifier node id is missing");
    if (!rationale.evidenceCount)
        failures.push("evidence count is zero");
    if (!rationale.workerId)
        failures.push("worker id is missing");
    if (!rationale.sandboxProfileId)
        failures.push("sandbox profile id is missing");
    if (rationale.commitGateResult !== "passed")
        failures.push("commit gate result is not passed");
    return failures;
}
function buildAcceptanceRationale(input) {
    return {
        schemaVersion: exports.TRUST_AUDIT_SCHEMA_VERSION,
        selectedCandidateId: input.selectedCandidateId,
        scoreId: input.scoreId,
        scoreCriteria: input.scoreCriteria,
        verifierNodeId: input.verifierNodeId,
        evidenceCount: input.evidenceCount || 0,
        sandboxProfileId: input.sandboxProfileId,
        workerId: input.workerId,
        commitGateResult: input.commitGateResult,
        auditEventIds: unique(input.auditEventIds || []).sort()
    };
}
function auditRoot(run) {
    return run.paths.auditDir || node_path_1.default.join(run.paths.runDir, "audit");
}
function readEvents(eventLogPath) {
    if (!node_fs_1.default.existsSync(eventLogPath))
        return [];
    return node_fs_1.default
        .readFileSync(eventLogPath, "utf8")
        .split(/\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .sort(compareEvents);
}
function workerRows(events, run) {
    const workerIds = unique([...(run.workers || []).map((worker) => worker.id), ...events.map((event) => event.workerId || "")]).sort();
    return workerIds.filter(Boolean).map((workerId) => {
        const worker = (run.workers || []).find((entry) => entry.id === workerId);
        const scoped = events.filter((event) => event.workerId === workerId);
        return {
            workerId,
            taskId: worker?.taskId || scoped.find((event) => event.taskId)?.taskId,
            sandboxProfileId: worker?.sandboxProfileId || scoped.find((event) => event.sandboxProfileId)?.sandboxProfileId,
            decisions: countBy(scoped, (event) => event.decision),
            denied: scoped.filter((event) => event.decision === "denied" || event.decision === "rejected").length,
            feedbackIds: unique(scoped.flatMap((event) => event.feedbackIds || [])).sort()
        };
    });
}
function candidateRows(events, run) {
    const ids = unique([...(run.candidates || []).map((candidate) => candidate.id), ...events.map((event) => event.candidateId || "")]).sort();
    return ids.filter(Boolean).map((candidateId) => {
        const candidate = (run.candidates || []).find((entry) => entry.id === candidateId);
        const selections = (run.candidateSelections || []).filter((selection) => selection.candidateId === candidateId);
        const scoped = events.filter((event) => event.candidateId === candidateId);
        return {
            candidateId,
            scoreIds: unique([...(candidate?.scores || []), ...scoped.map((event) => event.scoreId || "")]).filter(Boolean).sort(),
            selectionIds: unique([...selections.map((selection) => selection.id), ...scoped.map((event) => event.selectionId || "")]).filter(Boolean).sort(),
            evidenceCount: candidate?.evidence.length || scoped.flatMap((event) => event.evidence || []).length
        };
    });
}
function commitRows(events, run) {
    const ids = unique([...(run.commits || []).map((commit) => commit.id), ...events.map((event) => event.commitId || "")]).sort();
    return ids.filter(Boolean).map((commitId) => {
        const commit = (run.commits || []).find((entry) => entry.id === commitId);
        return {
            commitId,
            verifierGated: Boolean(commit?.verifierGated),
            candidateId: commit?.candidateId,
            selectionId: commit?.selectionId,
            evidenceCount: commit?.evidence?.length || 0,
            rationale: commit?.acceptanceRationale
        };
    });
}
function createEventId(run, kind) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    const count = readEvents(node_path_1.default.join(auditRoot(run), "events.jsonl")).length + 1;
    return `audit-${(0, state_1.safeFileName)(kind)}-${stamp}-${String(count).padStart(4, "0")}`;
}
function redactPolicy(policy) {
    if (!policy)
        return undefined;
    return {
        ...policy,
        env: {
            inherit: Boolean(policy.env.inherit),
            expose: unique((policy.env.expose || []).map(String)).sort(),
            deny: policy.env.deny ? unique(policy.env.deny.map(String)).sort() : undefined
        },
        metadata: scrubMetadata(policy.metadata || {})
    };
}
function scrubMetadata(value) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined)
            continue;
        if (/secret|token|password|credential|authorization|api[_-]?key/i.test(key)) {
            result[key] = "[redacted]";
        }
        else if (Array.isArray(entry)) {
            result[key] = entry.map((item) => (typeof item === "string" && item.includes("=") ? item.split("=")[0] : item));
        }
        else if (entry && typeof entry === "object") {
            result[key] = scrubMetadata(entry);
        }
        else {
            result[key] = entry;
        }
    }
    return Object.keys(result).length ? result : undefined;
}
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
function countBy(items, key) {
    const counts = {};
    for (const item of items) {
        const value = key(item);
        counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
}
function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
function compareEvents(left, right) {
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
