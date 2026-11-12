#!/usr/bin/env node
// report-answer-smoke — report.md leads with a `## Answer` section, right
// after the header bullets and before `## Phase Status`, whenever the run
// has a COMPLETED verdict/synthesis task with a readable result file and a
// non-empty summary (report.ts's renderAnswer). No such task, no result
// file, or an empty summary means no `## Answer` section at all — the
// report stays byte-identical to before renderAnswer existed.
//
// Black box through scripts/cw.js, with a stub agent that writes a valid
// result at once (same approach as quickstart-fast-smoke.mjs).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const work = tmpDir("cw-report-answer-");

const agent = path.join(work, "agent.js");
fs.writeFileSync(
  agent,
  [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const body = '# R\\n\\n' + fence + 'cw:result\\n' + JSON.stringify({ summary: 'stub answer', findings: [], evidence: ['README.md:1'] }) + '\\n' + fence + '\\n';",
    "fs.writeFileSync(process.argv[3], body);",
    "process.stdout.write(JSON.stringify({ model: 'stub-answer' }));",
  ].join("\n"),
  "utf8"
);

function repo(name) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "README.md"), "# target\n", "utf8");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function cw(args, cwd, extraEnv = {}) {
  const env = { ...process.env, CW_AGENT_COMMAND: `node ${agent} {{input}} {{result}}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1", ...extraEnv };
  delete env.CW_AGENT_ENDPOINT;
  delete env.CW_AGENT_STREAM;
  return spawnSync(process.execPath, [cwBin, ...args], { cwd, env, encoding: "utf8", timeout: 120000 });
}

function json(child, label) {
  assert.equal(child.status, 0, `${label} exits 0 (stderr: ${child.stderr})`);
  return JSON.parse(child.stdout);
}

function readReport(reportPath) {
  return fs.readFileSync(reportPath, "utf8");
}

const VERDICT_TASK_ID = "verdict:synthesis";
const EXPECTED_ANSWER_BLOCK =
  "## Answer\n\nstub answer\n\nEvidence:\n\n- README.md:1\n\nFull result: ## Results, ### verdict:synthesis\n\n";

try {
  // a. `cw -q "q" --json` -> a completed verdict:synthesis task
  // with a readable result and a non-empty summary+evidence: `## Answer`
  // appears exactly once, right after the Verdict line and before
  // `## Phase Status`, with the exact rendered block, and `## Results`
  // still carries the full result under its own `### <taskId>` heading.
  {
    const dir = repo("a-fast");
    const r = json(cw(["-q", "q", "--json"], dir), "cw -q --json");
    assert.equal(r.status, "complete", "the app drives to completion");

    const report = readReport(r.reportPath);
    const answerMatches = report.match(/## Answer\n/g) || [];
    assert.equal(answerMatches.length, 1, "## Answer appears exactly once");

    const verdictIdx = report.indexOf("- Verdict: ");
    const answerIdx = report.indexOf("## Answer");
    const phaseIdx = report.indexOf("## Phase Status");
    assert.ok(verdictIdx !== -1 && answerIdx !== -1 && phaseIdx !== -1, "all three anchors are present");
    assert.ok(verdictIdx < answerIdx, "## Answer comes after the Verdict line");
    assert.ok(answerIdx < phaseIdx, "## Answer comes before ## Phase Status");

    const between = report.slice(answerIdx, phaseIdx);
    assert.equal(between, EXPECTED_ANSWER_BLOCK, "the ## Answer block is rendered exactly");

    assert.match(report, /### verdict:synthesis\n\nResult: /, "## Results still carries the verdict task's own section");

    console.log("report-answer: ## Answer renders exactly once, in place, for a completed verdict task ok");

    // c. Delete the verdict task's result file, then `cw report <runId>`
    // from the repo dir: no fabricated ## Answer.
    {
      const state = JSON.parse(fs.readFileSync(r.statePath, "utf8"));
      const verdictTask = state.tasks.find((t) => t.id === VERDICT_TASK_ID);
      assert.ok(verdictTask && verdictTask.resultPath, "the verdict task carries a resultPath");
      fs.rmSync(verdictTask.resultPath);

      const reReported = cw(["report", r.runId], dir);
      assert.equal(reReported.status, 0, `cw report exits 0 (stderr: ${reReported.stderr})`);
      const reportAfterDelete = readReport(r.reportPath);
      assert.doesNotMatch(reportAfterDelete, /## Answer/, "no result file on disk -> no ## Answer section");
      console.log("report-answer: a missing result file drops ## Answer (no fabricated answer) ok");
    }
  }

  // d. A verdict result with NO evidence: ## Answer keeps the summary and
  // the "Full result:" pointer, but no "Evidence:" line. Written directly
  // (not through the stub agent) so the body carries no incidental
  // file:line-shaped tokens for normalizeResultEnvelope to harvest.
  {
    const dir = repo("d-no-evidence");
    const r = json(cw(["-q", "q", "--json"], dir), "cw -q --json (fresh run for case d)");
    assert.equal(r.status, "complete");

    const state = JSON.parse(fs.readFileSync(r.statePath, "utf8"));
    const verdictTask = state.tasks.find((t) => t.id === VERDICT_TASK_ID);
    assert.ok(verdictTask && verdictTask.resultPath, "the verdict task carries a resultPath");
    const noEvidenceBody = "# R\n\n```cw:result\n" + JSON.stringify({ summary: "stub answer no evidence", findings: [], evidence: [] }) + "\n```\n";
    fs.writeFileSync(verdictTask.resultPath, noEvidenceBody, "utf8");

    const reReported = cw(["report", r.runId], dir);
    assert.equal(reReported.status, 0, `cw report exits 0 (stderr: ${reReported.stderr})`);
    const report = readReport(r.reportPath);

    const answerIdx = report.indexOf("## Answer");
    const phaseIdx = report.indexOf("## Phase Status");
    assert.ok(answerIdx !== -1 && phaseIdx !== -1);
    const between = report.slice(answerIdx, phaseIdx);
    assert.equal(
      between,
      "## Answer\n\nstub answer no evidence\n\nFull result: ## Results, ### verdict:synthesis\n\n",
      "no Evidence: line when evidence is empty and nothing grounded is harvested from the body"
    );
    assert.doesNotMatch(between, /Evidence:/, "no Evidence: line at all");
    console.log("report-answer: empty evidence drops the Evidence: line but keeps the summary+pointer ok");
  }

  // b. A run whose verdict task never completed (no agent: the drive
  // stops before any worker runs): no ## Answer section anywhere, and the
  // line right after the Verdict line + blank line is ## Phase Status.
  {
    const dir = repo("b-no-verdict");
    const child = cw(["-q", "q", "--json"], dir, { CW_AGENT_COMMAND: "" });
    assert.equal(child.status, 2, `a run with no agent stops short (exit 2): ${child.stderr}`);
    const r = JSON.parse(child.stdout);
    assert.equal(r.status, "blocked");

    const report = readReport(r.reportPath);
    assert.doesNotMatch(report, /## Answer/, "no completed verdict task -> no ## Answer section");
    assert.match(report, /\n\n## Phase Status/, "the Verdict line's blank line is followed straight by ## Phase Status");
    console.log("report-answer: a run with no completed verdict task gets no ## Answer section ok");
  }

  console.log("report-answer-smoke: ok");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
