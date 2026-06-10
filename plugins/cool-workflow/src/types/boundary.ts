// One-way executor boundary (Track 3) — the red line AS A TYPE, not a convention.
//
// CW delegates execution and only ever receives structured DATA back from the
// executor: the canonical ExecutionResultEnvelope (and the usage record riding
// on it). Nothing callable crosses the boundary in either direction — no model
// client, no SDK handle, no callback an orchestration layer could use to reach
// a raw model API. Until now that was enforced by the red-line smoke (no SDK in
// package.json, no SDK import / API-URL literal in src). This module welds the
// same guarantee into the TYPE LAYER so an attempt to sneak a callable across
// the boundary fails AT COMPILE TIME — there is no entry point to discipline
// away.
//
// `OneWayData<T>` recursively maps a type to itself iff it is plain data:
//   - primitives (string/number/boolean/null/undefined) pass through;
//   - `unknown` passes through AS OPAQUE DATA — it cannot be invoked without an
//     explicit cast, and a cast is exactly the kind of code the red-line smoke
//     catches as text;
//   - arrays/objects recurse (optionality and readonly preserved);
//   - ANY function type poisons to `never`, so `T extends OneWayData<T>` fails
//     and the build breaks. Class instances (ChildProcess, an SDK client, Date)
//     fail the same way through their methods.
//
// The exported `MustBeOneWay<...>` aliases below are the welds: adding a
// callable field anywhere inside a boundary type breaks `npm run build`. The
// negative-fixture smoke (one-way-boundary-smoke.js) proves the failure mode
// stays real (a violating fixture must NOT compile) and that these welds stay
// present in source.

import type { ExecutionResultEnvelope } from "./execution-backend";
import type { UsageRecord } from "./observability";
import type { ResultEnvelope } from "./result";

export type OneWayData<T> = [unknown] extends [T]
  ? T // `unknown` (or `any`): opaque data — uninvokable without an explicit cast
  : T extends (...args: never[]) => unknown
    ? never // a callable can NEVER cross the executor boundary
    : T extends string | number | boolean | null | undefined
      ? T
      : T extends readonly (infer E)[]
        ? readonly OneWayData<E>[]
        : T extends object
          ? { [K in keyof T]: OneWayData<T[K]> }
          : never;

/** `true` iff T is one-way data (no callable anywhere in its tree). A union
 *  with a violating member collapses to `boolean`, which also fails the weld. */
export type IsOneWayData<T> = T extends OneWayData<T> ? true : false;

/** Compile-time weld: only `true` satisfies the constraint, so
 *  `AssertTrue<IsOneWayData<X>>` breaks the build when X carries a callable. */
export type AssertTrue<T extends true> = T;

// ---------------------------------------------------------------------------
// The welds. Everything the executor hands back to CW must satisfy OneWayData.
// Removing one of these lines is caught by the one-way-boundary smoke.
// ---------------------------------------------------------------------------

/** The full execution envelope (result + evidence + provenance + attestation +
 *  delegation handle) is plain data — the ONLY thing a backend returns to CW. */
export type ExecutorBoundaryWeld = AssertTrue<IsOneWayData<ExecutionResultEnvelope>>;

/** The normalized result envelope CW persists and verifies. */
export type ResultBoundaryWeld = AssertTrue<IsOneWayData<ResultEnvelope>>;

/** Host-attested usage telemetry (Track 1) riding on results/workers. */
export type UsageBoundaryWeld = AssertTrue<IsOneWayData<UsageRecord>>;
