"use strict";
// shell/drive.ts — the thin imperative loop that calls drive-decide.ts
// once per step and performs the spawn/commit/cache-write IO the
// decision names.
//
// MILESTONE 6+7 (combined; see v2/PLAN.md Open risk 9/10 — the LARGEST
// milestone). Byte-exact port of the old build's src/drive.ts's
// imperative shell around the pure decision core now in
// core/pipeline/drive-decide.ts. Sub-workflow nesting and `--incremental`
// are ported; the concurrent-round driver (driveConcurrentRound) is
// scoped down to the serial driver run through a width loop, since no
// case in this milestone's combined gate exercises true concurrent-batch
// recording order (that is `--concurrency`/parallel-phase-specific and is
// authored as its own future conformance case per Open risk 5) — the
// `mode:"parallel"` architecture-review phases still complete correctly
// through the serial per-task loop, just without the wall-clock-parallel
// spawn optimization; this is flagged here rather than silently ported as
// if fully equivalent.
//
// Evidence: SPEC/pipeline-run.md "Drive loop — src/drive.ts".
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
exports.MAX_SUB_WORKFLOW_DEPTH = exports.DRIVE_SCHEMA_VERSION = void 0;
exports.driveStep = driveStep;
exports.drive = drive;
exports.drivePreview = drivePreview;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const drive_decide_1 = require("../core/pipeline/drive-decide");
const loop_expansion_1 = require("../core/pipeline/loop-expansion");
const dispatch_1 = require("../core/pipeline/dispatch");
const run_store_1 = require("./run-store");
const dispatch_2 = require("./dispatch");
const worker_isolation_1 = require("./worker-isolation");
const commit_1 = require("./commit");
const report_1 = require("./report");
const agent_config_1 = require("./agent-config");
const registry_1 = require("./execution-backend/registry");
const agent_1 = require("./execution-backend/agent");
const local_1 = require("./execution-backend/local");
const hash_1 = require("../core/hash");
const pipeline_1 = require("./pipeline");
const reporter_1 = require("./reporter");
const fs_atomic_1 = require("./fs-atomic");
exports.DRIVE_SCHEMA_VERSION = 1;
exports.MAX_SUB_WORKFLOW_DEPTH = 4;
function agentConfigured(config) {
    return Boolean(config.command || config.endpoint);
}
/** Progress to STDERR (stdout stays clean JSON). On by default when
 *  stderr is a TTY; silent in CI/pipes. CW_DRIVE_PROGRESS=0 forces off,
 *  =1 forces on. This is gate point #2 of the Rule of Silence's three
 *  gate points (SPEC/reporting-ux.md rebuild risk #1) — byte-exact port
 *  of the old build's src/drive.ts's emitProgress. */
function emitProgress(message) {
    const forcedOff = process.env.CW_DRIVE_PROGRESS === "0";
    const forcedOn = process.env.CW_DRIVE_PROGRESS === "1";
    if ((Boolean(process.stderr.isTTY) && !forcedOff) || forcedOn)
        reporter_1.reporter.progress(`[drive] ${message}`);
}
// A concurrent round runs many dispatch/accept steps against ONE shared
// in-memory run object, deferring every disk write to a single flush at
// round end (see driveConcurrentRound below). loadRun(ctx) is the single
// choke point every step reads through, so the cache lives here: while a
// round is active for a given run id, loadRun returns the SAME mutated
// object instead of re-reading (necessarily stale) disk state. Keyed by
// run id (not a stack) so a sub-workflow task's nested drive() call on a
// DIFFERENT run id is unaffected — re-entrant, matches the old build's
// runner.loadWithCache. Byte-exact in spirit to src/drive.ts's own
// per-runner cache; ported here as a module-level map since this build
// has no persistent "runner" object to hang it on.
const roundCache = new Map();
function loadRun(ctx) {
    const cached = roundCache.get(ctx.runId);
    if (cached)
        return cached;
    return (0, run_store_1.loadRunFromCwd)(ctx.runId, ctx.cwd);
}
/** Runs `fn` with `runId`'s loadRun calls served from one shared cached
 *  object (seeded fresh from disk), and always clears the cache entry
 *  afterward — even on throw — so a round never leaks its cache into a
 *  later, unrelated drive call. */
