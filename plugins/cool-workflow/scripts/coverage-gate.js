#!/usr/bin/env node
"use strict";

// coverage-gate — run the smoke suite under V8 coverage and fail closed when
// line coverage of dist/ drops below the floor.
//
// Why this exists: nothing measured coverage, so a subsystem could ship dark.
// It happened: scheduler.ts sat at 12.7% line coverage (only `schedule list`
// was ever exercised) and no gate noticed. This script makes that class of
// regression visible and blocking.
//
// MECHANISM (this file): spawn test/run-all.js with NODE_V8_COVERAGE set —
// Node's built-in inspector coverage, inherited by every child process the
// smokes spawn (CLI invocations, MCP server, workers), so the numbers reflect
// the real end-to-end surface. Merge the per-process reports byte-wise
// (covered-by-any-process wins), project onto executable lines of dist/**/*.js,
// print the worst files, and compare the overall percentage to the floor.
// node only — no c8, no dependency, same portability constraint as run-all.
//
// POLICY (flags/env): the floor. Default 80; override with --min <pct> or
// CW_COVERAGE_MIN. Raise the default as gaps close — never lower it (ratchet).
//
// FAIL CLOSED: a failing suite fails the gate with the suite's exit code; zero
// coverage reports found fails rather than passing vacuously.
//
// Usage: node scripts/coverage-gate.js [--min 80] [--concurrency <n|auto>]

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SELF = path.basename(__filename);
const packageDir = path.resolve(__dirname, "..");
const distDir = path.join(packageDir, "dist");

function flagValue(name) {
  const args = process.argv.slice(2);
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const floor = Number(flagValue("--min") ?? process.env.CW_COVERAGE_MIN ?? 80);
if (!Number.isFinite(floor) || floor < 0 || floor > 100) {
  process.stderr.write(`${SELF}: invalid coverage floor — expected 0..100.\n`);
  process.exit(1);
}

const covDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-coverage-"));

// Pre-check: ensure dist/ is built before entering the coverage merge phase
// (parity with the `test` and `test:ci` package.json scripts).
{
  const cli = path.join(packageDir, "dist", "cli.js");
  const check = spawnSync(process.execPath, [cli, "version"], { cwd: packageDir, stdio: "pipe", encoding: "utf8" });
  const out = String(check.stdout || "").trim();
  if (check.status !== 0 || !out) {
    process.stderr.write(`${SELF}: dist/cli.js version failed (exit ${check.status}) — build may be stale. Run \`npm run build\` first.\n`);
    process.exit(1);
  }
}

function runSuite() {
  return new Promise((resolve) => {
    const args = [path.join(packageDir, "test", "run-all.js")];
    const concurrency = flagValue("--concurrency");
    if (concurrency) args.push("--concurrency", concurrency);
    const child = spawn(process.execPath, args, {
      cwd: packageDir,
      stdio: "inherit",
      env: { ...process.env, NODE_V8_COVERAGE: covDir }
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// Merge per-process V8 reports for one file. Within a single process the
// ranges nest (function range, then narrower uncovered branches), so paint
// larger ranges first and let nested ranges override. Across processes a byte
// is covered if ANY process covered it — a count-0 range in one process must
// not erase another process's hit.
function paintProcess(functions, length) {
  const ranges = [];
  for (const fn of functions || []) for (const range of fn.ranges || []) ranges.push(range);
  ranges.sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
  const view = new Uint8Array(length); // 0 unreported, 1 covered, 2 uncovered
  for (const range of ranges) {
    view.fill(range.count > 0 ? 1 : 2, Math.max(0, range.startOffset), Math.min(range.endOffset, length));
  }
  return view;
}

// A line counts as executable unless it is blank, a comment, or a lone closer.
// Heuristic, but applied uniformly — the ratchet compares like with like.
function isExecutableLine(line) {
  const t = line.trim();
  return (
    t.length > 0 && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*") &&
    t !== "}" && t !== "};" && t !== "});"
  );
}

function listDistFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listDistFiles(p));
    else if (entry.name.endsWith(".js")) out.push(p);
  }
  return out;
}

function aggregate() {
  const reports = fs.readdirSync(covDir).filter((f) => f.endsWith(".json"));
  if (reports.length === 0) {
    process.stderr.write(`${SELF}: no V8 coverage reports produced — refusing to pass vacuously.\n`);
    process.exit(1);
  }
  const covered = new Map(); // file -> Uint8Array, 1 = covered by any process
  const uncovered = new Map(); // file -> Uint8Array, 1 = reported count-0 somewhere
  const lengths = new Map();
  for (const report of reports) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(covDir, report), "utf8"));
    } catch {
      continue; // a process killed mid-write leaves a truncated report
    }
    for (const script of data.result || []) {
      if (!script.url || !script.url.startsWith("file://")) continue;
      const file = decodeURIComponent(script.url.slice("file://".length));
      if (!file.startsWith(distDir + path.sep)) continue;
      let length = lengths.get(file);
      if (length === undefined) {
        try {
          length = fs.readFileSync(file, "utf8").length;
        } catch {
          continue;
        }
        lengths.set(file, length);
        covered.set(file, new Uint8Array(length));
        uncovered.set(file, new Uint8Array(length));
      }
      const view = paintProcess(script.functions, length);
      const coveredBytes = covered.get(file);
      const uncoveredBytes = uncovered.get(file);
      for (let i = 0; i < length; i++) {
        if (view[i] === 1) coveredBytes[i] = 1;
        else if (view[i] === 2) uncoveredBytes[i] = 1;
      }
    }
  }

  const rows = [];
  for (const file of listDistFiles(distDir)) {
    const source = fs.readFileSync(file, "utf8");
    const length = source.length;
    const coveredBytes = covered.get(file) || new Uint8Array(length);
    const uncoveredBytes = uncovered.get(file) || new Uint8Array(length);
    const loaded = lengths.has(file);
    let offset = 0;
    let total = 0;
    let hit = 0;
    for (const line of source.split("\n")) {
      if (isExecutableLine(line)) {
        total += 1;
        let lineCovered = false;
        let lineReported = false;
        for (let i = offset; i < offset + line.length; i++) {
          if (coveredBytes[i]) {
            lineCovered = true;
            break;
          }
          if (uncoveredBytes[i]) lineReported = true;
        }
        // Unreported bytes in a loaded file are top-level code that ran at
        // require time; in a never-loaded file nothing ran.
        if (lineCovered || (loaded && !lineReported)) hit += 1;
      }
      offset += line.length + 1;
    }
    rows.push({ file: path.relative(distDir, file), total, hit, loaded });
  }
  return rows;
}

