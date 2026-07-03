#!/usr/bin/env node
"use strict";

// Two different unique()-style dedupe helpers coexist in the multi-agent
// layer (multi-agent.md, "Rebuild risks" #1 and the unique.sorted-vs-unsorted
// edge case): the kernel/coordinator helper (multi-agent/helpers.ts,
// coordinator/util.ts) de-dupes AND SORTS; the topology/candidate/host
// copies (topology.ts, candidate-scoring.ts, multi-agent-host.ts) de-dupe
// but KEEP INSERTION ORDER. All 3 built-in topologies mint role ids that
// are already alphabetical by construction, so that path never actually
// shows the difference through a real CLI run. This case reaches both
// halves without any topology and without racing any process:
//
//   1. `multi-agent role` mints two roles directly (role-zzzz then
//      role-aaaa, deliberately out of alphabetical order), and
//      `multi-agent membership` attaches both to one group. The
//      resulting AgentGroup/MultiAgentRun `roleIds` (kernel-owned,
//      persisted to disk) come back SORTED: [role-aaaa, role-zzzz].
//   2. `candidate register` mints two candidates directly (candidate-zzzz
//      then candidate-aaaa, same reversed order). The multi-agent host
//      envelope's `ids.candidateIds` (multi-agent-host.ts's own unique()
//      copy) comes back in INSERTION order: [candidate-zzzz, candidate-aaaa].
//
// A rebuild that "helpfully" unifies the two unique() implementations
// into one (either always-sorted or always-insertion-order) flips one of
// these two assertions.

const { run, gitRepo, readJson, caseMain, assert } = require("../lib");
const path = require("node:path");

