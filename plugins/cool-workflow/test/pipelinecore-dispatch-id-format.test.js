#!/usr/bin/env node
// pipelinecore-dispatch-id-format — formatDispatchId: dispatch-<STAMP>-<seq>
// (STAMP = ISO with -/: stripped, sub-second cut) and the
// CW_DETERMINISTIC_RUN_IDS-equivalent deterministic form dispatch-<seq>.
// SPEC/pipeline-run.md "Dispatch — src/dispatch.ts" (src/dispatch.ts:225-232)
// and "Deterministic id formats".

const assert = require("node:assert/strict");
const { formatDispatchId } = require("../dist/core/pipeline/dispatch");

// Non-deterministic form: dispatch-<STAMP>-<4-digit-seq>. STAMP strips all
// "-" and ":" then cuts everything from "." onward, replacing it with "Z".
{
  const id = formatDispatchId(1, "2026-07-03T10:15:01.000Z", false);
  assert.equal(id, "dispatch-20260703T101501Z-0001");
}

// Deterministic form ignores `now` entirely: dispatch-<seq>.
{
  const id = formatDispatchId(1, "2026-07-03T10:15:01.000Z", true);
  assert.equal(id, "dispatch-0001");
}

// seq is always zero-padded to 4 digits, even past 9999 (padStart does not
// truncate, so a 5-digit seq is not clipped — it just isn't padded further).
{
  assert.equal(formatDispatchId(7, "2026-01-01T00:00:00.000Z", true), "dispatch-0007");
  assert.equal(formatDispatchId(42, "2026-01-01T00:00:00.000Z", true), "dispatch-0042");
  assert.equal(formatDispatchId(10000, "2026-01-01T00:00:00.000Z", true), "dispatch-10000");
}

// The STAMP transform strips ALL "-" and ":" occurrences, not just the
// date/time separators (in practice `now` is a plain ISO string so this
// only affects the expected places, but the regex is global).
{
  const id = formatDispatchId(1, "2026-01-01T00:00:00.123Z", false);
  assert.equal(id, "dispatch-20260101T000000Z-0001", "sub-second fraction must be cut and replaced with a bare Z");
}

// A `now` string with no sub-second fraction at all (already clean) still
// gets a trailing Z appended correctly because the regex replaces
// everything from the first "." onward; verify no double "Z".
{
  const id = formatDispatchId(1, "2026-01-01T00:00:00Z", false);
  assert.equal(id, "dispatch-20260101T000000Z-0001");
}

process.stdout.write("pipelinecore-dispatch-id-format: ok\n");
