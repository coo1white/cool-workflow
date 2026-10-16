#!/usr/bin/env node
// cli-args-coercemcpscalar — pins coerceMcpScalar, the one place an MCP
// tool-call argument is put into the CLI's string form. JSON `false` must
// stay a real `false`: its string form "false" is a non-empty string, so
// every `Boolean(args.x)` flag read took `{"write": false}` as ON
// (fail-open). Everything else keeps the old coercion byte for byte.

const assert = require("node:assert/strict");
const { coerceMcpScalar, parseBoolFlag } = require("../../../dist/core/util/cli-args");

// false stays a real boolean, so a plain Boolean() flag read is off ...
assert.equal(coerceMcpScalar(false), false);
assert.equal(Boolean(coerceMcpScalar(false)), false, "MCP false must read as OFF through Boolean()");
// ... and a tri-state reader still sees an explicit false, not "unset".
assert.equal(parseBoolFlag(coerceMcpScalar(false), "flag"), false);

// Unchanged coercion: true and numbers become the CLI's string form.
assert.equal(coerceMcpScalar(true), "true");
assert.equal(coerceMcpScalar(5), "5");
assert.equal(coerceMcpScalar(0), "0");
assert.equal(coerceMcpScalar(BigInt(7)), "7");

// Strings, arrays, objects, null and undefined pass through as is.
assert.equal(coerceMcpScalar("false"), "false", "a string \"false\" is the CLI's own form; not touched");
assert.equal(coerceMcpScalar("run-1"), "run-1");
const roles = ["a", "b"];
assert.equal(coerceMcpScalar(roles), roles);
const obj = { k: 1 };
assert.equal(coerceMcpScalar(obj), obj);
assert.equal(coerceMcpScalar(null), null);
assert.equal(coerceMcpScalar(undefined), undefined);

process.stdout.write("cli-args-coercemcpscalar: ok\n");
