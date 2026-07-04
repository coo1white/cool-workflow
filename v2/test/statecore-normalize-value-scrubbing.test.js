#!/usr/bin/env node
// statecore-normalize-value-scrubbing (milestone 3) — pins normalizeValue's
// scrubbing rules from SPEC/state-core.md's edge cases: drops
// createdAt/updatedAt/recordedAt/selectedAt/replayedAt/generatedAt, sorts
// all object keys, and rewrites timestamp/tmp-path substrings:
// YYYYMMDDTHHMMSSZ and full ISO timestamps -> "<timestamp>", run dirs ->
// "<run-dir>", eval dirs -> "<eval-dir>", /var/folders|/tmp|/private/tmp
// -> "<tmp>".

const assert = require("node:assert/strict");
const { normalizeValue } = require("../dist/core/state/node-projection");

// Drops the 6 named timestamp-shaped keys.
{
  const input = {
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    recordedAt: "2020-01-01T00:00:00.000Z",
    selectedAt: "2020-01-01T00:00:00.000Z",
    replayedAt: "2020-01-01T00:00:00.000Z",
    generatedAt: "2020-01-01T00:00:00.000Z",
    keptField: "value",
  };
  const result = normalizeValue(input);
  assert.deepEqual(result, { keptField: "value" }, "all 6 named timestamp keys must be dropped, everything else kept");
}

// Sorts all object keys (recursively).
{
  const input = { z: 1, a: { y: 2, b: 3 } };
  const result = normalizeValue(input);
  assert.deepEqual(Object.keys(result), ["a", "z"], "top-level keys must be sorted");
  assert.deepEqual(Object.keys(result.a), ["b", "y"], "nested object keys must be sorted too");
}

// Full ISO timestamp strings inside VALUES are scrubbed to "<timestamp>".
{
  const result = normalizeValue({ note: "captured at 2020-06-15T12:30:45.123Z exactly" });
  assert.equal(result.note, "captured at <timestamp> exactly");
}

// Compact YYYYMMDDTHHMMSSZ timestamps are also scrubbed.
{
  const result = normalizeValue({ note: "file-20200615T123045Z.json" });
  assert.equal(result.note, "file-<timestamp>.json");
}

// Run-dir substrings (.../.cw/runs/<id>) are scrubbed to "<run-dir>".
{
  const result = normalizeValue({ path: "/Users/me/project/.cw/runs/demo-run-1/state.json" });
  assert.equal(result.path, "<run-dir>/state.json");
}

// Eval-dir substrings (.../.cw/evals/<id>) are scrubbed to "<eval-dir>".
{
  const result = normalizeValue({ path: "/Users/me/project/.cw/evals/eval-42/report.json" });
  assert.equal(result.path, "<eval-dir>/report.json");
}

// tmp-dir substrings (/var/folders/..., /tmp/..., /private/tmp/...) are
// scrubbed to "<tmp>".
{
  const a = normalizeValue({ path: "/var/folders/ab/xyz123/T/tmpfile" });
  assert.equal(a.path, "<tmp>");
  const b = normalizeValue({ path: "/tmp/some-temp-file.json" });
  assert.equal(b.path, "<tmp>");
  const c = normalizeValue({ path: "/private/tmp/another-temp-file.json" });
  assert.equal(c.path, "<tmp>");
}

// normalizeValue recurses into arrays, preserving array ORDER (only object
// keys are sorted, not array elements).
{
  const result = normalizeValue({ list: [{ z: 1, a: 2 }, "2020-01-01T00:00:00.000Z"] });
  assert.deepEqual(Object.keys(result.list[0]), ["a", "z"]);
  assert.equal(result.list[1], "<timestamp>");
}

// Primitives pass through untouched (numbers, booleans, null).
{
  assert.equal(normalizeValue(42), 42);
  assert.equal(normalizeValue(true), true);
  assert.equal(normalizeValue(null), null);
}

// A key ending in "Path"/"Dir", or exactly "path"/"cwd"/"runDir", is
// string-scrubbed even without matching a timestamp/tmp pattern (identity
// for a plain non-matching string, since normalizeString only rewrites
// matching substrings).
{
  const result = normalizeValue({ resultPath: "/some/plain/path/with/no/pattern" });
  assert.equal(result.resultPath, "/some/plain/path/with/no/pattern", "a path-shaped key with no scrubbable substring is unchanged");
}

process.stdout.write("statecore-normalize-value-scrubbing: ok\n");
