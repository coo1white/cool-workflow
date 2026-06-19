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
// The DEFAULT stays sequential (concurrency 1) as a deterministic backstop for
// the bare `npm test` / tag-gate path; the high-frequency CI surfaces opt into
// `--concurrency auto`. Override anytime: CW_TEST_CONCURRENCY=4 or --concurrency.

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
function argValue(name) {
  const args = process.argv.slice(2);
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
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
const jsonSummaryPath = argValue("--json-summary");

const smokes = fs
  .readdirSync(testDir)
  .filter((file) => file.endsWith("-smoke.js"))
  .sort();

if (smokes.length === 0) {
  process.stderr.write(`${SELF}: no test/*-smoke.js files found — refusing to pass vacuously.\n`);
  process.exit(1);
}

// Contention-sensitive smokes can be kept out of the parallel pool here. Keep
// this list minimal and justified: it is not an escape hatch for races. It is
// currently empty because the former timing smokes now prove concurrency from
// child start/end intervals rather than whole-smoke wall-clock thresholds.
const SERIAL_ONLY = new Set([]);
const pooledSmokes = smokes.filter((file) => !SERIAL_ONLY.has(file));
const serialSmokes = smokes.filter((file) => SERIAL_ONLY.has(file));

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
  const env = { ...process.env, CW_HOME: home, XDG_STATE_HOME: home, HOME: home, TMPDIR: tmp };
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
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const finish = (result) => {
      try {
        fs.rmSync(sandbox.root, { recursive: true, force: true });
      } catch {
        // best-effort teardown; a leaked tmpdir must never fail a smoke
      }
      resolve(result);
    };
    child.on("close", (code) => {
      const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      finish({ file, ok: code === 0, code, elapsedMs, output });
    });
    child.on("error", (error) => {
      const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      finish({ file, ok: false, code: null, elapsedMs, output: `${output}${error.message}\n` });
    });
  });
}

async function main() {
  const wallStartedAt = process.hrtime.bigint();
  process.stdout.write(
    `Running ${smokes.length} smoke(s) — concurrency ${concurrency}` +
      (concurrency === 1
        ? " (sequential; set CW_TEST_CONCURRENCY to parallelize)"
        : serialSmokes.length
          ? ` (${pooledSmokes.length} pooled + ${serialSmokes.length} serial-only)`
          : "") +
      "\n\n",
  );

  const results = [];

  // Phase 1 — the parallel pool: every state-isolated smoke, up to `concurrency`.
  let next = 0;
  async function worker() {
    while (next < pooledSmokes.length) {
      const file = pooledSmokes[next++];
      const result = await runSmoke(file);
      results.push(result);
      const tag = result.ok ? "PASS" : "FAIL";
      process.stdout.write(`  ${tag}  ${file}  (${result.elapsedMs}ms)\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pooledSmokes.length) }, worker));

  // Phase 2 — contention-sensitive timing benchmarks, run ALONE on the now-quiet
  // cpu so their wall-clock assertions measure CW, not co-tenant pool load.
  for (const file of serialSmokes) {
    const result = await runSmoke(file);
    results.push(result);
    const tag = result.ok ? "PASS" : "FAIL";
    process.stdout.write(`  ${tag}  ${file}  (${result.elapsedMs}ms) [serial-only]\n`);
  }

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
  const wallElapsedMs = Number((process.hrtime.bigint() - wallStartedAt) / 1000000n);
  process.stdout.write(
    `\n${"=".repeat(70)}\n` +
      `${results.length - failures.length}/${results.length} passed` +
      `, ${failures.length} failed — ${totalMs}ms total\n`,
  );

  if (jsonSummaryPath) {
    writeJsonSummary(jsonSummaryPath, {
      schemaVersion: 1,
      concurrency,
      wallElapsedMs,
      sumChildElapsedMs: totalMs,
      results: results.map((result) => ({
        file: result.file,
        ok: result.ok,
        code: result.code,
        elapsedMs: result.elapsedMs
      })),
      slowest: [...results]
        .sort((a, b) => b.elapsedMs - a.elapsedMs)
        .slice(0, 10)
        .map((result) => ({
          file: result.file,
          ok: result.ok,
          code: result.code,
          elapsedMs: result.elapsedMs
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
