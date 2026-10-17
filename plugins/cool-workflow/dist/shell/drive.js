// shell/drive.ts — the thin imperative loop that calls drive-decide.ts
// once per step and performs the spawn/commit/cache-write IO the
// decision names; the pure decision core is core/pipeline/drive-decide.ts.
// The concurrent-round driver (driveConcurrentRound, below) dispatches and
// settles a whole round's tasks in one batch (see `--concurrency`/
// `roundWidth`), pinned by v2/conformance/cases/pipeline-concurrent-round.case.mjs.
//
// Evidence: SPEC/pipeline-run.md "Drive loop — drive module".
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { DEFAULT_SCHEDULING_POLICY, countCompleted, countParked, exitCodeFromEvidence, finalDriveStatus, hasTerminalCommit, hopRetryLine, makeStep, maxIterations, priorAttempts, reopenableParkedTaskIds, retryOrPark, roundWidth, selectDriveTask, terminalOrConfigStep, incrementalCacheKey, incrementalDelegationDigest, defaultCacheKey, cacheFileName, MAX_SUB_WORKFLOW_DEPTH, } from "../core/pipeline/drive-decide.js";
import { maxLoopExpansion, evaluateLoopStop, cloneLoopRoundTasks, loopControlNodeId, } from "../core/pipeline/loop-expansion.js";
import { firstRunnablePhase, runnableTaskIds, updatePhaseStatuses } from "../core/pipeline/dispatch.js";
import { loadRunFromCwd, saveCheckpoint, savedRunIfCurrent, withDriveLock, withDriveLockAsync, resolveRunDir, runStateIsCurrent, RunStateConflictError } from "./run-store.js";
import { createDispatchManifest } from "./dispatch.js";
import { showWorkerManifest, recordWorkerOutput, recordWorkerFailure, recordWorkerRetryAttempt, getWorkerScope, reopenParkedWorker } from "./worker-isolation.js";
import { validateSandboxWrite } from "./sandbox-profile.js";
import { createStateNode } from "../core/state/state-node.js";
import { appendRunNode } from "./node-store.js";
import { runPipelineStage } from "../core/pipeline/runner.js";
import { writeTaskFiles } from "./harness.js";
import { phaseProgressLine } from "./term.js";
import { commitState, CommitGateError } from "./commit.js";
import { writeReport } from "./report.js";
import { recordTrustAuditEvent, verifyTrustAudit, withTrustAuditBatch } from "./trust-audit.js";
import { resolveAgentConfig } from "./agent-config.js";
import { runBackend } from "./execution-backend/registry.js";
import { stripSecretArgs, prepareAgentSpawn, runAgentBatchOutcomes, buildAgentChildEnv, prepareEndpointJob, runEndpointBatchOutcomes } from "./execution-backend/agent.js";
import { sha256, stableStringify } from "../core/hash.js";
import { stableCompare } from "../core/util/collate.js";
import { plan } from "./pipeline.js";
import { reporter } from "./reporter.js";
import { safeFileName } from "./fs-atomic.js";
import { deriveUsageTotals } from "./observability.js";
import { normalizeReportedUsage } from "../core/trust/telemetry-attestation.js";
import { withPerfTraceGroup } from "./perf-trace.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
/** Total RECORDED tokens across the run's attested units, reading the
 *  agent-reported usage through normalizeReportedUsage so a hop that
 *  reported snake_case buckets (`input_tokens`/`output_tokens`, the shape
 *  parseAgentReport hands back verbatim) is counted — not silently zeroed.
 *  Reuses deriveUsageTotals' own unit selection (its `rows` are the
 *  deduped attested units) so worker-vs-task double-counting stays fixed;
 *  only the key-reading is corrected here. State keeps the raw
 *  reportedUsage, so the budget count normalizes at read time. */
function recordedTokenTotal(run) {
    let total = 0;
    for (const row of deriveUsageTotals(run).rows) {
        const usage = row.usage;
        if (!usage)
            continue;
        const declared = usage.totalTokens;
        if (typeof declared === "number") {
            total += declared;
            continue;
        }
        const n = normalizeReportedUsage(usage);
        if (typeof n.totalTokens === "number")
            total += n.totalTokens;
        else
            total += (n.inputTokens || 0) + (n.outputTokens || 0);
    }
    return total;
}
/** Token-budget gate input: enforce limits.tokenBudget against RECORDED usage,
 *  not a hardcoded zero. Returns undefined when no positive budget is set so the
 *  gate is a no-op. Spent = the run's total recorded tokens. */
function tokenBudgetUsage(run) {
    const budget = run.workflow.limits?.tokenBudget;
    if (!budget || budget <= 0)
        return undefined;
    return { spent: recordedTokenTotal(run), budget };
}
export { DRIVE_SCHEMA_VERSION, MAX_SUB_WORKFLOW_DEPTH } from "../core/pipeline/drive-decide.js";
function agentConfigured(config) {
    return Boolean(config.command || config.endpoint);
}
/** Progress to STDERR (stdout stays clean JSON). On by default when
 *  stderr is a TTY; silent in CI/pipes. CW_DRIVE_PROGRESS=0 forces off,
 *  =1 forces on. This is gate point #2 of the Rule of Silence's three
 *  gate points. */
function progressEnabled() {
    const forcedOff = process.env.CW_DRIVE_PROGRESS === "0";
    const forcedOn = process.env.CW_DRIVE_PROGRESS === "1";
    return (Boolean(process.stderr.isTTY) && !forcedOff) || forcedOn;
}
function emitProgress(message) {
    if (progressEnabled())
        reporter.progress(`[drive] ${message}`);
}
/** The `→ <label> (<phase>) — spawning agent` line, one text for the serial
 *  path and the concurrent round (which prints it at round start). */
function spawningAgentLine(task, dispatched) {
    return `→ ${task.label || task.id} (${task.phase}) — ${dispatched ? "dispatched, " : ""}spawning agent, may take minutes…`;
}
// A sign of life while a round waits on its agents: every agent wait is a
// spawnSync, so this process cannot print until the round ends. A small
// separate process (scripts/children/drive-ticker.mjs) prints
// `[drive]   … <Phase> still working — 20s` to the inherited stderr every
// CW_DRIVE_TICK_MS (default 10000) and is stopped when the round ends. Only
// when [drive] progress is on (a TTY, or CW_DRIVE_PROGRESS=1), so a piped
// run's bytes do not change; CW_DRIVE_TICK_MS=0 turns it off.
const DRIVE_TICKER_SCRIPT = path.resolve(import.meta.dirname, "..", "..", "scripts", "children", "drive-ticker.mjs");
function withDriveTicker(label, fn) {
    const rawInterval = process.env.CW_DRIVE_TICK_MS;
    const intervalMs = rawInterval === undefined || rawInterval === "" ? 10000 : Number(rawInterval);
    if (!progressEnabled() || !Number.isFinite(intervalMs) || intervalMs <= 0)
        return fn();
    let ticker;
    try {
        ticker = spawn(process.execPath, [DRIVE_TICKER_SCRIPT, label, String(Math.floor(intervalMs)), String(process.pid)], {
            stdio: ["ignore", "ignore", "inherit"],
        });
        ticker.on("error", () => { });
        ticker.unref();
    }
    catch {
        ticker = undefined;
    }
    try {
        return fn();
    }
    finally {
        try {
            ticker?.kill("SIGTERM");
        }
        catch { /* already gone */ }
    }
}
// A concurrent round runs many dispatch/accept steps against ONE shared
// in-memory run object, deferring every disk write to a single flush at
// round end (see driveConcurrentRound below). loadRun(ctx) is the single
// choke point every step reads through, so the cache lives here: while a
// round is active for a given run id, loadRun returns the SAME mutated
// object instead of re-reading (necessarily stale) disk state. Keyed by
// run id (not a stack) so a sub-workflow task's nested drive() call on a
// DIFFERENT run id is unaffected (re-entrant). A module-level map, as
// there is no long-lived "runner" object to hang it on.
const roundCache = new Map();
function loadRun(ctx) {
    const cached = roundCache.get(ctx.runId);
    if (cached)
        return cached;
    return loadRunFromCwd(ctx.runId, ctx.cwd);
}
/** Runs `fn` with `runId`'s loadRun calls served from one shared cached
 *  object (seeded fresh from disk), and always clears the cache entry
 *  afterward — even on throw — so a round never leaks its cache into a
 *  later, unrelated drive call. Re-entrant: a nested call (e.g. the
 *  serial drive loop's own round-cache wrapping a driveStep that itself
 *  runs inside a caller's round cache) reuses the outer seed instead of
 *  re-reading disk, and only the OUTERMOST call clears the entry — so
 *  nesting never re-reads a run mid-round nor drops the cache early out
 *  from under an enclosing scope. */
