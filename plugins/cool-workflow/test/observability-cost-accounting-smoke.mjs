#!/usr/bin/env node
// observability-cost-accounting-smoke (v0.1.31)
//
// Proves the v0.1.31 Observability + Cost Accounting contract:
//  - durations are DERIVED from recorded timestamps (not report time);
//  - failure / verifier-pass / candidate-acceptance rates are correct WITH
//    sample counts, and `n/a` (never 0%/100%) over zero samples;
//  - CW never prices usage: cost is `unreported` with no usage and
//    `unpriced` with attested usage; `unreported` usage is surfaced with
//    coverage, never folded into 0;
//  - the report is DETERMINISTIC over a fixed snapshot + injected now;
//  - `cw metrics show --json` === `cw_metrics_show` and
//    `cw metrics summary --json` === `cw_metrics_summary` (parity).

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const mcpServer = path.join(pluginRoot, "dist", "mcp-server.js");
// v2: flat dist/observability.js moved to dist/shell/observability.js.
// deriveMetricsReport/deriveMetricsSummary take {now,scope} options
// (shell/ layer, not pure core/).
import * as obs from "../dist/shell/observability.js";
import { tmpDir } from "./helpers/workspace.mjs";

const FIXED_NOW = "2026-06-08T12:00:00.000Z";

// ---------------------------------------------------------------------------
// A hand-built, fixed run snapshot. Only the fields the derivation reads are
// populated; timestamps are chosen so durations are exact and checkable.
// ---------------------------------------------------------------------------
function fixtureRun() {
  return {
    schemaVersion: 1,
    id: "fixture-run",
    createdAt: "2026-06-08T10:00:00.000Z",
    updatedAt: "2026-06-08T10:10:00.000Z", // run wall-clock = 600_000 ms
    cwd: "/tmp/fixture",
    workflow: { id: "architecture-review", title: "t", summary: "s", limits: {}, app: { id: "architecture-review", version: "0.1.31" } },
    loopStage: "observe",
    phases: [],
    paths: { runDir: "/tmp/fixture/.cw/runs/fixture-run" },
    tasks: [
      // completed, no worker, WITH attested usage (exact model) — 120s active
      {
        id: "t-attested",
        status: "completed",
        dispatchedAt: "2026-06-08T10:01:00.000Z",
        completedAt: "2026-06-08T10:03:00.000Z",
        backendId: "node",
        usage: { schemaVersion: 1, source: "host-attested", model: "claude-opus-4-8", inputTokens: 1000, outputTokens: 200, attestedAt: "2026-06-08T10:03:00.000Z" }
      },
      // completed, no worker, NO usage (unreported) — 60s active
      { id: "t-unreported", status: "completed", dispatchedAt: "2026-06-08T10:04:00.000Z", completedAt: "2026-06-08T10:05:00.000Z", backendId: "node" },
      // failed task, no worker (a failure sample) — in-flight duration (no end)
      { id: "t-failed", status: "failed", dispatchedAt: "2026-06-08T10:06:00.000Z", backendId: "node" },
      // pending, never dispatched — in-flight, not an attempt
      { id: "t-pending", status: "pending" }
    ],
    workers: [
      // completed worker WITH output + attested usage (a second model)
      {
        id: "w-estimated",
        status: "completed",
        taskId: "t-worker",
        createdAt: "2026-06-08T10:02:00.000Z",
        updatedAt: "2026-06-08T10:04:00.000Z",
        backendId: "shell",
        feedbackIds: [],
        errors: [],
        output: { workerId: "w-estimated", taskId: "t-worker", resultPath: "x", recordedAt: "2026-06-08T10:04:00.000Z" },
        usage: { schemaVersion: 1, source: "host-attested", model: "mystery-model-x", inputTokens: 500, outputTokens: 100, attestedAt: "2026-06-08T10:04:00.000Z" }
      },
      // failed worker (a failure sample), no output — in-flight by output, but
      // status failed ⇒ ends at updatedAt
      { id: "w-failed", status: "failed", taskId: "t-x", createdAt: "2026-06-08T10:02:00.000Z", updatedAt: "2026-06-08T10:03:00.000Z", backendId: "shell", feedbackIds: [], errors: [] }
    ],
    nodes: [
      { id: "v1", kind: "verifier", status: "verified", loopStage: "adjust", createdAt: "x", updatedAt: "x", inputs: {}, outputs: {}, artifacts: [], evidence: [], errors: [], parents: [], children: [] },
      { id: "v2", kind: "verifier", status: "verified", loopStage: "adjust", createdAt: "x", updatedAt: "x", inputs: {}, outputs: {}, artifacts: [], evidence: [], errors: [], parents: [], children: [] },
      { id: "v3", kind: "verifier", status: "failed", loopStage: "adjust", createdAt: "x", updatedAt: "x", inputs: {}, outputs: {}, artifacts: [], evidence: [], errors: [], parents: [], children: [] },
      { id: "v4", kind: "verifier", status: "pending", loopStage: "adjust", createdAt: "x", updatedAt: "x", inputs: {}, outputs: {}, artifacts: [], evidence: [], errors: [], parents: [], children: [] },
      { id: "r1", kind: "result", status: "completed", loopStage: "observe", createdAt: "x", updatedAt: "x", inputs: {}, outputs: {}, artifacts: [], evidence: [], errors: [], parents: [], children: [] }
    ],
    candidates: [
      { id: "c1", runId: "fixture-run", kind: "result", status: "selected", createdAt: "x", updatedAt: "x", artifacts: [], evidence: [], scores: [], feedbackIds: [] },
      { id: "c2", runId: "fixture-run", kind: "result", status: "rejected", createdAt: "x", updatedAt: "x", artifacts: [], evidence: [], scores: [], feedbackIds: [] },
      { id: "c3", runId: "fixture-run", kind: "result", status: "registered", createdAt: "x", updatedAt: "x", artifacts: [], evidence: [], scores: [], feedbackIds: [] }
    ],
    feedback: [
      { id: "f1", runId: "fixture-run", createdAt: "x", updatedAt: "x", status: "open" }
    ],
    multiAgent: {
      schemaVersion: 1,
      runs: [],
      roles: [],
      groups: [],
      memberships: [
        { id: "m1", status: "failed", createdAt: "x" },
        { id: "m2", status: "verified", createdAt: "x" }
      ],
      fanouts: [],
      fanins: []
    }
  };
}

