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

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const script = path.join(repoRoot, "scripts", "bench", "run.js");

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

process.stdout.write("bench-run-smoke: ok\n");
