#!/usr/bin/env node
"use strict";

// vendor-preflight.js — pre-release liveness gate for ALL agent vendors.
//
// CW promises that claude, codex, gemini, and deepseek all work. This gate
// proves it before a release: it runs EACH builtin wrapper against a tiny
// throwaway git repo with a trivial question and checks the wrapper returns a
// real, non-empty result. It is the enforcement behind that promise.
//
// HARD-BLOCK policy (operator chose this): a vendor that does not return a valid
// result — missing CLI, auth error, empty/garbage output — counts as FAIL and
// the gate exits nonzero. There is no "skip"; an unconfigured vendor blocks.
//
// This is a LIVE gate: it spends real tokens on each configured vendor. It is
// meant for the release machine (where all keys/logins exist), NOT the offline
// CI test suite. The offline smoke (test/vendor-preflight-smoke.js) exercises
// this script's LOGIC with PATH shims, no keys.
//
// Zero runtime dependency: node + git only. stdout is data (the matrix), stderr
// is diagnostics — same discipline as the rest of CW.
//
// Usage:
//   node vendor-preflight.js [--vendors claude,codex,deepseek] [--question "..."]
//                            [--timeout-ms 180000] [--json] [--keep]
//
// Test seam (smoke/operator only):
//   CW_PREFLIGHT_AGENTS_DIR  override where wrapper scripts + builtin-templates.json
//                            are read from (the smoke points this at a shim dir).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const hasFlag = (flag) => process.argv.includes(flag);

const agentsDir = process.env.CW_PREFLIGHT_AGENTS_DIR || path.join(__dirname, "agents");
const manifestPath = path.join(agentsDir, "builtin-templates.json");
const question = argValue("--question", "In one sentence, what does this repo do? Keep it short.");
const timeoutMs = Number(argValue("--timeout-ms", "180000")) || 180000;
const asJson = hasFlag("--json");
const keep = hasFlag("--keep");

function die(msg) {
  process.stderr.write(msg + "\n");
  process.exit(2);
}

let templates;
try {
  templates = JSON.parse(fs.readFileSync(manifestPath, "utf8")).templates || {};
} catch (e) {
  die(`vendor-preflight: cannot read ${manifestPath}: ${e.message}`);
}

const onlyRaw = argValue("--vendors", "");
const only = onlyRaw ? onlyRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;
const vendors = Object.keys(templates).filter((v) => !only || only.includes(v));
if (only) {
  for (const v of only) if (!templates[v]) die(`vendor-preflight: unknown vendor "${v}" — known: ${Object.keys(templates).join(", ")}`);
}
if (!vendors.length) die("vendor-preflight: no vendors to check");

// One throwaway git repo + worker input, reused read-only across vendors.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-preflight-"));
const repo = path.join(work, "repo");
fs.mkdirSync(repo, { recursive: true });
spawnSync("git", ["init", "-q"], { cwd: repo });
fs.writeFileSync(path.join(repo, "README.md"), "# Tiny App\n\nA one-file demo. main.js reads input and prints it.\n");
const inputPath = path.join(repo, "input.md");
fs.writeFileSync(inputPath, `# Worker preflight\n\n- Result: ${path.join(repo, "result.md")}\n\n## Task\n\n${question}\n`);

function checkVendor(name) {
  const script = templates[name];
  const wrapper = path.join(agentsDir, script);
  const resultPath = path.join(repo, `result-${name}.md`);
  try { fs.rmSync(resultPath, { force: true }); } catch { /* ignore */ }
  const started = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [wrapper, inputPath, resultPath], {
    cwd: repo,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, CW_AGENT_STREAM: "0" }
  });
  const ms = Number((process.hrtime.bigint() - started) / 1000000n);
  const result = (() => { try { return fs.readFileSync(resultPath, "utf8"); } catch { return ""; } })();
  let model;
  try { model = JSON.parse(r.stdout || "{}").model; } catch { /* provenance optional */ }

  let status = "PASS";
  let reason = "";
  if (r.error && r.error.code === "ETIMEDOUT") {
    status = "FAIL"; reason = `timed out after ${timeoutMs}ms`;
  } else if (r.status !== 0) {
    status = "FAIL"; reason = (r.stderr || "").trim().split("\n").pop() || `exit ${r.status}`;
  } else if (!result.trim()) {
    status = "FAIL"; reason = "exit 0 but empty result";
  }
  return { vendor: name, status, reason, ms, model, hasContract: /```cw:result/.test(result) };
}

const rows = vendors.map(checkVendor);
if (!keep) { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ } }

const failed = rows.filter((r) => r.status !== "PASS");

if (asJson) {
  process.stdout.write(JSON.stringify({ ok: failed.length === 0, vendors: rows }, null, 2) + "\n");
} else {
  for (const r of rows) {
    const mark = r.status === "PASS" ? "✓" : "✗";
    const extra = r.status === "PASS"
      ? `${r.ms}ms${r.model ? `, ${r.model}` : ""}${r.hasContract ? "" : ", no cw:result block"}`
      : r.reason;
    process.stdout.write(`  ${mark} ${r.vendor.padEnd(10)} ${r.status}  (${extra})\n`);
  }
  process.stdout.write(failed.length === 0
    ? `vendor-preflight: ok — ${rows.length}/${rows.length} vendors live\n`
    : `vendor-preflight: BLOCKED — ${failed.length}/${rows.length} vendor(s) not live: ${failed.map((r) => r.vendor).join(", ")}\n`);
}

process.exit(failed.length === 0 ? 0 : 1);
