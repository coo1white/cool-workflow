#!/usr/bin/env node
// cli-arg-parsing-smoke — guards parseArgv's "a flag's value is never another flag"
// invariant. A valueless double-dash flag used to greedily swallow the FOLLOWING
// single-dash flag (the double-dash value check only rejected a `--`-leading next token),
// so `run app --drive -dir /p` set drive="-dir" and dropped -dir entirely — breaking
// `-dir`/`-d`/`-r` whenever they trailed a boolean `--flag`. This asserts the fix AND the
// escape hatches (`--key=-value`, `--`) that keep a legitimately dash-leading value usable.

import assert from "node:assert/strict";
import path from "node:path";
// v2: parseArgv moved from the flat dist/orchestrator.js facade into dist/cli/parseargv.js.
import { parseArgv } from "../dist/cli/parseargv.js";
import * as parseargvModule from "../dist/cli/parseargv.js";
import * as helpModule from "../dist/core/format/help.js";
import childProcessModule from "node:child_process";
import fsModule from "node:fs";
import { tmpDir } from "./helpers/workspace.mjs";

// 1. The regression: `--quiet` (boolean) must NOT consume the following `-dir` flag.
{
  const a = parseArgv(["report", "some-run", "--quiet", "-dir", "/p"]);
  assert.equal(a.command, "report");
  assert.deepEqual(a.positionals, ["some-run"]);
  assert.equal(a.options.quiet, true, "--quiet stays a boolean flag (must not swallow -dir)");
  assert.equal(a.options.dir, "/p", "-dir is parsed as its own flag with its value");
  console.log("argparse: a boolean --quiet does not swallow a trailing -dir ok");
}

// 2. Same for every single-dash alias trailing a boolean flag (-d, -r, -q -> dir/repo/question).
for (const [flag, key] of [["-d", "dir"], ["-r", "repo"], ["-q", "question"]]) {
  const a = parseArgv(["report", "--quiet", flag, "value"]);
  assert.equal(a.options.quiet, true, `--quiet stays boolean before ${flag}`);
  assert.equal(a.options[key], "value", `${flag} -> options.${key}=value even after a boolean flag`);
}
console.log("argparse: a boolean flag never swallows a trailing -d/-r/-q ok");

// 3. A double-dash flag with a real (non-dash) value still consumes it (no over-correction).
{
  const a = parseArgv(["report", "--repo", "/x", "--question", "hello"]);
  assert.equal(a.options.repo, "/x", "--repo still consumes its path value");
  assert.equal(a.options.question, "hello", "--question still consumes its value");
}
console.log("argparse: --flag still consumes a normal (non-dash) value ok");

// 4. Escape hatches for a value that legitimately starts with `-`.
{
  const eq = parseArgv(["report", "--question=-weird"]);
  assert.equal(eq.options.question, "-weird", "--key=-value preserves a dash-leading value");
  const dd = parseArgv(["check", "--", "-weird"]);
  assert.ok(dd.positionals.includes("-weird"), "`--` end-of-options passes a dash-leading token through as a positional");
}
console.log("argparse: --key=-value and -- escape hatches keep dash-leading values usable ok");

// 5. Regression: the dead `update` verb must not come back. The old build's help
// offered `update` and KNOWN_COMMANDS had it, but no dispatch arm was behind it —
// so `cw update` said "Unknown command: update. Did you mean: update?" (a hint
// that points at itself) and `cw help` offered a verb that could not run. Guard
// both surfaces, then pin the general rule: every "did you mean" candidate must
// be a verb the help text offers ("help" itself is the one pass — the reader is
// already looking at the help). The parity smoke's helpUndeclaredCliTokens check
// then ties help tokens to real dispatch rows, closing the loop.
{
  const { KNOWN_COMMANDS } = parseargvModule;
  const { formatHelp } = helpModule;
  const helpText = formatHelp();
  const helpTokens = new Set(helpText.split(/[\s|]+/));
  assert.ok(!KNOWN_COMMANDS.has("update"), "KNOWN_COMMANDS must not have the dead `update` verb");
  assert.ok(!helpTokens.has("update"), "cw help must not offer the dead `update` verb");
  for (const cmd of KNOWN_COMMANDS) {
    if (cmd === "help") continue;
    assert.ok(helpTokens.has(cmd), `did-you-mean candidate "${cmd}" must be a verb the help text offers`);
  }
}
console.log("argparse: no dead verb in KNOWN_COMMANDS or cw help (update stays gone) ok");


// suggestCommand never suggests its own input back. A caller only asks for a
// suggestion when the input did NOT resolve, so a distance-0 self-match (an
// alias token like "audit-run" that IS in KNOWN_COMMANDS but had no help rows)
// used to make `cw help audit-run` say "Did you mean: cw audit-run" — a hint
// pointing at the very word the user just typed.
{
  const { suggestCommand, KNOWN_COMMANDS } = parseargvModule;
  for (const cmd of KNOWN_COMMANDS) {
    assert.notEqual(suggestCommand(cmd), cmd, `suggestCommand("${cmd}") must never suggest the input itself`);
  }
  // The near-typo path is untouched: a close misspelling still gets its hint.
  assert.equal(suggestCommand("versio"), "version", "a near-typo still gets its suggestion");
  assert.equal(suggestCommand("repot"), "report", "a near-typo still gets its suggestion");
  // A word far from every verb gets no suggestion.
  assert.equal(suggestCommand("audit-run"), undefined, "audit-run gets no suggestion");
}
console.log("argparse: suggestCommand never points at its own input ok");

// 7. Help says `cw --resume --run <id>` — the line must be accepted as typed
// (not "Unknown command: --resume"), and `--resume --run <id> --repo <path>`
// must find the run from a different folder.
{
  const { spawnSync } = childProcessModule;
  const fs = fsModule;
  const cli = path.resolve(import.meta.dirname, "..", "dist", "cli.js");
  const env = { ...process.env, CW_NO_AUTO_AGENT: "1" };
  delete env.CW_AGENT_COMMAND;
  delete env.CW_AGENT_ENDPOINT;
  const repo = tmpDir("cw-resume-flag-");
  fs.writeFileSync(path.join(repo, "README.md"), "# t\n", "utf8");
  spawnSync("git", ["init", "-q"], { cwd: repo });
  // No agent: the run is planned, then stops blocked (exit 2).
  const planned = spawnSync(process.execPath, [cli, "-q", "q", "--json"], { cwd: repo, encoding: "utf8", env });
  assert.equal(planned.status, 2, planned.stderr);
  const runId = JSON.parse(planned.stdout).runId;
  const resumed = spawnSync(process.execPath, [cli, "--resume", "--run", runId, "--json"], { cwd: repo, encoding: "utf8", env });
  assert.doesNotMatch(resumed.stderr || "", /Unknown command/, "cw --resume --run <id> is accepted as the help says");
  assert.equal(JSON.parse(resumed.stdout).runId, runId, "--resume --run <id> reaches the same run");
  const elsewhere = tmpDir("cw-resume-elsewhere-");
  const found = spawnSync(process.execPath, [cli, "--resume", "--run", runId, "--repo", repo, "--json"], { cwd: elsewhere, encoding: "utf8", env });
  assert.doesNotMatch(found.stderr || "", /not found/, "--resume --run <id> --repo <path> finds the run from another folder");
  assert.equal(JSON.parse(found.stdout).runId, runId, "--resume --repo <path> reaches the same run");
}
console.log("argparse: --resume and --resume --repo lookup ok");

console.log("cli-arg-parsing-smoke: ok");
