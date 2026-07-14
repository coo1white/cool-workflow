#!/usr/bin/env node
"use strict";
// bench/run.js v2 — simplified benchmark runner.
// Output: CSV line to stdout; all human progress to stderr.
//
// Portable: node only (the old run.sh needed bash + perl + python3; the timing
// and JSON extraction those provided are native here). k6 stays optional — the
// load phase is skipped when k6 is not installed or the workbench probe fails.
//
// Usage: node run.js --arch <name> --agent <name> --conc <N> [--runs <N>]
//        [--delay-ms <N>] [--skip-workbench] [--json-report <path>]

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const { setTimeout: sleep } = require("node:timers/promises");

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugins", "cool-workflow");
const STUB = path.join(SCRIPT_DIR, "agent-stub.js");
const K6_SCRIPT = path.join(SCRIPT_DIR, "bench-k6.js");
const BENCH_WORK = path.join("/tmp", `cw-bench-work-${process.pid}`);

let ARCH = "ARM64";
let AGENT = "claude";
let RUNS = 3;
let CONC = 4;
let DOCKER = ""; // docker image tag, e.g. "18" or "22" (recorded only)
let DELAY_OVERRIDE;
let SKIP_WORKBENCH = false;
let JSON_REPORT = "";

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  switch (argv[i]) {
    case "--arch":
      ARCH = argv[++i];
      break;
    case "--agent":
      AGENT = argv[++i];
      break;
    case "--runs":
      RUNS = Number(argv[++i]);
      break;
    case "--conc":
      CONC = Number(argv[++i]);
      break;
    case "--docker":
      DOCKER = argv[++i];
      break;
    case "--delay-ms":
      DELAY_OVERRIDE = nonNegativeSafeInt(argv[++i], "--delay-ms");
      break;
    case "--skip-workbench":
      SKIP_WORKBENCH = true;
      break;
    case "--json-report":
      JSON_REPORT = argv[++i] || "";
      if (!JSON_REPORT) fail("--json-report requires a path");
      break;
    default:
      break; // unknown args are skipped, matching the old runner
  }
}
void DOCKER;

const DELAYS = { claude: 45000, gemini: 30000, deepseek: 20000, codex: 25000 };
const DELAY_MS = DELAY_OVERRIDE === undefined ? DELAYS[AGENT] : DELAY_OVERRIDE;
if (DELAY_MS === undefined) {
  console.error(`Unknown agent: ${AGENT}`);
  process.exit(1);
}

function log(msg) {
  process.stderr.write(msg + "\n");
}

function fail(message) {
  process.stderr.write(`bench: ${message}\n`);
  process.exit(1);
}

