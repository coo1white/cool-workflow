"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
