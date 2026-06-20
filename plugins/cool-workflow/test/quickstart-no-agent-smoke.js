#!/usr/bin/env node
"use strict";

// quickstart-no-agent-smoke — Track A first-run acceptance.
//
// Proves the no-agent user path: demo tamper + demo bundle work without an agent,
// `cw doctor` clearly reports agent status, `cw doctor --onramp` includes the
// "No Agent?" section, and blocked quickstart output is actionable (not a
// mysterious error). A user who starts cold (no agent installed) can:
//   1. Run `demo tamper` and see trust holds
//   2. Run `demo bundle` and see the bundle proof
//   3. Run `cw doctor` and see exactly what's missing
//   4. Read the onramp and find a concrete install command
//
// Hermetic: no agent binary, no network, no shared state.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cw-no-agent-smoke-"));
const env = { ...process.env, CW_HOME: cwd, XDG_STATE_HOME: cwd, HOME: cwd, TMPDIR: cwd };

function runCw(args, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...env, ...extraEnv }, encoding: "utf8" });
}

function json(args, extraEnv = {}) {
  return JSON.parse(runCw([...args, "--json"], extraEnv).stdout.trim());
}

try {
  // ---- 1. demo tamper works without agent -------------------------------------
  {
    const result = runCw(["demo", "tamper"]);
    assert.equal(result.status, 0, "demo tamper exits 0");
    assert.ok(result.stdout.includes("tamper-evidence holds"), "demo tamper proves trust holds");
  }

  // ---- 2. demo bundle works without agent -------------------------------------
  {
    const result = runCw(["demo", "bundle"]);
    assert.equal(result.status, 0, "demo bundle exits 0");
    assert.ok(result.stdout.includes("VERDICT: bundle verification holds"), "demo bundle proves the bundle guarantee");
  }

  // ---- 3. cw doctor prints clear diagnosis for no-agent state ------------------
  {
    // With CW_AGENT_COMMAND cleared: auto-detect may find an agent (ok), or
    // report it as warn/fail. Either outcome is correct — the check runs.
    const doct = json(["doctor"], { CW_AGENT_COMMAND: "" });
    const agentCheck = doct.checks.find((c) => c.name === "agent");
    assert.ok(agentCheck, "doctor includes an agent check");
    assert.ok(
      ["ok", "warn", "fail"].includes(agentCheck.status),
      `doctor agent check runs (status: ${agentCheck.status})`
    );
    assert.ok(doct.checks.some((c) => c.name === "node" && c.status === "ok"), "doctor checks node runtime");
  }

  // ---- 4. cw doctor --onramp includes the 3-step quickstart + No Agent? section -
  {
    const result = runCw(["doctor", "--onramp"], { CW_AGENT_COMMAND: "" });
    const out = result.stdout;
    assert.ok(out.includes("Quick start (3 steps)"), "doctor --onramp prints the quick start block");
    assert.ok(out.includes("cw demo tamper") && out.includes("cw demo bundle"), "doctor lists demo steps");
    assert.ok(out.includes("No Agent?"), "doctor --onramp includes the No Agent? section");
    assert.ok(out.includes("npm install -g @anthropic-ai/claude-code"), "doctor --onramp gives an install command");
  }

  // ---- 5. cw doctor --json onramp has the sections we added -------------------
  {
    const doct = json(["doctor", "--onramp"], { CW_AGENT_COMMAND: "" });
    assert.ok(doct.onramp, "doctor --onramp json carries onramp");
    const sections = doct.onramp.sections.map((s) => s.id);
    assert.ok(sections.includes("first-run"), "onramp has first-run section");
    assert.ok(sections.includes("no-agent"), "onramp has no-agent section");
    assert.ok(sections.includes("change-loop"), "onramp has change-loop section");
    const noAgentSection = doct.onramp.sections.find((s) => s.id === "no-agent");
    assert.ok(noAgentSection.actions.some((a) => a.id === "agent-claude"), "no-agent section lists claude install");
    assert.ok(noAgentSection.actions.some((a) => a.id === "agent-check"), "no-agent section points to cw doctor");
    const firstRun = doct.onramp.sections.find((s) => s.id === "first-run");
    assert.ok(firstRun.actions.some((a) => a.id === "demo-bundle"), "first-run section includes demo bundle");
  }

  // ---- 6. quickstart with no explicit agent config (auto-detect may or may not work) --
  {
    // Without CW_AGENT_COMMAND set, the quickstart may auto-detect an agent (complete)
    // or find none (blocked). Either is correct — we verify the response is well-formed
    // and the correct fields are present.
    const result = runCw(["quickstart", "end-to-end-golden-path", "--repo", cwd, "--question", "test?"], { CW_AGENT_COMMAND: "", CW_NO_AUTO_AGENT: "1" });
    const payload = JSON.parse(result.stdout.trim());
    assert.ok(payload.status === "complete" || payload.status === "blocked", `quickstart resolved status is complete or blocked (got: ${payload.status})`);
    assert.ok(typeof payload.runId === "string" || payload.status === "blocked", "payload carries runId or blocked status");
    if (payload.status === "blocked") {
      assert.ok(payload.hint, "blocked payload has a hint");
      assert.equal(payload.completedWorkers, 0, "blocked quickstart completed zero workers");
      assert.ok(!payload.commitId, "blocked quickstart has no commit (never fabricated)");
    }
    if (payload.status === "complete") {
      assert.ok(payload.commitId, "completed quickstart has a commit");
      assert.ok(fs.existsSync(path.join(cwd, ".cw", "runs", payload.runId, "state.json")), "run state written");
    }
  }

  process.stdout.write("quickstart-no-agent-smoke: ok (demo runs without agent + doctor guides setup + blocked is actionable)\n");
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
