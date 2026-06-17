"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blackboardLinkage = blackboardLinkage;
const helpers_1 = require("../worker-isolation/helpers");
function blackboardLinkage(run, scope) {
    const membershipId = scope.multiAgent?.membershipId;
    const membership = membershipId ? run.multiAgent?.memberships.find((entry) => entry.id === membershipId) : undefined;
    const group = scope.multiAgent?.groupId ? run.multiAgent?.groups.find((entry) => entry.id === scope.multiAgent?.groupId) : undefined;
    const role = scope.multiAgent?.roleId ? run.multiAgent?.roles.find((entry) => entry.id === scope.multiAgent?.roleId) : undefined;
    const multiAgentRun = scope.multiAgent?.runId ? run.multiAgent?.runs.find((entry) => entry.id === scope.multiAgent?.runId) : undefined;
    const blackboardId = membership?.blackboardId || group?.blackboardId || role?.blackboardId || multiAgentRun?.blackboardId;
    const topicIds = (0, helpers_1.unique)([
        ...(membership?.topicIds || []),
        ...(group?.topicIds || []),
        ...(role?.topicIds || []),
        ...(multiAgentRun?.topicIds || [])
    ]);
    return { blackboardId, topicIds };
}
