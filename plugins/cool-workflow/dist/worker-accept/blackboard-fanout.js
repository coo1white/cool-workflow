"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fanOutWorkerOutput = fanOutWorkerOutput;
const coordinator_1 = require("../coordinator");
const multi_agent_1 = require("../multi-agent");
const blackboard_linkage_1 = require("./blackboard-linkage");
/** Step 7 — fanOut: publish the accepted output to the blackboard and record the
 *  multi-agent worker output (linking the blackboard message/artifact refs). */
function fanOutWorkerOutput(accept) {
    const { run, workerId, scope, task, absoluteResultPath, parsedResult, destination, resultNode, verifierNodeId, acceptedAuditId } = accept;
    const blackboardLinks = publishWorkerOutputToBlackboard(run, scope, task, parsedResult.summary, destination, absoluteResultPath, resultNode.evidence, acceptedAuditId);
    (0, multi_agent_1.recordMultiAgentWorkerOutput)(run, {
        workerId,
        taskId: task.id,
        resultNodeId: resultNode.id,
        verifierNodeId,
        evidence: resultNode.evidence,
        artifactPaths: [destination, absoluteResultPath],
        blackboardMessageIds: blackboardLinks.messageIds,
        blackboardArtifactRefIds: blackboardLinks.artifactRefIds
    });
}
function publishWorkerOutputToBlackboard(run, scope, task, summary, destination, workerResultPath, evidence, acceptedAuditId) {
    const linkage = (0, blackboard_linkage_1.blackboardLinkage)(run, scope);
    if (!linkage.blackboardId || !linkage.topicIds.length)
        return { messageIds: [], artifactRefIds: [] };
    const topicId = linkage.topicIds[0];
    const artifactRefs = [
        (0, coordinator_1.addBlackboardArtifact)(run, {
            topicId,
            blackboardId: linkage.blackboardId,
            kind: "worker-result",
            path: destination,
            owner: { kind: "worker", id: scope.id },
            author: { kind: "runtime", id: "cw" },
            source: "cw-validated-worker-output",
            provenance: {
                workerId: scope.id,
                taskId: task.id,
                multiAgentRunId: scope.multiAgent?.runId,
                agentGroupId: scope.multiAgent?.groupId,
                agentRoleId: scope.multiAgent?.roleId,
                agentMembershipId: scope.multiAgent?.membershipId,
                auditEventIds: [acceptedAuditId]
            },
            evidenceRefs: evidence.map((entry) => entry.locator || entry.path || entry.summary || entry.id).filter(Boolean),
            auditEventIds: [acceptedAuditId],
            metadata: { workerResultPath }
        })
    ];
    const message = (0, coordinator_1.postBlackboardMessage)(run, {
        topicId,
        blackboardId: linkage.blackboardId,
        body: summary,
        author: { kind: "worker", id: scope.id },
        scope: { kind: "worker", id: scope.id },
        artifactRefIds: artifactRefs.map((artifact) => artifact.id),
        evidenceRefs: evidence.map((entry) => entry.locator || entry.path || entry.summary || entry.id).filter(Boolean),
        auditEventIds: [acceptedAuditId],
        links: {
            multiAgentRunId: scope.multiAgent?.runId,
            agentGroupId: scope.multiAgent?.groupId,
            agentRoleId: scope.multiAgent?.roleId,
            agentMembershipId: scope.multiAgent?.membershipId,
            agentFanoutId: scope.multiAgent?.fanoutId,
            taskId: task.id,
            workerId: scope.id,
            auditEventIds: [acceptedAuditId]
        },
        metadata: {
            taskId: task.id,
            resultPath: destination,
            multiAgent: scope.multiAgent
        }
    });
    return {
        messageIds: [message.id],
        artifactRefIds: artifactRefs.map((artifact) => artifact.id)
    };
}
