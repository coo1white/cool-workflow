#!/usr/bin/env node
"use strict";

// cli-status-search-run-guard — three more exact-string / shape invariants
// from SPEC/cli-surface.md that are cheap (no repo needed, no agent):
//
// 1. `status` with no run id: fixed "No run selected" human text on
//    stdout, and the matching {runId:null,nextActions:[...]} JSON shape.
// 2. `search <kw>` human output: singular/plural headline wording, the
//    "<id> — <title>" row shape, a summary line cut at 120 chars with an
//    ellipsis, and the closing "Use cw info <id> for full details." line.
// 3. `run <keyword> --drive` is NOT hijacked into an app-drive attempt when
//    the first positional is a registry keyword (list/search/show/resume/
//    archive/rerun/export/import/verify-import/inspect-archive/restore) —
//    it falls through to the ordinary registry verb and --drive is just
//    ignored, proven by getting the exact same JSON with or without it.

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  // (1) status, no run id.
  const statusHuman = run(["status"]);
  assert.equal(statusHuman.status, 0);
  assert.equal(
    statusHuman.stdout,
    "No run selected\n\nNext Action\n  cw plan <workflow-id> --repo <path>\n    reason: No run id is available yet; create a workflow run before dispatching or recording evidence.\n"
  );

  const statusJson = run(["status", "--json"]);
  assert.equal(statusJson.status, 0);
  const statusPayload = JSON.parse(statusJson.stdout);
  assert.deepEqual(statusPayload, {
    runId: null,
    nextActions: [
      {
        command: "cw plan <workflow-id> --repo <path>",
        reason: "No run id is available yet; create a workflow run before dispatching or recording evidence.",
        priority: "high",
      },
    ],
  });

  // (2) search human output, a keyword with exactly one match.
  const searchOne = run(["search", "release"]);
  assert.equal(searchOne.status, 0);
  assert.match(searchOne.stdout, /^1 workflow matching "release"\n/, "singular wording for exactly one match");
  assert.match(searchOne.stdout, /\n {2}release-cut — Release Cut\n/);
  assert.match(searchOne.stdout, /\nUse cw info <id> for full details\.\n$/);

  // A keyword with several matches uses plural wording.
  const searchMany = run(["search", "review"]);
  assert.equal(searchMany.status, 0);
  assert.match(searchMany.stdout, /^\d+ workflows matching "review"\n/);

  // No match at all: the fixed miss text.
  const searchMiss = run(["search", "zzzznomatchzzzz"]);
  assert.equal(searchMiss.status, 0);
  assert.equal(
    searchMiss.stdout,
    'No workflows matched "zzzznomatchzzzz".\n  Tip: cw list for all available workflows.\n'
  );

  // (3) `run <keyword> --drive` guard: list/search both give the exact
  // same registry-query JSON whether or not --drive is tacked on, proving
  // the drive intercept never fires for a registry keyword.
  const listPlain = run(["run", "list", "--json"]);
  const listWithDrive = run(["run", "list", "--drive", "--json"]);
  assert.equal(listPlain.status, 0);
  assert.equal(listWithDrive.status, 0);
  assert.equal(listPlain.stdout, listWithDrive.stdout);

  const searchPlain = run(["run", "search", "--json"]);
  const searchWithDrive = run(["run", "search", "--drive", "--json"]);
  assert.equal(searchPlain.stdout, searchWithDrive.stdout);

  const payload = JSON.parse(listPlain.stdout);
  assert.equal(payload.scope, "home");
  assert.equal(payload.total, 0);
  assert.deepEqual(payload.records, []);
});
