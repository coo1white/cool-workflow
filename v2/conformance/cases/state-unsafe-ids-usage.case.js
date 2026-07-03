#!/usr/bin/env node
"use strict";

// assertSafeRunId's exact refusal message, and the fixed Usage: strings
// for the state/migration/node/summary subcommand families when given an
// unknown verb. These are cheap, high-value byte-exact checks: a rebuild
// that reformats any of them breaks operator scripts that grep stderr.

const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(r.status, 0);
  const runId = JSON.parse(r.stdout).runId;

  // ".." as a run id is refused outright (not silently resolved up a dir)
  const dotdot = run(["node", "snapshot", "..", "some-node"], { cwd: repo });
  assert.equal(dotdot.status, 1);
  assert.equal(
    dotdot.stderr,
    'cw: Unsafe run id: ".." must be a single path segment ([A-Za-z0-9._:-], not \'.\' or \'..\')\n' +
      "  Try: cw run list\n"
  );

  // a run id with an embedded ".." (not an exact "." or ".." component) is
  // ALLOWED through assertSafeRunId -- it just won't resolve to a real dir.
  const embedded = run(["node", "snapshot", `${runId}/../x`, "some-node"], { cwd: repo });
  assert.equal(embedded.status, 1);
  assert.match(embedded.stderr, /^cw: Unsafe run id: /, "a slash makes it multi-segment, still refused");

  // wrong subcommand -> fixed Usage: strings, exit 1, empty stdout
  const cases = [
    { args: ["state", "nope"], usage: "cw.js state check <run-id> [--state PATH] [--write]" },
    {
      args: ["migration", "nope"],
      usage: "cw.js migration list|check|prove [target] [--contract run-state|workflow-app]",
    },
    { args: ["summary", "nope"], usage: "cw.js summary refresh|show <run-id> [--json]" },
    { args: ["ledger", "nope"], usage: "cw ledger propose|review|verify|apply|list [options]" },
  ];
  for (const { args, usage } of cases) {
    const result = run(args, { cwd: repo });
    assert.equal(result.status, 1, `${args.join(" ")} must exit 1`);
    assert.equal(result.stdout, "", `${args.join(" ")} must print nothing on stdout`);
    assert.equal(result.stderr, `cw: Usage: ${usage}\n`, `${args.join(" ")} usage string`);
  }
});
