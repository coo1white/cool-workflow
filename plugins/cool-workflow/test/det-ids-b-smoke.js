#!/usr/bin/env node
"use strict";

// FreeBSD-audit DET-IDs-B (findings L12/L13, entity-id half): the 8 entity-ID
// minting sites must be DETERMINISTIC — derived from stable, replayable inputs
// (a per-run/per-collection sequence or a content hash) instead of a wall-clock
// stamp + Math.random() suffix. This smoke creates the SAME logical entities in
// two FRESH runs (separate temp dirs) and asserts the minted ids are
// byte-identical, and that within one run the minted ids never collide.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/state");
const { appendRunNode, createStateNode } = require("../dist/state-node");
const { registerCandidate, scoreCandidate, selectCandidate } = require("../dist/candidate-scoring");
const { recordFeedback } = require("../dist/error-feedback");
const { commitState } = require("../dist/commit");
const {
  createMultiAgentRun,
  createAgentRole,
  createAgentGroup
} = require("../dist/multi-agent");
const {
  resolveBlackboard,
  createBlackboardTopic,
  postBlackboardMessage,
  recordCoordinatorDecision
} = require("../dist/coordinator");
const { RoutineTriggerBridge } = require("../dist/triggers");

const RUN_ID = "det-ids-b";

// Builds one fresh run under `tmp` and exercises EVERY entity-id minting site in
// this fix WITHOUT passing an explicit id, returning the full set of minted ids.
function mintAll(tmp) {
  const paths = createRunPaths(path.join(tmp, ".cw", "runs", RUN_ID));
  ensureRunDirs(paths);

  const resultPath = path.join(paths.resultsDir, "worker-result.md");
  fs.writeFileSync(resultPath, "deterministic candidate result\n", "utf8");

  // A fixed creation timestamp keeps non-id fields stable too, so any non-id drift
  // would surface; the ids themselves must NOT depend on it.
  const fixedTime = "2026-01-01T00:00:00.000Z";

  const run = {
    schemaVersion: 1,
    id: RUN_ID,
    createdAt: fixedTime,
    updatedAt: fixedTime,
    cwd: tmp,
    workflow: {
      id: RUN_ID,
      title: "Deterministic IDs B",
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
        resultNodeId: `${RUN_ID}:result:map:one`,
        verifierNodeId: `${RUN_ID}:verifier:map:one`,
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
        runId: RUN_ID,
        taskId: "map:one",
        createdAt: fixedTime,
        updatedAt: fixedTime,
        status: "verified",
        workerDir: path.join(paths.workersDir, "worker-one"),
        inputPath: path.join(paths.workersDir, "worker-one", "input.md"),
        resultPath,
        artifactsDir: path.join(paths.workersDir, "worker-one", "artifacts"),
        logsDir: path.join(paths.workersDir, "worker-one", "logs"),
        allowedPaths: [resultPath],
        resultNodeId: `${RUN_ID}:result:map:one`,
        feedbackIds: [],
        errors: [],
        output: {
          workerId: "worker-one",
          taskId: "map:one",
          resultPath,
          recordedAt: fixedTime,
          stateNodeId: `${RUN_ID}:result:map:one`,
          verifierNodeId: `${RUN_ID}:verifier:map:one`
        }
      }
    ],
    candidates: [],
    candidateSelections: []
  };
  fs.mkdirSync(run.workers[0].workerDir, { recursive: true });

  appendRunNode(
    run,
    createStateNode({
      id: `${RUN_ID}:result:map:one`,
      kind: "result",
      status: "completed",
      loopStage: "observe",
      artifacts: [{ id: "result", kind: "markdown", path: resultPath }],
      evidence: [{ id: "result:1", source: "cw:result", locator: `${resultPath}:1` }]
    })
  );
  appendRunNode(
    run,
    createStateNode({
      id: `${RUN_ID}:verifier:map:one`,
      kind: "verifier",
      status: "verified",
      loopStage: "adjust",
      artifacts: [{ id: "result", kind: "markdown", path: resultPath }],
      evidence: [{ id: "verify:1", source: "cw:result", locator: `${resultPath}:1` }]
    })
  );

  const ids = {};

  // --- state-node createNodeId fallback (content-hash, no explicit id) ----------
  const adHocNode = appendRunNode(
    run,
    createStateNode({
      kind: "analysis",
      status: "completed",
      loopStage: "interpret",
      inputs: { note: "ad-hoc node minted without an explicit id" }
    })
  );
  ids.nodeId = adHocNode.id;

  // --- candidate / score / selection -------------------------------------------
  const candidate = registerCandidate(
    run,
    {
      workerId: "worker-one",
      taskId: "map:one",
      kind: "worker-output",
      resultNodeId: `${RUN_ID}:result:map:one`,
      verifierNodeId: `${RUN_ID}:verifier:map:one`,
      resultPath
    },
    { persist: false }
  );
  ids.candidateId = candidate.id;

  const score = scoreCandidate(
    run,
    candidate.id,
    {
      scorer: "smoke",
      criteria: { correctness: 4, evidence: 4, fit: 2 },
      maxTotal: 10,
      evidence: [{ id: "score:evidence", source: "test", locator: `${resultPath}:1` }],
      notes: "strong candidate"
    },
    { persist: false }
  );
  ids.scoreId = score.id;

  const selection = selectCandidate(run, candidate.id, { reason: "selected" }, { persist: false });
  ids.selectionId = selection.id;

  // --- error-feedback createFeedbackId -----------------------------------------
  const feedback = recordFeedback(
    run,
    {
      source: "runtime",
      error: { code: "smoke-error", message: "deterministic feedback", at: fixedTime, retryable: true }
    },
    { persist: false }
  );
  ids.feedbackId = feedback.id;

  // --- commit createCommitId ----------------------------------------------------
  const commit = commitState(run, {
    reason: "deterministic checkpoint",
    allowUnverifiedCheckpoint: true,
    source: "manual"
  });
  ids.commitId = commit.id;

  // --- multi-agent createId (mar / role / group) -------------------------------
  const marRun = createMultiAgentRun(run, { title: "MA", objective: "prove deterministic ids" });
  ids.marId = marRun.id;
  const role = createAgentRole(run, {
    multiAgentRunId: marRun.id,
    title: "Runtime",
    responsibilities: ["produce evidence"]
  });
  ids.roleId = role.id;
  const group = createAgentGroup(run, { multiAgentRunId: marRun.id, title: "Group" });
  ids.groupId = group.id;

  // --- coordinator createId (bb / topic / msg / decision) ----------------------
  const board = resolveBlackboard(run, {});
  ids.boardId = board.id;
  const topic = createBlackboardTopic(run, { blackboardId: board.id, title: "Coordination" });
  ids.topicId = topic.id;
  const message = postBlackboardMessage(run, { topicId: topic.id, body: "deterministic message" });
  ids.messageId = message.id;
  const decision = recordCoordinatorDecision(run, {
    blackboardId: board.id,
    kind: "context-update",
    outcome: "accepted",
    reason: "deterministic decision"
  });
  ids.decisionId = decision.id;

  saveCheckpoint(run);

  // Within-run collision check across EVERY minted id captured above.
  const values = Object.values(ids);
  assert.equal(new Set(values).size, values.length, `minted ids must be collision-free within a run: ${JSON.stringify(ids)}`);
  for (const value of values) {
    assert.ok(typeof value === "string" && value.length > 0, `each minted id must be a non-empty string: ${JSON.stringify(ids)}`);
    assert.ok(!/\d{8}T\d{6}Z/.test(value), `minted id must not embed a wall-clock stamp: ${value}`);
  }

  return ids;
}

