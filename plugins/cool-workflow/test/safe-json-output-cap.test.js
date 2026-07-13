#!/usr/bin/env node
// safe-json-output-cap (robustness) — safeJsonStringify, the shared
// byte-capped JSON.stringify behind both cli/io.ts's printJson and
// mcp/server.ts's tools/call content[0]. A result under the cap must be
// byte-identical to plain JSON.stringify(value, null, 2); a result over the
// cap (or one that throws while stringifying at all) must become a small,
// valid JSON overflow notice instead.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { safeJsonStringify, MAX_JSON_OUTPUT_BYTES } = require("../dist/core/format/safe-json");

const pluginRoot = path.resolve(__dirname, "..");

// A normal-sized result is untouched — byte-identical to plain JSON.stringify.
{
  const value = { hello: "world", nested: { a: [1, 2, 3] } };
  assert.equal(safeJsonStringify(value), JSON.stringify(value, null, 2), "under the cap must be byte-identical to plain JSON.stringify");
}

// The exported default cap is the documented 10MB.
{
  assert.equal(MAX_JSON_OUTPUT_BYTES, 10 * 1024 * 1024, "the default cap must be 10MB");
}

// Over an explicit small cap: a valid JSON overflow notice, not the payload.
{
  const value = { big: "x".repeat(1000) };
  const out = safeJsonStringify(value, 100);
  const parsed = JSON.parse(out);
  assert.equal(parsed.error, "result-too-large", "over-cap result must report result-too-large");
  assert.equal(parsed.capBytes, 100, "overflow notice must report the cap it was measured against");
  assert.ok(parsed.actualBytes > 100, "overflow notice must report the real (over-cap) size");
  assert.ok(!out.includes("xxxxxxxxxx"), "the real oversized payload must not appear in the output at all");
}

// At-or-under the cap, exactly, is NOT overflow (off-by-one safety).
{
  const value = "x".repeat(90); // JSON.stringify adds 2 quote bytes -> 92 bytes
  const exact = Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");
  const out = safeJsonStringify(value, exact);
  assert.equal(out, JSON.stringify(value, null, 2), "a result exactly at the cap must pass through unchanged");
}

// The real default cap (10MB), exercised with real data (not a mocked cap) —
// an 11MB string trips it under the actual production constant.
{
  const value = "y".repeat(11 * 1024 * 1024);
  const out = safeJsonStringify(value);
  const parsed = JSON.parse(out);
  assert.equal(parsed.error, "result-too-large", "an 11MB value must overflow the real default 10MB cap");
  assert.equal(parsed.capBytes, MAX_JSON_OUTPUT_BYTES);
}

// A value JSON.stringify cannot serialize AT ALL (throws, rather than
// producing an over-sized string) still yields a small, valid JSON notice —
// this is the code path a real pathological case (one big enough to blow
// V8's per-string ceiling) would hit; a circular reference is a cheap,
// deterministic stand-in that exercises the exact same catch branch.
{
  const circular = {};
  circular.self = circular;
  const out = safeJsonStringify(circular, 100);
  const parsed = JSON.parse(out);
  assert.equal(parsed.error, "result-too-large", "a value JSON.stringify cannot serialize must still produce a valid overflow notice");
  assert.ok(parsed.detail, "the underlying stringify error must be surfaced as detail");
  assert.equal(parsed.actualBytes, undefined, "actualBytes is unknown when stringify never completed");
}

// A value JSON.stringify turns into the literal JS value `undefined`
// (undefined itself, a function, or a Symbol — none of these throw) must
// not crash on the byte-length measurement that follows the try/catch.
// Matches the un-capped form's own pre-existing behavior for this edge
// case (content[0].text/printJson's template literal both end up printing
// "undefined") rather than treating it as a 0-length or invalid string.
{
  assert.equal(safeJsonStringify(undefined), undefined, "undefined must pass through unchanged, not throw");
  assert.equal(safeJsonStringify(() => {}), undefined, "a function must pass through unchanged, not throw");
  assert.equal(safeJsonStringify(Symbol("x")), undefined, "a Symbol must pass through unchanged, not throw");
}

// The overflow notice itself must stay small and bounded, regardless of how
// large the underlying error's message was — a validation error wrapping a
// huge stored/untrusted blackboard-message body must not turn the "small
// overflow notice" into another giant payload (or, in the extreme, into a
// second JSON.stringify call that itself throws uncaught).
{
  const hugeMessage = "z".repeat(5 * 1024 * 1024); // 5MB error message
  const thrower = { toJSON() { throw new Error(hugeMessage); } };
  const out = safeJsonStringify(thrower, 100);
  const parsed = JSON.parse(out);
  assert.equal(parsed.error, "result-too-large");
  assert.ok(parsed.detail.length < 1000, `overflow notice's detail must be truncated, got ${parsed.detail.length} chars`);
  assert.match(parsed.detail, /truncated/, "a truncated detail must say so");
  assert.ok(Buffer.byteLength(out, "utf8") < 2000, `the whole notice must stay small regardless of the 5MB input message, got ${out.length} bytes`);
}

// Both real outbound surfaces actually route through safeJsonStringify —
// not just this unit's own direct calls. MCP now renders in its private tool
// process before the control process writes the JSON-RPC reply.
{
  const ioSrc = fs.readFileSync(path.join(pluginRoot, "dist", "cli", "io.js"), "utf8");
  assert.match(ioSrc, /safeJsonStringify\)\(value\)/, "cli/io.js's printJson must call safeJsonStringify");
  const toolProcessSrc = fs.readFileSync(path.join(pluginRoot, "dist", "mcp", "tool-process.js"), "utf8");
  assert.match(toolProcessSrc, /safeJsonStringify\)\(result\)/, "mcp/tool-process.js must call safeJsonStringify before IPC");
}

process.stdout.write("safe-json-output-cap: ok\n");
