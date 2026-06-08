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
// Sequential by default (CW_TEST_CONCURRENCY=1) because some smokes operate in
// the package cwd's .cw/ rather than a private tmpdir, so parallel runs could
// race. Opt into parallelism explicitly: CW_TEST_CONCURRENCY=4 npm test.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testDir = __dirname;
const packageDir = path.resolve(testDir, "..");
const SELF = path.basename(__filename);

// Concurrency precedence: `--concurrency <n|auto>` (portable, Windows-safe) >
// CW_TEST_CONCURRENCY env > sequential default (1). Sequential stays the default
// for the authoritative gate (`npm test`); `npm run test:fast` passes `auto`.
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
function resolveConcurrency() {
  const raw = argConcurrency() ?? process.env.CW_TEST_CONCURRENCY;
  if (raw === "auto") {
    const cores = (typeof os.availableParallelism === "function" ? os.availableParallelism() : 0) || os.cpus().length || 4;
    return Math.min(8, Math.max(2, cores - 1));
  }
  return Math.max(1, Number(raw) || 1);
}
const concurrency = resolveConcurrency();

const smokes = fs
  .readdirSync(testDir)
  .filter((file) => file.endsWith("-smoke.js"))
  .sort();

if (smokes.length === 0) {
  process.stderr.write(`${SELF}: no test/*-smoke.js files found — refusing to pass vacuously.\n`);
  process.exit(1);
}

function runSmoke(file) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    const child = spawn(process.execPath, [path.join(testDir, file)], {
      cwd: packageDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      resolve({ file, ok: code === 0, code, elapsedMs, output });
    });
    child.on("error", (error) => {
      const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      resolve({ file, ok: false, code: null, elapsedMs, output: `${output}${error.message}\n` });
    });
  });
}

async function main() {
  process.stdout.write(
    `Running ${smokes.length} smoke(s) — concurrency ${concurrency}` +
      (concurrency === 1 ? " (sequential; set CW_TEST_CONCURRENCY to parallelize)" : "") +
      "\n\n",
  );

  const results = [];
  let next = 0;
  async function worker() {
    while (next < smokes.length) {
      const file = smokes[next++];
      const result = await runSmoke(file);
      results.push(result);
      const tag = result.ok ? "PASS" : "FAIL";
      process.stdout.write(`  ${tag}  ${file}  (${result.elapsedMs}ms)\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, smokes.length) }, worker));

  results.sort((a, b) => a.file.localeCompare(b.file));
  const failures = results.filter((r) => !r.ok);

  if (failures.length > 0) {
    process.stdout.write(`\n${"=".repeat(70)}\nFailures:\n`);
    for (const failure of failures) {
      process.stdout.write(
        `\n--- ${failure.file} (exit ${failure.code}) ---\n${failure.output.trimEnd()}\n`,
      );
    }
  }

  const totalMs = results.reduce((sum, r) => sum + r.elapsedMs, 0);
  process.stdout.write(
    `\n${"=".repeat(70)}\n` +
      `${results.length - failures.length}/${results.length} passed` +
      `, ${failures.length} failed — ${totalMs}ms total\n`,
  );

  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${SELF}: runner crashed: ${error.stack || error.message}\n`);
  process.exit(1);
});
