import fs from "node:fs";
import path from "node:path";
import type {
  RunTask,
  StateNode,
  WorkerBoundaryViolation,
  WorkerIsolationOptions,
  WorkerOutputRecord,
  WorkerScope,
  WorkflowRun
} from "../types";
import { parseResultEnvelope, validateResultEnvelope } from "../verifier";
import { requireResolvableEvidence, unresolvedFileEvidence } from "../evidence-grounding";
import { recordSandboxPathDecision } from "../trust-audit";
import { structuredError } from "../worker-isolation/helpers";
import type { WorkerAcceptContext } from "./context";

export interface WorkerAcceptValidationDeps {
  requireWorkerScope(run: WorkflowRun, workerId: string): WorkerScope;
  requireWorkerTask(run: WorkflowRun, scope: WorkerScope): RunTask;
  validateWorkerBoundary(
    run: WorkflowRun,
    workerId: string,
    options: WorkerIsolationOptions & { path?: string }
  ): WorkerBoundaryViolation | null;
  recordWorkerFailure(
    run: WorkflowRun,
    workerId: string,
    error: unknown,
    options: WorkerIsolationOptions & { code?: string; path?: string; retryable?: boolean; retryCount?: number }
  ): WorkerScope;
}

/** Step 1 — validateResult: resolve scope/task, enforce the sandbox boundary, the
 *  result-file existence, the envelope contract, and (opt-in) resolvable evidence.
 *  Fail-closed: any guard records a worker failure and throws BEFORE accept-side
 *  state mutation. Returns the partially-filled accept context on success. */
export function validateWorkerResult(
  run: WorkflowRun,
  workerId: string,
  resultPath: string,
  options: WorkerIsolationOptions,
  deps: WorkerAcceptValidationDeps
): WorkerAcceptContext {
  const scope = deps.requireWorkerScope(run, workerId);
  const task = deps.requireWorkerTask(run, scope);
  const absoluteResultPath = path.resolve(resultPath);
  const violation = deps.validateWorkerBoundary(run, workerId, { ...options, policy: options.policy, path: absoluteResultPath });
  if (violation) {
    recordSandboxPathDecision(run, {
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
  if (!fs.existsSync(absoluteResultPath)) {
    const error = structuredError("worker-result-missing", `Worker result file does not exist: ${absoluteResultPath}`, {
      path: absoluteResultPath,
      retryable: true
    });
    deps.recordWorkerFailure(run, workerId, error, { ...options, persist: options.persist });
    throw new Error(error.message);
  }

  const rawResult = fs.readFileSync(absoluteResultPath, "utf8");
  const parsedResult = parseResultEnvelope(rawResult);
  validateResultEnvelope(task, parsedResult);

  // Strict evidence resolution (v0.1.40 self-audit P1, opt-in via
  // CW_REQUIRE_RESOLVABLE_EVIDENCE): fail closed if the result cites file-style
  // evidence that does not resolve on disk, so a worker cannot land a result
  // whose evidence locators point nowhere. Off by default — the default gate is
  // the deterministic grounding check in validateResultEnvelope.
  if (requireResolvableEvidence()) {
    const baseDirs = Array.from(
      new Set([run.cwd, process.cwd(), scope.workerDir, run.paths.runDir].filter(Boolean))
    );
    const unresolved = unresolvedFileEvidence(parsedResult.evidence, baseDirs);
    if (unresolved.length) {
      const error = structuredError(
        "worker-evidence-unresolvable",
        `Worker ${workerId} result cites file evidence that does not resolve on disk: ${unresolved.join(", ")}`,
        { path: absoluteResultPath, retryable: false }
      );
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
    resultNode: undefined as unknown as StateNode,
    verifierNodeId: "",
    verifierStatus: "",
    output: undefined as unknown as WorkerOutputRecord
  };
}
