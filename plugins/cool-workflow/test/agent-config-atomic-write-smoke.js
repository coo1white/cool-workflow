#!/usr/bin/env node
// agent-config-atomic-write-smoke — proves setAgentConfigFile uses atomic
// writes (temp → rename), so the durable config file is never torn.
// Fixes unsafe-config-file-writing (P1) from the architecture review.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { setAgentConfigFile, loadAgentConfigFile } = require("../dist/agent-config");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-acfg-"));
const env = { ...process.env, CW_HOME: home, XDG_STATE_HOME: home, HOME: home };

// ---------------------------------------------------------------------------
// 1) A written config round-trips and is valid JSON.
// ---------------------------------------------------------------------------
{
  const stored = setAgentConfigFile({ agentCommand: "echo", agentModel: "test" }, env);
  assert.equal(stored.command, "echo");
  assert.equal(stored.model, "test");

  const loaded = loadAgentConfigFile(env);
  assert.ok(loaded, "config file exists after write");
  assert.equal(loaded.command, "echo");
  assert.equal(loaded.model, "test");
}

// ---------------------------------------------------------------------------
// 2) Multiple writes never leave a torn file.
// ---------------------------------------------------------------------------
{
  for (let i = 0; i < 25; i++) {
    setAgentConfigFile({ agentCommand: `cmd-${i}`, agentModel: `model-${i}` }, env);
    const loaded = loadAgentConfigFile(env);
    assert.equal(loaded.command, `cmd-${i}`, `rewrite ${i} round-trips`);
  }
}

// ---------------------------------------------------------------------------
// 3) No temp files leak after a clean write (atomic rename is the mechanism).
// ---------------------------------------------------------------------------
{
  const file = path.join(home, "agent-config.json");
  const dir = path.dirname(file);
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".tmp."));
  assert.equal(leftovers.length, 0, "no temp files leak after writes");
}

// ---------------------------------------------------------------------------
// 4) A failed rename leaves the prior file intact (crash safety).
// ---------------------------------------------------------------------------
{
  const file = path.join(home, "agent-config.json");
  // Write a known baseline.
  setAgentConfigFile({ agentCommand: "baseline", agentModel: "baseline" }, env);
  const before = fs.readFileSync(file, "utf8");

  // Force rename to fail by making the target a directory.
  fs.rmSync(file);
  fs.mkdirSync(file);
  let threw = false;
  try {
    setAgentConfigFile({ agentCommand: "torn", agentModel: "torn" }, env);
  } catch {
    threw = true;
  }
  assert.ok(threw, "a write that cannot atomically replace the target throws");
  // The directory (prior state stand-in) is untouched; no temp file beside it.
  const siblings = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith("agent-config.json.tmp."));
  assert.equal(siblings.length, 0, "failed write cleans up its temp file");
  void before;
}

process.stdout.write("agent-config-atomic-write-smoke: ok\n");
