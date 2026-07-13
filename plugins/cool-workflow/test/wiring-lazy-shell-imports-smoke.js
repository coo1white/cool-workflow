#!/usr/bin/env node
"use strict";

// wiring-lazy-shell-imports-smoke — perf cycle P1-4.
//
// Every wiring/capability-table/*.ts slice is required unconditionally at
// CLI/MCP startup for EVERY command (index.ts's whole job is to populate
// REGISTRY before dispatch can look anything up). Each slice used to have
// top-level `import { someHandler } from "../../shell/some-module"`
// statements, even though `someHandler` is only ever called inside ONE
// specific capability's handler body. That meant loading a shell module's
// full dependency tree happened on every invocation, whether or not that
// invocation's command ever touched it -- measured live: `cw --version`
// went from ~70-110ms to a consistent ~40ms after converting every slice's
// shell-module imports to lazy (`require()`d only inside the handler that
// actually uses them, not at file-import time).
//
// Proven deterministically (not by timing -- see cycle P1-2's own note on
// why wall-clock assertions are flaky under this repo's concurrent test
// suite): a `--require`-injected hook overrides `Module._load` to record
// the resolved path of every module actually loaded, for a handful of real
// `cw` invocations run as real child processes against the real
// dist/cli.js. A command that never touches a given capability must not
// load that capability's shell module at all; a command that does must.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cliPath = path.join(pluginRoot, "dist/cli.js");

const hookDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-lazy-hook-"));
const hookPath = path.join(hookDir, "hook.js");
fs.writeFileSync(
  hookPath,
  [
    '"use strict";',
    'const Module = require("module");',
    'const fs = require("fs");',
    "const loaded = new Set();",
    "const origLoad = Module._load;",
    "Module._load = function (request, parent, isMain) {",
    "  try {",
    "    loaded.add(Module._resolveFilename(request, parent, isMain));",
    "  } catch {",
    "    // unresolvable request (e.g. a builtin already special-cased elsewhere) -- not our concern here",
    "  }",
    "  return origLoad.apply(this, arguments);",
    "};",
    'process.on("exit", () => {',
    "  fs.writeFileSync(process.env.CW_LAZY_PROBE_OUT, JSON.stringify([...loaded]));",
    "});",
  ].join("\n"),
  "utf8"
);

/** Runs `dist/cli.js <args>` as a real child process with the module-load
 *  tracking hook injected, and returns the set of absolute module paths
 *  Node actually resolved+loaded during that one invocation. Does not care
 *  about the command's exit code -- an invocation can fail (e.g. status on
 *  a nonexistent run id) and still prove the shell module it needed got
 *  loaded on the way to that failure. */
function loadedModulesFor(args, cwd) {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cw-lazy-probe-")), "modules.json");
  spawnSync(process.execPath, ["--require", hookPath, cliPath, ...args], {
    cwd: cwd || pluginRoot,
    encoding: "utf8",
    env: { ...process.env, CW_LAZY_PROBE_OUT: outFile },
  });
  return new Set(JSON.parse(fs.readFileSync(outFile, "utf8")));
}

function loadedShellModule(loaded, relativeShellPath) {
  const suffix = `shell/${relativeShellPath}`;
  for (const p of loaded) if (p.endsWith(suffix)) return true;
  return false;
}