function withRoundCache(ctx, fn) {
    const seed = (0, run_store_1.loadRunFromCwd)(ctx.runId, ctx.cwd);
    roundCache.set(ctx.runId, seed);
    try {
        return fn();
    }
    finally {
        roundCache.delete(ctx.runId);
    }
}
function resultCachePath(run, task, promptDigest, incremental, delegationDigest) {
    let digest;
    if (incremental) {
        const upstream = previousPhaseResultsDigest(run, task);
        digest = (0, drive_decide_1.incrementalCacheKey)(run.workflow.id, task.id, promptDigest, (0, hash_1.sha256)((0, hash_1.stableStringify)(run.inputs || {})), delegationDigest, upstream);
    }
    else {
        const policy = task.resultCache;
        if (!policy || policy.mode !== "read-write" || !policy.keyInput)
            return undefined;
        const keyValue = String(run.inputs[policy.keyInput] || "").trim();
        digest = (0, drive_decide_1.defaultCacheKey)(run.workflow.id, task.id, policy.keyInput, keyValue, promptDigest, "");
    }
    if (!digest)
        return undefined;
    return path.join(run.cwd, ".cw", "cache", "worker-results", (0, fs_atomic_1.safeFileName)(run.workflow.id), (0, drive_decide_1.cacheFileName)(task.id, digest));
}
function previousPhaseResultsDigest(run, task) {
    const phaseIndex = run.phases.findIndex((p) => p.name === task.phase || p.id === task.phase);
    if (phaseIndex < 0)
        return undefined;
    const previousTaskIds = new Set(run.phases.slice(0, phaseIndex).flatMap((p) => p.taskIds));
    const records = [];
    for (const candidate of run.tasks.filter((t) => previousTaskIds.has(t.id)).sort((a, b) => a.id.localeCompare(b.id))) {
        if (candidate.status !== "completed" || !candidate.resultPath || !fs.existsSync(candidate.resultPath)) {
            records.push(undefined);
            continue;
        }
        records.push([candidate.id, (0, hash_1.sha256)(fs.readFileSync(candidate.resultPath, "utf8"))]);
    }
    if (records.some((r) => r === undefined))
        return undefined;
    return (0, hash_1.sha256)(JSON.stringify(records));
}
function writeResultCache(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, file);
}
/** `deferPersist` (concurrent-round callers ONLY — never a plain serial
 *  step) skips saveCheckpoint so a caller driving many tasks through one
 *  in-memory `run` can defer the disk flush to a single call at round
 *  end; `sharedRun`, when given, is mutated in place instead of a fresh
 *  loadRun (the round's one shared cached object). */
function handleHop(ctx, task, workerId, reason, deferPersist = false, sharedRun) {
    // ONE load, mutated in place and saved — a fresh reload right before
    // saveCheckpoint would discard recordWorkerFailure/RetryAttempt's own
    // in-memory mutation (they return an updated scope but mutate the run
    // object passed in), silently dropping the park/retry bookkeeping.
    const run = sharedRun || loadRun(ctx);
    const scope = (0, worker_isolation_1.getWorkerScope)(run, workerId);
    const persisted = scope?.retryCount || 0;
    const prior = (0, drive_decide_1.priorAttempts)(ctx.attempts.get(task.id) || 0, persisted);
    const decided = (0, drive_decide_1.retryOrPark)(prior, drive_decide_1.DEFAULT_SCHEDULING_POLICY, reason);
    ctx.attempts.set(task.id, decided.attempts);
    if (decided.status === "parked") {
        (0, worker_isolation_1.recordWorkerFailure)(run, workerId, decided.parkedReason || reason, { code: "agent-delegation-parked", retryable: false, retryCount: decided.attempts });
        if (!deferPersist)
            (0, run_store_1.saveCheckpoint)(run);
        return (0, drive_decide_1.makeStep)("park", "parked", { runId: ctx.runId, taskId: task.id, phase: task.phase, backendId: "agent", attempts: decided.attempts, reason: decided.parkedReason || reason });
    }
    (0, worker_isolation_1.recordWorkerRetryAttempt)(run, workerId, decided.attempts, reason);
    if (!deferPersist)
        (0, run_store_1.saveCheckpoint)(run);
    return (0, drive_decide_1.makeStep)("fulfill", "failed", { runId: ctx.runId, taskId: task.id, phase: task.phase, backendId: "agent", attempts: decided.attempts, reason });
}
function renderSubInputs(spec, parentInputs) {
    const out = {};
    for (const [key, template] of Object.entries(spec.inputs || {})) {
        out[key] = String(template).replace(/\{\{(\w+)\}\}/g, (_, name) => String(parentInputs[name] ?? ""));
    }
    return out;
}
function errMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/** `deferPersist` (concurrent-round callers ONLY) skips the per-task
 *  commitState/saveCheckpoint calls — the round flushes once at the end
 *  instead. `preparedOutcome`, when given (concurrent round only), is
 *  fed to runBackend so the agent spawn that already ran concurrently in
 *  prepareConcurrentOutcomes is SETTLED here, not re-spawned. */
