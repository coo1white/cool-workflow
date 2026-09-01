#!/usr/bin/env node
"use strict";

// bands-smoke — drives `cw bands check` -> `cw bands record` -> the queue:
//   1. tier 1: check reports the tier, record writes NO intent file, and
//      `--queue` is a no-op (tier 1 allows neither).
//   2. tier 2: record writes an intent file; `--queue` is STILL a no-op
//      (tier 2 allows an intent, not a queue entry) — no queue entry lands.
//   3. tier 3: record writes an intent file AND, with `--queue`, adds a
//      queue entry carrying the intent path in `inputs.intentPath`.
//   4. the intent file's content shape: Problem/Evidence/Proposed outcome/
//      Affected systems/Open questions, with the two file digests.
//   5. a bad config path fails closed (non-zero exit, no stdout).
//   6. the MCP tools (cw_bands_check/cw_bands_record, in-process) give the
//      same shape as the CLI path.

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");

function tmpDir(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cw-bands-${label}-`)));
}

const repo = tmpDir("repo");
const home = tmpDir("home");
const env = { ...process.env, CW_HOME: home, XDG_STATE_HOME: home };

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

const CONFIG = {
  metric: "checkout_latency_ms",
  rules: "three-sigma",
  window: "7d",
  baseline: { mean: 100, stddev: 10 },
  affectedSystems: ["checkout-service"],
  tiers: {
    "1": { outcome: "Watch it." },
    "2": { outcome: "Open an intent." },
    "3": { outcome: "Page on-call." },
  },
};
const configPath = path.join(repo, "bands.json");
writeJson(configPath, CONFIG);

function inputPathFor(label, value) {
  const file = path.join(repo, `${label}.json`);
  writeJson(file, { value });
  return file;
}

function cw(args) {
  return spawnSync(node, [cli, ...args, "--cwd", repo, "--json"], { env, encoding: "utf8" });
}
function cwOk(args) {
  const result = cw(args);
  assert.equal(result.status, 0, `cw ${args.join(" ")} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function main() {
  // ---- 1. tier 1: no intent, --queue is a no-op ---------------------------
  const tier1Input = inputPathFor("tier1", 110);
  const check1 = cwOk(["bands", "check", "--config", configPath, "--input", tier1Input]);
  assert.equal(check1.tier, "1");
  const record1 = cwOk(["bands", "record", "--config", configPath, "--input", tier1Input, "--queue"]);
  assert.equal(record1.tier, "1");
  assert.equal(record1.intentPath, null, "tier 1 writes no intent file");
  assert.equal(record1.queued, null, "tier 1 never queues, even with --queue");
  assert.equal(fs.existsSync(path.join(repo, ".cw", "intents")), false, "no .cw/intents directory yet");

  // ---- 2. tier 2: an intent file, but --queue is STILL a no-op ------------
  const tier2Input = inputPathFor("tier2", 120);
  const record2 = cwOk(["bands", "record", "--config", configPath, "--input", tier2Input, "--queue"]);
  assert.equal(record2.tier, "2");
  assert.ok(record2.intentPath, "tier 2 writes an intent file");
  assert.ok(fs.existsSync(record2.intentPath), "the intent file is really on disk");
  assert.equal(record2.queued, null, "tier 2 never queues, even with --queue (mechanism caps the tier's allowance)");
  const queueAfterTier2 = cwOk(["queue", "list"]);
  assert.equal(queueAfterTier2.total, 0, "tier 2 added nothing to the queue");

  // ---- 3. tier 3: an intent file AND a queue entry ------------------------
  const tier3Input = inputPathFor("tier3", 135);
  const intentsDir = path.join(repo, ".cw", "intents");
  const filesBeforeCheck = fs.readdirSync(intentsDir);
  const checked3 = cwOk(["bands", "check", "--config", configPath, "--input", tier3Input]);
  assert.equal(checked3.tier, "3");
  assert.deepEqual(fs.readdirSync(intentsDir), filesBeforeCheck, "bands check STILL writes nothing, even at tier 3");

  const record3 = cwOk(["bands", "record", "--config", configPath, "--input", tier3Input, "--queue"]);
  assert.equal(record3.tier, "3");
  assert.ok(record3.intentPath, "tier 3 writes an intent file");
  assert.ok(record3.queued && record3.queued.id, "tier 3 with --queue adds a queue entry");

  const queueAfterTier3 = cwOk(["queue", "list"]);
  assert.equal(queueAfterTier3.total, 1, "exactly the tier-3 entry is queued");
  const entry = queueAfterTier3.entries[0];
  assert.equal(entry.id, record3.queued.id);
  assert.equal(entry.inputs.intentPath, record3.intentPath, "the queue entry carries the intent path");
  assert.match(entry.note, /tier 3 breach for checkout_latency_ms/);

  // ---- 3b. tier 3 WITHOUT --queue writes the intent but adds nothing ------
  const tier3bInput = inputPathFor("tier3b", 65);
  const record3b = cwOk(["bands", "record", "--config", configPath, "--input", tier3bInput]);
  assert.equal(record3b.tier, "3", "a drop below the baseline breaches the same tiers (two-sided)");
  assert.ok(record3b.intentPath);
  assert.equal(record3b.queued, null, "no --queue given -> nothing is added, even at tier 3");
  assert.equal(cwOk(["queue", "list"]).total, 1, "still just the one queued entry from step 3");

  // ---- 4. the intent file's content shape ---------------------------------
  const intentBody = fs.readFileSync(record3.intentPath, "utf8");
  assert.match(intentBody, /^# Intent: checkout_latency_ms band breach \(tier 3\)/);
  assert.ok(intentBody.includes("## Problem"));
  assert.ok(intentBody.includes("## Evidence"));
  assert.ok(intentBody.includes("## Proposed outcome"));
  assert.ok(intentBody.includes("## Affected systems"));
  assert.ok(intentBody.includes("## Open questions"));
  assert.ok(intentBody.includes("Page on-call."), "the tier's own outcome text from the config");
  assert.ok(intentBody.includes("- checkout-service"), "the affected system from the config");
  assert.equal(record3.configDigest, `sha256:${require("node:crypto").createHash("sha256").update(fs.readFileSync(configPath)).digest("hex")}`, "the config digest matches the real file bytes");
  assert.equal(record3.inputDigest, `sha256:${require("node:crypto").createHash("sha256").update(fs.readFileSync(tier3Input)).digest("hex")}`, "the input digest matches the real file bytes");
  assert.ok(intentBody.includes(record3.configDigest) && intentBody.includes(record3.inputDigest), "both digests are printed in the Evidence section");

  // ---- 5. a bad config path fails closed -----------------------------------
  const missing = cw(["bands", "check", "--config", path.join(repo, "no-such-config.json"), "--input", tier1Input]);
  assert.notEqual(missing.status, 0, "an unreadable config fails closed");
  assert.equal(missing.stdout, "", "no JSON is printed on a fail-closed error");

  const badJson = path.join(repo, "bad.json");
  fs.writeFileSync(badJson, "{ not json");
  const badConfig = cw(["bands", "check", "--config", badJson, "--input", tier1Input]);
  assert.notEqual(badConfig.status, 0, "invalid JSON in the config fails closed");

  // ---- 6. MCP parity (in-process) ------------------------------------------
  const prevHome = process.env.CW_HOME;
  process.env.CW_HOME = home;
  try {
    const { callTool } = require(path.join(pluginRoot, "dist", "mcp", "dispatch"));
    const mcpCheck = callTool("cw_bands_check", { config: configPath, input: tier3Input, cwd: repo });
    assert.equal(mcpCheck.tier, "3", "MCP check sees the same tier as the CLI path");
    const mcpRecord = callTool("cw_bands_record", { config: configPath, input: tier3Input, cwd: repo, queue: true });
    assert.equal(mcpRecord.tier, "3");
    assert.ok(mcpRecord.queued && mcpRecord.queued.id, "MCP record queues a tier-3 breach the same as the CLI path");
  } finally {
    if (prevHome === undefined) delete process.env.CW_HOME;
    else process.env.CW_HOME = prevHome;
  }

  process.stdout.write("bands-smoke: ok (check -> record -> queue; tier caps the allowance; intent shape; fail-closed bad config; MCP parity)\n");
}

main();
