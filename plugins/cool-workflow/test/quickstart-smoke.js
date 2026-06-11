#!/usr/bin/env node
"use strict";

// quickstart-smoke (v0.1.38+) — the CI gate for the ONE-COMMAND quickstart.
//
// The quickstart is a THIN UX wrapper: plan(app) -> run --drive -> report in a
// single invocation. It composes the EXISTING drive() core + report writer; it
// adds NO second executor, queue, or scheduler, and imports NO model SDK. This
// suite proves the wrapper behaves exactly like that, and fails closed.
//
// Hermetic: a STUB agent (a tiny node child) stands in for `claude -p` / `codex
// exec`. No live agent binary, no network, no model SDK. Proves:
//   1. happy path: one command drives EVERY planned worker, commits, and writes
//      a report.md + state.json on disk (zero hand-written result.md, no copied
//      runId); the payload carries runId/workflowId/completedWorkers/reportPath;
//   2. FAIL CLOSED: an UNCONFIGURED agent blocks (status=blocked,
//      agentConfigured=false, completedWorkers=0, no commit) and never fabricates
//      a completion — the report is still written for triage;
//   3. --preview is a read-only, deterministic next-step projection (no mutation,
//      no commit, no agent spawn) and is byte-stable across two calls;
//   4. the default app is architecture-review when none is named;
//   5. the `audit-run` alias resolves to the same wrapper;
//   6. RED LINE: the wrapper delegates — it does not import a model SDK (covered
//      structurally by agent-delegation-drive-smoke; here we assert the wrapper
//      routes through runDrive, not a private executor).

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { quickstart, QUICKSTART_DEFAULT_APP } = require(path.join(pluginRoot, "dist/capability-core.js"));

const cleanups = [];
function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-quickstart-smoke-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  cleanups.push(work);
  return work;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
}

