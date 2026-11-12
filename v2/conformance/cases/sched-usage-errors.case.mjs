#!/usr/bin/env node

// Byte-exact usage-error strings for every command family in this area.
// An unknown/missing subcommand must print the fixed "Usage: cw ..."
// line to stderr and exit 1, stdout empty. These strings are pinned
// verbatim in the spec's "Exact outputs" section.

import { run, gitRepo, caseMain, assert } from "../lib.mjs";

function assertUsage(args, expectedStderr, cwd) {
  const r = run(args, { cwd });
  assert.equal(r.status, 1, `${args.join(" ")} must exit 1`);
  assert.equal(r.stdout, "", `${args.join(" ")} must write nothing to stdout`);
  assert.equal(r.stderr, expectedStderr, `${args.join(" ")} stderr mismatch`);
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  assertUsage(["registry", "bogus"], "cw: Usage: cw registry refresh|show [--scope repo|home] [--json]\n", repo);
  assertUsage(["queue", "bogus"], "cw: Usage: cw queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]\n", repo);

  // Domain errors (exact template strings, not usage lines).
  const queueNotFound = run(["queue", "show", "no-such-id"], { cwd: repo });
  assert.equal(queueNotFound.status, 1);
  assert.equal(queueNotFound.stderr, "cw: Queue entry not found: no-such-id\n");
});
