#!/usr/bin/env node
// pipelinecore-errorfeedback-record-dedup — buildFeedbackRecord's id
// formatting/severity/source derivation, feedbackKey's joined-key shape,
// and findExistingFeedback's dedup match rule. SPEC/pipeline-run.md "Error
// feedback — src/error-feedback.ts" (src/error-feedback.ts:109-168,
// 301-346, 417-432).

const assert = require("node:assert/strict");
const { buildFeedbackRecord, feedbackKey, findExistingFeedback, formatFeedbackId, summarizeFeedback } = require("../dist/core/pipeline/error-feedback");

const NOW = "2026-07-04T00:00:00.000Z";

// formatFeedbackId: feedback-<classification>-<4-digit-seq>.
{
  assert.equal(formatFeedbackId("runtime-error", 1), "feedback-runtime-error-0001");
  assert.equal(formatFeedbackId("verifier-failure", 42), "feedback-verifier-failure-0042");
}

// buildFeedbackRecord: id uses existingCount+1 (1-based), status "open",
// schemaVersion 1, classification/severity/source all derived correctly
// for a verifier-failure.
{
  const record = buildFeedbackRecord("run-1", { error: { code: "commit-verifier-not-found", message: "Verifier node not found: v1", at: NOW } }, 0, NOW);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.id, "feedback-verifier-failure-0001");
  assert.equal(record.runId, "run-1");
  assert.equal(record.status, "open");
  assert.equal(record.classification, "verifier-failure");
  assert.equal(record.severity, "high", "verifier-failure must be severity high");
  assert.equal(record.source, "verifier", "sourceFor(verifier-failure) defaults to 'verifier'");
  assert.equal(record.createdAt, NOW);
  assert.equal(record.updatedAt, NOW);
  assert.equal(record.code, "commit-verifier-not-found");
  assert.equal(record.retryable, false, "retryable defaults to false when neither input.retryable nor error.retryable is set");
}

// existingCount threading: a nonzero existingCount produces the NEXT
// sequence number, not always 0001.
{
  const record = buildFeedbackRecord("run-1", { error: "some string error" }, 5, NOW);
  assert.equal(record.id, "feedback-runtime-error-0006");
}

// input.source, when explicitly given, OVERRIDES sourceFor's derived
// default.
{
  const record = buildFeedbackRecord("run-1", { error: "boom", source: "cli" }, 0, NOW);
  assert.equal(record.source, "cli");
}

// sourceFor mapping for each classification bucket relevant to this
// bucket's own classifyFeedback rules.
{
  const contractRecord = buildFeedbackRecord("run-1", { error: { code: "invalid-contract-schema", message: "x", at: NOW } }, 0, NOW);
  assert.equal(contractRecord.source, "contract");
  const pipelineRecord = buildFeedbackRecord("run-1", { error: { code: "pipeline-stage-error", message: "x", at: NOW } }, 0, NOW);
  assert.equal(pipelineRecord.source, "pipeline-runner");
  const sandboxRecord = buildFeedbackRecord("run-1", { error: { code: "sandbox-denied", message: "x", at: NOW } }, 0, NOW);
  assert.equal(sandboxRecord.source, "contract", "sandbox-policy classification maps to source 'contract' too");
  const unknownRecord = buildFeedbackRecord("run-1", { error: { code: "totally-custom", message: "x", at: NOW } }, 0, NOW);
  assert.equal(unknownRecord.source, "manual", "the fallback default source is 'manual'");
}

// severityFor mapping across all classifications.
{
  const high1 = buildFeedbackRecord("run-1", { error: { code: "commit-verifier-not-found", message: "x", at: NOW } }, 0, NOW);
  assert.equal(high1.severity, "high");
  const high2 = buildFeedbackRecord("run-1", { error: { code: "invalid-contract-schema", message: "x", at: NOW } }, 0, NOW);
  assert.equal(high2.severity, "high");
  const medium1 = buildFeedbackRecord("run-1", { error: { code: "sandbox-denied", message: "x", at: NOW } }, 0, NOW);
  assert.equal(medium1.severity, "medium");
  const medium2 = buildFeedbackRecord("run-1", { error: { code: "illegal-transition", message: "x", at: NOW } }, 0, NOW);
  assert.equal(medium2.severity, "medium");
  const medium3 = buildFeedbackRecord("run-1", { error: { code: "missing-required-evidence", message: "x", at: NOW } }, 0, NOW);
  assert.equal(medium3.severity, "medium");
  const low1 = buildFeedbackRecord("run-1", { error: "generic" }, 0, NOW);
  assert.equal(low1.severity, "low", "runtime-error (unmatched) falls to the final else -> low");
}

// severityFor: missing-artifact/parse-error/pipeline-failure are "medium"
// when retryable, else "low".
{
  const retryableParse = buildFeedbackRecord("run-1", { error: { code: "result-parse-error", message: "x", at: NOW, retryable: true } }, 0, NOW);
  assert.equal(retryableParse.severity, "medium");
  const nonRetryableParse = buildFeedbackRecord("run-1", { error: { code: "result-parse-error", message: "x", at: NOW, retryable: false } }, 0, NOW);
  assert.equal(nonRetryableParse.severity, "low");
}

