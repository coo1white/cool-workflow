#!/usr/bin/env node
"use strict";

// vendor-preflight-smoke -- exercises scripts/vendor-preflight.js LOGIC (matrix +
// hard-block exit code) with shim wrappers. No live vendor, no keys: the shims
// stand in for the real adapters so the gate is tested deterministically offline.
// (The live gate itself runs on the release machine where the real keys exist.)

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const preflight = path.join(pluginRoot, "scripts", "vendor-preflight.js");
const BT = String.fromCharCode(96).repeat(3); // ``` without breaking this template

// specs: { vendorName: "ok" | "fail" | "empty" }
function makeAgentsDir(specs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-preflight-agents-"));
  const templates = {};
  for (const [name, behavior] of Object.entries(specs)) {
    const script = `${name}-shim.js`;
    templates[name] = script;
    const resultBody = `ok answer\n\n${BT}cw:result\n{"summary":"ok","findings":[],"evidence":["README.md:1"]}\n${BT}\n`;
    const src = `#!/usr/bin/env node
const fs = require("node:fs");
const resultPath = process.argv[3];
const b = ${JSON.stringify(behavior)};
if (b === "fail") { process.stderr.write("shim auth error: no key set\\n"); process.exit(1); }
if (b === "empty") { process.exit(0); } // exit 0 but writes NO result.md
fs.writeFileSync(resultPath, ${JSON.stringify(resultBody)});
process.stdout.write(JSON.stringify({ model: "shim/model-" + ${JSON.stringify(name)}, usage: { input_tokens: 1 }, result: "ok" }));
process.exit(0);
`;
    fs.writeFileSync(path.join(dir, script), src, "utf8");
  }
  fs.writeFileSync(path.join(dir, "builtin-templates.json"), JSON.stringify({ schemaVersion: 1, templates }), "utf8");
  return dir;
}

function run(agentsDir, extraArgs = []) {
  return spawnSync(process.execPath, [preflight, ...extraArgs], {
    encoding: "utf8",
    env: { ...process.env, CW_PREFLIGHT_AGENTS_DIR: agentsDir },
    timeout: 30000
  });
}

function main() {
  // 1. all vendors green -> exit 0
  {
    const dir = makeAgentsDir({ claude: "ok", codex: "ok", deepseek: "ok" });
    const r = run(dir, ["--json"]);
    assert.equal(r.status, 0, `all-green preflight exits 0 (stderr: ${r.stderr})`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.vendors.length, 3);
    assert.ok(out.vendors.every((v) => v.status === "PASS"), "every vendor PASS");
    assert.ok(out.vendors.every((v) => v.hasContract), "cw:result block detected per vendor");
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("preflight: all vendors green -> exit 0 OK");
  }

  // 2. one vendor fails (auth) -> HARD BLOCK (exit 1), names the vendor + reason
  {
    const dir = makeAgentsDir({ claude: "ok", codex: "ok", gemini: "fail", deepseek: "ok" });
    const r = run(dir, ["--json"]);
    assert.equal(r.status, 1, "any failing vendor hard-blocks (exit 1)");
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    const gem = out.vendors.find((v) => v.vendor === "gemini");
    assert.equal(gem.status, "FAIL");
    assert.match(gem.reason, /auth error/, "failure reason carries the wrapper stderr tail");
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("preflight: one auth-failed vendor -> hard block OK");
  }

  // 3. exit 0 but empty result -> FAIL (fail closed, never fabricate)
  {
    const dir = makeAgentsDir({ claude: "ok", codex: "empty" });
    const r = run(dir, ["--json"]);
    assert.equal(r.status, 1, "empty-result vendor blocks");
    const cdx = JSON.parse(r.stdout).vendors.find((v) => v.vendor === "codex");
    assert.equal(cdx.status, "FAIL");
    assert.match(cdx.reason, /empty result/);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("preflight: exit-0-but-empty -> FAIL OK");
  }

  // 4. --vendors filter restricts the checked set
  {
    const dir = makeAgentsDir({ claude: "ok", codex: "ok", gemini: "fail" });
    const r = run(dir, ["--json", "--vendors", "claude,codex"]);
    assert.equal(r.status, 0, "filtered set excludes the failing gemini");
    assert.equal(JSON.parse(r.stdout).vendors.length, 2);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("preflight: --vendors filter OK");
  }

  // 5. unknown vendor name is rejected (fail closed, exit 2)
  {
    const dir = makeAgentsDir({ claude: "ok" });
    const r = run(dir, ["--vendors", "nope"]);
    assert.equal(r.status, 2, "unknown vendor name is a usage error");
    assert.match(r.stderr, /unknown vendor/);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("preflight: unknown vendor rejected OK");
  }

  console.log("vendor-preflight-smoke: ok");
}

main();
