#!/usr/bin/env node
// helpers.test — the shared test helpers in test/helpers/ do what their
// headers say (refactor phase 3). Found by run-unit.mjs (`npm run test:unit`).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, tmpWorkspace } from "./workspace.mjs";
import { cw, CLI } from "./cw.mjs";
import { writeStubAgent } from "./stub-agent.mjs";
import { clearAgentEnv, AGENT_ENV_VARS } from "./env.mjs";

// workspace: realpath'd, README written, and gone after the process exits.
const work = tmpWorkspace("cw-helpers-test-");
assert.equal(work, fs.realpathSync(work));
assert.equal(fs.readFileSync(path.join(work, "README.md"), "utf8"), "# target\n");
const child = spawnSync(process.execPath, ["--input-type=module", "-e",
  `import { tmpDir } from ${JSON.stringify(path.join(import.meta.dirname, "workspace.mjs"))}; process.stdout.write(tmpDir("cw-helpers-exit-"));`], { encoding: "utf8" });
assert.equal(child.status, 0, child.stderr);
assert.ok(child.stdout.length > 0 && !fs.existsSync(child.stdout), "tmpDir folder is removed at exit");

// cw: spawns dist/cli.js with no shell; a run past the timeout is killed.
assert.ok(fs.existsSync(CLI), "CLI points at dist/cli.js");
const help = cw(["help"], { cwd: work });
assert.equal(help.status, 0, help.stderr);
const slow = cw(["help"], { cwd: work, timeout: 1 });
assert.equal(slow.error && slow.error.code, "ETIMEDOUT");

// stub-agent: writes a cw:result envelope and reports model and usage.
const scratch = tmpDir("cw-helpers-stub-");
const count = path.join(scratch, "count");
const stub = writeStubAgent(path.join(work, "stub.js"), { summary: "hi", model: "m1", usage: { input_tokens: 4, output_tokens: 2 }, countFile: count });
for (let i = 0; i < 2; i += 1) {
  const r = spawnSync(process.execPath, [stub, path.join(scratch, "result.md")], { cwd: work, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { model: "m1", usage: { input_tokens: 4, output_tokens: 2 } });
}
assert.equal(fs.readFileSync(count, "utf8"), "xx", "one mark per spawn");
const body = fs.readFileSync(path.join(scratch, "result.md"), "utf8");
const envelope = JSON.parse(body.split("cw:result\n")[1].split("\n")[0]);
assert.deepEqual(envelope, { summary: "hi", findings: [], evidence: [`${work}/README.md:1`] });
const plain = fs.readFileSync(writeStubAgent(path.join(scratch, "plain.js")), "utf8");
assert.ok(plain.includes('summary: "s"') && plain.includes("input_tokens: 1, output_tokens: 1") && !plain.includes("appendFileSync"));

// env: the agent vars and any extras go; CW_NO_AUTO_AGENT only on request.
for (const v of [...AGENT_ENV_VARS, "CW_APPS_DIR"]) process.env[v] = "x";
delete process.env.CW_NO_AUTO_AGENT;
clearAgentEnv();
for (const v of AGENT_ENV_VARS) assert.equal(process.env[v], undefined, v);
assert.equal(process.env.CW_APPS_DIR, "x");
assert.equal(process.env.CW_NO_AUTO_AGENT, undefined);
clearAgentEnv({ also: ["CW_APPS_DIR"], noAutoAgent: true });
assert.equal(process.env.CW_APPS_DIR, undefined);
assert.equal(process.env.CW_NO_AUTO_AGENT, "1");

process.stdout.write("helpers.test: ok\n");
