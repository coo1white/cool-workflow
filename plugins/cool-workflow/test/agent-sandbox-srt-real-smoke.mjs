#!/usr/bin/env node
// agent-sandbox-srt-real-smoke — CW_AGENT_SANDBOX=srt with the REAL srt
// (0.3.3; project/docs/intent/2026-11-02-agent-sandbox-srt.md). It runs only
// where srt 0.0.81 (CW_SRT_BIN, or srt on PATH) and, on Linux, bubblewrap and
// socat are there; elsewhere it says why and passes as skipped.
//
// One agent hop under the readonly profile, HOME set to a temp home that has
// a fake ~/.ssh/id_test:
//   - the agent writes its result.md in its worker folder: allowed;
//   - it tries to write into the repo folder: stopped by the sandbox;
//   - it tries to read ~/.ssh/id_test: stopped by the sandbox;
// and CW takes the result as usual.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const srt = process.env.CW_SRT_BIN || "srt";
const version = spawnSync(srt, ["--version"], { encoding: "utf8" });
const have = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).status === 0;
const why = version.error || version.status !== 0
  ? `no srt (${srt})`
  : !/0\.0\.81/.test(version.stdout)
    ? `srt is ${version.stdout.trim()}, not 0.0.81`
    : process.platform === "linux" && !(have("bwrap") && have("socat"))
      ? "bubblewrap or socat is not installed"
      : process.platform === "win32" ? "native Windows" : "";
if (why) {
  console.log(`agent-sandbox-srt-real-smoke: skipped (${why})`);
  process.exit(0);
}

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-srt-real-")));
try {
  const home = path.join(work, "home");
  const tmp = path.join(work, "tmp");
  const repo = path.join(work, "repo");
  for (const d of [path.join(home, ".ssh"), tmp, repo]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(home, ".ssh", "id_test"), "SECRET-KEY-TEXT\n");
  const agent = path.join(work, "agent.js");
  fs.writeFileSync(
    agent,
    [
      'const fs = require("fs"); const path = require("path");',
      "const [result, repo, key] = process.argv.slice(2);",
      "const tryIt = (fn) => { try { fn(); return 'allowed'; } catch (e) { return 'stopped:' + e.code; } };",
      "const wroteRepo = tryIt(() => fs.writeFileSync(path.join(repo, 'escape.txt'), 'x'));",
      "const readKey = tryIt(() => fs.readFileSync(key, 'utf8'));",
      "const fence = String.fromCharCode(96).repeat(3);",
      "fs.writeFileSync(result, fence + 'cw:result\\n' + JSON.stringify({ summary: 'srt-real ' + wroteRepo + ' ' + readKey, findings: [], evidence: [] }) + '\\n' + fence + '\\n');",
      "process.stdout.write(JSON.stringify({ model: 'stub-srt-real' }));",
    ].join("\n")
  );
  const script = `
    import { runBackend } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/execution-backend/registry.js"))};
    import { showBundledSandboxProfile, sandboxContextForValidation } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/sandbox-profile.js"))};
    import fs from "node:fs"; import path from "node:path";
    const repo = ${JSON.stringify(repo)};
    const workerDir = path.join(repo, ".cw", "runs", "r1", "workers", "w1");
    fs.mkdirSync(workerDir, { recursive: true });
    const resultPath = path.join(workerDir, "result.md");
    const env = runBackend({ schemaVersion: 1, backendId: "agent", cwd: repo, label: "real", timeoutMs: 60000,
      sandboxPolicy: showBundledSandboxProfile("readonly", { ...sandboxContextForValidation(repo), workerDir, resultPath }),
      manifest: { workerDir, resultPath, prompt: "x" },
      delegation: { command: process.execPath, args: [${JSON.stringify(agent)}, "{{result}}", repo, ${JSON.stringify(path.join(home, ".ssh", "id_test"))}] } });
    process.stdout.write(JSON.stringify({ status: env.status, summary: env.result.summary, enforcedBy: env.provenance?.handle?.metadata?.sandboxEnforcedBy, result: fs.existsSync(resultPath) ? fs.readFileSync(resultPath, "utf8") : null }));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, HOME: home, TMPDIR: tmp, CW_AGENT_SANDBOX: "srt", CW_SRT_BIN: srt },
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, "completed", `the sandboxed hop completed: ${out.summary}`);
  assert.ok(out.result, "the agent wrote its result.md in its worker folder");
  assert.match(out.result, /srt-real stopped:\w+ stopped:\w+/, `a write to the repo and a read of ~/.ssh were both stopped: ${out.result}`);
  assert.equal(fs.existsSync(path.join(repo, "escape.txt")), false, "nothing was written into the repo");
  assert.equal(out.enforcedBy, "srt 0.0.81", "the hop's handle names what enforced it");
  assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith("cw-srt-")), [], "the srt settings file was removed");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("agent-sandbox-srt-real-smoke: ok (real srt: worker write allowed, repo write and ~/.ssh read stopped)");
