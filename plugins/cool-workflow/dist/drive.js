"use strict";
// Agent Delegation Drive (v0.1.38) — the `run --drive` auto-advance loop.
//
// THE GAP THIS CLOSES: CW can plan, isolate, and accept worker output, but nothing
// SPAWNS the agent that writes each result.md — the last mile was a human/agent
// hand-writing 14 result.md files out-of-band. This loop wires the EXISTING verbs
// (plan -> dispatch -> agent-fulfill -> recordWorkerOutput/verify -> commit) and the
// v0.1.37 scheduler (retryOrPark) into ONE thin orchestrator. It spawns NOTHING
// itself except through `runBackend({ backendId: "agent" })`; it introduces NO second
// queue, runner, or scheduler.
//
// BSD discipline:
//  - DELEGATE, DON'T EXECUTE: the model runs in the agent's process. The loop only
//    sequences existing verbs + the agent backend; it never imports a model SDK.
//  - FAIL CLOSED [load-bearing]: an unconfigured agent BLOCKS (never fabricates a
//    completion); an agent hop that exits non-zero / writes no result.md / writes an
//    invalid result.md is a FAILED hop. A worker that exhausts the scheduling retry
//    budget PARKS (reuse v0.1.37 retryOrPark) — never silently re-driven forever.
//  - DETERMINISTIC: `now` is injected; the per-worker order is the existing
//    deterministic phase/dispatch order; `--once` advances exactly one step.
//  - REUSE, DON'T FORK: every mutation goes through the existing runner verbs.
//
// See docs/agent-delegation-drive.7.md.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SUB_WORKFLOW_DEPTH = exports.DRIVE_SCHEMA_VERSION = void 0;
exports.driveStep = driveStep;
exports.driveConcurrentRound = driveConcurrentRound;
exports.drive = drive;
exports.drivePreview = drivePreview;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const term_1 = require("./term");
const reporter_1 = require("./reporter");
const dispatch_1 = require("./dispatch");
const execution_backend_1 = require("./execution-backend");
const worker_isolation_1 = require("./worker-isolation");
const agent_config_1 = require("./agent-config");
const scheduling_1 = require("./scheduling");
const observability_1 = require("./observability");
const loop_expansion_1 = require("./loop-expansion");
const telemetry_attestation_1 = require("./telemetry-attestation");
const state_1 = require("./state");
const trust_audit_1 = require("./trust-audit");
const compare_1 = require("./compare");
exports.DRIVE_SCHEMA_VERSION = 1;
/** Hard cap on inline sub-workflow nesting depth (fail-closed bound on recursion). */
exports.MAX_SUB_WORKFLOW_DEPTH = 4;
/** The task the next drive step would advance: a RUNNING (already-dispatched,
 *  awaiting fulfillment / retry) task first, else the next PENDING task in the
 *  first runnable phase. Deterministic; honors the existing phase gate. */
function selectDriveTask(run) {
    const phase = (0, dispatch_1.firstRunnablePhase)(run);
    if (!phase)
        return undefined;
    const phaseTasks = run.tasks.filter((task) => phase.taskIds.includes(task.id));
    return phaseTasks.find((task) => task.status === "running") || phaseTasks.find((task) => task.status === "pending");
}
function countCompleted(run) {
    return run.tasks.filter((task) => task.status === "completed").length;
}
function countParked(run) {
    return run.tasks.filter((task) => task.status === "failed").length;
}
function verdictVerifierNodeId(run) {
    const verdict = run.tasks.find((task) => /^verdict[:/]|^synthesis[:/]/i.test(task.id) && task.status === "completed");
    return verdict?.verifierNodeId;
}
function exitCodeFromEvidence(evidence) {
    const entry = evidence.find((line) => line.startsWith("exitCode:"));
    if (!entry)
        return null;
    const raw = entry.slice("exitCode:".length);
    return raw === "null" ? null : Number(raw);
}
function agentConfigured(config) {
    return Boolean(config.command || config.endpoint);
}
/** Progress to STDERR (stdout stays clean JSON). On by default when stderr is a
 *  TTY; silent in CI/pipes. CW_DRIVE_PROGRESS=0 forces off, =1 forces on. */
function emitProgress(message) {
    const forcedOff = process.env.CW_DRIVE_PROGRESS === "0";
    const forcedOn = process.env.CW_DRIVE_PROGRESS === "1";
    if ((Boolean(process.stderr.isTTY) && !forcedOff) || forcedOn)
        reporter_1.reporter.progress(`[drive] ${message}`);
}
/** Advance exactly ONE deterministic step. Pure-ish: all mutation is through the
 *  existing runner verbs + runBackend. */
function driveStep(ctx) {
    const run = ctx.runner.loadRun(ctx.runId);
    const selected = selectDriveTask(run);
    const gate = terminalOrConfigStep(ctx, run, selected);
    if (gate)
        return gate;
    return processSelectedTask(ctx, selected);
}
/** The non-advancing outcomes shared by the serial and concurrent loops: a
 *  terminal commit/complete, a blocked phase, or a fail-closed unconfigured
 *  agent. Returns undefined when there is a task ready to actually process. */
