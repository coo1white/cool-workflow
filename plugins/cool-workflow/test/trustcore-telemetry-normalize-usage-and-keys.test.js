#!/usr/bin/env node
// trustcore-telemetry-normalize-usage-and-keys — pins
// normalizeReportedUsage's snake_case/camelCase tolerance (never invents a
// number — unreported bucket stays undefined, never 0) and
// resolveTrustPublicKey's inline-PEM-vs-path resolution (SPEC/ledger-
// trust.md "normalizeReportedUsage accepts snake_case and camelCase token
// keys ... an unreported bucket stays undefined, never 0"; "resolveTrustPublicKey
// accepts an inline PEM ... or a file path; anything unreadable resolves to
// undefined").

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeReportedUsage,
  resolveTrustPublicKey,
} = require("../dist/core/trust/telemetry-attestation");

// undefined usage -> {} (no buckets invented).
{
  assert.deepEqual(normalizeReportedUsage(undefined), {});
}

// camelCase keys map directly.
{
  const result = normalizeReportedUsage({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 30 });
  assert.deepEqual(result, { inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 30 });
}

// snake_case keys map onto the same camelCase buckets.
{
  const result = normalizeReportedUsage({ input_tokens: 10, output_tokens: 20, cache_read_tokens: 3, cache_write_tokens: 4, total_tokens: 30 });
  assert.deepEqual(result, { inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 30 });
}

// Alternate aliases: promptTokens/prompt_tokens -> inputTokens;
// completionTokens/completion_tokens -> outputTokens.
{
  const a = normalizeReportedUsage({ promptTokens: 5 });
  assert.equal(a.inputTokens, 5);
  const b = normalizeReportedUsage({ prompt_tokens: 6 });
  assert.equal(b.inputTokens, 6);
  const c = normalizeReportedUsage({ completionTokens: 7 });
  assert.equal(c.outputTokens, 7);
  const d = normalizeReportedUsage({ completion_tokens: 8 });
  assert.equal(d.outputTokens, 8);
}

// Alternate cache aliases: cacheReadInputTokens/cache_read_input_tokens,
// cacheCreationInputTokens/cache_creation_input_tokens.
{
  const a = normalizeReportedUsage({ cacheReadInputTokens: 1 });
  assert.equal(a.cacheReadTokens, 1);
  const b = normalizeReportedUsage({ cache_read_input_tokens: 2 });
  assert.equal(b.cacheReadTokens, 2);
  const c = normalizeReportedUsage({ cacheCreationInputTokens: 3 });
  assert.equal(c.cacheWriteTokens, 3);
  const d = normalizeReportedUsage({ cache_creation_input_tokens: 4 });
  assert.equal(d.cacheWriteTokens, 4);
}

// An unreported bucket stays undefined, never coerced to 0 — the critical
// "never invents a number" invariant.
{
  const result = normalizeReportedUsage({ input_tokens: 10 });
  assert.equal(result.inputTokens, 10);
  assert.equal(result.outputTokens, undefined, "an unreported bucket must be undefined, not 0");
  assert.equal(result.cacheReadTokens, undefined);
  assert.equal(result.cacheWriteTokens, undefined);
  assert.equal(result.totalTokens, undefined);
  assert.ok(!("outputTokens" in result) || result.outputTokens === undefined);
}

// Numeric-string values ARE accepted (Number() coercion is tolerated).
{
  const result = normalizeReportedUsage({ input_tokens: "42" });
  assert.equal(result.inputTokens, 42);
}

// A genuinely non-numeric value (e.g. a word) must NOT be coerced to some
// garbage number — stays undefined (Number.isFinite guards this).
{
  const result = normalizeReportedUsage({ input_tokens: "not-a-number" });
  assert.equal(result.inputTokens, undefined);
}

// Zero IS a legal reported value (distinct from "not reported") — the
// function must not confuse 0 with absence.
{
  const result = normalizeReportedUsage({ input_tokens: 0 });
  assert.equal(result.inputTokens, 0, "an explicit 0 must be preserved, not treated as absent");
}

// --- resolveTrustPublicKey ---

// undefined/empty -> undefined.
{
  assert.equal(resolveTrustPublicKey(undefined), undefined);
  assert.equal(resolveTrustPublicKey(""), undefined);
  assert.equal(resolveTrustPublicKey("   "), undefined, "whitespace-only value must trim to empty and resolve to undefined");
}

// An inline PEM (detected by BEGIN + KEY substrings) is returned trimmed,
// as-is — no file access attempted.
{
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" });
  const withWhitespace = `  ${pem}  `;
  const result = resolveTrustPublicKey(withWhitespace);
  assert.equal(result, pem.trim ? pem.trim() : pem, "an inline PEM must come back trimmed");
  assert.ok(result.includes("BEGIN"));
}

// A path to a real, readable .pem file is read and its contents returned.
{
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" });
  const tmpFile = path.join(os.tmpdir(), `trustcore-test-key-${process.pid}-${Date.now()}.pem`);
  fs.writeFileSync(tmpFile, pem, "utf8");
  try {
    const result = resolveTrustPublicKey(tmpFile);
    assert.equal(result, pem, "a valid key file path must resolve to its exact file contents");
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

// A path to a nonexistent file -> undefined (never throws).
{
  const result = resolveTrustPublicKey("/definitely/does/not/exist/key.pem");
  assert.equal(result, undefined);
}

// A non-PEM, non-existent-path string (garbage) -> undefined, never throws.
{
  assert.doesNotThrow(() => resolveTrustPublicKey("just some garbage text"));
  assert.equal(resolveTrustPublicKey("just some garbage text"), undefined);
}

process.stdout.write("trustcore-telemetry-normalize-usage-and-keys: ok\n");
