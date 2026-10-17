#!/usr/bin/env node
// doctor-agent-probe-smoke — `cw doctor`'s agent-runs check (new in 0.3.3).
// Doctor runs the configured vendor CLI once with `--version` (argv-style, a
// short timeout, the same child env a real agent gets) and fails closed when
// it cannot run. Stub binaries on PATH stand in for the vendor CLI:
//   (a) a broken install (exit 1, its own fix hint) -> fail, hint shown, not ready
//   (b) a working CLI -> ok line with its first output line
//   (c) a CLI that hangs -> fail as a timeout, doctor comes back fast
//   (d) a custom CW_AGENT_COMMAND -> "not probed", and it is never run
//   (e) the other checks are the same whatever the probe says
//
// Included in `npm test`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-probe-")));
const home = path.join(base, "home");
const cwd = path.join(base, "work");
const marks = path.join(base, "marks");
for (const d of [home, cwd, marks]) fs.mkdirSync(d, { recursive: true });

function stubDir(name, files) {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [bin, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, bin), `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  }
  return dir;
}

const BROKEN = [
  "Error: claude native binary not installed.",
  "Either postinstall did not run (--ignore-scripts, some pnpm configs) or the platform-native optional dependency was not downloaded (--omit=optional).",
  "Run the postinstall manually (adjust path for local vs global install):",
  "  node node_modules/@anthropic-ai/claude-code/install.cjs",
  "Or reinstall without --ignore-scripts / --omit=optional.",
];
const broken = stubDir("broken", { claude: `process.stderr.write(${JSON.stringify(BROKEN.join("\n") + "\n")}); process.exit(1);` });
const working = stubDir("working", {
  claude: `require("node:fs").writeFileSync(${JSON.stringify(path.join(marks, "env-keys.json"))}, JSON.stringify(Object.keys(process.env))); process.stdout.write("2.1.295 (Claude Code)\\n");`,
});
const hanging = stubDir("hanging", { claude: "setTimeout(() => process.exit(0), 30000);" });
const custom = stubDir("custom", {
  "grok-review": `require("node:fs").writeFileSync(${JSON.stringify(path.join(marks, "custom-ran"))}, "ran");`,
});

function doctor(args, binDir, extra) {
  const env = {
    PATH: [binDir, path.dirname(process.execPath)].join(path.delimiter),
    HOME: home,
    CW_HOME: home,
    CW_NO_AUTO_AGENT: "1",
    ANTHROPIC_API_KEY: "sk-test-not-a-real-key",
    UNRELATED_HOST_VAR: "should-not-reach-the-probe",
    ...extra,
  };
  const started = Date.now();
  const r = spawnSync(process.execPath, [cli, "doctor", ...args], { cwd, env, encoding: "utf8", timeout: 60000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - started };
}

const probeOf = (report) => report.checks.find((c) => c.name === "agent-runs");
const others = (report) => report.checks.filter((c) => c.name !== "agent-runs");

// (a) broken install: fail closed, the CLI's own hint is shown, a fix line.
const aText = doctor([], broken, { CW_AGENT_COMMAND: "builtin:claude" });
assert.equal(aText.code, 1, "a configured agent that cannot run makes doctor exit 1");
assert.match(aText.stdout, /\n  ✗ agent-runs: claude --version exited 1: Error: claude native binary not installed\. \| /);
assert.match(aText.stdout, /Or reinstall|node node_modules/, "the CLI's own fix hint is visible");
assert.match(aText.stdout, /\n      fix: Make "claude --version" work by hand first/);
assert.match(aText.stdout, /\n✗ 1 blocking problem found\n/);
const aJson = doctor(["--json"], broken, { CW_AGENT_COMMAND: "builtin:claude" });
assert.equal(aJson.code, 1);
const aReport = JSON.parse(aJson.stdout);
assert.equal(aReport.ok, false, "not ready");
const aProbe = probeOf(aReport);
assert.deepEqual(Object.keys(aProbe), ["name", "status", "detail", "fix"], "same shape as the other checks");
assert.equal(aProbe.status, "fail");
assert.ok(aProbe.detail.length <= 400, "the CLI's output is capped");
assert.ok(aProbe.detail.split(" | ").length <= 4, "at most 4 of its lines");

// (b) working CLI: ok line; a vendor CLI named in CW_AGENT_COMMAND is probed too.
const bText = doctor([], working, { CW_AGENT_COMMAND: "builtin:claude" });
assert.equal(bText.code, 0, bText.stdout + bText.stderr);
assert.match(bText.stdout, /\n  ✓ agent-runs: claude --version → 2\.1\.295 \(Claude Code\)\n/);
assert.ok(!bText.stdout.includes("sk-test-not-a-real-key"), "env values are never printed");
const keys = JSON.parse(fs.readFileSync(path.join(marks, "env-keys.json"), "utf8"));
assert.ok(keys.includes("ANTHROPIC_API_KEY"), "the probe gets the agent child env (provider keys)");
assert.ok(!keys.includes("UNRELATED_HOST_VAR"), "the probe gets the agent child env (nothing else)");
const bJson = JSON.parse(doctor(["--json"], working, { CW_AGENT_COMMAND: "builtin:claude" }).stdout);
assert.equal(bJson.ok, true);
assert.deepEqual(probeOf(bJson), { name: "agent-runs", status: "ok", detail: "claude --version → 2.1.295 (Claude Code)" });
assert.deepEqual(
  bJson.checks.map((c) => c.name).slice(0, 5),
  ["node", "agent", "agent-binary", "agent-runs", "sandbox-enforceability"],
  "agent-runs comes right after the agent checks"
);
const plain = JSON.parse(doctor(["--json"], working, { CW_AGENT_COMMAND: "claude -p" }).stdout);
assert.equal(probeOf(plain).status, "ok", "CW_AGENT_COMMAND=claude -p probes claude --version");

// (c) hanging CLI: a timeout is a fail, and doctor does not wait for it.
const c = doctor(["--json"], hanging, { CW_AGENT_COMMAND: "builtin:claude", CW_DOCTOR_AGENT_PROBE_TIMEOUT_MS: "500" });
assert.equal(c.code, 1);
assert.ok(c.ms < 15000, `doctor came back in ${c.ms}ms`);
const cProbe = probeOf(JSON.parse(c.stdout));
assert.equal(cProbe.status, "fail");
assert.equal(cProbe.detail, "claude --version timed out after 0.5s.");

// (d) custom command: "not probed" (a warn, never a silent pass), never run.
const dText = doctor([], custom, { CW_AGENT_COMMAND: "grok-review {{input}}" });
assert.equal(dText.code, 0);
assert.match(dText.stdout, /\n  ! agent-runs: not probed: custom command — doctor runs only a known vendor CLI with --version, never a custom command\.\n/);
const dJson = JSON.parse(doctor(["--json"], custom, { CW_AGENT_COMMAND: "grok-review {{input}}" }).stdout);
assert.equal(probeOf(dJson).status, "warn");
assert.ok(!fs.existsSync(path.join(marks, "custom-ran")), "doctor must never run a custom agent command");

// (e) the other checks do not move with the probe result; no agent => no probe.
assert.deepEqual(others(aReport), others(bJson), "only agent-runs differs between a broken and a working CLI");
const none = JSON.parse(doctor(["--json"], working, {}).stdout);
assert.equal(probeOf(none), undefined, "no agent configured: no agent-runs check");

fs.rmSync(base, { recursive: true, force: true });
process.stdout.write("doctor-agent-probe-smoke: ok (broken fails closed with its hint; working passes; timeout fails fast; custom not probed nor run; other checks unchanged)\n");