function withRoundCache(ctx, fn) {
    const alreadyActive = roundCache.has(ctx.runId);
    if (!alreadyActive)
        roundCache.set(ctx.runId, seedRun(ctx));
    try {
        return fn();
    }
    finally {
        if (!alreadyActive)
            roundCache.delete(ctx.runId);
    }
}
/** Every drive save: refuse (RunStateConflictError) rather than write over
 *  a state.json another process saved after this drive loaded or saved it
 *  — a round holds its copy for as long as its agents run, while `cw result`
 *  or `cw commit` may save the same run (lost update, fail closed). */
const DRIVE_SAVE = { ifUnchanged: true };
/** After a long wait (an agent spawn, a sub-workflow drive), the round's run
 *  as it is on disk now: the same object when no one wrote state.json since
 *  this process loaded or saved it (a stat, no read — the single-writer path
 *  is unchanged), else a fresh load that also replaces the round cache, so
 *  the drive's own change goes on top of the other writer's. Only call it
 *  where the held copy has no unsaved change of its own. */
function refreshRun(ctx, run) {
    if (runStateIsCurrent(run))
        return run;
    const fresh = loadRunFromCwd(ctx.runId, ctx.cwd);
    if (roundCache.has(ctx.runId))
        roundCache.set(ctx.runId, fresh);
    return fresh;
}
/** The task `taskId` of a refreshed run, still the one this drive's agent
 *  worked as `workerId`; refuses when another writer settled or moved it
 *  meanwhile (never two results for one task, never a silent drop). */
function stillOwnedTask(run, taskId, workerId) {
    const task = run.tasks.find((t) => t.id === taskId);
    if (!task || task.status !== "running" || task.workerId !== workerId) {
        throw new RunStateConflictError(run.id);
    }
    return task;
}
/** The run a new round starts from. When the last round's run is still
 *  exactly what state.json holds (this process's last save wrote that
 *  very object, and the file's stamp has not moved since, so no other
 *  writer has touched it), the round goes on with it instead of reading
 *  back what it just wrote. Anything else reads from disk, as before.
 *  CW_STATE_REUSE_VERIFY=1 (tests only) also reads from disk and throws
 *  on any difference. */
function seedRun(ctx) {
    const previous = ctx.lastRoundRun;
    if (previous && savedRunIfCurrent(path.join(ctx.cwd, ".cw", "runs", ctx.runId, "state.json")) === previous) {
        if (process.env.CW_STATE_REUSE_VERIFY === "1" && !isDeepStrictEqual(previous, loadRunFromCwd(ctx.runId, ctx.cwd))) {
            throw new Error(`state reuse differs from state.json for run ${ctx.runId}`);
        }
        return previous;
    }
    return loadRunFromCwd(ctx.runId, ctx.cwd);
}
function resultCachePath(run, task, promptDigest, incremental, delegationDigest) {
    let digest;
    if (incremental) {
        const upstream = previousPhaseResultsDigest(run, task);
        digest = incrementalCacheKey(run.workflow.id, task.id, promptDigest, sha256(stableStringify(run.inputs || {})), delegationDigest, upstream);
    }
    else {
        const policy = task.resultCache;
        if (!policy || policy.mode !== "read-write" || !policy.keyInput)
            return undefined;
        const keyValue = String(run.inputs[policy.keyInput] || "").trim();
        // When the task injects completed upstream results into its input (see
        // worker-isolation.ts collectPreviousPhaseResults), the same results must
        // bind the cache key — otherwise a warm hit keyed only on the source digest
        // could serve a verdict computed against DIFFERENT upstream findings and
        // re-drop a confirmed risk. previousPhaseResultsDigest returns undefined
        // when any upstream is incomplete, so defaultCacheKey then declines to cache
        // (fail closed), matching the injection's own fail-closed rule.
        const completedResultsDigest = policy.includeCompletedResults === "previous-phases"
            ? previousPhaseResultsDigest(run, task)
            : "";
        digest = defaultCacheKey(run.workflow.id, task.id, policy.keyInput, keyValue, promptDigest, completedResultsDigest);
    }
    if (!digest)
        return undefined;
    return path.join(run.cwd, ".cw", "cache", "worker-results", safeFileName(run.workflow.id), cacheFileName(task.id, digest));
}
function previousPhaseResultsDigest(run, task) {
    const phaseIndex = run.phases.findIndex((p) => p.name === task.phase || p.id === task.phase);
    if (phaseIndex < 0)
        return undefined;
    const previousTaskIds = new Set(run.phases.slice(0, phaseIndex).flatMap((p) => p.taskIds));
    const records = [];
    // stableCompare (not a bare localeCompare): this order feeds the sha256
    // digest below, which feeds the incremental cache key — a host-locale-
    // dependent order would silently move the cache key across machines.
    for (const candidate of run.tasks.filter((t) => previousTaskIds.has(t.id)).sort((a, b) => stableCompare(a.id, b.id))) {
        if (candidate.status !== "completed" || !candidate.resultPath || !fs.existsSync(candidate.resultPath)) {
            records.push(undefined);
            continue;
        }
        records.push([candidate.id, sha256(fs.readFileSync(candidate.resultPath, "utf8"))]);
    }
    if (records.some((r) => r === undefined))
        return undefined;
    return sha256(JSON.stringify(records));
}
/** Check a worker's result.md BEFORE the drive itself writes it (a cache
 *  hit or a sub-workflow result), as `cw result` does before its copy: a
 *  result.md left as a symlink would make the write go through it, outside
 *  the boundary. recordWorkerOutput checks the path again after the write. */