try {
  // ---------------------------------------------------------------------
  // 1. `cw --version`: needs nothing but a pure constant. Must load NONE
  //    of these heavy, multi-capability shell modules -- before this fix,
  //    ALL of them loaded unconditionally via registry-core.ts alone or
  //    one of the 8 domain slices' own top-level imports.
  // ---------------------------------------------------------------------
  {
    const loaded = loadedModulesFor(["--version"]);
    const mustNotLoad = [
      "multi-agent-cli.js",
      "registry-cli.js",
      "report-view-cli.js",
      "worker-cli.js",
      "feedback-cli.js",
      "audit-cli.js",
      "run-store.js",
      "workflow-app-loader.js",
      "doctor.js",
      "exec-backend-cli.js",
      "ledger-cli.js",
    ];
    for (const mod of mustNotLoad) {
      assert.equal(loadedShellModule(loaded, mod), false, `cw --version must not load shell/${mod} -- it doesn't need it`);
    }
    assert.ok(loaded.size < 60, `cw --version loaded ${loaded.size} modules total, expected a lean startup (was ~90+ before this fix across the 9 slices' combined eager imports)`);
  }

  // ---------------------------------------------------------------------
  // 2. `cw list`: DOES need shell/workflow-app-loader.js (registry-core's
  //    listBundledWorkflows), but must still skip unrelated heavy modules
  //    like multi-agent-cli.js/registry-cli.js/worker-cli.js.
  // ---------------------------------------------------------------------
  {
    const loaded = loadedModulesFor(["list"]);
    assert.ok(loadedShellModule(loaded, "workflow-app-loader.js"), "cw list must load shell/workflow-app-loader.js -- it's what actually lists the apps");
    for (const mod of ["multi-agent-cli.js", "registry-cli.js", "worker-cli.js", "doctor.js"]) {
      assert.equal(loadedShellModule(loaded, mod), false, `cw list must not load shell/${mod} -- unrelated to listing apps`);
    }
  }

  // ---------------------------------------------------------------------
  // 3. `cw status <id>`: DOES need shell/run-store.js (registry-core's
  //    statusPayload, given a real run id argument) -- proven even though
  //    the id is fake and the command itself errors out, since the module
  //    load happens on the way to that error, before the lookup fails.
  // ---------------------------------------------------------------------
  {
    const loaded = loadedModulesFor(["status", "definitely-not-a-real-run-id"]);
    assert.ok(loadedShellModule(loaded, "run-store.js"), "cw status <id> must load shell/run-store.js to attempt the lookup");
  }

  // ---------------------------------------------------------------------
  // 4. `cw sandbox list`: a pure static array (listBundledSandboxProfiles),
  //    no unrelated shell module should load for it. It DOES need
  //    shell/exec-backend-cli.js itself (listSandboxProfilesCli lives
  //    there) -- pin that on-demand load positively, not just the negative
  //    "unrelated modules stay absent" side.
  // ---------------------------------------------------------------------
  {
    const loaded = loadedModulesFor(["sandbox", "list"]);
    for (const mod of ["multi-agent-cli.js", "registry-cli.js", "worker-cli.js", "run-store.js", "workflow-app-loader.js"]) {
      assert.equal(loadedShellModule(loaded, mod), false, `cw sandbox list must not load shell/${mod} -- it returns a static array`);
    }
    assert.ok(loadedShellModule(loaded, "exec-backend-cli.js"), "cw sandbox list must load shell/exec-backend-cli.js -- it's what actually lists the profiles");
  }

  // ---------------------------------------------------------------------
  // 5. `cw ledger list`: needs shell/ledger-cli.js (ledgerListCli), the
  //    other lazy shell holdout fixed by this cycle. Pins the on-demand
  //    load side for ledger, mirroring case 4 for exec-backend.
  // ---------------------------------------------------------------------
  {
    const loaded = loadedModulesFor(["ledger", "list"]);
    assert.ok(loadedShellModule(loaded, "ledger-cli.js"), "cw ledger list must load shell/ledger-cli.js -- it's what actually lists the ledger entries");
    for (const mod of ["multi-agent-cli.js", "registry-cli.js", "worker-cli.js", "exec-backend-cli.js"]) {
      assert.equal(loadedShellModule(loaded, mod), false, `cw ledger list must not load shell/${mod} -- unrelated to the ledger`);
    }
  }
} finally {
  fs.rmSync(hookDir, { recursive: true, force: true });
}

process.stdout.write("wiring-lazy-shell-imports-smoke: ok\n");