function processSelectedTask(ctx, selectedId, preparedOutcome, deferPersist = false) {
    let run = loadRun(ctx);
    let selected = run.tasks.find((t) => t.id === selectedId);
    let workerId = selected.workerId;
    let dispatched = false;
    if (selected.status === "pending") {
        const manifest = (0, dispatch_2.createDispatchManifest)(run, 1, { backendId: selected.agentType || "agent" });
        // Byte-exact to the old build's orchestrator dispatch() wrapper: a
        // successful dispatch is its own checkpoint commit (reason
        // `dispatch:<dispatch-id>`), not just a bare saveCheckpoint — SPEC/
        // pipeline-run.md's persist-ordering section pins this exact reason.
        if (!deferPersist) {
            if (manifest.dispatchId)
                (0, commit_1.commitState)(run, `dispatch:${manifest.dispatchId}`);
            (0, run_store_1.saveCheckpoint)(run);
        }
        const dispatchedTask = manifest.tasks.find((t) => t.id === selected.id) || manifest.tasks[0];
        if (!dispatchedTask || !dispatchedTask.workerId) {
            return (0, drive_decide_1.makeStep)("dispatch", "failed", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, reason: "dispatch produced no worker scope" });
        }
        workerId = dispatchedTask.workerId;
        dispatched = true;
        run = loadRun(ctx);
        selected = run.tasks.find((t) => t.id === selectedId);
    }
    if (!workerId) {
        return (0, drive_decide_1.makeStep)("dispatch", "failed", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, reason: "no worker scope for task" });
    }
    const manifest = (0, worker_isolation_1.showWorkerManifest)(run, workerId);
    // `promptDigest` here is the PER-DISPATCH worker instructions file
    // (input.md) — it embeds this run's own id/dispatch id, so it is
    // NEVER stable across separate runs. It feeds ONLY recordWorkerOutput's
    // agentDelegation telemetry below, never the cache key. The cache key
    // instead digests the task's own static, workflow-authored prompt text
    // (selected.prompt), which IS stable across runs — byte-exact to the
    // old build's src/drive.ts:280-282 (two differently-sourced digests,
    // easy to collapse into one by mistake).
    const promptDigest = fs.existsSync(manifest.inputPath) ? (0, hash_1.sha256)(fs.readFileSync(manifest.inputPath, "utf8")) : (0, hash_1.sha256)(manifest.prompt || "");
    const cacheKeyPromptDigest = (0, hash_1.sha256)(selected.prompt || "");
    const delegationDigest = ctx.incremental
        ? (0, drive_decide_1.incrementalDelegationDigest)(selected.model || ctx.config.model || "", selected.agentType || "agent", manifest.sandboxPolicy?.id || selected.sandboxProfileId || "", ctx.config.command || "", ctx.config.args ? (0, agent_1.stripSecretArgs)(ctx.config.args) : [], ctx.config.endpoint || "")
        : "";
    const cachePath = resultCachePath(run, selected, cacheKeyPromptDigest, ctx.incremental, delegationDigest);
    if (cachePath && fs.existsSync(cachePath)) {
        emitProgress(`↺ ${selected.label || selected.id} (${selected.phase}) — accepting cached result`);
        try {
            fs.writeFileSync(manifest.resultPath, fs.readFileSync(cachePath, "utf8"), "utf8");
            (0, worker_isolation_1.recordWorkerOutput)(run, workerId, manifest.resultPath);
            // Byte-exact to the old build's orchestrator recordWorkerOutput()
            // wrapper: an accepted result is its own checkpoint commit (reason
            // `worker:<worker-id>:result`), not just a bare saveCheckpoint.
            if (!deferPersist) {
                (0, commit_1.commitState)(run, `worker:${workerId}:result`);
                (0, run_store_1.saveCheckpoint)(run);
            }
        }
        catch (error) {
            return handleHop(ctx, selected, workerId, `result cache rejected: ${errMessage(error)}`, deferPersist, deferPersist ? run : undefined);
        }
        return (0, drive_decide_1.makeStep)("accept", "ok", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, handleKind: "result-cache", reason: "result cache hit" });
    }
    const subWorkflow = selected.subWorkflow;
    if (subWorkflow) {
        emitProgress(`⧉ ${selected.label || selected.id} (${selected.phase}) — sub-workflow ${subWorkflow.appId}…`);
        return runSubWorkflow(ctx, run, selected, workerId, manifest, subWorkflow, deferPersist);
    }
    emitProgress(`→ ${selected.label || selected.id} (${selected.phase}) — ${dispatched ? "dispatched, " : ""}spawning agent, may take minutes…`);
    const envelope = (0, registry_1.runBackend)({
        schemaVersion: 1,
        runId: ctx.runId,
        taskId: selected.id,
        backendId: selected.agentType || "agent",
        cwd: run.cwd,
        sandboxPolicy: manifest.sandboxPolicy,
        manifest: { workerDir: manifest.workerDir, manifestPath: manifest.manifestPath, inputPath: manifest.inputPath, resultPath: manifest.resultPath, prompt: manifest.prompt },
        label: selected.id,
        timeoutMs: ctx.config.timeoutMs,
        delegation: { command: ctx.config.command, args: ctx.config.args, endpoint: ctx.config.endpoint, model: selected.model || ctx.config.model },
        ...(preparedOutcome ? { preparedAgentOutcome: preparedOutcome } : {}),
    });
    void dispatched;
    const handle = envelope.provenance.handle;
    const reportedModel = handle?.metadata?.reportedModel || "unreported";
    const reportedUsage = handle?.metadata?.reportedUsage;
    const usageSignature = handle?.metadata?.usageSignature;
    if (envelope.status !== "completed") {
        return handleHop(ctx, selected, workerId, `agent hop ${envelope.status}: ${envelope.result.summary}`, deferPersist, deferPersist ? run : undefined);
    }
    if (!manifest.resultPath || !fs.existsSync(manifest.resultPath)) {
        return handleHop(ctx, selected, workerId, "agent produced no result.md", deferPersist, deferPersist ? run : undefined);
    }
    try {
        (0, worker_isolation_1.recordWorkerOutput)(run, workerId, manifest.resultPath, {
            agentDelegation: {
                handle: handle,
                model: reportedModel,
                promptDigest,
                command: handle?.metadata?.command,
                args: handle?.metadata?.args || [],
                exitCode: (0, drive_decide_1.exitCodeFromEvidence)(envelope.evidence),
                reportedUsage,
                usageSignature,
                usageTrustPublicKey: ctx.config.attestPublicKey,
            },
            requireAttestedTelemetry: ctx.config.requireAttestedTelemetry,
        });
        if (!deferPersist) {
            (0, commit_1.commitState)(run, `worker:${workerId}:result`);
            (0, run_store_1.saveCheckpoint)(run);
        }
    }
    catch (error) {
        return handleHop(ctx, selected, workerId, `result.md rejected: ${errMessage(error)}`, deferPersist, deferPersist ? run : undefined);
    }
    if (cachePath && fs.existsSync(manifest.resultPath)) {
        writeResultCache(cachePath, fs.readFileSync(manifest.resultPath, "utf8"));
    }
    return (0, drive_decide_1.makeStep)("accept", "ok", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, backendId: "agent", handleKind: handle?.kind, reportedModel });
}
function runSubWorkflow(ctx, run, selected, workerId, manifest, spec, deferPersist = false) {
    const parentApp = run.workflow.id;
    if (ctx.depth + 1 > exports.MAX_SUB_WORKFLOW_DEPTH) {
        return handleHop(ctx, selected, workerId, `sub-workflow depth limit exceeded (> ${exports.MAX_SUB_WORKFLOW_DEPTH})`, deferPersist, deferPersist ? run : undefined);
    }
    if ([...ctx.visitedAppIds, parentApp].includes(spec.appId)) {
        return handleHop(ctx, selected, workerId, `sub-workflow cycle detected: ${[...ctx.visitedAppIds, parentApp, spec.appId].join(" -> ")}`, deferPersist, deferPersist ? run : undefined);
    }
    const childRunId = `sub-${run.id}-${(0, fs_atomic_1.safeFileName)(selected.id)}`;
    const childInputs = {
        repo: run.inputs.repo ?? run.cwd,
        cwd: run.cwd,
        question: run.inputs.question ?? "",
        ...renderSubInputs(spec, run.inputs),
        runId: childRunId,
    };
    let childRun;
    try {
        const { loadWorkflowApp } = require("./workflow-app-loader");
        childRun = (0, pipeline_1.plan)(loadWorkflowApp(spec.appId), childInputs);
    }
    catch (error) {
        return handleHop(ctx, selected, workerId, `sub-workflow plan failed (${spec.appId}): ${errMessage(error)}`, deferPersist, deferPersist ? run : undefined);
    }
    const childResult = drive(childRun.id, childRun.cwd, {
        now: ctx.now,
        agentConfig: ctx.config,
        incremental: ctx.incremental,
        depth: ctx.depth + 1,
        visitedAppIds: [...ctx.visitedAppIds, parentApp],
    });
    if (childResult.status !== "complete") {
        return handleHop(ctx, selected, workerId, `sub-workflow ${spec.appId} did not complete (status: ${childResult.status})`, deferPersist, deferPersist ? run : undefined);
    }
    const finalChild = (0, run_store_1.loadRunFromCwd)(childRun.id, childRun.cwd);
    let childBytes;
    if (spec.bindResult === "verdict-result") {
        const verdict = finalChild.tasks.find((t) => /^verdict[:/]|^synthesis[:/]/i.test(t.id) && t.status === "completed");
        childBytes = verdict?.resultPath && fs.existsSync(verdict.resultPath) ? fs.readFileSync(verdict.resultPath, "utf8") : undefined;
    }
    else {
        childBytes = fs.existsSync(finalChild.paths.report) ? fs.readFileSync(finalChild.paths.report, "utf8") : undefined;
    }
    if (childBytes === undefined) {
        return handleHop(ctx, selected, workerId, `sub-workflow ${spec.appId} produced no ${spec.bindResult || "report"}`, deferPersist, deferPersist ? run : undefined);
    }
    try {
        fs.writeFileSync(manifest.resultPath, childBytes, "utf8");
        (0, worker_isolation_1.recordWorkerOutput)(run, workerId, manifest.resultPath);
        if (!deferPersist) {
            (0, commit_1.commitState)(run, `worker:${workerId}:result`);
            (0, run_store_1.saveCheckpoint)(run);
        }
    }
    catch (error) {
        return handleHop(ctx, selected, workerId, `sub-workflow result rejected by parent gate: ${errMessage(error)}`, deferPersist, deferPersist ? run : undefined);
    }
    return (0, drive_decide_1.makeStep)("accept", "ok", { runId: run.id, taskId: selected.id, phase: selected.phase, handleKind: "sub-workflow", reason: `sub-workflow ${spec.appId} → ${childRun.id}` });
}
/** One deterministic drive step. */
function driveStep(ctx) {
    const run = loadRun(ctx);
    const selected = (0, drive_decide_1.selectDriveTask)(run);
    const budget = run.workflow.limits?.tokenBudget;
    const gate = (0, drive_decide_1.terminalOrConfigStep)(run, selected, agentConfigured(ctx.config), budget && budget > 0 ? { spent: 0, budget } : undefined);
    if (gate.kind === "commit") {
        const commit = (0, commit_1.commitState)(run, { reason: "agent-delegation-drive: audited verdict committed", ...(gate.verifierNodeId ? { verifierNodeId: gate.verifierNodeId } : { allowUnverifiedCheckpoint: true, verifierGated: false }) });
        (0, report_1.writeReport)(run);
        (0, run_store_1.saveCheckpoint)(run);
        return (0, drive_decide_1.makeStep)("commit", "complete", { runId: run.id, reason: `committed ${commit.id}` });
    }
    if (gate.step)
        return gate.step;
    return processSelectedTask(ctx, selected.id);
}
/** Dispatch every batch task (sequential — dispatch mutates state), then
 *  collect ALL spawn-style agent child outcomes in one concurrent window
 *  (one batch delegate child process, per-job timeout kill). Returns
 *  outcomes keyed by task id; a cache-hit or endpoint-configured agent
 *  gets no prepared outcome and settles through the serial accept path
 *  inside processSelectedTask. Dispatch failures become recorded fail
 *  steps up front, exactly what the serial path would emit. Byte-exact
 *  to the old build's src/drive.ts's prepareConcurrentOutcomes. */
