#!/usr/bin/env node
"use strict";

// observability-cost-accounting-smoke (v0.1.31)
//
// Proves the v0.1.31 Observability + Cost Accounting contract:
//  - durations are DERIVED from recorded timestamps (not report time);
//  - failure / verifier-pass / candidate-acceptance rates are correct WITH
//    sample counts, and `n/a` (never 0%/100%) over zero samples;
//  - attested vs estimated cost are kept SEPARATE; `unreported` usage is
//    surfaced with coverage, never folded into 0;
//  - the report is DETERMINISTIC over a fixed snapshot + injected now;
//  - `cw metrics show --json` === `cw_metrics_show` and
//    `cw metrics summary --json` === `cw_metrics_summary` (parity);
//  - host-attested usage intake flows through `cw result` onto the report.

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
const obs = require(path.join(pluginRoot, "dist", "observability.js"));

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
      // completed worker WITH output + attested usage (default-priced model)
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

const EXACT_POLICY = {
  schemaVersion: 1,
  id: "test-exact",
  currency: "USD",
  models: [{ model: "claude-opus-4-8", inputPerMillion: 15, outputPerMillion: 75 }]
  // NO defaultPrice ⇒ unmatched models are unpriced, never estimated.
};
const POLICY_WITH_DEFAULT = {
  schemaVersion: 1,
  id: "test-default",
  currency: "USD",
  models: [{ model: "claude-opus-4-8", inputPerMillion: 15, outputPerMillion: 75 }],
  defaultPrice: { inputPerMillion: 3, outputPerMillion: 15 }
};

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

  // ---- 5. cost: unreported / unpriced / attested / estimated separation --
  // No usage at all ⇒ unreported, never 0.
  assert.equal(empty.cost.state, "unreported");
  assert.equal(empty.cost.attestedUsd, null);
  assert.equal(empty.cost.estimatedUsd, null);

  // Attested usage but NO policy ⇒ unpriced (not guessed, not 0).
  assert.equal(report.cost.state, "unpriced");
  assert.equal(report.cost.attestedUsd, null);

  // Exact policy (no default): opus exact-priced ⇒ attested; mystery-model has
  // no entry and no default ⇒ unpriced portion, kept out of attestedUsd.
  const exact = obs.deriveMetricsReport(fixtureRun(), { now: FIXED_NOW, policy: EXACT_POLICY });
  assert.equal(exact.cost.state, "attested", "exact-match priced ⇒ attested");
  // opus: 1000/1e6*15 + 200/1e6*75 = 0.015 + 0.015 = 0.03
  assert.equal(exact.cost.attestedUsd, 0.03, "attested USD from exact policy");
  assert.equal(exact.cost.estimatedUsd, null, "no estimated figure when no default used");
  assert.deepEqual(exact.cost.unpricedModels, ["mystery-model-x"], "unmatched model surfaced");
  assert.ok(exact.cost.pricedCoverage < 1, "priced coverage < 1 when a model is unpriced");

  // Policy WITH default: mystery-model priced by default ⇒ estimated figure
  // SEPARATE from attested; state is `estimated` (attested+estimated never one).
  const mixed = obs.deriveMetricsReport(fixtureRun(), { now: FIXED_NOW, policy: POLICY_WITH_DEFAULT });
  assert.equal(mixed.cost.state, "estimated", "any default-priced portion ⇒ estimated state");
  assert.equal(mixed.cost.attestedUsd, 0.03, "exact-priced portion stays attested");
  // mystery default: 500/1e6*3 + 100/1e6*15 = 0.0015 + 0.0015 = 0.003
  assert.equal(mixed.cost.estimatedUsd, 0.003, "default-priced portion is a separate estimated figure");

  // ---- 6. determinism over a fixed snapshot ------------------------------
  const a = obs.deriveMetricsReport(fixtureRun(), { now: FIXED_NOW, policy: POLICY_WITH_DEFAULT });
  const b = obs.deriveMetricsReport(fixtureRun(), { now: FIXED_NOW, policy: POLICY_WITH_DEFAULT });
  assert.equal(JSON.stringify(a), JSON.stringify(b), "byte-identical over a fixed snapshot");
  assert.ok(a.sourceFingerprint.startsWith("sha256:"), "carries a source fingerprint");

  // ---- 7. cross-repo summary pools samples, separates cost ---------------
  const summary = obs.deriveMetricsSummary(
    [{ run: fixtureRun(), repo: "/repoA" }, { run: emptyRun(), repo: "/repoB" }],
    { now: FIXED_NOW, scope: "home", policy: POLICY_WITH_DEFAULT }
  );
  assert.equal(summary.runCount, 2);
  assert.equal(summary.rates.verifierPass.total, 3, "pooled verifier samples");
  assert.equal(summary.usage.attestedUnits, 2, "pooled attested units");
  assert.equal(summary.cost.state, "estimated");
  assert.equal(summary.cost.attestedUsd, 0.03);
  assert.equal(summary.cost.estimatedUsd, 0.003);
  assert.ok(summary.byApp.some((g) => g.key === "architecture-review"), "per-app rollup present");
  assert.ok(summary.byBackend.some((g) => g.key === "node") && summary.byBackend.some((g) => g.key === "shell"), "per-backend rollup present");
  const s2 = obs.deriveMetricsSummary(
    [{ run: fixtureRun(), repo: "/repoA" }, { run: emptyRun(), repo: "/repoB" }],
    { now: FIXED_NOW, scope: "home", policy: POLICY_WITH_DEFAULT }
  );
  assert.equal(JSON.stringify(summary), JSON.stringify(s2), "summary deterministic over fixed snapshot");

  process.stdout.write("observability-cost-accounting-smoke: pure-derivation checks ok\n");
}

// ---------------------------------------------------------------------------
// Live parity + intake: plan a real run, record a result WITH attested usage,
// and prove CLI --json == MCP for both metrics views.
// ---------------------------------------------------------------------------
async function liveParity() {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-metrics-")));
  const plan = JSON.parse(
    execFileSync(node, [cli, "plan", "architecture-review", "--repo", workspace, "--question", "metrics smoke"], {
      cwd: workspace,
      encoding: "utf8"
    })
  );
  const runId = plan.runId;

  // Dispatch + record a result with host-attested usage through the real intake.
  const dispatch = JSON.parse(execFileSync(node, [cli, "dispatch", runId], { cwd: workspace, encoding: "utf8" }));
  const taskId = dispatch.tasks[0].id;
  const resultFile = path.join(workspace, "result.md");
  fs.writeFileSync(resultFile, '# r\n\n```cw:result\n{"summary":"mapped","findings":[],"evidence":["x"]}\n```\n');
  execFileSync(
    node,
    [cli, "result", runId, taskId, resultFile, "--usage-input-tokens", "1000", "--usage-output-tokens", "200", "--usage-model", "claude-opus-4-8", "--usage-source", "host-attested"],
    { cwd: workspace, encoding: "utf8" }
  );

  // Usage intake landed on the report (coverage > 0, attested tokens summed).
  const showJson = JSON.parse(execFileSync(node, [cli, "metrics", "show", runId, "--json"], { cwd: workspace, encoding: "utf8" }));
  assert.ok(showJson.usage.attestedUnits >= 1, "host-attested usage flowed through cw result intake");
  assert.equal(showJson.usage.inputTokens, 1000, "attested input tokens recorded verbatim");
  assert.equal(showJson.cost.state, "unpriced", "no policy ⇒ unpriced (not 0)");

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
  process.stdout.write("observability-cost-accounting-smoke: live parity + intake ok\n");
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
