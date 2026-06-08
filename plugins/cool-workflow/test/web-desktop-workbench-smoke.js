#!/usr/bin/env node
"use strict";

// web-desktop-workbench-smoke (v0.1.30): proves the Web / Desktop Workbench is a
// THIRD FRONT DOOR — a stateless, read-only RENDERER over the durable `.cw/`
// files and the existing capability payloads — and NOT a new brain or a hidden
// dashboard database. It asserts:
//
//   1. Panel parity — every panel of `workbench.view` embeds, VERBATIM, the
//      canonical `cw <cmd> --json` payload of one already-declared capability:
//      panel.data === runner.<entry>(runId) === `cw <cmd> --json` byte-for-byte.
//   2. CLI <-> MCP parity — `cw workbench view --json` is payload-identical to
//      `cw_workbench_view`, and `cw workbench serve --once --json` is identical
//      to `cw_workbench_serve` (the descriptor; the CLI default additionally
//      starts the server, the declared divergence).
//   3. Read-only, localhost-only host — every route is GET; writes are refused
//      405; non-localhost Host headers are refused 403; path traversal 403; the
//      bind is 127.0.0.1 only.
//   4. Fail closed / freshness honesty — a view of an absent run is
//      resolved:false with every panel `absent` and an honest error; nothing
//      fabricated.
//   5. NO HIDDEN STATE — the host serving a run writes nothing under .cw/runs/.
//   6. OPTIONAL SURFACE — the kernel imports the Workbench never (so removing it
//      leaves the SDK fully functional); the SDK's core CLI still runs.
//
// Included in `npm test` and `npm run release:check`.

const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const mcpServer = path.join(pluginRoot, "dist", "mcp-server.js");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist", "orchestrator.js"));
const { buildWorkbenchRunView } = require(path.join(pluginRoot, "dist", "workbench.js"));
const { WorkbenchHost } = require(path.join(pluginRoot, "dist", "workbench-host.js"));

const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-workbench-")));

function cw(args, cwd = workspace) {
  return execFileSync(node, [cli, ...args], { cwd, encoding: "utf8" });
}
function cwJson(args, cwd = workspace) {
  return JSON.parse(cw(args, cwd));
}
// ISO generation-moment timestamps are presentation metadata, not capability
// data (same convention as scripts/parity-check.js). Neutralize them only.
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
  const tool = (name, args) => rpc("tools/call", { name, arguments: args }).then((r) => JSON.parse(r.content[0].text));
  return { server, rpc, tool };
}

