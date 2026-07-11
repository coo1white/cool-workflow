"use strict";
// shell/drive.ts — the thin imperative loop that calls drive-decide.ts
// once per step and performs the spawn/commit/cache-write IO the
// decision names.
//
// MILESTONE 6+7 (combined; see docs/rebuild/PLAN.md Open risk 9/10 — the LARGEST
// milestone). Byte-exact port of the old build's src/drive.ts's
// imperative shell around the pure decision core now in
// core/pipeline/drive-decide.ts. Sub-workflow nesting and `--incremental`
// are ported; the concurrent-round driver (driveConcurrentRound, below)
// dispatches and settles a whole round's tasks in one batch (see
// `--concurrency`/`roundWidth`), pinned by
// v2/conformance/cases/pipeline-concurrent-round.case.js.
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
exports.maybeExpandLoop = maybeExpandLoop;
exports.driveStep = driveStep;
exports.drive = drive;
exports.driveAsync = driveAsync;
exports.drivePreview = drivePreview;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const drive_decide_1 = require("../core/pipeline/drive-decide");
const loop_expansion_1 = require("../core/pipeline/loop-expansion");
const dispatch_1 = require("../core/pipeline/dispatch");
const run_store_1 = require("./run-store");
const dispatch_2 = require("./dispatch");
const worker_isolation_1 = require("./worker-isolation");
const state_node_1 = require("../core/state/state-node");
const node_store_1 = require("./node-store");
const runner_1 = require("../core/pipeline/runner");
const harness_1 = require("./harness");
const term_1 = require("./term");
const commit_1 = require("./commit");
const report_1 = require("./report");
const trust_audit_1 = require("./trust-audit");
const agent_config_1 = require("./agent-config");
const registry_1 = require("./execution-backend/registry");
const agent_1 = require("./execution-backend/agent");
const hash_1 = require("../core/hash");
const collate_1 = require("../core/util/collate");
const pipeline_1 = require("./pipeline");
const reporter_1 = require("./reporter");
const fs_atomic_1 = require("./fs-atomic");
const observability_1 = require("./observability");
const telemetry_attestation_1 = require("../core/trust/telemetry-attestation");
/** Total RECORDED tokens across the run's attested units, reading the
 *  agent-reported usage through normalizeReportedUsage so a hop that
 *  reported snake_case buckets (`input_tokens`/`output_tokens`, the shape
 *  parseAgentReport hands back verbatim) is counted — not silently zeroed.
 *  Reuses deriveUsageTotals' own unit selection (its `rows` are the
 *  deduped attested units) so worker-vs-task double-counting stays fixed;
 *  only the key-reading is corrected here. The old build normalized at
 *  store time in worker-accept/verifier-completion.ts; v2 stores the raw
 *  reportedUsage, so the drive's budget accounting normalizes at read
 *  time — same net RECORDED total, same fail-closed backstop. */
