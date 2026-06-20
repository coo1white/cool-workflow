#!/usr/bin/env node
"use strict";

// run-all — the smoke-test runner.
//
// Replaces the previous 30-deep `&&` chain in package.json's "test" script.
// That chain had three defects this runner fixes:
//   1. First failure aborted the rest, so one broken smoke hid every smoke after
//      it. Here every smoke runs; failures are collected and reported together.
//   2. No isolation/reporting — output was an undifferentiated stream. Here each
//      smoke runs in its own child process with a per-file PASS/FAIL + duration.
//   3. The list was hand-maintained, so a smoke could exist on disk yet never
//      run (multi-agent-eval-replay-smoke.js was silently dropped this way).
//      Here the suite is DISCOVERED from test/*-smoke.js — fail closed: a new
//      smoke is included the moment it lands, nothing to forget to wire up.
//
// Portable by design: node only, no test framework, no new dependency — same
// constraint the rest of the repo's tooling holds to (node/npm/git only).
//
// Parallel-safe by construction: every smoke runs in its OWN private cwd with
// its OWN state roots (CW_HOME/XDG_STATE_HOME/HOME/TMPDIR all point at a
// per-child tmpdir, torn down after). That isolates the two roots CW writes —
// the repo `.cw/` (resolved from cwd) and the home registry (resolved from
// CW_HOME) — so concurrent smokes never share `.cw/`, the home registry, or a
// file lock. This replaces the previous "some smokes race on the shared
// package .cw/" hazard that forced sequential execution.
//
// Default is auto (cores-capped parallel). The tag-gate (release-gate.sh) forces
// sequential via CW_TEST_CONCURRENCY=1 to stay deterministic. Override anytime:
// CW_TEST_CONCURRENCY=4 or --concurrency.
//
// v0.1.88 additions (P3-stage1/P3-stage2):
//   --filter <regex> | CW_TEST_FILTER       — run only smokes matching pattern
//   CW_TEST_TIMEOUT_MS (default 120000)      — per-test timeout
//   --retry <n> | CW_TEST_RETRY              — retry failed tests up to n times
//   stdout/stderr separated in captured output
//   --bail | CW_TEST_BAIL=1                  — stop after first failure
//   // CW_SKIP: <reason>                     — skip convention, detected from file header

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testDir = __dirname;
const packageDir = path.resolve(testDir, "..");
const SELF = path.basename(__filename);

