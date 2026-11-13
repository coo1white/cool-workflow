#!/usr/bin/env node
// helpers.test — the shared test helpers in test/helpers/ do what their
// headers say (refactor phase 3). Found by run-unit.mjs (`npm run test:unit`).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tmpDir, tmpWorkspace } from "./workspace.mjs";
import { cw, CLI } from "./cw.mjs";
import { writeStubAgent } from "./stub-agent.mjs";
import { clearAgentEnv, AGENT_ENV_VARS } from "./env.mjs";
import { writeProgram } from "./program.mjs";
import { spawnArgv } from "../../dist/core/util/cli-args.js";

// workspace: realpath'd, README written, and gone after the process exits.
const work = tmpWorkspace("cw-helpers-test-");
assert.equal(work, fs.realpathSync(work));
assert.equal(fs.readFileSync(path.join(work, "README.md"), "utf8"), "# target\n");
const child = spawnSync(process.execPath, ["--input-type=module", "-e",
  `import { tmpDir } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, "workspace.mjs")).href)}; process.stdout.write(tmpDir("cw-helpers-exit-"));`], { encoding: "utf8" });
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

// program: a node program on PATH that runs here, and on Windows is started
// through its .cmd shim as `node <file>` (proved with spawnArgv's win32
// branch over the real files, `\` read as `/`).
const bin = tmpDir("cw-helpers-bin-");
const prog = writeProgram(bin, "fakecli", 'process.stdout.write("ran " + process.argv.slice(2).join(","));');
assert.equal(prog, path.join(bin, "fakecli"));
assert.ok(fs.readFileSync(prog, "utf8").startsWith("#!/usr/bin/env node\n"));
const ran = spawnSync(process.execPath, [prog, "a", "b"], { encoding: "utf8" });
assert.equal(ran.stdout, "ran a,b");
if (process.platform !== "win32") {
  assert.equal(fs.statSync(prog).mode & 0o111, 0o111, "executable on POSIX");
  assert.equal(fs.existsSync(`${prog}.cmd`), false, "no .cmd off Windows");
  assert.equal(spawnSync(prog, ["c"], { encoding: "utf8" }).stdout, "ran c", "starts by name on POSIX");
}
writeProgram(bin, "wincli", "process.exit(0);", { platform: "win32" });
const posix = (file) => file.replace(/\\/g, "/");
const winIo = { isFile: (file) => fs.existsSync(posix(file)) && fs.statSync(posix(file)).isFile(), readText: (file) => fs.readFileSync(posix(file), "utf8") };
const started = spawnArgv("wincli", ["x"], { PATH: bin.replace(/\//g, "\\"), PATHEXT: ".exe;.cmd" }, "win32", "NODE", winIo);
assert.deepEqual({ binary: started.binary, args: [posix(started.args[0]), ...started.args.slice(1)] }, { binary: "NODE", args: [posix(path.join(bin, "wincli")), "x"] });

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
