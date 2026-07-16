"use strict";
// shell/pipeline.ts — plan(): the run-lifecycle operation that turns a
// loaded workflow app + inputs into a full WorkflowRun on disk.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// src/orchestrator/lifecycle-operations.ts's `plan` function (the
// multi-agent/topology/blackboard ensure calls are milestone 9's scope
// and are no-ops here — no case in this milestone's gate reads those
// fields).
//
// Evidence: SPEC/pipeline-run.md's plan() references;
// plugins/cool-workflow/src/orchestrator/lifecycle-operations.ts:62-202
// (byte-exact source).
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
exports.pureAppendRunNode = exports.writeJson = void 0;
exports.plan = plan;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const run_paths_1 = require("../core/state/run-paths");
const migrations_1 = require("../core/state/migrations");
const state_node_1 = require("../core/state/state-node");
Object.defineProperty(exports, "pureAppendRunNode", { enumerable: true, get: function () { return state_node_1.appendRunNode; } });
const contract_1 = require("../core/pipeline/contract");
const runner_1 = require("../core/pipeline/runner");
const app_schema_1 = require("../core/workflow-apps/app-schema");
const fs_atomic_1 = require("./fs-atomic");
Object.defineProperty(exports, "writeJson", { enumerable: true, get: function () { return fs_atomic_1.writeJson; } });
const node_store_1 = require("./node-store");
const run_store_1 = require("./run-store");
const harness_1 = require("./harness");
const report_1 = require("./report");
const commit_1 = require("./commit");
function isMissing(value) {
    return value === undefined || value === null || value === "";
}
function renderPrompt(prompt, inputs) {
    const invariant = Array.isArray(inputs.invariant) ? inputs.invariant.join("; ") : String(inputs.invariant || "");
    let rendered = String(prompt).replaceAll("{{repo}}", String(inputs.repo || "")).replaceAll("{{question}}", String(inputs.question || "")).replaceAll("{{invariant}}", invariant);
    for (const [key, value] of Object.entries(inputs)) {
        const replacement = Array.isArray(value) ? value.join("; ") : String(value ?? "");
        rendered = rendered.replaceAll(`{{${key}}}`, replacement);
    }
    return rendered;
}
function normalizeInputs(options) {
    const out = {};
    for (const [key, value] of Object.entries(options))
        out[key] = value;
    return out;
}
function flattenTasks(app, inputs) {
    const seen = new Set();
    const tasks = [];
    for (const phase of app.workflow.phases) {
        for (const task of phase.tasks) {
            if (seen.has(task.id))
                throw new Error(`Duplicate task id: ${task.id}`);
            seen.add(task.id);
            tasks.push({
                id: task.id,
                kind: task.kind,
                phase: phase.name,
                status: "pending",
                loopStage: "interpret",
                requiresEvidence: Boolean(task.requiresEvidence),
                sandboxProfileId: task.sandboxProfileId,
                prompt: renderPrompt(task.prompt, inputs),
                taskPath: "",
                resultPath: "",
                ...(task.label ? { label: task.label } : {}),
                ...(task.model ? { model: task.model } : {}),
                ...(task.agentType ? { agentType: task.agentType } : {}),
                // Per-phase result-cache policy the drive READS (drive.ts resultCachePath).
                // Carries mode/keyInput and any includeCompletedResults sub-field through,
                // so warm re-runs hit .cw/cache/worker-results instead of re-spawning.
                // Byte-exact to the old build's flattenTasks (lifecycle-operations.ts).
                ...(task.resultCache ? { resultCache: task.resultCache } : {}),
                // Sub-workflow delegation spec the drive READS (drive.ts's runSubWorkflow
                // branch reads selected.subWorkflow). Without this the delegate task falls
                // through to the normal agent path instead of spawning a child run.
                ...(task.subWorkflow ? { subWorkflow: task.subWorkflow } : {}),
                // Opt-in flag the repo-review apps set so recordWorkerOutput's off-target
                // guard applies (a worker must cite the repo's own source, not CW's .cw/
                // run state). Absent on workflows whose subject is run/release state.
                ...(task.reviewsRepo ? { reviewsRepo: true } : {}),
            });
        }
    }
    return tasks;
}
let runIdSequence = 0;
function createRunId(workflowId) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    if (/^(1|true|yes|on)$/i.test(process.env.CW_DETERMINISTIC_RUN_IDS || "")) {
        runIdSequence += 1;
        const suffix = crypto.createHash("sha256").update(`${workflowId}:${process.pid}:${runIdSequence}`).digest("hex").slice(0, 6);
        return `${workflowId}-${suffix}`;
    }
    runIdSequence += 1;
    const suffix = crypto.createHash("sha256").update(`${workflowId}:${stamp}:${process.pid}:${runIdSequence}`).digest("hex").slice(0, 6);
    return `${workflowId}-${stamp}-${suffix}`;
}
/** plan(appRecord, options) — creates a brand-new run dir + state.json,
 *  writes task files, plans every task through the pipeline's "plan"
 *  stage, writes the initial report, and commits an initial checkpoint. */
