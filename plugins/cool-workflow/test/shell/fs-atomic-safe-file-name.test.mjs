#!/usr/bin/env node
// fs-atomic-safe-file-name — a task id becomes one file-name segment. `:`
// is kept (the worker ids in state.json stay byte-identical); `/`, spaces
// and any other unsafe byte become `_`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { safeFileName } from "../../dist/shell/fs-atomic.js";
import { tmpDir } from "../helpers/workspace.mjs";

assert.equal(safeFileName("map:server-api"), "map:server-api");
assert.equal(safeFileName("verify/x y"), "verify_x_y");
for (const bad of ["a<b", "a>b", 'a"b', "a|b", "a?b", "a*b", "a\\b"]) {
  assert.match(safeFileName(bad), /^[A-Za-z0-9_.:-]+$/, `name for ${JSON.stringify(bad)}`);
}
assert.equal(safeFileName("map:server-api", "win32"), "map:server-api", "no platform argument: native Windows is not supported");
// The name it gives can be made here.
const dir = tmpDir("cw-safe-name-");
const made = path.join(dir, `worker-${safeFileName("map:server-api")}-0001`);
fs.mkdirSync(made);
assert.ok(fs.statSync(made).isDirectory());

process.stdout.write("fs-atomic-safe-file-name.test: ok\n");
