"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditSummary = auditSummary;
exports.auditMultiAgent = auditMultiAgent;
exports.auditPolicy = auditPolicy;
exports.auditRole = auditRole;
exports.auditBlackboard = auditBlackboard;
exports.auditJudge = auditJudge;
exports.workerAudit = workerAudit;
exports.auditEvidenceProvenance = auditEvidenceProvenance;
exports.recordAuditAttestation = recordAuditAttestation;
exports.recordAuditDecision = recordAuditDecision;
// Audit domain operations (v0.1.40 self-audit P3 maintainability).
//
// Carved out of the CoolWorkflowRunner god-object as the first domain in the
// router pattern: every function here takes an already-loaded WorkflowRun and
// returns a value (mutating ops persist via the run), so the runner method is a
// thin `loadRun -> delegate` wrapper. Behavior is identical to the inline
// implementations these replaced; only the location changed.
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("../state");
const report_1 = require("./report");
const cli_options_1 = require("./cli-options");
const worker_isolation_1 = require("../worker-isolation");
const sandbox_profile_1 = require("../sandbox-profile");
const trust_audit_1 = require("../trust-audit");
const multi_agent_trust_1 = require("../multi-agent-trust");
function auditSummary(run) {
    return (0, trust_audit_1.summarizeTrustAudit)(run);
}
function auditMultiAgent(run) {
    return (0, multi_agent_trust_1.summarizeMultiAgentTrust)(run);
}
function auditPolicy(run) {
    const summary = (0, multi_agent_trust_1.summarizeMultiAgentTrust)(run);
    return {
        schemaVersion: 1,
        runId: run.id,
        rolePolicies: summary.rolePolicies,
        permissionDecisions: summary.permissionDecisions,
        policyViolations: summary.policyViolations,
        nextAction: summary.nextAction
    };
}
function auditRole(run, roleId) {
    const summary = (0, multi_agent_trust_1.summarizeMultiAgentTrust)(run);
    const events = (0, trust_audit_1.listTrustAuditEvents)(run).filter((event) => event.agentRoleId === roleId);
    return {
        schemaVersion: 1,
        runId: run.id,
        roleId,
        role: run.multiAgent?.roles.find((entry) => entry.id === roleId),
        rolePolicies: summary.rolePolicies.filter((entry) => entry.subjectId === roleId),
        permissionDecisions: events.filter((event) => event.kind === "multi-agent.permission"),
        blackboardWrites: events.filter((event) => event.kind === "blackboard.write"),
        messageProvenance: events.filter((event) => event.kind === "blackboard.message-provenance"),
        judgeRationales: events.filter((event) => event.kind === "judge.rationale"),
        panelDecisions: events.filter((event) => event.kind === "judge.panel-decision"),
        policyViolations: events.filter((event) => event.kind === "policy.violation"),
        events,
        nextAction: `node scripts/cw.js audit multi-agent ${run.id} --json`
    };
}
function auditBlackboard(run) {
    const summary = (0, multi_agent_trust_1.summarizeMultiAgentTrust)(run);
    return {
        schemaVersion: 1,
        runId: run.id,
        blackboardWrites: summary.blackboardWrites,
        messageProvenance: summary.messageProvenance,
        policyViolations: summary.policyViolations.filter((event) => event.blackboardId),
        nextAction: summary.nextAction
    };
}
function auditJudge(run) {
    const summary = (0, multi_agent_trust_1.summarizeMultiAgentTrust)(run);
    return {
        schemaVersion: 1,
        runId: run.id,
        judgeRationales: summary.judgeRationales,
        panelDecisions: summary.panelDecisions,
        permissionDecisions: summary.permissionDecisions.filter((event) => String(event.metadata?.operation || "").startsWith("judge.")),
        policyViolations: summary.policyViolations.filter((event) => String(event.metadata?.operation || "").startsWith("judge.")),
        nextAction: summary.nextAction
    };
}
function workerAudit(run, workerId) {
    return (0, trust_audit_1.workerTrustAudit)(run, workerId);
}
function auditEvidenceProvenance(run, options = {}) {
    return (0, trust_audit_1.evidenceProvenance)(run, {
        workerId: (0, cli_options_1.stringOption)(options.worker || options.workerId),
        candidateId: (0, cli_options_1.stringOption)(options.candidate || options.candidateId),
        commitId: (0, cli_options_1.stringOption)(options.commit || options.commitId)
    });
}
function recordAuditAttestation(run, options = {}) {
    const workerId = (0, cli_options_1.stringOption)(options.worker || options.workerId);
    const worker = workerId ? (0, worker_isolation_1.getWorkerScope)(run, workerId) : undefined;
    const event = (0, trust_audit_1.recordHostAttestation)(run, {
        actor: (0, cli_options_1.stringOption)(options.actor) || "host",
        workerId,
        taskId: worker?.taskId || (0, cli_options_1.stringOption)(options.task || options.taskId),
        sandboxProfileId: worker?.sandboxProfileId || (0, cli_options_1.stringOption)(options.sandboxProfileId),
        policySnapshot: worker?.sandboxPolicy,
        command: (0, cli_options_1.stringOption)(options.command),
        networkTarget: (0, cli_options_1.stringOption)(options.network || options.networkTarget),
        envVars: (0, cli_options_1.valuesOption)(options.env || options.envVar || options.envVars),
        metadata: {
            note: (0, cli_options_1.stringOption)(options.note || options.message),
            hostEnforced: options.hostEnforced === undefined ? undefined : Boolean(options.hostEnforced)
        }
    });
    (0, state_1.saveCheckpoint)(run);
    return event;
}
function recordAuditDecision(run, workerId, options = {}) {
    const worker = (0, worker_isolation_1.getWorkerScope)(run, workerId);
    if (!worker)
        throw new Error(`Unknown worker id for run ${run.id}: ${workerId}`);
    const kind = (0, cli_options_1.stringOption)(options.kind) || (0, cli_options_1.inferAuditDecisionKind)(options);
    const target = (0, cli_options_1.stringOption)(options.path || options.command || options.network || options.networkTarget || options.env || options.envVar);
    if (!target)
        throw new Error("Missing audit decision target: provide --path, --command, --network, or --env");
    const policy = worker.sandboxPolicy;
    let denied = null;
    if (kind === "sandbox.command") {
        denied = policy ? (0, sandbox_profile_1.validateSandboxCommand)(policy, target, workerId) : null;
    }
    else if (kind === "sandbox.network") {
        denied = policy ? (0, sandbox_profile_1.validateSandboxNetwork)(policy, target, workerId) : null;
    }
    else if (kind === "sandbox.env") {
        const name = target.includes("=") ? target.split("=")[0] : target;
        const allowed = Boolean(policy?.env.inherit || policy?.env.expose.includes(name));
        denied = allowed ? null : { code: "sandbox-env-denied", message: `Worker ${workerId} env var is outside sandbox profile ${policy?.id || "unknown"}: ${name}` };
    }
    else {
        denied = (0, worker_isolation_1.validateWorkerBoundary)(run, workerId, { path: target });
    }
    const feedbackIds = [];
    if (denied) {
        const failure = (0, worker_isolation_1.recordWorkerFailure)(run, workerId, {
            code: denied.code,
            message: denied.message,
            at: new Date().toISOString(),
            path: denied.path || (kind === "sandbox.path" ? node_path_1.default.resolve(target) : undefined),
            retryable: false
        }, { persist: false });
        feedbackIds.push(...(failure.feedbackIds || []));
    }
    const event = kind === "sandbox.path"
        ? (0, trust_audit_1.recordSandboxPathDecision)(run, {
            workerId,
            taskId: worker.taskId,
            sandboxProfileId: worker.sandboxProfileId,
            policySnapshot: policy,
            target,
            decision: denied ? "denied" : "allowed",
            feedbackIds,
            metadata: { code: denied?.code }
        })
        : (0, trust_audit_1.recordSandboxPolicyDecision)(run, {
            kind,
            decision: denied ? "denied" : "allowed",
            workerId,
            taskId: worker.taskId,
            sandboxProfileId: worker.sandboxProfileId,
            policySnapshot: policy,
            command: kind === "sandbox.command" ? target : undefined,
            networkTarget: kind === "sandbox.network" ? target : undefined,
            envVars: kind === "sandbox.env" ? [target.includes("=") ? target.split("=")[0] : target] : undefined,
            feedbackIds,
            metadata: { code: denied?.code }
        });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return event;
}
