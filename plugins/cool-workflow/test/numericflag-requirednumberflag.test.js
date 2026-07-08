#!/usr/bin/env node
// numericflag-requirednumberflag — requiredNumberFlag, the one strict
// numeric-CLI/MCP-flag parser (e.g. `--limit <n>`). Several shell/*.ts call
// sites used to each reimplement this ad-hoc, every one sharing the same
// `Number(true) === 1` bug for a bare flag (parseargv turns a valueless
// `--limit` into boolean true), or a `value || fallback` pattern that ALSO
// silently swallows a genuine 0 (and a NaN from a bad string, since NaN is
// falsy too).

const assert = require("node:assert/strict");
const { requiredNumberFlag } = require("../dist/core/util/numeric-flag");

// Absent (undefined/null) -> undefined, so the caller's own default applies.
{
  assert.equal(requiredNumberFlag(undefined, "--limit"), undefined, "undefined must stay undefined");
  assert.equal(requiredNumberFlag(null, "--limit"), undefined, "null must stay undefined");
}

// A bare flag (parseargv turns `--limit` alone into boolean true) throws,
// never silently becomes 1 (Number(true) === 1).
{
  assert.throws(() => requiredNumberFlag(true, "--limit"), /--limit requires a value/, "a bare flag must throw, not become 1");
  assert.throws(() => requiredNumberFlag(false, "--limit"), /--limit requires a value/, "a bare false-valued flag must also throw");
}

// An unparseable value throws, naming the actual value given.
{
  assert.throws(() => requiredNumberFlag("abc", "--limit"), /Invalid --limit "abc": expected a number/, "garbage must throw and name the value");
  assert.throws(() => requiredNumberFlag("NaN", "--limit"), /Invalid --limit/, "the literal string NaN must throw too");
}

// A genuine 0 is preserved -- never silently replaced by a fallback.
{
  assert.equal(requiredNumberFlag(0, "--limit"), 0, "0 must be returned as 0, not treated as absent");
  assert.equal(requiredNumberFlag("0", "--limit"), 0, "the string \"0\" must parse to 0");
}

// A negative number is returned as-is -- clamping (if any) is the call
// site's job, not this parser's.
{
  assert.equal(requiredNumberFlag(-5, "--limit"), -5);
}

// A normal numeric string or number parses correctly.
{
  assert.equal(requiredNumberFlag("7", "--limit"), 7);
  assert.equal(requiredNumberFlag(7, "--limit"), 7);
}

process.stdout.write("numericflag-requirednumberflag: ok\n");
