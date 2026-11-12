#!/usr/bin/env node

// cli-usage-strings — each kept group command's fixed usage or "requires"
// text, thrown on stderr (as "cw: ...") when it gets a wrong or missing
// word. Byte-pinned, repo-free, agent-free, and cheap. The ~30 families of
// the old build went with their verbs in batch 5 (2026-11-12); what is left
// is demo, check and report.

import { run, caseMain, assert } from "../lib.mjs";

caseMain(() => {
  const cases = [
    [["demo", "bogus-action-word"], "cw: Usage: cw demo tamper [--json]\n"],
    [["check", "show"], "cw: Usage: cw check show <receipt-id>  (see the ids with: cw check list)\n"],
    [["report", "bundle"], "cw: report bundle requires a run id (cw report bundle <run-id>)\n"],
    [["report", "verify-bundle"], "cw: report verify-bundle requires a bundle path (positional, --archive, --path, --file, or --bundle)\n"],
  ];

  for (const [args, stderr] of cases) {
    const r = run(args);
    assert.equal(r.status, 1, `${args.join(" ")}: exit 1`);
    assert.equal(r.stdout, "", `${args.join(" ")}: nothing on stdout`);
    assert.equal(r.stderr, stderr, `${args.join(" ")}: exact usage text`);
  }

  // `cw check <word>` that is not list/show runs <word> as a program: one
  // not on PATH is an error with no receipt, never a usage line.
  const notOnPath = run(["check", "bogus-program-xyz"]);
  assert.equal(notOnPath.status, 1);
  assert.equal(notOnPath.stdout, "");
  assert.match(notOnPath.stderr, /^cw: command not found: bogus-program-xyz \(cw check runs it with no shell/);
});
