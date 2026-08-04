"use strict";
// bench-run-smoke — first regression net for scripts/bench/run.js (the bench
// runner had NO tests as a shell script; the Node port gets one).
//
// The full bench path is NOT run here: it drives real plan+drive rounds against
// the agent stub with 20-45s synthetic delays per round (minutes of wall clock
// by design — see docs/benchmark.md for the operator path). This smoke pins the
// cheap, deterministic surface instead: syntax, the arg/agent contract, and the
// stdout-is-CSV / stderr-is-progress split encoded in the source.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const script = path.join(pluginRoot, "scripts", "bench", "run.js");

// 1. The script parses (guards against a broken commit of an operator tool
//    that nothing else in the suite loads).
let res = cp.spawnSync(process.execPath, ["--check", script], { encoding: "utf8" });
assert.equal(res.status, 0, `run.js must parse\nSTDERR:\n${res.stderr}`);

// 2. Unknown agent fails fast: exit 1, named on stderr, nothing on stdout
//    (stdout is reserved for the final CSV line).
res = cp.spawnSync(process.execPath, [script, "--agent", "nope"], { encoding: "utf8" });
assert.equal(res.status, 1, "unknown agent must exit 1");
assert.match(res.stderr, /Unknown agent: nope/);
assert.equal(res.stdout, "", "no CSV on the failure path");

// 3. The agent->delay table and the 10-field CSV emit are pinned in source, so
//    a rename/reshape shows up here before it silently breaks docs/benchmark.md
//    consumers of the CSV columns.
const source = fs.readFileSync(script, "utf8");
assert.match(source, /claude: 45000, gemini: 30000, deepseek: 20000, codex: 25000/, "agent delay table unchanged");
assert.match(source, /\[ARCH, "22", CONC, AGENT, meanPlanMs, overheadMs, meanMs, k6Rps, k6P95, DELAY_MS\]/, "CSV column order unchanged");

// 4. The low-delay Track A baseline is opt-in. It must accept a REAL zero
// delay, skip the unrelated Workbench probe, and write a portable JSON report
// without changing the old CSV stdout path.
assert.match(source, /case "--delay-ms":/, "benchmark accepts an opt-in delay override");
assert.match(source, /case "--skip-workbench":/, "benchmark can skip the Workbench probe");
assert.match(source, /case "--json-report":/, "benchmark accepts an opt-in JSON report path");
assert.match(source, /case "--trace-report":/, "benchmark accepts an opt-in trace report path");
assert.match(source, /medianPlanMs/, "benchmark report carries the plan median");
assert.match(source, /medianDriveMs/, "benchmark report carries the drive median");
assert.match(source, /medianTotalMs/, "benchmark report carries the total median");

// 5. Run the new path once. Its JSON report names all three timings; stdout
// remains the one legacy CSV line, while progress stays on stderr.
const reportDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "cw-bench-report-"));
const report = path.join(reportDir, "report.json");
const trace = path.join(reportDir, "trace.json");
res = cp.spawnSync(process.execPath, [script, "--agent", "codex", "--runs", "1", "--delay-ms", "0", "--skip-workbench", "--json-report", report, "--trace-report", trace], {
  encoding: "utf8",
  timeout: 15000,
});
assert.equal(res.status, 0, `zero-delay benchmark must pass\nSTDERR:\n${res.stderr}`);
assert.match(res.stdout, /^[^\n]+\n$/, "zero-delay benchmark keeps one CSV line on stdout");
const reportValue = JSON.parse(fs.readFileSync(report, "utf8"));
assert.equal(reportValue.schemaVersion, 1);
assert.equal(reportValue.delayMs, 0, "zero is a real delay override");
assert.equal(reportValue.skipWorkbench, true);
assert.equal(reportValue.runs.length, 1);
assert.equal(reportValue.runs[0].status, "complete");
assert.equal(reportValue.runs[0].completedWorkers, "6");
for (const key of ["medianPlanMs", "medianDriveMs", "medianTotalMs"]) {
  assert.equal(Number.isSafeInteger(reportValue[key]), true, `${key} is a stable integer metric`);
}
const traceValue = JSON.parse(fs.readFileSync(trace, "utf8"));
assert.equal(traceValue.schemaVersion, 1);
assert.equal(traceValue.runs.length, 1);
const groupNames = traceValue.groups.map((group) => group.name);
for (const name of ["agent-wait", "dispatch", "round", "settlement", "checkpoint", "report"]) {
  assert.ok(groupNames.includes(name), `trace names ${name}`);
}
const round = traceValue.runs[0].trace.groups.find((group) => group.name === "round");
assert.ok(round.samples.length >= 4, "trace has one sample for each workflow round and its final check");
assert.ok(round.samples.every((sample) => Number.isFinite(sample.durationMs) && sample.durationMs >= 0), "round times are valid");
fs.rmSync(reportDir, { recursive: true, force: true });

process.stdout.write("bench-run-smoke: ok\n");
