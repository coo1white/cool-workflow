#!/usr/bin/env node
// pipelinecore-drivedecide-retryline — the `[drive] ✗` retry line handleHop
// prints when a hop fails and will be tried again (new in 0.3.3): a timeout
// reads `timed out after <short time>`, any other reason keeps the text past
// its label, and the count names the NEXT try out of maxAttempts.

import assert from "node:assert/strict";
import { hopRetryLine, shortDuration, shortHopReason, DEFAULT_SCHEDULING_POLICY } from "../../../dist/core/pipeline/drive-decide.js";

{
  assert.equal(shortDuration(600000), "10m");
  assert.equal(shortDuration(630000), "10m 30s");
  assert.equal(shortDuration(1000), "1s");
  assert.equal(shortDuration(45000), "45s");
  assert.equal(shortDuration(500), "500ms");
}

{
  assert.equal(
    shortHopReason("agent hop refused: map:api: refused (delegation-failed) — agent process timed out after 600000ms and was killed"),
    "timed out after 10m"
  );
  assert.equal(
    shortHopReason("agent hop refused: map:api: refused (delegation-failed) — agent process timed out after 600000ms and was killed (SIGKILL)"),
    "timed out after 10m",
    "the serial timeout words read the same"
  );
  assert.equal(
    shortHopReason("agent hop refused: map:api: refused (delegation-failed) — agent process returned no exit code (timed out or killed)"),
    "agent process returned no exit code (timed out or killed)"
  );
  assert.equal(shortHopReason("agent produced no result.md"), "agent produced no result.md", "a reason with no dash stays whole");
  const long = shortHopReason(`x — ${"a".repeat(300)}`);
  assert.equal(long.length, 120, "a long reason is cut to 120 characters");
  assert.ok(long.endsWith("…"));
}

{
  const reason = "agent hop refused: map:api: refused (delegation-failed) — agent process timed out after 600000ms and was killed";
  assert.equal(hopRetryLine("map:api", "Map", reason, 1, DEFAULT_SCHEDULING_POLICY), "✗ map:api (Map) — timed out after 10m; trying again (2/3)");
  assert.equal(hopRetryLine("map:api", "Map", reason, 2, { maxAttempts: 5 }), "✗ map:api (Map) — timed out after 10m; trying again (3/5)");
}

console.log("drivedecide-retryline: ok");
