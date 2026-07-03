#!/usr/bin/env node
"use strict";

// cw app list — the capability registry as static data. No repo, no run, no
// agent needed: this is pure discovery over apps/*/app.json + workflows/*.workflow.js.
// Pins the known app ids, the WorkflowAppSummary key set/order, and a few
// per-app facts a rebuild is likely to get wrong (task counts, legacy flag,
// sandbox profiles).

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  const r = run(["app", "list"]);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");

  const apps = JSON.parse(r.stdout);
  assert.ok(Array.isArray(apps));

  const ids = apps.map((a) => a.id);
  // Known canonical + legacy ids must all appear (order: sorted by id).
  const expectedIds = [
    "architecture-review",
    "architecture-review-fast",
    "end-to-end-golden-path",
    "legacy-architecture-review",
    "legacy-research-synthesis",
    "pdca-blackboard-loop",
    "pr-review-fix-ci",
    "release-cut",
    "research-synthesis",
    "workflow-app-framework-demo",
  ];
  assert.deepEqual(ids, expectedIds, "cw app list must return exactly these ids, sorted");

  // Key set and order per element (WorkflowAppSummary). Legacy apps have no
  // author (the key is omitted, not null) and sourceKind "workflow-file".
  const expectedKeys = [
    "id", "title", "summary", "version", "author", "file", "sourceKind",
    "legacy", "compatible", "inputs", "sandboxProfiles", "phases", "taskCount",
  ];
  const expectedKeysNoAuthor = expectedKeys.filter((k) => k !== "author");
  for (const a of apps) {
    const expected = a.legacy ? expectedKeysNoAuthor : expectedKeys;
    assert.deepEqual(Object.keys(a), expected, `${a.id} summary key order`);
  }

  const byId = Object.fromEntries(apps.map((a) => [a.id, a]));

  // architecture-review: the flagship app, 14 tasks, 4 phases, readonly only.
  const archReview = byId["architecture-review"];
  assert.equal(archReview.legacy, false);
  assert.equal(archReview.compatible, true);
  assert.equal(archReview.sourceKind, "app-directory");
  assert.equal(archReview.taskCount, 14);
  assert.deepEqual(archReview.sandboxProfiles, ["readonly"]);
  assert.deepEqual(
    archReview.phases.map((p) => ({ id: p.id, name: p.name, taskCount: p.taskCount })),
    [
      { id: "map", name: "Map", taskCount: 6 },
      { id: "assess", name: "Assess", taskCount: 6 },
      { id: "verify", name: "Verify", taskCount: 1 },
      { id: "verdict", name: "Verdict", taskCount: 1 },
    ]
  );
  const reqInput = archReview.inputs.find((i) => i.name === "repo");
  assert.equal(reqInput.type, "path");
  assert.equal(reqInput.required, true);

  // pr-review-fix-ci: two sandbox profiles, 7 tasks.
  const prReview = byId["pr-review-fix-ci"];
  assert.equal(prReview.taskCount, 7);
  assert.deepEqual(prReview.sandboxProfiles, ["readonly", "workspace-write"]);

  // Legacy apps: always version 0.0.0, legacy true, sourced from a bare
  // .workflow.js file (not an app directory).
  for (const legacyId of ["legacy-architecture-review", "legacy-research-synthesis"]) {
    const app = byId[legacyId];
    assert.equal(app.legacy, true, `${legacyId} must be legacy`);
    assert.equal(app.version, "0.0.0", `${legacyId} legacy version pinned to 0.0.0`);
    assert.equal(app.sourceKind, "workflow-file");
    assert.equal(app.author, undefined, "legacy apps carry no author key");
  }

  // end-to-end-golden-path: the minimal 1-task app.
  const golden = byId["end-to-end-golden-path"];
  assert.equal(golden.taskCount, 1);
  assert.equal(golden.phases.length, 1);

  // cw list (the lighter {id,title,summary,file} view) must include the same
  // app-directory ids (and no dupes), sorted.
  const listed = run(["list"]);
  assert.equal(listed.status, 0);
  const shallow = JSON.parse(listed.stdout);
  assert.deepEqual(
    shallow.map((a) => a.id),
    expectedIds,
    "cw list must match cw app list ids/order"
  );
  for (const row of shallow) {
    assert.deepEqual(Object.keys(row), ["id", "title", "summary", "file"]);
  }
});
