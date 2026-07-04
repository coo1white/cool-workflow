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
//      leaves the framework fully functional); the framework's core CLI still runs.
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
// v2 CUTOVER: old flat dist/workbench.js + dist/workbench-host.js moved to
// dist/shell/*. The old build's CoolWorkflowRunner orchestrator facade is
// GONE in v2 (documented anti-goal, intentionally dismantled): the workbench
// no longer takes a runner. buildWorkbenchRunView is now (runId, { cwd }) and
// resolves the run itself via shell/run-store.loadRunFromCwd.
const { buildWorkbenchRunView } = require(path.join(pluginRoot, "dist", "shell", "workbench.js"));
const { WorkbenchHost } = require(path.join(pluginRoot, "dist", "shell", "workbench-host.js"));

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

  // v2: no runner facade — the view resolves the run from the given cwd.
  const view = buildWorkbenchRunView(runId, { cwd: workspace });

  // ---- 1. shape + the five operator panels exist ---------------------------
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.surface, "workbench");
  assert.equal(view.runId, runId);
  assert.equal(view.resolved, true, "the bootstrapped run resolves");
  for (const group of ["graph", "blackboard", "worker", "candidate", "audit", "metrics", "collaboration"]) {
    assert.ok(view.panels[group], `panel group ${group} present`);
  }

  // ---- 1+2. panel parity: panel.data === cw <cmd> --json (byte-for-byte) ----
  // INTENT PRESERVED: every panel embeds, VERBATIM, the `cw <cmd> --json`
  // payload of the capability that fills it — panel data can never drift from
  // the standalone command. In v2 the panel->capability map (PANEL_MAP in
  // src/shell/workbench.ts) was rebuilt with a different member layout than the
  // old build (e.g. graph.compact/criticalPath now embed `summary show`, not
  // `multi-agent graph --view ...`; candidate.reasoning now embeds `candidate
  // summary`, not the old MCP-only `multi-agent reasoning`). So we no longer
  // hardcode the OLD command list — we derive each panel's expected CLI command
  // from its OWN declared capability in the v2 registry (the true no-drift
  // invariant), and compare panel.data to that command byte-for-byte.
  const { REGISTRY, findCapability } = require("../dist/core/capability-table");
  // Build argv from a capability's declared cli.path; append --json only for
  // flag-mode capabilities (default-mode ones already print JSON).
  function argvFor(capability) {
    const row = findCapability(capability);
    assert.ok(row && row.cli, `panel capability ${capability} must declare a CLI path`);
    const argv = [...row.cli.path, runId];
    if (row.cli.jsonMode === "flag") argv.push("--json");
    return argv;
  }
  const panels = [
    view.panels.graph.operator,
    view.panels.graph.multiAgent,
    view.panels.graph.compact,
    view.panels.graph.criticalPath,
    view.panels.blackboard.coordinator,
    view.panels.blackboard.digest,
    view.panels.blackboard.graph,
    view.panels.worker.summary,
    view.panels.candidate.summary,
    view.panels.candidate.reasoning,
    view.panels.audit.summary,
    view.panels.audit.multiAgent,
    view.panels.audit.policy,
    view.panels.audit.judge,
    view.panels.metrics.report,
    view.panels.collaboration.review,
    view.panels.collaboration.comments
  ];
  const panelCliParity = panels.map((panel) => [panel, argvFor(panel.capability)]);
  // NOTE (v2 REAL-GAP, fires FIRST on the metrics.show panel): the metrics
  // payload is time-dependent for an in-flight run — `time.run.wallClockMs`
  // (src/shell/observability.ts:519) and `sourceFingerprint`
  // (:523 -> fingerprintMetricsSource :218-219, which folds run.updatedAt) drift
  // between the in-process panel build and the fresh CLI subprocess, so the two
  // do NOT match byte-for-byte even though they describe the same run. This is
  // genuine v2 metrics-determinism debt, not an import/adaptation problem —
  // conformance passes because a lone CLI subprocess is internally stable. Left
  // failing here (not weakened) per the audit rules; same root cause fails the
  // CLI<->MCP and core===cliView parity below. See also the five structural
  // NO-EQUIVALENT gaps flagged later (routes.method, /api/index registry, 403
  // traversal, 400 malformed, and the optional-surface invariant).
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
  // Label drift gate: every panel capability must exist in the registry, and
  // the panel's CLI label must reference the registered verb path.
  // v2: the old flat dist/capability-registry.js CAPABILITY_REGISTRY is now
  // REGISTRY in dist/core/capability-table.js (same entry shape: .capability,
  // .cli.path). Every v2 panel capability declares a real CLI path, so the old
  // `startsWith("multi-agent")` escape hatch is no longer needed.
  for (const [panel] of panelCliParity) {
    const reg = Object.values(REGISTRY).find((e) => e.capability === panel.capability);
    assert.ok(reg, `panel capability ${panel.capability} must be registered in REGISTRY`);
    const cliPath = reg.cli?.path?.filter((s) => s !== "--json").join(" ") || "";
    assert.ok(
      panel.cli.includes(cliPath),
      `panel ${panel.capability} CLI label "${panel.cli}" must reference registry path ${cliPath}`
    );
  }

  const cliView = cwJson(["workbench", "view", runId, "--json"]);
  const cliServe = cwJson(["workbench", "serve", "--once", "--json", "--cwd", workspace]);
  const mcp = openMcp();
  try {
    await mcp.rpc("initialize", {});
    const mcpView = await mcp.tool("cw_workbench_view", { cwd: workspace, runId });
    const mcpServe = await mcp.tool("cw_workbench_serve", { cwd: workspace });
    // v2 REAL-GAP: these three byte-parity assertions FAIL because the metrics
    // panel's `sourceFingerprint` is NON-DETERMINISTIC across repeated
    // in-process builds. `fingerprintMetricsSource` (src/shell/observability.ts:
    // 218-219) folds `run.updatedAt` into the hash, and the in-process run load
    // used by buildWorkbenchRunView produces a drifting `updatedAt` — so the
    // in-process view (mcpView, and the top-of-test `view`) hashes differently
    // from the fresh-subprocess `cliView`, even for the same unchanged run. A
    // full CLI subprocess is internally stable (loads once, exits), which is why
    // conformance passes; only the in-process re-read drifts. Left failing on
    // the genuine behavior per the audit rules (do NOT weaken to force green).
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
  // v2 NO-EQUIVALENT: v2's WorkbenchRoute is { path, description } — the `method`
  // field is gone (src/shell/workbench.ts WorkbenchRoute + WORKBENCH_ROUTES). The
  // read-only/GET-only guarantee now lives in the host (every non-GET is 405,
  // asserted below), not as a per-route `method` label. The old
  // `routes.every(r => r.method === "GET")` has no v2 field to read, so it fails.
  assert.ok(Array.isArray(cliServe.routes) && cliServe.routes.every((r) => r.method === "GET"), "every route is GET");

  // ---- 3 + 5. the live host: read-only, localhost-only, no hidden state -----
  // v2: WorkbenchHost takes no `runner` (facade removed) — just { cwd, port,
  // scope }. `listen()` now resolves to the bound PORT NUMBER (not a { host,
  // port } object); the bind host is always 127.0.0.1 (hardcoded in
  // src/shell/workbench-host.ts's listen()), so the loopback guarantee is
  // structural, checked here against the constant.
  const beforeListing = listRunDir(runId);
  const host = new WorkbenchHost({ cwd: workspace, port: 0, scope: "home" });
  const boundPort = await host.listen();
  assert.equal(typeof boundPort, "number", "host bound to an ephemeral port (127.0.0.1 loopback)");
  try {
    const base = { host: "127.0.0.1", port: boundPort };
    const okHeaders = { host: `127.0.0.1:${boundPort}` };

    // GET run view == CLI view.
    const got = await request({ ...base, path: `/api/run/${runId}`, method: "GET", headers: okHeaders });
    assert.equal(got.status, 200, "GET /api/run/:id is 200");
    assert.equal(canonical(JSON.parse(got.body)), canonical(cliView), "host run view === cw workbench view --json");

    // Index endpoint composes existing registry + run-list payloads.
    // v2 REAL-GAP: buildWorkbenchIndex (src/shell/workbench.ts:169-176) is a
    // documented PLACEHOLDER that returns { schemaVersion, runs: [] } — it never
    // enumerates the run registry and carries NO `registry` key. The old build's
    // index composed the capability registry + a real run listing; v2 dropped
    // both. So `idxView.registry` is undefined and `idxView.runs` is always empty
    // — the assertion lands on genuine missing v2 functionality.
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
    // v2 REAL-GAP: v2 returns 404 (not 403) for this input. serveUiAsset
    // (src/shell/workbench-host.ts:147-156) resolves `..%2f..%2fpackage.json`
    // as a SINGLE path segment (the %2f stays encoded through url.pathname), so
    // path.resolve keeps it INSIDE uiRoot and the traversal guard never fires;
    // it falls through to "UI asset not installed" 404. The escape is not
    // actually served (still refused), but the old build's explicit 403
    // traversal signal is absent.
    const traversal = await request({ ...base, path: "/ui/..%2f..%2fpackage.json", method: "GET", headers: okHeaders });
    assert.equal(traversal.status, 403, "path traversal refused 403");

    // Malformed percent-encoding is a client error, not a server crash.
    // v2 REAL-GAP: v2 returns 404 (not 400) here, with no "malformed URL path"
    // message. Node's `new URL("/%E0%A4%A", ...)` does NOT throw on this input,
    // so v2's try/catch (src/shell/workbench-host.ts:110-116) never trips its
    // 400 "bad request: invalid URL" branch; the request reaches the generic
    // "no such read-only view" 404. The old build recognized malformed percent-
    // encoding explicitly as a 400 client error.
    const malformed = await request({ ...base, path: "/%E0%A4%A", method: "GET", headers: okHeaders });
    assert.equal(malformed.status, 400, "malformed URL path is refused 400");
    assert.match(JSON.parse(malformed.body).error, /malformed URL path/, "malformed path response is JSON");
  } finally {
    await host.close();
  }
  // NO HIDDEN STATE: serving the run mutated nothing under its run dir.
  assert.deepEqual(listRunDir(runId), beforeListing, "serving writes nothing to .cw/runs/<id>");

  // ---- 4. fail closed: an absent run is resolved:false, all panels absent ---
  // v2: (runId, { cwd }) signature (no runner facade).
  const ghost = buildWorkbenchRunView("does-not-exist-000", { cwd: workspace });
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
  // If a core kernel module required the Workbench, deleting it would break the
  // framework. Assert the dependency direction: kernel -> (nothing), front doors
  // -> workbench. We check the compiled kernel modules carry no workbench require.
  //
  // v2 CUTOVER: the old flat kernel module names are gone. Their v2 equivalents:
  //   orchestrator.js  -> (facade REMOVED, no equivalent)
  //   state.js         -> core/state/* + shell/run-store.js
  //   run-registry.js  -> shell/run-registry-io.js
  //   capability-core.js -> core/capability-table.js  (the capability registry)
  //   dispatch.js      -> cli/dispatch.js + mcp/dispatch.js + core/pipeline/dispatch.js
  //   pipeline-runner.js -> core/pipeline/runner.js
  //
  // v2 NO-EQUIVALENT: the workbench is NO LONGER an optional/removable surface.
  // core/capability-table.js — the central registry that every CLI and MCP
  // dispatch loads — STATICALLY requires ../shell/workbench, ../shell/workbench-
  // text, and ../shell/workbench-host (src/core/capability-table.ts:2355-2357).
  // Deleting the workbench would break the whole registry, so the old build's
  // "kernel imports the Workbench never" invariant is structurally false in v2.
  // The check now matches any workbench require (flat or shell/ path) so it
  // lands on this genuine v2 divergence instead of an import crash.
  const kernelModules = {
    "core/state/schema.js": true,
    "shell/run-registry-io.js": true,
    "core/capability-table.js": true,
    "cli/dispatch.js": true,
    "mcp/dispatch.js": true,
    "core/pipeline/runner.js": true,
  };
  for (const kernelModule of Object.keys(kernelModules)) {
    const source = fs.readFileSync(path.join(pluginRoot, "dist", kernelModule), "utf8");
    assert.ok(!/require\(["'][^"']*workbench/.test(source), `${kernelModule} must not import the Workbench (optional surface)`);
  }
  // And the framework's core CLI still works (Workbench is additive, not required).
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
