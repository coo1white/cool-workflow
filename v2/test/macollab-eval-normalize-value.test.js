#!/usr/bin/env node
// macollab-eval-normalize-value — eval-replay.ts's normalizeValue: recursive
// key-sort, dropped timestamp keys, path-like key stringify+scrub (even
// when undefined -> literal "undefined"), the four scrub regexes.
//
// BYTE-COMPAT rebuild risk 9 [load-bearing]: "the exact dropped-key list
// and the four scrub regexes define snapshot compatibility; a changed
// regex makes every old snapshot fail parity."
//
// Evidence: SPEC/multi-agent.md "normalizeValue" row, "String scrubbing"
// section, edge case "normalizeValue stringifies path-like keys even when
// undefined (producing 'undefined')".

const assert = require("node:assert/strict");
const { normalizeValue, replayStableStringify } = require("../dist/core/multi-agent/eval-replay");

// normalizeValue: sorts object keys recursively.
{
  const result = normalizeValue({ z: 1, a: { y: 2, x: 3 } });
  assert.deepEqual(Object.keys(result), ["a", "z"], "top-level keys sorted");
  assert.deepEqual(Object.keys(result.a), ["x", "y"], "nested object keys sorted too");
}

// normalizeValue: drops the exact set of timestamp keys, at any nesting depth.
{
  const result = normalizeValue({ createdAt: "t1", updatedAt: "t2", recordedAt: "t3", selectedAt: "t4", replayedAt: "t5", generatedAt: "t6", keep: "yes" });
  assert.deepEqual(result, { keep: "yes" }, "all six named timestamp keys are dropped entirely, not just blanked");
}
{
  const nested = normalizeValue({ outer: { createdAt: "t1", other: "x" } });
  assert.deepEqual(nested, { outer: { other: "x" } }, "timestamp keys are dropped at any nesting depth");
}

// normalizeValue: a similarly-named key that is NOT in the exact dropped set survives (e.g. "startedAt").
{
  const result = normalizeValue({ startedAt: "t1", finishedAt: "t2" });
  assert.deepEqual(result, { finishedAt: "t2", startedAt: "t1" }, "only the exact 6 named timestamp keys are dropped; lookalikes like startedAt/finishedAt survive");
}

// normalizeValue: path-like keys (ending Path/Dir, or exactly path/cwd/runDir) are stringified + scrubbed.
// The scrub regex only replaces the matched .cw/runs/<id> (or tmp-root) SEGMENT — any trailing
// path component after it (e.g. "/state.json") is preserved literally, not swallowed.
{
  const result = normalizeValue({ statePath: "/Users/x/.cw/runs/run-1/state.json", cwd: "/Users/x/project", path: "/tmp/abc123/file.txt", outputDir: "/private/tmp/xyz" });
  assert.equal(result.statePath, "<run-dir>/state.json", "a *Path key pointing into .cw/runs/<id> has that segment scrubbed to <run-dir>, trailing /state.json preserved");
  assert.equal(result.cwd, "/Users/x/project", "cwd not matching any scrub pattern passes through as-is (still stringified)");
  assert.equal(result.path, "<tmp>", "the literal 'path' key value that IS entirely a /tmp/... path scrubs whole to <tmp>");
  assert.equal(result.outputDir, "<tmp>", "an *Dir key value that IS entirely a /private/tmp/... path scrubs whole to <tmp>");
}

// normalizeValue: path-like keys are stringified+scrubbed EVEN WHEN THE VALUE IS undefined — producing the literal string "undefined".
// This is a documented byte-exact edge case (rebuild risk 9 / edge cases list) — replays must reproduce it verbatim.
{
  const result = normalizeValue({ snapshotPath: undefined });
  assert.equal(result.snapshotPath, "undefined", "an undefined path-like key value becomes the literal string 'undefined', not dropped and not null");
  assert.equal(typeof result.snapshotPath, "string", "the byte-exact edge case produces an actual string, not the JS undefined value");
}

// normalizeValue: an eval-dir path is scrubbed distinctly from a run-dir path.
{
  const result = normalizeValue({ suiteDir: "/Users/x/.cw/evals/suite-1/artifacts" });
  assert.equal(result.suiteDir, "<eval-dir>/artifacts", "*Dir key pointing into .cw/evals/<id> has that segment scrubbed to <eval-dir> (distinct from <run-dir>), trailing path preserved");
}

// normalizeValue: arrays map element-wise, preserving order (arrays are never sorted, only object keys are).
{
  const result = normalizeValue([{ z: 1 }, { a: 1 }]);
  assert.equal(result.length, 2, "array length preserved");
  assert.deepEqual(Object.keys(result[0]), ["z"], "first element's own keys sorted (only one key here) — order of ARRAY ELEMENTS themselves is untouched");
  const orderCheck = normalizeValue([3, 1, 2]);
  assert.deepEqual(orderCheck, [3, 1, 2], "array element order is preserved exactly — normalizeValue never reorders arrays");
}

// normalizeValue: plain strings (not under a path-like key) get normalizeString scrubbing applied directly too.
{
  const timestamped = normalizeValue("Started at 20260703T120000Z and again 2026-07-03T12:00:00.000Z");
  assert.equal(timestamped, "Started at <timestamp> and again <timestamp>", "both timestamp regex forms are replaced with the literal <timestamp> placeholder");
}
{
  const runDirString = normalizeValue("see /Users/x/.cw/runs/run-42/state.json for detail");
  assert.equal(runDirString, "see <run-dir>/state.json for detail", "an inline .cw/runs/<id> path substring anywhere in a plain string has that segment scrubbed to <run-dir>, trailing path kept");
}
{
  const tmpString = normalizeValue("wrote to /var/folders/ab/xyz/T/file and /tmp/foo and /private/tmp/bar");
  assert.equal(tmpString, "wrote to <tmp> and <tmp> and <tmp>", "all three tmp-path forms (/var/folders, /tmp, /private/tmp) scrub to <tmp>");
}

// normalizeValue: non-string, non-object, non-array primitives pass through completely unchanged.
{
  assert.equal(normalizeValue(42), 42, "numbers pass through unchanged");
  assert.equal(normalizeValue(true), true, "booleans pass through unchanged");
  assert.equal(normalizeValue(null), null, "null passes through unchanged");
}

// replayStableStringify: JSON.stringify(normalizeValue(value)) exactly — same key-sort + drop + scrub rules apply before stringify.
{
  const a = replayStableStringify({ b: 1, a: 2, createdAt: "dropped" });
  const b = replayStableStringify({ a: 2, b: 1 });
  assert.equal(a, b, "two objects differing only in key order and a dropped timestamp key stringify identically");
  assert.equal(a, '{"a":2,"b":1}', "the exact stringified bytes match a hand-sorted equivalent object");
}

process.stdout.write("macollab-eval-normalize-value: ok\n");