function nonNegativeSafeInt(value, name) {
  if (!/^\d+$/.test(String(value || ""))) fail(`${name} requires a non-negative safe integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail(`${name} requires a non-negative safe integer`);
  return parsed;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

// Combined stdout+stderr capture (the old runner's `$(cmd 2>&1)`), never throws.
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  const out = (res.stdout || "") + (res.stderr || "");
  return { status: res.status, out, error: res.error };
}

// The old runner piped combined CLI output into `python3 json.load`; a parse
// failure fell back to a default. Same contract here.
function jsonField(text, field, fallback) {
  try {
    const value = JSON.parse(text)[field];
    return value === undefined ? fallback : String(value);
  } catch {
    return fallback;
  }
}

function hasK6() {
  const res = spawnSync("k6", ["version"], { stdio: "ignore" });
  return !res.error && res.status === 0;
}

// `curl -sf <url>` equivalent: resolves true on a 2xx response.
function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

async function main() {
  log(`=== ${ARCH} / conc=${CONC} / ${AGENT} (delay=${DELAY_MS}ms, runs=${RUNS}) ===`);

  fs.rmSync(BENCH_WORK, { recursive: true, force: true });
  fs.mkdirSync(BENCH_WORK, { recursive: true });
  fs.writeFileSync(path.join(BENCH_WORK, "README.md"), "# benchmark target repo\n");

  // ---- k6 ----
  let k6Rps = "N/A";
  let k6P95 = "N/A";
  if (SKIP_WORKBENCH) {
    k6Rps = "SKIPPED";
    k6P95 = "SKIPPED";
    log("  k6: skipped");
  } else {
    log("  k6: starting workbench...");
    const wb = spawn("node", ["dist/cli.js", "workbench", "serve", "--port", "7717"], {
      cwd: PLUGIN_DIR,
      stdio: "ignore",
    });
    await sleep(3000);
    if (hasK6() && (await probe("http://127.0.0.1:7717/api/serve"))) {
      const k6 = run("k6", ["run", "--quiet", K6_SCRIPT], { cwd: PLUGIN_DIR });
      const rpsLine = k6.out.split("\n").find((l) => l.includes("http_reqs"));
      const rps = rpsLine && rpsLine.match(/[0-9.]+\/s/);
      if (rps) k6Rps = rps[0].replace(/\/s$/, "");
      const durLine = k6.out.split("\n").find((l) => l.includes("http_req_duration"));
      const p95 = durLine && durLine.match(/p\(95\)=([0-9.]+)[a-z]*/);
      if (p95) k6P95 = p95[1];
      log(`  k6: rps=${k6Rps} p95=${k6P95}ms`);
    }
    wb.kill();
    await new Promise((resolve) => {
      wb.once("exit", resolve);
      wb.once("error", resolve);
    });
  }

  // ---- CW plan + drive ----
  log(`  cw: ${RUNS} runs...`);
  let totalMs = 0;
  let totalPlanMs = 0;
  const runMetrics = [];

  for (let i = 1; i <= RUNS; i++) {
    fs.rmSync(path.join(BENCH_WORK, ".cw"), { recursive: true, force: true });

    // Step 1: plan
    const planStart = Date.now();
    const plan = run(
      "node",
      [path.join(PLUGIN_DIR, "dist", "cli.js"), "plan", "architecture-review-fast", "--repo", BENCH_WORK, "--question", `bench${i}`],
      { cwd: BENCH_WORK },
    );
    const planMs = Date.now() - planStart;
    totalPlanMs += planMs;
    const runId = jsonField(plan.out, "runId", "");

    // Step 2: drive (must run from the same repo cwd)
    const driveStart = Date.now();
    const drive = run(
      "node",
      [
        path.join(PLUGIN_DIR, "dist", "cli.js"),
        "run",
        "--drive",
        "--run",
        runId,
        "--agent-command",
        `node ${STUB} --agent ${AGENT} --delay-ms ${DELAY_MS} {{result}}`,
        "--concurrency",
        String(CONC),
      ],
      { cwd: BENCH_WORK },
    );
    const driveMs = Date.now() - driveStart;

    const elapsed = planMs + driveMs;
    totalMs += elapsed;

    const status = jsonField(drive.out, "status", "?");
    const comp = jsonField(drive.out, "completedWorkers", "?");
    runMetrics.push({ index: i, planMs, driveMs, totalMs: elapsed, status, completedWorkers: comp });
    log(`    ${i}: plan=${planMs}ms drive=${driveMs}ms total=${elapsed}ms status=${status} completed=${comp}`);
  }

  const meanMs = Math.floor(totalMs / RUNS);
  const meanPlanMs = Math.floor(totalPlanMs / RUNS);

  // app: Map(2) Assess(2) Verify(1) Verdict(1)
  // autoWidth = min(maxConcurrentAgents, tasks) = 2 for Map+Assess
  // rounds = ceil(2/2) + ceil(2/2) + 1 + 1 = 4
  const ROUNDS = 4;
  const expected = DELAY_MS * ROUNDS;
  const overheadMs = meanMs - meanPlanMs - expected;

  if (JSON_REPORT) {
    const report = {
      schemaVersion: 1,
      benchmark: "architecture-review-fast",
      arch: ARCH,
      node: "22",
      concurrency: CONC,
      agent: AGENT,
      delayMs: DELAY_MS,
      skipWorkbench: SKIP_WORKBENCH,
      runs: runMetrics,
      medianPlanMs: median(runMetrics.map((run) => run.planMs)),
      medianDriveMs: median(runMetrics.map((run) => run.driveMs)),
      medianTotalMs: median(runMetrics.map((run) => run.totalMs)),
    };
    fs.mkdirSync(path.dirname(path.resolve(JSON_REPORT)), { recursive: true });
    fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  fs.rmSync(BENCH_WORK, { recursive: true, force: true });

  process.stdout.write(
    [ARCH, "22", CONC, AGENT, meanPlanMs, overheadMs, meanMs, k6Rps, k6P95, DELAY_MS].join(",") + "\n",
  );
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
