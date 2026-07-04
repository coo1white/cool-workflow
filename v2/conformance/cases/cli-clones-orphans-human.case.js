#!/usr/bin/env node
"use strict";

// cli-clones-orphans-human — byte-exact human text for the empty-state
// shapes of `clones list|gc` and `orphans list|gc` (SPEC/cli-surface.md
// "clones human output" + orphans usage). These need no repo, no agent,
// and no seeded state; the empty cache/registry cases are deterministic
// and cheap, and are exactly the shapes a rebuild is likely to almost-get-
// right (off-by-one wording, wrong pluralization, wrong scope phrase).

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  const clonesEmpty = run(["clones", "list"]);
  assert.equal(clonesEmpty.status, 0);
  assert.match(clonesEmpty.stdout, /^No cached remote checkouts in .+\.\n$/);

  const clonesGcDefault = run(["clones", "gc"]);
  assert.equal(clonesGcDefault.status, 0);
  assert.match(
    clonesGcDefault.stdout,
    /^Nothing to reclaim \(entries older than 30 day\(s\)\); 0 kept in .+\.\n$/
  );

  const clonesGcAll = run(["clones", "gc", "--all"]);
  assert.equal(clonesGcAll.status, 0);
  assert.match(clonesGcAll.stdout, /^Nothing to reclaim \(all entries\); 0 kept in .+\.\n$/);

  const clonesGcCustomDays = run(["clones", "gc", "--older-than-days", "7"]);
  assert.equal(clonesGcCustomDays.status, 0);
  assert.match(clonesGcCustomDays.stdout, /^Nothing to reclaim \(entries older than 7 day\(s\)\); 0 kept in .+\.\n$/);

  // clones gc --json default olderThanDays is 30, all:false.
  const clonesGcJson = run(["clones", "gc", "--json"]);
  const clonesGcPayload = JSON.parse(clonesGcJson.stdout);
  assert.equal(clonesGcPayload.olderThanDays, 30);
  assert.equal(clonesGcPayload.all, false);
  assert.deepEqual(clonesGcPayload.removed, []);

  // orphans list, default scope "home", empty registry.
  const orphansEmpty = run(["orphans", "list"]);
  assert.equal(orphansEmpty.status, 0);
  assert.match(orphansEmpty.stdout, /^No orphan run\(s\) \(home\): /);

  const orphansJson = run(["orphans", "list", "--json"]);
  const orphansPayload = JSON.parse(orphansJson.stdout);
  assert.equal(orphansPayload.scope, "home");
  assert.equal(orphansPayload.count, 0);

  // orphans list --scope repo also works and reports the repo scope.
  const orphansRepoScope = run(["orphans", "list", "--scope", "repo", "--json"]);
  assert.equal(orphansRepoScope.status, 0);
  const orphansRepoPayload = JSON.parse(orphansRepoScope.stdout);
  assert.equal(orphansRepoPayload.scope, "repo");
});
