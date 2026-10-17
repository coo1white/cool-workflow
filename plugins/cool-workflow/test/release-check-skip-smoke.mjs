#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const releaseCheck = path.join(pluginRoot, "scripts", "release-check.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-release-check-skip-"));
const bin = path.join(tmp, "bin");
const log = path.join(tmp, "commands.log");
fs.mkdirSync(bin);

for (const name of ["npm", "node"]) {
  fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env sh\necho "${name} $*" >> "${log}"\nexit 0\n`);
  fs.chmodSync(path.join(bin, name), 0o755);
}

const result = spawnSync(process.execPath, [releaseCheck, "--skip-tests"], {
  cwd: pluginRoot,
  encoding: "utf8",
  env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ""}` },
});

assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /release:check tests \.\.\. skipped/);
assert.match(result.stdout, /- SKIP tests/);

const commands = fs.readFileSync(log, "utf8");
assert.doesNotMatch(commands, /npm run test:ci/, "skip-tests must not run the smoke suite twice");
assert.match(commands, /npm run dist:check/, "other release gates still run");
