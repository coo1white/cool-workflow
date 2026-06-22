"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAudit = handleAudit;
const capability_core_1 = require("../../capability-core");
const operator_ux_1 = require("../../operator-ux");
const io_1 = require("../io");
/** `cw audit summary|verify|worker|provenance|multi-agent|policy|role|blackboard|judge|attest|decision <run-id> [worker-id|role-id]`. */
function handleAudit(args, runner) {
    const [subcommand, runId, id] = args.positionals;
    switch (subcommand) {
        case "summary":
            (0, io_1.printJson)(runner.auditSummary((0, io_1.required)(runId, "run id")));
            return;
        case "verify": {
            const result = (0, capability_core_1.auditVerify)(runner, { ...args.options, runId: (0, io_1.required)(runId, "run id") });
            (0, io_1.printJson)(result);
            // Fail-closed: any unverified chain exits non-zero so `cw audit verify
            // <run> && deploy` stops — mirrors the telemetry-verify guard. verifyTrustAudit
            // returns verified:true for a truly absent/empty chain (nothing to prove),
            // so this stays exit 0 there; a FULLY-corrupt log reports present:false but
            // verified:false (corruptLines>0) and must NOT be conflated with absent — the
            // earlier `present && ...` guard let that severe tamper escape (exit 0).
            if (!result.verified)
                process.exitCode = 1;
            return;
        }
        case "worker":
            (0, io_1.printJson)(runner.workerAudit((0, io_1.required)(runId, "run id"), (0, io_1.required)(id, "worker id")));
            return;
        case "provenance":
            (0, io_1.printJson)(runner.evidenceProvenance((0, io_1.required)(runId, "run id"), args.options));
            return;
        case "multi-agent": {
            const view = runner.auditMultiAgent((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(view);
            else
                process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
            return;
        }
        case "policy": {
            const view = runner.auditPolicy((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(view);
            else
                process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
            return;
        }
        case "role": {
            const view = runner.auditRole((0, io_1.required)(runId, "run id"), (0, io_1.required)(id, "role id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(view);
            else
                process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
            return;
        }
        case "blackboard": {
            const view = runner.auditBlackboard((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(view);
            else
                process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
            return;
        }
        case "judge": {
            const view = runner.auditJudge((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(view);
            else
                process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
            return;
        }
        case "attest":
            (0, io_1.printJson)(runner.recordAuditAttestation((0, io_1.required)(runId, "run id"), args.options));
            return;
        case "decision":
            (0, io_1.printJson)(runner.recordAuditDecision((0, io_1.required)(runId, "run id"), (0, io_1.required)(id, "worker id"), args.options));
            return;
        default:
            throw new Error("Usage: cw.js audit summary|worker|provenance|multi-agent|policy|role|blackboard|judge|attest|decision <run-id> [worker-id|role-id]");
    }
}