function prepareConcurrentOutcomes(ctx, batch) {
    const failSteps = new Map();
    const jobs = [];
    const jobTaskIds = [];
    for (const taskId of batch) {
        const run = loadRun(ctx);
        const task = run.tasks.find((candidate) => candidate.id === taskId);
        if (!task || (task.status !== "pending" && task.status !== "running"))
            continue;
        let workerId = task.workerId;
        if (task.status === "pending") {
            const manifest = (0, dispatch_2.createDispatchManifest)(run, 1, { backendId: task.agentType || "agent" });
            const dispatchedTask = manifest.tasks.find((entry) => entry.id === task.id) || manifest.tasks[0];
            if (!dispatchedTask || !dispatchedTask.workerId) {
                failSteps.set(taskId, (0, drive_decide_1.makeStep)("dispatch", "failed", { runId: ctx.runId, taskId, phase: task.phase, reason: "dispatch produced no worker scope" }));
                continue;
            }
            workerId = dispatchedTask.workerId;
        }
        if (!workerId) {
            failSteps.set(taskId, (0, drive_decide_1.makeStep)("dispatch", "failed", { runId: ctx.runId, taskId, phase: task.phase, reason: "no worker scope for task" }));
            continue;
        }
        const freshRun = loadRun(ctx);
        const manifest = (0, worker_isolation_1.showWorkerManifest)(freshRun, workerId);
        const delegationDigest = ctx.incremental
            ? (0, drive_decide_1.incrementalDelegationDigest)(task.model || ctx.config.model || "", task.agentType || "agent", manifest.sandboxPolicy?.id || task.sandboxProfileId || "", ctx.config.command || "", ctx.config.args ? (0, agent_1.stripSecretArgs)(ctx.config.args) : [], ctx.config.endpoint || "")
            : "";
        const cachePath = resultCachePath(freshRun, task, (0, hash_1.sha256)(task.prompt || ""), ctx.incremental, delegationDigest);
        if (cachePath && fs.existsSync(cachePath))
            continue;
        const job = (0, agent_1.prepareAgentSpawn)({
            schemaVersion: 1,
            runId: ctx.runId,
            taskId: task.id,
            backendId: task.agentType || "agent",
            cwd: freshRun.cwd,
            sandboxPolicy: manifest.sandboxPolicy,
            manifest: { workerDir: manifest.workerDir, manifestPath: manifest.manifestPath, inputPath: manifest.inputPath, resultPath: manifest.resultPath, prompt: manifest.prompt },
            label: task.id,
            timeoutMs: ctx.config.timeoutMs,
            delegation: { command: ctx.config.command, args: ctx.config.args, endpoint: ctx.config.endpoint, model: task.model || ctx.config.model },
        });
        if (job) {
            const sandboxPolicy = manifest.sandboxPolicy;
            if (sandboxPolicy) {
                const filteredEnv = (0, local_1.buildChildEnv)(sandboxPolicy);
                for (const key of Object.keys(process.env)) {
                    if (/^(CW_|ANTHROPIC_|OPENAI_|GEMINI_|DEEPSEEK_|CODEX_|GOOGLE_|COHERE_|MISTRAL_|OLLAMA_|AZURE_|AWS_)/i.test(key)) {
                        filteredEnv[key] = process.env[key];
                    }
                }
                job.env = filteredEnv;
            }
            jobs.push(job);
            jobTaskIds.push(taskId);
        }
    }
    if (jobs.length) {
        emitProgress(`⇉ concurrent round: ${jobs.length} agent${jobs.length > 1 ? "s" : ""} spawning in parallel, may take minutes…`);
    }
    const settled = (0, agent_1.runAgentBatchOutcomes)(jobs);
    const outcomes = new Map();
    jobTaskIds.forEach((taskId, index) => outcomes.set(taskId, settled[index]));
    return { outcomes, failSteps };
}
/** One concurrent round inside one cached in-memory run: dispatches every
 *  batch task, spawns all spawn-style agent children in one concurrent
 *  window, then settles + accepts in DETERMINISTIC batch (task-id) order
 *  regardless of wall-clock finish order. At round end it flushes once:
 *  commitState(run, "concurrent-round:<n>-tasks") + writeReport +
 *  saveCheckpoint. Cache-hit tasks and endpoint-only agents get no
 *  prepared outcome and settle through the serial path (still inside
 *  this one deferred-persist round). If no step was produced (nothing
 *  runnable at round entry — terminal/blocked/token-budget gate) the
 *  round degrades to one plain driveStep. Byte-exact to the old build's
 *  src/drive.ts's driveConcurrentRound. */
