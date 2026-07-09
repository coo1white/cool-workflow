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
//      routes through the drive() core, not a private executor).
//
// ============================================================================
// V2 CUTOVER NOTE (rewrite audit) — this smoke is a REAL-GAP marker.
//
// Imports repointed to v2's dist layout:
//   dist/orchestrator.js CoolWorkflowRunner ........ REMOVED in v2 (no facade).
//     v2's quickstart core takes a plain `args` object, not a runner. Run state
//     is read with loadRunFromCwd(runId, cwd) from dist/shell/run-store.js.
//   dist/capability-core.js quickstart/QUICKSTART_DEFAULT_APP
//     -> dist/shell/pipeline-cli.js quickstartRun (QUICKSTART_DEFAULT_APP is now
//        a private const; "architecture-review" is asserted by value).
//   dist/capability-registry.js CAPABILITY_REGISTRY
//     -> dist/core/capability-table.js REGISTRY.
//   src/capability-core.ts -> src/shell/pipeline-cli.ts (the quickstart core).
//
// v2's quickstartRun(args) (src/shell/pipeline-cli.ts:202) is a STRIPPED-DOWN
// composition. It handles plan -> drive -> report and `--check`, but DROPPED
// several user-facing behaviors the old build (src/capability-core.ts
// quickstart()) had and that this suite verifies. These are genuine gaps, not
// import breakage — the assertions below are left INTACT (not weakened) so the
// gaps stay visible:
//
//   * SECTION 2  — `hint` on a fail-closed block. v2 DriveResult has no `hint`
//                  field at all (src/shell/drive.ts:77-90). The old build set a
//                  "not configured … delegates" hint (old capability-core.ts:792).
//   * SECTION 1b — `--resume` single-step advance + copy-paste continue `hint`
//                  + `resumedFrom` echo. v2 quickstartRun never maps resume->once
//                  and never stamps resumedFrom (src/shell/pipeline-cli.ts:202-232).
//   * SECTION 3  — `--preview` read-only next-step projection. v2 quickstartRun
//                  ignores args.preview and DRIVES instead of returning the
//                  drivePreview() shape (nextAction/pendingWorkers). It only
//                  branches on `--check` (src/shell/pipeline-cli.ts:207).
//                  Note: the capability-table help text still ADVERTISES
//                  "--preview for a read-only dry run"
//                  (src/core/capability-table.ts:1064) — surface documented,
//                  behavior missing.
//   * SECTION 5  — the `audit-run` alias. v2 has NO capability-table row and NO
//                  dispatch arm for it; it is only a KNOWN_COMMANDS token
//                  (src/cli/parseargv.ts:123), so `cw audit-run …` returns
//                  "Unknown command: audit-run" (absurdly "Did you mean:
//                  audit-run?"). REGISTRY rows also no longer carry `entry` or
//                  `cli.caseTokens`, and the CLI is capability-table-driven so
//                  there are no `case "quickstart":`/`case "audit-run":` strings.
//
// Cleanly-portable sections (1, 1c, 4, 6, 7) ARE adapted to v2 and pass.
// ============================================================================

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { quickstartRun } = require(path.join(pluginRoot, "dist/shell/pipeline-cli.js"));
const { loadRunFromCwd } = require(path.join(pluginRoot, "dist/shell/run-store.js"));
// v2: QUICKSTART_DEFAULT_APP is a private module const; its value is the
// contract asserted here.
const QUICKSTART_DEFAULT_APP = "architecture-review";

const FAST_APP = "architecture-review-fast";
const GOLDEN_APP = "end-to-end-golden-path";

const cleanups = [];
function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-quickstart-smoke-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  cleanups.push(work);
  return work;
}
function clearAgentEnv() {
  for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
  process.env.CW_NO_AUTO_AGENT = "1";
}

