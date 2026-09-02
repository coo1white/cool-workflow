#!/usr/bin/env node
// stateexplosion-helpers-misc — pins isProtectedStatus, dominantStatus,
// parentMap, byId, truncate, slug, sortKeys/stableLine, stripRunId.
//
// Evidence: SPEC/state-core.md "Helpers" list (now src/core/state/state-explosion/helpers.ts).

const assert = require("node:assert/strict");
const {
  isProtectedStatus,
  dominantStatus,
  parentMap,
  byId,
  truncate,
  slug,
  sortKeys,
  stableLine,
  stripRunId,
} = require("../dist/core/state/state-explosion/helpers");

// isProtectedStatus: exactly failed/blocked/rejected/conflicting are true.
{
  assert.equal(isProtectedStatus("failed"), true, "failed is protected");
  assert.equal(isProtectedStatus("blocked"), true, "blocked is protected");
  assert.equal(isProtectedStatus("rejected"), true, "rejected is protected");
  assert.equal(isProtectedStatus("conflicting"), true, "conflicting is protected");
  assert.equal(isProtectedStatus("completed"), false, "completed is not protected");
  assert.equal(isProtectedStatus("running"), false, "running is not protected");
  assert.equal(isProtectedStatus("pending"), false, "pending is not protected");
  assert.equal(isProtectedStatus("verified"), false, "verified is not protected");
  assert.equal(isProtectedStatus(""), false, "empty string is not protected");
}

// dominantStatus: priority order failed > blocked > rejected > conflicting > running > pending.
{
  assert.equal(dominantStatus(["completed", "failed", "running"]), "failed", "failed outranks everything else present");
  assert.equal(dominantStatus(["blocked", "rejected"]), "blocked", "blocked outranks rejected");
  assert.equal(dominantStatus(["rejected", "conflicting"]), "rejected", "rejected outranks conflicting");
  assert.equal(dominantStatus(["conflicting", "running"]), "conflicting", "conflicting outranks running");
  assert.equal(dominantStatus(["running", "pending"]), "running", "running outranks pending");
  assert.equal(dominantStatus(["pending"]), "pending", "pending alone stays pending");
}

// dominantStatus: none of the priority statuses present -> first status.
{
  assert.equal(dominantStatus(["verified", "checkpoint"]), "verified", "no priority match falls back to the first status");
}

// dominantStatus: empty input -> "completed".
{
  assert.equal(dominantStatus([]), "completed", "empty statuses list defaults to completed");
}

// parentMap: first edge in wins for a given "to" id.
{
  const edges = [
    { from: "a", to: "child" },
    { from: "b", to: "child" }, // duplicate "to" — must be ignored (first wins)
    { from: "c", to: "other" },
  ];
  const parents = parentMap(edges);
  assert.equal(parents.get("child"), "a", "first edge into a node must win over a later duplicate");
  assert.equal(parents.get("other"), "c", "distinct child ids each get their own parent");
  assert.equal(parents.has("a"), false, "a 'from'-only id never appears as a key");
  assert.equal(parents.size, 2, "parentMap has one entry per distinct 'to' id");
}

// parentMap: empty edges -> empty map.
{
  assert.equal(parentMap([]).size, 0, "parentMap of no edges is an empty map");
}

// byId: localeCompare-based comparator usable directly with Array.sort.
{
  const items = [{ id: "b" }, { id: "a" }, { id: "c" }];
  assert.deepEqual(items.sort(byId).map((i) => i.id), ["a", "b", "c"], "byId sorts ascending by id");
}

// truncate: whitespace-collapsed, trimmed.
{
  assert.equal(truncate("  hello   world  "), "hello world", "truncate collapses internal/edge whitespace");
}

// truncate: over 80 chars becomes first 77 chars + "...".
{
  const long = "x".repeat(100);
  const result = truncate(long);
  assert.equal(result.length, 80, "truncated string is exactly 80 chars (77 + '...')");
  assert.equal(result, "x".repeat(77) + "...", "truncate keeps exactly the first 77 chars then ellipsis");
}

// truncate: exactly 80 chars is untouched (boundary — not "over 80").
{
  const exact = "y".repeat(80);
  assert.equal(truncate(exact), exact, "exactly-80-char string is not truncated");
}

// truncate: 81 chars IS truncated (one past the boundary).
{
  const over = "y".repeat(81);
  const result = truncate(over);
  assert.equal(result, "y".repeat(77) + "...", "81-char string is truncated to 77 + ellipsis");
}

// slug: chars outside [a-zA-Z0-9._:-] become "-". Note the regex range
// a-zA-Z0-9._:- makes "_" through "9" a contiguous ASCII run alongside the
// listed chars, so "_" also passes through unchanged (verified directly
// against the regex, not assumed) — only characters truly outside that
// class (space, "!", etc.) are replaced.
{
  assert.equal(slug("hello world!"), "hello-world-", "space and ! become -");
  assert.equal(slug("a.b_c:d-e"), "a.b_c:d-e", ". _ : - all pass through unchanged");
  assert.equal(slug("ABC123"), "ABC123", "alphanumerics pass through unchanged");
}

// sortKeys: recursively sorts object keys; arrays keep element order.
{
  const value = { b: 1, a: { z: 1, y: 2 }, list: [3, 1, 2] };
  assert.deepEqual(
    Object.keys(sortKeys(value)),
    ["a", "b", "list"],
    "sortKeys sorts top-level keys alphabetically"
  );
  assert.deepEqual(Object.keys(sortKeys(value).a), ["y", "z"], "sortKeys sorts nested object keys too");
  assert.deepEqual(sortKeys(value).list, [3, 1, 2], "sortKeys must NOT reorder array elements");
}

// stableLine: key-sorted JSON.stringify, deterministic regardless of key order.
{
  const a = stableLine({ b: 1, a: 2 });
  const b = stableLine({ a: 2, b: 1 });
  assert.equal(a, b, "stableLine must be independent of key insertion order");
  assert.equal(a, '{"a":2,"b":1}', "stableLine produces key-sorted JSON text");
}

// stripRunId: strips "<run.id>:" prefix when present, else returns id unchanged.
{
  const run = { id: "run-1" };
  assert.equal(stripRunId(run, "run-1:task:abc"), "task:abc", "stripRunId removes the run-id prefix");
  assert.equal(stripRunId(run, "other:task:abc"), "other:task:abc", "stripRunId leaves a non-matching id unchanged");
  assert.equal(stripRunId(run, "run-1"), "run-1", "stripRunId leaves the bare run id (no trailing colon) unchanged");
}

process.stdout.write("stateexplosion-helpers-misc: ok\n");
