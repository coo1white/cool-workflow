#!/usr/bin/env node
// agent-copilot-antigravity-grok-smoke -- the three beta builtins (2026-11-04):
// GitHub Copilot CLI (`copilot`), Antigravity (`agy`) and Grok Build (`grok`).
// A PATH shim stands in for each vendor CLI, so no login is needed. Checks:
//   1. each wrapper builds the argv from the vendor's own docs, word for word;
//   2. the answer (plain stdout) becomes result.md and the one stdout report,
//      read by the same parseAgentReport as every other vendor, and a full
//      `cw -q ... -grok` run completes on it;
//   3. a non-zero exit or an empty answer fails closed (no result.md);
//   4. -copilot / -antigravity / -grok pick builtin:<name>;
//   5. auto-detect does NOT pick them (owner, 2026-11-04: "先不加，标 beta");
//   6. `cw doctor` with builtin:<name> runs `<cli> --version`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveAgentConfig } from "../dist/shell/agent-config.js";
import { parseAgentReport } from "../dist/shell/execution-backend/agent.js";
import { tmpDir } from "./helpers/workspace.mjs";
import { writeProgram } from "./helpers/program.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const FENCE = "```";

const VENDORS = [
  { name: "copilot", cli: "copilot", wrapper: "copilot-agent.js", modelEnv: "CW_COPILOT_MODEL", base: ["--allow-all-tools"], modelArgs: (m) => ["--model", m] },
  { name: "antigravity", cli: "agy", wrapper: "antigravity-agent.js", modelEnv: null, base: [], modelArgs: null },
  { name: "grok", cli: "grok", wrapper: "grok-agent.js", modelEnv: "CW_GROK_MODEL", base: ["--output-format", "json", "--no-auto-update"], modelArgs: (m) => ["-m", m] },
];

// A stand-in vendor CLI: records its argv, answers `--version`, and prints a
// cw:result answer (evidence: <cwd>/README.md:1) unless told to fail.
function shimDir(cliName, behavior = "ok") {
  const dir = tmpDir(`cw-${cliName}-shim-`);
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") { fs.writeFileSync(path.join(__dirname, "version-ran"), "1"); process.stdout.write(${JSON.stringify(`${cliName} 9.9.9-shim`)} + "\\n"); process.exit(0); }
fs.writeFileSync(path.join(__dirname, "invocation.json"), JSON.stringify({ args, cwd: process.cwd() }));
const behavior = ${JSON.stringify(behavior)};
if (behavior === "crash") { process.stderr.write("${cliName} shim: not logged in\\n"); process.exit(3); }
const body = "# Answer\\n\\n${FENCE}cw:result\\n" + JSON.stringify({ summary: "${cliName} shim answer", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n${FENCE}\\n";
// --output-format json: the record grok 1.0.70 prints on a real login (2026-11-04).
if (args.includes("--output-format") && behavior !== "plain") {
  const m = args.indexOf("-m");
  const model = m >= 0 ? args[m + 1] : "grok-shim-build";
  process.stdout.write(JSON.stringify({ text: behavior === "empty" ? "" : body, stopReason: "end_turn", usage: { input_tokens: 120, output_tokens: 34, cache_read_input_tokens: 7 }, modelUsage: { [model]: { inputTokens: 120, outputTokens: 34, modelCalls: 1 } } }, null, 2) + "\\n");
  process.exit(0);
}
if (behavior === "empty") process.exit(0);
process.stdout.write(body);
`;
  writeProgram(dir, cliName, source);
  return dir;
}

function runWrapper(vendor, dir, inputPath, resultPath, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv, PATH: `${dir}${path.delimiter}${process.env.PATH}` };
  for (const key of ["CW_COPILOT_MODEL", "CW_GROK_MODEL", "CW_AGENT_STREAM"]) if (!(key in extraEnv)) delete env[key];
  return spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "agents", vendor.wrapper), inputPath, resultPath], { encoding: "utf8", env, timeout: 30000 });
}

const invocation = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "invocation.json"), "utf8"));