// v2: run state is read directly from the run's repo cwd (no runner facade).
function loadRunAt(runId, cwd) {
  return loadRunFromCwd(runId, cwd);
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

async function main() {
  clearAgentEnv();
  const cwd0 = process.cwd();

  // ---- 1. happy path: ONE command -> full drive + commit + report on disk ----
  {
    const work = tmpWorkspace();
    const stub = writeStub(path.join(work, "stub.js"), "quickstart-opus");
    process.chdir(work);
    try {
      const result = await quickstartRun({
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
      // v2 DriveResult has no `hint` field; a clean completion carries no hint.
      assert.ok(result.hint === undefined, "no hint on a clean completion");
      assert.ok(Array.isArray(result.steps) && result.steps.length > 0, "steps recorded verbatim from drive()");
      // report.md + state.json exist on disk.
      assert.ok(fs.existsSync(result.reportPath), `report.md written: ${result.reportPath}`);
      assert.ok(fs.existsSync(result.statePath), `state.json written: ${result.statePath}`);
      const report = fs.readFileSync(result.reportPath, "utf8");
      assert.ok(report.trim().length > 0, "report.md is non-empty");
      // the SAME drive committed it — cross-check against the run state.
      const run = loadRunAt(result.runId, work);
      assert.ok(run.tasks.every((t) => t.status === "completed"), "all tasks completed in state");
      assert.ok((run.commits || []).some((c) => c.id === result.commitId), "the reported commit id is in the run state");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 1b. --resume: guided stop-then-resume a newcomer can WITNESS (Track A) -
  // REAL-GAP: v2 quickstartRun (src/shell/pipeline-cli.ts:202-232) does NOT
  // implement the --resume single-step behavior. It never maps resume->once, so
  // `resume:true` drives the WHOLE run to completion instead of advancing one
  // step, never emits a copy-paste `--resume` continue `hint`, and never stamps
  // `resumedFrom`. Assertions kept intact so the gap stays visible.
  {
    const work = tmpWorkspace();
    const stub = writeStub(path.join(work, "stub.js"), "quickstart-opus");
    process.chdir(work);
    try {
      const agentCommand = `${process.execPath} ${stub} {{result}}`;
      // (a) --resume, no --run: advance exactly ONE step and print a continue line.
      const step1 = await quickstartRun({ appId: FAST_APP, repo: work, question: "risks?", agentCommand, resume: true });
      assert.equal(step1.status, "in-progress", "--resume advances one step, not the whole drive");
      assert.ok(step1.completedWorkers < step1.plannedWorkers, "one resume step leaves work pending");
      assert.ok(!step1.commitId, "an in-progress resume step has not committed");
      assert.equal(Object.prototype.hasOwnProperty.call(step1, "resumedFrom"), false, "a fresh resume step carries no resumedFrom");
      assert.ok(step1.hint && /--run .* --resume/.test(step1.hint), "hint is a copy-pasteable --resume continue line");
      assert.ok(!/--once/.test(step1.hint), "the resume hint uses --resume, not --once");
      // (b) --resume --run <id>: continue THAT run to completion.
      const done = await quickstartRun({ appId: FAST_APP, repo: work, question: "risks?", agentCommand, resume: true, run: step1.runId });
      assert.equal(done.runId, step1.runId, "resume --run continues the SAME run");
      assert.equal(done.status, "complete", "resume --run drives to completion");
      assert.equal(done.completedWorkers, done.plannedWorkers, "all workers completed after resume");
      assert.ok(done.commitId, "the resumed run is committed");
      assert.equal(done.resumedFrom, step1.runId, "resumedFrom echoes the continued run id");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 1c. POLA: default quickstart output is byte-identical (no resumedFrom) --
  {
    const work = tmpWorkspace();
    const stub = writeStub(path.join(work, "stub.js"), "quickstart-opus");
    process.chdir(work);
    try {
      const result = await quickstartRun({ appId: GOLDEN_APP, repo: work, question: "risks?", agentCommand: `${process.execPath} ${stub} {{result}}` });
      assert.equal(Object.prototype.hasOwnProperty.call(result, "resumedFrom"), false, "default (no --resume) output has no resumedFrom key");
      assert.ok(result.hint === undefined, "clean default completion still has no hint (unchanged wording)");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 1d. FAIL CLOSED under --resume: unconfigured agent never fabricates ----
  {
    const work = tmpWorkspace();
    process.chdir(work);
    try {
      const blocked = await quickstartRun({ appId: FAST_APP, repo: work, question: "risks?", resume: true });
      assert.notEqual(blocked.status, "complete", "--resume with no agent never reports complete");
      assert.equal(blocked.completedWorkers, 0, "no fabricated completion under --resume");
      assert.equal(Object.prototype.hasOwnProperty.call(blocked, "resumedFrom"), false, "blocked fresh resume carries no resumedFrom");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 2. FAIL CLOSED: unconfigured agent blocks, never fabricates -----------
  // REAL-GAP: the block itself works (status=blocked, agentConfigured=false,
  // completedWorkers=0, no commit, report+state still written), but v2
  // DriveResult (src/shell/drive.ts:77-90) has NO `hint` field, so the
  // "not configured / delegate" triage hint the old build attached
  // (old capability-core.ts:792) is gone. Assertions kept intact.
  {
    const work = tmpWorkspace();
    process.chdir(work);
    try {
      clearAgentEnv();
      const result = await quickstartRun({ appId: "architecture-review", repo: work, question: "risks?" });
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
  // REAL-GAP: v2 quickstartRun ignores args.preview (src/shell/pipeline-cli.ts:207
  // branches only on `--check`) and DRIVES the run, returning a DriveResult
  // (no nextAction / pendingWorkers projection) instead of the deterministic
  // drivePreview() shape. The read-only next-step dry run is unimplemented in
  // the quickstart wrapper even though the help text advertises it
  // (src/core/capability-table.ts:1064). Assertions kept intact.
  {
    const work = tmpWorkspace();
    process.chdir(work);
    try {
      clearAgentEnv();
      // Preview a FRESH app -> plans one run, projects its next step.
      const p1 = await quickstartRun({ appId: "architecture-review", repo: work, question: "risks?", preview: true });
      assert.equal(p1.nextAction, "blocked", "unconfigured -> next action is blocked");
      assert.equal(p1.agentConfigured, false);
      assert.equal(p1.completedWorkers, 0, "preview mutates nothing");
      assert.ok(p1.plannedWorkers > 0);
      // Re-previewing the SAME run is deterministic (counts derived from state; no
      // now-derived numeric field). A fresh-app preview only differs by the planned
      // runId, so we re-preview p1's run to assert the projection is byte-stable.
      const p2 = await quickstartRun({ repo: work, question: "risks?", preview: true, runId: p1.runId });
      assert.equal(JSON.stringify(p1), JSON.stringify(p2), "preview of the same run is deterministic (no now-derived numeric field)");
      for (const [k, v] of Object.entries(p1)) if (typeof v === "number") assert.ok(Number.isInteger(v), `${k} is an integer count`);
      // the preview's run was NOT driven: only the initial-plan checkpoint exists,
      // no agent-delegation-drive commit, and every task is still pending.
      const run = loadRunAt(p1.runId, work);
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
      const result = await quickstartRun({ repo: work, question: "risks?" });
      assert.equal(result.appId, QUICKSTART_DEFAULT_APP, "defaults to architecture-review");
      assert.equal(result.appId, "architecture-review");
    } finally {
      process.chdir(cwd0);
    }
  }

  // ---- 5. CLI `audit-run` alias resolves to the same wrapper ----------------
  // NO-EQUIVALENT (source-text half only): the old build dispatched through a
  // switch statement, so a real smoke could grep dist/cli.js for literal
  // `case "quickstart":` / `case "audit-run":` strings. v2's CLI is
  // capability-table-driven (dist/cli.js is a tiny shim; dispatch goes through
  // findCapabilityByCliPath -> dispatchTable), so there is no switch arm to
  // grep for -- that implementation detail is gone by design, not dropped
  // behavior. The alias itself (declared entry/caseTokens, and the actual
  // dispatch resolution) is fully present, so check the BEHAVIOR instead of
  // the old switch-arm text: both tokens resolve through the capability
  // table to the same quickstart capability row.
  {
    const { REGISTRY, findCapabilityByCliPath } = require(path.join(pluginRoot, "dist/core/capability-table.js"));
    const cap = REGISTRY.find((c) => c.capability === "quickstart");
    assert.ok(cap, "quickstart capability is declared");
    assert.equal(cap.surface, "cli-only", "quickstart is a CLI-only UX convenience");
    assert.equal(cap.entry, "quickstart", "routes through the shared quickstart core entry");
    assert.deepEqual(cap.cli.caseTokens, ["quickstart", "audit-run"], "declares both case tokens (incl. the audit-run alias)");
    const quickstartMatch = findCapabilityByCliPath(["quickstart"]);
    const auditRunMatch = findCapabilityByCliPath(["audit-run"]);
    assert.ok(quickstartMatch, "cli dispatch resolves quickstart to a capability");
    assert.ok(auditRunMatch, "cli dispatch resolves the audit-run alias to a capability");
    assert.equal(quickstartMatch.capability, "quickstart", "quickstart token routes to the quickstart capability");
    assert.equal(auditRunMatch.capability, "quickstart", "audit-run alias routes to the SAME quickstart capability");
  }

  // ---- 6. RED LINE: the wrapper has NO private executor (delegates only) -----
  // The quickstart core must route through the existing drive() core (v2:
  // driveAsync(run.id, run.cwd, …) in src/shell/pipeline-cli.ts — the old
  // build's runDrive(runner, …)), not spawn a child or import a model SDK.
  // driveAsync (not the plain synchronous drive()) is what a live multi-round
  // quickstart run actually calls, so it responds to Ctrl-C/SIGTERM instead of
  // silently ignoring it (shell/drive.ts) — it shares every other line of
  // drive()'s own logic, so this is still the SAME shared core, not a second
  // implementation. Structurally: the only spawn path is the agent backend,
  // and there is no model-SDK import in the quickstart core.
  {
    const coreSrc = fs.readFileSync(path.join(pluginRoot, "src/shell/pipeline-cli.ts"), "utf8");
    assert.ok(/driveAsync\(run\.id, run\.cwd/.test(coreSrc), "quickstart composes the existing drive() core (via driveAsync)");
    const SDK_PKGS = ["@anthropic-ai", "openai", "@google/generative-ai", "ollama", "cohere", "mistralai"];
    for (const sdk of SDK_PKGS) assert.ok(!coreSrc.includes(sdk), `quickstart core must not import a model SDK: ${sdk}`);
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

  // ---- 8. interactive TTY prompt for a missing --question -------------------
  // SPEC/cli-surface.md:34,502 (old-build ground truth): quickstart/audit-run
  // with no --question ON A TTY asks "Question: " on stderr and waits; a
  // blank answer leaves `question` unset. The conformance harness spawns
  // every case piped (no TTY) by design and cannot exercise this, so it is
  // tested here in-process instead, by swapping process.stdin for a fake
  // Readable with isTTY:true — quickstartRun() only checks
  // process.stdin.isTTY, so this exercises the REAL prompt/readline code
  // path (shell/pipeline-cli.ts's promptForQuestion), not a stand-in.
  {
    const { Readable } = require("node:stream");
    const originalStdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
    function withFakeTty(answerLine) {
      const fake = new Readable({ read() {} });
      fake.isTTY = true;
      Object.defineProperty(process, "stdin", { value: fake, configurable: true });
      setTimeout(() => fake.push(`${answerLine}\n`), 20);
      return () => Object.defineProperty(process, "stdin", originalStdinDescriptor);
    }

    // (a) a real answer typed at the prompt flows through to run.inputs.question.
    {
      const work = tmpWorkspace();
      const stub = writeStub(path.join(work, "stub.js"), "quickstart-opus");
      process.chdir(work);
      const restore = withFakeTty("what are the interactive-prompt risks?");
      try {
        const result = await quickstartRun({
          appId: GOLDEN_APP,
          repo: work,
          agentCommand: `${process.execPath} ${stub} {{result}}`
        });
        assert.equal(result.status, "complete", "TTY-prompted question still drives to completion");
        const run = loadRunAt(result.runId, work);
        assert.equal(run.inputs.question, "what are the interactive-prompt risks?", "the typed answer reached run.inputs.question");
      } finally {
        restore();
        process.chdir(cwd0);
      }
    }

    // (b) a blank answer (bare Enter) leaves question unset, so the SAME
    // "Missing required input: question" fail-closed error fires as when
    // --question was never passed at all (piped or TTY).
    {
      const work = tmpWorkspace();
      process.chdir(work);
      const restore = withFakeTty("");
      try {
        await assert.rejects(
          quickstartRun({ appId: GOLDEN_APP, repo: work }),
          /Missing required input: question/,
          "a blank TTY answer still fails closed, same message as the piped path"
        );
      } finally {
        restore();
        process.chdir(cwd0);
      }
    }

    // (c) REGRESSION GUARD: --preview --run <id> and --resume --run <id>
    // must NEVER prompt, even on a TTY with no --question — an existing
    // run id skips plan() entirely (both the --preview branch's own
    // `if (!previewRunId)` and the main path's `if (existingRunId) {...}
    // else { plan(...) }` agree on this), so a question is never needed.
    // A caught-then-fixed bug on this cycle had the prompt gate fire
    // BEFORE these branches, so a TTY session invoking either would hang
    // forever waiting for input neither needs. Nothing is ever pushed to
    // the fake stdin here — if the regression came back, quickstartRun
    // would hang on rl.question() forever, so this races against a short
    // timeout instead of actually hanging the suite. A bogus run id is
    // enough: loadRunFromCwd's fail-closed "Run not found" (immediate, not
    // a hang) is proof the prompt was skipped and control reached the
    // run-lookup, not evidence about the id itself.
    function withTimeout(promise, ms, onTimeoutMessage) {
      let timer;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(onTimeoutMessage)), ms);
      });
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }
    {
      const work = tmpWorkspace();
      process.chdir(work);
      const fake = new Readable({ read() {} });
      fake.isTTY = true;
      Object.defineProperty(process, "stdin", { value: fake, configurable: true });
      try {
        await assert.rejects(
          withTimeout(
            quickstartRun({ appId: GOLDEN_APP, repo: work, preview: true, run: "no-such-run" }),
            2000,
            "quickstart --preview --run <id> blocked on stdin instead of failing closed (regression)"
          ),
          /Run not found: no-such-run/,
          "--preview --run <id> never prompts; fails closed on the bogus id immediately"
        );
        await assert.rejects(
          withTimeout(
            quickstartRun({ appId: GOLDEN_APP, repo: work, resume: true, run: "no-such-run" }),
            2000,
            "quickstart --resume --run <id> blocked on stdin instead of failing closed (regression)"
          ),
          /Run not found: no-such-run/,
          "--resume --run <id> never prompts; fails closed on the bogus id immediately"
        );
      } finally {
        Object.defineProperty(process, "stdin", originalStdinDescriptor);
        process.chdir(cwd0);
      }
    }
    console.log("quickstart: TTY prompt fills --question; blank answer still fails closed; --preview/--resume --run <id> never prompt ok");
  }

  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(
    "quickstart-smoke: ok (one command plans+drives+reports; fail-closed on unconfigured agent; deterministic --preview; default app + audit-run alias; delegates, no private executor; README cross-directory CLI shape; TTY question prompt)\n"
  );
}

main().catch((e) => {
  process.stderr.write(`FAIL  quickstart-smoke.js — ${String((e && e.message) || e)}\n`);
  process.exit(1);
});
