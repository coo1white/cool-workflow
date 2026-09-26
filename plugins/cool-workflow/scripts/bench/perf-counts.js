#!/usr/bin/env node
"use strict";

// bench/perf-counts.js — the perf ratchet (intent:
// project/docs/intent/2026-09-archive.md, the perf-ratchets part). Consumer:
// test/perf-ratchet-smoke.js, which runs `--check` on every PR.
//
// Runs the journeys a person waits on, each under perf-count-hook.js, and
// prints exact counts — CW modules loaded, state.json reads, whole-state JSON
// round trips, fsyncs, renames, git processes. Milliseconds are too noisy to
// gate CI on; these counts are the same on every run, so a CI check can hold
// them. The drive journey uses a stub agent that writes its result at once, so
// what is left is CW's own work.
//
// Usage:
//   node scripts/bench/perf-counts.js            print the counts as JSON
//   node scripts/bench/perf-counts.js --check    fail if a count is above its
//                                                ceiling, or a ceiling above
//                                                its count (lower it)
//   node scripts/bench/perf-counts.js --update   write the counts as the new
//                                                ceilings; refuses to raise one

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(PLUGIN_ROOT, "scripts", "cw.js");
const MCP = path.join(PLUGIN_ROOT, "scripts", "mcp-server.js");
const HOOK = path.join(__dirname, "perf-count-hook.js");
const CEILINGS = path.join(__dirname, "perf-ceilings.json");
const DRIVE_WORKERS = 16;

const COLD_JOURNEYS = [
  ["version", ["version"]],
  ["help", ["help"]],
  ["status-no-run", ["status"]],
  ["doctor", ["doctor"]],
  ["app-list", ["app", "list"]],
];

function sandboxEnv(root) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("CW_") || key === "NODE_OPTIONS") delete env[key];
  return {
    ...env,
    HOME: path.join(root, "home"),
    CW_HOME: path.join(root, "home", ".cw"),
    XDG_STATE_HOME: path.join(root, "home", ".state"),
    CW_NO_AUTO_AGENT: "1",
    CW_DRIVE_PROGRESS: "0",
    NO_COLOR: "1",
    GIT_AUTHOR_NAME: "bench",
    GIT_AUTHOR_EMAIL: "bench@example.invalid",
    GIT_COMMITTER_NAME: "bench",
    GIT_COMMITTER_EMAIL: "bench@example.invalid",
  };
}

function counted(root, name, args, options) {
  const out = path.join(root, `${name}.counts.json`);
  const result = spawnSync(process.execPath, ["--require", HOOK, ...args], {
    encoding: "utf8",
    ...options,
    env: { ...options.env, CW_PERF_COUNT_OUT: out },
  });
  if (result.status !== 0 || !fs.existsSync(out)) {
    throw new Error(`perf-counts: journey ${name} failed (exit ${result.status}): ${String(result.stderr).slice(0, 2000)}`);
  }
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

function makeRepo(root) {
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, "README.md"), "# bench\n");
  fs.writeFileSync(path.join(repo, "app.ts"), "export const x = 1;\n");
  for (const args of [["init", "-q"], ["config", "commit.gpgsign", "false"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env: sandboxEnv(root) });
    if (r.status !== 0) throw new Error(`perf-counts: git ${args[0]} failed: ${r.stderr}`);
  }
  return repo;
}

