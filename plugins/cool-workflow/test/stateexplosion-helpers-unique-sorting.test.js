#!/usr/bin/env node
// stateexplosion-helpers-unique-sorting — pins the state-explosion side
// `unique()` helper: project/docs/rebuild/PLAN.md byte-compat item 3's load-bearing
// counter-case. This variant DROPS falsy values AND SORTS its output,
// unlike its multi-agent-side sibling (unsorted dedup-only) — collapsing
// the two changes persisted record order and eval parity. This file only
// tests THIS sorting variant.
//
// Evidence: SPEC/state-core.md "Helpers" list (now src/core/state/state-explosion/helpers.ts):
// "... unique (drops falsy, sorts) ..."; project/docs/rebuild/PLAN.md byte-compat item 3.

const assert = require("node:assert/strict");
const { unique } = require("../dist/core/state/state-explosion/helpers");

// Normal case: de-duplicates and sorts.
{
  assert.deepEqual(unique(["b", "a", "b", "c"]), ["a", "b", "c"], "unique must de-duplicate and sort ascending");
}

// Drops every falsy value: "", null, undefined, 0-as-string is kept (not falsy as a string).
{
  assert.deepEqual(unique(["x", "", "y"]), ["x", "y"], "unique must drop empty strings");
  assert.deepEqual(unique(["a", null, "b", undefined]), ["a", "b"], "unique must drop null/undefined entries");
}

// Empty input -> empty output.
{
  assert.deepEqual(unique([]), [], "unique of empty array is empty array");
}

// All-falsy input -> empty output.
{
  assert.deepEqual(unique(["", null, undefined]), [], "unique of all-falsy input is empty array");
}

// Sorting is the default STRING sort (lexicographic), not numeric — this
// is the distinguishing behavior from an unsorted sibling.
{
  assert.deepEqual(unique(["10", "9", "2"]), ["10", "2", "9"], "unique must use default lexicographic string sort, not numeric sort");
}

// Order independence: same set, different input order, same sorted output.
{
  const a = unique(["c", "a", "b"]);
  const b = unique(["b", "c", "a"]);
  assert.deepEqual(a, b, "unique output is independent of input order (it sorts)");
  assert.deepEqual(a, ["a", "b", "c"], "sanity: sorted output is a,b,c");
}

// Does not mutate its input array.
{
  const input = ["z", "a"];
  unique(input);
  assert.deepEqual(input, ["z", "a"], "unique must not mutate the caller's array");
}

process.stdout.write("stateexplosion-helpers-unique-sorting: ok\n");