// An empty run: zero samples everywhere ⇒ every rate must be `n/a`.
function emptyRun() {
  return {
    schemaVersion: 1,
    id: "empty-run",
    createdAt: "2026-06-08T10:00:00.000Z",
    updatedAt: "2026-06-08T10:00:00.000Z",
    cwd: "/tmp/empty",
    workflow: { id: "architecture-review", title: "t", summary: "s", limits: {} },
    loopStage: "interpret",
    phases: [],
    paths: { runDir: "/tmp/empty/.cw/runs/empty-run" },
    tasks: [],
    workers: [],
    nodes: [],
    candidates: [],
    feedback: []
  };
}

function main() {
  // ---- 1. durations from recorded timestamps -----------------------------
  const report = obs.deriveMetricsReport(fixtureRun(), { now: FIXED_NOW });
  assert.equal(report.generatedAt, FIXED_NOW, "generatedAt is the injected now");
  assert.equal(report.time.run.wallClockMs, 600000, "run wall-clock = createdAt→updatedAt");
  assert.equal(report.time.activeTaskMs, 180000, "active task ms = 120s + 60s (completed tasks only)");
  const tAtt = report.time.tasks.find((t) => t.id === "t-attested");
  assert.equal(tAtt.duration.wallClockMs, 120000, "t-attested dispatched→completed = 120s");
  assert.equal(tAtt.duration.inFlight, false, "completed task not in-flight");
  const tFailed = report.time.tasks.find((t) => t.id === "t-failed");
  assert.equal(tFailed.duration.wallClockMs, null, "failed task with no completedAt has null duration");
  assert.equal(tFailed.duration.inFlight, true, "in-flight marked explicitly");
  assert.ok(report.time.inFlight >= 2, "in-flight items counted");

  // ---- 2. rates with sample counts ---------------------------------------
  // failure: total = workers(2) + tasksNoWorkerDispatched(t-attested,t-unreported,t-failed=3)
  //          + memberships(2) + feedback(1) = 8; failures = wFailed(1) + tFailed(1)
  //          + mFailed(1) + feedbackOpen(1) = 4.
  assert.equal(report.rates.failure.state, "ok");
  assert.equal(report.rates.failure.total, 8, "failure denominator pools all attempt samples");
  assert.equal(report.rates.failure.count, 4, "failure numerator = failed/rejected/open across pools");
  assert.equal(report.rates.failure.rate, 0.5);
  assert.equal(report.rates.failure.buckets.workersFailed, 1);
  assert.equal(report.rates.failure.buckets.feedbackUnresolved, 1);

  // verifier-pass: decided gates = verified(2)+failed(1) = 3 (pending excluded); pass = 2.
  assert.equal(report.rates.verifierPass.state, "ok");
  assert.equal(report.rates.verifierPass.count, 2);
  assert.equal(report.rates.verifierPass.total, 3, "pending gate excluded from denominator");
  assert.equal(report.rates.verifierPass.rate, round6(2 / 3));

  // candidate-acceptance: accepted(selected)=1 of 3 total.
  assert.equal(report.rates.candidateAcceptance.count, 1);
  assert.equal(report.rates.candidateAcceptance.total, 3);

  // ---- 3. n/a (never 0%/100%) over zero samples --------------------------
  const empty = obs.deriveMetricsReport(emptyRun(), { now: FIXED_NOW });
  for (const key of ["failure", "verifierPass", "candidateAcceptance"]) {
    assert.equal(empty.rates[key].state, "n/a", `${key} is n/a over zero samples`);
    assert.equal(empty.rates[key].count, null, `${key} count is null (not 0)`);
    assert.equal(empty.rates[key].rate, null, `${key} rate is null (not 0%)`);
    assert.equal(empty.rates[key].total, 0);
  }

  // ---- 4. usage coverage + unreported surfaced (never 0) -----------------
  // units: w-estimated (worker w/ output) + t-attested + t-unreported = 3.
  // attested: w-estimated + t-attested = 2 ⇒ coverage 2/3, unreported 1.
  assert.equal(report.usage.units, 3, "usage units = workers-with-output + completed-tasks");
  assert.equal(report.usage.attestedUnits, 2);
  assert.equal(report.usage.unreportedUnits, 1, "unreported surfaced as its own count");
  assert.equal(report.usage.coverage, round6(2 / 3));
  assert.equal(report.usage.inputTokens, 1500, "summed attested input tokens (1000+500)");
  assert.equal(report.usage.outputTokens, 300);

  // ---- 5. cost: unreported / unpriced, never a guessed number ------------
  // No usage at all ⇒ unreported, never 0.
  assert.equal(empty.cost.state, "unreported");
  assert.equal(empty.cost.attestedUsd, null);
  assert.equal(empty.cost.estimatedUsd, null);

  // Attested usage ⇒ unpriced (CW does not price it; not guessed, not 0).
  assert.equal(report.cost.state, "unpriced");
  assert.equal(report.cost.attestedUsd, null);
  assert.equal(report.cost.estimatedUsd, null);

  // ---- 6. determinism over a fixed snapshot ------------------------------
  const a = obs.deriveMetricsReport(fixtureRun(), { now: FIXED_NOW });
  const b = obs.deriveMetricsReport(fixtureRun(), { now: FIXED_NOW });
  assert.equal(JSON.stringify(a), JSON.stringify(b), "byte-identical over a fixed snapshot");
  assert.ok(a.sourceFingerprint.startsWith("sha256:"), "carries a source fingerprint");

  // ---- 7. cross-repo summary pools samples -------------------------------
  const summary = obs.deriveMetricsSummary(
    [{ run: fixtureRun(), repo: "/repoA" }, { run: emptyRun(), repo: "/repoB" }],
    { now: FIXED_NOW, scope: "home" }
  );
  assert.equal(summary.runCount, 2);
  assert.equal(summary.rates.verifierPass.total, 3, "pooled verifier samples");
  assert.equal(summary.usage.attestedUnits, 2, "pooled attested units");
  assert.equal(summary.cost.state, "unpriced");
  assert.ok(summary.byApp.some((g) => g.key === "architecture-review"), "per-app rollup present");
  assert.ok(summary.byBackend.some((g) => g.key === "node") && summary.byBackend.some((g) => g.key === "shell"), "per-backend rollup present");
  const s2 = obs.deriveMetricsSummary(
    [{ run: fixtureRun(), repo: "/repoA" }, { run: emptyRun(), repo: "/repoB" }],
    { now: FIXED_NOW, scope: "home" }
  );
  assert.equal(JSON.stringify(summary), JSON.stringify(s2), "summary deterministic over fixed snapshot");

  process.stdout.write("observability-cost-accounting-smoke: pure-derivation checks ok\n");
}

