#!/usr/bin/env node
"use strict";

// run — the conformance runner.
//
// Runs every case in cases/*.case.js against ONE CLI build, given by
// --bin. The same suite must go green on the old build first (that
// proves the suite states what the old build does), and then the new
// build must pass it too.
//
//   node run.js --bin ../../plugins/cool-workflow/dist/cli.js
//   node run.js --bin ../src-build/cli.js --filter ledger
//
// Design copied from the old test/run-all.js on purpose: discover, do
// not hand-list; run each case in its own child with its own private
// work dir; collect all failures; report together. Zero dependencies.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const here = __dirname;
const casesDir = path.join(here, "cases");

function argValue(name) {
  const args = process.argv.slice(2);
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const binArg = argValue("--bin") || process.env.CW_BIN;
if (!binArg) {
  process.stderr.write("run: give --bin <path to cli entry js>\n");
  process.exit(2);
}
const bin = path.resolve(binArg);
if (!fs.existsSync(bin)) {
  process.stderr.write(`run: no such file: ${bin}\n`);
  process.exit(2);
}

const filterRaw = argValue("--filter");
const filter = filterRaw ? new RegExp(filterRaw) : null;
const jsonSummaryPath = argValue("--json-summary");

function resolveConcurrency() {
  const raw = argValue("--concurrency");
  if (raw && raw !== "auto") return Math.max(1, Number(raw) || 1);
  const cores = (typeof os.availableParallelism === "function" ? os.availableParallelism() : 0) || os.cpus().length || 4;
  return Math.min(8, Math.max(2, cores - 1));
}
const concurrency = resolveConcurrency();

const TIMEOUT_MS = Math.max(1000, Number(process.env.CW_CASE_TIMEOUT_MS) || 120000);

let files = [];
if (fs.existsSync(casesDir)) {
  files = fs.readdirSync(casesDir).filter((f) => f.endsWith(".case.js")).sort();
}
if (filter) files = files.filter((f) => filter.test(f));
if (files.length === 0) {
  process.stderr.write("run: no cases found\n");
  process.exit(2);
}

function runOne(file) {
  return new Promise((resolve) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-conf-"));
    const child = spawn(process.execPath, [path.join(casesDir, file)], {
      env: Object.assign({}, process.env, {
        CW_BIN: bin,
        CW_CONF_WORK: work,
        CW_CASE_TIMEOUT_MS: String(TIMEOUT_MS),
        NO_COLOR: "1",
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const started = Date.now();
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS + 5000);
    child.on("close", (code) => {
      clearTimeout(timer);
      fs.rmSync(work, { recursive: true, force: true });
      resolve({ file, code, out, err, ms: Date.now() - started });
    });
  });
}

(async () => {
  const queue = files.slice();
  const results = [];
  async function worker() {
    for (;;) {
      const file = queue.shift();
      if (!file) return;
      const r = await runOne(file);
      results.push(r);
      const mark = r.code === 0 ? "PASS" : "FAIL";
      process.stderr.write(`${mark} ${r.file} (${r.ms}ms)\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

  const failed = results.filter((r) => r.code !== 0);
  process.stderr.write(`\nconformance: ${results.length - failed.length}/${results.length} passed against ${bin}\n`);
  for (const f of failed) {
    process.stderr.write(`\n--- FAIL ${f.file} (exit ${f.code}) ---\n${f.out}${f.err}`);
  }
  if (jsonSummaryPath) {
    fs.writeFileSync(
      jsonSummaryPath,
      JSON.stringify(
        {
          bin,
          total: results.length,
          passed: results.length - failed.length,
          failed: failed.map((f) => ({ file: f.file, code: f.code, tail: (f.out + f.err).slice(-2000) })),
        },
        null,
        2
      ) + "\n"
    );
  }
  process.exit(failed.length ? 1 : 0);
})();
