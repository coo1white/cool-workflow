#!/usr/bin/env node
// macollab-coordinator-ids-and-helpers — core/multi-agent/coordinator.ts's
// small pure helpers: createId, unique/sortTags, compact, truncate,
// compareRecords, indexRow, assertUnique, assertNoRecordPathCollisions,
// uniqueEdges, scrub. These are the building blocks every record builder
// composes; pinning them alone catches drift early.
//
// Evidence: SPEC/multi-agent.md section C, "Determinism of ids" invariant 11,
// "Secrets never persist" invariant 15, rebuild risk 1 (unique() semantics).

const assert = require("node:assert/strict");
const {
  createId,
  unique,
  sortTags,
  compact,
  truncate,
  compareRecords,
  indexRow,
  assertUnique,
  assertNoRecordPathCollisions,
  uniqueEdges,
  scrub,
} = require("../dist/core/multi-agent/coordinator");

// createId: `${prefix}-${String(seq).padStart(4,"0")}` — position based, no clock/random.
{
  assert.equal(createId("bb", 0), "bb-0000", "seq 0 formats as -0000");
  assert.equal(createId("topic", 7), "topic-0007", "seq 7 formats as -0007");
  assert.equal(createId("msg", 10000), "msg-10000", "seq >= 10000 is not truncated, just wider");
}

// unique(): dedups, drops falsy, SORTS (coordinator-side copy — see rebuild risk 1).
{
  assert.deepEqual(unique(["b", "a", "b", "", "a", "c"]), ["a", "b", "c"], "dedup + drop falsy + sort");
  assert.deepEqual(unique([]), [], "empty in, empty out");
}

// sortTags(): unique(values || []) — undefined input becomes [].
{
  assert.deepEqual(sortTags(undefined), [], "undefined tags become empty array");
  assert.deepEqual(sortTags(["z", "a", "z"]), ["a", "z"], "sortTags dedups and sorts like unique()");
}

// compact(): drops undefined entries AND empty arrays, keeps everything else (including falsy scalars like 0/false/"").
{
  const result = compact({ a: 1, b: undefined, c: [], d: [1], e: 0, f: false, g: "" });
  assert.deepEqual(result, { a: 1, d: [1], e: 0, f: false, g: "" }, "drops undefined and empty-array entries only");
}

// truncate(): strings over 64 chars become first 61 chars + "...".
{
  const short = "short body";
  assert.equal(truncate(short), short, "short strings pass through unchanged");
  const long = "x".repeat(100);
  const truncated = truncate(long);
  assert.equal(truncated.length, 64, "truncated result is exactly 64 chars");
  assert.equal(truncated, "x".repeat(61) + "...", "truncated result is first 61 chars + ellipsis");
}

// compareRecords(): createdAt first, then id, byte comparison (not localeCompare).
{
  const a = { createdAt: "2020-01-01T00:00:00.000Z", id: "b" };
  const b = { createdAt: "2020-01-01T00:00:00.000Z", id: "a" };
  assert.ok(compareRecords(a, b) > 0, "same createdAt: compares by id, b > a");
  const c = { createdAt: "2019-01-01T00:00:00.000Z", id: "z" };
  const d = { createdAt: "2020-01-01T00:00:00.000Z", id: "a" };
  assert.ok(compareRecords(c, d) < 0, "earlier createdAt sorts first regardless of id");
  assert.equal(compareRecords(a, a), 0, "identical records compare equal");
}

// indexRow(): projects a small fixed subset of fields.
{
  const row = indexRow({ id: "x-1", status: "active", updatedAt: "t", blackboardId: "bb-0000", topicId: "topic-0000", extra: "dropped" });
  assert.deepEqual(row, { id: "x-1", blackboardId: "bb-0000", topicId: "topic-0000", status: "active", updatedAt: "t" }, "indexRow projects exactly these 5 fields");
}

// assertUnique(): throws "Duplicate <label> id: <id>" on collision, silent otherwise.
{
  const items = [{ id: "a" }, { id: "b" }];
  assert.doesNotThrow(() => assertUnique(items, "c", "Widget"), "no collision does not throw");
  assert.throws(() => assertUnique(items, "a", "Widget"), /Duplicate Widget id: a/, "collision throws exact message");
}

// assertNoRecordPathCollisions(): two DIFFERENT ids that map to the same safe file name collide.
{
  assert.doesNotThrow(() => assertNoRecordPathCollisions("Topic", [{ id: "a" }, { id: "b" }]), "distinct safe names do not collide");
  assert.throws(
    () => assertNoRecordPathCollisions("Topic", [{ id: "a b" }, { id: "a/b" }]),
    /Topic ids a b and a\/b collide on safe file name a_b/,
    "two ids that both sanitize to a_b throw the exact collision message"
  );
  // ':' is INSIDE the safe charset (unlike '/'), so colon-bearing ids do not collide with each other here.
  assert.doesNotThrow(() => assertNoRecordPathCollisions("Topic", [{ id: "a:b" }, { id: "a:c" }]), "colon is preserved by safeFileName, so distinct colon ids do not collide");
  // Same id twice is not a "collision" in this function's terms (existing === record.id skips it).
  assert.doesNotThrow(() => assertNoRecordPathCollisions("Topic", [{ id: "same" }, { id: "same" }]), "identical ids (not just identical safe names) do not throw here");
}

// uniqueEdges(): dedups edges by (from, to, label) triple; label defaults to "".
{
  const edges = [
    { from: "a", to: "b" },
    { from: "a", to: "b" },
    { from: "a", to: "b", label: "x" },
    { from: "a", to: "c" },
  ];
  const result = uniqueEdges(edges);
  assert.equal(result.length, 3, "duplicate (from,to,label=undefined) edge collapses; labeled variant stays distinct");
  assert.deepEqual(result[0], { from: "a", to: "b" }, "first occurrence wins for a dropped duplicate");
}

// scrub(): undefined input passes through as undefined; empty object after scrub becomes undefined.
{
  assert.equal(scrub(undefined), undefined, "undefined metadata stays undefined");
  assert.equal(scrub({}), undefined, "empty object metadata becomes undefined (no keys survive)");
}

// scrub(): secret-shaped KEYS redact regardless of value; secret-shaped VALUES redact even under an innocuous key.
{
  const result = scrub({ apiKey: "abc123", note: "contains a secret phrase", plain: "hello" });
  assert.equal(result.apiKey, "[redacted]", "key matching api[_-]?key redacts its value entirely");
  assert.equal(result.note, "[redacted]", "value matching /secret/i redacts even under a non-secret key name");
  assert.equal(result.plain, "hello", "unrelated key/value pairs pass through untouched");
}

// scrub(): recurses into nested objects and arrays.
{
  const result = scrub({ nested: { password: "hunter2", ok: "fine" }, list: ["a secret token here", "clean"] });
  assert.equal(result.nested.password, "[redacted]", "nested object key redacted");
  assert.equal(result.nested.ok, "fine", "nested object non-secret key preserved");
  assert.deepEqual(result.list, ["[redacted]", "clean"], "array entries individually scrubbed");
}

process.stdout.write("macollab-coordinator-ids-and-helpers: ok\n");
