// `cw audit` handler — carved out of the command-surface god-dispatch. Read-only
// trust-audit verbs over a completed run's tamper-evident event chain (summary,
// verify, worker, provenance, multi-agent, policy, role, blackboard, judge) plus
// the attest/decision recorders. Mostly thin routes to runner methods.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { auditVerify } from "../../capability-core";
import { formatMultiAgentTrustAudit } from "../../operator-ux";
import { printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw audit summary|verify|worker|provenance|multi-agent|policy|role|blackboard|judge|attest|decision <run-id> [worker-id|role-id]`. */
export function handleAudit(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [subcommand, runId, id] = args.positionals;
  switch (subcommand) {
    case "summary":
      printJson(runner.auditSummary(required(runId, "run id")));
      return;
    case "verify": {
      const result = auditVerify(runner, { ...args.options, runId: required(runId, "run id") });
      printJson(result);
      // Fail-closed: any unverified chain exits non-zero so `cw audit verify
      // <run> && deploy` stops — mirrors the telemetry-verify guard. verifyTrustAudit
      // returns verified:true for a truly absent/empty chain (nothing to prove),
      // so this stays exit 0 there; a FULLY-corrupt log reports present:false but
      // verified:false (corruptLines>0) and must NOT be conflated with absent — the
      // earlier `present && ...` guard let that severe tamper escape (exit 0).
      if (!result.verified) process.exitCode = 1;
      return;
    }
    case "worker":
      printJson(runner.workerAudit(required(runId, "run id"), required(id, "worker id")));
      return;
    case "provenance":
      printJson(runner.evidenceProvenance(required(runId, "run id"), args.options));
      return;
    case "multi-agent": {
      const view = runner.auditMultiAgent(required(runId, "run id"));
      if (wantsJson(args.options)) printJson(view);
      else process.stdout.write(`${formatMultiAgentTrustAudit(view as unknown as Record<string, unknown>)}\n`);
      return;
    }
    case "policy": {
      const view = runner.auditPolicy(required(runId, "run id"));
      if (wantsJson(args.options)) printJson(view);
      else process.stdout.write(`${formatMultiAgentTrustAudit(view)}\n`);
      return;
    }
    case "role": {
      const view = runner.auditRole(required(runId, "run id"), required(id, "role id"));
      if (wantsJson(args.options)) printJson(view);
      else process.stdout.write(`${formatMultiAgentTrustAudit(view)}\n`);
      return;
    }
    case "blackboard": {
      const view = runner.auditBlackboard(required(runId, "run id"));
      if (wantsJson(args.options)) printJson(view);
      else process.stdout.write(`${formatMultiAgentTrustAudit(view)}\n`);
      return;
    }
    case "judge": {
      const view = runner.auditJudge(required(runId, "run id"));
      if (wantsJson(args.options)) printJson(view);
      else process.stdout.write(`${formatMultiAgentTrustAudit(view)}\n`);
      return;
    }
    case "attest":
      printJson(runner.recordAuditAttestation(required(runId, "run id"), args.options));
      return;
    case "decision":
      printJson(runner.recordAuditDecision(required(runId, "run id"), required(id, "worker id"), args.options));
      return;
    default:
      throw new Error("Usage: cw.js audit summary|worker|provenance|multi-agent|policy|role|blackboard|judge|attest|decision <run-id> [worker-id|role-id]");
  }
}
