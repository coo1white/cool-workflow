#!/usr/bin/env node
// sample-determinism-smoke — the runner's --sample subset must be DETERMINISTIC.
// CW's core promise is replay-determinism; the prior implementation used a
// per-run Math.random() shuffle (also a biased, non-transitive comparator), so
// the same set of files produced a different sample every run. This proves the
// selection is now reproducible end-to-end and guards the invariant at the
// source level (run-all.mjs code must contain no Math.random).
import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDir = import.meta.dirname;

// Stand up an isolated copy of the runner + a pool of trivial smokes, exactly as
// the other runner meta-smokes do (the runner is a self-contained, copy-able
// script — no sibling files to bring along).
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-sample-determinism-"));
fs.copyFileSync(path.join(testDir, "run-all.mjs"), path.join(temp, "run-all.mjs"));
const pool = [
  "zulu", "alpha", "mike", "bravo", "yankee", "charlie",
  "november", "delta", "oscar", "echo"
];
for (const name of pool) {
  fs.writeFileSync(path.join(temp, `${name}-smoke.mjs`), `process.stdout.write('${name}: ok\\n');\n`, "utf8");
}

const SAMPLE = 4;
function runSample(summaryName) {
  const summaryPath = path.join(temp, summaryName);
  const result = cp.spawnSync(
    process.execPath,
    [path.join(temp, "run-all.mjs"), "--sample", String(SAMPLE), "--concurrency", "1", "--json-summary", summaryPath],
    { cwd: temp, encoding: "utf8" }
  );
  assert.equal(result.status, 0, `runner exited ${result.status}: ${result.stderr}`);
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  return summary.results.map((r) => r.file).sort();
}

// Run the sampler three times. With Math.random these subsets would (almost
// always) differ; deterministic selection makes them identical every time.
const a = runSample("s1.json");
const b = runSample("s2.json");
const c = runSample("s3.json");

const poolFiles = new Set(pool.map((name) => `${name}-smoke.mjs`));
assert.equal(a.length, SAMPLE, `--sample ${SAMPLE} must run exactly ${SAMPLE} smokes, ran ${a.length}`);
assert.deepEqual(b, a, "the sampled subset must be identical across runs (run 2)");
assert.deepEqual(c, a, "the sampled subset must be identical across runs (run 3)");
assert.ok(a.every((f) => poolFiles.has(f)), "every sampled file must be a smoke from the known pool");
assert.equal(new Set(a).size, a.length, "the sampled subset must not repeat a smoke");

fs.rmSync(temp, { recursive: true, force: true });

// Source-level invariant guard (the deterministic fails-before): the runner's
// CODE must not reach for Math.random for selection. Line comments are stripped
// first so a prose mention does not trip the guard. Fails against the pre-fix
// run-all.mjs (which shuffled with Math.random); passes after.
const runAllSrc = fs.readFileSync(path.join(testDir, "run-all.mjs"), "utf8");
const runAllCode = runAllSrc.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
assert.ok(!/Math\.random/.test(runAllCode), "run-all.mjs code must not use Math.random (replay-determinism)");
assert.ok(/deterministicSample/.test(runAllCode), "run-all.mjs must select its sample via deterministicSample");

process.stdout.write("sample-determinism-smoke: ok\n");
