#!/usr/bin/env node
"use strict";

// run-registry-control-plane-smoke (v0.1.28): proves the Run Registry / Control
// Plane manages MANY runs across repos as a DERIVED, fail-closed index over the
// per-run `.cw/runs/<id>/state.json` source of truth. It asserts:
//
//   1. Lifecycle state machine — deriveLifecycle classifies, never invents.
//   2. Cross-repo indexing — runs from two repos discovered via the home registry.
//   3. Search determinism — identical results across calls; filters + pagination.
//   4. Resume-by-id — resolves a run across repos by id without mutating source.
//   5. Queue ordering — durable, plain-file queue drained in policy order.
//   6. Archive without data loss — overlay mark; source state.json preserved;
//      derivedLifecycle preserved; still searchable.
//   7. Rerun provenance — a NEW run links to the original; original preserved;
//      generation/origin chain is correct.
//   8. Fail closed — tampered source => stale, absent source => missing; never a
//      fabricated status.
//   9. Scan slimness — repo overlays are read once per repo per index build.
//  10. BOTH surfaces — `cw <cmd> --json` is payload-identical to `cw_<tool>`, and
//      the control plane resolves/reruns runs through the MCP tools too.
//
// Included in `npm test` and `npm run release:check`.

const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const mcpServer = path.join(pluginRoot, "dist", "mcp-server.js");
const { RunRegistry, deriveLifecycle } = require(path.join(pluginRoot, "dist", "run-registry.js"));
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist", "orchestrator.js"));

// Isolated home + two repos so nothing touches real user state.
const cwHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-reg-home-")));
const repoA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-reg-repoA-")));
const repoB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-reg-repoB-")));
process.env.CW_HOME = cwHome;

const runner = new CoolWorkflowRunner({ pluginRoot });
const canonical = (v) => JSON.stringify(v).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<ts>");

