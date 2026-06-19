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
const { formatHelp } = require(path.join(pluginRoot, "dist", "orchestrator.js"));

function capById(id) {
  const cap = registry.CAPABILITY_REGISTRY.find((entry) => entry.capability === id);
  assert.ok(cap, `probe references unknown capability ${id}`);
  return cap;
}

function jsonFlag(cap) {
  return cap.cli.jsonMode === "flag" ? ["--json"] : [];
}

function runCli(argv, cwd) {
  return JSON.parse(execFileSync(node, [cli, ...argv], { cwd, encoding: "utf8" }));
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

function cliHelpTokens() {
  const lines = formatHelp().split(/\r?\n/);
  const start = lines.indexOf("Commands:");
  if (start < 0) return [];
  const tokens = new Set();
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) break;
    const first = line.trim().split(/\s+/)[0];
    for (const token of first.split("|")) {
      const clean = token.replace(/[<[].*$/, "");
      if (clean) tokens.add(clean);
    }
  }
  return [...tokens].sort();
}

// ---- 2. payload identity ---------------------------------------------------
// Generation-moment ISO timestamps are presentation metadata, not capability
// data: the same field carries the wall-clock instant of the render. Neutralize
// them (and only them) before comparison so we assert canonical-payload identity.
function canonical(value) {
  return JSON.stringify(value).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<ts>");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAllLiteral(text, search, replacement) {
  return text.replace(new RegExp(escapeRegExp(search), "g"), replacement);
}

function canonicalScenario(value, context) {
  let text = canonical(value);
  for (const root of context.workspaceRoots || []) {
    text = replaceAllLiteral(text, root, "<workspace>");
  }
  for (const runId of context.runIds || []) {
    text = replaceAllLiteral(text, runId, "<runId>");
  }
  return text
    .replace(/(architecture-review|end-to-end-golden-path)-\d{8}T\d{6}Z-[a-f0-9]+/g, "<runId>")
    .replace(/sha256:[a-f0-9]{32,64}/g, "sha256:<hash>")
    .replace(/[a-f0-9]{64}/g, "<hex64>");
}

function makeWorkspace(label) {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cw-parity-${label}-`)));
  fs.writeFileSync(path.join(workspace, "README.md"), `# ${label}\n`, "utf8");
  return workspace;
}

function bootstrapRun(workspace) {
  return runCli(["plan", "end-to-end-golden-path", "--question", "CLI/MCP scenario payload parity"], workspace);
}

function bootstrapTopologyRun(workspace) {
  return runCli(["plan", "architecture-review", "--repo", workspace, "--question", "CLI/MCP topology scenario parity"], workspace);
}

