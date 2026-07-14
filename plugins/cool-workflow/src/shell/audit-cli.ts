// shell/audit-cli.ts — CLI/MCP-reachable body for `cw audit verify`.
//
// MILESTONE 8. Byte-exact port of the old build's capability-core.ts's
// `auditVerify`. A run id with no run directory at all is a hard load
// failure (loadRunFromCwd throws) — absence-is-ok only applies once a
// run exists but never wrote a trust-audit chain file, not to a missing
// run entirely.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw audit verify`";
// plugins/cool-workflow/src/capability-core.ts:1223-1249.

import * as path from "node:path";
import { verifyTrustAudit, summarizeTrustAudit, listTrustAuditEvents, trustAuditHead, repairTrustAuditTornTail, TrustAuditAnchor, TrustAuditRepairResult } from "./trust-audit";
import { loadRunFromCwd, saveCheckpoint, withRunStateLock } from "./run-store";
import { summarizeMultiAgentTrust } from "./trust-policy-io";
import { writeReport } from "./report";
import { evidenceProvenance, recordHostAttestation, recordSandboxPolicyDecision, workerTrustAudit } from "./audit-provenance";
import { getWorkerScope, recordWorkerFailure, validateWorkerBoundary } from "./worker-isolation";
import { validateSandboxCommand, validateSandboxNetwork } from "./sandbox-profile";
import { WorkflowRun } from "../core/state/types";

export interface AuditVerifyResult {
  schemaVersion: 1;
  runId: string;
  present: boolean;
  verified: boolean;
  eventCount: number;
  chained: number;
  unchained: number;
  corruptLines: number;
  failedChecks: Array<{ name: string; code?: string }>;
  /** Present ONLY when the caller passed --expect-head / --expect-count —
   *  a plain (un-anchored) verify keeps its exact pre-anchor output. */
  anchor?: { expectHead?: string; expectCount?: number; satisfied: boolean };
}

function invocationCwd(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}

/** Parse the optional truncation anchor off the CLI options / MCP args
 *  (`--expect-head <hash>` / `--expect-count <n>`; MCP: expectHead /
 *  expectCount). Fail-closed on a malformed count — a flag given without
 *  a usable value must never silently weaken the check it asked for.
 *  `command` names the actual caller (`audit verify`/`audit repair`) in
 *  the thrown message, so a bad flag always points at the command the
 *  operator really ran. */
