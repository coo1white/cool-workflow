"use strict";
// core/pipeline/loop-expansion.ts — predicate registry, maxLoopExpansion,
// maybeExpandLoop's decision half (round clone, stop reasons).
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// src/loop-expansion.ts (predicate registry + maxLoopExpansion are
// already pure there) plus the DECISION half of
// src/orchestrator/lifecycle-operations.ts's maybeExpandLoop (materializing
// the cloned phase/tasks + loop-control node is the caller's job in
// shell/, since it needs writeTaskFiles + the plan pipeline stage).
//
// Evidence: SPEC/pipeline-run.md "loop() expansion — src/loop-
// expansion.ts + maybeExpandLoop".
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLoopPredicate = registerLoopPredicate;
exports.getLoopPredicate = getLoopPredicate;
exports.hasLoopPredicate = hasLoopPredicate;
exports.maxLoopExpansion = maxLoopExpansion;
exports.evaluateLoopStop = evaluateLoopStop;
exports.cloneLoopRoundTasks = cloneLoopRoundTasks;
exports.loopControlNodeId = loopControlNodeId;
const REGISTRY = new Map();
function registerLoopPredicate(name, fn) {
    REGISTRY.set(name, fn);
}
function getLoopPredicate(name) {
    return REGISTRY.get(name);
}
function hasLoopPredicate(name) {
    return REGISTRY.has(name);
}
registerLoopPredicate("no-new-findings", (ctx) => {
    const empty = ctx.roundResults.every((r) => !r || !Array.isArray(r.findings) || r.findings.length === 0);
    return empty
        ? { done: true, reason: "no-new-findings: the latest round produced no findings" }
        : { done: false, reason: "no-new-findings: the latest round still has findings" };
});
registerLoopPredicate("single-round", () => ({ done: true, reason: "single-round: stop after one round" }));
/** Static worst-case number of EXTRA tasks a fully-expanded run could
 *  mint, derived purely from the workflow declaration. Zero with no loop
 *  phases. */
function maxLoopExpansion(run) {
    let extra = 0;
    for (const phase of run.phases) {
        const loop = phase.loop;
        if (loop && typeof loop.maxRounds === "number" && loop.maxRounds > 1) {
            extra += (loop.maxRounds - 1) * phase.taskIds.length;
        }
    }
    return extra;
}
/** Decide whether a just-completed loop round should stop, given the
 *  origin phase's loop spec and the round's recorded results. Pure —
 *  `until:{kind:"predicate"}` looks up the registry; an unregistered ref
 *  stops fail-closed (never throws). */
function evaluateLoopStop(origin, round, ctx) {
    const loop = origin.loop;
    if (!loop)
        return { done: true, atCap: false, reason: "no loop spec" };
    const maxRounds = loop.maxRounds;
    let decision;
    if (loop.until.kind === "budget-target") {
        const target = loop.until.target || 0;
        const spent = ctx.usageTotals.totalTokens;
        decision = spent >= target
            ? { done: true, reason: `budget-target: ${spent}/${target} recorded tokens` }
            : { done: false, reason: `budget-target: ${spent}/${target} recorded tokens` };
    }
    else {
        const ref = loop.until.ref || "";
        const predicate = getLoopPredicate(ref);
        decision = predicate ? predicate(ctx) : { done: true, reason: `loop predicate "${ref}" not registered — stopping fail-closed` };
    }
    const atCap = round >= maxRounds;
    return { done: decision.done || atCap, atCap, reason: decision.reason };
}
/** Clone round-1 template tasks into `<base-id>@r<nextRound>` for a fresh
 *  phase `id: <origin-id>@r<nextRound>`, `name: <origin name> (round
 *  <n>)`. Pure data transform; the caller writes task files + runs the
 *  plan pipeline stage per new task. */
function cloneLoopRoundTasks(origin, templateTasks, nextRound) {
    const suffix = `@r${nextRound}`;
    const tasks = templateTasks.map((task) => ({
        ...task,
        id: `${task.id}${suffix}`,
        status: "pending",
        loopStage: "interpret",
        loopRound: nextRound,
        dispatchId: undefined,
        dispatchedAt: undefined,
        startedAt: undefined,
        completedAt: undefined,
        result: undefined,
        stateNodeId: undefined,
        resultNodeId: undefined,
        verifierNodeId: undefined,
        workerId: undefined,
        workerManifestPath: undefined,
        taskPath: "",
        resultPath: "",
    }));
    const phase = {
        id: `${origin.id}${suffix}`,
        name: `${origin.name} (round ${nextRound})`,
        status: "pending",
        taskIds: tasks.map((t) => t.id),
        mode: origin.mode,
        loopOrigin: origin.id,
        loopRound: nextRound,
    };
    return { phase, tasks };
}
/** Loop-control node id: `<run-id>:loop-control:<origin-phase-id>:r<round>`. */
function loopControlNodeId(runId, originPhaseId, round) {
    return `${runId}:loop-control:${originPhaseId}:r${round}`;
}