// Concurrency precedence: `--concurrency <n|auto>` (portable, Windows-safe) >
// CW_TEST_CONCURRENCY env > auto default. The release-gate forces sequential
// via CW_TEST_CONCURRENCY=1.
//
// `auto` is cores-aware AND capped: it prefers os.availableParallelism() (which
// respects CPU affinity, so it is sane in many containers) and falls back to
// os.cpus(); the Math.min cap bounds oversubscription even when the count is
// over-reported (a CPU-quota container reports HOST cores), and the suite sees no
// benefit past ~8 anyway. Floor of 2 so `auto` is always actually parallel.
function argConcurrency() {
  const args = process.argv.slice(2);
  const eq = args.find((a) => a.startsWith("--concurrency="));
  if (eq) return eq.slice("--concurrency=".length);
  const i = args.indexOf("--concurrency");
  return i >= 0 ? args[i + 1] : undefined;
}
function argValue(name) {
  const args = process.argv.slice(2);
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function resolveConcurrency() {
  const raw = argConcurrency() ?? process.env.CW_TEST_CONCURRENCY;
  if (raw === "auto" || raw === undefined) {
    const cores = (typeof os.availableParallelism === "function" ? os.availableParallelism() : 0) || os.cpus().length || 4;
    return Math.min(8, Math.max(2, cores - 1));
  }
  return Math.max(1, Number(raw) || 1);
}
const concurrency = resolveConcurrency();
const jsonSummaryPath = argValue("--json-summary");

// --filter <regex> | CW_TEST_FILTER — run only smokes whose filename matches.
const filterRaw = argValue("--filter") ?? process.env.CW_TEST_FILTER;
const filterPattern = filterRaw ? new RegExp(filterRaw) : null;

// --retry <n> | CW_TEST_RETRY — retry a failed smoke up to n more times.
const retryRaw = argValue("--retry") ?? process.env.CW_TEST_RETRY;
const maxRetries = Math.max(0, Number(retryRaw) || 0);

// Per-test timeout: CW_TEST_TIMEOUT_MS (default 120s).
const PER_TEST_TIMEOUT_MS = Math.max(1000, Number(process.env.CW_TEST_TIMEOUT_MS) || 120000);

// --bail | CW_TEST_BAIL=1 — stop after first failure.
const bail = process.argv.includes("--bail") || process.env.CW_TEST_BAIL === "1";

// CW_SKIP convention: if a smoke's first 10 lines contain `// CW_SKIP: <reason>`,
// it is skipped with the reason recorded. Use for temporarily disabling a smoke.
function checkSkip(file) {
  const content = fs.readFileSync(path.join(testDir, file), "utf8");
  const firstLines = content.split("\n").slice(0, 10).join("\n");
  const match = firstLines.match(/\/\/\s*CW_SKIP:\s*(.+)/);
  return match ? match[1].trim() : null;
}

let smokes = fs
  .readdirSync(testDir)
  .filter((file) => file.endsWith("-smoke.js"))
  .sort();

if (smokes.length === 0) {
  process.stderr.write(`${SELF}: no test/*-smoke.js files found — refusing to pass vacuously.\n`);
  process.exit(1);
}

// Apply filter before split so skipped smokes don't consume a serial-only slot.
if (filterPattern) {
  const before = smokes.length;
  smokes = smokes.filter((file) => filterPattern.test(file));
  if (smokes.length === 0) {
    process.stderr.write(`${SELF}: filter "${filterRaw}" matched no smoke files (had ${before} total).\n`);
    process.exit(1);
  }
}

// CW_SKIP convention: detect skipped smokes before splitting into pool/serial.
const skippedReasons = new Map();
const eligibleSmokes = [];
for (const file of smokes) {
  const reason = checkSkip(file);
  if (reason) {
    skippedReasons.set(file, reason);
  } else {
    eligibleSmokes.push(file);
  }
}

// Contention-sensitive smokes can be kept out of the parallel pool. Configurable
// via CW_TEST_SERIAL_ONLY=file1.js,file2.js (env), or the hardcoded set.
// The list is currently empty because the former timing smokes now prove
// concurrency from child start/end intervals rather than whole-smoke wall-clock
// thresholds.
const serialEnv = (process.env.CW_TEST_SERIAL_ONLY || "").trim();
const SERIAL_ONLY = new Set(serialEnv ? serialEnv.split(",").map((s) => s.trim()).filter(Boolean) : []);
const pooledSmokes = eligibleSmokes.filter((file) => !SERIAL_ONLY.has(file));
const serialSmokes = eligibleSmokes.filter((file) => SERIAL_ONLY.has(file));

// Build a private, fully-isolated sandbox for one smoke child: a unique cwd plus
// state-root env so the smoke's repo `.cw/` (cwd-derived) and home registry
// (CW_HOME-derived, default ~/.local/state — shared otherwise) land in throwaway
// dirs. No smoke reads anything relative to cwd (requires resolve against the
// test file, spawns use absolute __dirname paths), so the private cwd is safe.
function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-"));
  const cwd = path.join(root, "cwd");
  const home = path.join(root, "home");
  const tmp = path.join(root, "tmp");
  for (const dir of [cwd, home, tmp]) fs.mkdirSync(dir, { recursive: true });
  const env = { ...process.env, CW_HOME: home, XDG_STATE_HOME: home, HOME: home, TMPDIR: tmp, CW_NO_AUTO_AGENT: "1" };
  return { root, cwd, env };
}

function runSmoke(file) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    const sandbox = makeSandbox();
    const child = spawn(process.execPath, [path.join(testDir, file)], {
      cwd: sandbox.cwd,
      env: sandbox.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // If still alive after 3s, SIGKILL.
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }, 3000).unref();
    }, PER_TEST_TIMEOUT_MS);

    const finish = (result) => {
      clearTimeout(timer);
      try {
        fs.rmSync(sandbox.root, { recursive: true, force: true });
      } catch {
        // best-effort teardown; a leaked tmpdir must never fail a smoke
      }
      resolve(result);
    };
    child.on("close", (code) => {
      const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      const output = [stdout, stderr].filter(Boolean).join("");
      finish({ file, ok: code === 0 && !timedOut, code, elapsedMs, output, stdout, stderr, timedOut });
    });
    child.on("error", (error) => {
      const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      const output = [stdout, stderr, error.message].filter(Boolean).join("\n");
      finish({ file, ok: false, code: null, elapsedMs, output, stdout, stderr, timedOut: false });
    });
  });
}

// Run one smoke with optional retries. Returns the final result. Each retry gets
// a fresh sandbox. If all attempts fail, the LAST failure's output is preserved
// for the failure report; the retry count is recorded in the result.
async function runSmokeWithRetry(file) {
  let lastResult = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await runSmoke(file);
    lastResult = result;
    lastResult.retries = attempt;
    if (result.ok) break;
    // Don't retry timeout or crash failures (only assertion/semantic failures).
    if (result.timedOut) break;
  }
  return lastResult;
}