function plan(app, options) {
    const inputs = normalizeInputs(options);
    for (const declared of app.workflow.inputs || []) {
        if (isMissing(inputs[declared.name]))
            inputs[declared.name] = declared.default ?? "";
        if (declared.required && isMissing(inputs[declared.name])) {
            throw new Error(`Missing required input: ${declared.name}`);
        }
    }
    const cwd = path.resolve(String(inputs.cwd || inputs.repo || process.cwd()));
    const injectedRunId = typeof options.runId === "string" && options.runId.trim() ? options.runId.trim() : undefined;
    delete inputs.runId;
    const runId = injectedRunId || createRunId(app.workflow.id);
    const runDir = path.join(cwd, ".cw", "runs", runId);
    const paths = (0, run_paths_1.createRunPaths)(runDir);
    (0, run_store_1.ensureRunDirs)(paths);
    const tasks = flattenTasks(app, inputs);
    // Stamp a real wall-clock createdAt/updatedAt at plan time (shell layer —
    // clock reads are allowed here). The pure migration defaults a run that
    // LACKS these to epoch-0 (for migrating old state), but a NEW run must
    // carry a real createdAt so metrics/duration (wallClockMs = updatedAt -
    // createdAt) are meaningful and stable, not a ~epoch-millis drift. Honors
    // an explicit --now for deterministic callers.
    const planNow = typeof options.now === "string" && options.now.trim() ? options.now : new Date().toISOString();
    const seed = {
        schemaVersion: 1,
        id: runId,
        createdAt: planNow,
        updatedAt: planNow,
        cwd,
        workflow: {
            id: app.workflow.id,
            title: app.workflow.title,
            summary: app.workflow.summary || "",
            limits: app.workflow.limits,
            app: (0, app_schema_1.workflowAppRunMetadata)(app),
        },
        inputs,
        loopStage: "interpret",
        phases: app.workflow.phases.map((phase) => ({
            id: phase.id,
            name: phase.name,
            status: "pending",
            taskIds: phase.tasks.map((t) => t.id),
            ...(phase.mode ? { mode: phase.mode } : {}),
            ...(phase.loop ? { loop: phase.loop, loopRound: 1 } : {}),
        })),
        tasks,
        dispatches: [],
        commits: [],
        paths,
    };
    const { run, report } = (0, migrations_1.migrateRunState)(seed, { statePath: paths.state, dryRun: false });
    if (report.status === "unsupported")
        throw new Error(`Unsupported CW run state: ${report.errors.join("; ")}`);
    (0, harness_1.writeTaskFiles)(run);
    const contract = (0, state_node_1.upsertRunContract)(run, (0, contract_1.createDefaultPipelineContract)());
    const inputNode = (0, node_store_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:input`,
        kind: "input",
        status: "completed",
        loopStage: "interpret",
        outputs: run.inputs,
        artifacts: [{ id: "state", kind: "json", path: run.paths.state }],
        contractId: contract.id,
        metadata: { workflowId: app.workflow.id, app: (0, app_schema_1.workflowAppRunMetadata)(app) },
    }));
    (0, run_store_1.saveCheckpoint)(run);
    for (const task of run.tasks) {
        const taskResult = (0, runner_1.runPipelineStage)(run, "plan", inputNode.id, {
            outputNodeId: `${run.id}:task:${task.id}`,
            outputStatus: "pending",
            loopStage: "interpret",
            artifacts: [{ id: "task", kind: "markdown", path: task.taskPath }],
            metadata: { workflowId: app.workflow.id, appId: app.id, appVersion: app.version, taskId: task.id, phase: task.phase, taskKind: task.kind, requiresEvidence: task.requiresEvidence, sandboxProfileId: task.sandboxProfileId },
        }, { persist: false, persistNode: node_store_1.writeRunNode, pathExists: fs.existsSync });
        task.stateNodeId = taskResult.outputNodeId;
    }
    (0, report_1.writeReport)(run);
    (0, commit_1.commitState)(run, "initial-plan");
    (0, run_store_1.saveCheckpoint)(run);
    return run;
}