function assertResultWritable(manifest, workerId) {
    const violation = manifest.sandboxPolicy ? validateSandboxWrite(manifest.sandboxPolicy, manifest.resultPath, workerId) : null;
    if (violation)
        throw new Error(violation.message);
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
    const scope = getWorkerScope(run, workerId);
    const persisted = scope?.retryCount || 0;
    const prior = priorAttempts(ctx.attempts.get(task.id) || 0, persisted);
    const decided = retryOrPark(prior, ctx.policy, reason);
    ctx.attempts.set(task.id, decided.attempts);
    if (decided.status === "parked") {
        recordWorkerFailure(run, workerId, decided.parkedReason || reason, { code: "agent-delegation-parked", retryable: false, retryCount: decided.attempts });
        if (!deferPersist)
            saveCheckpoint(run, DRIVE_SAVE);
        return makeStep("park", "parked", { runId: ctx.runId, taskId: task.id, phase: task.phase, backendId: "agent", attempts: decided.attempts, reason: decided.parkedReason || reason });
    }
    recordWorkerRetryAttempt(run, workerId, decided.attempts, reason);
    if (!deferPersist)
        saveCheckpoint(run, DRIVE_SAVE);
    // 0.3.3: say why, and which try comes next (progress lines only).
    emitProgress(hopRetryLine(String(task.label || task.id), task.phase, reason, decided.attempts, ctx.policy));
    return makeStep("fulfill", "failed", { runId: ctx.runId, taskId: task.id, phase: task.phase, backendId: "agent", attempts: decided.attempts, reason });
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
        // One audit lock and one durable write for the dispatch's events, as the
        // concurrent round does; flushed before the dispatch checkpoint below.
        const manifest = withTrustAuditBatch(run, () => createDispatchManifest(run, 1, { backendId: selected.agentType || "agent" }));
        // Advance the RUN-level lifecycle stage on dispatch (run.loopStage =
        // "act"). The operator status "Stage:" line reads run.loopStage, and
        // shell/dispatch.ts advances only the task/node loopStage, never the run's.
        run.loopStage = "act";
        // A successful dispatch is its own checkpoint commit (reason
        // `dispatch:<dispatch-id>`), not just a bare saveCheckpoint — SPEC/
        // pipeline-run.md's persist-ordering section pins this exact reason.
        if (!deferPersist) {
            if (manifest.dispatchId)
                commitState(run, `dispatch:${manifest.dispatchId}`);
            saveCheckpoint(run, DRIVE_SAVE);
        }
        const dispatchedTask = manifest.tasks.find((t) => t.id === selected.id) || manifest.tasks[0];
        if (!dispatchedTask || !dispatchedTask.workerId) {
            return makeStep("dispatch", "failed", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, reason: "dispatch produced no worker scope" });
        }
        workerId = dispatchedTask.workerId;
        dispatched = true;
        run = loadRun(ctx);
        selected = run.tasks.find((t) => t.id === selectedId);
    }
    if (!workerId) {
        return makeStep("dispatch", "failed", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, reason: "no worker scope for task" });
    }
    const manifest = showWorkerManifest(run, workerId);
    // `promptDigest` here is the PER-DISPATCH worker instructions file
    // (input.md) — it embeds this run's own id/dispatch id, so it is
    // NEVER stable across separate runs. It feeds ONLY recordWorkerOutput's
    // agentDelegation telemetry below, never the cache key. The cache key
    // instead digests the task's own static, workflow-authored prompt text
    // (selected.prompt), which IS stable across runs. Two differently-sourced
    // digests, easy to collapse into one by mistake.
    const promptDigest = fs.existsSync(manifest.inputPath) ? sha256(fs.readFileSync(manifest.inputPath, "utf8")) : sha256(manifest.prompt || "");
    const cacheKeyPromptDigest = sha256(selected.prompt || "");
    const delegationDigest = ctx.incremental
        ? incrementalDelegationDigest(selected.model || ctx.config.model || "", selected.agentType || "agent", manifest.sandboxPolicy?.id || selected.sandboxProfileId || "", ctx.config.command || "", ctx.config.args ? stripSecretArgs(ctx.config.args) : [], ctx.config.endpoint || "")
        : "";
    const cachePath = resultCachePath(run, selected, cacheKeyPromptDigest, ctx.incremental, delegationDigest);
    if (cachePath && fs.existsSync(cachePath)) {
        emitProgress(`↺ ${selected.label || selected.id} (${selected.phase}) — accepting cached result`);
        try {
            assertResultWritable(manifest, workerId);
            fs.writeFileSync(manifest.resultPath, fs.readFileSync(cachePath, "utf8"), "utf8");
            withTrustAuditBatch(run, () => {
                // Not gated by requireAttestedTelemetry here: the underlying result was
                // already gated (attested or explicitly overridden) at its FIRST
                // acceptance, before it was cached. Re-blocking a cache hit would only
                // punish the operator for their own earlier, already-audited accept.
                // Still made visible, not silent: when the operator requires attested
                // telemetry, record that this particular accept came from the cache
                // rather than a freshly re-verified hop.
                recordWorkerOutput(run, workerId, manifest.resultPath);
                if (ctx.config.requireAttestedTelemetry) {
                    recordTrustAuditEvent(run, {
                        kind: "telemetry.cache-accept",
                        decision: "recorded",
                        source: "cw-validated",
                        workerId,
                        taskId: selected.id,
                        metadata: { reason: "result-cache hit; original attestation gate applied at first acceptance, not re-verified here" },
                    });
                }
                // Advance the run lifecycle stage on accept (run.loopStage = "observe").
                run.loopStage = "observe";
                // Bounded dynamic loops: after a round's tasks complete, evaluate the
                // predicate and either append the next round or mark the loop done —
                // folded into this same worker:<id>:result checkpoint (no-op otherwise).
                maybeExpandLoop(run);
            });
            // An accepted result is its own checkpoint commit (reason
            // `worker:<worker-id>:result`), not just a bare saveCheckpoint.
            if (!deferPersist) {
                commitState(run, `worker:${workerId}:result`);
                saveCheckpoint(run, DRIVE_SAVE);
            }
        }
        catch (error) {
            return handleHop(ctx, selected, workerId, `result cache rejected: ${errMessage(error)}`, deferPersist, deferPersist ? run : undefined);
        }
        return makeStep("accept", "ok", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, handleKind: "result-cache", reason: "result cache hit" });
    }
    const subWorkflow = selected.subWorkflow;
    if (subWorkflow) {
        emitProgress(`⧉ ${selected.label || selected.id} (${selected.phase}) — sub-workflow ${subWorkflow.appId}…`);
        return runSubWorkflow(ctx, run, selected, workerId, manifest, subWorkflow, deferPersist);
    }
    // A concurrent round printed this line at round start, when the agent was
    // spawned (prepareConcurrentOutcomes); here it only settles the outcome.
    if (!preparedOutcome)
        emitProgress(spawningAgentLine(selected, dispatched));
    const envelope = runBackend({
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
    // The agent ran for as long as it took; `cw result` / `cw commit` may have
    // saved this run meanwhile. Settle onto what is on disk now (serial path:
    // the held copy has nothing unsaved; a concurrent round refreshes before
    // its settlement instead, in prepareConcurrentOutcomes).
    if (!deferPersist) {
        const fresh = refreshRun(ctx, run);
        if (fresh !== run) {
            run = fresh;
            selected = stillOwnedTask(run, selectedId, workerId);
        }
    }
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
        // One audit lock and one durable write for the accept's events, flushed
        // before the result checkpoint below (and before any save inside it).
        withTrustAuditBatch(run, () => {
            recordWorkerOutput(run, workerId, manifest.resultPath, {
                agentDelegation: {
                    handle: handle,
                    model: reportedModel,
                    promptDigest,
                    command: handle?.metadata?.command,
                    args: handle?.metadata?.args || [],
                    exitCode: exitCodeFromEvidence(envelope.evidence),
                    reportedUsage,
                    usageSignature,
                    usageTrustPublicKey: ctx.config.attestPublicKey,
                },
                requireAttestedTelemetry: ctx.config.requireAttestedTelemetry,
            });
            // Advance the run lifecycle stage on accept.
            run.loopStage = "observe";
            // Bounded dynamic loops: the round-boundary check, in this checkpoint.
            maybeExpandLoop(run);
        });
        if (!deferPersist) {
            commitState(run, `worker:${workerId}:result`);
            saveCheckpoint(run, DRIVE_SAVE);
        }
    }
    catch (error) {
        return handleHop(ctx, selected, workerId, `result.md rejected: ${errMessage(error)}`, deferPersist, deferPersist ? run : undefined);
    }
    // Trust visibility (purely additive, no execution-behavior change): when
    // the agent backend forwarded provider-namespace env vars (CW_/ANTHROPIC_/
    // etc.) to the delegated child, record the NAMES (never values) as their
    // own tamper-evident audit event, mirroring the worker.sub-workflow event
    // pattern above. Only ever populated by execution-backend/agent.ts's
    // recordedAgentHandle() — a no-op for every other backend.
    const forwardedEnvVars = handle?.metadata?.forwardedEnvVars || [];
    if (forwardedEnvVars.length) {
        recordTrustAuditEvent(run, {
            kind: "worker.agent-env",
            decision: "delegated",
            source: "runtime-derived",
            workerId,
            taskId: selected.id,
            nodeId: selected.resultNodeId,
            envVars: forwardedEnvVars,
            metadata: { reason: "provider-namespace env vars forwarded from host process env to the delegated agent child" },
        });
    }
    if (cachePath && fs.existsSync(manifest.resultPath)) {
        writeResultCache(cachePath, fs.readFileSync(manifest.resultPath, "utf8"));
    }
    return makeStep("accept", "ok", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, backendId: "agent", handleKind: handle?.kind, reportedModel });
}
function runSubWorkflow(ctx, run, selected, workerId, manifest, spec, deferPersist = false) {
    const parentApp = run.workflow.id;
    if (ctx.depth + 1 > MAX_SUB_WORKFLOW_DEPTH) {
        return handleHop(ctx, selected, workerId, `sub-workflow depth limit exceeded (> ${MAX_SUB_WORKFLOW_DEPTH})`, deferPersist, deferPersist ? run : undefined);
    }
    if ([...ctx.visitedAppIds, parentApp].includes(spec.appId)) {
        return handleHop(ctx, selected, workerId, `sub-workflow cycle detected: ${[...ctx.visitedAppIds, parentApp, spec.appId].join(" -> ")}`, deferPersist, deferPersist ? run : undefined);
    }
    const childRunId = `sub-${run.id}-${safeFileName(selected.id)}`;
    const childInputs = {
        repo: run.inputs.repo ?? run.cwd,
        cwd: run.cwd,
        question: run.inputs.question ?? "",
        ...renderSubInputs(spec, run.inputs),
        runId: childRunId,
    };
    let childRun;
    try {
        const { loadWorkflowApp } = require("./workflow-app-loader.js");
        childRun = plan(loadWorkflowApp(spec.appId), childInputs);
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
        policy: ctx.policy,
    });
    // The child drive can run for minutes: settle onto the run as it is on
    // disk now, as processSelectedTask does after an agent spawn.
    if (!deferPersist) {
        const fresh = refreshRun(ctx, run);
        if (fresh !== run) {
            run = fresh;
            selected = stillOwnedTask(run, selected.id, workerId);
        }
    }
    if (childResult.status !== "complete") {
        return handleHop(ctx, selected, workerId, `sub-workflow ${spec.appId} did not complete (status: ${childResult.status})`, deferPersist, deferPersist ? run : undefined);
    }
    const finalChild = loadRunFromCwd(childRun.id, childRun.cwd);
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
        assertResultWritable(manifest, workerId);
        fs.writeFileSync(manifest.resultPath, childBytes, "utf8");
        recordWorkerOutput(run, workerId, manifest.resultPath);
        // Cross-link the child run onto the parent's delegate task + a tamper-
        // evident `worker.sub-workflow` trust-audit event. subRunId/subRunDir let
        // a reader walk from the parent task to the child run; the audit event
        // binds the child report digest + verification into the parent's hash chain.
        selected.subRunId = childRun.id;
        selected.subRunDir = finalChild.paths.runDir;
        try {
            const childAudit = verifyTrustAudit(finalChild);
            recordTrustAuditEvent(run, {
                kind: "worker.sub-workflow",
                decision: "accepted",
                source: "cw-validated",
                workerId,
                taskId: selected.id,
                nodeId: selected.resultNodeId,
                metadata: {
                    subWorkflowAppId: spec.appId,
                    subRunId: childRun.id,
                    childReportDigest: sha256(childBytes),
                    childAuditVerified: childAudit.verified,
                    bindResult: spec.bindResult || "report",
                },
            });
        }
        catch {
            /* the cross-link is provenance; a failure here must not undo an accepted hop */
        }
        // Advance the run lifecycle stage on accept.
        run.loopStage = "observe";
        // Bounded dynamic loops: evaluate the round boundary in the same
        // checkpoint (no-op unless this task's phase is a loop round).
        maybeExpandLoop(run);
        if (!deferPersist) {
            commitState(run, `worker:${workerId}:result`);
            saveCheckpoint(run, DRIVE_SAVE);
        }
    }
    catch (error) {
        return handleHop(ctx, selected, workerId, `sub-workflow result rejected by parent gate: ${errMessage(error)}`, deferPersist, deferPersist ? run : undefined);
    }
    return makeStep("accept", "ok", { runId: run.id, taskId: selected.id, phase: selected.phase, handleKind: "sub-workflow", reason: `sub-workflow ${spec.appId} → ${childRun.id}` });
}
/** Byte-stable string order for anything that flows into a recorded
 *  loop-control decision (POLA: deterministic across runs/locales). */