(async () => {
  const suiteExit = await runSuite();
  if (suiteExit !== 0) {
    process.stderr.write(`${SELF}: smoke suite failed (exit ${suiteExit}) — coverage not evaluated.\n`);
    process.exit(suiteExit);
  }
  const rows = aggregate();
  let total = 0;
  let hit = 0;
  for (const row of rows) {
    total += row.total;
    hit += row.hit;
  }
  const overall = total ? (100 * hit) / total : 0;

  rows.sort((a, b) => a.hit / Math.max(1, a.total) - b.hit / Math.max(1, b.total));
  process.stdout.write(`\n${SELF}: line coverage of dist/ under the full smoke suite\n`);
  process.stdout.write("  lowest-covered files:\n");
  // Type-only modules compile to a 2-line "use strict" stub that is never
  // require()d; they count toward the overall number but would bury the
  // actionable entries in this list.
  const actionable = rows.filter((row) => row.total > 5);
  for (const row of actionable.slice(0, 10)) {
    const pct = ((100 * row.hit) / Math.max(1, row.total)).toFixed(1).padStart(5);
    process.stdout.write(`    ${pct}%  ${String(row.hit).padStart(5)}/${String(row.total).padEnd(5)} ${row.file}${row.loaded ? "" : "  (never loaded)"}\n`);
  }
  process.stdout.write(`  OVERALL: ${hit}/${total} executable lines = ${overall.toFixed(1)}% (floor ${floor}%)\n`);

  fs.rmSync(covDir, { recursive: true, force: true });
  if (overall < floor) {
    process.stderr.write(`${SELF}: FAIL — overall coverage ${overall.toFixed(1)}% is below the ${floor}% floor.\n`);
    process.exit(1);
  }
  process.stdout.write(`${SELF}: PASS — coverage holds the ${floor}% floor.\n`);
})();
