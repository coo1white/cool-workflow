"use strict";
// parse-hardening-round2-smoke (v0.1.96; v2 cutover-rewritten). Proves the
// round-2 audit fixes: MCP type guard rejects null/non-object lines, readJson
// replaces bare JSON.parse, a result path aimed at a system dir is refused, and
// the resolvable-file-evidence gate refuses unresolved evidence but accepts
// resolvable evidence.
//
// Drives the pipeline spine in dist/shell/pipeline-cli.js (planRun,
// dispatchRun, recordResultRun, commitRun) end-to-end. The system-dir
// blacklist on the result path is the worker sandbox-boundary guard:
// recordResultRun writes only inside the dispatched worker's sandbox, so a
// result path at /etc is refused ("write path is outside sandbox profile
// ..."). The "does not resolve on disk" evidence gate lives in the commit
// gate (dist/core/pipeline/commit-gate.ts) and fires on a verifier-gated
// commit (commitRun --verifier); the resolution base dirs are [run.cwd,
// process.cwd(), run.paths.runDir], so evidence files must live in the run
// cwd (not the worker dir).
//
// @cw-smoke: parse-hardening-round2-smoke

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");

// v2 CLI-shaped pipeline spine + run store (the CoolWorkflowRunner facade's
// replacement).
const {
  planRun,
  dispatchRun,
  recordResultRun,
  commitRun
} = require(path.join(pluginRoot, "dist", "shell", "pipeline-cli.js"));
const { loadRunFromCwd } = require(path.join(pluginRoot, "dist", "shell", "run-store.js"));
const { showWorkerManifest } = require(path.join(pluginRoot, "dist", "shell", "worker-isolation.js"));

const fence = "`".repeat(3);

// Plan + dispatch a fresh single-task run in `cwd`; return ids and the
// dispatched worker's sandbox-writable result path. recordResultRun in v2 only
// accepts a result written inside the worker's sandbox, so the caller writes to
// `workerResultPath`.
function dispatchOne(cwd, question) {
  const plan = planRun({ workflowId: "end-to-end-golden-path", repo: cwd, cwd, question });
  dispatchRun({ runId: plan.runId, cwd, limit: 1 });
  const run = loadRunFromCwd(plan.runId, cwd);
  const task = run.tasks[0];
  const manifest = showWorkerManifest(run, task.workerId);
  return { runId: plan.runId, taskId: task.id, workerResultPath: manifest.resultPath };
}

function writeResultEnvelope(resultPath, evidence) {
  fs.writeFileSync(
    resultPath,
    `# R\n\n${fence}cw:result\n${JSON.stringify({ summary: "ok", findings: [], evidence })}\n${fence}\n`,
    "utf8"
  );
}