function compareBytes(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
/** Bounded dynamic loop expansion — the shell half of the loop runtime.
 *  After a worker result is recorded (mutating `run` in memory), if the
 *  just-completed phase is the LATEST round of a loop whose origin is not
 *  yet done and all that round's tasks completed, evaluate the pure stop
 *  decision (evaluateLoopStop) and either append the next round (clone the
 *  round-1 template tasks into a fresh phase, materialized like plan()
 *  does — task files + a plan-stage node per new task) or mark the loop
 *  done. One deterministic `loop-control` node is recorded per round
 *  boundary — the replay source of truth. No-op when the run has no loop
 *  phases (POLA). Expands at most ONE loop boundary per call; the next
 *  accept handles the next. recordWorkerOutput (shell/worker-isolation.ts)
 *  does not expand, so the drive shell wires it in right after an accept.
 *  Exported so the standalone `cw worker output` CLI verb (worker-cli.ts)
 *  can run the same round-expansion after a hand-recorded accept. */
export function maybeExpandLoop(run) {
    for (const phase of [...run.phases]) {
        const originId = phase.loop ? phase.id : phase.loopOrigin;
        if (!originId)
            continue;
        const origin = run.phases.find((p) => p.id === originId);
        if (!origin || !origin.loop || origin.loopDone)
            continue;
        // Act only from the LATEST round phase of this loop.
        const loopPhases = run.phases.filter((p) => p.id === originId || p.loopOrigin === originId);
        const latest = loopPhases.reduce((a, b) => ((b.loopRound || 1) >= (a.loopRound || 1) ? b : a));
        if (phase.id !== latest.id)
            continue;
        const latestTaskIds = new Set(latest.taskIds);
        const roundTasks = run.tasks.filter((t) => latestTaskIds.has(t.id));
        if (roundTasks.length === 0 || !roundTasks.every((t) => t.status === "completed"))
            continue;
        const round = latest.loopRound || 1;
        const ordered = (tasks) => tasks
            .slice()
            .sort((a, b) => compareBytes(a.id, b.id))
            .map((t) => t.result);
        const roundResults = ordered(roundTasks);
        const loopTaskIds = new Set(loopPhases.flatMap((p) => p.taskIds));
        const allLoopTasks = run.tasks.filter((t) => t.status === "completed" && loopTaskIds.has(t.id));
        const allResults = ordered(allLoopTasks);
        const ctx = {
            round,
            roundResults,
            allResults,
            // budget-target scaling counts RECORDED tokens; read them through the
            // same normalizer the CAP gate uses so a snake_case reportedUsage hop
            // is counted (evaluateLoopStop reads usageTotals.totalTokens).
            usageTotals: { totalTokens: recordedTokenTotal(run) },
            inputs: run.inputs,
        };
        const decision = evaluateLoopStop(origin, round, ctx);
        const until = origin.loop.until;
        // Record the decision under a deterministic id (the replay source of truth).
        appendRunNode(run, createStateNode({
            id: loopControlNodeId(run.id, originId, round),
            kind: "loop-control",
            status: "completed",
            loopStage: "adjust",
            outputs: { round, done: decision.done, atCap: decision.atCap, reason: decision.reason },
            metadata: {
                originPhaseId: originId,
                until: until.kind === "predicate" ? until.ref : `budget-target:${until.target}`,
                round,
                done: decision.done,
                atCap: decision.atCap,
                reason: decision.reason,
            },
        }));
        if (decision.done) {
            origin.loopDone = true;
            return;
        }
        // Expand: clone the ROUND-1 template tasks into a fresh phase appended
        // right after the latest round.
        const nextRound = round + 1;
        const originTaskIds = new Set(origin.taskIds);
        const templateTasks = run.tasks.filter((t) => originTaskIds.has(t.id));
        const { phase: nextPhase, tasks: newTasks } = cloneLoopRoundTasks(origin, templateTasks, nextRound);
        const insertAt = run.phases.findIndex((p) => p.id === latest.id);
        run.phases.splice(insertAt + 1, 0, nextPhase);
        run.tasks.push(...newTasks);
        // Materialize: task files + a plan-stage node per new task (mirrors plan()).
        writeTaskFiles(run);
        const inputNodeId = `${run.id}:input`;
        for (const t of newTasks) {
            const result = runPipelineStage(run, "plan", inputNodeId, {
                outputNodeId: `${run.id}:task:${t.id}`,
                outputStatus: "pending",
                loopStage: "interpret",
                artifacts: [{ id: "task", kind: "markdown", path: t.taskPath }],
                metadata: {
                    workflowId: run.workflow.id,
                    taskId: t.id,
                    phase: t.phase,
                    taskKind: t.kind,
                    requiresEvidence: t.requiresEvidence,
                    sandboxProfileId: t.sandboxProfileId,
                },
            }, { persist: false, persistNode: (r, node) => void appendRunNode(r, node), pathExists: fs.existsSync });
            t.stateNodeId = result.outputNodeId;
        }
        updatePhaseStatuses(run);
        return;
    }
}
/** One deterministic drive step. */
export function driveStep(ctx) {
    const run = loadRun(ctx);
    const selected = selectDriveTask(run);
    const gate = terminalOrConfigStep(run, selected, agentConfigured(ctx.config), tokenBudgetUsage(run));
    if (gate.kind === "commit") {
        // Terminal commit: advance the run lifecycle stage ("checkpoint").
        run.loopStage = "checkpoint";
        let commit;
        try {
            commit = commitState(run, { reason: "agent-delegation-drive: audited verdict committed", ...(gate.verifierNodeId ? { verifierNodeId: gate.verifierNodeId } : { allowUnverifiedCheckpoint: true, verifierGated: false }) }, { reuseOpenGateFailure: true });
        }
        catch (error) {
            // Fail closed, but never out of the drive: the gate's refusal is kept
            // (one failure node + one feedback record, reused on a repeat) and
            // the run stops blocked with the reason, its report and state saved.
            if (!(error instanceof CommitGateError))
                throw error;
            writeReport(run);
            saveCheckpoint(run, DRIVE_SAVE);
            return makeStep("commit", "blocked", { runId: run.id, reason: `final commit blocked: ${error.message}` });
        }
        writeReport(run);
        saveCheckpoint(run, DRIVE_SAVE);
        return makeStep("commit", "complete", { runId: run.id, reason: `committed ${commit.id}` });
    }
    if (gate.step)
        return gate.step;
    return processSelectedTask(ctx, selected.id);
}
/** Dispatch every batch task (sequential — dispatch mutates state), then
 *  collect ALL agent child outcomes in one concurrent window: spawn-style
 *  (CLI-binary) agents through the batch delegate child, and endpoint-mode
 *  agents through the HTTP batch delegate child — so `--concurrency N` runs N
 *  endpoint delegations in parallel instead of one-at-a-time on the serial
 *  path. Returns outcomes keyed by task id; a cache-hit, endpoint-configured
 *  agent, or sub-workflow task gets no prepared outcome and settles through
 *  the serial accept path inside processSelectedTask (a sub-workflow task is
 *  never spawn-eligible in the first place — processSelectedTask always
 *  takes its own runSubWorkflow branch for it, so building a spawn job here
 *  would only be spawned and thrown away unused). Dispatch failures become
 *  recorded fail steps up front, exactly what the serial path would emit. */
function prepareConcurrentOutcomes(ctx, batch) {
    const failSteps = new Map();
    const jobs = [];
    const jobTaskIds = [];
    const endpointJobs = [];
    const endpointTaskIds = [];
    // The worker each spawned or delegated task runs as, to check after the wait.
    const spawnedWorkers = new Map();
    // Each spawned or delegated task's `spawning agent` line, in batch order,
    // printed when the round starts (not after its wait, as before 0.3.2).
    const spawningLines = [];
    // Set whenever a task's status flips pending -> running (workerId
    // assigned) this round, regardless of whether it later becomes a real
    // spawn job, an endpoint job, a cache hit, or a sub-workflow task. That
    // dispatch is a real state mutation on the round-cached run object that
    // nothing has written to disk yet — the pre-spawn checkpoint below must
    // flush it even when the batch produces zero spawn/endpoint jobs (e.g. an
    // all-sub-workflow batch), or a crash before the round-end flush loses
    // the dispatch.
    let dispatchedThisRound = false;
    // Dispatch is a short local mutation group. Keep its audit lock only until
    // its events have one durable append; the agent work below stays outside it.
    withTrustAuditBatch(loadRun(ctx), () => {
        for (const taskId of batch) {
            const run = loadRun(ctx);
            const task = run.tasks.find((candidate) => candidate.id === taskId);
            if (!task || (task.status !== "pending" && task.status !== "running"))
                continue;
            let workerId = task.workerId;
            if (task.status === "pending") {
                const manifest = createDispatchManifest(run, 1, { backendId: task.agentType || "agent" });
                const dispatchedTask = manifest.tasks.find((entry) => entry.id === task.id) || manifest.tasks[0];
                if (!dispatchedTask || !dispatchedTask.workerId) {
                    failSteps.set(taskId, makeStep("dispatch", "failed", { runId: ctx.runId, taskId, phase: task.phase, reason: "dispatch produced no worker scope" }));
                    continue;
                }
                workerId = dispatchedTask.workerId;
                dispatchedThisRound = true;
            }
            if (!workerId) {
                failSteps.set(taskId, makeStep("dispatch", "failed", { runId: ctx.runId, taskId, phase: task.phase, reason: "no worker scope for task" }));
                continue;
            }
            const freshRun = loadRun(ctx);
            const manifest = showWorkerManifest(freshRun, workerId);
            const delegationDigest = ctx.incremental
                ? incrementalDelegationDigest(task.model || ctx.config.model || "", task.agentType || "agent", manifest.sandboxPolicy?.id || task.sandboxProfileId || "", ctx.config.command || "", ctx.config.args ? stripSecretArgs(ctx.config.args) : [], ctx.config.endpoint || "")
                : "";
            const cachePath = resultCachePath(freshRun, task, sha256(task.prompt || ""), ctx.incremental, delegationDigest);
            if (cachePath && fs.existsSync(cachePath))
                continue;
            // A sub-workflow task never goes through the spawn path — processSelectedTask
            // checks task.subWorkflow before it ever looks at a prepared spawn outcome
            // and always takes its own runSubWorkflow branch instead (mirrors that
            // check byte-for-byte). Building a spawn OR endpoint job for it here would
            // just be a real agent child spawned/delegated and thrown away unused.
            const subWorkflow = task.subWorkflow;
            if (subWorkflow)
                continue;
            const request = {
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
            };
            const job = prepareAgentSpawn(request);
            if (job) {
                const sandboxPolicy = manifest.sandboxPolicy;
                if (sandboxPolicy) {
                    job.env = buildAgentChildEnv(sandboxPolicy).env;
                }
                jobs.push(job);
                jobTaskIds.push(taskId);
                spawnedWorkers.set(taskId, workerId);
                spawningLines.push(spawningAgentLine(task, false));
                continue;
            }
            // Endpoint-configured agent: no CLI binary to batch-spawn, but its HTTP
            // delegation joins the concurrent window through the endpoint batch child
            // (runEndpointBatchOutcomes) rather than settling one-at-a-time on the
            // serial path. An unconfigured agent (neither command nor endpoint) returns
            // undefined from both prepares here and falls to the serial refusal.
            const endpointJob = prepareEndpointJob(request);
            if (endpointJob) {
                endpointJobs.push(endpointJob);
                endpointTaskIds.push(taskId);
                spawnedWorkers.set(taskId, workerId);
                spawningLines.push(spawningAgentLine(task, false));
            }
        }
    });
    const totalJobs = jobs.length + endpointJobs.length;
    if (totalJobs) {
        emitProgress(`⇉ concurrent round: ${totalJobs} agent${totalJobs > 1 ? "s" : ""} spawning in parallel, may take minutes…`);
        for (const line of spawningLines)
            emitProgress(line);
    }
    if (totalJobs || dispatchedThisRound) {
        // Every task above that reached "pending" got dispatched (workerId
        // assigned) in the round-cached run object, but nothing durable was
        // written for it — unlike the serial path's own dispatch branch, which
        // always checkpoints immediately. Flush now, BEFORE the batch's long
        // settle window opens: a crash mid-spawn OR mid-sub-workflow-recursion
        // (both can run for minutes) then leaves state.json correctly showing
        // these tasks as dispatched, instead of losing the dispatch entirely.
        // Gated on dispatchedThisRound (not just totalJobs) so a batch made
        // entirely of sub-workflow and/or cache-hit tasks — which builds zero
        // spawn/endpoint jobs — still gets this flush before its long-running
        // settle loop starts.
        saveCheckpoint(loadRun(ctx), DRIVE_SAVE);
    }
    const outcomes = new Map();
    const settled = runAgentBatchOutcomes(jobs);
    jobTaskIds.forEach((taskId, index) => outcomes.set(taskId, settled[index]));
    const endpointSettled = runEndpointBatchOutcomes(endpointJobs);
    endpointTaskIds.forEach((taskId, index) => outcomes.set(taskId, endpointSettled[index]));
    // The batch ran for as long as its slowest agent; `cw result` / `cw commit`
    // may have saved this run meanwhile. Settle onto what is on disk now: the
    // round's copy has nothing unsaved here (any dispatch was flushed above).
    // A task another writer settled or moved while its agent ran refuses the
    // round, as on the serial path (stillOwnedTask).
    const held = loadRun(ctx);
    const fresh = refreshRun(ctx, held);
    if (fresh !== held) {
        for (const [taskId, workerId] of spawnedWorkers)
            stillOwnedTask(fresh, taskId, workerId);
    }
    return { outcomes, failSteps };
}
/** One concurrent round inside one cached in-memory run: dispatches every
 *  batch task, spawns all spawn-style agent children in one concurrent
 *  window (CLI-binary agents through the batch child, endpoint agents
 *  through the HTTP batch child), then settles + accepts in DETERMINISTIC
 *  batch (task-id) order regardless of wall-clock finish order. At round end
 *  it flushes once: commitState(run, "concurrent-round:<n>-tasks") +
 *  writeReport + saveCheckpoint. Cache-hit tasks get no prepared outcome and
 *  settle through the serial path (still inside this one deferred-persist
 *  round). If no step was produced (nothing runnable at round entry —
 *  terminal/blocked/token-budget gate) the round degrades to one plain
 *  driveStep. */
function driveConcurrentRound(ctx, limit) {
    return withRoundCache(ctx, () => {
        const run = loadRun(ctx);
        const selected = selectDriveTask(run);
        const gate = terminalOrConfigStep(run, selected, agentConfigured(ctx.config), tokenBudgetUsage(run));
        if (gate.kind === "commit" || gate.step)
            return [driveStep(ctx)];
        const width = Math.max(1, Math.floor(limit) || 1);
        const phaseTaskIds = runnableTaskIds(run);
        const batch = run.tasks
            .filter((task) => phaseTaskIds.has(task.id) && (task.status === "pending" || task.status === "running"))
            .slice(0, width)
            .map((task) => task.id);
        const prepared = withPerfTraceGroup("dispatch", () => prepareConcurrentOutcomes(ctx, batch));
        const steps = [];
        // Settlement is also local and synchronous. Flush the complete audit
        // group before the existing round checkpoint, never across it.
        withPerfTraceGroup("settlement", () => withTrustAuditBatch(loadRun(ctx), () => {
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
        }));
        if (steps.length > 0) {
            const settledRun = loadRun(ctx);
            withPerfTraceGroup("checkpoint", () => commitState(settledRun, `concurrent-round:${batch.length}-tasks`));
            withPerfTraceGroup("report", () => writeReport(settledRun));
            withPerfTraceGroup("checkpoint", () => saveCheckpoint(settledRun, DRIVE_SAVE));
        }
        return steps.length > 0 ? steps : [driveStep(ctx)];
    });
}
// SIGINT/SIGTERM. With no handler, a signal kills the process outright
// between steps and no `finally` runs, so a lock taken by `withFileLock`
// (state.json or trust-audit-log, in run-store.ts/trust-audit.ts) is left
// as a stale `.lock` that makes the NEXT command retry for ~6s before
// failing (well under the 30s stale-lock steal window).
//
// A listener alone is not enough: Node.js does not dispatch a queued POSIX
// signal to a JS `process.on(signal, ...)` listener until the event loop
// gets a turn, and drive()'s whole multi-round loop (spawnSync agents,
// nothing awaited between rounds) is ONE synchronous span with no such
// turn. The signal sits queued until the loop ends, by which point the
// `finally` below has removed the listener. `drive()` keeps this exact
// synchronous shape for its callers; `driveAsync()` below is the fix, for
// callers that need a live run to really respond to Ctrl-C/SIGTERM.
const DRIVE_STOP_SIGNALS = ["SIGINT", "SIGTERM"];
const DRIVE_STOP_EXIT_CODE = { SIGINT: 130, SIGTERM: 143 };
function buildDriveContext(runId, cwd, options) {
    const now = options.now || new Date().toISOString();
    const config = options.agentConfig || resolveAgentConfig(options.args || {});
    const policy = { ...DEFAULT_SCHEDULING_POLICY, ...(options.policy || {}) };
    return {
        runId,
        cwd,
        now,
        config,
        attempts: new Map(),
        incremental: Boolean(options.incremental),
        depth: Math.max(0, Math.floor(options.depth || 0)),
        visitedAppIds: options.visitedAppIds || [],
        policy,
    };
}
// Phase-boundary progress (brew-style): announce each phase when it becomes
// active and when it finishes — `==> Map ✓ (6/6)` / `==> Assess ⇉ (3/6)`.
// Describes CW's OWN phases (vendor-neutral); goes to stderr via
// emitProgress so stdout stays clean data. term.phaseProgressLine renders
// the line; the returned closure decides WHEN to emit each boundary.
// Shared by drive() and driveAsync() so the two never drift apart.
/** The name the ticker line gives the round: the first runnable phase,
 *  written the way the phase progress lines write it. */
function roundPhaseLabel(run) {
    const phase = firstRunnablePhase(run);
    const name = phase ? phase.name || phase.id : "";
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}
/** `again` (new in 0.3.3): print the active phase's line even when that
 *  phase was already announced — driveOneRound passes it after every
 *  concurrent round, so each round ends with its own `==> <Phase> (k/n)`
 *  line, not only the first. */
function createPhaseProgressEmitter() {
    const announcedPhaseComplete = new Set();
    let activePhaseId;
    const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    return (run, again = false) => {
        for (const ph of run.phases || []) {
            const phaseTaskIds = new Set(ph.taskIds);
            const phaseTasks = run.tasks.filter((task) => phaseTaskIds.has(task.id));
            const total = phaseTasks.length;
            if (total === 0)
                continue;
            const done = phaseTasks.filter((task) => task.status === "completed").length;
            const label = titleCase(ph.name || ph.id);
            if (done >= total) {
                if (!announcedPhaseComplete.has(ph.id)) {
                    announcedPhaseComplete.add(ph.id);
                    emitProgress(phaseProgressLine(label, done, total, ph.mode, process.stderr));
                }
                continue;
            }
            if (ph.id !== activePhaseId || again) {
                activePhaseId = ph.id;
                emitProgress(phaseProgressLine(label, done, total, ph.mode, process.stderr));
            }
            return; // only the first not-yet-complete phase is "active"
        }
    };
}
/** Runs exactly one round -- a single driveStep, or a full concurrent
 *  round when width>1 -- and records its steps. Returns false when the
 *  round loop should stop (a terminal step, or `--once`'s single-round
 *  contract), true to go on to another round. Shared by drive()'s plain
 *  loop and driveAsync()'s interruptible one so the two never drift
 *  apart. */
function driveOneRound(ctx, options, steps, emitPhaseProgress) {
    // One round-cache scope for the WHOLE round, not just driveConcurrentRound's
    // own batch: the width check and (for a serial round) driveStep/
    // processSelectedTask's several loadRun(ctx) calls otherwise each
    // re-read+re-parse state.json even though nothing on disk changed
    // between them — reads that only reflect the mutations THIS round's
    // own steps make, which the shared in-memory object already carries.
    const { roundSteps, roundRun, concurrent } = withPerfTraceGroup("round", () => withRoundCache(ctx, () => withDriveTicker(roundPhaseLabel(loadRun(ctx)), () => {
        const width = roundWidth(loadRun(ctx), options.concurrency);
        // width>1 (an explicit --concurrency>1, or an auto-width parallel
        // phase) runs the whole round through driveConcurrentRound — one or
        // more steps recorded in deterministic batch order, one flush at round
        // end. `--once` still stops after this ONE round even though a round
        // can yield multiple steps.
        const stepsOfRound = width > 1 ? driveConcurrentRound(ctx, width) : [driveStep(ctx)];
        return { roundSteps: stepsOfRound, roundRun: loadRun(ctx), concurrent: width > 1 };
    })));
    for (const stepResult of roundSteps)
        steps.push(stepResult);
    ctx.lastRoundRun = roundRun;
    // Brew-style progress lines: after each round, announce a newly-active
    // phase and any phase that just finished. Uses the run the round just
    // advanced and saved, not a second read of the file it wrote; goes to
    // stderr so stdout stays clean.
    emitPhaseProgress(roundRun, concurrent);
    const last = roundSteps[roundSteps.length - 1];
    if (options.once)
        return false;
    if (last && (last.status === "complete" || last.status === "parked" || last.status === "blocked"))
        return false;
    return true;
}
/** One JS EventEmitter listener per SIGINT/SIGTERM, installed for the span
 *  of one drive()/driveAsync() call and removed by that caller's own
 *  `finally` (this function recurses for nested sub-workflow runs, and
 *  many tests call it repeatedly in one process, so nothing must
 *  accumulate on `process`'s listener list across calls). The FIRST
 *  signal sets a flag the round loop checks at the top of its next
 *  iteration -- never mid-round -- so the in-flight round always
 *  finishes its own bookkeeping first. A SECOND signal means the caller
 *  wants out right now, not a graceful stop, and force-exits immediately
 *  with the conventional 128+signum code. */
function createStopSignalController(runId) {
    let interruptedBy;
    let stopSignalHits = 0;
    const onStopSignal = (signal) => {
        stopSignalHits += 1;
        if (stopSignalHits === 1) {
            interruptedBy = signal;
            emitProgress(`received ${signal} — stopping after the current step (resume: cw --resume --run ${runId})`);
            return;
        }
        // A second signal means the caller wants out right now, not a graceful stop.
        emitProgress(`received a second ${signal} — exiting immediately`);
        process.exit(DRIVE_STOP_EXIT_CODE[signal] ?? 1);
    };
    return {
        install: () => {
            for (const signal of DRIVE_STOP_SIGNALS)
                process.on(signal, onStopSignal);
        },
        remove: () => {
            for (const signal of DRIVE_STOP_SIGNALS)
                process.off(signal, onStopSignal);
        },
        getInterruptedBy: () => interruptedBy,
    };
}
/** Forces one real turn of the Node.js event loop. `setImmediate` (a
 *  genuine macrotask, unlike a bare Promise microtask, which never leaves
 *  the current turn) is the only thing that actually lets libuv's poll
 *  phase run and dispatch a queued SIGINT/SIGTERM to its JS listener --
 *  confirmed live: a real external `kill -INT` sent to a busy synchronous
 *  process is dropped for as long as the process never yields, and fires
 *  within ~1ms of the very next event-loop turn once it does. */
function yieldToEventLoop() {
    return new Promise((resolve) => setImmediate(resolve));
}
/** Everything drive()/driveAsync() do once their round loop has stopped:
 *  fold the interrupted/exhausted-iterations signal into the right
 *  "blocked" step, then assemble the DriveResult. Shared so the two
 *  loops can never report status differently for the same outcome. */
function finalizeDriveResult(ctx, options, steps, plannedWorkers, maxIter, exhaustedMaxIterationsAtLoopExit, interruptedBy, reopened = []) {
    let exhaustedMaxIterations = exhaustedMaxIterationsAtLoopExit;
    const run = loadRun(ctx);
    const completedWorkers = countCompleted(run);
    const parkedWorkers = countParked(run);
    const committed = hasTerminalCommit(run);
    // A signal can land on the very last step (the terminal commit itself) --
    // the run is already fully done, same "complete" check the `once` branch
    // of finalDriveStatus below already uses. Reporting "blocked" here anyway
    // would be a real user-visible lie (e.g. pipeline-cli.ts's `--bundle` gate
    // reads status, so a genuinely finished run would wrongly skip sealing).
    const alreadyComplete = completedWorkers === plannedWorkers && committed;
    if (interruptedBy) {
        exhaustedMaxIterations = false;
        if (!alreadyComplete) {
            steps.push(makeStep("blocked", "blocked", { runId: ctx.runId, reason: `drive interrupted by ${interruptedBy} — resume: cw --resume --run ${ctx.runId}` }));
        }
    }
    else if (exhaustedMaxIterations) {
        steps.push(makeStep("blocked", "blocked", { runId: ctx.runId, reason: `drive reached max iteration limit (${maxIter}) before a terminal state — resume: cw --resume --run ${ctx.runId}` }));
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
    const status = finalDriveStatus(statusInputs);
    const committedCommit = (run.commits || []).find((c) => c.reason && c.reason.startsWith("agent-delegation-drive"));
    return {
        schemaVersion: 1,
        runId: ctx.runId,
        workflowId: run.workflow.id,
        status,
        steps,
        plannedWorkers,
        completedWorkers,
        parkedWorkers,
        commitId: committedCommit?.id,
        reportPath: run.paths.report,
        statePath: run.paths.state,
        agentConfigured: agentConfigured(ctx.config),
        ...(reopened.length ? { reopenedWorkers: reopened } : {}),
    };
}
/** Under the drive lock, before the first round: put each task parked past
 *  its retry budget back to running (reopenParkedWorker) and save once.
 *  Gives back the task ids, in run order. */
function reopenParked(ctx) {
    const run = loadRun(ctx);
    const taskIds = reopenableParkedTaskIds(run);
    if (!taskIds.length)
        return [];
    withTrustAuditBatch(run, () => {
        for (const taskId of taskIds) {
            reopenParkedWorker(run, String(run.tasks.find((task) => task.id === taskId).workerId));
        }
    });
    saveCheckpoint(run, DRIVE_SAVE);
    return taskIds;
}
/** The one round loop behind drive() and driveAsync(), run under the drive
 *  lock: reopen parked workers when asked, then up to maxIter rounds with
 *  the stop-signal check at the top of each, and last the DriveResult.
 *  It yields after every round that did work; drive() goes straight on,
 *  driveAsync() first awaits yieldToEventLoop() so a queued SIGINT/SIGTERM
 *  can reach onStopSignal. That yield is the only place the two callers
 *  may differ. */
function* driveRounds(ctx, options, runId) {
    const reopened = options.reopenParked ? reopenParked(ctx) : [];
    const steps = [];
    const run0 = loadRun(ctx);
    const plannedWorkers = run0.tasks.length;
    const maxIter = maxIterations(plannedWorkers, maxLoopExpansion(run0), ctx.policy);
    const emitPhaseProgress = createPhaseProgressEmitter();
    let exhaustedMaxIterations = !options.once;
    const stopSignal = createStopSignalController(runId);
    stopSignal.install();
    try {
        for (let i = 0; i < maxIter; i++) {
            if (stopSignal.getInterruptedBy())
                break;
            if (!driveOneRound(ctx, options, steps, emitPhaseProgress)) {
                exhaustedMaxIterations = false;
                break;
            }
            yield;
        }
    }
    finally {
        stopSignal.remove();
    }
    return finalizeDriveResult(ctx, options, steps, plannedWorkers, maxIter, exhaustedMaxIterations, stopSignal.getInterruptedBy(), reopened);
}
/** Drive a run: `--once` advances exactly one step; otherwise run to
 *  completion, park, or a blocked stop. Fully synchronous, byte-identical
 *  to every prior release -- see the file comment above DRIVE_STOP_SIGNALS
 *  for why a real SIGINT/SIGTERM sent during a live multi-round call is
 *  queued but never actually reaches onStopSignal below; that limitation
 *  is deliberately kept here for backward compatibility (recursive
 *  sub-workflow runs, and every existing caller/test that depends on this
 *  exact synchronous shape) and fixed only in driveAsync(). */
export function drive(runId, cwd, options = {}) {
    const ctx = buildDriveContext(runId, cwd, options);
    // Resolve the run dir before the mutex: a missing run throws "Run not found"
    // here (never a drive.lock side effect on a nonexistent run), via a stat only
    // so the per-round read accounting is unchanged. Mirrors withRunStateLock's
    // own probe-before-lock.
    const runDir = resolveRunDir(runId, cwd);
    return withDriveLock(runDir, runId, () => {
        const rounds = driveRounds(ctx, options, runId);
        let next = rounds.next();
        while (!next.done)
            next = rounds.next();
        return next.value;
    });
}
/** Same contract and same DriveResult as drive() -- but actually
 *  interruptible. After every round it awaits yieldToEventLoop(), a real
 *  setImmediate-based turn of the event loop, giving Node.js an actual
 *  chance to dispatch a queued SIGINT/SIGTERM to onStopSignal before the
 *  next round's synchronous spawnSync work begins; the loop then sees
 *  the interrupted flag at the top of its next iteration exactly like
 *  drive() already checks it. Runs the same driveRounds() loop as
 *  drive(), so the two can only ever differ in this one respect. Intended for the live, potentially-long-running
 *  entry points (CLI `--drive`, the MCP run.drive.step tool) where a
 *  user's Ctrl-C or a supervisor's SIGTERM must actually be able to stop
 *  the run; internal/recursive/test callers that don't need this keep
 *  calling the plain drive() above, unaffected.
 *
 *  A signal arriving while a NESTED sub-workflow's own drive() call
 *  (runSubWorkflow, below) is running is still not caught until that
 *  nested call finishes on its own -- an accepted, documented limitation:
 *  the same "cannot interrupt an already in-flight blocking operation,
 *  only checked at explicit boundaries" shape as the pre-existing
 *  cannot-interrupt-mid-spawnSync limit, just one level of recursion
 *  deeper. Fixing that would require threading interruptibility through
 *  the entire recursive call graph (driveStep/processSelectedTask/
 *  runSubWorkflow/handleHop), a materially larger change left for a
 *  future cycle if it proves needed in practice. */
export async function driveAsync(runId, cwd, options = {}) {
    const ctx = buildDriveContext(runId, cwd, options);
    // Resolve the run dir before the mutex — see drive() above.
    const runDir = resolveRunDir(runId, cwd);
    return withDriveLockAsync(runDir, runId, async () => {
        const rounds = driveRounds(ctx, options, runId);
        let next = rounds.next();
        while (!next.done) {
            await yieldToEventLoop();
            next = rounds.next();
        }
        return next.value;
    });
}
export function drivePreview(runId, cwd, args = {}) {
    const run = loadRunFromCwd(runId, cwd);
    const config = resolveAgentConfig(args);
    const configured = agentConfigured(config);
    const selected = selectDriveTask(run);
    const plannedWorkers = run.tasks.length;
    const pendingWorkers = run.tasks.filter((t) => t.status === "pending" || t.status === "running").length;
    const completedWorkers = countCompleted(run);
    const parkedWorkers = countParked(run);
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