function request(opts) {
  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  // Bootstrap a real run in an isolated workspace.
  const plan = cwJson(["plan", "architecture-review", "--repo", workspace, "--question", "v0.1.30 workbench smoke"]);
  const runId = plan.runId;
  assert.ok(runId, "planned run has an id");

  const runner = new CoolWorkflowRunner({ pluginRoot });
  // The core view loads the run from process.cwd() (like the MCP surface chdirs
  // to args.cwd, and the host chdirs to its bound cwd). Anchor the in-process
  // calls to the workspace so they read the bootstrapped run.
  process.chdir(workspace);
  const view = buildWorkbenchRunView(runner, runId);

  // ---- 1. shape + the five operator panels exist ---------------------------
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.surface, "workbench");
  assert.equal(view.runId, runId);
  assert.equal(view.resolved, true, "the bootstrapped run resolves");
  for (const group of ["graph", "blackboard", "worker", "candidate", "audit"]) {
    assert.ok(view.panels[group], `panel group ${group} present`);
  }

  // ---- 1+2. panel parity: panel.data === cw <cmd> --json (byte-for-byte) ----
  // Each pairing names the panel and the exact CLI command it must equal.
  const panelCliParity = [
    [view.panels.graph.operator, ["graph", runId, "--json"]],
    [view.panels.graph.multiAgent, ["multi-agent", "graph", runId, "--json"]],
    [view.panels.graph.compact, ["multi-agent", "graph", runId, "--view", "compact", "--json"]],
    [view.panels.graph.criticalPath, ["multi-agent", "graph", runId, "--view", "critical-path", "--json"]],
    [view.panels.blackboard.coordinator, ["coordinator", "summary", runId]],
    [view.panels.blackboard.digest, ["blackboard", "summarize", runId, "--json"]],
    [view.panels.blackboard.graph, ["blackboard", "graph", runId]],
    [view.panels.worker.summary, ["worker", "summary", runId, "--json"]],
    [view.panels.candidate.summary, ["candidate", "summary", runId, "--json"]],
    [view.panels.candidate.reasoning, ["multi-agent", "reasoning", runId, "--json"]],
    [view.panels.audit.summary, ["audit", "summary", runId]],
    [view.panels.audit.multiAgent, ["audit", "multi-agent", runId, "--json"]],
    [view.panels.audit.policy, ["audit", "policy", runId, "--json"]],
    [view.panels.audit.judge, ["audit", "judge", runId, "--json"]]
  ];
  for (const [panel, argv] of panelCliParity) {
    assert.equal(panel.status, "present", `panel ${panel.capability} present on a fresh run`);
    const cliPayload = cwJson(argv);
    assert.equal(
      canonical(panel.data),
      canonical(cliPayload),
      `panel ${panel.capability} must equal ${["cw", ...argv].join(" ")} byte-for-byte`
    );
  }

  // ---- 2. CLI <-> MCP parity for the new capabilities ----------------------
  const cliView = cwJson(["workbench", "view", runId, "--json"]);
  const cliServe = cwJson(["workbench", "serve", "--once", "--json", "--cwd", workspace]);
  const mcp = openMcp();
  try {
    await mcp.rpc("initialize", {});
    const mcpView = await mcp.tool("cw_workbench_view", { cwd: workspace, runId });
    const mcpServe = await mcp.tool("cw_workbench_serve", { cwd: workspace });
    assert.equal(canonical(cliView), canonical(mcpView), "cw workbench view --json === cw_workbench_view");
    assert.equal(canonical(cliServe), canonical(mcpServe), "cw workbench serve --once --json === cw_workbench_serve");
    // And the core view equals the CLI view (one source, two renderings).
    assert.equal(canonical(view), canonical(cliView), "core buildWorkbenchRunView === cw workbench view --json");
  } finally {
    mcp.server.kill();
  }

  // ---- serve descriptor: localhost-only, read-only, honest about the UI -----
  assert.equal(cliServe.host, "127.0.0.1", "serve binds loopback only");
  assert.equal(cliServe.readOnly, true, "serve is read-only");
  assert.equal(cliServe.once, true, "--once descriptor reports once");
  assert.ok(Array.isArray(cliServe.routes) && cliServe.routes.every((r) => r.method === "GET"), "every route is GET");

  // ---- 3 + 5. the live host: read-only, localhost-only, no hidden state -----
  const beforeListing = listRunDir(runId);
  const host = new WorkbenchHost({ runner, cwd: workspace, port: 0, scope: "home" });
  const bound = await host.listen();
  assert.equal(bound.host, "127.0.0.1", "host bound to loopback");
  try {
    const base = { host: "127.0.0.1", port: bound.port };
    const okHeaders = { host: `127.0.0.1:${bound.port}` };

    // GET run view == CLI view.
    const got = await request({ ...base, path: `/api/run/${runId}`, method: "GET", headers: okHeaders });
    assert.equal(got.status, 200, "GET /api/run/:id is 200");
    assert.equal(canonical(JSON.parse(got.body)), canonical(cliView), "host run view === cw workbench view --json");

    // Index endpoint composes existing registry + run-list payloads.
    const idx = await request({ ...base, path: "/api/index", method: "GET", headers: okHeaders });
    assert.equal(idx.status, 200, "GET /api/index is 200");
    const idxView = JSON.parse(idx.body);
    assert.ok(idxView.registry && idxView.runs, "index carries registry + runs");

    // UI shell + assets served.
    const ui = await request({ ...base, path: "/", method: "GET", headers: okHeaders });
    assert.equal(ui.status, 200, "GET / serves a UI shell");
    assert.ok(/<!doctype html>/i.test(ui.body), "UI shell is HTML");

    // Read-only: every write verb refused 405.
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const w = await request({ ...base, path: `/api/run/${runId}`, method, headers: okHeaders });
      assert.equal(w.status, 405, `${method} is refused 405 (read-only)`);
    }

    // Localhost only: a foreign Host header is refused 403 (DNS-rebinding defense).
    const evil = await request({ ...base, path: "/api/index", method: "GET", headers: { host: "evil.example.com" } });
    assert.equal(evil.status, 403, "non-localhost Host header refused 403");

    // Path traversal out of ui/ refused 403.
    const traversal = await request({ ...base, path: "/ui/..%2f..%2fpackage.json", method: "GET", headers: okHeaders });
    assert.equal(traversal.status, 403, "path traversal refused 403");
  } finally {
    await host.close();
  }
  // NO HIDDEN STATE: serving the run mutated nothing under its run dir.
  assert.deepEqual(listRunDir(runId), beforeListing, "serving writes nothing to .cw/runs/<id>");

  // ---- 4. fail closed: an absent run is resolved:false, all panels absent ---
  const ghost = buildWorkbenchRunView(runner, "does-not-exist-000");
  assert.equal(ghost.resolved, false, "absent run is unresolved");
  assert.ok(ghost.error, "absent run carries an honest error");
  for (const group of Object.values(ghost.panels)) {
    for (const panel of Object.values(group)) {
      assert.equal(panel.status, "absent", `panel ${panel.capability} is absent for an absent run`);
      assert.ok(panel.error, "absent panel carries an honest error, never fabricated data");
    }
  }
  // And the CLI agrees (same fail-closed projection).
  const cliGhost = cwJson(["workbench", "view", "does-not-exist-000", "--json"]);
  assert.equal(cliGhost.resolved, false, "CLI also reports the absent run unresolved");

  // ---- 6. OPTIONAL SURFACE: the kernel imports the Workbench never ----------
  // If a core kernel module required dist/workbench*, deleting it would break the
  // SDK. Assert the dependency direction: kernel -> (nothing), front doors ->
  // workbench. We check the compiled kernel modules carry no workbench require.
  for (const kernelModule of ["orchestrator.js", "state.js", "run-registry.js", "capability-core.js", "dispatch.js", "pipeline-runner.js"]) {
    const source = fs.readFileSync(path.join(pluginRoot, "dist", kernelModule), "utf8");
    assert.ok(!/require\(["']\.\/workbench/.test(source), `${kernelModule} must not import the Workbench (optional surface)`);
  }
  // And the SDK's core CLI still works (Workbench is additive, not required).
  const listed = cwJson(["list"], pluginRoot);
  assert.ok(Array.isArray(listed) || (listed && typeof listed === "object"), "core `cw list` still works");

  process.stdout.write(
    `${JSON.stringify({ ok: true, test: "web-desktop-workbench-smoke", runId, panelsChecked: panelCliParity.length }, null, 2)}\n`
  );
}

function listRunDir(runId) {
  const dir = path.join(workspace, ".cw", "runs", runId);
  try {
    return fs
      .readdirSync(dir, { recursive: true })
      .map(String)
      .sort();
  } catch {
    return [];
  }
}

main().catch((error) => {
  process.stderr.write(`web-desktop-workbench-smoke: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