// `cw doctor --json` with only the vendor shim (and node) on PATH; gives back
// its agent-runs row, after checking the shim really ran `--version`.
function doctorProbe(vendor, flags, extraEnv) {
  const dir = shimDir(vendor.cli);
  const home = tmpDir(`cw-${vendor.name}-doctor-`);
  const env = { PATH: [dir, path.dirname(process.execPath)].join(path.delimiter), HOME: home, CW_HOME: home, CW_NO_AUTO_AGENT: "1", ...extraEnv };
  const r = spawnSync(process.execPath, [cli, "doctor", "--json", ...flags], { cwd: home, env, encoding: "utf8", timeout: 60000 });
  const probe = JSON.parse(r.stdout).checks.find((c) => c.name === "agent-runs");
  assert.ok(probe, `doctor ${flags.join(" ")} has an agent-runs row for ${vendor.name}`);
  assert.ok(fs.existsSync(path.join(dir, "version-ran")), `the ${vendor.cli} shim was run with --version`);
  return probe;
}

const work = tmpDir("cw-cag-smoke-");
const inputPath = path.join(work, "input.md");
const resultPath = path.join(work, "result.md");
const marker = "Check marker-cag-11.";
fs.writeFileSync(inputPath, `# Worker w-1\n\n## Task\n\n${marker}\n`, "utf8");

// 1-3. argv, result, report, fail closed.
for (const vendor of VENDORS) {
  fs.rmSync(resultPath, { force: true });
  const dir = shimDir(vendor.cli);
  const r = runWrapper(vendor, dir, inputPath, resultPath);
  assert.equal(r.status, 0, `${vendor.name}: wrapper exits 0 (stderr: ${r.stderr})`);
  const { args } = invocation(dir);
  assert.equal(args[0], "-p", `${vendor.name}: the prompt goes after -p`);
  assert.ok(args[1].includes(marker), `${vendor.name}: the worker input is the prompt`);
  assert.ok(args[1].includes("cw:result"), `${vendor.name}: the cw result contract is added`);
  assert.deepEqual(args.slice(2), vendor.base, `${vendor.name}: argv after the prompt is exactly ${JSON.stringify(vendor.base)}`);
  const answer = fs.readFileSync(resultPath, "utf8");
  assert.match(answer, new RegExp(`${vendor.cli} shim answer`), `${vendor.name}: stdout is persisted to result.md`);
  assert.equal(r.stderr, "", `${vendor.name}: a piped success is silent on stderr`);
  const report = JSON.parse(r.stdout);
  assert.equal(report.result, answer, `${vendor.name}: the stdout report carries the result`);
  const parsed = parseAgentReport(r.stdout);
  if (vendor.name === "grok") {
    // grok's JSON record names the model that ran and its usage (seen on a real login, 2026-11-04).
    assert.equal(report.model, "grok-shim-build", "grok: the model is the key of modelUsage");
    assert.equal(parsed.model, "grok-shim-build", "grok: parseAgentReport reads the model");
    assert.equal(parsed.usage && parsed.usage.input_tokens, 120, "grok: usage is passed on as grok gave it");
    assert.equal(parsed.usage && parsed.usage.output_tokens, 34, "grok: output tokens are passed on");
  } else {
    assert.equal(report.model, undefined, `${vendor.name}: no model is made up when none was asked for`);
    assert.ok(parsed.model === undefined && parsed.usage === undefined, `${vendor.name}: parseAgentReport reads it like any vendor (no model, no usage)`);
  }

  if (vendor.modelEnv) {
    const dirM = shimDir(vendor.cli);
    const m = runWrapper(vendor, dirM, inputPath, resultPath, { [vendor.modelEnv]: "shim-model-1" });
    assert.equal(m.status, 0, `${vendor.name}: model run exits 0 (stderr: ${m.stderr})`);
    assert.deepEqual(invocation(dirM).args.slice(2), [...vendor.base, ...vendor.modelArgs("shim-model-1")], `${vendor.name}: ${vendor.modelEnv} adds the model flag`);
    assert.equal(parseAgentReport(m.stdout).model, "shim-model-1", `${vendor.name}: the asked-for model is reported`);
  }

  fs.rmSync(resultPath, { force: true });
  const crash = runWrapper(vendor, shimDir(vendor.cli, "crash"), inputPath, resultPath);
  assert.equal(crash.status, 3, `${vendor.name}: the vendor's exit code is kept`);
  assert.ok(!fs.existsSync(resultPath), `${vendor.name}: no result.md on a failed run`);
  assert.equal(crash.stdout, "", `${vendor.name}: no report on a failed run`);
  assert.match(fs.readFileSync(path.join(work, "logs", "agent-stderr.log"), "utf8"), /not logged in/, `${vendor.name}: the vendor's stderr is kept in agent-stderr.log`);
  const empty = runWrapper(vendor, shimDir(vendor.cli, "empty"), inputPath, resultPath);
  assert.notEqual(empty.status, 0, `${vendor.name}: an empty answer fails closed`);
  assert.ok(!fs.existsSync(resultPath), `${vendor.name}: no result.md on an empty answer`);
  if (vendor.name === "grok") {
    const plainOut = runWrapper(vendor, shimDir(vendor.cli, "plain"), inputPath, resultPath);
    assert.notEqual(plainOut.status, 0, "grok: stdout that is not the JSON record fails closed");
    assert.ok(!fs.existsSync(resultPath), "grok: no result.md when the record is missing");
    assert.match(fs.readFileSync(path.join(work, "logs", "agent-stderr.log"), "utf8"), /no JSON record/, "grok: the reason is kept in agent-stderr.log");
  }
  console.log(`${vendor.name}: argv, result, report, fail closed OK`);
}

