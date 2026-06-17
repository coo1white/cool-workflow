"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWorkerVerify = runWorkerVerify;
exports.recordWorkerCompletion = recordWorkerCompletion;
const pipeline_runner_1 = require("../pipeline-runner");
const telemetry_attestation_1 = require("../telemetry-attestation");
const execution_backend_1 = require("../execution-backend");
/** Step 5 — runVerify: drive the verify pipeline stage off the accepted result node
 *  and record the verifier node id on the task + accept context. */
function runWorkerVerify(accept) {
    const { run, workerId, scope, task, parsedResult, destination, resultNode } = accept;
    const verifierResult = (0, pipeline_runner_1.createPipelineRunner)({ persist: false }).runPipelineStage(run, "verify", resultNode.id, {
        outputNodeId: `${run.id}:verifier:${task.id}`,
        outputStatus: "verified",
        loopStage: "adjust",
        outputs: { accepted: true, workerId },
        artifacts: [{ id: "result", kind: "markdown", path: destination }],
        evidence: resultNode.evidence.length
            ? resultNode.evidence
            : [{ id: "result:summary", source: "summary", summary: parsedResult.summary }],
        metadata: { taskId: task.id, workerId, resultNodeId: resultNode.id, sandboxProfileId: scope.sandboxProfileId }
    });
    task.verifierNodeId = verifierResult.outputNodeId;
    accept.verifierNodeId = verifierResult.outputNodeId;
    // Carry the verify verdict for the scope-status transition in recordWorkerCompletion.
    accept.verifierStatus = verifierResult.status;
}
/** Step 6 — recordStateNode (worker record): assemble the worker output record +
 *  host-attested usage record, then persist the worker scope with the verify-derived
 *  status, output digest/size, and (when present) usage. */
function recordWorkerCompletion(accept, delegation, deps) {
    const { run, workerId, scope, task, absoluteResultPath, rawResult, resultNode, verifierNodeId, verifierStatus, pathAuditId, acceptedAuditId } = accept;
    const { agentDelegation, telemetry } = delegation;
    const output = {
        workerId,
        taskId: task.id,
        resultPath: absoluteResultPath,
        recordedAt: new Date().toISOString(),
        stateNodeId: resultNode.id,
        verifierNodeId,
        auditEventIds: [pathAuditId, acceptedAuditId]
    };
    // Host-attested usage rides on the worker record. Recorded when the agent
    // REPORTED a model OR token usage — `unreported`/absent stays ABSENT (never
    // backfilled from the operator-chosen CW_AGENT_MODEL, never synthesized).
    // Track 1: the attestation verdict (`attested`/`unattested`/`absent`) and its
    // reason ride along, and the token buckets come from the (verified-or-not)
    // reported usage — CW still never measures them, it records + labels them.
    const reportedModel = agentDelegation && agentDelegation.model && agentDelegation.model !== "unreported" ? agentDelegation.model : undefined;
    const usageRecord = agentDelegation && (reportedModel || agentDelegation.reportedUsage)
        ? {
            schemaVersion: 1,
            source: "host-attested",
            ...(reportedModel ? { model: reportedModel } : {}),
            ...(0, telemetry_attestation_1.normalizeReportedUsage)(agentDelegation.reportedUsage),
            attestedAt: new Date().toISOString(),
            ...(telemetry ? { attestation: telemetry.status, ...(telemetry.reason ? { attestationReason: telemetry.reason } : {}) } : {}),
            note: "agent-delegation host-attested usage"
        }
        : undefined;
    deps.updateWorkerScope(run, {
        ...scope,
        updatedAt: new Date().toISOString(),
        status: verifierStatus === "advanced" ? "verified" : "completed",
        resultNodeId: resultNode.id,
        output,
        // Output integrity (v0.1.63): SHA256 digest + file size
        outputDigest: (0, execution_backend_1.sha256)(rawResult),
        outputSizeBytes: Buffer.byteLength(rawResult, "utf8"),
        ...(usageRecord ? { usage: usageRecord } : {})
    });
    accept.output = output;
}