function planRun(repo, question) {
  const p = run(["plan", "architecture-review", "--arg", `repo=${repo}`, "--arg", `question=${question}`], {
    cwd: repo,
  });
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout).runId;
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const runId = planRun(repo, "q1");

  // --- Part 1: kernel roleIds are SORTED, not insertion order ---

  const marCreated = run(["multi-agent", "run", runId, "--id", "mar-0001", "--json"], { cwd: repo });
  assert.equal(marCreated.status, 0, marCreated.stderr);

  // Mint role-zzzz FIRST, then role-aaaa. Alphabetically reversed on purpose.
  const roleZ = run(
    ["multi-agent", "role", runId, "--multi-agent-run", "mar-0001", "--id", "role-zzzz", "--title", "ZZZ", "--json"],
    { cwd: repo }
  );
  assert.equal(roleZ.status, 0, roleZ.stderr);
  assert.equal(JSON.parse(roleZ.stdout).id, "role-zzzz");

  const roleA = run(
    ["multi-agent", "role", runId, "--multi-agent-run", "mar-0001", "--id", "role-aaaa", "--title", "AAA", "--json"],
    { cwd: repo }
  );
  assert.equal(roleA.status, 0, roleA.stderr);
  assert.equal(JSON.parse(roleA.stdout).id, "role-aaaa");

  const groupCreated = run(
    ["multi-agent", "group", runId, "--multi-agent-run", "mar-0001", "--id", "group-0001", "--title", "G1", "--json"],
    { cwd: repo }
  );
  assert.equal(groupCreated.status, 0, groupCreated.stderr);

  // A task id is needed to assign a membership; use whatever plan minted.
  const statePath = path.join(repo, ".cw", "runs", runId, "state.json");
  const state = readJson(statePath);
  const taskId = state.tasks[0].id;

  // Attach role-zzzz to the group FIRST (membership-0001), then role-aaaa
  // (membership-0002) -- insertion order on the group is zzzz, then aaaa.
  const memZ = run(
    [
      "multi-agent", "membership", runId,
      "--group", "group-0001", "--role", "role-zzzz", "--task", taskId,
      "--id", "membership-0001", "--json",
    ],
    { cwd: repo }
  );
  assert.equal(memZ.status, 0, memZ.stderr);

  const memA = run(
    [
      "multi-agent", "membership", runId,
      "--group", "group-0001", "--role", "role-aaaa", "--task", taskId,
      "--id", "membership-0002", "--json",
    ],
    { cwd: repo }
  );
  assert.equal(memA.status, 0, memA.stderr);
  const memAPayload = JSON.parse(memA.stdout);
  assert.equal(memAPayload.roleId, "role-aaaa");

  // The persisted AgentGroup record's roleIds is the kernel/coordinator
  // unique() (multi-agent/helpers.ts) -- it SORTS. Insertion order was
  // [role-zzzz, role-aaaa]; on disk it comes back alphabetical.
  const groupPath = path.join(repo, ".cw", "runs", runId, "multi-agent", "groups", "group-0001.json");
  const group = readJson(groupPath);
  assert.deepEqual(
    group.roleIds,
    ["role-aaaa", "role-zzzz"],
    "kernel-owned AgentGroup.roleIds is sorted, not insertion order"
  );

  // Same story one level up: the MultiAgentRun's own roleIds roll-up is
  // built through the same sorted kernel helper.
  const marPath = path.join(repo, ".cw", "runs", runId, "multi-agent", "runs", "mar-0001.json");
  const mar = readJson(marPath);
  assert.deepEqual(
    mar.roleIds,
    ["role-aaaa", "role-zzzz"],
    "kernel-owned MultiAgentRun.roleIds is sorted, not insertion order"
  );

  // `multi-agent group <run-id> <group-id>` (show form, no create flags)
  // round-trips the same sorted array (no separate formatting path
  // re-sorts or re-orders it).
  const shownGroup = run(["multi-agent", "group", runId, "group-0001", "--json"], { cwd: repo });
  assert.equal(shownGroup.status, 0, shownGroup.stderr);
  assert.deepEqual(JSON.parse(shownGroup.stdout).roleIds, ["role-aaaa", "role-zzzz"]);

  // --- Part 2: host-owned candidateIds keep INSERTION order, not sorted ---

  // Register candidate-zzzz FIRST, then candidate-aaaa. Same reversed order.
  const candZ = run(["candidate", "register", runId, "--id", "candidate-zzzz", "--json"], { cwd: repo });
  assert.equal(candZ.status, 0, candZ.stderr);
  assert.equal(JSON.parse(candZ.stdout).id, "candidate-zzzz");

  const candA = run(["candidate", "register", runId, "--id", "candidate-aaaa", "--json"], { cwd: repo });
  assert.equal(candA.status, 0, candA.stderr);
  assert.equal(JSON.parse(candA.stdout).id, "candidate-aaaa");

  // The multi-agent host envelope's `ids.candidateIds` is built by
  // multi-agent-host.ts's OWN unique() copy, which does not sort. Insertion
  // order [candidate-zzzz, candidate-aaaa] survives untouched -- the exact
  // opposite ordering from the kernel roleIds above.
  const status1 = run(["multi-agent", "status", runId, "--json"], { cwd: repo });
  assert.equal(status1.status, 0, status1.stderr);
  const statusPayload1 = JSON.parse(status1.stdout);
  assert.deepEqual(
    statusPayload1.ids.candidateIds,
    ["candidate-zzzz", "candidate-aaaa"],
    "host-owned ids.candidateIds keeps insertion order, not sorted"
  );

  // Also on disk: candidates/index.json is host/candidate-scoring code
  // (candidate-scoring.ts), same unsorted family. Same insertion order.
  const candIndexPath = path.join(repo, ".cw", "runs", runId, "candidates", "index.json");
  const candIndex = readJson(candIndexPath);
  assert.deepEqual(
    candIndex.candidates.map((c) => c.id),
    ["candidate-zzzz", "candidate-aaaa"],
    "candidates/index.json preserves registration order, not sorted"
  );

  // Stable and deterministic: a second read of the same envelope repeats
  // the exact same (unsorted) order -- this is not accidental map iteration
  // noise, it is the persisted array itself.
  const status2 = run(["multi-agent", "status", runId, "--json"], { cwd: repo });
  assert.equal(status2.status, 0, status2.stderr);
  assert.deepEqual(
    JSON.parse(status2.stdout).ids.candidateIds,
    ["candidate-zzzz", "candidate-aaaa"]
  );

  // The two families disagree on ordering policy for the SAME kind of data
  // (an array of ids collected from repeated create calls) within the SAME
  // run: kernel roleIds sorted to [aaaa, zzzz]; host candidateIds stayed
  // [zzzz, aaaa]. This is risk #1 from multi-agent.md made concrete.
  assert.notDeepEqual(
    group.roleIds.map((id) => id.replace("role-", "")),
    statusPayload1.ids.candidateIds.map((id) => id.replace("candidate-", ""))
  );
});