async function main() {
  const wallStartedAt = process.hrtime.bigint();

  const filterNote = filterPattern ? ` (filter: ${filterRaw})` : "";
  const retryNote = maxRetries > 0 ? ` (max-retries: ${maxRetries})` : "";
  const skipNote = skippedReasons.size > 0 ? ` (${skippedReasons.size} skipped)` : "";
  const bailNote = bail ? " (--bail)" : "";
  process.stdout.write(
    `Running ${eligibleSmokes.length} smoke(s) — concurrency ${concurrency}` +
      filterNote +
      retryNote +
      skipNote +
      bailNote +
      (concurrency === 1
        ? " (sequential; set CW_TEST_CONCURRENCY to parallelize)"
        : serialSmokes.length
          ? ` (${pooledSmokes.length} pooled + ${serialSmokes.length} serial-only)`
          : "") +
      "\n\n",
  );

  const results = [];
  let bailed = false;

  // Phase 1 — the parallel pool: every state-isolated smoke, up to `concurrency`.
  let next = 0;
  async function worker() {
    while (next < pooledSmokes.length && !bailed) {
      const file = pooledSmokes[next++];
      const result = await runSmokeWithRetry(file);
      results.push(result);
      const tag = result.ok ? "PASS" : "FAIL";
      const timedOutNote = result.timedOut ? " [TIMEOUT]" : "";
      const retryNote = result.retries > 0 ? ` [retry ${result.retries}/${maxRetries}]` : "";
      process.stdout.write(`  ${tag}  ${file}  (${result.elapsedMs}ms)${timedOutNote}${retryNote}\n`);
      if (!result.ok && bail) bailed = true;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pooledSmokes.length) }, worker));

  // Phase 2 — contention-sensitive timing benchmarks, run ALONE on the now-quiet
  // cpu so their wall-clock assertions measure CW, not co-tenant pool load.
  for (const file of serialSmokes) {
    if (bailed) break;
    const result = await runSmokeWithRetry(file);
    results.push(result);
    const tag = result.ok ? "PASS" : "FAIL";
    const timedOutNote = result.timedOut ? " [TIMEOUT]" : "";
    const retryNote = result.retries > 0 ? ` [retry ${result.retries}/${maxRetries}]` : "";
    process.stdout.write(`  ${tag}  ${file}  (${result.elapsedMs}ms) [serial-only]${timedOutNote}${retryNote}\n`);
    if (!result.ok && bail) bailed = true;
  }

  results.sort((a, b) => a.file.localeCompare(b.file));
  const failures = results.filter((r) => !r.ok);

  // Print skipped smokes first (they did not run).
  if (skippedReasons.size > 0) {
    process.stdout.write(`\n${"=".repeat(70)}\nSkipped (CW_SKIP):\n`);
    for (const [file, reason] of skippedReasons) {
      process.stdout.write(`  SKIP  ${file}  — ${reason}\n`);
    }
  }

  if (failures.length > 0) {
    const bailNote = bailed ? " [BAIL]" : "";
    process.stdout.write(`\n${"=".repeat(70)}\nFailures:${bailNote}\n`);
    for (const failure of failures) {
      const why = failure.timedOut ? ` (TIMEOUT after ${PER_TEST_TIMEOUT_MS}ms)` : "";
      const retryInfo = failure.retries > 0 ? ` [after ${failure.retries} retries]` : "";
      process.stdout.write(`\n--- ${failure.file} (exit ${failure.code})${why}${retryInfo} ---\n`);
      if (failure.stderr && failure.stderr.trim()) {
        process.stdout.write(`[stderr]\n${failure.stderr.trimEnd()}\n`);
      }
      if (failure.stdout && failure.stdout.trim()) {
        process.stdout.write(`[stdout]\n${failure.stdout.trimEnd()}\n`);
      }
    }
  }

  const totalMs = results.reduce((sum, r) => sum + r.elapsedMs, 0);
  const wallElapsedMs = Number((process.hrtime.bigint() - wallStartedAt) / 1000000n);
  const bailSuffix = bailed ? " (bailed)" : "";
  const skipSuffix = skippedReasons.size > 0 ? ` (${skippedReasons.size} skipped)` : "";
  process.stdout.write(
    `\n${"=".repeat(70)}\n` +
      `${results.length - failures.length}/${results.length} passed` +
      `, ${failures.length} failed${bailSuffix}${skipSuffix} — ${totalMs}ms total\n`,
  );

  if (jsonSummaryPath) {
    writeJsonSummary(jsonSummaryPath, {
      schemaVersion: 1,
      concurrency,
      wallElapsedMs,
      sumChildElapsedMs: totalMs,
      maxRetries,
      perTestTimeoutMs: PER_TEST_TIMEOUT_MS,
      filter: filterRaw || undefined,
      bail: bail || undefined,
      skipped: skippedReasons.size > 0 ? [...skippedReasons.entries()].map(([file, reason]) => ({ file, reason })) : undefined,
      results: results.map((result) => ({
        file: result.file,
        ok: result.ok,
        code: result.code,
        elapsedMs: result.elapsedMs,
        ...(result.retries > 0 ? { retries: result.retries } : {}),
        ...(result.timedOut ? { timedOut: result.timedOut } : {})
      })),
      slowest: [...results]
        .sort((a, b) => b.elapsedMs - a.elapsedMs)
        .slice(0, 10)
        .map((result) => ({
          file: result.file,
          ok: result.ok,
          code: result.code,
          elapsedMs: result.elapsedMs,
          ...(result.retries > 0 ? { retries: result.retries } : {}),
          ...(result.timedOut ? { timedOut: result.timedOut } : {})
        }))
    });
  }

  process.exit(failures.length === 0 ? 0 : 1);
}

function writeJsonSummary(file, summary) {
  const absolute = path.resolve(file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  process.stderr.write(`${SELF}: runner crashed: ${error.stack || error.message}\n`);
  process.exit(1);
});
