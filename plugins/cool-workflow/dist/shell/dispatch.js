"use strict";
// shell/dispatch.ts — createDispatchManifest: the imperative wrapper
// around core/pipeline/dispatch.ts's pure decision helpers.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// src/dispatch.ts's IO half (worker-scope allocation, manifest file
// write, state-node append). Multi-agent attachment and custom sandbox
// profile persistence at dispatch (H7) are milestone 9's scope and are
// no-ops here.
//
// Evidence: SPEC/pipeline-run.md "Dispatch — src/dispatch.ts".
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
exports.writeRunNode = void 0;
exports.createDispatchManifest = createDispatchManifest;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const dispatch_1 = require("../core/pipeline/dispatch");
const contract_1 = require("../core/pipeline/contract");
const state_node_1 = require("../core/state/state-node");
const node_store_1 = require("./node-store");
Object.defineProperty(exports, "writeRunNode", { enumerable: true, get: function () { return node_store_1.writeRunNode; } });
const fs_atomic_1 = require("./fs-atomic");
const worker_isolation_1 = require("./worker-isolation");
const multi_agent_io_1 = require("./multi-agent-io");
const registry_1 = require("./execution-backend/registry");
const sandbox_profile_1 = require("./sandbox-profile");
function createDispatchManifest(run, limit, options = {}) {
    const requestedSandboxProfileId = options.sandboxProfileId || options.sandbox;
    const sandboxProfileId = String(requestedSandboxProfileId || sandbox_profile_1.DEFAULT_SANDBOX_PROFILE_ID);
    (0, sandbox_profile_1.resolveSandboxProfileById)(sandboxProfileId, (0, sandbox_profile_1.sandboxContextForValidation)(run.cwd));
    // H7: if the requested profile is a CUSTOM profile loaded from a FILE (non-bundled,
    // existing file), persist its DEFINITION on run.customSandboxProfiles keyed by the
    // definition's logical id, so a worker boundary can re-resolve it by logical id after
    // a scope snapshot is lost. Throws on an id collision (same id, different file).
    (0, sandbox_profile_1.persistCustomSandboxProfile)(run, sandboxProfileId);
    const backendSelection = (0, registry_1.resolveBackendSelection)(options.backendId);
    const tasks = (0, dispatch_1.nextDispatchTasks)(run, limit);
    if (!tasks.length) {
        return { schemaVersion: 1, runId: run.id, dispatchId: null, tasks: [], manifestPath: null, sandboxProfileId, backendId: backendSelection.backendId, backendSelection };
    }
    const now = new Date().toISOString();
    const dispatchId = (0, dispatch_1.formatDispatchId)((run.dispatches?.length || 0) + 1, now, /^(1|true|yes|on)$/i.test(process.env.CW_DETERMINISTIC_RUN_IDS || ""));
    const manifestPath = path.join(run.paths.dispatchesDir, `${dispatchId}.json`);
    fs.mkdirSync(run.paths.dispatchesDir, { recursive: true });
    const taskIds = new Set(tasks.map((t) => t.id));
    let sandboxPolicy;
    let backendAttestation;
    for (const task of run.tasks) {
        if (!taskIds.has(task.id))
            continue;
        const taskSandboxProfileId = String(requestedSandboxProfileId || task.sandboxProfileId || sandbox_profile_1.DEFAULT_SANDBOX_PROFILE_ID);
        task.status = "running";
        task.loopStage = "act";
        task.dispatchId = dispatchId;
        task.dispatchedAt = now;
        const scope = (0, worker_isolation_1.allocateWorkerScope)(run, task, { dispatchId, sandboxProfileId: taskSandboxProfileId, backendId: backendSelection.backendId, status: "running", metadata: { dispatchId, phase: task.phase } });
        sandboxPolicy = sandboxPolicy || scope.sandboxPolicy;
        backendAttestation = backendAttestation || scope.backendAttestation;
    }
    const selectedRunTasks = run.tasks.filter((t) => taskIds.has(t.id));
    // Attach this dispatch to any active multi-agent run/group/role/fanout: the
    // kernel binds each selected task to its membership and returns the multiAgent
    // block that rides on the manifest + each task + run.dispatches, so a fanin can
    // see its members. Byte-behavior port of the old build's dispatch attachment.
    const multiAgentAttachment = (0, multi_agent_io_1.attachDispatchToMultiAgent)(run, {
        multiAgentRunId: options.multiAgentRunId,
        groupId: options.multiAgentGroupId,
        roleId: options.multiAgentRoleId,
        fanoutId: options.multiAgentFanoutId,
        dispatchId,
        tasks: selectedRunTasks,
        sandboxProfileId,
        concurrencyLimit: limit,
    });
    for (const task of selectedRunTasks) {
        const worker = task.workerId ? (0, worker_isolation_1.getWorkerScope)(run, String(task.workerId)) : undefined;
        if (worker)
            (0, worker_isolation_1.writeWorkerManifest)(run, worker);
    }
    const multiAgentBlock = multiAgentAttachment.multiAgent
        ? { ...multiAgentAttachment.multiAgent, membershipIds: multiAgentAttachment.membershipIds }
        : undefined;
    const dispatchNode = (0, node_store_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:dispatch:${dispatchId}`,
        kind: "dispatch",
        status: "running",
        loopStage: "act",
        inputs: { taskIds: tasks.map((t) => t.id), phase: tasks[0].phase, sandboxProfileId },
        outputs: { dispatchId, sandboxProfileId },
        artifacts: [{ id: "dispatch", kind: "json", path: manifestPath }],
        parents: tasks.map((t) => `${run.id}:task:${t.id}`),
        contractId: contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: { sandboxProfileId, sandboxPolicy },
    }));
    for (const task of run.tasks) {
        if (!taskIds.has(task.id) || !task.stateNodeId)
            continue;
        const node = (run.nodes || []).find((n) => n.id === task.stateNodeId);
        if (node && node.status === "pending") {
            (0, node_store_1.appendRunNode)(run, (0, state_node_1.transitionStateNode)(node, { status: "running", loopStage: "act" }));
        }
    }
    run.dispatches.push({ id: dispatchId, phase: tasks[0].phase || "", taskIds: tasks.map((t) => t.id), manifestPath, createdAt: now, stateNodeId: dispatchNode.id, workerIds: selectedRunTasks.filter((t) => t.workerId).map((t) => String(t.workerId)), sandboxProfileId, backendId: backendSelection.backendId, ...(multiAgentBlock ? { multiAgent: multiAgentBlock } : {}) });
    // Advance the run-level loop stage so operator status ("Stage: act") reflects
    // that work is dispatched — the standalone `cw dispatch` path, like the drive
    // loop, moves interpret→act. (Old build advanced it here.)
    run.loopStage = "act";
    (0, dispatch_1.updatePhaseStatuses)(run);
    const manifest = {
        schemaVersion: 1,
        runId: run.id,
        dispatchId,
        createdAt: now,
        phase: tasks[0].phase,
        instructions: "Spawn one worker per task when the user explicitly authorized agent/parallel/background work. Save each final summary as Markdown and record it with `cw result <run-id> <task-id> <file>`.",
        tasks: selectedRunTasks.map(dispatch_1.formatDispatchTask),
        manifestPath,
        stateNodeId: dispatchNode.id,
        workerIndexPath: run.paths.workersDir ? path.join(run.paths.workersDir, "index.json") : undefined,
        sandboxProfileId,
        sandboxPolicy,
        backendId: backendSelection.backendId,
        backendSelection,
        backendAttestation,
        ...(multiAgentBlock ? { multiAgent: multiAgentBlock } : {}),
    };
    (0, fs_atomic_1.writeJson)(manifestPath, manifest);
    return manifest;
}
