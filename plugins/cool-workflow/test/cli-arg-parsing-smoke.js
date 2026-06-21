#!/usr/bin/env node
"use strict";

// cli-arg-parsing-smoke — guards parseArgv's "a flag's value is never another flag"
// invariant. A valueless double-dash flag used to greedily swallow the FOLLOWING
// single-dash flag (the double-dash value check only rejected a `--`-leading next token),
// so `run app --drive -dir /p` set drive="-dir" and dropped -dir entirely — breaking
// `-dir`/`-d`/`-r` whenever they trailed a boolean `--flag`. This asserts the fix AND the
// escape hatches (`--key=-value`, `--`) that keep a legitimately dash-leading value usable.

const assert = require("node:assert/strict");
const path = require("node:path");
const { parseArgv } = require(path.resolve(__dirname, "..", "dist", "orchestrator.js"));

// 1. The regression: `--drive` (boolean) must NOT consume the following `-dir` flag.
{
  const a = parseArgv(["run", "architecture-review", "--drive", "-dir", "/p"]);
  assert.equal(a.command, "run");
  assert.deepEqual(a.positionals, ["architecture-review"]);
  assert.equal(a.options.drive, true, "--drive stays a boolean flag (must not swallow -dir)");
  assert.equal(a.options.dir, "/p", "-dir is parsed as its own flag with its value");
  console.log("argparse: a boolean --drive does not swallow a trailing -dir ok");
}

// 2. Same for every single-dash alias trailing a boolean flag (-d, -r, -q -> dir/repo/question).
for (const [flag, key] of [["-d", "dir"], ["-r", "repo"], ["-q", "question"]]) {
  const a = parseArgv(["run", "app", "--drive", flag, "value"]);
  assert.equal(a.options.drive, true, `--drive stays boolean before ${flag}`);
  assert.equal(a.options[key], "value", `${flag} -> options.${key}=value even after a boolean flag`);
}
console.log("argparse: a boolean flag never swallows a trailing -d/-r/-q ok");

// 3. A double-dash flag with a real (non-dash) value still consumes it (no over-correction).
{
  const a = parseArgv(["quickstart", "--repo", "/x", "--question", "hello"]);
  assert.equal(a.options.repo, "/x", "--repo still consumes its path value");
  assert.equal(a.options.question, "hello", "--question still consumes its value");
}
console.log("argparse: --flag still consumes a normal (non-dash) value ok");

// 4. Escape hatches for a value that legitimately starts with `-`.
{
  const eq = parseArgv(["quickstart", "--question=-weird"]);
  assert.equal(eq.options.question, "-weird", "--key=-value preserves a dash-leading value");
  const dd = parseArgv(["quickstart", "--", "-weird"]);
  assert.ok(dd.positionals.includes("-weird"), "`--` end-of-options passes a dash-leading token through as a positional");
}
console.log("argparse: --key=-value and -- escape hatches keep dash-leading values usable ok");

console.log("cli-arg-parsing-smoke: ok");
