#!/usr/bin/env node
// mcp-boolean-false-arg-smoke — over MCP, a JSON `false` flag must mean
// false. mcp/dispatch.ts used to turn every JSON boolean into its string
// form, and handlers read flags with `Boolean(args.x)`; `Boolean("false")`
// is true, so each `false` below used to act as `true` (fail-open):
//
//   cw_commit        {allowUnverifiedCheckpoint:false} wrote an unverified checkpoint
//   cw_state_check   {write:false}                     wrote the state file
//   cw_audit_repair  {write:false}                     ran in write mode
//   cw_orphans_gc    {all:false}                       swept orphans of every age
//   cw_run_drive_step {once:false}                     stopped after one step
//
// Each case also sends `true` (or leaves the flag out) as a control, so the
// smoke proves the flag is read, not just that nothing happened. Driven
// over a real stdio round-trip to dist/mcp-server.js, with a fake agent
// command and its own CW_HOME/HOME, so it calls no model.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const MCP = path.join(pluginRoot, "dist", "mcp-server.js");
assert.ok(fs.existsSync(MCP), "dist/mcp-server.js must exist (run npm run build)");
import { plan } from "../dist/shell/pipeline.js";
import { loadWorkflowApp } from "../dist/shell/workflow-app-loader.js";
import * as api from "../dist/core/workflow-apps/app-schema.js";

const cleanups = [];
function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanups.push(dir);
  return dir;
}

const home = tmpDir("cw-mcp-bool-home-");
const work = tmpDir("cw-mcp-bool-work-");
fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");

// Fake agent: writes a valid cw:result block and reports a model, nothing more.
const stub = path.join(work, "stub-agent.js");
fs.writeFileSync(
  stub,
  [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "ok", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(process.argv[2], body);",
    'process.stdout.write(JSON.stringify({ model: "stub-m", usage: { input_tokens: 1, output_tokens: 1 } }));',
  ].join("\n"),
  "utf8"
);

const env = { ...process.env, HOME: home, CW_HOME: home, CW_AGENT_COMMAND: `${process.execPath} ${stub} {{result}}` };
for (const v of ["CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND", "CW_APPS_DIR"]) delete env[v];

let nextId = 1;
/** One tools/call over a fresh stdio server; returns { isError, text, json }. */
function call(name, args) {
  const id = nextId++;
  const input = JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n";
  const r = spawnSync(process.execPath, [MCP], { input, encoding: "utf8", env, cwd: work });
  const reply = r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.id === id);
  assert.ok(reply && reply.result, `${name}: server must reply (stderr: ${r.stderr})`);
  const text = reply.result.content[0].text;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { isError: reply.result.isError === true, text, json };
}

function planRun(repo) {
  const prev = process.cwd();
  process.chdir(repo);
  try {
    return plan(loadWorkflowApp("architecture-review"), { repo, cwd: repo, question: "mcp boolean false" });
  } finally {
    process.chdir(prev);
  }
}