function terminalOrConfigStep(ctx, run, selected) {
    const { runner, runId } = ctx;
    // Terminal: no pending/running work remains -> commit (once) then complete.
    if (!selected) {
        const allComplete = run.tasks.every((task) => task.status === "completed");
        if (allComplete) {
            const alreadyCommitted = (run.commits || []).some((commit) => commit.reason && commit.reason.startsWith("agent-delegation-drive"));
            if (!alreadyCommitted) {
                const verifierNodeId = verdictVerifierNodeId(run);
                const commit = runner.commit(runId, {
                    reason: "agent-delegation-drive: audited verdict committed",
                    ...(verifierNodeId ? { verifier: verifierNodeId } : { allowUnverifiedCheckpoint: true })
                });
                return step("commit", "complete", { runId, reason: `committed ${commit.commit.id}` });
            }
            return step("complete", "complete", { runId });
        }
        // Nothing eligible but not all complete: a parked/failed worker blocks the phase.
        return step("blocked", "blocked", { runId, reason: "no eligible worker (a parked/failed worker blocks the phase gate)" });
    }
    // Token budget (Track 3): enforce limits.tokenBudget against RECORDED usage
    // before spawning the next agent. CW does not measure usage — it counts the
    // host-attested records exactly as recorded (deriveUsageTotals, the same
    // aggregation MetricsReport shows), so an unreported hop costs 0 here; an
    // operator who needs every hop counted combines this with the fail-closed
    // telemetry policy (Track 1), which refuses unattested usage at accept time.
    // Exhaustion BLOCKS (refuses to spawn) rather than parks: the task is not
    // bad, the run is out of budget.
    const budget = run.workflow.limits?.tokenBudget;
    if (typeof budget === "number" && budget > 0) {
        const spent = (0, observability_1.deriveUsageTotals)(run).totals.totalTokens;
        if (spent >= budget) {
            return step("blocked", "blocked", {
                runId,
                taskId: selected.id,
                phase: selected.phase,
                reason: `token budget exhausted: ${spent} recorded tokens >= budget ${budget} — refusing to spawn further agents`
            });
        }
    }
    // Fail closed: an unconfigured agent cannot fulfill anything.
    if (!agentConfigured(ctx.config)) {
        return step("blocked", "blocked", {
            runId,
            taskId: selected.id,
            phase: selected.phase,
            reason: "agent backend not configured (set CW_AGENT_COMMAND/CW_AGENT_ENDPOINT or pass --agent-command/--agent-endpoint) — refusing rather than fabricating a completion"
        });
    }
    return undefined;
}
/** The ONE place a drive execution request is built — serial and concurrent
 *  paths share it so the delegation surface cannot drift. task.model overrides
 *  the agent-config model for THIS task ({{model}} substitution + stripped-args
 *  provenance; never the attested model). task.agentType names the delegating
 *  backend driver (default "agent"). */
function buildAgentRequest(ctx, run, task, manifest, preparedOutcome) {
    return {
        schemaVersion: 1,
        runId: ctx.runId,
        taskId: task.id,
        backendId: task.agentType || "agent",
        cwd: run.cwd,
        sandboxPolicy: manifest.sandboxPolicy || manifest.sandbox?.policy,
        manifest,
        label: task.id,
        timeoutMs: ctx.config.timeoutMs,
        delegation: {
            command: ctx.config.command,
            args: ctx.config.args,
            endpoint: ctx.config.endpoint,
            model: task.model || ctx.config.model
        },
        ...(preparedOutcome ? { preparedAgentOutcome: preparedOutcome } : {})
    };
}
/** Process ONE ready task end-to-end: dispatch (if pending) -> delegate to the
 *  agent backend -> accept its result.md. Factored out of driveStep so the
 *  concurrent loop can reuse the IDENTICAL per-worker delegation (red line and
 *  fail-closed semantics included), differing only in HOW MANY tasks per round.
 *  Track 2: `preparedOutcome` carries a batch-collected child outcome — the
 *  fulfill step then settles it through runBackend instead of spawning again,
 *  so the concurrent round and the serial step share EVERY envelope/accept
 *  branch by construction. */
