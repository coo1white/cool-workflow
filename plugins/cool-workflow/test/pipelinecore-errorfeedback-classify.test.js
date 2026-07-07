#!/usr/bin/env node
// pipelinecore-errorfeedback-classify — classifyFeedback's fixed
// classification order and severityFor's mapping. SPEC/pipeline-run.md
// "Error feedback — src/error-feedback.ts" (src/error-feedback.ts:170-186,
// 330-338).

const assert = require("node:assert/strict");
const { classifyFeedback } = require("../dist/core/pipeline/error-feedback");

const NOW = "2026-07-04T00:00:00.000Z";

// missing-artifact: code containing the literal substring "missing-artifact"
// or "artifact-path". Note the real SPEC code is "missing-required-artifact"
// (SPEC/pipeline-run.md's contract error codes), which does NOT contain the
// substring "missing-artifact" (the word "required" splits it) — it matches
// via "artifact-path" instead only when that second substring is present.
{
  assert.equal(classifyFeedback({ code: "missing-artifact-x", message: "x", at: NOW }), "missing-artifact", "a code literally containing missing-artifact must classify as missing-artifact");
  assert.equal(classifyFeedback({ code: "missing-artifact-path", message: "x", at: NOW }), "missing-artifact", "missing-artifact-path contains both trigger substrings");
  assert.equal(classifyFeedback({ code: "some-artifact-path-issue", message: "x", at: NOW }), "missing-artifact", "artifact-path alone (without missing-artifact) is also a trigger substring");
}

// The real contract error code "missing-required-artifact" (SPEC's actual
// spelling) does NOT contain the literal substring "missing-artifact" (the
// word "required" splits the two halves) and also does NOT contain
// "artifact-path" — so it falls through to "unknown", not
// "missing-artifact". This byte-exact quirk is carried forward from the
// OLD build's own src/error-feedback.ts:176 (same substring check), so it
// is preserved behavior, not a v2 regression — pinned here so a future
// "cleanup" of the substring list does not silently change classification.
{
  assert.equal(
    classifyFeedback({ code: "missing-required-artifact", message: "x", at: NOW }),
    "unknown",
    "missing-required-artifact does not literally contain missing-artifact or artifact-path"
  );
}

// missing-evidence: code containing "missing-required-evidence" or
// "missing-evidence".
{
  assert.equal(classifyFeedback({ code: "missing-required-evidence", message: "x", at: NOW }), "missing-evidence");
  assert.equal(classifyFeedback({ code: "missing-evidence-foo", message: "x", at: NOW }), "missing-evidence");
}

// verifier-failure: code contains "verifier" OR context.stageId==="verify"
// OR context.source==="verifier" — checked in FIXED ORDER before
// state-transition/contract-violation, so it must win even when the code
// ALSO looks like it could match a later rule.
{
  assert.equal(classifyFeedback({ code: "commit-verifier-not-found", message: "x", at: NOW }), "verifier-failure");
  assert.equal(classifyFeedback({ code: "some-runtime-error", message: "x", at: NOW }, { stageId: "verify" }), "verifier-failure");
  assert.equal(classifyFeedback({ code: "some-runtime-error", message: "x", at: NOW }, { source: "verifier" }), "verifier-failure");
}

// state-transition: code contains "illegal-transition" or "state-transition".
{
  assert.equal(classifyFeedback({ code: "illegal-transition", message: "x", at: NOW }), "state-transition");
  assert.equal(classifyFeedback({ code: "custom-state-transition-x", message: "x", at: NOW }), "state-transition");
}

// contract-violation: code contains "contract" or "unexpected-node" OR a
// contractId is present in context.
{
  assert.equal(classifyFeedback({ code: "invalid-contract-schema", message: "x", at: NOW }), "contract-violation");
  assert.equal(classifyFeedback({ code: "unexpected-node-kind", message: "x", at: NOW }), "contract-violation");
  assert.equal(classifyFeedback({ code: "some-runtime-error", message: "x", at: NOW }, { contractId: "cw.pipeline.default" }), "contract-violation");
}

// sandbox-policy: code STARTS WITH "sandbox-" (a code merely containing
// "sandbox-" in the middle must NOT match — startsWith, not includes).
{
  assert.equal(classifyFeedback({ code: "sandbox-denied", message: "x", at: NOW }), "sandbox-policy");
  assert.equal(classifyFeedback({ code: "custom-sandbox-denied", message: "x", at: NOW }), "unknown", "a code with sandbox- NOT at the start must not classify as sandbox-policy (falls through to unknown, since the code isn't literally 'runtime-error')");
}

// parse-error: code contains "parse" or "json".
{
  assert.equal(classifyFeedback({ code: "result-parse-error", message: "x", at: NOW }), "parse-error");
  assert.equal(classifyFeedback({ code: "bad-json-input", message: "x", at: NOW }), "parse-error");
}

// pipeline-failure: code contains "pipeline".
{
  assert.equal(classifyFeedback({ code: "pipeline-stage-error", message: "x", at: NOW }), "pipeline-failure");
}

// runtime-error: normalized code is EXACTLY "runtime-error" (a string
// input or a bare Error both normalize to this code).
{
  assert.equal(classifyFeedback("plain string error"), "runtime-error");
  assert.equal(classifyFeedback(new Error("generic failure")), "runtime-error");
}

// unknown: a code that matches none of the fixed rules and isn't the
// literal "runtime-error".
{
  assert.equal(classifyFeedback({ code: "totally-custom-code", message: "x", at: NOW }), "unknown");
}

// Fixed ORDER proof: missing-artifact must win over verifier-failure even
// when a code technically could match both (missing-artifact is checked
// FIRST).
{
  assert.equal(classifyFeedback({ code: "missing-artifact-verifier-thing", message: "x", at: NOW }), "missing-artifact");
}

// Fixed ORDER proof: verifier-failure must win over contract-violation
// when a contractId is ALSO present alongside a verifier-shaped code.
{
  assert.equal(
    classifyFeedback({ code: "commit-verifier-not-found", message: "x", at: NOW }, { contractId: "cw.pipeline.default" }),
    "verifier-failure",
    "verifier-failure is checked before contract-violation in the fixed order"
  );
}

// codeFromError: an Error whose MESSAGE matches known patterns gets
// mapped to a specific code before classification runs.
{
  assert.equal(classifyFeedback(new Error("Invalid cw:result JSON: bad token")), "parse-error", "result-parse-error code classifies as parse-error");
  assert.equal(classifyFeedback(new Error("Task requires cw:result evidence")), "missing-evidence");
  assert.equal(classifyFeedback(new Error("Phase gate blocked: reason")), "unknown", "phase-gate-blocked has no dedicated classification rule, falls to unknown");
}

process.stdout.write("pipelinecore-errorfeedback-classify: ok\n");