try {
  // ---- cw_commit {allowUnverifiedCheckpoint:false} stays verifier-gated ----
  {
    const repo = tmpDir("cw-mcp-bool-commit-");
    const run = planRun(repo);
    const off = call("cw_commit", { runId: run.id, cwd: repo, allowUnverifiedCheckpoint: false });
    assert.equal(off.isError, true, `allowUnverifiedCheckpoint:false must stay verifier-gated and refuse, got: ${off.text}`);
    assert.ok(!/"checkpoint":\s*true/.test(off.text), "allowUnverifiedCheckpoint:false must not write a checkpoint");
    const on = call("cw_commit", { runId: run.id, cwd: repo, allowUnverifiedCheckpoint: true });
    assert.equal(on.isError, false, `control: allowUnverifiedCheckpoint:true writes a checkpoint, got: ${on.text}`);
    assert.match(on.text, /"checkpoint":\s*true/, "control: true writes an unverified checkpoint");
  }

  // ---- cw_state_check {write:false} is a dry run --------------------------
  {
    const repo = tmpDir("cw-mcp-bool-state-");
    const run = planRun(repo);
    const statePath = path.join(repo, ".cw", "runs", run.id, "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    delete state.feedback; // a field normalize fills in, so a write is due
    fs.writeFileSync(statePath, JSON.stringify(state));
    const before = fs.readFileSync(statePath, "utf8");
    const off = call("cw_state_check", { runId: run.id, cwd: repo, write: false });
    assert.equal(off.isError, false, off.text);
    assert.equal(off.json.dryRun, true, "write:false must be a dry run");
    assert.equal(off.json.writeRequired, true, "fixture: a write is due");
    assert.equal(fs.readFileSync(statePath, "utf8"), before, "write:false must not touch state.json");
    const on = call("cw_state_check", { runId: run.id, cwd: repo, write: true });
    assert.equal(on.json.dryRun, false, "control: write:true writes");
    assert.notEqual(fs.readFileSync(statePath, "utf8"), before, "control: write:true rewrites state.json");
  }

  // ---- cw_audit_repair {write:false} reports and does not write ------------
  {
    const repo = tmpDir("cw-mcp-bool-audit-");
    const run = planRun(repo);
    const off = call("cw_audit_repair", { runId: run.id, cwd: repo, write: false });
    assert.equal(off.isError, false, off.text);
    assert.equal(off.json.write, false, "write:false must be reported (and run) as a dry run");
    const on = call("cw_audit_repair", { runId: run.id, cwd: repo, write: true });
    assert.equal(on.json.write, true, "control: write:true is write mode");
  }

  // ---- cw_orphans_gc {all:false} keeps the age sweep -----------------------
  {
    const repo = tmpDir("cw-mcp-bool-orphans-");
    const orphan = path.join(repo, ".cw", "runs", "orphan-fresh");
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, "scratch.txt"), "x".repeat(32));
    const off = call("cw_orphans_gc", { scope: "repo", cwd: repo, all: false });
    assert.equal(off.isError, false, off.text);
    assert.equal(off.json.all, false, "all:false must not mean --all");
    assert.equal(off.json.removed.length, 0, "all:false must keep a fresh orphan (age sweep)");
    assert.ok(fs.existsSync(orphan), "all:false must not delete a fresh orphan");
    const on = call("cw_orphans_gc", { scope: "repo", cwd: repo, all: true });
    assert.equal(on.json.removed.length, 1, "control: all:true sweeps the fresh orphan");
    assert.ok(!fs.existsSync(orphan), "control: all:true deletes it");
  }

  // ---- cw_run_drive_step {once:false} drives to the end --------------------
  {
    const def = api.workflow({
      id: "mcp-bool-once",
      title: "mcp-bool-once",
      limits: { maxAgents: 2, maxConcurrentAgents: 1 },
      inputs: [{ name: "repo", type: "path", required: true }],
      phases: [api.parallel("First", [api.agent("first:one", "Probe one.")]), api.parallel("Second", [api.agent("second:one", "Probe two.")])],
    });
    const app = { schemaVersion: 1, id: def.id, title: def.title, version: "0.0.1", workflow: def };
    const prev = process.cwd();
    process.chdir(work);
    let runOff;
    let runOn;
    try {
      runOff = plan(app, { repo: work, cwd: work });
      runOn = plan(app, { repo: work, cwd: work });
    } finally {
      process.chdir(prev);
    }
    const on = call("cw_run_drive_step", { runId: runOn.id, cwd: work, once: true });
    assert.equal(on.isError, false, on.text);
    assert.notEqual(on.json.status, "complete", "control: once:true stops after one step");
    const off = call("cw_run_drive_step", { runId: runOff.id, cwd: work, once: false });
    assert.equal(off.isError, false, off.text);
    assert.equal(off.json.status, "complete", `once:false must drive to the end, got status ${off.json.status}`);
  }
} finally {
  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
}

process.stdout.write("mcp-boolean-false-arg-smoke: ok\n");
