#!/usr/bin/env node
"use strict";

// Corrupt-vs-absent is asymmetric on purpose (spec "Rebuild risks" #1).
// AUTHORITATIVE stores fail CLOSED on corrupt bytes with a non-zero exit
// and an "Invalid JSON in <file>" message: queue.json and repos.json.
// The SAME store, when simply ABSENT, loads a clean empty default with
// exit 0 — corruption is refused, absence is not.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  // --- repos.json: absent vs corrupt (check absence FIRST, before any
  // other command in this case registers a repo and creates the file) ---
  const cleanRefresh = run(["registry", "refresh", "--json"], { cwd: repo });
  assert.equal(cleanRefresh.status, 0, "an absent repos.json must load empty and let refresh proceed");

  // Discover repos.json's real path the black-box way: registry refresh's
  // own report names the repo root; repos.json lives beside the home index
  // under the shared CW_HOME every run() call in this case uses. We locate
  // CW_HOME via clones list's clonesDir sibling, never by reading source.
  const clonesProbe = run(["clones", "list", "--json"], { cwd: repo });
  const cwHome = path.dirname(JSON.parse(clonesProbe.stdout).clonesDir);
  const reposPath = path.join(cwHome, "registry", "repos.json");
  assert.ok(fs.existsSync(reposPath), "registry refresh must have created repos.json");

  fs.writeFileSync(reposPath, "not json {{{");
  const corruptRefresh = run(["registry", "refresh", "--json"], { cwd: repo });
  assert.equal(corruptRefresh.status, 1, "a corrupt repos.json must fail closed");
  assert.equal(corruptRefresh.stdout, "");
  assert.match(corruptRefresh.stderr, /^cw: Invalid JSON in .*repos\.json: /);

  const corruptOrphans = run(["orphans", "list", "--json"], { cwd: repo });
  assert.equal(corruptOrphans.status, 1, "orphans list also depends on repos.json and must fail closed too");
  assert.match(corruptOrphans.stderr, /^cw: Invalid JSON in .*repos\.json: /);

  // Repair repos.json so the rest of the case can proceed cleanly.
  fs.rmSync(reposPath);
  const repaired = run(["registry", "refresh", "--json"], { cwd: repo });
  assert.equal(repaired.status, 0, "removing the corrupt file must recover the clean-default path");

  // --- queue.json: absent vs corrupt ---------------------------------
  const emptyQueue = run(["queue", "list", "--json"], { cwd: repo });
  assert.equal(emptyQueue.status, 0, "an absent queue.json must load an empty default");
  const emptyQueueReport = JSON.parse(emptyQueue.stdout);
  assert.equal(emptyQueueReport.schemaVersion, 1);
  assert.equal(emptyQueueReport.total, 0);
  assert.deepEqual(emptyQueueReport.entries, []);

  const add = run(["queue", "add", "--app", "demo", "--json"], { cwd: repo });
  assert.equal(add.status, 0);
  const queuePath = path.join(cwHome, "registry", "queue.json");
  assert.ok(fs.existsSync(queuePath), "queue add must have created queue.json on disk");

  fs.writeFileSync(queuePath, "not json {{{");
  const corruptQueue = run(["queue", "list", "--json"], { cwd: repo });
  assert.equal(corruptQueue.status, 1, "a corrupt queue.json must fail closed, not silently reset");
  assert.equal(corruptQueue.stdout, "");
  assert.match(corruptQueue.stderr, /^cw: Invalid JSON in .*queue\.json: /);

  // sched plan reads the SAME queue file and must also fail closed.
  const corruptSchedPlan = run(["sched", "plan", "--json"], { cwd: repo });
  assert.equal(corruptSchedPlan.status, 1);
  assert.match(corruptSchedPlan.stderr, /^cw: Invalid JSON in .*queue\.json: /);
});