function plan(repo, app, inputs) {
  return runner.plan(app, { ...inputs, repo, cwd: repo });
}
function editState(statePath, mutate) {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  mutate(state);
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function openMcp() {
  const server = spawn(node, [mcpServer], { cwd: repoA, stdio: ["pipe", "pipe", "pipe"], env: process.env });
  const lines = readline.createInterface({ input: server.stdout });
  const pending = new Map();
  let id = 1;
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const rpc = (method, params) => {
    const i = id++;
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: i, method, params })}\n`);
    return new Promise((resolve, reject) => pending.set(i, { resolve, reject }));
  };
  const tool = (name, args) => rpc("tools/call", { name, arguments: args }).then((r) => JSON.parse(r.content[0].text));
  return { server, rpc, tool };
}

(async () => {
  // ---- 1. lifecycle state machine (classify, never invent) ----------------
  const base = { total: 3, pending: 3, running: 0, failed: 0, completed: 0, verifierGatedCommits: 0, openFeedback: 0, loopStage: "interpret" };
  assert.equal(deriveLifecycle(base), "queued", "fresh plan => queued");
  assert.equal(deriveLifecycle({ ...base, running: 1, pending: 2 }), "running", "running task => running");
  assert.equal(deriveLifecycle({ ...base, openFeedback: 1 }), "blocked", "open feedback => blocked");
  assert.equal(deriveLifecycle({ ...base, failed: 1, pending: 2 }), "failed", "failed task (no feedback) => failed");
  assert.equal(deriveLifecycle({ ...base, pending: 0, completed: 3 }), "completed", "all tasks completed => completed");
  assert.equal(deriveLifecycle({ total: 0, pending: 0, running: 0, failed: 0, completed: 0, verifierGatedCommits: 1, openFeedback: 0, loopStage: "checkpoint" }), "completed", "verifier-gated commit, nothing pending => completed");
  assert.equal(deriveLifecycle({ ...base, pending: 2, completed: 1 }), "running", "partial progress => running (mid-flight)");
  // blocked precedes failed (a failure under correction is not terminal).
  assert.equal(deriveLifecycle({ ...base, failed: 1, openFeedback: 1, pending: 1 }), "blocked", "failed + open feedback => blocked");

  // ---- build runs across two repos ----------------------------------------
  const a1 = plan(repoA, "architecture-review", { question: "repoA alpha control plane" });
  const a2 = plan(repoA, "architecture-review", { question: "repoA beta" });
  const b1 = plan(repoB, "architecture-review", { question: "repoB gamma deliberately failed" });
  const b2 = plan(repoB, "release-cut", { version: "0.1.29", question: "repoB delta" });

  // realize lifecycles via source edits (the registry must re-derive from source).
  editState(a2.paths.state, (s) => s.tasks.forEach((t) => (t.status = "completed"))); // a2 -> completed
  editState(b1.paths.state, (s) => {
    s.tasks[0].status = "failed";
    for (let i = 1; i < s.tasks.length; i += 1) s.tasks[i].status = "completed";
  }); // b1 -> failed

  // ---- 2. cross-repo indexing --------------------------------------------
  // refresh from each repo registers it into the home registry.
  new RunRegistry(repoA, runner).refresh({ scope: "repo" });
  new RunRegistry(repoB, runner).refresh({ scope: "repo" });
  const regA = new RunRegistry(repoA, runner);
  const home = regA.show({ scope: "home" });
  assert.ok(home.index.repos.includes(repoA) && home.index.repos.includes(repoB), "home registry discovers both repos");
  const ids = home.index.records.map((r) => r.runId);
  for (const run of [a1, a2, b1, b2]) assert.ok(ids.includes(run.id), `home index includes ${run.id}`);
  assert.equal(home.counts.total, 4, "home index counts all 4 runs");
  assert.equal(home.counts.completed, 1, "one completed run (a2)");
  assert.equal(home.counts.failed, 1, "one failed run (b1)");

  // ---- 3. search determinism + filters + pagination -----------------------
  const s1 = regA.search({ scope: "home", limit: 50 });
  const s2 = regA.search({ scope: "home", limit: 50 });
  assert.equal(canonical(s1.records.map((r) => r.runId)), canonical(s2.records.map((r) => r.runId)), "search is deterministic");
  // ordering is createdAt asc, then runId.
  const ordered = [...s1.records].every((r, i, arr) => i === 0 || arr[i - 1].createdAt <= r.createdAt);
  assert.ok(ordered, "search ordered by createdAt asc");
  // filter by status.
  const failed = regA.search({ scope: "home", status: "failed" });
  assert.deepEqual(failed.records.map((r) => r.runId), [b1.id], "status=failed selects exactly b1");
  // filter by app.
  const rel = regA.search({ scope: "home", app: "release-cut" });
  assert.deepEqual(rel.records.map((r) => r.runId), [b2.id], "app=release-cut selects exactly b2");
  // free-text over metadata (the question lives in inputs).
  const text = regA.search({ scope: "home", text: "control plane" });
  assert.deepEqual(text.records.map((r) => r.runId), [a1.id], "free-text matches run metadata");
  // filter by repo.
  const onlyB = regA.search({ scope: "home", repo: repoB });
  assert.deepEqual(onlyB.records.map((r) => r.runId).sort(), [b1.id, b2.id].sort(), "repo filter scopes to repoB");
  // pagination is stable.
  const page0 = regA.search({ scope: "home", limit: 2, offset: 0 });
  const page1 = regA.search({ scope: "home", limit: 2, offset: 2 });
  assert.equal(page0.records.length, 2, "page0 has 2");
  assert.equal(page0.total, 4, "total reported across pages");
  const paged = [...page0.records, ...page1.records].map((r) => r.runId);
  assert.equal(new Set(paged).size, paged.length, "pages do not overlap");

  // ---- 4. resume-by-id across repos --------------------------------------
  const resumed = regA.resume(b1.id); // b1 lives in repoB; regA is rooted in repoA
  assert.equal(resumed.repo, repoB, "resume resolves the owning repo by id");
  assert.equal(resumed.resolvedFrom, "home", "resume crossed repos");
  assert.equal(resumed.derivedLifecycle, "failed", "resume reports derived lifecycle from source");
  const b1Before = fs.readFileSync(b1.paths.state, "utf8");
  regA.resume(b1.id);
  assert.equal(fs.readFileSync(b1.paths.state, "utf8"), b1Before, "resume never mutates source state");

  // ---- 5. queue ordering + drain -----------------------------------------
  regA.queueAdd({ appId: "architecture-review", repo: repoA, priority: 100, note: "p100" });
  regA.queueAdd({ appId: "release-cut", repo: repoB, priority: 10, note: "p10" });
  regA.queueAdd({ appId: "architecture-review", repo: repoA, priority: 50, note: "p50" });
  const qlist = regA.queueList({});
  assert.deepEqual(qlist.entries.map((e) => e.priority), [10, 50, 100], "queue ordered by priority asc");
  const drain = regA.queueDrain({ limit: 2 });
  assert.deepEqual(drain.drained.map((e) => e.priority), [10, 50], "drain pops lowest priority first");
  assert.equal(drain.remaining, 1, "one entry remains after draining 2");
  assert.ok(drain.drained.every((e) => e.status === "drained"), "drained entries are marked drained");

  // ---- 6. archive without data loss --------------------------------------
  const archived = regA.archive(a2.id, { reason: "smoke archive" });
  assert.ok(archived.archived, "a2 archived");
  assert.ok(fs.existsSync(a2.paths.state), "archive never deletes source state.json");
  const a2show = regA.showRun(a2.id);
  assert.equal(a2show.record.lifecycle, "archived", "archived run surfaces as archived");
  assert.equal(a2show.record.derivedLifecycle, "completed", "archive preserves derived (underlying) lifecycle");
  // archived runs stay searchable by default, but are excludable.
  assert.ok(regA.search({ scope: "home" }).records.some((r) => r.runId === a2.id), "archived run stays searchable by default");
  assert.ok(!regA.search({ scope: "home", includeArchived: false }).records.some((r) => r.runId === a2.id), "includeArchived=false hides it");

  // ---- 7. rerun provenance linkage ---------------------------------------
  const rerun1 = regA.rerun(b1.id, { reason: "smoke rerun" });
  assert.notEqual(rerun1.newRunId, b1.id, "rerun creates a NEW run");
  assert.equal(rerun1.repo, repoB, "rerun lands in the original repo");
  assert.equal(rerun1.provenance.rerunOf, b1.id, "rerun records rerunOf the original");
  assert.equal(rerun1.provenance.generation, 1, "first rerun is generation 1");
  assert.equal(rerun1.provenance.originRunId, b1.id, "origin is the original run");
  assert.ok(fs.existsSync(b1.paths.state), "rerun preserves the original failed run");
  const child = regA.showRun(rerun1.newRunId);
  assert.equal(child.record.provenance.rerunOf, b1.id, "new run surfaces provenance back to original");
  // chain: rerun the rerun -> generation 2, origin stable.
  const rerun2 = regA.rerun(rerun1.newRunId, { reason: "rerun of rerun" });
  assert.equal(rerun2.provenance.generation, 2, "rerun of a rerun is generation 2");
  assert.equal(rerun2.provenance.originRunId, b1.id, "origin stays the chain root");

  // ---- 8. scan slimness: read repo overlays once per repo ----------------
  // This guards the hot path without using wall-clock timing. The registry still
  // re-derives every run from source state; it just must not re-read identical
  // repo-level overlays for every run in the same scan.
  const overlayReads = new Map();
  const watchedOverlays = new Set([
    path.join(repoA, ".cw", "registry", "archive.json"),
    path.join(repoB, ".cw", "registry", "provenance.json")
  ].map((file) => path.resolve(file)));
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function countedReadFileSync(file, ...rest) {
    if (typeof file === "string" || file instanceof Buffer || file instanceof URL) {
      const key = path.resolve(String(file));
      if (watchedOverlays.has(key)) overlayReads.set(key, (overlayReads.get(key) || 0) + 1);
    }
    return originalReadFileSync.call(this, file, ...rest);
  };
  try {
    const slimIndex = regA.buildIndex("home");
    assert.ok(slimIndex.records.some((r) => r.runId === a2.id && r.archived), "slim scan preserves archive overlay semantics");
    assert.ok(slimIndex.records.some((r) => r.runId === rerun1.newRunId && r.provenance?.rerunOf === b1.id), "slim scan preserves provenance overlay semantics");
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  assert.equal(overlayReads.get(path.resolve(path.join(repoA, ".cw", "registry", "archive.json"))), 1, "archive overlay read once per repo scan");
  assert.equal(overlayReads.get(path.resolve(path.join(repoB, ".cw", "registry", "provenance.json"))), 1, "provenance overlay read once per repo scan");

  // ---- 9. fail closed on tampered / absent source ------------------------
  regA.refresh({ scope: "home" }); // persist a fresh baseline
  // tamper: flip a task status on a1 directly in source.
  editState(a1.paths.state, (s) => (s.tasks[0].status = "completed"));
  const stale = regA.show({ scope: "home" });
  assert.equal(stale.freshness.status, "stale", "tampered source => stale index");
  assert.ok(stale.freshness.staleRuns.includes(a1.id), "stale index names the tampered run");
  // absent: delete b2's run directory.
  regA.refresh({ scope: "home" });
  fs.rmSync(path.join(repoB, ".cw", "runs", b2.id), { recursive: true, force: true });
  const missing = regA.show({ scope: "home" });
  assert.equal(missing.freshness.status, "stale", "absent source => stale index");
  assert.ok(missing.freshness.missingRuns.includes(b2.id), "absent index names the missing run");
  assert.ok(!missing.index.records.some((r) => r.runId === b2.id), "deleted run is NOT fabricated into records");
  const goneShow = regA.showRun(b2.id);
  assert.equal(goneShow.found, false, "run show of a deleted run => not found");
  assert.equal(goneShow.freshness, "missing", "run show of a deleted run => missing (never a live status)");

  // ---- 10. BOTH surfaces: CLI --json == cw_<tool>, MCP can drive lifecycle --
  execFileSync(node, [cli, "registry", "refresh", "--cwd", repoA, "--scope", "home"], { cwd: repoA, encoding: "utf8", env: process.env });
  const mcp = openMcp();
  try {
    await mcp.rpc("initialize", {});
    const reads = [
      ["registry show", ["registry", "show", "--cwd", repoA, "--scope", "home", "--json"], "cw_registry_show", { cwd: repoA, scope: "home" }],
      ["run search", ["run", "search", "--cwd", repoA, "--scope", "home", "--app", "architecture-review", "--json"], "cw_run_search", { cwd: repoA, scope: "home", app: "architecture-review" }],
      ["run list", ["run", "list", "--cwd", repoA, "--scope", "home", "--json"], "cw_run_list", { cwd: repoA, scope: "home" }],
      ["run show", ["run", "show", a1.id, "--cwd", repoA, "--scope", "home", "--json"], "cw_run_show", { cwd: repoA, scope: "home", runId: a1.id }],
      ["run resume", ["run", "resume", b1.id, "--cwd", repoA, "--scope", "home", "--json"], "cw_run_resume", { cwd: repoA, scope: "home", runId: b1.id }],
      ["history", ["history", "--cwd", repoA, "--scope", "home", "--json"], "cw_history", { cwd: repoA, scope: "home" }],
      ["queue list", ["queue", "list", "--cwd", repoA, "--json"], "cw_queue_list", { cwd: repoA }]
    ];
    for (const [label, argv, toolName, toolArgs] of reads) {
      const cliOut = JSON.parse(execFileSync(node, [cli, ...argv], { cwd: repoA, encoding: "utf8", env: process.env }));
      const mcpOut = await mcp.tool(toolName, toolArgs);
      assert.equal(canonical(cliOut), canonical(mcpOut), `payload divergence for ${label}: cw --json != ${toolName}`);
    }
    // the control plane resolves + reruns runs through the MCP surface too.
    const mcpResume = await mcp.tool("cw_run_resume", { cwd: repoA, scope: "home", runId: b1.id });
    assert.equal(mcpResume.repo, repoB, "MCP resume resolves cross-repo by id");
    const mcpRerun = await mcp.tool("cw_run_rerun", { cwd: repoA, scope: "home", runId: b1.id, reason: "mcp rerun" });
    assert.equal(mcpRerun.provenance.rerunOf, b1.id, "MCP rerun records provenance to the original");
    assert.ok(fs.existsSync(b1.paths.state), "MCP rerun preserves the original");
    // fail-closed reaches the MCP surface too.
    const mcpMissing = await mcp.tool("cw_run_show", { cwd: repoA, scope: "home", runId: "does-not-exist" });
    assert.equal(mcpMissing.found, false, "MCP run show of unknown run => not found");
    assert.equal(mcpMissing.freshness, "missing", "MCP run show of unknown run => missing");
  } finally {
    mcp.server.kill();
  }

  // cleanup
  for (const dir of [cwHome, repoA, repoB]) fs.rmSync(dir, { recursive: true, force: true });

  process.stdout.write("run-registry-control-plane-smoke: ok (cross-repo index, search determinism, resume-by-id, queue order, archive without loss, rerun provenance, slim overlay scan, fail-closed stale/missing, CLI<->MCP parity)\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
