#!/usr/bin/env node
// statecore-schema-validate-stderr-diagnostic (milestone 3) — pins the
// stderr diagnostic for unsupported keywords: written ONLY when
// process.stderr.isTTY, exact format "[cw] schema at <path>: unsupported
// keywords ignored: <list>\n". SPEC/state-core.md "stderr (TTY only): '[cw]
// schema at <path>: unsupported keywords ignored: <k1, k2>\n'".
//
// This is a pure function of (value, schema, path) plus the AMBIENT
// process.stderr.isTTY flag/write call — we do not touch a real terminal;
// instead we monkeypatch process.stderr.isTTY and .write for the duration
// of this in-memory check, then restore them. No child process, no real
// file/tty is touched.

const assert = require("node:assert/strict");
const { validateAgainstSchema } = require("../dist/core/state/schema-validate");

const originalIsTTY = process.stderr.isTTY;
const originalWrite = process.stderr.write;

function withStderr(isTTY, fn) {
  process.stderr.isTTY = isTTY;
  const writes = [];
  process.stderr.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.isTTY = originalIsTTY;
    process.stderr.write = originalWrite;
  }
  return writes;
}

// When isTTY is true, an unsupported keyword produces exactly one stderr
// write with the exact format.
{
  let capturedErrors;
  const writes = withStderr(true, () => {
    capturedErrors = validateAgainstSchema("x", { pattern: "^[0-9]+$" }, "$.field");
  });
  assert.deepEqual(capturedErrors, [], "unsupported keywords never produce a validation error");
  assert.equal(writes.length, 1, "exactly one stderr write must occur when isTTY is true");
  assert.equal(writes[0], "[cw] schema at $.field: unsupported keywords ignored: pattern\n");
}

// When isTTY is false (or undefined, e.g. piped output), NO stderr write
// occurs at all.
{
  const writes = withStderr(false, () => {
    validateAgainstSchema("x", { pattern: "^[0-9]+$" });
  });
  assert.deepEqual(writes, [], "no stderr write must occur when isTTY is false");
}
{
  const writes = withStderr(undefined, () => {
    validateAgainstSchema("x", { pattern: "^[0-9]+$" });
  });
  assert.deepEqual(writes, [], "no stderr write must occur when isTTY is undefined");
}

// Multiple unsupported keywords are joined with ", " in declaration order
// (Object.keys order).
{
  const writes = withStderr(true, () => {
    validateAgainstSchema("x", { pattern: "^a$", format: "email" });
  });
  assert.equal(writes[0], "[cw] schema at $: unsupported keywords ignored: pattern, format\n");
}

// A schema with ONLY supported keywords produces no stderr write even when
// isTTY is true.
{
  const writes = withStderr(true, () => {
    validateAgainstSchema("x", { type: "string" });
  });
  assert.deepEqual(writes, []);
}

process.stdout.write("statecore-schema-validate-stderr-diagnostic: ok\n");
