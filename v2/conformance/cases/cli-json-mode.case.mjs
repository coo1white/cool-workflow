#!/usr/bin/env node

// cli-json-mode — the three jsonMode contracts a rebuild must copy exactly
// (SPEC/cli-surface.md "jsonMode-contract"): "default" verbs are ALWAYS
// JSON (a bare call and a --json call give byte-identical output; --json
// is a no-op); "flag" verbs are human text by default and switch to JSON
// only under --json (or the --format json alias); printJson itself is
// always `JSON.stringify(value, null, 2) + "\n"`, never colored, even under
// FORCE_COLOR. Uses `run list`/`history` (flag-gated, no repo needed) and
// `list` (always-JSON, no repo needed) to stay cheap and repo-free.

import { run, caseMain, assert } from "../lib.mjs";

caseMain(() => {
  // "default" jsonMode: `list` prints the same JSON with or without --json.
  const listBare = run(["list"]);
  const listJson = run(["list", "--json"]);
  assert.equal(listBare.status, 0);
  assert.equal(listJson.status, 0);
  assert.equal(listBare.stdout, listJson.stdout, "list --json must be a no-op: already always JSON");
  assert.doesNotThrow(() => JSON.parse(listBare.stdout));
  const listPayload = JSON.parse(listBare.stdout);
  assert.ok(Array.isArray(listPayload));
  assert.ok(listPayload.length > 0);
  assert.ok("id" in listPayload[0] && "title" in listPayload[0] && "summary" in listPayload[0] && "file" in listPayload[0]);

  // "flag" jsonMode: `run list` is human text by default, JSON only
  // under --json; the human form for an empty home is the fixed lines.
  const runListBare = run(["run", "list"]);
  assert.equal(runListBare.status, 0);
  assert.match(runListBare.stdout, /^Run Search \(home\): 0 match\(es\), showing 0 \[offset 0\] freshness=absent\n  \(no matching runs\)\n$/);
  assert.throws(() => JSON.parse(runListBare.stdout), "human text must not parse as JSON");

  const runListJson = run(["run", "list", "--json"]);
  assert.equal(runListJson.status, 0);
  const runListPayload = JSON.parse(runListJson.stdout);
  assert.equal(runListPayload.schemaVersion, 1);
  assert.equal(runListPayload.total, 0);
  assert.deepEqual(runListPayload.records, []);

  // --format json is an alias for --json (both spellings).
  const runListFormatJson = run(["run", "list", "--format", "json"]);
  assert.equal(runListFormatJson.stdout, runListJson.stdout);
  const runListFormatJsonEq = run(["run", "list", "--format=json"]);
  assert.equal(runListFormatJsonEq.stdout, runListJson.stdout);

  // Same flag-gated pattern for `history` (default scope: home).
  const historyBare = run(["history"]);
  assert.equal(historyBare.status, 0);
  assert.throws(() => JSON.parse(historyBare.stdout));
  const historyJson = run(["history", "--json"]);
  const historyPayload = JSON.parse(historyJson.stdout);
  assert.equal(historyPayload.scope, "home");

  // printJson shape is exact: 2-space pretty JSON + one trailing newline,
  // and carries ZERO ANSI bytes even when FORCE_COLOR would color human
  // chrome elsewhere in the same process.
  assert.ok(runListJson.stdout.endsWith("}\n"));
  assert.equal((runListJson.stdout.match(/\n/g) || []).length, runListJson.stdout.split("\n").length - 1);
  assert.ok(!/\x1b\[/.test(runListJson.stdout), "printJson output must never carry ANSI codes");

  const forcedColorJson = run(["run", "list", "--json"], { env: { FORCE_COLOR: "1" } });
  assert.ok(!/\x1b\[/.test(forcedColorJson.stdout), "FORCE_COLOR must not color JSON stdout");
  assert.equal(forcedColorJson.stdout, runListJson.stdout);
});
