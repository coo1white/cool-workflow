"use strict";
// shell/audit-cli.ts — CLI/MCP-reachable body for `cw audit verify`.
//
// MILESTONE 8. Byte-exact port of the old build's capability-core module's
// `auditVerify`. A run id with no run directory at all is a hard load
// failure (loadRunFromCwd throws) — absence-is-ok only applies once a
// run exists but never wrote a trust-audit chain file, not to a missing
// run entirely.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw audit verify`".
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
exports.auditVerifyCli = auditVerifyCli;
exports.auditHeadCli = auditHeadCli;
exports.auditRepairCli = auditRepairCli;
exports.auditSummaryCli = auditSummaryCli;
exports.auditMultiAgentCli = auditMultiAgentCli;
exports.auditPolicyCli = auditPolicyCli;
exports.auditJudgeCli = auditJudgeCli;
exports.auditWorkerCli = auditWorkerCli;
exports.auditProvenanceCli = auditProvenanceCli;
exports.auditRoleCli = auditRoleCli;
exports.auditBlackboardCli = auditBlackboardCli;
exports.auditAttestCli = auditAttestCli;
exports.auditDecisionCli = auditDecisionCli;
const path = __importStar(require("node:path"));
const trust_audit_1 = require("./trust-audit");
const run_store_1 = require("./run-store");
const trust_policy_io_1 = require("./trust-policy-io");
const report_1 = require("./report");
const audit_provenance_1 = require("./audit-provenance");
const worker_isolation_1 = require("./worker-isolation");
const sandbox_profile_1 = require("./sandbox-profile");
function invocationCwd(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}
/** Parse the optional truncation anchor off the CLI options / MCP args
 *  (`--expect-head <hash>` / `--expect-count <n>`; MCP: expectHead /
 *  expectCount). Fail-closed on a malformed count — a flag given without
 *  a usable value must never silently weaken the check it asked for.
 *  `command` names the actual caller (`audit verify`/`audit repair`) in
 *  the thrown message, so a bad flag always points at the command the
 *  operator really ran. */
