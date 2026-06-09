// Audit domain operations (v0.1.40 self-audit P3 maintainability).
//
// Carved out of the CoolWorkflowRunner god-object as the first domain in the
// router pattern: every function here takes an already-loaded WorkflowRun and
// returns a value (mutating ops persist via the run), so the runner method is a
// thin `loadRun -> delegate` wrapper. Behavior is identical to the inline
// implementations these replaced; only the location changed.
import path from "node:path";
import { WorkflowRun } from "../types";
import { saveCheckpoint } from "../state";
import { writeReport } from "./report";
import { stringOption, valuesOption, inferAuditDecisionKind } from "./cli-options";
import {
  getWorkerScope,
  recordWorkerFailure,
  validateWorkerBoundary
} from "../worker-isolation";
import { validateSandboxCommand, validateSandboxNetwork } from "../sandbox-profile";
import {
  evidenceProvenance,
  listTrustAuditEvents,
  recordHostAttestation,
  recordSandboxPathDecision,
  recordSandboxPolicyDecision,
  summarizeTrustAudit,
  workerTrustAudit
} from "../trust-audit";
import { summarizeMultiAgentTrust } from "../multi-agent-trust";

export function auditSummary(run: WorkflowRun): ReturnType<typeof summarizeTrustAudit> {
  return summarizeTrustAudit(run);
}

export function auditMultiAgent(run: WorkflowRun): ReturnType<typeof summarizeMultiAgentTrust> {
  return summarizeMultiAgentTrust(run);
}

export function auditPolicy(run: WorkflowRun): Record<string, unknown> {
  const summary = summarizeMultiAgentTrust(run);
  return {
    schemaVersion: 1,
    runId: run.id,
    rolePolicies: summary.rolePolicies,
    permissionDecisions: summary.permissionDecisions,
    policyViolations: summary.policyViolations,
    nextAction: summary.nextAction
  };
}

export function auditRole(run: WorkflowRun, roleId: string): Record<string, unknown> {
  const summary = summarizeMultiAgentTrust(run);
  const events = listTrustAuditEvents(run).filter((event) => event.agentRoleId === roleId);
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

export function auditBlackboard(run: WorkflowRun): Record<string, unknown> {
  const summary = summarizeMultiAgentTrust(run);
  return {
    schemaVersion: 1,
    runId: run.id,
    blackboardWrites: summary.blackboardWrites,
    messageProvenance: summary.messageProvenance,
    policyViolations: summary.policyViolations.filter((event) => event.blackboardId),
    nextAction: summary.nextAction
  };
}

export function auditJudge(run: WorkflowRun): Record<string, unknown> {
  const summary = summarizeMultiAgentTrust(run);
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

export function workerAudit(run: WorkflowRun, workerId: string): ReturnType<typeof workerTrustAudit> {
  return workerTrustAudit(run, workerId);
}

export function auditEvidenceProvenance(
  run: WorkflowRun,
  options: Record<string, unknown> = {}
): ReturnType<typeof evidenceProvenance> {
  return evidenceProvenance(run, {
    workerId: stringOption(options.worker || options.workerId),
    candidateId: stringOption(options.candidate || options.candidateId),
    commitId: stringOption(options.commit || options.commitId)
  });
}

export function recordAuditAttestation(
  run: WorkflowRun,
  options: Record<string, unknown> = {}
): ReturnType<typeof recordHostAttestation> {
  const workerId = stringOption(options.worker || options.workerId);
  const worker = workerId ? getWorkerScope(run, workerId) : undefined;
  const event = recordHostAttestation(run, {
    actor: stringOption(options.actor) || "host",
    workerId,
    taskId: worker?.taskId || stringOption(options.task || options.taskId),
    sandboxProfileId: worker?.sandboxProfileId || stringOption(options.sandboxProfileId),
    policySnapshot: worker?.sandboxPolicy,
    command: stringOption(options.command),
    networkTarget: stringOption(options.network || options.networkTarget),
    envVars: valuesOption(options.env || options.envVar || options.envVars),
    metadata: {
      note: stringOption(options.note || options.message),
      hostEnforced: options.hostEnforced === undefined ? undefined : Boolean(options.hostEnforced)
    }
  });
  saveCheckpoint(run);
  return event;
}

export function recordAuditDecision(
  run: WorkflowRun,
  workerId: string,
  options: Record<string, unknown> = {}
): ReturnType<typeof recordSandboxPolicyDecision> {
  const worker = getWorkerScope(run, workerId);
  if (!worker) throw new Error(`Unknown worker id for run ${run.id}: ${workerId}`);
  const kind = stringOption(options.kind) || inferAuditDecisionKind(options);
  const target = stringOption(options.path || options.command || options.network || options.networkTarget || options.env || options.envVar);
  if (!target) throw new Error("Missing audit decision target: provide --path, --command, --network, or --env");
  const policy = worker.sandboxPolicy;
  let denied: { code: string; message: string; path?: string } | null = null;
  if (kind === "sandbox.command") {
    denied = policy ? validateSandboxCommand(policy, target, workerId) : null;
  } else if (kind === "sandbox.network") {
    denied = policy ? validateSandboxNetwork(policy, target, workerId) : null;
  } else if (kind === "sandbox.env") {
    const name = target.includes("=") ? target.split("=")[0] : target;
    const allowed = Boolean(policy?.env.inherit || policy?.env.expose.includes(name));
    denied = allowed ? null : { code: "sandbox-env-denied", message: `Worker ${workerId} env var is outside sandbox profile ${policy?.id || "unknown"}: ${name}` };
  } else {
    denied = validateWorkerBoundary(run, workerId, { path: target });
  }
  const feedbackIds: string[] = [];
  if (denied) {
    const failure = recordWorkerFailure(
      run,
      workerId,
      {
        code: denied.code,
        message: denied.message,
        at: new Date().toISOString(),
        path: denied.path || (kind === "sandbox.path" ? path.resolve(target) : undefined),
        retryable: false
      },
      { persist: false }
    );
    feedbackIds.push(...(failure.feedbackIds || []));
  }
  const event = kind === "sandbox.path"
    ? recordSandboxPathDecision(run, {
        workerId,
        taskId: worker.taskId,
        sandboxProfileId: worker.sandboxProfileId,
        policySnapshot: policy,
        target,
        decision: denied ? "denied" : "allowed",
        feedbackIds,
        metadata: { code: denied?.code }
      })
    : recordSandboxPolicyDecision(run, {
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
  writeReport(run);
  saveCheckpoint(run);
  return event;
}
