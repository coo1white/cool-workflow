#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createRunPaths, ensureRunDirs, loadRunFromCwd, saveCheckpoint } = require("../dist/state");
const { appendRunNode, createStateNode } = require("../dist/state-node");
const {
  registerCandidate,
  listCandidates,
  scoreCandidate,
  rankCandidates,
  selectCandidate,
  rejectCandidate,
  summarizeCandidates
} = require("../dist/candidate-scoring");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-candidate-scoring-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "candidate-smoke"));
ensureRunDirs(paths);

const resultPath = path.join(paths.resultsDir, "worker-result.md");
fs.writeFileSync(resultPath, "candidate result\n", "utf8");

const run = {
  schemaVersion: 1,
  id: "candidate-smoke",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: {
    id: "candidate-smoke",
    title: "Candidate Smoke",
    summary: "",
    limits: { maxAgents: 2, maxConcurrentAgents: 2 }
  },
  inputs: {},
  loopStage: "interpret",
  phases: [],
  tasks: [
    {
      id: "map:one",
      kind: "agent",
      phase: "Map",
      status: "completed",
      requiresEvidence: false,
      prompt: "Map one candidate.",
      taskPath: "",
      resultPath,
      loopStage: "observe",
      resultNodeId: "candidate-smoke:result:map:one",
      verifierNodeId: "candidate-smoke:verifier:map:one",
      workerId: "worker-one"
    }
  ],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: [],
  feedback: [],
  workers: [
    {
      schemaVersion: 1,
      id: "worker-one",
      runId: "candidate-smoke",
      taskId: "map:one",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "verified",
      workerDir: path.join(paths.workersDir, "worker-one"),
      inputPath: path.join(paths.workersDir, "worker-one", "input.md"),
      resultPath,
      artifactsDir: path.join(paths.workersDir, "worker-one", "artifacts"),
      logsDir: path.join(paths.workersDir, "worker-one", "logs"),
      allowedPaths: [resultPath],
      resultNodeId: "candidate-smoke:result:map:one",
      feedbackIds: [],
      errors: [],
      output: {
        workerId: "worker-one",
        taskId: "map:one",
        resultPath,
        recordedAt: new Date().toISOString(),
        stateNodeId: "candidate-smoke:result:map:one",
        verifierNodeId: "candidate-smoke:verifier:map:one"
      }
    }
  ],
  candidates: [],
  candidateSelections: []
};
fs.mkdirSync(run.workers[0].workerDir, { recursive: true });
fs.writeFileSync(path.join(run.workers[0].workerDir, "worker.json"), JSON.stringify(run.workers[0], null, 2), "utf8");

appendRunNode(
  run,
  createStateNode({
    id: "candidate-smoke:result:map:one",
    kind: "result",
    status: "completed",
    loopStage: "observe",
    artifacts: [{ id: "result", kind: "markdown", path: resultPath }],
    evidence: [{ id: "result:1", source: "cw:result", locator: "test/candidate-scoring-smoke.js:1" }]
  })
);
appendRunNode(
  run,
  createStateNode({
    id: "candidate-smoke:verifier:map:one",
    kind: "verifier",
    status: "verified",
    loopStage: "adjust",
    artifacts: [{ id: "result", kind: "markdown", path: resultPath }],
    evidence: [{ id: "verify:1", source: "cw:result", locator: "test/candidate-scoring-smoke.js:1" }]
  })
);
saveCheckpoint(run);

const candidate = registerCandidate(
  run,
  {
    id: "candidate-one",
    workerId: "worker-one",
    taskId: "map:one",
    kind: "worker-output",
    resultNodeId: "candidate-smoke:result:map:one",
    verifierNodeId: "candidate-smoke:verifier:map:one",
    resultPath
  },
  { persist: false }
);
assert.equal(candidate.status, "registered");
assert.ok(fs.existsSync(path.join(paths.candidatesDir, "candidate-one", "candidate.json")));
assert.equal(listCandidates(run).length, 1);

assert.throws(
  () =>
    scoreCandidate(run, "candidate-one", {
      criteria: { correctness: 4 }
    }),
  /requires evidence/
);
assert.equal(run.feedback.length, 1);

const score = scoreCandidate(
  run,
  "candidate-one",
  {
    id: "score-one",
    scorer: "smoke",
    criteria: { correctness: 4, evidence: 4, fit: 2 },
    maxTotal: 10,
    evidence: [{ id: "score:evidence", source: "test", locator: "test/candidate-scoring-smoke.js:1" }],
    notes: "strong candidate"
  },
  { persist: false }
);
assert.equal(score.normalized, 1);
assert.equal(score.verdict, "pass");

const ranking = rankCandidates(run);
assert.equal(ranking.candidates[0].candidateId, "candidate-one");
assert.ok(fs.existsSync(path.join(paths.candidatesDir, "ranking.json")));

const selection = selectCandidate(run, "candidate-one", { reason: "smoke selected" }, { persist: false });
assert.equal(selection.candidateId, "candidate-one");
assert.equal(selection.verifierNodeId, "candidate-smoke:verifier:map:one");
assert.equal(listCandidates(run)[0].status, "verified");

const rejected = registerCandidate(run, { id: "candidate-two", kind: "manual" }, { persist: false });
assert.equal(rejectCandidate(run, rejected.id, "less complete", { persist: false }).status, "rejected");
assert.equal(summarizeCandidates(run).total, 2);
saveCheckpoint(run);

const loaded = loadRunFromCwd("candidate-smoke", tmp);
assert.equal(loaded.paths.candidatesDir, paths.candidatesDir);
assert.equal(loaded.candidates.length, 2);

const cliList = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "candidate", "list", "candidate-smoke"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(cliList.length, 2);

const cliShow = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "candidate", "show", "candidate-smoke", "candidate-one"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(cliShow.id, "candidate-one");

const cliRank = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "candidate", "rank", "candidate-smoke"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(cliRank.candidates[0].candidateId, "candidate-one");

const cliSummary = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "candidate", "summary", "candidate-smoke"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(cliSummary.total, 2);

process.stdout.write("candidate-scoring-smoke: ok\n");
