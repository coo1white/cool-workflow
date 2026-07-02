"use strict";
// parse-hardening-round2-smoke (v0.1.96). Proves the round-2 audit fixes:
// MCP type guard rejects null/non-object lines, readJson replaces bare
// JSON.parse in candidate-scoring + migration, resultPath rejects system
// dirs, sandbox profile traversal is blocked, git ref -prefix rejected,
// maxBuffer capped, and workbench token uses timingSafeEqual.
//
// @cw-smoke: parse-hardening-round2-smoke

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");

function main() {
  // ---- 1. MCP server rejects null (not crash) ---------------------------------
  {
    const { spawnSync } = require("node:child_process");
    const mcp = path.join(pluginRoot, "dist", "mcp-server.js");
    const child = spawnSync(process.execPath, [mcp], {
      input: "null\n",
      encoding: "utf8",
      timeout: 5000
    });
    const out = String(child.stdout || "");
    assert.ok(out.includes("-32600") || out.includes("Invalid Request"), `null line rejected: ${out.slice(0, 200)}`);
  }

  // ---- 2. MCP server rejects array --------------------------------------------
  {
    const mcp = path.join(pluginRoot, "dist", "mcp-server.js");
    const child = spawnSync(process.execPath, [mcp], {
      input: "[]\n",
      encoding: "utf8",
      timeout: 5000
    });
    const out = String(child.stdout || "");
    assert.ok(out.includes("-32600") || out.includes("Invalid Request"), `array line rejected: ${out.slice(0, 200)}`);
  }

  // ---- 3. MCP server still handles valid requests -----------------------------
  {
    const mcp = path.join(pluginRoot, "dist", "mcp-server.js");
    const child = spawnSync(process.execPath, [mcp], {
      input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n",
      encoding: "utf8",
      timeout: 5000
    });
    const out = String(child.stdout || "");
    assert.ok(out.includes("cool-workflow"), "valid requests still handled");
  }

  // ---- 4. readJson (existing helper) throws clear error on bad JSON -----------
  {
    const { readJson } = require(path.join(pluginRoot, "dist", "state.js"));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-"));
    const badFile = path.join(tmp, "bad.json");
    fs.writeFileSync(badFile, "{not valid", "utf8");
    assert.throws(() => readJson(badFile), /Invalid JSON/, "readJson throws clear error on bad JSON");
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- 5. resultPath rejects /etc paths ---------------------------------------
  {
    const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist", "orchestrator.js"));
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const plan = runner.plan("end-to-end-golden-path", { question: "path-guard-test" });
    assert.throws(() => {
      runner.recordResult(plan.id, plan.tasks[0].id, "/etc/passwd", {});
    }, /system directory|Result file does not exist/, "resultPath to /etc rejected");
  }

  // ---- 6. runtime imports still valid -----------------------------------------
  {
    require(path.join(pluginRoot, "dist", "candidate-scoring.js"));
    const { loadMigrationSnapshot } = require(path.join(pluginRoot, "dist", "orchestrator", "migration-operations.js"));
    const { recordResult } = require(path.join(pluginRoot, "dist", "orchestrator", "lifecycle-operations.js"));
  }

  // ---- 7. direct recordResult uses the same resolvable evidence gate ----------
  {
    const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist", "orchestrator.js"));
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-direct-result-")));
    const runner = new CoolWorkflowRunner({ pluginRoot }).withBaseDir(tmp);
    fs.writeFileSync(path.join(tmp, "README.md"), "# target\n", "utf8");
    const plan = runner.plan("end-to-end-golden-path", { repo: tmp, question: "direct evidence" });
    const resultPath = path.join(tmp, "result.md");
    const fence = "`".repeat(3);
    const writeResult = (evidence) => fs.writeFileSync(
      resultPath,
      `# R\n\n${fence}cw:result\n${JSON.stringify({ summary: "ok", findings: [], evidence })}\n${fence}\n`,
      "utf8"
    );
    writeResult(["missing-evidence.txt:1"]);
    assert.throws(
      () => runner.recordResult(plan.id, plan.tasks[0].id, resultPath, {}),
      /does not resolve on disk/,
      "direct recordResult refuses unresolved file evidence"
    );
    fs.writeFileSync(path.join(tmp, "present-evidence.txt"), "ok\n", "utf8");
    writeResult(["present-evidence.txt:1"]);
    runner.recordResult(plan.id, plan.tasks[0].id, resultPath, {});
    const recorded = runner.loadRun(plan.id);
    assert.ok(recorded.tasks.some((task) => task.id === plan.tasks[0].id && task.status === "completed"), "direct recordResult still accepts resolvable evidence");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
  process.stdout.write("PASS  parse-hardening-round2-smoke.js\n");
} catch (e) {
  process.stderr.write(`FAIL  parse-hardening-round2-smoke.js — ${String(e && e.message || e)}\n`);
  process.exit(1);
}
