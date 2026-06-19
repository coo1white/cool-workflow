#!/usr/bin/env node
"use strict";

// cli-mcp-parity-smoke (v0.1.27): proves the CLI and MCP surfaces are two
// renderings of ONE data source.
//
//   1. The capability registry is internally consistent and exactly covers the
//      live MCP tool list and the CLI dispatch tokens (registry <-> CLI <-> MCP).
//   2. For representative capabilities, `cw <cmd> --json` is payload-identical to
//      the `cw_<tool>` MCP result on a real bootstrap run.
//   3. The fail-closed gate trips on injected drift (a tool/command added to or
//      removed from one surface, or a reasonless surface exception).
//
// Included in `npm test` and `npm run release:check`.

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

function liveMcpToolDefinitions() {
  const out = execFileSync(node, [mcpServer], {
    cwd: pluginRoot,
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`,
    encoding: "utf8"
  });
  const line = out.trim().split("\n").find((entry) => entry.includes('"tools"'));
  return JSON.parse(line).result.tools;
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
  assert.ok(start >= 0, "help text must include a Commands section");
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

(async () => {
  // ---- 1. registry self-consistency ---------------------------------------
  const tools = liveMcpToolDefinitions();
  const toolNames = tools.map((tool) => tool.name);
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const tokens = cliDispatchTokens();
  const helpTokens = cliHelpTokens();
  const report = registry.buildParityReport({ mcpTools: toolNames, cliTokens: tokens, helpTokens });
  assert.ok(report.ok, `registry <-> surface drift: ${JSON.stringify(report)}`);
  assert.equal(report.registryLint.length, 0, "registry lint must be clean");
  assert.deepEqual(report.helpMissingCliTokens, [], "all registry top-level commands must be in cw help");
  assert.deepEqual(report.helpUndeclaredCliTokens, [], "cw help must not list undeclared commands");
  assert.equal(typeof registry.declaredCliHelpTokens, "function", "registry must derive help-visible CLI tokens");
  assert.equal(registry.declaredMcpTools().length, toolNames.length, "every live MCP tool must be declared exactly once");
  assert.ok(registry.CAPABILITY_REGISTRY.length >= toolNames.length, "registry must cover at least every MCP tool");
  assert.ok(registry.payloadIdenticalCapabilities().length >= 20, "expected a substantial payload-identical set");
  assert.equal(typeof registry.payloadProbePlan, "function", "registry must own the payload probe classification plan");

  {
    const plan = registry.payloadProbePlan();
    const firstBatchScenarioCaps = ["plan", "app.package", "approve", "reject", "comment.add", "handoff", "review.policy"];
    const secondBatchScenarioCaps = [
      "app.show",
      "app.validate",
      "topology.show",
      "topology.validate",
      "topology.apply",
      "topology.summary",
      "topology.graph",
      "sandbox.show",
      "sandbox.validate",
      "sandbox.choose",
      "sandbox.resolve",
      "summary.refresh",
      "summary.show"
    ];
    const localRunScenarioCaps = [
      "worker.list",
      "worker.show",
      "worker.manifest",
      "worker.output",
      "worker.fail",
      "worker.validate",
      "candidate.list",
      "candidate.show",
      "candidate.register",
      "candidate.score",
      "candidate.rank",
      "candidate.select",
      "candidate.reject",
      "feedback.list",
      "feedback.show",
      "feedback.collect",
      "feedback.task",
      "feedback.resolve"
    ];
    const nodeScenarioCaps = [
      "node.show",
      "node.snapshot",
      "node.diff",
      "node.replay",
      "node.replay.verify"
    ];
    const scenarioCaps = [...firstBatchScenarioCaps, ...secondBatchScenarioCaps, ...localRunScenarioCaps, ...nodeScenarioCaps];
    const targetByCapability = new Map(plan.targets.map((target) => [target.capability, target]));
    const deferredIds = new Set(plan.deferred.map((entry) => entry.capability));
    assert.deepEqual(plan.unclassified, [], "payload-identical capabilities must be probed or explicitly deferred");
    assert.deepEqual(plan.duplicateClassifications, [], "payload probe classification must not duplicate capabilities");
    assert.deepEqual(plan.invalidClassifications, [], "payload probe classification must only reference payload-identical capabilities");
    assert.ok(plan.targets.length > 30, "payload probe plan must grow beyond the original read-only coverage");
    assert.equal(plan.targets.length, 73, "payload probe plan must include all local scenario target batches");
    assert.ok(plan.deferred.length > 0, "complex payload-identical capabilities must be explicitly deferred with reasons");
    for (const deferred of plan.deferred) {
      assert.ok(deferred.reason && deferred.reason.trim(), `${deferred.capability}: deferred payload probe must record a reason`);
    }
    for (const capability of scenarioCaps) {
      assert.equal(targetByCapability.get(capability)?.kind, "scenario", `${capability}: probe target must be a scenario`);
      assert.equal(deferredIds.has(capability), false, `${capability}: scenario must not stay deferred`);
    }
    assert.equal(typeof registry.buildPayloadProbePlan, "function", "registry must expose the pure payload probe plan checker");

    const classificationGuardCap = "topology.apply";
    const missingScenario = registry.buildPayloadProbePlan(
      plan.targets.filter((target) => target.capability !== classificationGuardCap),
      plan.deferred
    );
    assert.ok(missingScenario.unclassified.includes(classificationGuardCap), "missing scenario target must fail closed");

    const duplicateScenario = registry.buildPayloadProbePlan(
      [...plan.targets, { capability: classificationGuardCap, kind: "scenario" }],
      plan.deferred
    );
    assert.ok(duplicateScenario.duplicateClassifications.includes(classificationGuardCap), "duplicate scenario target must fail closed");

    const invalidScenario = registry.buildPayloadProbePlan(
      [...plan.targets, { capability: "phantom.scenario", kind: "scenario" }],
      plan.deferred
    );
    assert.ok(invalidScenario.invalidClassifications.includes("phantom.scenario"), "invalid scenario target must fail closed");
  }

  // ---- F6: the payload-identity probe defaults IN (write verbs included) ----
  // Regression guard against the old narrow allow-list that left ~170 write/
  // complex-arg both-surface verbs parity-declared but never payload-probed.
  // The probe set must (a) cover the OVERWHELMING majority of both-surface,
  // dual-bound capabilities, (b) include WRITE verbs (not just read summaries),
  // and (c) exclude ONLY the documented `payloadIdentical:false` + reason opt-outs.
  {
    const probeSet = registry.payloadIdenticalCapabilities();
    const probeIds = new Set(probeSet.map((cap) => cap.capability));
    const bothBound = registry.CAPABILITY_REGISTRY.filter(
      (cap) => cap.surface === "both" && cap.cli && cap.mcp
    );
    const documentedOptOuts = bothBound.filter((cap) => registry.isPayloadProbeOptOut(cap));

    // every both-surface, dual-bound cap is IN the probe unless it is a
    // documented opt-out — nothing falls out of scope by accident.
    assert.equal(
      probeSet.length,
      bothBound.length - documentedOptOuts.length,
      "probe set must be every both-surface dual-bound cap minus the documented opt-outs"
    );
    // the probe is BROAD, not a hand-picked handful.
    assert.ok(
      probeSet.length >= bothBound.length - 10,
      `probe set unexpectedly narrow: ${probeSet.length}/${bothBound.length} both-bound caps probed`
    );

    // Safe multi-argument/write verbs that route through ONE core must be
    // scenario-probed, not just read summaries — this is exactly where
    // marshalling drift hides.
    const scenarioTargets = new Map(registry.payloadProbeTargets().map((target) => [target.capability, target.kind]));
    for (const writeCap of [
      "plan",
      "app.show",
      "app.validate",
      "app.package",
      "topology.show",
      "topology.validate",
      "topology.apply",
      "topology.summary",
      "topology.graph",
      "summary.refresh",
      "summary.show",
      "sandbox.show",
      "sandbox.validate",
      "sandbox.choose",
      "sandbox.resolve",
      "approve",
      "reject",
      "comment.add",
      "handoff",
      "review.policy",
      "worker.list",
      "worker.show",
      "worker.manifest",
      "worker.output",
      "worker.fail",
      "worker.validate",
      "candidate.list",
      "candidate.show",
      "candidate.register",
      "candidate.score",
      "candidate.rank",
      "candidate.select",
      "candidate.reject",
      "feedback.list",
      "feedback.show",
      "feedback.collect",
      "feedback.task",
      "feedback.resolve",
      "node.show",
      "node.snapshot",
      "node.diff",
      "node.replay",
      "node.replay.verify"
    ]) {
      const cap = registry.CAPABILITY_REGISTRY.find((entry) => entry.capability === writeCap);
      assert.ok(cap, `${writeCap}: registry entry must exist`);
      assert.equal(cap.payloadIdentical, undefined, `${writeCap}: must NOT opt out of the payload probe`);
      assert.ok(probeIds.has(writeCap), `${writeCap}: write verb must be in the payload-identity probe set`);
      assert.equal(scenarioTargets.get(writeCap), "scenario", `${writeCap}: write/multi-argument verb must be scenario-probed`);
    }

    // the documented opt-outs are exactly the 5 reasoned divergences, each with
    // a real reason — opting out REQUIRES a paper trail (fail-closed default).
    for (const optId of ["commit", "backend.agent.config.set", "run.drive.step", "gc.run", "workbench.serve"]) {
      const cap = registry.CAPABILITY_REGISTRY.find((entry) => entry.capability === optId);
      assert.ok(cap, `${optId}: registry entry must exist`);
      assert.equal(cap.payloadIdentical, false, `${optId}: declared payload divergence`);
      assert.ok(cap.reason && cap.reason.trim(), `${optId}: opt-out must record a reason`);
      assert.ok(registry.isPayloadProbeOptOut(cap), `${optId}: must register as a documented opt-out`);
      assert.ok(!probeIds.has(optId), `${optId}: documented opt-out must be excluded from the probe`);
    }

    // FAIL CLOSED: a bare `payloadIdentical:false` with NO reason must NOT
    // silently escape the probe — an undocumented divergence stays in scope so
    // the gate trips on it rather than excusing it.
    const undocumentedDivergence = { ...bothBound[0], payloadIdentical: false, reason: undefined };
    assert.equal(
      registry.isPayloadProbeOptOut(undocumentedDivergence),
      false,
      "an undocumented payloadIdentical:false must NOT count as a probe opt-out"
    );
    const blankReasonDivergence = { ...bothBound[0], payloadIdentical: false, reason: "   " };
    assert.equal(
      registry.isPayloadProbeOptOut(blankReasonDivergence),
      false,
      "a blank-reason payloadIdentical:false must NOT count as a probe opt-out"
    );
  }

  // A first slimmed MCP inspection group derives tool name + description from
  // the capability registry. This prevents the old two-hand-maintained-lists
  // god object from growing back while preserving the existing input schemas.
  for (const capability of [
    "operator.status",
    "graph",
    "operator.report",
    "worker.summary",
    "candidate.summary",
    "feedback.summary",
    "commit.summary",
    "multi-agent.summary",
    "multi-agent.graph",
    "multi-agent.dependencies",
    "multi-agent.failures",
    "multi-agent.evidence"
  ]) {
    const cap = registry.CAPABILITY_REGISTRY.find((entry) => entry.capability === capability);
    assert.ok(cap && cap.mcp, `${capability}: registry entry must declare an MCP tool`);
    const tool = toolByName.get(cap.mcp.tool);
    assert.ok(tool, `${capability}: live MCP tool must exist`);
    assert.equal(tool.description, cap.summary, `${capability}: MCP description must be registry-derived`);
  }

  // every "both" capability must bind both surfaces; every exception must reason.
  for (const cap of registry.CAPABILITY_REGISTRY) {
    if (cap.surface === "both") {
      assert.ok(cap.cli && cap.mcp, `${cap.capability}: "both" requires cli + mcp bindings`);
    }
    if (registry.requiresReason(cap)) {
      assert.ok(cap.reason && cap.reason.trim(), `${cap.capability}: surface-specific/divergent capability must record a reason`);
    }
  }

  // the one declared payload projection is `commit`, and it is reasoned.
  const commit = registry.CAPABILITY_REGISTRY.find((cap) => cap.capability === "commit");
  assert.equal(commit.payloadIdentical, false, "commit is the declared payload projection");
  assert.match(commit.reason, /runner\.commit/, "commit reason must cite the shared core entry");

  // ---- 2. cw <cmd> --json == cw_<tool> on a real run ----------------------
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-parity-smoke-")));
  const plan = JSON.parse(
    execFileSync(node, [cli, "plan", "architecture-review", "--repo", workspace, "--question", "v0.1.27 parity smoke"], {
      cwd: workspace,
      encoding: "utf8"
    })
  );
  // plan itself is a both-surface, payload-identical capability.
  const mcp = openMcp();
  try {
    await mcp.rpc("initialize", {});
    const planMcp = await mcp.tool("cw_plan", { cwd: workspace, workflowId: "architecture-review", repo: workspace, question: "v0.1.27 parity smoke" });
    assert.equal(planMcp.workflowId, "architecture-review");
    assert.ok(planMcp.runId && planMcp.statePath, "cw_plan returns the canonical plan summary");

    const runId = plan.runId;
    const probes = [
      ["status", ["status", runId, "--json"], "cw_status", { runId }],
      ["operator.status", ["operator", "status", runId, "--json"], "cw_operator_status", { runId }],
      ["graph", ["graph", runId, "--json"], "cw_operator_graph", { runId }],
      ["next", ["next", runId], "cw_next", { runId }],
      ["state.check", ["state", "check", runId], "cw_state_check", { runId }],
      ["contract.show", ["contract", "show", runId], "cw_contract_show", { runId }],
      ["node.list", ["node", "list", runId], "cw_node_list", { runId }],
      ["node.graph", ["node", "graph", runId, "--json"], "cw_node_graph", { runId }],
      ["worker.summary", ["worker", "summary", runId, "--json"], "cw_worker_summary", { runId }],
      ["commit.summary", ["commit", "summary", runId, "--json"], "cw_commit_summary", { runId }],
      ["audit.summary", ["audit", "summary", runId], "cw_audit_summary", { runId }]
    ];
    for (const [capability, cliArgv, toolName, toolArgs] of probes) {
      const cliOut = JSON.parse(execFileSync(node, [cli, ...cliArgv], { cwd: workspace, encoding: "utf8" }));
      const mcpOut = await mcp.tool(toolName, { cwd: workspace, ...toolArgs });
      assert.equal(canonical(cliOut), canonical(mcpOut), `payload divergence for ${capability}: cw --json != ${toolName}`);
    }

    // global (run-less) reads are identical too.
    for (const [cliArgv, toolName] of [
      [["list"], "cw_list"],
      [["app", "list"], "cw_app_list"],
      [["topology", "list"], "cw_topology_list"]
    ]) {
      const cliOut = JSON.parse(execFileSync(node, [cli, ...cliArgv], { cwd: workspace, encoding: "utf8" }));
      const mcpOut = await mcp.tool(toolName, { cwd: workspace });
      assert.equal(canonical(cliOut), canonical(mcpOut), `payload divergence for ${cliArgv.join(" ")} != ${toolName}`);
    }
  } finally {
    mcp.server.kill();
  }

  // ---- 3. fail closed on injected drift -----------------------------------
  // extra MCP tool on the server that the registry never declared.
  const extraTool = registry.buildParityReport({ mcpTools: [...toolNames, "cw_phantom_tool"], cliTokens: tokens, helpTokens });
  assert.equal(extraTool.ok, false, "undeclared MCP tool must fail closed");
  assert.ok(extraTool.undeclaredMcpTools.includes("cw_phantom_tool"));

  // a declared MCP tool missing from the server.
  const missingTool = registry.buildParityReport({ mcpTools: toolNames.filter((tool) => tool !== "cw_status"), cliTokens: tokens, helpTokens });
  assert.equal(missingTool.ok, false, "MCP tool missing from server must fail closed");
  assert.ok(missingTool.missingMcpTools.includes("cw_status"));

  // an undeclared CLI dispatch token.
  const extraCli = registry.buildParityReport({ mcpTools: toolNames, cliTokens: [...tokens, "phantomcommand"], helpTokens });
  assert.equal(extraCli.ok, false, "undeclared CLI token must fail closed");
  assert.ok(extraCli.undeclaredCliTokens.includes("phantomcommand"));

  // a declared CLI token missing from dispatch.
  const missingCli = registry.buildParityReport({ mcpTools: toolNames, cliTokens: tokens.filter((token) => token !== "worker"), helpTokens });
  assert.equal(missingCli.ok, false, "CLI token missing from dispatch must fail closed");
  assert.ok(missingCli.missingCliTokens.includes("worker"));

  // help drift: a declared top-level command missing from help, or help listing
  // an undeclared command, must fail closed too.
  const missingHelp = registry.buildParityReport({ mcpTools: toolNames, cliTokens: tokens, helpTokens: helpTokens.filter((token) => token !== "quickstart") });
  assert.equal(missingHelp.ok, false, "help missing a registry command must fail closed");
  assert.ok(missingHelp.helpMissingCliTokens.includes("quickstart"));

  const extraHelp = registry.buildParityReport({ mcpTools: toolNames, cliTokens: tokens, helpTokens: [...helpTokens, "phantomhelp"] });
  assert.equal(extraHelp.ok, false, "help listing an undeclared command must fail closed");
  assert.ok(extraHelp.helpUndeclaredCliTokens.includes("phantomhelp"));

  process.stdout.write(`cli-mcp-parity-smoke: ok (${report.registrySize} capabilities, ${toolNames.length} MCP tools, payload identity verified)\n`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