function anchorOption(args, command = "audit verify") {
    const headRaw = args["expect-head"] ?? args.expectHead;
    const countRaw = args["expect-count"] ?? args.expectCount;
    const expectHead = optionalString(headRaw);
    if (headRaw !== undefined && headRaw !== null && expectHead === undefined) {
        throw new Error(`${command}: --expect-head requires a hash value`);
    }
    let expectCount;
    if (countRaw !== undefined && countRaw !== null) {
        const parsed = Number(countRaw);
        if (countRaw === true || !Number.isInteger(parsed) || parsed < 0) {
            throw new Error(`${command}: --expect-count requires a non-negative integer`);
        }
        expectCount = parsed;
    }
    if (expectHead === undefined && expectCount === undefined)
        return undefined;
    return { expectHead, expectCount };
}
function auditVerifyCli(runId, args) {
    if (!runId)
        throw new Error("audit verify requires a run id (cw audit verify <run-id>)");
    const anchor = anchorOption(args);
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const v = (0, trust_audit_1.verifyTrustAudit)(run, anchor);
    const result = {
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
/** `cw audit head <run>` — the chain head anchor (read-only projection).
 *  Capture it after a run (or before publishing/exporting); later,
 *  `cw audit verify <run> --expect-head <hash> --expect-count <n>`
 *  re-proves the log was not shortened since the capture. */
function auditHeadCli(runId, args) {
    if (!runId)
        throw new Error("audit head requires a run id (cw audit head <run-id>)");
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const head = (0, trust_audit_1.trustAuditHead)(run);
    return { schemaVersion: 1, runId: run.id, eventCount: head.eventCount, headHash: head.headHash };
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
function auditRepairCli(runId, args) {
    if (!runId)
        throw new Error("audit repair requires a run id (cw audit repair <run-id>)");
    const write = Boolean(args.write);
    const anchor = anchorOption(args, "audit repair");
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const result = (0, trust_audit_1.repairTrustAuditTornTail)(run, { write, anchor });
    return { schemaVersion: 1, runId: run.id, write, ...result };
}
/** MILESTONE 11 (reporting/observability, workbench audit panels) —
 *  `cw audit summary`/`audit multi-agent`/`audit policy`/`audit judge`.
 *  These read the same trust-audit summary functions the report.md
 *  writer and multi-agent trust-policy layer already build, so panel
 *  data can never drift from the standalone commands' output. */
function auditSummaryCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, trust_audit_1.summarizeTrustAudit)(run, { persist: args.__cwWorkbenchReadOnlyProjection !== true });
}
function auditMultiAgentCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, trust_policy_io_1.summarizeMultiAgentTrust)(run);
}
function auditPolicyCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const summary = (0, trust_policy_io_1.summarizeMultiAgentTrust)(run);
    return { schemaVersion: 1, runId: run.id, rolePolicies: summary.rolePolicies, permissionDecisions: summary.permissionDecisions, policyViolations: summary.policyViolations };
}
function auditJudgeCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const summary = (0, trust_policy_io_1.summarizeMultiAgentTrust)(run);
    return { schemaVersion: 1, runId: run.id, judgeRationales: summary.judgeRationales, panelDecisions: summary.panelDecisions };
}
// ---------------------------------------------------------------------------
// The audit worker/provenance/role/blackboard/attest/decision verbs the old
// flat build had (cli/handlers/audit.ts + orchestrator/audit-operations.ts),
// ported here as thin loadRun -> delegate wrappers over audit-provenance.ts +
// trust-audit.ts primitives.
// ---------------------------------------------------------------------------
function optionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined;
}
/** Sanitized env-var NAMES only (`FOO=bar` -> `FOO`); the value is dropped. */
function valuesOption(value) {
    const raw = value === undefined || value === null || value === true ? [] : Array.isArray(value) ? value : [value];
    return raw.map((entry) => String(entry).split("=")[0]).filter(Boolean);
}
/** Byte-exact port of the old build's inferAuditDecisionKind. */
function inferAuditDecisionKind(options) {
    if (options.command)
        return "sandbox.command";
    if (options.network || options.networkTarget)
        return "sandbox.network";
    if (options.env || options.envVar)
        return "sandbox.env";
    return "sandbox.path";
}
/** `cw audit worker <run> <worker>` — every audited event for one worker. */
function auditWorkerCli(runId, workerId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, audit_provenance_1.workerTrustAudit)(run, workerId);
}
/** `cw audit provenance <run> [--worker|--candidate|--commit <id>]`. */
function auditProvenanceCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, audit_provenance_1.evidenceProvenance)(run, {
        workerId: optionalString(args.worker ?? args.workerId),
        candidateId: optionalString(args.candidate ?? args.candidateId),
        commitId: optionalString(args.commit ?? args.commitId),
    });
}
/** `cw audit role <run> <role>` — per-role policy + audit slice. */
function auditRoleCli(runId, roleId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const summary = (0, trust_policy_io_1.summarizeMultiAgentTrust)(run);
    const events = (0, trust_audit_1.listTrustAuditEvents)(run).filter((event) => event.agentRoleId === roleId);
    return {
        schemaVersion: 1,
        runId: run.id,
        roleId,
        role: run.multiAgent?.roles?.find((entry) => entry.id === roleId),
        rolePolicies: summary.rolePolicies.filter((entry) => entry.subjectId === roleId),
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
function auditBlackboardCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const summary = (0, trust_policy_io_1.summarizeMultiAgentTrust)(run);
    return {
        schemaVersion: 1,
        runId: run.id,
        blackboardWrites: summary.blackboardWrites,
        messageProvenance: summary.messageProvenance,
        policyViolations: summary.policyViolations.filter((event) => event.blackboardId),
        nextAction: summary.nextAction,
    };
}
/** `cw audit attest <run> [--worker …] [--command|--network|--env|--note …]`
 *  — record a host/operator sandbox attestation. */
function auditAttestCli(runId, args) {
    // Hold the state.json lock across the whole load -> record -> save so a
    // concurrent run mutation cannot drop this attestation (lost-update class).
    return (0, run_store_1.withRunStateLock)(runId, invocationCwd(args), (run) => {
        const workerId = optionalString(args.worker ?? args.workerId);
        const worker = workerId ? (0, worker_isolation_1.getWorkerScope)(run, workerId) : undefined;
        const event = (0, audit_provenance_1.recordHostAttestation)(run, {
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
        (0, run_store_1.saveCheckpoint)(run);
        return event;
    });
}
/** `cw audit decision <run> <worker> --path|--command|--network|--env <t>`
 *  — validate a sandbox decision against the worker's policy, record it
 *  (fail-closed: a denied decision records a structured worker failure), and
 *  return the audit event. Byte-behavior port of the old recordAuditDecision. */
function auditDecisionCli(runId, workerId, args) {
    // recordAuditDecision does a load -> mutate -> saveCheckpoint; hold the
    // state.json lock across the whole cycle so a concurrent run mutation
    // cannot drop the recorded decision/failure (lost-update class).
    return (0, run_store_1.withRunStateLock)(runId, invocationCwd(args), (run) => recordAuditDecision(run, workerId, args));
}
function recordAuditDecision(run, workerId, options) {
    const worker = (0, worker_isolation_1.getWorkerScope)(run, workerId);
    if (!worker)
        throw new Error(`Unknown worker id for run ${run.id}: ${workerId}`);
    const kind = optionalString(options.kind) || inferAuditDecisionKind(options);
    const target = optionalString(options.path ?? options.command ?? options.network ?? options.networkTarget ?? options.env ?? options.envVar);
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
        const failurePath = denied.path || (kind === "sandbox.path" ? path.resolve(target) : undefined);
        const failure = (0, worker_isolation_1.recordWorkerFailure)(run, workerId, { code: denied.code, message: denied.message, at: new Date().toISOString(), path: failurePath, retryable: false }, { code: denied.code, path: failurePath, retryable: false, persist: false });
        feedbackIds.push(...(failure.feedbackIds || []));
    }
    const envVars = kind === "sandbox.env" ? [target.includes("=") ? target.split("=")[0] : target] : undefined;
    const event = (0, audit_provenance_1.recordSandboxPolicyDecision)(run, {
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
    (0, report_1.writeReport)(run);
    (0, run_store_1.saveCheckpoint)(run);
    return event;
}
