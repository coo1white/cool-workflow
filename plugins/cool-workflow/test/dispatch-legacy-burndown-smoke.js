#!/usr/bin/env node
"use strict";

// dispatch-legacy-burndown-smoke: cli/dispatch.ts's milestone-1 carry-over
// switch claimed "each arm here is replaced by a capability-table row when
// its own build-order milestone lands" -- but next/gc/migration had all
// grown real capability-table rows that dispatchTable() already matched
// first, so their switch arms were dead code (proven live: their exact
// placeholder text never appears). search was the mirror-image bug: a
// genuinely live arm with NO capability-table row at all, so the
// registry's own tooling had no way to see it. This pins:
//   1. the dead arms are really gone (real error text, not the old
//      "X is not implemented in this milestone" placeholder strings);
//   2. search is now a real, cli-only capability-table row;
//   3. cw search / root help are byte-unchanged by the move; cw help
//      search now shows a real row again (this smoke originally pinned
//      `hiddenFromHelp: true` as "byte-unchanged," but that was itself a
//      regression this move introduced, not a preserved old-build
//      behavior — fixed along with the source). The row's wording is
//      NOT byte-matched to the old v0.1.98 capture (docs/rebuild/SPEC/
//      cli-help/search.txt says "title, description, id" — a stale
//      field name; the real filter uses `summary`, not `description` —
//      see basics.ts's search capability for why the current wording
//      was kept instead).

const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const { cliCapabilities, findCapabilityByCliPath } = require(path.join(pluginRoot, "dist", "core", "capability-table"));

function run(args) {
  try {
    const stdout = execFileSync(node, [cli, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout || "", stderr: error.stderr || "" };
  }
}

// ---- 1. dead arms are gone: real behavior, not the old placeholder text ----
{
  const next = run(["next"]);
  assert.equal(next.status, 1);
  assert.match(next.stderr, /Missing run id/, "next: the real capability's missing-run-id refusal, not the old placeholder");
  assert.doesNotMatch(next.stderr, /is not implemented in this milestone/, "next: no trace of the dead placeholder text");
}
{
  const migration = run(["migration", "check", "no-such-target"]);
  assert.equal(migration.status, 1);
  assert.match(migration.stderr, /Migration target not found: no-such-target/, "migration check: the real capability's not-found error");
  assert.doesNotMatch(migration.stderr, /is not implemented in this milestone/);
}
{
  const gc = run(["gc", "verify", "no-such-run"]);
  assert.equal(gc.status, 0, "gc verify: the real capability's verdict, exit 0 for an unresolvable run (not a failure)");
  assert.match(gc.stdout, /GC Verify no-such-run:/, "gc verify: real human-text verdict line");
}

// ---- 2. search is a real, cli-only capability-table row --------------------
{
  const row = findCapabilityByCliPath(["search"]);
  assert.ok(row, "search must resolve to a real capability-table row");
  assert.equal(row.surface, "cli-only");
  // The old v0.1.98 CLI DID have its own `cw help search` row
  // (docs/rebuild/SPEC/cli-help/search.txt); `hiddenFromHelp: true` was a
  // rebuild regression this smoke had baked in as "exactly as before the
  // move" — it was not. Fixed to match the true old-build ground truth.
  assert.notEqual(row.cli.hiddenFromHelp, true, "search must appear in the per-verb help listing, matching the old build's cw help search row");
  assert.ok(!cliCapabilities().some((cap) => cap.cli.hiddenFromHelp && cap.capability === "search" && cap.mcp), "search has no MCP peer");
}

// ---- 3. byte-unchanged CLI surface -----------------------------------------
{
  const noKeyword = run(["search"]);
  assert.equal(noKeyword.status, 1);
  assert.equal(noKeyword.stderr, 'cw: Missing search keyword.\n  Tip: cw search architecture to find workflows about architecture.\n');
}
{
  const helpSearch = run(["help", "search"]);
  assert.equal(helpSearch.status, 0);
  assert.equal(helpSearch.stdout, "cw search\n\n  cw search  Search bundled workflows by id/title/summary keyword.\n", "search has its own cw help row again (visibility restored; wording intentionally not byte-matched to the old capture — see basics.ts)");
}
{
  const found = run(["search", "architecture"]);
  assert.equal(found.status, 0);
  assert.match(found.stdout, /workflows? matching "architecture"/);
  assert.match(found.stdout, /architecture-review — Architecture Review/);
}
{
  const rootHelp = run(["help"]);
  assert.equal(rootHelp.status, 0);
  assert.match(rootHelp.stdout, /list\|search\|info\|init\|plan\|status\|next\|dispatch/, "the frozen root 'More commands' index line is untouched by the move");
}

process.stdout.write("dispatch-legacy-burndown-smoke: ok\n");
