#!/usr/bin/env node
"use strict";

// CLI <-> MCP parity gate. Two renderings of one data source must agree.
//
//   node scripts/parity-check.js            # print the parity report (JSON)
//   node scripts/parity-check.js --check    # fail (exit 1) on ANY drift
//
// FAIL CLOSED ON DRIFT (BSD discipline, same shape as gen-manifests --check):
//   1. STATIC parity — the declared capability registry must exactly match the
//      live MCP tool list (tools/list) and the CLI dispatch tokens parsed from
//      the built CLI dispatch surface. A tool or command on one surface but not
//      the other, or not declared in src/capability-registry.ts, is release-blocking.
//   2. PAYLOAD parity — for every capability declared `payloadIdentical`, the
//      `cw <cmd> --json` payload must equal the `cw_<tool>` MCP result on a real
//      bootstrap run (whitespace + generation-moment ISO timestamps aside).
//
// The registry (src/capability-registry.ts -> dist/capability-registry.js) is
// the single source of truth; this script never re-declares capabilities.

const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const mcpServer = path.join(pluginRoot, "dist", "mcp-server.js");
const registry = require(path.join(pluginRoot, "dist", "capability-registry.js"));

function capById(id) {
  const cap = registry.CAPABILITY_REGISTRY.find((entry) => entry.capability === id);
  assert.ok(cap, `probe references unknown capability ${id}`);
  return cap;
}

function jsonFlag(cap) {
  return cap.cli.jsonMode === "flag" ? ["--json"] : [];
}

