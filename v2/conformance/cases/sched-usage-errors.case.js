#!/usr/bin/env node
"use strict";

// Byte-exact usage-error strings for every command family in this area.
// An unknown/missing subcommand must print the fixed "Usage: cw.js ..."
// line to stderr and exit 1, stdout empty. These strings are pinned
// verbatim in the spec's "Exact outputs" section.

const { run, gitRepo, caseMain, assert } = require("../lib");

function assertUsage(args, expectedStderr, cwd) {
  const r = run(args, { cwd });
  assert.equal(r.status, 1, `${args.join(" ")} must exit 1`);
  assert.equal(r.stdout, "", `${args.join(" ")} must write nothing to stdout`);
  assert.equal(r.stderr, expectedStderr, `${args.join(" ")} stderr mismatch`);
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  assertUsage(
    ["schedule", "bogus"],
    "cw: Usage: cw.js schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon\n",
    repo
  );
  assertUsage(["routine", "bogus"], "cw: Usage: cw.js routine create|list|delete|fire|events\n", repo);
  assertUsage(
    ["sched", "bogus"],
    "cw: Usage: cw.js sched plan|lease|release|complete|reclaim|reset|policy [show|set] [id] [--maxConcurrent N --maxAttempts N ...]\n",
    repo
  );
  assertUsage(["registry", "bogus"], "cw: Usage: cw.js registry refresh|show [--scope repo|home] [--json]\n", repo);
  assertUsage(["queue", "bogus"], "cw: Usage: cw.js queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]\n", repo);
  assertUsage(
    ["gc", "bogus"],
    "cw: Usage: cw.js gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json]\n",
    repo
  );
  assertUsage(
    ["orphans", "bogus"],
    'cw: Usage: cw.js orphans list [--scope repo|home] [--json] | orphans gc [--scope repo|home] [--min-age-minutes N] [--all] [--json]  (scope defaults to home: every registered repo)\n',
    repo
  );
  assertUsage(
    ["clones", "bogus"],
    "cw: Usage: cw.js clones list [--json] | clones gc [--older-than-days N] [--all] [--json]\n",
    repo
  );

  // Domain errors (exact template strings, not usage lines).
  const badKind = run(["schedule", "create", "--prompt", "x", "--kind", "bogus"], { cwd: repo });
  assert.equal(badKind.status, 1);
  assert.equal(badKind.stderr, "cw: Unsupported schedule kind: bogus\n");

  const missingPrompt = run(["schedule", "create"], { cwd: repo });
  assert.equal(missingPrompt.status, 1);
  assert.equal(missingPrompt.stderr, "cw: Missing required prompt\n");

  const cronNoCron = run(["schedule", "create", "--prompt", "x", "--kind", "cron"], { cwd: repo });
  assert.equal(cronNoCron.status, 1);
  assert.equal(cronNoCron.stderr, "cw: cron schedule requires --cron\n");

  const cronBadFields = run(["schedule", "create", "--prompt", "x", "--kind", "cron", "--cron", "* * *"], { cwd: repo });
  assert.equal(cronBadFields.status, 1);
  assert.equal(cronBadFields.stderr, "cw: Only 5-field cron expressions are supported\n");

  // schedule delete on an unknown id is NOT an error (returns {deleted:false});
  // schedule pause/resume/complete/run-now on an unknown id DOES throw.
  const scheduleDeleteMissing = run(["schedule", "delete", "no-such-id", "--json"], { cwd: repo });
  assert.equal(scheduleDeleteMissing.status, 0);
  assert.deepEqual(JSON.parse(scheduleDeleteMissing.stdout), { deleted: false, id: "no-such-id" });

  const schedulePauseMissing = run(["schedule", "pause", "no-such-id"], { cwd: repo });
  assert.equal(schedulePauseMissing.status, 1);
  assert.equal(schedulePauseMissing.stderr, "cw: Scheduled task not found: no-such-id\n");

  const routineBadKind = run(["routine", "create", "--prompt", "x", "--kind", "bogus"], { cwd: repo });
  assert.equal(routineBadKind.status, 1);
  assert.equal(routineBadKind.stderr, "cw: Unsupported routine trigger kind: bogus\n");

  const queueNotFound = run(["queue", "show", "no-such-id"], { cwd: repo });
  assert.equal(queueNotFound.status, 1);
  assert.equal(queueNotFound.stderr, "cw: Queue entry not found: no-such-id\n");

  // A negative number must be passed as --flag=value (a bare "--flag -1"
  // would let the arg parser treat "-1" as another flag token).
  const badMinAge = run(["orphans", "gc", "--min-age-minutes=-1"], { cwd: repo });
  assert.equal(badMinAge.status, 1);
  assert.equal(badMinAge.stderr, "cw: --min-age-minutes must be a non-negative number (got -1)\n");

  const badOlderThan = run(["clones", "gc", "--older-than-days=-1"], { cwd: repo });
  assert.equal(badOlderThan.status, 1);
  assert.equal(badOlderThan.stderr, "cw: --older-than-days must be a non-negative number (got -1)\n");

  const badNow = run(["orphans", "list", "--now", "not-a-date"], { cwd: repo });
  assert.equal(badNow.status, 1);
  assert.equal(badNow.stderr, "cw: --now must be a valid ISO date (got not-a-date)\n");
});