// ---------------------------------------------------------------------------
// Live parity: plan a real run, record a result, and prove CLI --json == MCP
// for both metrics views.
// ---------------------------------------------------------------------------
async function liveParity() {
  const workspace = tmpDir("cw-metrics-");
  const plan = JSON.parse(
    execFileSync(node, [cli, "plan", "architecture-review", "--repo", workspace, "--question", "metrics smoke"], {
      cwd: workspace,
      encoding: "utf8"
    })
  );
  const runId = plan.runId;

  // Dispatch + record a result: `cw result <run> <task> <file>` must accept an operator result
  // file living outside the worker's sandbox dir and copy it in.
  const dispatch = JSON.parse(execFileSync(node, [cli, "dispatch", runId], { cwd: workspace, encoding: "utf8" }));
  const taskId = dispatch.tasks[0].id;
  const resultFile = path.join(workspace, "result.md");
  fs.writeFileSync(resultFile, '# r\n\n```cw:result\n{"summary":"mapped","findings":[],"evidence":["x"]}\n```\n');
  execFileSync(
    node,
    [cli, "result", runId, taskId, resultFile],
    { cwd: workspace, encoding: "utf8" }
  );

  // An operator result carries no usage: unreported, never a made-up 0.
  const showJson = JSON.parse(execFileSync(node, [cli, "metrics", "show", runId, "--json"], { cwd: workspace, encoding: "utf8" }));
  assert.equal(showJson.usage.attestedUnits, 0, "no usage was reported");
  assert.equal(showJson.cost.state, "unreported", "no usage ⇒ unreported (not 0)");

  const server = spawn(node, [mcpServer], { cwd: workspace, stdio: ["pipe", "pipe", "pipe"] });
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
  const strip = (v) => JSON.stringify(v).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<ts>");

  try {
    await rpc("initialize", {});
    const cliShow = JSON.parse(execFileSync(node, [cli, "metrics", "show", runId, "--json"], { cwd: workspace, encoding: "utf8" }));
    const mcpShow = await tool("cw_metrics_show", { runId, cwd: workspace });
    assert.equal(strip(cliShow), strip(mcpShow), "cw metrics show --json == cw_metrics_show");

    const cliSummary = JSON.parse(execFileSync(node, [cli, "metrics", "summary", "--json"], { cwd: workspace, encoding: "utf8" }));
    const mcpSummary = await tool("cw_metrics_summary", { cwd: workspace });
    assert.equal(strip(cliSummary), strip(mcpSummary), "cw metrics summary --json == cw_metrics_summary");
  } finally {
    server.kill();
  }

  fs.rmSync(workspace, { recursive: true, force: true });
  process.stdout.write("observability-cost-accounting-smoke: live parity ok\n");
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

main();
liveParity()
  .then(() => process.stdout.write("observability-cost-accounting-smoke: ok\n"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
