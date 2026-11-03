#!/usr/bin/env node
// agent-sandbox-srt-smoke — CW_AGENT_SANDBOX=srt (opt-in, 0.3.3): the agent
// runs inside Anthropic's sandbox runtime, `srt`, as an outside program
// (project/docs/intent/2026-11-02-agent-sandbox-srt.md; sandbox-profiles(7)).
//
// A stand-in `srt` (a node script) answers `--version` and, for a run,
// records its argv and settings file, then runs the agent it was given.
//   1. Off (unset): the agent is spawned as before; srt is never called.
//   2. On: the serial hop runs `srt -s <settings> -- <agent> <args...>`
//      ("--" so an agent arg like "-s x" is never srt's), the settings allow
//      writes to the worker's paths and the temp folder only, hide the secret
//      folders (~/.ssh, ~/.cw-keys, ...), and allow only the hosts given
//      (CW_AGENT_SANDBOX_HOSTS for a custom agent); the agent's result lands.
//   3. The concurrent (batch) path wraps its jobs the same way.
//   4. Fail closed: srt missing, the wrong srt version, or an unknown
//      CW_AGENT_SANDBOX value refuses the hop with a reason; the agent is
//      never run unsandboxed.
//   5. A bundled agent gets its vendor's hosts from the templates data.
//   7. The settings file is removed once the hop ends (serial and batch), the
//      hop's handle names what enforced it ("srt 0.0.81"), and a drive records
//      it as the worker.agent-sandbox trust-audit event (serial and
//      concurrent rounds).
//   6. cw doctor: an agent-sandbox row only when CW_AGENT_SANDBOX is set;
//      ok with a usable srt (and bwrap + socat on Linux), else fail with how
//      to fix it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const work = tmpDir("cw-sandbox-srt-");
const marks = path.join(work, "marks");
fs.mkdirSync(marks);

function fakeSrt(name, version) {
  const file = path.join(work, name);
  fs.writeFileSync(
    file,
    [
      "#!/usr/bin/env node",
      'const fs = require("fs"); const { spawnSync } = require("child_process");',
      "const argv = process.argv.slice(2);",
      `if (argv[0] === "--version") { process.stdout.write("${version}\\n"); process.exit(0); }`,
      'const settings = JSON.parse(fs.readFileSync(argv[1], "utf8"));',
      `fs.writeFileSync(${JSON.stringify(marks)} + "/" + Date.now() + "-" + process.pid + ".json", JSON.stringify({ argv, settings }));`,
      'const cut = argv.indexOf("--");',
      'const r = spawnSync(argv[cut + 1], argv.slice(cut + 2), { stdio: "inherit" });',
      "process.exit(r.status === null ? 1 : r.status);",
    ].join("\n"),
    { mode: 0o755 }
  );
  return file;
}
const goodSrt = fakeSrt("srt-good", "0.0.81");
const oldSrt = fakeSrt("srt-old", "0.0.80");

// The agent: writes a result and reports its model; takes "-s x" to prove "--".
const agent = path.join(work, "agent.js");
fs.writeFileSync(
  agent,
  [
    'const fs = require("fs");',
    "const result = process.argv[2];",
    "const fence = String.fromCharCode(96).repeat(3);",
    "fs.writeFileSync(result, fence + 'cw:result\\n' + JSON.stringify({ summary: 'sandboxed ok', findings: [], evidence: [] }) + '\\n' + fence + '\\n');",
    "process.stdout.write(JSON.stringify({ model: 'stub-srt', argv: process.argv.slice(3) }));",
  ].join("\n")
);