// A stub agent: argv[2]=resultPath. Writes a valid evidence-gated result.md and
// reports a model on stdout, exactly like the real agent contract.
function writeStub(file, model) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub section", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    `process.stdout.write(JSON.stringify({ model: ${JSON.stringify(model || "stub-quickstart-model")} }));`
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function main() {
  clearAgentEnv();
  const cwd0 = process.cwd();

  // ---- 1. happy path: ONE command -> full drive + commit + report on disk ----
  {
    const work = tmpWorkspace();
    const stub = writeStub(path.join(work, "stub.js"), "quickstart-opus");
    process.chdir(work);
    try {
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const result = quickstart(runner, {
        appId: "architecture-review",
        repo: work,
        question: "What are the architecture risks?",
        agentCommand: `${process.execPath} ${stub} {{result}}`
      });
      assert.equal(result.status, "complete", "one command drives the run to completion");
      assert.equal(result.appId, "architecture-review");
      assert.ok(result.runId, "payload carries a runId (no hand-copied id needed)");
      assert.equal(result.workflowId, "architecture-review", "payload carries workflowId");
      assert.ok(result.plannedWorkers > 0, "planned workers > 0");
      assert.equal(result.completedWorkers, result.plannedWorkers, "EVERY planned worker driven (count-agnostic)");
      assert.equal(result.parkedWorkers, 0, "no parked workers on the happy path");
      assert.ok(result.commitId, "the driven run is committed");
      assert.equal(result.agentConfigured, true, "agent backend reported configured");
      assert.ok(result.hint === undefined, "no hint on a clean completion");
      assert.ok(Array.isArray(result.steps) && result.steps.length > 0, "steps recorded verbatim from drive()");
      // report.md + state.json exist on disk.
      assert.ok(fs.existsSync(result.reportPath), `report.md written: ${result.reportPath}`);
      assert.ok(fs.existsSync(result.statePath), `state.json written: ${result.statePath}`);
      const report = fs.readFileSync(result.reportPath, "utf8");
      assert.ok(report.trim().length > 0, "report.md is non-empty");
      // the SAME drive committed it — cross-check against the run state.
      const run = runner.loadRun(result.runId);
      assert.ok(run.tasks.every((t) => t.status === "completed"), "all tasks completed in state");
      assert.ok((run.commits || []).some((c) => c.id === result.commitId), "the reported commit id is in the run state");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 2. FAIL CLOSED: unconfigured agent blocks, never fabricates -----------
  {
    const work = tmpWorkspace();
    process.chdir(work);
    try {
      clearAgentEnv();
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const result = quickstart(runner, { appId: "architecture-review", repo: work, question: "risks?" });
      assert.equal(result.status, "blocked", "unconfigured agent BLOCKS (fail closed)");
      assert.equal(result.agentConfigured, false, "agentConfigured=false reported");
      assert.equal(result.completedWorkers, 0, "no fabricated completion");
      assert.ok(!result.commitId, "no commit when nothing was driven");
      assert.ok(result.hint && /not configured/i.test(result.hint), "blocked hint explains the missing agent backend");
      assert.ok(/delegate/i.test(result.hint), "hint reaffirms the delegation boundary (red line)");
      // the report is STILL written for triage even on a fail-closed block.
      assert.ok(fs.existsSync(result.reportPath), "report.md still written on a fail-closed block");
      assert.ok(fs.existsSync(result.statePath), "state.json still written on a fail-closed block");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 3. --preview: read-only, deterministic, no mutation/commit/spawn ------
  {
    const work = tmpWorkspace();
    process.chdir(work);
    try {
      clearAgentEnv();
      const runner = new CoolWorkflowRunner({ pluginRoot });
      // Preview a FRESH app -> plans one run, projects its next step.
      const p1 = quickstart(runner, { appId: "architecture-review", repo: work, question: "risks?", preview: true });
      assert.equal(p1.nextAction, "blocked", "unconfigured -> next action is blocked");
      assert.equal(p1.agentConfigured, false);
      assert.equal(p1.completedWorkers, 0, "preview mutates nothing");
      assert.ok(p1.plannedWorkers > 0);
      // Re-previewing the SAME run is deterministic (counts derived from state; no
      // now-derived numeric field). A fresh-app preview only differs by the planned
      // runId, so we re-preview p1's run to assert the projection is byte-stable.
      const p2 = quickstart(runner, { repo: work, question: "risks?", preview: true, runId: p1.runId });
      assert.equal(JSON.stringify(p1), JSON.stringify(p2), "preview of the same run is deterministic (no now-derived numeric field)");
      for (const [k, v] of Object.entries(p1)) if (typeof v === "number") assert.ok(Number.isInteger(v), `${k} is an integer count`);
      // the preview's run was NOT driven: only the initial-plan checkpoint exists,
      // no agent-delegation-drive commit, and every task is still pending.
      const run = runner.loadRun(p1.runId);
      assert.ok(!(run.commits || []).some((c) => c.reason && c.reason.startsWith("agent-delegation-drive")), "preview did not drive/commit");
      assert.ok(run.tasks.every((t) => t.status === "pending"), "preview did not advance any task");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 4. default app is architecture-review when none is named --------------
  {
    const work = tmpWorkspace();
    process.chdir(work);
    try {
      clearAgentEnv();
      const runner = new CoolWorkflowRunner({ pluginRoot });
      const result = quickstart(runner, { repo: work, question: "risks?" });
      assert.equal(result.appId, QUICKSTART_DEFAULT_APP, "defaults to architecture-review");
      assert.equal(result.appId, "architecture-review");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 5. CLI `audit-run` alias resolves to the same wrapper ----------------
  // The alias is a CLI case token; assert it is declared so the parity gate holds
  // and that the dispatcher routes both tokens to quickstart().
  {
    const registry = require(path.join(pluginRoot, "dist/capability-registry.js"));
    const cap = registry.CAPABILITY_REGISTRY.find((c) => c.capability === "quickstart");
    assert.ok(cap, "quickstart capability is declared");
    assert.equal(cap.surface, "cli-only", "quickstart is a CLI-only UX convenience");
    assert.equal(cap.entry, "quickstart", "routes through the shared quickstart core entry");
    assert.deepEqual(cap.cli.caseTokens, ["quickstart", "audit-run"], "declares both case tokens (incl. the audit-run alias)");
    const cliSource = fs.readFileSync(path.join(pluginRoot, "dist/cli.js"), "utf8");
    assert.ok(/case "quickstart":/.test(cliSource), "cli dispatches quickstart");
    assert.ok(/case "audit-run":/.test(cliSource), "cli dispatches the audit-run alias");
  }

  // ---- 6. RED LINE: the wrapper has NO private executor (delegates only) -----
  // capability-core's quickstart must route through runDrive (the existing core),
  // not spawn a child or import a model SDK. Structurally: the only spawn path is
  // the agent backend, and there is no model-SDK import in capability-core.
  {
    const coreSrc = fs.readFileSync(path.join(pluginRoot, "src/capability-core.ts"), "utf8");
    assert.ok(/runDrive\(runner,/.test(coreSrc), "quickstart composes the existing runDrive core");
    const SDK_PKGS = ["@anthropic-ai", "openai", "@google/generative-ai", "ollama", "cohere", "mistralai"];
    for (const sdk of SDK_PKGS) assert.ok(!coreSrc.includes(sdk), `capability-core must not import a model SDK: ${sdk}`);
    assert.ok(!/child_process|spawn\(|execFile/.test(coreSrc), "quickstart does not spawn its own executor (delegation goes through the agent backend)");
  }

  // ---- 7. README headline shape: REAL CLI, cross-directory (regression) -----
  // v0.1.77 shipped with the README's one command broken when invoked from the
  // plugin dir with --repo elsewhere: runDrive planned the run into the TARGET
  // repo's .cw, restored cwd, and quickstart's post-drive loadRun then resolved
  // the runs root against the PLUGIN dir → "File not found", orphaned run. The
  // in-process sections above never caught it because they chdir into the
  // workspace first. This section invokes the actual CLI binary the README
  // documents, from the plugin dir, with a clean env (no agent configured), and
  // requires the DOCUMENTED fail-closed payload.
  {
    clearAgentEnv();
    const work = tmpWorkspace();
    const env = { ...process.env };
    for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete env[v];
    const child = spawnSync(
      process.execPath,
      [path.join(pluginRoot, "scripts", "cw.js"), "quickstart", "architecture-review", "--repo", work, "--question", "risks?"],
      { cwd: pluginRoot, env, encoding: "utf8", timeout: 60000 }
    );
    assert.equal(child.status, 0, `README quickstart shape exits 0 (stderr: ${String(child.stderr || "").slice(0, 200)})`);
    const payload = JSON.parse(String(child.stdout || ""));
    assert.equal(payload.status, "blocked", "unconfigured agent fails closed through the real CLI");
    assert.equal(payload.agentConfigured, false, "payload says agent not configured");
    assert.ok(String(payload.reportPath || "").startsWith(work), "report written under the TARGET repo, not the plugin dir");
    assert.ok(fs.existsSync(payload.reportPath), "triage report exists on disk");
    assert.ok(String(payload.statePath || "").startsWith(work), "run state lives under the target repo");
    assert.ok(!fs.existsSync(path.join(pluginRoot, ".cw", "runs")), "no orphaned run under the plugin dir");
    console.log("quickstart: README cross-directory CLI shape fails closed with the documented payload ok");
  }

  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(
    "quickstart-smoke: ok (one command plans+drives+reports; fail-closed on unconfigured agent; deterministic --preview; default app + audit-run alias; delegates, no private executor; README cross-directory CLI shape)\n"
  );
}

main();
