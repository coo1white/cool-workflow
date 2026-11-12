#!/usr/bin/env node
// fs-atomic-safe-file-name — a task id becomes one file-name segment that
// the host OS can create. On Windows `:` marks an NTFS data stream, so
// mkdir("worker-map:server-api-0001") fails there (ENOENT) and every run
// stopped at its first worker. POSIX keeps `:` (the worker ids in state.json
// stay byte-identical); win32 maps it to `_` like any other unsafe byte.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { safeFileName } from "../../dist/shell/fs-atomic.js";
import { tmpDir } from "../helpers/workspace.mjs";

assert.equal(safeFileName("map:server-api", "linux"), "map:server-api");
assert.equal(safeFileName("map:server-api", "darwin"), "map:server-api");
assert.equal(safeFileName("map:server-api", "win32"), "map_server-api");
assert.equal(safeFileName("verify/x y", "linux"), "verify_x_y");
assert.equal(safeFileName("verify/x y", "win32"), "verify_x_y");
for (const bad of ["a<b", "a>b", 'a"b', "a|b", "a?b", "a*b", "a\\b", "a:b"]) {
  assert.match(safeFileName(bad, "win32"), /^[A-Za-z0-9_.-]+$/, `win32 name for ${JSON.stringify(bad)}`);
}
// The default is this host, and the name it gives can be made here.
const dir = tmpDir("cw-safe-name-");
const made = path.join(dir, `worker-${safeFileName("map:server-api")}-0001`);
fs.mkdirSync(made);
assert.ok(fs.statSync(made).isDirectory());
assert.equal(safeFileName("map:server-api"), safeFileName("map:server-api", process.platform));

process.stdout.write("fs-atomic-safe-file-name.test: ok\n");