// ---- 1. static surface parity ---------------------------------------------
function liveMcpTools() {
  const result = execFileSync(node, [mcpServer], {
    cwd: pluginRoot,
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`,
    encoding: "utf8"
  });
  const line = result
    .trim()
    .split("\n")
    .find((entry) => entry.includes('"tools"'));
  assert.ok(line, "MCP server returned no tools/list result");
  return JSON.parse(line).result.tools.map((tool) => tool.name);
}

function cliDispatchTokens() {
  const source = cliDispatchSources().map((file) => fs.readFileSync(file, "utf8")).join("\n");
  return [...new Set([...source.matchAll(/case\s+"([^"]+)":/g)].map((match) => match[1]))];
}

function cliDispatchSources() {
  return [cli, path.join(pluginRoot, "dist", "cli", "command-surface.js")].filter((file) => fs.existsSync(file));
}

// ---- 2. payload identity ---------------------------------------------------
// Generation-moment ISO timestamps are presentation metadata, not capability
// data: the same field carries the wall-clock instant of the render. Neutralize
// them (and only them) before comparison so we assert canonical-payload identity.
function canonical(value) {
  return JSON.stringify(value).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<ts>");
}

function openMcp() {
  const server = spawn(node, [mcpServer], { cwd: pluginRoot, stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: server.stdout });
  const pending = new Map();
  let nextId = 1;
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const rpc = (method, params) => {
    const id = nextId++;
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const tool = (name, args) => rpc("tools/call", { name, arguments: args }).then((result) => JSON.parse(result.content[0].text));
  return { server, rpc, tool };
}

async function payloadParity() {
  // realpath so the CLI (which realpath-resolves its cwd) and the MCP server we
  // hand `cwd` to observe identical absolute paths — a workspace symlink would
  // otherwise masquerade as a payload divergence.
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-parity-")));
  const plan = JSON.parse(
    execFileSync(node, [cli, "plan", "architecture-review", "--repo", workspace, "--question", "v0.1.27 CLI<->MCP parity probe"], {
      cwd: workspace,
      encoding: "utf8"
    })
  );
  const runId = plan.runId;
  const mismatches = [];
  const checked = [];
  const probePlan = registry.payloadProbePlan();
  assert.deepEqual(probePlan.unclassified, [], "payload probe classification has unclassified capabilities");
  assert.deepEqual(probePlan.duplicateClassifications, [], "payload probe classification has duplicates");
  assert.deepEqual(probePlan.invalidClassifications, [], "payload probe classification names non-payload capabilities");
  const mcp = openMcp();
  try {
    await mcp.rpc("initialize", {});
    for (const target of registry.payloadProbeTargets()) {
      const cap = capById(target.capability);
      // jsonMode is the single source for the CLI's --json policy; this probe only
      // appends --json for "flag" verbs and JSON.parse-es the result. The human
      // rendering and "default"-verb no-flag JSON are pinned to cap.cli.jsonMode by
      // the companion test/cli-jsonmode-parity-smoke.js, so cli.ts can't silently
      // re-encode that policy by hand and drift from this registry data.
      const cliArgv = target.kind === "run"
        ? [...cap.cli.path, runId, ...jsonFlag(cap)]
        : [...cap.cli.path, ...jsonFlag(cap)];
      const cliOut = JSON.parse(execFileSync(node, [cli, ...cliArgv], { cwd: workspace, encoding: "utf8" }));
      const mcpArgs = target.kind === "run" ? { cwd: workspace, runId } : { cwd: workspace };
      const mcpOut = await mcp.tool(cap.mcp.tool, mcpArgs);
      checked.push(target.capability);
      if (canonical(cliOut) !== canonical(mcpOut)) mismatches.push(target.capability);
    }
  } finally {
    mcp.server.kill();
  }
  return { runId, checked, mismatches };
}

async function main() {
  const check = process.argv.includes("--check");
  const tools = liveMcpTools();
  const tokens = cliDispatchTokens();
  const report = registry.buildParityReport({ mcpTools: tools, cliTokens: tokens });
  const payload = await payloadParity();

  const ok = report.ok && payload.mismatches.length === 0;
  const out = {
    ok,
    static: report,
    payload: {
      ok: payload.mismatches.length === 0,
      runId: payload.runId,
      checked: payload.checked.length,
      capabilities: payload.checked,
      mismatches: payload.mismatches
    }
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);

  if (check && !ok) {
    const lines = ["", "CLI <-> MCP parity drift detected (release-blocking):"];
    if (report.missingMcpTools.length) lines.push(`  - registry declares MCP tools absent from the server: ${report.missingMcpTools.join(", ")}`);
    if (report.undeclaredMcpTools.length) lines.push(`  - server exposes MCP tools not declared in the registry: ${report.undeclaredMcpTools.join(", ")}`);
    if (report.missingCliTokens.length) lines.push(`  - registry declares CLI tokens absent from dist/cli.js: ${report.missingCliTokens.join(", ")}`);
    if (report.undeclaredCliTokens.length) lines.push(`  - dist/cli.js dispatches tokens not declared in the registry: ${report.undeclaredCliTokens.join(", ")}`);
    if (report.reasonlessExceptions.length) lines.push(`  - surface-specific / payload-divergent capabilities missing a recorded reason: ${report.reasonlessExceptions.join(", ")}`);
    if (report.payloadProbeUnclassified.length) lines.push(`  - payload-identical capabilities neither probed nor deferred: ${report.payloadProbeUnclassified.join(", ")}`);
    if (report.payloadProbeDuplicateClassifications.length) lines.push(`  - payload probe duplicate classifications: ${report.payloadProbeDuplicateClassifications.join(", ")}`);
    if (report.payloadProbeInvalidClassifications.length) lines.push(`  - payload probe classifications for invalid capabilities: ${report.payloadProbeInvalidClassifications.join(", ")}`);
    if (report.registryLint.length) lines.push(`  - registry lint: ${report.registryLint.join("; ")}`);
    if (payload.mismatches.length) lines.push(`  - cw --json != cw_<tool> payload for: ${payload.mismatches.join(", ")}`);
    lines.push("Reconcile src/capability-registry.ts, cli.ts, and mcp-server.ts so both surfaces render one data source.\n");
    process.stderr.write(lines.join("\n"));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`parity-check: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