function sandboxProfileFile(workspace) {
  const profileFile = path.join(workspace, "parity-sandbox-profile.json");
  const profile = {
    schemaVersion: 1,
    id: "parity-readonly",
    title: "Parity Readonly",
    description: "Local sandbox profile fixture for CLI/MCP parity.",
    readPaths: ["$cwd"],
    writePaths: [],
    workerOutput: { result: true, artifacts: true, logs: true },
    execute: { mode: "none" },
    network: { mode: "none" },
    env: { inherit: false, expose: [] },
    hostInstructions: ["Used only by the parity check."]
  };
  fs.writeFileSync(profileFile, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return profileFile;
}

function applyTopologyCli(workspace, runId) {
  return runCli([
    "topology",
    "apply",
    runId,
    "map-reduce",
    "--id",
    "parity-map",
    "--mapper-count",
    "2",
    "--task",
    "map:server-api",
    "--task",
    "map:web-client"
  ], workspace);
}

async function applyTopologyMcp(mcp, workspace, runId) {
  return mcp.tool("cw_topology_apply", {
    cwd: workspace,
    runId,
    topologyId: "map-reduce",
    id: "parity-map",
    mapperCount: 2,
    task: ["map:server-api", "map:web-client"]
  });
}

function refreshSummaryCli(workspace, runId) {
  return runCli(["summary", "refresh", runId, "--json"], workspace);
}

async function refreshSummaryMcp(mcp, workspace, runId) {
  return mcp.tool("cw_summary_refresh", { cwd: workspace, runId });
}

function scenarioWorkspacePair(capability) {
  const slug = capability.replace(/[^a-z0-9]+/gi, "-");
  return {
    cliWorkspace: makeWorkspace(`${slug}-cli`),
    mcpWorkspace: makeWorkspace(`${slug}-mcp`)
  };
}

function runScenarioCli(capability, workspace, runId) {
  switch (capability) {
    case "plan":
      return runCli(["plan", "end-to-end-golden-path", "--question", "CLI/MCP scenario payload parity"], workspace);
    case "app.show":
      return runCli(["app", "show", "end-to-end-golden-path"], workspace);
    case "app.validate":
      return runCli(["app", "validate", "end-to-end-golden-path"], workspace);
    case "app.package":
      return runCli(["app", "package", "end-to-end-golden-path"], workspace);
    case "topology.show":
      return runCli(["topology", "show", "map-reduce"], workspace);
    case "topology.validate":
      return runCli(["topology", "validate", "map-reduce"], workspace);
    case "topology.apply":
      return applyTopologyCli(workspace, runId);
    case "topology.summary":
      return runCli(["topology", "summary", runId, "--json"], workspace);
    case "topology.graph":
      return runCli(["topology", "graph", runId, "--json"], workspace);
    case "summary.refresh":
      return refreshSummaryCli(workspace, runId);
    case "summary.show":
      return runCli(["summary", "show", runId, "--json"], workspace);
    case "sandbox.show":
      return runCli(["sandbox", "show", "readonly"], workspace);
    case "sandbox.validate":
      return runCli(["sandbox", "validate", sandboxProfileFile(workspace)], workspace);
    case "sandbox.choose":
      return runCli(["sandbox", "choose", "readonly"], workspace);
    case "sandbox.resolve":
      return runCli(["sandbox", "resolve", "readonly"], workspace);
    case "approve":
      return runCli(["approve", "run", runId, runId, "--actor", "parity-operator", "--role", "reviewer", "--rationale", "scenario approval"], workspace);
    case "reject":
      return runCli(["reject", "run", runId, runId, "--actor", "parity-operator", "--role", "reviewer", "--reason", "scenario rejection"], workspace);
    case "comment.add":
      return runCli(["comment", "add", "run", runId, runId, "--body", "scenario comment", "--actor", "parity-operator", "--role", "reviewer"], workspace);
    case "handoff":
      return runCli(["handoff", "run", runId, runId, "--from", "parity-operator", "--to", "parity-peer", "--reason", "scenario handoff"], workspace);
    case "review.policy":
      return runCli([
        "review",
        "policy",
        runId,
        "--required-approvals",
        "2",
        "--authorized-roles",
        "reviewer,lead",
        "--applies-to",
        "commit,selection",
        "--allow-self-approval"
      ], workspace);
    default:
      throw new Error(`No CLI payload scenario for ${capability}`);
  }
}

async function runScenarioMcp(capability, mcp, workspace, runId) {
  switch (capability) {
    case "plan":
      return mcp.tool("cw_plan", { cwd: workspace, workflowId: "end-to-end-golden-path", question: "CLI/MCP scenario payload parity" });
    case "app.show":
      return mcp.tool("cw_app_show", { cwd: workspace, appId: "end-to-end-golden-path" });
    case "app.validate":
      return mcp.tool("cw_app_validate", { cwd: workspace, appId: "end-to-end-golden-path" });
    case "app.package":
      return mcp.tool("cw_app_package", { cwd: workspace, appId: "end-to-end-golden-path" });
    case "topology.show":
      return mcp.tool("cw_topology_show", { cwd: workspace, topologyId: "map-reduce" });
    case "topology.validate":
      return mcp.tool("cw_topology_validate", { cwd: workspace, topologyId: "map-reduce" });
    case "topology.apply":
      return applyTopologyMcp(mcp, workspace, runId);
    case "topology.summary":
      return mcp.tool("cw_topology_summary", { cwd: workspace, runId });
    case "topology.graph":
      return mcp.tool("cw_topology_graph", { cwd: workspace, runId });
    case "summary.refresh":
      return refreshSummaryMcp(mcp, workspace, runId);
    case "summary.show":
      return mcp.tool("cw_summary_show", { cwd: workspace, runId });
    case "sandbox.show":
      return mcp.tool("cw_sandbox_show", { cwd: workspace, profileId: "readonly" });
    case "sandbox.validate":
      return mcp.tool("cw_sandbox_validate", { cwd: workspace, profileFile: sandboxProfileFile(workspace) });
    case "sandbox.choose":
      return mcp.tool("cw_sandbox_choose", { cwd: workspace, profileId: "readonly" });
    case "sandbox.resolve":
      return mcp.tool("cw_sandbox_resolve", { cwd: workspace, profileId: "readonly" });
    case "approve":
      return mcp.tool("cw_approve", { cwd: workspace, runId, targetKind: "run", targetId: runId, actor: "parity-operator", role: "reviewer", rationale: "scenario approval" });
    case "reject":
      return mcp.tool("cw_reject", { cwd: workspace, runId, targetKind: "run", targetId: runId, actor: "parity-operator", role: "reviewer", reason: "scenario rejection" });
    case "comment.add":
      return mcp.tool("cw_comment_add", { cwd: workspace, runId, targetKind: "run", targetId: runId, body: "scenario comment", actor: "parity-operator", role: "reviewer" });
    case "handoff":
      return mcp.tool("cw_handoff", { cwd: workspace, runId, targetKind: "run", targetId: runId, from: "parity-operator", to: "parity-peer", reason: "scenario handoff" });
    case "review.policy":
      return mcp.tool("cw_review_policy", {
        cwd: workspace,
        runId,
        requiredApprovals: 2,
        authorizedRoles: "reviewer,lead",
        appliesTo: "commit,selection",
        allowSelfApproval: true
      });
    default:
      throw new Error(`No MCP payload scenario for ${capability}`);
  }
}

async function executeScenario(target, mcp) {
  const { cliWorkspace, mcpWorkspace } = scenarioWorkspacePair(target.capability);
  const runlessScenarios = new Set([
    "plan",
    "app.show",
    "app.validate",
    "app.package",
    "topology.show",
    "topology.validate",
    "sandbox.show",
    "sandbox.validate",
    "sandbox.choose",
    "sandbox.resolve"
  ]);
  if (runlessScenarios.has(target.capability)) {
    const cliOut = runScenarioCli(target.capability, cliWorkspace);
    const mcpOut = await runScenarioMcp(target.capability, mcp, mcpWorkspace);
    return {
      cliPayload: canonicalScenario(cliOut, {
        workspaceRoots: [cliWorkspace],
        runIds: cliOut.runId ? [cliOut.runId] : []
      }),
      mcpPayload: canonicalScenario(mcpOut, {
        workspaceRoots: [mcpWorkspace],
        runIds: mcpOut.runId ? [mcpOut.runId] : []
      })
    };
  }

  const topologyScenarios = new Set(["topology.apply", "topology.summary", "topology.graph"]);
  const cliPlan = topologyScenarios.has(target.capability) ? bootstrapTopologyRun(cliWorkspace) : bootstrapRun(cliWorkspace);
  const mcpPlan = topologyScenarios.has(target.capability) ? bootstrapTopologyRun(mcpWorkspace) : bootstrapRun(mcpWorkspace);
  if (target.capability === "topology.summary" || target.capability === "topology.graph") {
    applyTopologyCli(cliWorkspace, cliPlan.runId);
    await applyTopologyMcp(mcp, mcpWorkspace, mcpPlan.runId);
  }
  if (target.capability === "summary.show") {
    refreshSummaryCli(cliWorkspace, cliPlan.runId);
    await refreshSummaryMcp(mcp, mcpWorkspace, mcpPlan.runId);
  }
  const cliOut = runScenarioCli(target.capability, cliWorkspace, cliPlan.runId);
  const mcpOut = await runScenarioMcp(target.capability, mcp, mcpWorkspace, mcpPlan.runId);
  return {
    cliPayload: canonicalScenario(cliOut, {
      workspaceRoots: [cliWorkspace],
      runIds: [cliPlan.runId]
    }),
    mcpPayload: canonicalScenario(mcpOut, {
      workspaceRoots: [mcpWorkspace],
      runIds: [mcpPlan.runId]
    })
  };
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
      if (target.kind === "scenario") {
        const result = await executeScenario(target, mcp);
        checked.push(target.capability);
        if (result.cliPayload !== result.mcpPayload) mismatches.push(target.capability);
        continue;
      }
      // jsonMode is the single source for the CLI's --json policy; this probe only
      // appends --json for "flag" verbs and JSON.parse-es the result. The human
      // rendering and "default"-verb no-flag JSON are pinned to cap.cli.jsonMode by
      // the companion test/cli-jsonmode-parity-smoke.js, so cli.ts can't silently
      // re-encode that policy by hand and drift from this registry data.
      if (target.kind !== "global" && target.kind !== "run") throw new Error(`Unknown payload probe target kind: ${target.kind}`);
      const cliArgv = target.kind === "run"
        ? [...cap.cli.path, runId, ...jsonFlag(cap)]
        : [...cap.cli.path, ...jsonFlag(cap)];
      const cliOut = runCli(cliArgv, workspace);
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
  const helpTokens = cliHelpTokens();
  const report = registry.buildParityReport({ mcpTools: tools, cliTokens: tokens, helpTokens });
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
    if (report.helpMissingCliTokens.length) lines.push(`  - registry declares CLI commands absent from cw help: ${report.helpMissingCliTokens.join(", ")}`);
    if (report.helpUndeclaredCliTokens.length) lines.push(`  - cw help lists commands not declared in the registry: ${report.helpUndeclaredCliTokens.join(", ")}`);
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
