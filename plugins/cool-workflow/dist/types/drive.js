"use strict";
// Agent Delegation Drive (v0.1.38) — result types for the `run --drive` auto-advance
// loop. The loop is a THIN orchestrator over the EXISTING verbs (plan / dispatch /
// recordWorkerOutput / commit) + the v0.1.37 scheduler; it introduces no second
// runner/queue. These are plain, deterministic projections of run state.
//
// DETERMINISM: every payload is derivable from the run state + an injected `now`.
// No now-derived NUMERIC field (counts come from state); only ISO timestamps may be
// now-derived (the parity probe strips them).
Object.defineProperty(exports, "__esModule", { value: true });
