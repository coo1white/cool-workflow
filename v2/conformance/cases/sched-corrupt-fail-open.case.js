#!/usr/bin/env node
"use strict";

// The other half of the corrupt-vs-absent asymmetry (spec "Rebuild risks"
// #1): a corrupt persisted index.json (rebuildable cache) and a corrupt
// reclaimed.json (a bad tombstone overlay must never brick the run) both
// fail OPEN — exit 0, sane fallback values — unlike queue.json/repos.json
// which fail closed (see sched-corrupt-fail-closed.case.js).

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const refresh = run(["registry", "refresh", "--json"], { cwd: repo });
  assert.equal(refresh.status, 0);

  const repoIndexPath = path.join(repo, ".cw", "registry", "index.json");
  assert.ok(fs.existsSync(repoIndexPath));
  fs.writeFileSync(repoIndexPath, "not json {{{");

  const show = run(["registry", "show", "--json"], { cwd: repo });
  assert.equal(show.status, 0, "a corrupt persisted index.json must fail open (rebuildable cache), not error");
  const showReport = JSON.parse(show.stdout);
  assert.equal(showReport.freshness.status, "absent", "no valid persisted fingerprint to compare against");
  assert.equal(showReport.counts.total, 0, "no runs yet in this repo");

  // The home-scope index.json is a separate file with the same fail-open rule.
  const clonesProbe = run(["clones", "list", "--json"], { cwd: repo });
  const cwHome = path.dirname(JSON.parse(clonesProbe.stdout).clonesDir);
  const homeIndexPath = path.join(cwHome, "registry", "index.json");
  assert.ok(fs.existsSync(homeIndexPath));
  fs.writeFileSync(homeIndexPath, "not json {{{");

  const list = run(["run", "list", "--json"], { cwd: repo });
  assert.equal(list.status, 0, "a corrupt home index.json must also fail open");
  const listReport = JSON.parse(list.stdout);
  assert.equal(listReport.freshness, "absent");

  // --- reclaimed.json: corrupt reads as an empty tombstone chain ------
  const pipe = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(pipe.status, 0);
  const runId = JSON.parse(pipe.stdout).runId;
  run(["registry", "refresh"], { cwd: repo });

  const reclaimedPath = path.join(repo, ".cw", "runs", runId, "reclaimed.json");
  fs.writeFileSync(reclaimedPath, "not json {{{");

  const verify = run(["gc", "verify", runId, "--json"], { cwd: repo });
  assert.equal(verify.status, 0, "a corrupt reclaimed.json must never brick gc verify");
  const verifyReport = JSON.parse(verify.stdout);
  assert.equal(verifyReport.reclaimed, false, "an unreadable tombstone chain reads as empty, i.e. never reclaimed");
  assert.equal(verifyReport.verified, false);
  assert.equal(verifyReport.chainLength, 0);

  const showRun = run(["run", "show", runId, "--json"], { cwd: repo });
  assert.equal(showRun.status, 0, "run show must also survive a corrupt reclaimed.json");
  assert.equal(JSON.parse(showRun.stdout).found, true);
});