function driveConcurrentRound(ctx, limit) {
    return withRoundCache(ctx, () => {
        const run = loadRun(ctx);
        const selected = (0, drive_decide_1.selectDriveTask)(run);
        const budget = run.workflow.limits?.tokenBudget;
        const gate = (0, drive_decide_1.terminalOrConfigStep)(run, selected, agentConfigured(ctx.config), budget && budget > 0 ? { spent: 0, budget } : undefined);
        if (gate.kind === "commit" || gate.step)
            return [driveStep(ctx)];
        const phase = (0, dispatch_1.firstRunnablePhase)(run);
        const width = Math.max(1, Math.floor(limit) || 1);
        const batch = run.tasks
            .filter((task) => phase.taskIds.includes(task.id) && (task.status === "pending" || task.status === "running"))
            .slice(0, width)
            .map((task) => task.id);
        const prepared = prepareConcurrentOutcomes(ctx, batch);
        const steps = [];
        for (const taskId of batch) {
            const failStep = prepared.failSteps.get(taskId);
            if (failStep) {
                steps.push(failStep);
                continue;
            }
            // Re-read per task: a prior accept in this round mutated state (the
            // SAME cached object via loadRun's round cache — no disk round-trip
            // until the round-end flush below).
            const freshRun = loadRun(ctx);
            const fresh = freshRun.tasks.find((task) => task.id === taskId);
            if (!fresh || (fresh.status !== "pending" && fresh.status !== "running"))
                continue;
            steps.push(processSelectedTask(ctx, taskId, prepared.outcomes.get(taskId), true));
        }
        if (steps.length > 0) {
            const settledRun = loadRun(ctx);
            (0, commit_1.commitState)(settledRun, `concurrent-round:${batch.length}-tasks`);
            (0, report_1.writeReport)(settledRun);
            (0, run_store_1.saveCheckpoint)(settledRun);
        }
        return steps.length > 0 ? steps : [driveStep(ctx)];
    });
}
/** Drive a run: `--once` advances exactly one step; otherwise run to
 *  completion, park, or a blocked stop. */