function main() {
  // ---- 1. MCP server rejects null (not crash) ---------------------------------
  {
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
  // v2: readJson moved from dist/state.js to dist/shell/fs-atomic.js; the
  // "Invalid JSON in <file>: ..." message is byte-preserved.
  {
    const { readJson } = require(path.join(pluginRoot, "dist", "shell", "fs-atomic.js"));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-smoke-"));
    const badFile = path.join(tmp, "bad.json");
    fs.writeFileSync(badFile, "{not valid", "utf8");
    assert.throws(() => readJson(badFile), /Invalid JSON/, "readJson throws clear error on bad JSON");
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- 5. a result path at a system dir is refused ----------------------------
  // Old: CoolWorkflowRunner.recordResult ran a /^\/(etc|bin|...)\// blacklist
  // and threw "Result path must not be a system directory". v2: recordResultRun
  // enforces the dispatched worker's sandbox boundary — a result path at
  // /etc/passwd is outside the readonly worker sandbox and is refused there.
  // Same intent (never accept a result written to a system dir), stronger guard.
  {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-path-guard-")));
    try {
      fs.writeFileSync(path.join(tmp, "README.md"), "# target\n", "utf8");
      const { runId, taskId } = dispatchOne(tmp, "path-guard-test");
      assert.throws(() => {
        recordResultRun({ runId, taskId, resultPath: "/etc/passwd", cwd: tmp });
      }, /outside sandbox profile|system director|Result file does not exist/, "result path to /etc rejected");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // ---- 6. runtime imports still valid -----------------------------------------
  // v2 module renames of the old flat/orchestrator paths:
  //   dist/candidate-scoring.js            -> dist/core/multi-agent/candidate-scoring.js
  //   dist/orchestrator/migration-operations.js -> dist/shell/state-cli.js (migration surface)
  //   dist/orchestrator/lifecycle-operations.js (recordResult) -> dist/shell/pipeline-cli.js (recordResultRun)
  {
    require(path.join(pluginRoot, "dist", "core", "multi-agent", "candidate-scoring.js"));
    const { migrationCheck } = require(path.join(pluginRoot, "dist", "shell", "state-cli.js"));
    assert.equal(typeof migrationCheck, "function", "state-cli exposes the migration surface");
    assert.equal(typeof recordResultRun, "function", "pipeline-cli exposes recordResultRun");
  }

  // ---- 7. the record/commit path enforces the resolvable evidence gate --------
  // Old: CoolWorkflowRunner.recordResult threw "does not resolve on disk" at
  // record time. v2: the gate moved to the verifier-gated commit
  // (commit-gate.ts). recordResultRun accepts the result + runs the verify
  // stage; commitRun --verifier then fires the resolvable-evidence gate. The
  // evidence resolves against the run cwd, so the present-evidence file lives
  // in `tmp` (the run cwd), NOT the worker dir. Intent preserved: unresolved
  // file evidence is refused, resolvable file evidence is accepted.
  {
    const previousRequireResolvable = process.env.CW_REQUIRE_RESOLVABLE_EVIDENCE;
    process.env.CW_REQUIRE_RESOLVABLE_EVIDENCE = "1";
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-direct-result-")));
    try {
      fs.writeFileSync(path.join(tmp, "README.md"), "# target\n", "utf8");

      // 7a. unresolved file evidence is refused at the verifier-gated commit.
      {
        const { runId, taskId, workerResultPath } = dispatchOne(tmp, "direct evidence unresolved");
        writeResultEnvelope(workerResultPath, ["missing-evidence.txt:1"]);
        recordResultRun({ runId, taskId, resultPath: workerResultPath, cwd: tmp });
        const run = loadRunFromCwd(runId, tmp);
        const task = run.tasks.find((t) => t.id === taskId);
        assert.throws(
          () => commitRun({ runId, cwd: tmp, verifier: task.verifierNodeId, reason: `result:${taskId}` }),
          /does not resolve on disk/,
          "verifier-gated commit refuses unresolved file evidence"
        );
      }

      // 7b. resolvable file evidence (present in the run cwd) is accepted.
      {
        fs.writeFileSync(path.join(tmp, "present-evidence.txt"), "ok\n", "utf8");
        const { runId, taskId, workerResultPath } = dispatchOne(tmp, "direct evidence resolvable");
        writeResultEnvelope(workerResultPath, ["present-evidence.txt:1"]);
        recordResultRun({ runId, taskId, resultPath: workerResultPath, cwd: tmp });
        const run = loadRunFromCwd(runId, tmp);
        const task = run.tasks.find((t) => t.id === taskId);
        assert.ok(task && task.status === "completed", "recordResultRun accepts resolvable evidence and completes the task");
        const committed = commitRun({ runId, cwd: tmp, verifier: task.verifierNodeId, reason: `result:${taskId}` });
        assert.ok(committed && committed.commit && committed.commit.id, "verifier-gated commit accepts resolvable file evidence");
      }
    } finally {
      if (previousRequireResolvable === undefined) delete process.env.CW_REQUIRE_RESOLVABLE_EVIDENCE;
      else process.env.CW_REQUIRE_RESOLVABLE_EVIDENCE = previousRequireResolvable;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

try {
  main();
  process.stdout.write("PASS  parse-hardening-round2-smoke.js\n");
} catch (e) {
  process.stderr.write(`FAIL  parse-hardening-round2-smoke.js — ${String(e && e.message || e)}\n`);
  process.exit(1);
}
