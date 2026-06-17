import fs from "node:fs";
import path from "node:path";
import { safeFileName } from "../state";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "../pipeline-contract";
import { appendRunNode, createStateNode } from "../state-node";
import { isEmptyCapture } from "../result-normalize";
import { normalizeEvidence, recordSandboxPathDecision, recordTrustAuditEvent } from "../trust-audit";
import type { WorkerAcceptContext, WorkerDelegation } from "./context";

/** Step 3 — recordStateNode/audit: the irreversible accept. Records the allowed
 *  path decision, copies the result into the run results dir, completes the task,
 *  builds + appends the result node, emits the accepted audit event, re-normalizes
 *  node evidence against both audit ids, and surfaces the empty-capture warning.
 *  Writes destination/pathAuditId/acceptedAuditId/resultNode back into `accept`. */
export function acceptWorkerResult(accept: WorkerAcceptContext, delegation: WorkerDelegation): void {
  const { run, workerId, scope, task, absoluteResultPath, parsedResult } = accept;
  const { agentDelegation } = delegation;
  const pathAudit = recordSandboxPathDecision(run, {
    workerId,
    taskId: task.id,
    sandboxProfileId: scope.sandboxProfileId,
    policySnapshot: scope.sandboxPolicy,
    target: absoluteResultPath,
    decision: "allowed",
    metadata: { operation: "worker-output-acceptance" }
  });
  const destination = path.join(run.paths.resultsDir, `${safeFileName(task.id)}.md`);
  fs.mkdirSync(run.paths.resultsDir, { recursive: true });
  fs.copyFileSync(absoluteResultPath, destination);

  task.status = "completed";
  task.completedAt = new Date().toISOString();
  task.resultPath = destination;
  task.loopStage = "observe";
  task.result = parsedResult;
  const evidence = normalizeEvidence(
    run,
    parsedResult.evidence.map((entry, index) => ({
      id: `result:${index + 1}`,
      source: "cw:result",
      locator: entry,
      summary: entry
    })),
    { source: "cw-validated", workerId, taskId: task.id, auditEventIds: [pathAudit.id] }
  );
  const resultNode = appendRunNode(
    run,
    createStateNode({
      id: `${run.id}:result:${task.id}`,
      kind: "result",
      status: "completed",
      loopStage: "observe",
      inputs: { taskId: task.id, dispatchId: task.dispatchId, workerId },
      outputs: parsedResult as unknown as Record<string, unknown>,
      artifacts: [
        { id: "result", kind: "markdown", path: destination },
        { id: "worker-result", kind: "markdown", path: absoluteResultPath }
      ],
      evidence,
      parents: task.dispatchId ? [`${run.id}:dispatch:${task.dispatchId}`] : [task.stateNodeId || `${run.id}:task:${task.id}`],
      contractId: DEFAULT_PIPELINE_CONTRACT_ID,
      metadata: {
        taskId: task.id,
        workerId,
        workerDir: scope.workerDir,
        sandboxProfileId: scope.sandboxProfileId,
        auditEventIds: [pathAudit.id],
        // Empty-capture warning (v0.1.42): even after robust normalization the result
        // yielded NO findings and NO evidence — surfaced, never silently passed.
        ...(isEmptyCapture(parsedResult) ? { captureWarning: "no findings or evidence captured from result.md" } : {}),
        // Folded into the snapshotted node body so v0.1.35 replay re-verifies the
        // prompt/result/model digests WITHOUT re-spawning the agent. NOT evidence.
        ...(agentDelegation ? { agentDelegation } : {})
      }
    })
  );
  const acceptedAudit = recordTrustAuditEvent(run, {
    kind: "worker.output",
    decision: "accepted",
    source: "cw-validated",
    workerId,
    taskId: task.id,
    nodeId: resultNode.id,
    sandboxProfileId: scope.sandboxProfileId,
    policySnapshot: scope.sandboxPolicy,
    normalizedPath: absoluteResultPath,
    evidence,
    parentEventIds: [pathAudit.id],
    metadata: { destination }
  });
  resultNode.evidence = normalizeEvidence(run, resultNode.evidence, {
    source: "cw-validated",
    workerId,
    taskId: task.id,
    resultNodeId: resultNode.id,
    auditEventIds: [pathAudit.id, acceptedAudit.id]
  });
  appendRunNode(run, resultNode);
  task.resultNodeId = resultNode.id;

  // Warn (don't silently pass) when a worker's result captured no structured signal
  // at all — the v0.1.41 self-audit's "accepted with evidenceCount:0" failure mode.
  if (isEmptyCapture(parsedResult)) {
    recordTrustAuditEvent(run, {
      kind: "worker.capture-warning",
      decision: "recorded",
      source: "cw-validated",
      workerId,
      taskId: task.id,
      nodeId: resultNode.id,
      parentEventIds: [acceptedAudit.id],
      metadata: { reason: "no findings or evidence captured from result.md", resultPath: destination }
    });
  }

  accept.destination = destination;
  accept.pathAuditId = pathAudit.id;
  accept.acceptedAuditId = acceptedAudit.id;
  accept.resultNode = resultNode;
}
