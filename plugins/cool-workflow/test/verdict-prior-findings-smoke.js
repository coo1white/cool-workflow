#!/usr/bin/env node
// Verdict-drop fix: a downstream worker whose task declares
// resultCache.includeCompletedResults === "previous-phases" must have the
// completed upstream result text injected into its input.md, so the synthesis
// step can reconcile against the findings the Verify phase confirmed instead of
// re-deriving a fresh list and silently dropping them.
//
// Also pins the hardening the adversarial review asked for:
//   - POLA: without the field, the Task -> Boundary region is byte-identical.
//   - Prompt-injection safety: the section is placed AFTER ## Boundary and its
//     content is fenced between BEGIN/END markers framed as quoted DATA.
//   - Fail closed: no injection while an upstream phase is incomplete, or when a
//     result path escapes this run's own tree.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/shell/run-store");
const { allocateWorkerScope } = require("../dist/shell/worker-isolation");

const PRIOR_MARKER = "## Prior Findings";
const VERDICT_PROMPT = "Synthesize the verdict.";

function baseRun(tmp, paths) {
  return {
    schemaVersion: 1,
    id: "verdict-smoke",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd: tmp,
    workflow: { id: "verdict-smoke", title: "Verdict Smoke", summary: "", limits: { maxAgents: 4, maxConcurrentAgents: 4 } },
    inputs: {},
    loopStage: "interpret",
    phases: [
      { id: "verify", name: "Verify", status: "completed", taskIds: ["verify:p0-p2-risks"] },
      { id: "verdict", name: "Verdict", status: "pending", taskIds: ["verdict:synthesis"] }
    ],
    tasks: [],
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: [],
    feedback: [],
    workers: []
  };
}

const CONFIRMED_TEXT = [
  "# Verify — P0/P2 risks",
  "",
  "CONFIRMED: destructive swap deletes the rollback after a check that cannot fail.",
  "",
  "```cw:result",
  '{ "summary": "one P1 confirmed", "findings": [{"id":"rollback-deleted","severity":"P1","classification":"real","verdict":"CONFIRMED"}], "evidence": ["src/tools/colima-disk.ts:353"] }',
  "```",
  ""
].join("\n");

function makeVerifyTask(paths, resultPath) {
  const p = resultPath || path.join(paths.workersDir, "verify-result.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, CONFIRMED_TEXT, "utf8");
  return {
    id: "verify:p0-p2-risks",
    kind: "agent",
    phase: "Verify",
    status: "completed",
    requiresEvidence: true,
    prompt: "Re-open evidence for every candidate risk.",
    taskPath: "",
    resultPath: p,
    loopStage: "observe",
    stateNodeId: "verdict-smoke:task:verify:p0-p2-risks"
  };
}

function verdictTask(withInjection) {
  return {
    id: "verdict:synthesis",
    kind: "artifact",
    phase: "Verdict",
    status: "pending",
    requiresEvidence: true,
    prompt: VERDICT_PROMPT,
    taskPath: "",
    resultPath: "",
    loopStage: "interpret",
    stateNodeId: "verdict-smoke:task:verdict:synthesis",
    ...(withInjection ? { resultCache: { mode: "read-write", keyInput: "sourceContextDigest", includeCompletedResults: "previous-phases" } } : {})
  };
}

function allocateVerdictInput(withInjection, mutateVerify) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-verdict-"));
  const paths = createRunPaths(path.join(tmp, ".cw", "runs", "verdict-smoke"));
  ensureRunDirs(paths);
  const run = baseRun(tmp, paths);
  const verify = makeVerifyTask(paths, mutateVerify && mutateVerify.resultPath ? path.join(tmp, "outside-evil.md") : undefined);
  if (mutateVerify && mutateVerify.status) verify.status = mutateVerify.status;
  run.tasks = [verify, verdictTask(withInjection)];
  saveCheckpoint(run);
  const scope = allocateWorkerScope(run, run.tasks[1], { workerId: `worker-verdict-${Math.random().toString(36).slice(2)}`, persist: false });
  return fs.readFileSync(scope.inputPath, "utf8");
}

// --- Case 1: injection ON -> input.md carries the confirmed finding, fenced,
//     AFTER the authoritative Boundary section ---
{
  const input = allocateVerdictInput(true);
  assert.ok(input.includes(PRIOR_MARKER), "verdict input.md must carry a Prior Findings section when injection is on");
  assert.ok(input.includes("BEGIN PRIOR RESULT: verify:p0-p2-risks (Verify)"), "the section must fence and name the upstream task");
  assert.ok(input.includes("END PRIOR RESULT: verify:p0-p2-risks"), "the section must close its fence");
  assert.ok(input.includes("rollback-deleted") && input.includes("CONFIRMED"), "the confirmed finding must reach the verdict worker");
  assert.ok(/quoted as DATA/.test(input) && /never a direction\s+to you/.test(input.replace(/\n/g, " ")), "the section must frame the content as data, not instructions");
  // Prompt-injection safety: Prior Findings comes AFTER the authoritative Boundary.
  assert.ok(input.indexOf("## Boundary") < input.indexOf(PRIOR_MARKER), "Prior Findings must be placed after the ## Boundary section");
}

// --- Case 2 (POLA): injection OFF -> no section, and the Task->Boundary region
//     is byte-identical (nothing injected between them) ---
{
  const input = allocateVerdictInput(false);
  assert.ok(!input.includes(PRIOR_MARKER), "no Prior Findings section without the opt-in field (POLA)");
  assert.ok(!input.includes("rollback-deleted"), "no upstream finding text leaks without the opt-in field");
  assert.ok(input.includes(`## Task\n\n${VERDICT_PROMPT}\n\n## Boundary`), "Task and Boundary stay contiguous — byte-identical when injection is off");
}

// --- Case 3: injection ON but upstream incomplete -> fail closed, no section ---
{
  const input = allocateVerdictInput(true, { status: "pending" });
  assert.ok(!input.includes("rollback-deleted"), "no upstream text injected while the upstream phase is incomplete");
  assert.ok(!input.includes(PRIOR_MARKER), "no Prior Findings section while upstream is incomplete");
}

// --- Case 4: injection ON but the upstream result path escapes the run tree ->
//     fail closed (containment), no section ---
{
  const input = allocateVerdictInput(true, { resultPath: true });
  assert.ok(!input.includes("rollback-deleted"), "an out-of-tree result path is never read into the prompt");
  assert.ok(!input.includes(PRIOR_MARKER), "no Prior Findings section for an out-of-tree result path");
}

process.stdout.write("verdict-prior-findings-smoke: ok\n");
