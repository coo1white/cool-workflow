// Bounded dynamic control flow (#2) — a declarative LOOP phase whose tasks are a
// per-round TEMPLATE: after each round completes, a registered PURE predicate decides
// whether to run another round (a fresh phase appended after this one, with the same
// tasks under round-suffixed ids) or stop. Hard-capped at `maxRounds`.
//
// REPLAY-DETERMINISM: the predicate is a pure function of RECORDED round results +
// recorded usage — no IO/clock/random in its context by construction. The engine
// RECORDS each decision as a `loop-control` state node, so a replay walks the recorded
// round sequence; re-running the predicate is a verification cross-check, not the
// source of truth. Predicates are NAMED (registry refs), never inline closures —
// closures cannot be serialized into state or re-evaluated byte-identically on replay.
//
// The materialization (cloning tasks, appending phases, recording the loop-control
// node) lives in the orchestrator (maybeExpandLoop), which owns writeTaskFiles + the
// plan pipeline; THIS module is just the pure registry + the STATIC expansion bound.

import type { ResultEnvelope, UsageTotals, WorkflowRun } from "./types";

export interface LoopPredicateContext {
  /** 1-based round that just completed. */
  round: number;
  /** The result envelopes of THIS round's tasks (deterministic id order). */
  roundResults: ReadonlyArray<ResultEnvelope | undefined>;
  /** All loop result envelopes so far across every round (deterministic order). */
  allResults: ReadonlyArray<ResultEnvelope | undefined>;
  /** Recorded, attested-only usage totals for the whole run (for budget predicates). */
  usageTotals: UsageTotals;
  /** The run inputs (read-only). */
  inputs: Record<string, unknown>;
}

/** A loop termination predicate: a PURE function of recorded state. Returns whether
 *  the loop is done and a short reason (recorded into the loop-control node). */
export type LoopPredicate = (ctx: LoopPredicateContext) => { done: boolean; reason: string };

const REGISTRY = new Map<string, LoopPredicate>();

/** Register a named pure loop predicate (apps register theirs at load; CW ships a few
 *  built-ins below). Re-registering a name overwrites it. */
export function registerLoopPredicate(name: string, fn: LoopPredicate): void {
  REGISTRY.set(name, fn);
}
export function getLoopPredicate(name: string): LoopPredicate | undefined {
  return REGISTRY.get(name);
}
export function hasLoopPredicate(name: string): boolean {
  return REGISTRY.has(name);
}

// ---- Built-in predicates ---------------------------------------------------------

/** Stop once a round produced no findings (a convergence loop: keep going while the
 *  agent still reports findings; stop when a round comes back empty). */
registerLoopPredicate("no-new-findings", (ctx) => {
  const empty = ctx.roundResults.every((r) => !r || !Array.isArray(r.findings) || r.findings.length === 0);
  return empty
    ? { done: true, reason: "no-new-findings: the latest round produced no findings" }
    : { done: false, reason: "no-new-findings: the latest round still has findings" };
});

/** Always stop after the first round (a degenerate loop ≈ a normal phase; useful as a
 *  default / for tests). */
registerLoopPredicate("single-round", () => ({ done: true, reason: "single-round: stop after one round" }));

/** Static worst-case number of EXTRA tasks a fully-expanded run could mint, derived
 *  purely from the workflow DECLARATION (every loop origin phase contributes
 *  (maxRounds-1) × its round-1 task count). Used to keep the drive's iteration bound
 *  safe as tasks grow, WITHOUT reading any runtime result — so the bound is itself
 *  replay-stable and the loop is provably bounded. Zero when there are no loop phases. */
export function maxLoopExpansion(run: WorkflowRun): number {
  let extra = 0;
  for (const phase of run.phases) {
    if (phase.loop && typeof phase.loop.maxRounds === "number" && phase.loop.maxRounds > 1) {
      const templateTaskCount = phase.taskIds.length;
      extra += (phase.loop.maxRounds - 1) * templateTaskCount;
    }
  }
  return extra;
}
