#!/usr/bin/env node
// cli-format-smoke: the CLI render helpers extracted from the old
// command-surface module's format module are pure string formatters, now
// spread across shell/*.ts. Pin their output so the god-object extraction stays behaviour-preserving.

import assert from "node:assert/strict";
import { humanBytes } from "../dist/shell/run-registry-io.js";

// humanBytes: byte → human scale.
assert.equal(humanBytes(0), "0B");
assert.equal(humanBytes(512), "512B");
assert.equal(humanBytes(1024), "1.0KiB");
assert.equal(humanBytes(1536), "1.5KiB");
assert.equal(humanBytes(1048576), "1.0MiB");
assert.equal(humanBytes(1073741824), "1.0GiB");

process.stdout.write("cli-format-smoke: ok\n");
