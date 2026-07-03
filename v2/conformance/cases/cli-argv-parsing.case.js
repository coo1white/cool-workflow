#!/usr/bin/env node
"use strict";

// cli-argv-parsing — parseArgv rules pinned black-box through `cw search`,
// whose positionals are joined into one keyword string (space-joined) and
// printed back in "No workflows matched "<kw>"." on a miss. This makes the
// parsed positionals/options observable without reading any source.
//
// Rules covered (src/orchestrator.ts:789-838, see SPEC/cli-surface.md):
// - a bare --flag never eats a dash-leading next token (value becomes true,
//   and the dash-leading token stays a positional / or is itself parsed as
//   another flag)
// - --key=value can hold a value that starts with a dash
// - `--` is the end-of-options mark: every later token is a positional,
//   even ones that start with `--`
// - repeated options collect into an array (proven via `ledger list --dir`)
// - short-alias table q/r/d/l/a/h/v and the `-dir` "keeps its own name" rule

const fs = require("node:fs");
const path = require("node:path");
const { run, freshDir, caseMain, assert } = require("../lib");

caseMain(() => {
  // A bare --flag takes the NEXT token as its value only when that token
  // does not start with a dash. Here "app" is swallowed as --foo's value,
  // so search gets ZERO keyword positionals and must throw "Missing search
  // keyword" rather than searching for "app".
  const swallowed = run(["search", "--foo", "app"]);
  assert.equal(swallowed.status, 1);
  assert.equal(swallowed.stderr, 'cw: Missing search keyword.\n  Tip: cw search architecture to find workflows about architecture.\n');

  // When the token AFTER a bare flag starts with a dash, the flag's value
  // is `true` and that dash-leading token is parsed on its own as another
  // flag (never as a positional). Put the keyword BEFORE the dash-leading
  // flag so it lands as the one true positional, showing --foo did not
  // reach past its own boundary and eat "app".
  const notSwallowed = run(["search", "app", "--foo", "--bar"]);
  assert.equal(notSwallowed.status, 0);
  assert.match(notSwallowed.stdout, /matching "app"/);

  // --key=value form: the value may itself start with a dash and is NOT
  // reinterpreted as a flag. Proven the same way: "--foo=-bar" leaves the
  // one true positional "app" intact for the search keyword.
  const eqDash = run(["search", "app", "--foo=-bar"]);
  assert.equal(eqDash.status, 0);
  assert.match(eqDash.stdout, /matching "app"/);

  // `--` ends option parsing: every later token is a positional, even one
  // that starts with `--`. Both "--foo" and "bar" become search keywords
  // and are space-joined into one string.
  const dashdash = run(["search", "--", "--foo", "bar"]);
  assert.equal(dashdash.status, 0);
  assert.equal(dashdash.stdout, 'No workflows matched "--foo bar".\n  Tip: cw list for all available workflows.\n');

  // Repeated options become an array: `ledger list` prints a "dir" (single
  // string) key with ONE --dir, and switches to a "dirs" (array) key plus
  // per-entry "dirs" with two or more --dir. This is appendOption, proven
  // through real JSON shape, not source.
  const dir = freshDir("ledgerdir");
  fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify({ schemaVersion: 1, kind: "proposal", id: "x" }) + "\n");

  const oneDir = run(["ledger", "list", "--dir", dir]);
  const oneDirPayload = JSON.parse(oneDir.stdout);
  assert.equal(oneDirPayload.dir, dir);
  assert.equal(oneDirPayload.dirs, undefined);

  const twoDir = run(["ledger", "list", "--dir", dir, "--dir", dir]);
  const twoDirPayload = JSON.parse(twoDir.stdout);
  assert.deepEqual(twoDirPayload.dirs, [dir, dir]);
  assert.equal(twoDirPayload.count, 2);

  // Short-alias table: -q/-r/-d/-l/-a/-h/-v map to question/repo/dir/link/
  // agent-command/help/version. -h and -v are checked as top-level redirects
  // elsewhere (cli-help-topics + cli-exit-codes cases); here we pin that an
  // unknown single-dash name (not in the table) keeps its OWN name, proven
  // through -dir vs --repo precedence: an explicit --repo always wins over
  // -dir, and -dir alone is used as the repo when --repo is absent. Both
  // sides fail the same way (ENOENT on a nonexistent repo path) which is
  // enough to show which path string was actually used as the repo.
  const dirOnly = run(["-q", "hello", "-dir", "/no/such/repo-xyz-only", "--json"]);
  assert.equal(dirOnly.status, 1);
  assert.match(dirOnly.stderr, /\/no\/such\/repo-xyz-only/);

  const repoWinsOverDir = run(["-q", "hello", "--repo", "/no/such/repo-A", "-dir", "/no/such/repo-B", "--json"]);
  assert.equal(repoWinsOverDir.status, 1);
  assert.match(repoWinsOverDir.stderr, /\/no\/such\/repo-A/);
  assert.doesNotMatch(repoWinsOverDir.stderr, /repo-B/);
});
