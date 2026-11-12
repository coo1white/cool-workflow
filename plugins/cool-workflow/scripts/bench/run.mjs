#!/usr/bin/env node
// bench/run.mjs v2 — simplified benchmark runner.
// Output: CSV line to stdout; all human progress to stderr.
//
// Portable: node only (the old run.sh needed bash + perl + python3; the timing
// and JSON extraction those provided are native here).
//
// Usage: node run.mjs --arch <name> --agent <name> --conc <N> [--runs <N>]
//        [--delay-ms <N>] [--json-report <path>]
//
// Each run is one `cw -q` (plan and drive are one command since batch 5),
// so the plan time is recorded as 0 and the drive time is the whole run.
// --conc is recorded only: the drive's width comes from the app's
// maxConcurrentAgents.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = import.meta.dirname;
const PLUGIN_DIR = path.resolve(SCRIPT_DIR, "..", "..");
const STUB = path.join(SCRIPT_DIR, "agent-stub.mjs");
const BENCH_WORK = path.join("/tmp", `cw-bench-work-${process.pid}`);

let ARCH = "ARM64";
let AGENT = "claude";
let RUNS = 3;
let CONC = 4;
let DOCKER = ""; // docker image tag, e.g. "18" or "22" (recorded only)
let DELAY_OVERRIDE;
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

// stdout capture (the --json result; progress goes to stderr), never throws.
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { status: res.status, out: res.stdout || "", error: res.error };
}

// A parse failure falls back to a default.
function jsonField(text, field, fallback) {
  try {
    const value = JSON.parse(text)[field];
    return value === undefined ? fallback : String(value);
  } catch {
    return fallback;
  }
}

async function main() {
  log(`=== ${ARCH} / conc=${CONC} / ${AGENT} (delay=${DELAY_MS}ms, runs=${RUNS}) ===`);

  fs.rmSync(BENCH_WORK, { recursive: true, force: true });
  fs.mkdirSync(BENCH_WORK, { recursive: true });
  fs.writeFileSync(path.join(BENCH_WORK, "README.md"), "# benchmark target repo\n");
  spawnSync("git", ["init", "-q"], { cwd: BENCH_WORK }); // cw -q reviews a git project

  // ---- cw -q (plan + drive) ----
  log(`  cw: ${RUNS} runs...`);
  let totalMs = 0;
  const runMetrics = [];

  for (let i = 1; i <= RUNS; i++) {
    fs.rmSync(path.join(BENCH_WORK, ".cw"), { recursive: true, force: true });

    const planMs = 0;
    const driveStart = Date.now();
    const drive = run(process.execPath, [path.join(PLUGIN_DIR, "dist", "cli.js"), "-q", `bench${i}`, "--json"], {
      cwd: BENCH_WORK,
      env: {
        ...process.env,
        CW_AGENT_COMMAND: `node ${STUB} --agent ${AGENT} --delay-ms ${DELAY_MS} {{result}}`,
        CW_NO_AUTO_AGENT: "1",
        CW_NO_OPEN: "1",
      },
    });
    const driveMs = Date.now() - driveStart;

    const elapsed = planMs + driveMs;
    totalMs += elapsed;

    const status = jsonField(drive.out, "status", "?");
    const comp = jsonField(drive.out, "completedWorkers", "?");
    runMetrics.push({ index: i, planMs, driveMs, totalMs: elapsed, status, completedWorkers: comp });
    log(`    ${i}: plan=${planMs}ms drive=${driveMs}ms total=${elapsed}ms status=${status} completed=${comp}`);
  }

  const meanMs = Math.floor(totalMs / RUNS);
  const meanPlanMs = 0;

  // app: Map(6) + Assess(6) in one round (maxConcurrentAgents 12), then
  // Verify(1), then Verdict(1): 3 rounds.
  const ROUNDS = 3;
  const expected = DELAY_MS * ROUNDS;
  const overheadMs = meanMs - meanPlanMs - expected;

  if (JSON_REPORT) {
    const report = {
      schemaVersion: 1,
      benchmark: "architecture-review",
      arch: ARCH,
      node: "22",
      concurrency: CONC,
      agent: AGENT,
      delayMs: DELAY_MS,
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
    [ARCH, "22", CONC, AGENT, meanPlanMs, overheadMs, meanMs, DELAY_MS].join(",") + "\n",
  );
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