// Standalone trigger store (createTriggerId / createEventId): not run-scoped, so
// it is exercised through its own bridge against a fresh cwd.
function mintTriggers(tmp) {
  const bridge = new RoutineTriggerBridge(tmp);
  const trigger = bridge.create({ kind: "api", prompt: "deterministic trigger", match: { ref: "main" } });
  const events = bridge.fire("api", { ref: "main" });
  assert.equal(events.length, 1, "one matching trigger fires one event");
  const ids = { triggerId: trigger.id, eventId: events[0].id };
  assert.notEqual(ids.triggerId, ids.eventId, "trigger and event ids must differ");
  for (const value of Object.values(ids)) {
    assert.ok(!/\d{8}T\d{6}Z/.test(value), `trigger/event id must not embed a wall-clock stamp: ${value}`);
  }
  return ids;
}

const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), "cw-det-ids-b-a-"));
const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), "cw-det-ids-b-b-"));

const idsA = mintAll(tmpA);
const idsB = mintAll(tmpB);

// Byte-identical across two fresh runs (replay determinism — the whole point).
assert.deepEqual(
  idsB,
  idsA,
  `entity ids must be byte-identical across two fresh runs\nA: ${JSON.stringify(idsA, null, 2)}\nB: ${JSON.stringify(idsB, null, 2)}`
);

const trigA = mintTriggers(fs.mkdtempSync(path.join(os.tmpdir(), "cw-det-ids-b-trig-a-")));
const trigB = mintTriggers(fs.mkdtempSync(path.join(os.tmpdir(), "cw-det-ids-b-trig-b-")));
assert.deepEqual(trigB, trigA, `trigger/event ids must be byte-identical across two fresh stores\nA: ${JSON.stringify(trigA)}\nB: ${JSON.stringify(trigB)}`);

// Sanity: the minted ids carry their human-readable prefix (format preserved).
assert.match(idsA.candidateId, /^candidate-worker-output-/, "candidate id keeps its descriptive prefix");
assert.match(idsA.scoreId, /^score-/, "score id keeps its descriptive prefix (evidence-adoption-reasoning-smoke depends on this)");
assert.match(idsA.selectionId, /^selection-/, "selection id keeps its descriptive prefix");
assert.match(idsA.commitId, /^state-\d{4}$/, "commit id is a zero-padded sequence");
assert.match(idsA.feedbackId, /^feedback-/, "feedback id keeps its descriptive prefix");
assert.match(idsA.marId, /^mar-\d{4}$/, "multi-agent run id is a zero-padded sequence");
assert.match(idsA.boardId, /^bb-\d{4}$/, "blackboard id is a zero-padded sequence");
assert.match(trigA.triggerId, /^api-\d{4}$/, "trigger id is a zero-padded sequence");
assert.match(trigA.eventId, /^event-api-\d{4}$/, "event id is a zero-padded sequence");

process.stdout.write("det-ids-b-smoke: ok\n");
