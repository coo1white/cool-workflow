"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWorkerResult = validateWorkerResult;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const verifier_1 = require("../verifier");
const evidence_grounding_1 = require("../evidence-grounding");
const trust_audit_1 = require("../trust-audit");
const helpers_1 = require("../worker-isolation/helpers");
/** Step 1 — validateResult: resolve scope/task, enforce the sandbox boundary, the
 *  result-file existence, the envelope contract, and (opt-in) resolvable evidence.
 *  Fail-closed: any guard records a worker failure and throws BEFORE accept-side
 *  state mutation. Returns the partially-filled accept context on success. */
function validateWorkerResult(run, workerId, resultPath, options, deps) {
    const scope = deps.requireWorkerScope(run, workerId);
    const task = deps.requireWorkerTask(run, scope);
    const absoluteResultPath = node_path_1.default.resolve(resultPath);
    const violation = deps.validateWorkerBoundary(run, workerId, { ...options, policy: options.policy, path: absoluteResultPath });
    if (violation) {
        (0, trust_audit_1.recordSandboxPathDecision)(run, {
            workerId,
            taskId: task.id,
            sandboxProfileId: scope.sandboxProfileId,
            policySnapshot: scope.sandboxPolicy,
            target: absoluteResultPath,
            decision: "denied",
            metadata: { code: violation.code, allowedPaths: violation.allowedPaths }
        });
        deps.recordWorkerFailure(run, workerId, violation, { ...options, path: absoluteResultPath, code: violation.code, retryable: false });
        throw new Error(violation.message);
    }
    if (!node_fs_1.default.existsSync(absoluteResultPath)) {
        const error = (0, helpers_1.structuredError)("worker-result-missing", `Worker result file does not exist: ${absoluteResultPath}`, {
            path: absoluteResultPath,
            retryable: true
        });
        deps.recordWorkerFailure(run, workerId, error, { ...options, persist: options.persist });
        throw new Error(error.message);
    }
    const rawResult = node_fs_1.default.readFileSync(absoluteResultPath, "utf8");
    const parsedResult = (0, verifier_1.parseResultEnvelope)(rawResult);
    (0, verifier_1.validateResultEnvelope)(task, parsedResult);
    // Strict evidence resolution (v0.1.40 self-audit P1, opt-in via
    // CW_REQUIRE_RESOLVABLE_EVIDENCE): fail closed if the result cites file-style
    // evidence that does not resolve on disk, so a worker cannot land a result
    // whose evidence locators point nowhere. Off by default — the default gate is
    // the deterministic grounding check in validateResultEnvelope.
    if ((0, evidence_grounding_1.requireResolvableEvidence)()) {
        const baseDirs = Array.from(new Set([run.cwd, process.cwd(), scope.workerDir, run.paths.runDir].filter(Boolean)));
        const unresolved = (0, evidence_grounding_1.unresolvedFileEvidence)(parsedResult.evidence, baseDirs);
        if (unresolved.length) {
            const error = (0, helpers_1.structuredError)("worker-evidence-unresolvable", `Worker ${workerId} result cites file evidence that does not resolve on disk: ${unresolved.join(", ")}`, { path: absoluteResultPath, retryable: false });
            deps.recordWorkerFailure(run, workerId, error, { ...options, persist: options.persist });
            throw new Error(error.message);
        }
    }
    return {
        run,
        workerId,
        options,
        scope,
        task,
        absoluteResultPath,
        rawResult,
        parsedResult,
        destination: "",
        pathAuditId: "",
        acceptedAuditId: "",
        resultNode: undefined,
        verifierNodeId: "",
        verifierStatus: "",
        output: undefined
    };
}