// One app, DRIVE_WORKERS agent tasks in one serial phase: every step is a
// full load -> dispatch -> accept -> commit -> save of the run state.
function makeFanApp(root) {
  const dir = path.join(root, "apps", "perf-fan");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "app.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      id: "perf-fan",
      title: "Perf Fan",
      summary: "Fixed fan of agent tasks for the perf ratchet.",
      version: "0.1.0",
      author: "bench",
      inputs: [
        { name: "question", type: "string", required: true, description: "q" },
        { name: "repo", type: "path", required: true, description: "r" },
      ],
      compatibility: { minVersion: "0.1.9" },
      workflow: { entrypoint: "workflow.js" },
    })}\n`
  );
  fs.writeFileSync(
    path.join(dir, "workflow.js"),
    [
      "module.exports = ({ workflow, phase, agent, input }) => workflow({",
      '  id: "perf-fan", title: "Perf Fan", summary: "Fixed fan of agent tasks for the perf ratchet.",',
      `  limits: { maxAgents: ${DRIVE_WORKERS}, maxConcurrentAgents: 1 },`,
      '  inputs: [input("question", { type: "string", required: true, description: "q" }), input("repo", { type: "path", required: true, description: "r" })],',
      `  phases: [phase("Map", Array.from({ length: ${DRIVE_WORKERS} }, (_, i) => agent("map:w" + i, "Inspect {{question}} part " + i)))],`,
      "});",
      "",
    ].join("\n")
  );
  return path.dirname(dir);
}

function makeStubAgent(root) {
  const stub = path.join(root, "stub-agent.js");
  fs.writeFileSync(
    stub,
    [
      'const fs = require("fs");',
      "const fence = String.fromCharCode(96).repeat(3);",
      'fs.writeFileSync(process.argv[2], "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [] }) + "\\n" + fence + "\\n");',
      'process.stdout.write(JSON.stringify({ model: "stub/agent", usage: { input_tokens: 1, output_tokens: 1 } }));',
      "",
    ].join("\n")
  );
  return stub;
}

function measure() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-perf-counts-")));
  try {
    const env = sandboxEnv(root);
    fs.mkdirSync(env.HOME, { recursive: true });
    const cwd = path.join(root, "work");
    fs.mkdirSync(cwd);
    const out = {};
    for (const [name, args] of COLD_JOURNEYS) {
      out[`${name}.modules`] = counted(root, name, [CLI, ...args], { cwd, env }).modules;
    }
    const initialize = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "perf-counts", version: "0" } } })}\n`;
    out["mcp-initialize.modules"] = counted(root, "mcp-initialize", [MCP], { cwd, env, input: initialize }).modules;

    const repo = makeRepo(root);
    const appsDir = makeFanApp(root);
    const stub = makeStubAgent(root);
    const drive = counted(
      root,
      "drive",
      [CLI, "run", "perf-fan", "--drive", "--repo", repo, "--question", "q", "--agent-command", `${process.execPath} ${stub} {{result}}`, "--json"],
      { cwd, env: { ...env, CW_APPS_DIR: appsDir } }
    );
    for (const key of Object.keys(drive)) out[`drive.${key}`] = drive[key];
    return out;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Findings for counts against ceilings: a count above its ceiling is a
 *  regression; a ceiling above its count is stale (the gain must be locked
 *  in the same diff); a key on one side only is a shape change. */
function compare(counts, ceilings) {
  const findings = [];
  for (const key of Object.keys(counts).sort()) {
    if (!(key in ceilings)) findings.push(`${key}: no ceiling (run --update)`);
    else if (counts[key] > ceilings[key]) findings.push(`${key}: ${counts[key]} is above its ceiling ${ceilings[key]}`);
    else if (counts[key] < ceilings[key]) findings.push(`${key}: ${counts[key]} is below its ceiling ${ceilings[key]}; lower it (run --update)`);
  }
  for (const key of Object.keys(ceilings).sort()) {
    if (!(key in counts)) findings.push(`${key}: ceiling for a count that is no longer measured`);
  }
  return findings;
}

function readCeilings(file = CEILINGS) {
  return JSON.parse(fs.readFileSync(file, "utf8")).ceilings;
}

function main(argv) {
  const counts = measure();
  if (argv.includes("--update")) {
    const old = fs.existsSync(CEILINGS) ? readCeilings() : {};
    const raised = Object.keys(counts).filter((key) => key in old && counts[key] > old[key]);
    if (raised.length) {
      process.stderr.write(`perf-counts: refusing to raise a ceiling: ${raised.map((k) => `${k} ${old[k]} -> ${counts[k]}`).join(", ")}\n`);
      return 1;
    }
    const sorted = Object.fromEntries(Object.keys(counts).sort().map((key) => [key, counts[key]]));
    fs.writeFileSync(CEILINGS, `${JSON.stringify({ schemaVersion: 1, ceilings: sorted }, null, 2)}\n`);
    return 0;
  }
  if (argv.includes("--check")) {
    const findings = compare(counts, readCeilings());
    for (const finding of findings) process.stderr.write(`perf-counts: ${finding}\n`);
    return findings.length ? 1 : 0;
  }
  process.stdout.write(`${JSON.stringify(counts, null, 2)}\n`);
  return 0;
}

module.exports = { compare, measure, readCeilings, CEILINGS };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
