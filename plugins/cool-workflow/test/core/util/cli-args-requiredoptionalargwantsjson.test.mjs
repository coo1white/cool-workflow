#!/usr/bin/env node
// cliargs-requiredoptionalargwantsjson — pins required/optionalArg/wantsJson,
// the shared CLI argv / MCP tool-call arg-coercion helpers moved out of
// cli/io.ts into core/util/cli-args.ts (architecture-review P2, closing a
// wiring/-imports-cli/ purity-gate layer violation). Moved verbatim; this
// file is the split-off half of the old cli-io-smoke.mjs coverage for these
// three functions (see cli-io-smoke.mjs, which now pins only printJson).

import assert from "node:assert/strict";
import { required, optionalArg, wantsJson } from "../../../dist/core/util/cli-args.js";

// required: passthrough vs fail-with-tip.
assert.equal(required("run-1", "run id"), "run-1");
assert.throws(() => required(undefined, "run id"), /Missing run id\./);
assert.throws(() => required("", "run id"), /Missing run id\./);

// optionalArg: trim non-empty strings, else undefined.
assert.equal(optionalArg("  x  "), "x");
assert.equal(optionalArg("y"), "y");
assert.equal(optionalArg(""), undefined);
assert.equal(optionalArg("   "), undefined);
assert.equal(optionalArg(42), undefined);
assert.equal(optionalArg(undefined), undefined);

// wantsJson: --json or --format json.
assert.equal(wantsJson({ json: true }), true);
assert.equal(wantsJson({ format: "json" }), true);
assert.equal(wantsJson({ format: "human" }), false);
assert.equal(wantsJson({}), false);

process.stdout.write("cliargs-requiredoptionalargwantsjson: ok\n");