function processSelectedTask(ctx, selected, preparedOutcome) {
    const { runner, runId } = ctx;
    let run = runner.loadRun(runId);
    // 1. DISPATCH (only a fresh pending task; a running task is a retry on its scope).
    //    task.agentType names the delegating backend driver (default "agent").
    let workerId = selected.workerId;
    let dispatched = false;
    if (selected.status === "pending") {
        const manifest = runner.dispatch(runId, { limit: 1, backend: selected.agentType || "agent" });
        const task = manifest.tasks.find((entry) => entry.id === selected.id) || manifest.tasks[0];
        if (!task || !task.workerId) {
            return step("dispatch", "failed", { runId, taskId: selected.id, phase: selected.phase, reason: "dispatch produced no worker scope" });
        }
        workerId = task.workerId;
        dispatched = true;
        run = runner.loadRun(runId);
    }
    if (!workerId) {
        return step("dispatch", "failed", { runId, taskId: selected.id, phase: selected.phase, reason: "no worker scope for task" });
    }
    // 2. FULFILL — delegate the worker to the agent backend (out-of-process). The
    //    agent reads input/manifest and writes result.md; CW captures the child's
    //    command/exit/stdout digest (the evidence triple) + the reported model.
    const manifest = runner.showWorkerManifest(runId, workerId);
    // Progress BEFORE the (possibly multi-minute) agent spawn, so a live drive shows
    // immediate activity instead of a long silence on the first worker. task.label
    // is the human-facing display name; the id stays the stable reference.
    const promptDigest = node_fs_1.default.existsSync(manifest.inputPath) ? (0, execution_backend_1.sha256)(node_fs_1.default.readFileSync(manifest.inputPath, "utf8")) : (0, execution_backend_1.sha256)(manifest.prompt || "");
    const cachePath = resultCachePath(run, selected, (0, execution_backend_1.sha256)(selected.prompt), ctx.incremental, ctx.incremental ? incrementalDelegationDigest(selected, manifest, ctx.config) : "");
    if (cachePath && node_fs_1.default.existsSync(cachePath)) {
        emitProgress(`↺ ${selected.label || selected.id} (${selected.phase}) — accepting cached result`);
        try {
            node_fs_1.default.writeFileSync(manifest.resultPath, node_fs_1.default.readFileSync(cachePath, "utf8"), "utf8");
            runner.recordWorkerOutput(runId, workerId, manifest.resultPath, {});
        }
        catch (error) {
            return handleHop(ctx, selected, workerId, `result cache rejected: ${error instanceof Error ? error.message : String(error)}`);
        }
        return step("accept", "ok", {
            runId,
            taskId: selected.id,
            phase: selected.phase,
            handleKind: "result-cache",
            reason: "result cache hit"
        });
    }
    // Sub-workflow fulfillment (alternative to the agent backend): plan + drive a
    // CHILD run and bind its report back as this task's result. Leaf work is still
    // external-agent delegation at every level; CW imports no model SDK here.
    if (selected.subWorkflow) {
        return runSubWorkflow(ctx, run, selected, workerId, manifest);
    }
    emitProgress(`→ ${selected.label || selected.id} (${selected.phase}) — ${dispatched ? "dispatched, " : ""}spawning agent, may take minutes…`);
    const envelope = (0, execution_backend_1.runBackend)(buildAgentRequest(ctx, run, selected, manifest, preparedOutcome));
    const handle = envelope.provenance.handle;
    const reportedModel = handle?.metadata?.reportedModel || "unreported";
    const reportedUsage = handle?.metadata?.reportedUsage;
    const usageSignature = handle?.metadata?.usageSignature;
    if (envelope.status !== "completed") {
        return handleHop(ctx, selected, workerId, `agent hop ${envelope.status}: ${envelope.result.summary}`);
    }
    // 3. ACCEPT — the SEPARATE recordWorkerOutput layer validates + records result.md.
    //    A missing result.md is a failed hop (pre-checked so no terminal side effect);
    //    an invalid result.md throws at validation BEFORE any state mutation.
    if (!manifest.resultPath || !node_fs_1.default.existsSync(manifest.resultPath)) {
        return handleHop(ctx, selected, workerId, "agent produced no result.md");
    }
    try {
        runner.recordWorkerOutput(runId, workerId, manifest.resultPath, {
            agentDelegation: {
                handle: handle,
                model: reportedModel,
                promptDigest,
                command: handle?.metadata?.command,
                args: handle?.metadata?.args || [],
                exitCode: exitCodeFromEvidence(envelope.evidence),
                // Track 1: thread the agent's self-reported usage + its signature through
                // to the accept layer, with the operator trust key to verify against.
                reportedUsage,
                usageSignature,
                usageTrustPublicKey: ctx.config.attestPublicKey
            },
            // Track 1 fail-closed (opt-in): park a hop whose telemetry isn't attested.
            requireAttestedTelemetry: ctx.config.requireAttestedTelemetry
        });
    }
    catch (error) {
        return handleHop(ctx, selected, workerId, `result.md rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (cachePath && manifest.resultPath && node_fs_1.default.existsSync(manifest.resultPath)) {
        writeResultCache(cachePath, node_fs_1.default.readFileSync(manifest.resultPath, "utf8"));
    }
    return step("accept", "ok", {
        runId,
        taskId: selected.id,
        phase: selected.phase,
        backendId: "agent",
        handleKind: handle?.kind,
        reportedModel
    });
}
function cacheFilePath(run, task, digest) {
    return node_path_1.default.join(run.cwd, ".cw", "cache", "worker-results", (0, state_1.safeFileName)(run.workflow.id), `${(0, state_1.safeFileName)(task.id)}-${digest.replace(/^sha256:/, "").slice(0, 32)}.md`);
}
/** Digest of the per-task DELEGATION config that determines a result but is NOT
 *  carried by the prompt or run.inputs: the resolved model (task override OR the
 *  global agent-config model), the agent IDENTITY (which binary/endpoint actually
 *  produces the bytes — `command`/`args`/`endpoint`), the backend driver, and the
 *  resolved sandbox PROFILE ID. All of these are operator flags/env (`--agent-model`,
 *  `--agent-command`, `--agent-endpoint`, ...) stripped from run.inputs by
 *  DRIVE_RUNTIME_KEYS, so they must be folded here or swapping the model/agent/
 *  endpoint would serve a stale result (and attest the wrong producer). The sandbox
 *  PROFILE ID (not the full resolved policy) is used because the policy's read/write
 *  paths embed the per-run worker dir, so the full policy is NOT stable across runs
 *  (it would defeat all reuse); the id is stable and changes on a profile swap. Args
 *  are secret-stripped (no credential lands in the digest input). `config.args` is
 *  the un-substituted template (e.g. `{{result}}`), so it is stable across runs.
 *  Deterministic: stableStringify, no clock/random. */
function incrementalDelegationDigest(task, manifest, config) {
    return (0, execution_backend_1.sha256)((0, telemetry_attestation_1.stableStringify)({
        model: task.model || config.model || "",
        agentType: task.agentType || "agent",
        sandboxProfileId: manifest.sandboxPolicy?.id || task.sandboxProfileId || "",
        command: config.command || "",
        args: config.args ? (0, execution_backend_1.stripSecretArgs)(config.args) : [],
        endpoint: config.endpoint || ""
    }));
}
function resultCachePath(run, task, promptDigest, incremental, delegationDigest) {
    // Incremental resume (opt-in, run-level): EVERY task is keyed by content so a
    // re-run reuses the longest unchanged prefix. The key folds the rendered prompt,
    // the full run.inputs, the per-task DELEGATION config (model/backend/sandbox —
    // result-determining but NOT carried by prompt/inputs, so editing the model must
    // invalidate), and the UPSTREAM RESULT digests (not just prompts: a CW prompt is
    // rendered from run.inputs and does NOT carry an upstream task's result bytes, so
    // a changed/nondeterministic upstream result must invalidate downstream — which
    // keying on upstream result bytes does). A changed prompt/input/model perturbs
    // that task's key, and its changed result perturbs every downstream key, so the
    // "first changed task and everything after" re-run falls out for free. The phase
    // barrier guarantees every upstream task is `completed` before this task runs, so
    // its result bytes are available to digest. schemaVersion:2 never collides with
    // the opt-in schemaVersion:1 cache below.
    if (incremental) {
        const upstreamResultsDigest = previousPhaseResultsDigest(run, task);
        if (upstreamResultsDigest === undefined)
            return undefined;
        const digest = (0, execution_backend_1.sha256)((0, telemetry_attestation_1.stableStringify)({
            schemaVersion: 2,
            workflowId: run.workflow.id,
            taskId: task.id,
            promptDigest,
            runInputsDigest: (0, execution_backend_1.sha256)((0, telemetry_attestation_1.stableStringify)(run.inputs || {})),
            delegationDigest,
            upstreamResultsDigest
        }));
        return cacheFilePath(run, task, digest);
    }
    // Default: the per-task OPT-IN cache (unchanged — POLA).
    const policy = task.resultCache;
    if (!policy || policy.mode !== "read-write")
        return undefined;
    const keyInput = policy.keyInput;
    const keyValue = keyInput ? String(run.inputs[keyInput] || "").trim() : "";
    if (!keyInput || !keyValue)
        return undefined;
    const completedResultsDigest = completedResultsCacheDigest(run, task);
    if (completedResultsDigest === undefined)
        return undefined;
    const digest = (0, execution_backend_1.sha256)(JSON.stringify({
        schemaVersion: 1,
        workflowId: run.workflow.id,
        taskId: task.id,
        keyInput,
        keyValue,
        promptDigest,
        completedResultsDigest
    }));
    return cacheFilePath(run, task, digest);
}
/** Digest of the result bytes of every task in strictly-earlier phases (deterministic
 *  id order). `undefined` when any such task is not yet completed/readable — so a
 *  caller never keys on partial upstream state. */
function previousPhaseResultsDigest(run, task) {
    const phaseIndex = run.phases.findIndex((phase) => phase.name === task.phase || phase.id === task.phase);
    if (phaseIndex < 0)
        return undefined;
    const previousTaskIds = new Set(run.phases.slice(0, phaseIndex).flatMap((phase) => phase.taskIds));
    const records = run.tasks
        .filter((candidate) => previousTaskIds.has(candidate.id))
        .sort((a, b) => (0, compare_1.compareBytes)(a.id, b.id))
        .map((candidate) => {
        if (candidate.status !== "completed" || !candidate.resultPath || !node_fs_1.default.existsSync(candidate.resultPath))
            return undefined;
        return [candidate.id, (0, execution_backend_1.sha256)(node_fs_1.default.readFileSync(candidate.resultPath, "utf8"))];
    });
    if (records.some((record) => record === undefined))
        return undefined;
    return (0, execution_backend_1.sha256)(JSON.stringify(records));
}
function completedResultsCacheDigest(run, task) {
    if (task.resultCache?.includeCompletedResults !== "previous-phases")
        return "";
    return previousPhaseResultsDigest(run, task);
}
function writeResultCache(file, content) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    node_fs_1.default.writeFileSync(tmp, content, "utf8");
    node_fs_1.default.renameSync(tmp, file);
}
/** Advance ONE concurrent ROUND: fulfill up to `limit` ready tasks in the first
 *  runnable phase as a single batch, recording results in DETERMINISTIC task
 *  order (the existing phase/dispatch order) regardless of completion order — so
 *  replay stays byte-stable. Reuses processSelectedTask per worker, so the red
 *  line holds: each task is still an out-of-process agent delegation, never an
 *  in-CW model call. Track 2: the batch's agent children run CONCURRENTLY in
 *  wall-clock (one batch delegate child; per-job timeout kill), then results are
 *  recorded in DETERMINISTIC task order through the same processSelectedTask —
 *  collect-all: a failed/hung/dirty hop never aborts its siblings, every hop
 *  settles and is recorded (failures park via the same retryOrPark). */
function driveConcurrentRound(ctx, limit) {
    const run = ctx.runner.loadRun(ctx.runId);
    const selected = selectDriveTask(run);
    const gate = terminalOrConfigStep(ctx, run, selected);
    if (gate)
        return [gate];
    const phase = (0, dispatch_1.firstRunnablePhase)(run);
    const width = Math.max(1, Math.floor(limit) || 1);
    const batch = run.tasks
        .filter((task) => phase.taskIds.includes(task.id) && (task.status === "pending" || task.status === "running"))
        .slice(0, width)
        .map((task) => task.id);
    // Phase A+B: dispatch every batch task (sequential — dispatch mutates state),
    // then collect ALL spawn-style child outcomes in one concurrent window. The
    // token-budget gate ran at round entry; it is NOT re-checked between accepts —
    // the spawns already happened, and refusing to RECORD finished work would
    // discard real results (collect-all + never-claw-back). Overshoot is bounded
    // by the round width; the next round blocks.
    const prepared = prepareConcurrentOutcomes(ctx, batch);
    // Phase C: settle + accept in deterministic batch order, regardless of the
    // wall-clock order the children finished in.
    const steps = [];
    for (const taskId of batch) {
        const failStep = prepared.failSteps.get(taskId);
        if (failStep) {
            steps.push(failStep);
            continue;
        }
        // Re-read per task: a prior accept in this round mutated state.
        const freshRun = ctx.runner.loadRun(ctx.runId);
        const fresh = freshRun.tasks.find((task) => task.id === taskId);
        if (!fresh || (fresh.status !== "pending" && fresh.status !== "running"))
            continue;
        steps.push(processSelectedTask(ctx, fresh, prepared.outcomes.get(taskId)));
    }
    return steps.length > 0 ? steps : [driveStep(ctx)];
}
/** Dispatch each batch task and run every spawn-style agent child concurrently
 *  (one batch delegate child, per-job timeout kill). Returns outcomes keyed by
 *  task id; endpoint-configured agents get no outcome and settle through the
 *  serial (sequential) path inside the accept loop. Dispatch failures become
 *  recorded fail steps, exactly what the serial path would emit. */
function prepareConcurrentOutcomes(ctx, batch) {
    const { runner, runId } = ctx;
    const failSteps = new Map();
    const jobs = [];
    const jobTaskIds = [];
    for (const taskId of batch) {
        const run = runner.loadRun(runId);
        const task = run.tasks.find((candidate) => candidate.id === taskId);
        if (!task || (task.status !== "pending" && task.status !== "running"))
            continue;
        let workerId = task.workerId;
        if (task.status === "pending") {
            const manifest = runner.dispatch(runId, { limit: 1, backend: task.agentType || "agent" });
            const dispatchedTask = manifest.tasks.find((entry) => entry.id === task.id) || manifest.tasks[0];
            if (!dispatchedTask || !dispatchedTask.workerId) {
                failSteps.set(taskId, step("dispatch", "failed", { runId, taskId, phase: task.phase, reason: "dispatch produced no worker scope" }));
                continue;
            }
            workerId = dispatchedTask.workerId;
        }
        if (!workerId) {
            failSteps.set(taskId, step("dispatch", "failed", { runId, taskId, phase: task.phase, reason: "no worker scope for task" }));
            continue;
        }
        const manifest = runner.showWorkerManifest(runId, workerId);
        const cachePath = resultCachePath(run, task, (0, execution_backend_1.sha256)(task.prompt), ctx.incremental, ctx.incremental ? incrementalDelegationDigest(task, manifest, ctx.config) : "");
        if (cachePath && node_fs_1.default.existsSync(cachePath))
            continue;
        const job = (0, execution_backend_1.prepareAgentSpawn)(buildAgentRequest(ctx, run, task, manifest));
        if (job) {
            jobs.push(job);
            jobTaskIds.push(taskId);
        }
    }
    if (jobs.length) {
        emitProgress(`⇉ concurrent round: ${jobs.length} agent${jobs.length > 1 ? "s" : ""} spawning in parallel, may take minutes…`);
    }
    const settled = (0, execution_backend_1.runAgentBatchOutcomes)(jobs);
    const outcomes = new Map();
    jobTaskIds.forEach((taskId, index) => outcomes.set(taskId, settled[index]));
    return { outcomes, failSteps };
}
/** A failed agent hop: charge one attempt and (reuse v0.1.37 retryOrPark) either
 *  retry on the SAME worker scope next step, or PARK past the retry budget. */
function handleHop(ctx, task, workerId, reason) {
    const persisted = ctx.runner.showWorker(ctx.runId, workerId).retryCount || 0;
    const prior = Math.max(ctx.attempts.get(task.id) || 0, persisted);
    const entry = {
        schemaVersion: 1,
        id: task.id,
        repo: ctx.runner.loadRun(ctx.runId).cwd,
        priority: 0,
        enqueuedAt: ctx.now,
        status: "ready",
        attempts: prior
    };
    const decided = (0, scheduling_1.retryOrPark)(entry, ctx.policy, ctx.now, reason);
    ctx.attempts.set(task.id, decided.attempts || prior + 1);
    if (decided.status === "parked") {
        const attempts = decided.attempts || prior + 1;
        // Terminal: record the failure so the worker/task carries the park reason and
        // the phase gate stops advancing it. Never silently re-driven.
        ctx.runner.recordWorkerFailure(ctx.runId, workerId, decided.parkedReason || reason, {
            code: "agent-delegation-parked",
            retryable: false,
            retryCount: attempts
        });
        return step("park", "parked", {
            runId: ctx.runId,
            taskId: task.id,
            phase: task.phase,
            backendId: "agent",
            attempts,
            reason: decided.parkedReason || reason
        });
    }
    // Retryable: leave the task running (scope reused) for the next step.
    (0, worker_isolation_1.recordWorkerRetryAttempt)(ctx.runner.loadRun(ctx.runId), workerId, decided.attempts || prior + 1, reason);
    return step("fulfill", "failed", {
        runId: ctx.runId,
        taskId: task.id,
        phase: task.phase,
        backendId: "agent",
        attempts: decided.attempts,
        reason
    });
}
function step(action, status, fields) {
    return { schemaVersion: 1, action, status, ...fields };
}
function errMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Render a sub-workflow's input templates against the PARENT run's inputs, so the
 *  child inputs are a pure function of recorded parent inputs (deterministic). */
function renderSubInputs(spec, parentInputs) {
    const out = {};
    for (const [key, template] of Object.entries(spec.inputs || {})) {
        out[key] = String(template).replace(/\{\{(\w+)\}\}/g, (_, name) => String(parentInputs[name] ?? ""));
    }
    return out;
}
/** Fulfill a sub-workflow task: plan + drive a CHILD run, then bind its report (or
 *  verdict result) back as the parent task's result through the SAME accept path, so
 *  the parent's verifier/schema/evidence gate and downstream tasks treat it like any
 *  other result. Fail-closed: bounded recursion + cycle detection BEFORE any child
 *  state is minted; a child that does not complete parks the parent hop. The child's
 *  own telemetry/audit live in the child run; the parent records ONE honest
 *  `worker.sub-workflow` cross-link (child run id + report digest + child audit
 *  verdict) — nothing is summed or fabricated. */
function runSubWorkflow(ctx, run, selected, workerId, manifest) {
    const spec = selected.subWorkflow;
    const parentApp = run.workflow.id;
    // Fail-closed BEFORE planning a child (no child state minted when refused).
    if (ctx.depth + 1 > exports.MAX_SUB_WORKFLOW_DEPTH) {
        return handleHop(ctx, selected, workerId, `sub-workflow depth limit exceeded (> ${exports.MAX_SUB_WORKFLOW_DEPTH})`);
    }
    // Include the CURRENT app on the path, so a direct self-cycle (A→A) is caught at
    // depth 0 — before any child run dir is minted.
    if ([...ctx.visitedAppIds, parentApp].includes(spec.appId)) {
        return handleHop(ctx, selected, workerId, `sub-workflow cycle detected: ${[...ctx.visitedAppIds, parentApp, spec.appId].join(" -> ")}`);
    }
    // Deterministic child run id derived from the parent run + task (no clock/random).
    const childRunId = `sub-${run.id}-${(0, state_1.safeFileName)(selected.id)}`;
    const childInputs = {
        repo: run.inputs.repo ?? run.cwd,
        cwd: run.cwd,
        question: run.inputs.question ?? "",
        ...renderSubInputs(spec, run.inputs),
        runId: childRunId
    };
    emitProgress(`⧉ ${selected.label || selected.id} (${selected.phase}) — sub-workflow ${spec.appId}…`);
    let childRun;
    try {
        childRun = ctx.runner.plan(spec.appId, childInputs);
    }
    catch (error) {
        return handleHop(ctx, selected, workerId, `sub-workflow plan failed (${spec.appId}): ${errMessage(error)}`);
    }
    const childResult = drive(ctx.runner, childRun.id, {
        now: ctx.now,
        agentConfig: ctx.config,
        policy: ctx.policy,
        incremental: ctx.incremental,
        depth: ctx.depth + 1,
        visitedAppIds: [...ctx.visitedAppIds, parentApp]
    });
    if (childResult.status !== "complete") {
        return handleHop(ctx, selected, workerId, `sub-workflow ${spec.appId} did not complete (status: ${childResult.status})`);
    }
    // Bind the child's bytes: the rendered report (default) or the verdict result.
    const finalChild = ctx.runner.loadRun(childRun.id);
    let childBytes;
    if (spec.bindResult === "verdict-result") {
        const verdict = finalChild.tasks.find((t) => /^verdict[:/]|^synthesis[:/]/i.test(t.id) && t.status === "completed");
        childBytes = verdict?.resultPath && node_fs_1.default.existsSync(verdict.resultPath) ? node_fs_1.default.readFileSync(verdict.resultPath, "utf8") : undefined;
    }
    else {
        childBytes = node_fs_1.default.existsSync(finalChild.paths.report) ? node_fs_1.default.readFileSync(finalChild.paths.report, "utf8") : undefined;
    }
    if (childBytes === undefined) {
        return handleHop(ctx, selected, workerId, `sub-workflow ${spec.appId} produced no ${spec.bindResult || "report"}`);
    }
    // Accept through the SAME path as any other result (verifier/schema/evidence gate).
    try {
        node_fs_1.default.writeFileSync(manifest.resultPath, childBytes, "utf8");
        ctx.runner.recordWorkerOutput(run.id, workerId, manifest.resultPath, {});
    }
    catch (error) {
        return handleHop(ctx, selected, workerId, `sub-workflow result rejected by parent gate: ${errMessage(error)}`);
    }
    // Honest cross-link (provenance only — never fails the accepted hop): one
    // worker.sub-workflow audit event on the parent pins the child run + report digest
    // + the child's own audit-chain verdict, and the task points at the child run dir.
    try {
        const afterAccept = ctx.runner.loadRun(run.id);
        const task = afterAccept.tasks.find((t) => t.id === selected.id);
        const childAudit = (0, trust_audit_1.verifyTrustAudit)(finalChild);
        (0, trust_audit_1.recordTrustAuditEvent)(afterAccept, {
            kind: "worker.sub-workflow",
            decision: "recorded",
            source: "runtime-derived",
            workerId,
            taskId: selected.id,
            nodeId: task?.resultNodeId,
            metadata: {
                subWorkflowAppId: spec.appId,
                subRunId: childRun.id,
                childReportDigest: (0, execution_backend_1.sha256)(childBytes),
                childAuditVerified: childAudit.verified,
                bindResult: spec.bindResult || "report"
            }
        });
        if (task) {
            task.subRunId = childRun.id;
            task.subRunDir = finalChild.paths.runDir;
        }
        (0, state_1.saveCheckpoint)(afterAccept);
    }
    catch {
        /* the cross-link is provenance; a failure here must not undo an accepted hop */
    }
    return step("accept", "ok", {
        runId: run.id,
        taskId: selected.id,
        phase: selected.phase,
        handleKind: "sub-workflow",
        reason: `sub-workflow ${spec.appId} → ${childRun.id}`
    });
}
/** Drive a run: `--once` advances exactly one step; otherwise run to completion,
 *  park, or a blocked stop. Composes the existing verbs + the agent backend only. */
function drive(runner, runId, options = {}) {
    const now = options.now || new Date().toISOString();
    const policy = (0, scheduling_1.normalizeSchedulingPolicy)(options.policy || scheduling_1.DEFAULT_SCHEDULING_POLICY);
    const config = options.agentConfig || (0, agent_config_1.resolveAgentConfig)(options.args || {});
    const ctx = {
        runner, runId, now, policy, config, attempts: new Map(),
        incremental: Boolean(options.incremental),
        depth: Math.max(0, Math.floor(options.depth || 0)),
        visitedAppIds: options.visitedAppIds || []
    };
    const steps = [];
    const run0 = runner.loadRun(runId);
    const plannedWorkers = run0.tasks.length;
    // Safety bound: every worker, every retry, plus the terminal commit + slack. Each
    // concurrent round retires >=1 worker, so this bounds rounds too. A bounded dynamic
    // loop can append up to (maxRounds-1)×templateTasks MORE tasks at runtime, so the
    // iteration bound (NOT plannedWorkers, which stays the initial count for status) adds
    // the worst-case expansion derived STATICALLY from the declaration — a pure function
    // of the workflow, never of runtime results — so the bound is replay-stable and the
    // drive is provably terminating; it reduces to the original value when there are no
    // loop phases.
    const maxIterations = (plannedWorkers + (0, loop_expansion_1.maxLoopExpansion)(run0)) * (policy.maxAttempts + 1) + 5;
    const concurrency = Math.max(1, Math.floor(options.concurrency || 1));
    // The parallel() on-ramp: a phase authored with mode "parallel" is fulfilled
    // concurrently through EVERY shipping surface (run --drive, quickstart) — no
    // hidden option required. Width = the phase's task count bounded by
    // limits.maxConcurrentAgents; an explicit options.concurrency still overrides
    // (tests, operator tuning). Re-derived per round: phases differ.
    const autoWidth = (run) => {
        const phase = (0, dispatch_1.firstRunnablePhase)(run);
        if (!phase || phase.mode !== "parallel")
            return 1;
        const cap = Math.max(1, Math.floor(run.workflow.limits?.maxConcurrentAgents || 1));
        return Math.max(1, Math.min(cap, phase.taskIds.length));
    };
    // Phase-boundary progress (brew-style): announce each phase when it becomes active
    // and when it finishes — `==> Map ✓ (6/6)` / `==> Assess … (3/6)`. Describes CW's OWN
    // phases (vendor-neutral); goes to stderr via emitProgress so stdout stays clean data.
    const announcedPhaseComplete = new Set();
    let activePhaseId;
    const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    const emitPhaseProgress = (run) => {
        for (const ph of run.phases || []) {
            const phaseTasks = run.tasks.filter((task) => ph.taskIds.includes(task.id));
            const total = phaseTasks.length;
            if (total === 0)
                continue;
            const done = phaseTasks.filter((task) => task.status === "completed").length;
            const label = titleCase(ph.name || ph.id);
            if (done >= total) {
                if (!announcedPhaseComplete.has(ph.id)) {
                    announcedPhaseComplete.add(ph.id);
                    emitProgress((0, term_1.phaseProgressLine)(label, done, total, ph.mode, process.stderr));
                }
                continue;
            }
            if (ph.id !== activePhaseId) {
                activePhaseId = ph.id;
                emitProgress((0, term_1.phaseProgressLine)(label, done, total, ph.mode, process.stderr));
            }
            return; // only the first not-yet-complete phase is "active"
        }
    };
    for (let i = 0; i < maxIterations; i++) {
        const width = concurrency > 1 ? concurrency : autoWidth(runner.loadRun(runId));
        const roundSteps = width > 1 ? driveConcurrentRound(ctx, width) : [driveStep(ctx)];
        for (const stepResult of roundSteps) {
            steps.push(stepResult);
            emitProgress([
                `${steps.length}.`,
                stepResult.action,
                stepResult.status,
                stepResult.taskId || "",
                stepResult.reportedModel ? `model=${stepResult.reportedModel}` : "",
                stepResult.reason ? `— ${stepResult.reason}` : ""
            ]
                .filter(Boolean)
                .join(" "));
        }
        // Brew-style phase boundaries: after each round, announce a newly-active phase and
        // any phase that just finished (`==> Map ✓ (6/6)` / `==> Assess … (3/6)`). Cheap —
        // reuses the run we just advanced; goes to stderr via emitProgress so stdout is clean.
        emitPhaseProgress(runner.loadRun(runId));
        const last = roundSteps[roundSteps.length - 1];
        if (options.once)
            break;
        if (last && (last.status === "complete" || last.status === "parked" || last.status === "blocked"))
            break;
    }
    const run = runner.loadRun(runId);
    const completedWorkers = countCompleted(run);
    const parkedWorkers = countParked(run);
    const committed = (run.commits || []).find((commit) => commit.reason && commit.reason.startsWith("agent-delegation-drive"));
    const last = steps[steps.length - 1];
    const status = options.once
        ? completedWorkers === plannedWorkers && committed
            ? "complete"
            : last && (last.status === "parked" || last.status === "blocked")
                ? last.status
                : "in-progress"
        : parkedWorkers > 0 || (last && last.status === "parked")
            ? "parked"
            : last && last.status === "blocked"
                ? "blocked"
                : "complete";
    return {
        schemaVersion: 1,
        runId,
        workflowId: run.workflow.id,
        status,
        steps,
        plannedWorkers,
        completedWorkers,
        parkedWorkers,
        commitId: committed?.id,
        reportPath: run.paths.report,
        statePath: run.paths.state,
        agentConfigured: agentConfigured(config)
    };
}
/** Read-only, deterministic preview of the NEXT drive step for a run — no mutation,
 *  no spawn. Counts come from state; safe for CLI<->MCP payload parity. */
function drivePreview(runner, runId, args = {}) {
    const run = runner.loadRun(runId);
    const config = (0, agent_config_1.resolveAgentConfig)(args);
    const configured = agentConfigured(config);
    const selected = selectDriveTask(run);
    const plannedWorkers = run.tasks.length;
    const pendingWorkers = run.tasks.filter((task) => task.status === "pending" || task.status === "running").length;
    const completedWorkers = countCompleted(run);
    const parkedWorkers = countParked(run);
    let nextAction;
    if (!selected) {
        nextAction = run.tasks.every((task) => task.status === "completed") ? "commit" : "blocked";
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
    return {
        schemaVersion: 1,
        runId,
        workflowId: run.workflow.id,
        plannedWorkers,
        pendingWorkers,
        completedWorkers,
        parkedWorkers,
        nextAction,
        nextTaskId: selected?.id,
        nextPhase: selected?.phase,
        agentConfigured: configured
    };
}