function drive(runId, cwd, options = {}) {
    const now = options.now || new Date().toISOString();
    const config = options.agentConfig || (0, agent_config_1.resolveAgentConfig)(options.args || {});
    const ctx = {
        runId,
        cwd,
        now,
        config,
        attempts: new Map(),
        incremental: Boolean(options.incremental),
        depth: Math.max(0, Math.floor(options.depth || 0)),
        visitedAppIds: options.visitedAppIds || [],
    };
    const steps = [];
    const run0 = loadRun(ctx);
    const plannedWorkers = run0.tasks.length;
    const maxIter = (0, drive_decide_1.maxIterations)(plannedWorkers, (0, loop_expansion_1.maxLoopExpansion)(run0), drive_decide_1.DEFAULT_SCHEDULING_POLICY);
    let exhaustedMaxIterations = !options.once;
    for (let i = 0; i < maxIter; i++) {
        const width = (0, drive_decide_1.roundWidth)(loadRun(ctx), options.concurrency);
        // width>1 (an explicit --concurrency>1, or an auto-width parallel
        // phase) runs the whole round through driveConcurrentRound — one or
        // more steps recorded in deterministic batch order, one flush at
        // round end. `--once` still stops after this ONE outer-loop
        // iteration even though a round can yield multiple steps.
        const roundSteps = width > 1 ? driveConcurrentRound(ctx, width) : [driveStep(ctx)];
        for (const stepResult of roundSteps)
            steps.push(stepResult);
        const last = roundSteps[roundSteps.length - 1];
        if (options.once) {
            exhaustedMaxIterations = false;
            break;
        }
        if (last && (last.status === "complete" || last.status === "parked" || last.status === "blocked")) {
            exhaustedMaxIterations = false;
            break;
        }
    }
    const run = loadRun(ctx);
    const completedWorkers = (0, drive_decide_1.countCompleted)(run);
    const parkedWorkers = (0, drive_decide_1.countParked)(run);
    const committed = (0, drive_decide_1.hasTerminalCommit)(run);
    const last = steps[steps.length - 1];
    if (exhaustedMaxIterations) {
        steps.push((0, drive_decide_1.makeStep)("blocked", "blocked", { runId, reason: `drive reached max iteration limit (${maxIter}) before a terminal state` }));
    }
    const statusInputs = {
        once: Boolean(options.once),
        completedWorkers,
        plannedWorkers,
        committed,
        lastStepStatus: steps[steps.length - 1]?.status,
        exhaustedMaxIterations,
        parkedWorkers,
    };
    void last;
    void drive_decide_1.verdictVerifierNodeId;
    const status = (0, drive_decide_1.finalDriveStatus)(statusInputs);
    const committedCommit = (run.commits || []).find((c) => c.reason && c.reason.startsWith("agent-delegation-drive"));
    return {
        schemaVersion: 1,
        runId,
        workflowId: run.workflow.id,
        status,
        steps,
        plannedWorkers,
        completedWorkers,
        parkedWorkers,
        commitId: committedCommit?.id,
        reportPath: run.paths.report,
        statePath: run.paths.state,
        agentConfigured: agentConfigured(config),
    };
}
function drivePreview(runId, cwd, args = {}) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, cwd);
    const config = (0, agent_config_1.resolveAgentConfig)(args);
    const configured = agentConfigured(config);
    const selected = (0, drive_decide_1.selectDriveTask)(run);
    const plannedWorkers = run.tasks.length;
    const pendingWorkers = run.tasks.filter((t) => t.status === "pending" || t.status === "running").length;
    const completedWorkers = (0, drive_decide_1.countCompleted)(run);
    const parkedWorkers = (0, drive_decide_1.countParked)(run);
    let nextAction;
    if (!selected) {
        nextAction = run.tasks.every((t) => t.status === "completed") ? "commit" : "blocked";
    }
    else if (!configured) {
        nextAction = "blocked";
    }
    else if (selected.status === "pending") {
        nextAction = "dispatch";
    }
    else {
        nextAction = "fulfill";
    }
    return { schemaVersion: 1, runId, workflowId: run.workflow.id, plannedWorkers, pendingWorkers, completedWorkers, parkedWorkers, nextAction, nextTaskId: selected?.id, nextPhase: selected?.phase, agentConfigured: configured };
}