// 4. The flags pick the builtins: builtin:<name> expands to the wrapper, and
// `cw doctor -<name>` probes that vendor's CLI (step 6 runs the env form).
for (const vendor of VENDORS) {
  const cfg = resolveAgentConfig({ "agent-command": `builtin:${vendor.name}` }, {});
  assert.ok(cfg.command && cfg.command.includes(vendor.wrapper), `builtin:${vendor.name} expands to ${vendor.wrapper}`);
  const probe = doctorProbe(vendor, [`-${vendor.name}`], {});
  assert.equal(probe.detail, `${vendor.cli} --version → ${vendor.cli} 9.9.9-shim`, `-${vendor.name} picks builtin:${vendor.name}`);
}
console.log("flags: -copilot / -antigravity / -grok pick their builtins OK");

// 5. Auto-detect leaves them out: a PATH with only these CLIs (under both the
// template name and the CLI name) detects nothing.
{
  const bin = tmpDir("cw-cag-detect-");
  for (const name of ["copilot", "agy", "antigravity", "grok"]) writeProgram(bin, name, "process.exit(0);\n");
  const detected = resolveAgentConfig({}, { PATH: bin, HOME: bin, CW_HOME: path.join(bin, "home") });
  assert.equal(detected.source, "none", "copilot / agy / grok on PATH are never auto-detected (beta: chosen by flag only)");
  assert.equal(detected.command, undefined, "no command is picked from PATH");
  console.log("auto-detect: the beta vendors are not picked OK");
}

// 6. cw doctor probes `<cli> --version` for each.
for (const vendor of VENDORS) {
  const probe = doctorProbe(vendor, [], { CW_AGENT_COMMAND: `builtin:${vendor.name}` });
  assert.equal(probe.status, "ok");
  assert.equal(probe.detail, `${vendor.cli} --version → ${vendor.cli} 9.9.9-shim`, `doctor runs ${vendor.cli} --version`);
}
console.log("doctor: builtin:<name> probes <cli> --version OK");

// 2b. A whole `cw -q` run on -grok completes with the shim's answer.
{
  const repo = tmpDir("cw-grok-run-");
  fs.writeFileSync(path.join(repo, "README.md"), "# target\n", "utf8");
  spawnSync("git", ["init", "-q"], { cwd: repo });
  const dir = shimDir("grok");
  const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1", CW_HOME: path.join(repo, ".home") };
  for (const key of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_AGENT_STREAM", "CW_DRIVE_PROGRESS", "CW_GROK_MODEL"]) delete env[key];
  const r = spawnSync(process.execPath, [cli, "-q", "How does routing work?", "--json", "-grok"], { cwd: repo, env, encoding: "utf8", timeout: 120000 });
  assert.equal(r.status, 0, `cw -q -grok exits 0 (stderr: ${r.stderr})`);
  const result = JSON.parse(r.stdout);
  assert.equal(result.status, "complete", `the -grok run completes (got ${result.status})`);
  assert.equal(invocation(dir).args[0], "-p", "the run went through the grok shim");
  console.log("grok: a whole cw -q run completes OK");
}

console.log("agent-copilot-antigravity-grok-smoke: ok");