// Each case runs in a fresh process (srt lookups are cached per process).
function hop(env, batch = false) {
  const dir = fs.mkdtempSync(path.join(work, "hop-"));
  const script = `
    import { runBackend } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/execution-backend/registry.js"))};
    import { prepareAgentSpawn, runAgentBatchOutcomes } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/execution-backend/agent.js"))};
    import { showBundledSandboxProfile, sandboxContextForValidation } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/sandbox-profile.js"))};
    import path from "node:path";
    const dir = ${JSON.stringify(dir)};
    const workerDir = path.join(dir, "worker");
    const resultPath = path.join(workerDir, "result.md");
    const ctx = { ...sandboxContextForValidation(dir), workerDir, resultPath };
    const request = { schemaVersion: 1, backendId: "agent", cwd: dir, label: "hop",
      sandboxPolicy: showBundledSandboxProfile("readonly", ctx),
      manifest: { workerDir, resultPath, prompt: "x" },
      delegation: { command: process.execPath, args: [${JSON.stringify(agent)}, "{{result}}", "-s", "x"] } };
    import fs from "node:fs"; fs.mkdirSync(workerDir, { recursive: true });
    let out;
    if (${batch}) {
      const job = prepareAgentSpawn(request);
      out = { job: job && { binary: job.binary, args: job.args }, outcome: job && runAgentBatchOutcomes([job])[0] };
    } else {
      const env = runBackend(request);
      out = { status: env.status, summary: env.result.summary, wrote: fs.existsSync(resultPath), enforcedBy: env.provenance?.handle?.metadata?.sandboxEnforcedBy };
    }
    process.stdout.write(JSON.stringify(out));`;
  const childEnv = { ...process.env, HOME: path.join(work, "home"), ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete childEnv[k];
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: childEnv, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const records = () => fs.readdirSync(marks).sort().map((f) => JSON.parse(fs.readFileSync(path.join(marks, f), "utf8")));
const clearMarks = () => { for (const f of fs.readdirSync(marks)) fs.rmSync(path.join(marks, f)); };

try {
  // 1. off
  {
    const out = hop({ CW_AGENT_SANDBOX: undefined, CW_SRT_BIN: goodSrt });
    assert.equal(out.status, "completed", out.summary);
    assert.deepEqual(records(), [], "with the sandbox off, srt is never called");
  }
  // 2. on, serial
  {
    clearMarks();
    const out = hop({ CW_AGENT_SANDBOX: "srt", CW_SRT_BIN: goodSrt, CW_AGENT_SANDBOX_HOSTS: "api.example.test, *.example.test" });
    assert.equal(out.status, "completed", out.summary);
    assert.ok(out.wrote, "the sandboxed agent's result landed");
    const [rec] = records();
    assert.ok(rec, "srt was called");
    assert.equal(rec.argv[0], "-s");
    assert.equal(rec.argv[2], "--", "srt's options end before the agent's argv");
    assert.equal(rec.argv[3], process.execPath);
    assert.deepEqual(rec.argv.slice(-2), ["-s", "x"], "the agent's own -s reaches the agent");
    const home = path.join(work, "home");
    for (const dir of [".ssh", ".cw-keys", ".aws"]) assert.ok(rec.settings.filesystem.denyRead.includes(path.join(home, dir)), `hides ~/${dir}`);
    assert.ok(rec.settings.filesystem.allowWrite.includes(os.tmpdir()), "the temp folder is writable");
    assert.ok(rec.settings.filesystem.allowWrite.some((p) => p.endsWith(`${path.sep}worker`)), `the worker's own folder is writable (readonly has no writePaths): ${rec.settings.filesystem.allowWrite}`);
    assert.ok(!rec.settings.filesystem.allowWrite.includes(home), "the home folder is not writable");
    assert.deepEqual(rec.settings.network.allowedDomains, ["api.example.test", "*.example.test"], "only the hosts given");
    assert.equal(fs.existsSync(rec.argv[1]), false, "the settings file is removed once the hop ends");
    assert.equal(out.enforcedBy, "srt 0.0.81", "the handle names what enforced the hop");
  }
  // 3. batch
  {
    clearMarks();
    const out = hop({ CW_AGENT_SANDBOX: "srt", CW_SRT_BIN: goodSrt }, true);
    assert.equal(out.job.binary, goodSrt, "a concurrent job runs srt");
    assert.equal(out.job.args[2], "--");
    assert.equal(out.outcome.exitCode, 0, JSON.stringify(out.outcome));
    assert.equal(out.outcome.sandboxEnforcedBy, "srt 0.0.81", "a batch outcome names what enforced it");
    assert.equal(records().length, 1);
    assert.equal(fs.existsSync(records()[0].argv[1]), false, "a batch job's settings file is removed too");
  }
  // 4. fail closed
  {
    clearMarks();
    const missing = hop({ CW_AGENT_SANDBOX: "srt", CW_SRT_BIN: path.join(work, "no-such-srt") });
    assert.equal(missing.status, "refused");
    assert.match(missing.summary, /agent sandbox \(CW_AGENT_SANDBOX=srt\) is not usable: srt .* could not be run: ENOENT; install it with `npm i -g @anthropic-ai\/sandbox-runtime@0\.0\.81`/);
    assert.equal(missing.wrote, false, "the agent did not run");
    const old = hop({ CW_AGENT_SANDBOX: "srt", CW_SRT_BIN: oldSrt });
    assert.match(old.summary, /srt 0\.0\.80 found .*, CW needs 0\.0\.81/);
    assert.equal(old.wrote, false);
    const bad = hop({ CW_AGENT_SANDBOX: "yes", CW_SRT_BIN: goodSrt });
    assert.match(bad.summary, /CW_AGENT_SANDBOX="yes" is not known; use "srt"/);
    assert.equal(bad.wrote, false);
    const batchRefused = hop({ CW_AGENT_SANDBOX: "srt", CW_SRT_BIN: oldSrt }, true);
    assert.equal(batchRefused.job, undefined, "a refused batch job falls to the serial path, which refuses");
    assert.deepEqual(records(), [], "no agent ran in any of these");
  }
  // 5. vendor hosts for a bundled agent
  {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { agentSandboxVendor } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/agent-config.js"))};
      const claude = agentSandboxVendor("node", [${JSON.stringify(path.join(pluginRoot, "scripts/agents/claude-p-agent.js"))}, "{{input}}", "{{result}}"]);
      const direct = agentSandboxVendor("codex", ["exec"]);
      const custom = agentSandboxVendor("/usr/local/bin/my-review", ["{{input}}"]);
      process.stdout.write(JSON.stringify({ claude, direct, custom }));`], { encoding: "utf8" });
    const v = JSON.parse(r.stdout);
    // Exactly the templates data, element for element (not a substring match).
    const vendors = JSON.parse(fs.readFileSync(path.join(pluginRoot, "scripts/agents/builtin-templates.json"), "utf8")).sandbox.vendors;
    assert.deepEqual(v.claude, { name: "claude", ...vendors.claude });
    assert.equal(v.claude.hosts[0], "api.anthropic.com");
    assert.deepEqual(v.direct, { name: "codex", ...vendors.codex });
    assert.equal(v.direct.hosts[0], "api.openai.com");
    assert.deepEqual(v.custom, { hosts: [], write: [] }, "a custom agent gets no hosts by default");
  }
  // 7. a drive records what enforced each hop (serial, then a concurrent round)
  for (const concurrency of [1, 2]) {
    clearMarks();
    const repo = fs.mkdtempSync(path.join(work, "drive-"));
    fs.writeFileSync(path.join(repo, "README.md"), "# target\n");
    const stub = path.join(work, "drive-agent.js");
    fs.writeFileSync(stub, [
      'const fs = require("fs"); const fence = String.fromCharCode(96).repeat(3);',
      'fs.writeFileSync(process.argv[2], "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "s", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n");',
      'process.stdout.write(JSON.stringify({ model: "stub-drive" }));',
    ].join("\n"));
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { plan } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/pipeline.js"))};
      import { loadWorkflowApp } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/workflow-app-loader.js"))};
      import { drive } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/drive.js"))};
      import { loadRunFromCwd } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/run-store.js"))};
      import { listTrustAuditEvents } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/trust-audit.js"))};
      const run = plan(loadWorkflowApp("architecture-review"), { repo: process.cwd(), question: "Sound?" });
      const result = drive(run.id, process.cwd(), { concurrency: ${concurrency}, agentConfig: { schemaVersion: 1, command: process.execPath, args: [${JSON.stringify(stub)}, "{{result}}"], model: "m", source: "flag" } });
      const final = loadRunFromCwd(run.id, process.cwd());
      const events = listTrustAuditEvents(final).filter((e) => e.kind === "worker.agent-sandbox");
      process.stdout.write(JSON.stringify({ status: result.status, workers: final.tasks.length, events }));`],
      { cwd: repo, env: { ...process.env, HOME: path.join(work, "home"), CW_AGENT_SANDBOX: "srt", CW_SRT_BIN: goodSrt }, encoding: "utf8", timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, "complete", `concurrency ${concurrency}: ${r.stdout}`);
    assert.equal(out.events.length, records().length, `concurrency ${concurrency}: one worker.agent-sandbox event for each sandboxed hop`);
    assert.ok(out.events.length >= 2, `concurrency ${concurrency}: hops ran sandboxed`);
    for (const ev of out.events) {
      assert.equal(ev.decision, "enforced");
      assert.equal(ev.metadata.enforcedBy, "srt 0.0.81");
    }
    assert.ok(records().every((rec) => !fs.existsSync(rec.argv[1])), `concurrency ${concurrency}: every settings file was removed`);
  }
  // 6. doctor
  {
    const cli = path.join(pluginRoot, "dist", "cli.js");
    const doctorRow = (extra) => {
      const env = { ...process.env, HOME: path.join(work, "home"), CW_HOME: path.join(work, "cwhome"), CW_NO_AUTO_AGENT: "1", ...extra };
      for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
      const r = spawnSync(process.execPath, [cli, "doctor", "--json"], { cwd: work, env, encoding: "utf8", timeout: 60000 });
      return JSON.parse(r.stdout).checks.find((c) => c.name === "agent-sandbox");
    };
    assert.equal(doctorRow({ CW_AGENT_SANDBOX: undefined }), undefined, "no row when the sandbox is not asked for");
    const has = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0;
    const ok = doctorRow({ CW_AGENT_SANDBOX: "srt", CW_SRT_BIN: goodSrt });
    if (process.platform !== "linux" || (has("bwrap") && has("socat"))) {
      assert.equal(ok.status, "ok", JSON.stringify(ok));
      assert.match(ok.detail, /srt 0\.0\.81 .* will run each agent/);
    } else {
      assert.equal(ok.status, "fail", JSON.stringify(ok));
      assert.match(ok.detail, /needs .*not found on PATH; every agent hop would be refused/);
    }
    const old = doctorRow({ CW_AGENT_SANDBOX: "srt", CW_SRT_BIN: oldSrt });
    assert.equal(old.status, "fail");
    assert.match(old.detail, /srt 0\.0\.80 found/);
    const bad = doctorRow({ CW_AGENT_SANDBOX: "yes" });
    assert.equal(bad.status, "fail");
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("agent-sandbox-srt-smoke: ok");