function anchorOption(args: Record<string, unknown>, command = "audit verify"): TrustAuditAnchor | undefined {
  const headRaw = args["expect-head"] ?? args.expectHead;
  const countRaw = args["expect-count"] ?? args.expectCount;
  const expectHead = optionalString(headRaw);
  if (headRaw !== undefined && headRaw !== null && expectHead === undefined) {
    throw new Error(`${command}: --expect-head requires a hash value`);
  }
  let expectCount: number | undefined;
  if (countRaw !== undefined && countRaw !== null) {
    const parsed = Number(countRaw);
    if (countRaw === true || !Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${command}: --expect-count requires a non-negative integer`);
    }
    expectCount = parsed;
  }
  if (expectHead === undefined && expectCount === undefined) return undefined;
  return { expectHead, expectCount };
}

export function auditVerifyCli(runId: string, args: Record<string, unknown>): AuditVerifyResult {
  if (!runId) throw new Error("audit verify requires a run id (cw audit verify <run-id>)");
  const anchor = anchorOption(args);
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const v = verifyTrustAudit(run, anchor);
  const result: AuditVerifyResult = {
    schemaVersion: 1,
    runId: run.id,
    present: v.present,
    verified: v.verified,
    eventCount: v.eventCount,
    chained: v.chained,
    unchained: v.unchained,
    corruptLines: v.corruptLines,
    failedChecks: v.checks.filter((c) => !c.pass).map((c) => ({ name: c.name, code: c.code })),
  };
  if (anchor) {
    result.anchor = {
      ...(anchor.expectHead !== undefined ? { expectHead: anchor.expectHead } : {}),
      ...(anchor.expectCount !== undefined ? { expectCount: anchor.expectCount } : {}),
      satisfied: !v.checks.some((c) => c.code === "trust-audit-truncated"),
    };
  }
  return result;
}

export interface AuditHeadResult {
  schemaVersion: 1;
  runId: string;
  eventCount: number;
  headHash: string;
}

/** `cw audit head <run>` — the chain head anchor (read-only projection).
 *  Capture it after a run (or before publishing/exporting); later,
 *  `cw audit verify <run> --expect-head <hash> --expect-count <n>`
 *  re-proves the log was not shortened since the capture. */
export function auditHeadCli(runId: string, args: Record<string, unknown>): AuditHeadResult {
  if (!runId) throw new Error("audit head requires a run id (cw audit head <run-id>)");
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const head = trustAuditHead(run);
  return { schemaVersion: 1, runId: run.id, eventCount: head.eventCount, headHash: head.headHash };
}

export interface AuditRepairResult extends TrustAuditRepairResult {
  schemaVersion: 1;
  runId: string;
  write: boolean;
}

/** `cw audit repair <run> [--write] [--expect-head <hash>] [--expect-count <n>]`
 *  — repairs a torn TRAILING write in the run's trust-audit event log (the
 *  one corruption shape a crash mid-append can produce). Default is
 *  dry-run (report only), matching this codebase's `cw state check
 *  [--write]` convention: pass `--write` to actually replace the log on
 *  disk. The SAME anchor flags `cw audit verify` accepts are honored here
 *  too: without one, a truncated-then-torn log (real history deleted,
 *  leaving only a torn-looking fragment) can "verify" as an empty chain
 *  and be silently accepted — passing a `--expect-head`/`--expect-count`
 *  captured before the corruption closes that hole, exactly like it does
 *  for verify. Fails closed (outcome:"refused") when the corruption isn't
 *  confined to exactly the trailing line, or the anchor isn't met — see
 *  `repairTrustAuditTornTail`'s own doc comment for the full fail-closed
 *  contract. */
export function auditRepairCli(runId: string, args: Record<string, unknown>): AuditRepairResult {
  if (!runId) throw new Error("audit repair requires a run id (cw audit repair <run-id>)");
  const write = Boolean(args.write);
  const anchor = anchorOption(args, "audit repair");
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const result = repairTrustAuditTornTail(run, { write, anchor });
  return { schemaVersion: 1, runId: run.id, write, ...result };
}

/** MILESTONE 11 (reporting/observability, workbench audit panels) —
 *  `cw audit summary`/`audit multi-agent`/`audit policy`/`audit judge`.
 *  These read the same trust-audit summary functions the report.md
 *  writer and multi-agent trust-policy layer already build, so panel
 *  data can never drift from the standalone commands' output. */
export function auditSummaryCli(runId: string, args: Record<string, unknown>): ReturnType<typeof summarizeTrustAudit> {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  return summarizeTrustAudit(run, { persist: args.__cwWorkbenchReadOnlyProjection !== true });
}

export function auditMultiAgentCli(runId: string, args: Record<string, unknown>): ReturnType<typeof summarizeMultiAgentTrust> {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  return summarizeMultiAgentTrust(run);
}

export interface AuditPolicyResult {
  schemaVersion: 1;
  runId: string;
  rolePolicies: ReturnType<typeof summarizeMultiAgentTrust>["rolePolicies"];
  permissionDecisions: ReturnType<typeof summarizeMultiAgentTrust>["permissionDecisions"];
  policyViolations: ReturnType<typeof summarizeMultiAgentTrust>["policyViolations"];
}

export function auditPolicyCli(runId: string, args: Record<string, unknown>): AuditPolicyResult {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const summary = summarizeMultiAgentTrust(run);
  return { schemaVersion: 1, runId: run.id, rolePolicies: summary.rolePolicies, permissionDecisions: summary.permissionDecisions, policyViolations: summary.policyViolations };
}

export interface AuditJudgeResult {
  schemaVersion: 1;
  runId: string;
  judgeRationales: ReturnType<typeof summarizeMultiAgentTrust>["judgeRationales"];
  panelDecisions: ReturnType<typeof summarizeMultiAgentTrust>["panelDecisions"];
}

export function auditJudgeCli(runId: string, args: Record<string, unknown>): AuditJudgeResult {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const summary = summarizeMultiAgentTrust(run);
  return { schemaVersion: 1, runId: run.id, judgeRationales: summary.judgeRationales, panelDecisions: summary.panelDecisions };
}

// ---------------------------------------------------------------------------
// Phase B: the audit worker/provenance/role/blackboard/attest/decision verbs
// the old flat build had (cli/handlers/audit.ts + orchestrator/
// audit-operations.ts). Ported here as thin loadRun -> delegate wrappers over
// audit-provenance.ts + trust-audit.ts primitives.
// ---------------------------------------------------------------------------

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined;
}
/** Sanitized env-var NAMES only (`FOO=bar` -> `FOO`); the value is dropped. */
function valuesOption(value: unknown): string[] {
  const raw = value === undefined || value === null || value === true ? [] : Array.isArray(value) ? value : [value];
  return raw.map((entry) => String(entry).split("=")[0]).filter(Boolean);
}
/** Byte-exact port of the old build's inferAuditDecisionKind. */
function inferAuditDecisionKind(options: Record<string, unknown>): string {
  if (options.command) return "sandbox.command";
  if (options.network || options.networkTarget) return "sandbox.network";
  if (options.env || options.envVar) return "sandbox.env";
  return "sandbox.path";
}

/** `cw audit worker <run> <worker>` — every audited event for one worker. */
export function auditWorkerCli(runId: string, workerId: string, args: Record<string, unknown>): ReturnType<typeof workerTrustAudit> {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  return workerTrustAudit(run, workerId);
}

/** `cw audit provenance <run> [--worker|--candidate|--commit <id>]`. */
export function auditProvenanceCli(runId: string, args: Record<string, unknown>): ReturnType<typeof evidenceProvenance> {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  return evidenceProvenance(run, {
    workerId: optionalString(args.worker ?? args.workerId),
    candidateId: optionalString(args.candidate ?? args.candidateId),
    commitId: optionalString(args.commit ?? args.commitId),
  });
}

/** `cw audit role <run> <role>` — per-role policy + audit slice. */
export function auditRoleCli(runId: string, roleId: string, args: Record<string, unknown>): Record<string, unknown> {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const summary = summarizeMultiAgentTrust(run);
  const events = listTrustAuditEvents(run).filter((event) => event.agentRoleId === roleId);
  return {
    schemaVersion: 1,
    runId: run.id,
    roleId,
    role: (run.multiAgent as { roles?: Array<{ id: string }> } | undefined)?.roles?.find((entry) => entry.id === roleId),
    rolePolicies: summary.rolePolicies.filter((entry) => (entry as { subjectId?: string }).subjectId === roleId),
    permissionDecisions: events.filter((event) => event.kind === "multi-agent.permission"),
    blackboardWrites: events.filter((event) => event.kind === "blackboard.write"),
    messageProvenance: events.filter((event) => event.kind === "blackboard.message-provenance"),
    judgeRationales: events.filter((event) => event.kind === "judge.rationale"),
    panelDecisions: events.filter((event) => event.kind === "judge.panel-decision"),
    policyViolations: events.filter((event) => event.kind === "policy.violation"),
    events,
    nextAction: `cw audit multi-agent ${run.id} --json`,
  };
}

/** `cw audit blackboard <run>` — blackboard write/provenance audit. */
export function auditBlackboardCli(runId: string, args: Record<string, unknown>): Record<string, unknown> {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const summary = summarizeMultiAgentTrust(run);
  return {
    schemaVersion: 1,
    runId: run.id,
    blackboardWrites: summary.blackboardWrites,
    messageProvenance: summary.messageProvenance,
    policyViolations: summary.policyViolations.filter((event) => (event as { blackboardId?: string }).blackboardId),
    nextAction: summary.nextAction,
  };
}

/** `cw audit attest <run> [--worker …] [--command|--network|--env|--note …]`
 *  — record a host/operator sandbox attestation. */
export function auditAttestCli(runId: string, args: Record<string, unknown>): ReturnType<typeof recordHostAttestation> {
  // Hold the state.json lock across the whole load -> record -> save so a
  // concurrent run mutation cannot drop this attestation (lost-update class).
  return withRunStateLock(runId, invocationCwd(args), (run) => {
    const workerId = optionalString(args.worker ?? args.workerId);
    const worker = workerId ? getWorkerScope(run, workerId) : undefined;
    const event = recordHostAttestation(run, {
      actor: optionalString(args.actor) || "host",
      workerId,
      taskId: worker?.taskId || optionalString(args.task ?? args.taskId),
      sandboxProfileId: worker?.sandboxProfileId || optionalString(args.sandboxProfileId),
      policySnapshot: worker?.sandboxPolicy,
      command: optionalString(args.command),
      networkTarget: optionalString(args.network ?? args.networkTarget),
      metadata: {
        note: optionalString(args.note ?? args.message),
        hostEnforced: args.hostEnforced === undefined ? undefined : Boolean(args.hostEnforced),
        envVars: valuesOption(args.env ?? args.envVar ?? args.envVars),
      },
    });
    saveCheckpoint(run);
    return event;
  });
}

/** `cw audit decision <run> <worker> --path|--command|--network|--env <t>`
 *  — validate a sandbox decision against the worker's policy, record it
 *  (fail-closed: a denied decision records a structured worker failure), and
 *  return the audit event. Byte-behavior port of the old recordAuditDecision. */
export function auditDecisionCli(runId: string, workerId: string, args: Record<string, unknown>): Record<string, unknown> {
  // recordAuditDecision does a load -> mutate -> saveCheckpoint; hold the
  // state.json lock across the whole cycle so a concurrent run mutation
  // cannot drop the recorded decision/failure (lost-update class).
  return withRunStateLock(runId, invocationCwd(args), (run) => recordAuditDecision(run, workerId, args));
}

function recordAuditDecision(run: WorkflowRun, workerId: string, options: Record<string, unknown>): Record<string, unknown> {
  const worker = getWorkerScope(run, workerId);
  if (!worker) throw new Error(`Unknown worker id for run ${run.id}: ${workerId}`);
  const kind = optionalString(options.kind) || inferAuditDecisionKind(options);
  const target = optionalString(options.path ?? options.command ?? options.network ?? options.networkTarget ?? options.env ?? options.envVar);
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
    const failurePath = denied.path || (kind === "sandbox.path" ? path.resolve(target) : undefined);
    const failure = recordWorkerFailure(
      run,
      workerId,
      { code: denied.code, message: denied.message, at: new Date().toISOString(), path: failurePath, retryable: false },
      { code: denied.code, path: failurePath, retryable: false, persist: false }
    );
    feedbackIds.push(...(failure.feedbackIds || []));
  }
  const envVars = kind === "sandbox.env" ? [target.includes("=") ? target.split("=")[0] : target] : undefined;
  const event = recordSandboxPolicyDecision(run, {
    kind,
    decision: denied ? "denied" : "allowed",
    workerId,
    taskId: worker.taskId,
    sandboxProfileId: worker.sandboxProfileId,
    policySnapshot: policy,
    command: kind === "sandbox.command" ? target : undefined,
    networkTarget: kind === "sandbox.network" ? target : undefined,
    normalizedPath: kind === "sandbox.path" ? target : undefined,
    envVars,
    feedbackIds,
    metadata: { code: denied?.code },
  });
  writeReport(run);
  saveCheckpoint(run);
  return event as unknown as Record<string, unknown>;
}