function recordedTokenTotal(run) {
    let total = 0;
    for (const row of (0, observability_1.deriveUsageTotals)(run).rows) {
        const usage = row.usage;
        if (!usage)
            continue;
        const declared = usage.totalTokens;
        if (typeof declared === "number") {
            total += declared;
            continue;
        }
        const n = (0, telemetry_attestation_1.normalizeReportedUsage)(usage);
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
 *  later, unrelated drive call. Re-entrant: a nested call (e.g. the
 *  serial drive loop's own round-cache wrapping a driveStep that itself
 *  runs inside a caller's round cache) reuses the outer seed instead of
 *  re-reading disk, and only the OUTERMOST call clears the entry — so
 *  nesting never re-reads a run mid-round nor drops the cache early out
 *  from under an enclosing scope. */
function withRoundCache(ctx, fn) {
    const alreadyActive = roundCache.has(ctx.runId);
    if (!alreadyActive)
        roundCache.set(ctx.runId, (0, run_store_1.loadRunFromCwd)(ctx.runId, ctx.cwd));
    try {
        return fn();
    }
    finally {
        if (!alreadyActive)
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
    // stableCompare (not a bare localeCompare): this order feeds the sha256
    // digest below, which feeds the incremental cache key — a host-locale-
    // dependent order would silently move the cache key across machines.
    for (const candidate of run.tasks.filter((t) => previousTaskIds.has(t.id)).sort((a, b) => (0, collate_1.stableCompare)(a.id, b.id))) {
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
    const decided = (0, drive_decide_1.retryOrPark)(prior, ctx.policy, reason);
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
        // Advance the RUN-level lifecycle stage on dispatch, exactly as the old
        // build's orchestrator dispatch() wrapper did (run.loopStage = "act").
        // The operator status "Stage:" line reads run.loopStage; v2's shell/
        // dispatch.ts advances the task/node loopStage but never the run, so a
        // driven run's operator status stayed frozen at "interpret".
        run.loopStage = "act";
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
            // Not gated by requireAttestedTelemetry here: the underlying result was
            // already gated (attested or explicitly overridden) at its FIRST
            // acceptance, before it was cached. Re-blocking a cache hit would only
            // punish the operator for their own earlier, already-audited accept.
            // Still made visible, not silent: when the operator requires attested
            // telemetry, record that this particular accept came from the cache
            // rather than a freshly re-verified hop.
            (0, worker_isolation_1.recordWorkerOutput)(run, workerId, manifest.resultPath);
            if (ctx.config.requireAttestedTelemetry) {
                (0, trust_audit_1.recordTrustAuditEvent)(run, {
                    kind: "telemetry.cache-accept",
                    decision: "recorded",
                    source: "cw-validated",
                    workerId,
                    taskId: selected.id,
                    metadata: { reason: "result-cache hit; original attestation gate applied at first acceptance, not re-verified here" },
                });
            }
            // Advance the run lifecycle stage on accept, as the old build's
            // recordWorkerOutput wrapper did (run.loopStage = "observe").
            run.loopStage = "observe";
            // Bounded dynamic loops: after a round's tasks complete, evaluate the
            // predicate and either append the next round or mark the loop done —
            // folded into this same worker:<id>:result checkpoint, exactly as the
            // old build's recordWorkerOutput wrapper did (no-op for non-loop runs).
            maybeExpandLoop(run);
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
        // Advance the run lifecycle stage on accept (old build: "observe").
        run.loopStage = "observe";
        // Bounded dynamic loops: same round-boundary evaluation the old build's
        // recordWorkerOutput wrapper performed, folded into this checkpoint.
        maybeExpandLoop(run);
        if (!deferPersist) {
            (0, commit_1.commitState)(run, `worker:${workerId}:result`);
            (0, run_store_1.saveCheckpoint)(run);
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
        (0, trust_audit_1.recordTrustAuditEvent)(run, {
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
        policy: ctx.policy,
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
        // Cross-link the child run onto the parent's delegate task + a tamper-
        // evident `worker.sub-workflow` trust-audit event (byte-behavior port of
        // the old build's drive sub-workflow cross-link). subRunId/subRunDir let a
        // reader walk from the parent task to the child run; the audit event binds
        // the child report digest + verification into the parent's hash chain.
        selected.subRunId = childRun.id;
        selected.subRunDir = finalChild.paths.runDir;
        try {
            const childAudit = (0, trust_audit_1.verifyTrustAudit)(finalChild);
            (0, trust_audit_1.recordTrustAuditEvent)(run, {
                kind: "worker.sub-workflow",
                decision: "accepted",
                source: "cw-validated",
                workerId,
                taskId: selected.id,
                nodeId: selected.resultNodeId,
                metadata: {
                    subWorkflowAppId: spec.appId,
                    subRunId: childRun.id,
                    childReportDigest: (0, hash_1.sha256)(childBytes),
                    childAuditVerified: childAudit.verified,
                    bindResult: spec.bindResult || "report",
                },
            });
        }
        catch {
            /* the cross-link is provenance; a failure here must not undo an accepted hop */
        }
        // Advance the run lifecycle stage on accept (old build: "observe").
        run.loopStage = "observe";
        // Bounded dynamic loops: evaluate the round boundary in the same
        // checkpoint (no-op unless this task's phase is a loop round).
        maybeExpandLoop(run);
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
 *  accept handles the next. Byte-exact port of the old build's
 *  orchestrator/lifecycle-operations.ts maybeExpandLoop, called there from
 *  recordWorkerOutput; v2's recordWorkerOutput (shell/worker-isolation.ts)
 *  does not expand, so the drive shell wires it in right after an accept.
 *  Exported so the standalone `cw worker output` CLI verb (worker-cli.ts) can
 *  run the same round-expansion after a hand-recorded accept, matching the old
 *  build's recordWorkerOutput wrapper. */
function maybeExpandLoop(run) {
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
        const decision = (0, loop_expansion_1.evaluateLoopStop)(origin, round, ctx);
        const until = origin.loop.until;
        // Record the decision under a deterministic id (the replay source of truth).
        (0, node_store_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
            id: (0, loop_expansion_1.loopControlNodeId)(run.id, originId, round),
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
        const { phase: nextPhase, tasks: newTasks } = (0, loop_expansion_1.cloneLoopRoundTasks)(origin, templateTasks, nextRound);
        const insertAt = run.phases.findIndex((p) => p.id === latest.id);
        run.phases.splice(insertAt + 1, 0, nextPhase);
        run.tasks.push(...newTasks);
        // Materialize: task files + a plan-stage node per new task (mirrors plan()).
        (0, harness_1.writeTaskFiles)(run);
        const inputNodeId = `${run.id}:input`;
        for (const t of newTasks) {
            const result = (0, runner_1.runPipelineStage)(run, "plan", inputNodeId, {
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
            }, { persist: false, persistNode: (r, node) => void (0, node_store_1.appendRunNode)(r, node) });
            t.stateNodeId = result.outputNodeId;
        }
        (0, dispatch_1.updatePhaseStatuses)(run);
        return;
    }
}
/** One deterministic drive step. */
function driveStep(ctx) {
    const run = loadRun(ctx);
    const selected = (0, drive_decide_1.selectDriveTask)(run);
    const gate = (0, drive_decide_1.terminalOrConfigStep)(run, selected, agentConfigured(ctx.config), tokenBudgetUsage(run));
    if (gate.kind === "commit") {
        // Terminal commit: advance the run lifecycle stage as the old build's
        // commit() wrapper did (run.loopStage = "checkpoint").
        run.loopStage = "checkpoint";
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
                job.env = (0, agent_1.buildAgentChildEnv)(sandboxPolicy).env;
            }
            jobs.push(job);
            jobTaskIds.push(taskId);
        }
    }
    if (jobs.length) {
        emitProgress(`⇉ concurrent round: ${jobs.length} agent${jobs.length > 1 ? "s" : ""} spawning in parallel, may take minutes…`);
        // Every task above that reached "pending" got dispatched (workerId
        // assigned) in the round-cached run object, but nothing durable was
        // written for it — unlike the serial path's own dispatch branch, which
        // always checkpoints immediately. Flush now, BEFORE the batch's long
        // spawn window opens: a crash mid-spawn (which can run for minutes)
        // then leaves state.json correctly showing these tasks as dispatched,
        // instead of losing the dispatch entirely.
        (0, run_store_1.saveCheckpoint)(loadRun(ctx));
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
        const gate = (0, drive_decide_1.terminalOrConfigStep)(run, selected, agentConfigured(ctx.config), tokenBudgetUsage(run));
        if (gate.kind === "commit" || gate.step)
            return [driveStep(ctx)];
        const phase = (0, dispatch_1.firstRunnablePhase)(run);
        const width = Math.max(1, Math.floor(limit) || 1);
        const phaseTaskIds = new Set(phase.taskIds);
        const batch = run.tasks
            .filter((task) => phaseTaskIds.has(task.id) && (task.status === "pending" || task.status === "running"))
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
// A bare Ctrl-C (SIGINT) or an external SIGTERM used to kill the process
// outright between steps -- no handler was ever installed, so the default
// kernel action ran: instant termination, no `finally` anywhere gets a
// chance to run. If that landed mid-`withFileLock` critical section (e.g.
// the state.json or trust-audit-log lock in run-store.ts/trust-audit.ts),
// the lock's release `finally` never ran either, leaving a stale `.lock`
// file that makes the NEXT command retry for ~6s before failing outright
// (well under the 30s stale-lock steal window).
//
// The FIRST fix for this (installing onStopSignal below) assumed the
// signal would at least be caught BETWEEN rounds, only missing it
// mid-spawnSync. That assumption was wrong: Node.js does not dispatch a
// queued POSIX signal to a JS `process.on(signal, ...)` listener until
// the event loop actually gets a turn, and drive()'s whole multi-round
// loop -- every round's agent spawn uses spawnSync, and nothing between
// rounds ever awaits anything -- is ONE continuous synchronous span with
// no such turn anywhere inside it. A signal landing at any point during
// that whole span (confirmed live: even a plain CPU-only busy loop with
// no spawnSync at all drops it the same way) sits queued until the loop
// finishes on its own, by which point the `finally` below has already
// removed the listener -- so it is never invoked at all. `drive()` keeps
// this exact (buggy but byte-identical) shape for full backward
// compatibility; `driveAsync()` below is the actual fix, for callers
// that need a live run to really respond to Ctrl-C/SIGTERM.
const DRIVE_STOP_SIGNALS = ["SIGINT", "SIGTERM"];
const DRIVE_STOP_EXIT_CODE = { SIGINT: 130, SIGTERM: 143 };
function buildDriveContext(runId, cwd, options) {
    const now = options.now || new Date().toISOString();
    const config = options.agentConfig || (0, agent_config_1.resolveAgentConfig)(options.args || {});
    const policy = { ...drive_decide_1.DEFAULT_SCHEDULING_POLICY, ...(options.policy || {}) };
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
// emitProgress so stdout stays clean data. Byte-exact port of the old
// build's src/drive.ts emitPhaseProgress. term.phaseProgressLine renders
// the line; the returned closure decides WHEN to emit each boundary.
// Shared by drive() and driveAsync() so the two never drift apart.
function createPhaseProgressEmitter() {
    const announcedPhaseComplete = new Set();
    let activePhaseId;
    const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    return (run) => {
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
    const roundSteps = withRoundCache(ctx, () => {
        const width = (0, drive_decide_1.roundWidth)(loadRun(ctx), options.concurrency);
        // width>1 (an explicit --concurrency>1, or an auto-width parallel
        // phase) runs the whole round through driveConcurrentRound — one or
        // more steps recorded in deterministic batch order, one flush at round
        // end. `--once` still stops after this ONE round even though a round
        // can yield multiple steps.
        return width > 1 ? driveConcurrentRound(ctx, width) : [driveStep(ctx)];
    });
    for (const stepResult of roundSteps)
        steps.push(stepResult);
    // Brew-style phase boundaries: after each round, announce a newly-active
    // phase and any phase that just finished. Cheap — reuses the run we just
    // advanced; goes to stderr so stdout stays clean.
    emitPhaseProgress(loadRun(ctx));
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
function createStopSignalController() {
    let interruptedBy;
    let stopSignalHits = 0;
    const onStopSignal = (signal) => {
        stopSignalHits += 1;
        if (stopSignalHits === 1) {
            interruptedBy = signal;
            emitProgress(`received ${signal} — stopping after the current step (run again with the same run id to resume)`);
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
function finalizeDriveResult(ctx, options, steps, plannedWorkers, maxIter, exhaustedMaxIterationsAtLoopExit, interruptedBy) {
    let exhaustedMaxIterations = exhaustedMaxIterationsAtLoopExit;
    const run = loadRun(ctx);
    const completedWorkers = (0, drive_decide_1.countCompleted)(run);
    const parkedWorkers = (0, drive_decide_1.countParked)(run);
    const committed = (0, drive_decide_1.hasTerminalCommit)(run);
    const last = steps[steps.length - 1];
    // A signal can land on the very last step (the terminal commit itself) --
    // the run is already fully done, same "complete" check the `once` branch
    // of finalDriveStatus below already uses. Reporting "blocked" here anyway
    // would be a real user-visible lie (e.g. pipeline-cli.ts's `--bundle` gate
    // reads status, so a genuinely finished run would wrongly skip sealing).
    const alreadyComplete = completedWorkers === plannedWorkers && committed;
    if (interruptedBy) {
        exhaustedMaxIterations = false;
        if (!alreadyComplete) {
            steps.push((0, drive_decide_1.makeStep)("blocked", "blocked", { runId: ctx.runId, reason: `drive interrupted by ${interruptedBy} — run again with the same run id to resume` }));
        }
    }
    else if (exhaustedMaxIterations) {
        steps.push((0, drive_decide_1.makeStep)("blocked", "blocked", { runId: ctx.runId, reason: `drive reached max iteration limit (${maxIter}) before a terminal state` }));
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
    };
}
/** Drive a run: `--once` advances exactly one step; otherwise run to
 *  completion, park, or a blocked stop. Fully synchronous, byte-identical
 *  to every prior release -- see the file comment above DRIVE_STOP_SIGNALS
 *  for why a real SIGINT/SIGTERM sent during a live multi-round call is
 *  queued but never actually reaches onStopSignal below; that limitation
 *  is deliberately kept here for backward compatibility (recursive
 *  sub-workflow runs, and every existing caller/test that depends on this
 *  exact synchronous shape) and fixed only in driveAsync(). */
function drive(runId, cwd, options = {}) {
    const ctx = buildDriveContext(runId, cwd, options);
    const steps = [];
    const run0 = loadRun(ctx);
    const plannedWorkers = run0.tasks.length;
    const maxIter = (0, drive_decide_1.maxIterations)(plannedWorkers, (0, loop_expansion_1.maxLoopExpansion)(run0), ctx.policy);
    const emitPhaseProgress = createPhaseProgressEmitter();
    let exhaustedMaxIterations = !options.once;
    const stopSignal = createStopSignalController();
    stopSignal.install();
    try {
        for (let i = 0; i < maxIter; i++) {
            if (stopSignal.getInterruptedBy())
                break;
            if (!driveOneRound(ctx, options, steps, emitPhaseProgress)) {
                exhaustedMaxIterations = false;
                break;
            }
        }
    }
    finally {
        stopSignal.remove();
    }
    return finalizeDriveResult(ctx, options, steps, plannedWorkers, maxIter, exhaustedMaxIterations, stopSignal.getInterruptedBy());
}
/** Same contract and same DriveResult as drive() -- but actually
 *  interruptible. After every round it awaits yieldToEventLoop(), a real
 *  setImmediate-based turn of the event loop, giving Node.js an actual
 *  chance to dispatch a queued SIGINT/SIGTERM to onStopSignal before the
 *  next round's synchronous spawnSync work begins; the loop then sees
 *  the interrupted flag at the top of its next iteration exactly like
 *  drive() already checks it. Shares driveOneRound/createStopSignalController/
 *  finalizeDriveResult with drive(), so the two can only ever differ in
 *  this one respect. Intended for the live, potentially-long-running
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
async function driveAsync(runId, cwd, options = {}) {
    const ctx = buildDriveContext(runId, cwd, options);
    const steps = [];
    const run0 = loadRun(ctx);
    const plannedWorkers = run0.tasks.length;
    const maxIter = (0, drive_decide_1.maxIterations)(plannedWorkers, (0, loop_expansion_1.maxLoopExpansion)(run0), ctx.policy);
    const emitPhaseProgress = createPhaseProgressEmitter();
    let exhaustedMaxIterations = !options.once;
    const stopSignal = createStopSignalController();
    stopSignal.install();
    try {
        for (let i = 0; i < maxIter; i++) {
            if (stopSignal.getInterruptedBy())
                break;
            if (!driveOneRound(ctx, options, steps, emitPhaseProgress)) {
                exhaustedMaxIterations = false;
                break;
            }
            await yieldToEventLoop();
        }
    }
    finally {
        stopSignal.remove();
    }
    return finalizeDriveResult(ctx, options, steps, plannedWorkers, maxIter, exhaustedMaxIterations, stopSignal.getInterruptedBy());
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
