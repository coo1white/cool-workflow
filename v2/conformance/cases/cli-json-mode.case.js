#!/usr/bin/env node
"use strict";

// cli-json-mode — the three jsonMode contracts a rebuild must copy exactly
// (SPEC/cli-surface.md "jsonMode-contract"): "default" verbs are ALWAYS
// JSON (a bare call and a --json call give byte-identical output; --json
// is a no-op); "flag" verbs are human text by default and switch to JSON
// only under --json (or the --format json alias); printJson itself is
// always `JSON.stringify(value, null, 2) + "\n"`, never colored, even under
// FORCE_COLOR. Uses `clones`/`orphans` (flag-gated, no repo needed) and
// `list` (always-JSON, no repo needed) to stay cheap and repo-free.

const { run, caseMain, assert } = require("../lib");

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

  // "flag" jsonMode: `clones list` is human text by default, JSON only
  // under --json; the human form for an empty cache is the fixed sentence.
  const clonesBare = run(["clones", "list"]);
  assert.equal(clonesBare.status, 0);
  assert.match(clonesBare.stdout, /^No cached remote checkouts in .+\.\n$/);
  assert.throws(() => JSON.parse(clonesBare.stdout), "human text must not parse as JSON");

  const clonesJson = run(["clones", "list", "--json"]);
  assert.equal(clonesJson.status, 0);
  const clonesPayload = JSON.parse(clonesJson.stdout);
  assert.equal(clonesPayload.schemaVersion, 1);
  assert.equal(clonesPayload.count, 0);
  assert.deepEqual(clonesPayload.entries, []);

  // --format json is the exact same switch as --json (io.wantsJson).
  const clonesFormatJson = run(["clones", "list", "--format", "json"]);
  assert.equal(clonesFormatJson.stdout, clonesJson.stdout);
  const clonesFormatJsonEq = run(["clones", "list", "--format=json"]);
  assert.equal(clonesFormatJsonEq.stdout, clonesJson.stdout);

  // Same flag-gated pattern for `orphans list` (default scope: home).
  const orphansBare = run(["orphans", "list"]);
  assert.equal(orphansBare.status, 0);
  assert.throws(() => JSON.parse(orphansBare.stdout));
  const orphansJson = run(["orphans", "list", "--json"]);
  const orphansPayload = JSON.parse(orphansJson.stdout);
  assert.equal(orphansPayload.scope, "home");

  // printJson shape is exact: 2-space pretty JSON + one trailing newline,
  // and carries ZERO ANSI bytes even when FORCE_COLOR would color human
  // chrome elsewhere in the same process.
  assert.ok(clonesJson.stdout.endsWith("}\n"));
  assert.equal((clonesJson.stdout.match(/\n/g) || []).length, clonesJson.stdout.split("\n").length - 1);
  assert.ok(!/\x1b\[/.test(clonesJson.stdout), "printJson output must never carry ANSI codes");

  const forcedColorJson = run(["clones", "list", "--json"], { env: { FORCE_COLOR: "1" } });
  assert.ok(!/\x1b\[/.test(forcedColorJson.stdout), "FORCE_COLOR must not color JSON stdout");
  assert.equal(forcedColorJson.stdout, clonesJson.stdout);
});