// input.retryable OVERRIDES error.retryable when both are present.
{
  const record = buildFeedbackRecord("run-1", { error: { code: "runtime-error", message: "x", at: NOW, retryable: false }, retryable: true }, 0, NOW);
  assert.equal(record.retryable, true);
}

// metadata compaction: undefined values are stripped; an all-undefined
// metadata object collapses to `undefined` (not an empty object).
{
  const record = buildFeedbackRecord("run-1", { error: "boom", metadata: { a: undefined, b: undefined } }, 0, NOW);
  assert.equal(record.metadata, undefined, "an all-undefined metadata input must collapse to undefined, not {}");
}
{
  const record = buildFeedbackRecord("run-1", { error: "boom", metadata: { a: "keep", b: undefined } }, 0, NOW);
  assert.deepEqual(record.metadata, { a: "keep" });
}

// feedbackKey: joined with the ASCII unit-separator char (U+001F) in the
// fixed field order runId,code,message,nodeId,stageId,contractId,path —
// missing fields fold to empty string before joining. This separator is
// byte-exact to the old build's own src/error-feedback.ts feedbackKey
// (confirmed there too), so it is preserved behavior, not an
// implementation detail to simplify away.
{
  const SEP = "\u001f";
  const key = feedbackKey({ runId: "r1", code: "c1", message: "m1" });
  assert.equal(key, ["r1", "c1", "m1", "", "", "", ""].join(SEP), "missing nodeId/stageId/contractId/path must fold to empty string, joined with the U+001F separator");
}
{
  const SEP = "\u001f";
  const full = feedbackKey({ runId: "r1", code: "c1", message: "m1", nodeId: "n1", stageId: "s1", contractId: "ct1", path: "p1" });
  assert.equal(full, ["r1", "c1", "m1", "n1", "s1", "ct1", "p1"].join(SEP));
}
{
  const SEP = "\u001f";
  assert.equal(feedbackKey({}), ["", "", "", "", "", "", ""].join(SEP), "an entirely empty input produces six U+001F separators between seven empty strings");
}
// The U+001F separator (not an empty join) keeps adjacent fields from
// colliding at their boundary: {code:"ab",message:"c"} vs {code:"a",message:"bc"}
// must produce DISTINCT keys.
{
  assert.notEqual(
    feedbackKey({ code: "ab", message: "c" }),
    feedbackKey({ code: "a", message: "bc" }),
    "the field separator must prevent boundary collisions between adjacent fields"
  );
}

// findExistingFeedback: matches only UNRESOLVED records (status !==
// "resolved") with identical {code,message,nodeId,stageId,contractId,path}.
{
  const existing = [
    { id: "f1", status: "open", code: "c1", message: "m1", nodeId: "n1", stageId: "s1", contractId: "ct1", path: "p1" },
    { id: "f2", status: "resolved", code: "c1", message: "m1", nodeId: undefined, stageId: undefined, contractId: undefined, path: undefined },
  ];
  const match = findExistingFeedback(existing, { code: "c1", message: "m1" }, "n1", "s1", "ct1", "p1");
  assert.equal(match.id, "f1");
}
{
  // A resolved record with the SAME key fields must NOT be returned — a
  // resolved issue can recur and gets a fresh record.
  const existing = [{ id: "f1", status: "resolved", code: "c1", message: "m1", nodeId: undefined, stageId: undefined, contractId: undefined, path: undefined }];
  const match = findExistingFeedback(existing, { code: "c1", message: "m1" }, undefined, undefined, undefined, undefined);
  assert.equal(match, undefined, "a resolved record must never be treated as an existing duplicate");
}
{
  // Differing on ANY one field (e.g. nodeId) means no match, even with the
  // rest identical.
  const existing = [{ id: "f1", status: "open", code: "c1", message: "m1", nodeId: "n1", stageId: "s1", contractId: "ct1", path: "p1" }];
  const match = findExistingFeedback(existing, { code: "c1", message: "m1" }, "n2", "s1", "ct1", "p1");
  assert.equal(match, undefined);
}

// summarizeFeedback: total/byStatus/bySeverity/byClassification counts.
{
  const records = [
    { status: "open", severity: "high", classification: "verifier-failure" },
    { status: "open", severity: "low", classification: "runtime-error" },
    { status: "resolved", severity: "high", classification: "verifier-failure" },
  ];
  const summary = summarizeFeedback(records);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.byStatus, { open: 2, resolved: 1 });
  assert.deepEqual(summary.bySeverity, { high: 2, low: 1 });
  assert.deepEqual(summary.byClassification, { "verifier-failure": 2, "runtime-error": 1 });
}
{
  const summary = summarizeFeedback([]);
  assert.equal(summary.total, 0);
  assert.deepEqual(summary.byStatus, {});
  assert.deepEqual(summary.bySeverity, {});
  assert.deepEqual(summary.byClassification, {});
}

process.stdout.write("pipelinecore-errorfeedback-record-dedup: ok\n");
