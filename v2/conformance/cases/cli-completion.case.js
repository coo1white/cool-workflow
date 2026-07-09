#!/usr/bin/env node
"use strict";

// cw completion <bash|zsh|fish> — a static shell-completion script for the
// top-level command word list. CLI-only (core/format/completion.ts),
// jsonMode:"human" (never JSON, a shell script has no JSON form). Pins:
// exit codes, the "Missing shell name"/"Unknown shell" error shapes, that
// every one of the 3 supported shells' output actually names the real
// `cw` binary and includes the real command word list (not a stale hand-
// copy — core/format/completion.ts builds it from the SAME
// MORE_COMMANDS_TOKENS formatHelp()'s "More commands" section displays),
// and that stdout carries no JSON under --json (jsonMode:"human" ignores
// the flag, same as `cw fix`).

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  // --- missing shell name ---
  const missing = run(["completion"]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, "cw: Missing shell name.\n  Try: cw completion bash|zsh|fish\n");

  // --- unrecognized shell name ---
  const bad = run(["completion", "powershell"]);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.equal(bad.stderr, "cw: Unknown shell: powershell\n  Try: cw completion bash|zsh|fish\n");

  // --- each supported shell: exit 0, real content, real command word list ---
  for (const shell of ["bash", "zsh", "fish"]) {
    const result = run(["completion", shell]);
    assert.equal(result.status, 0, `completion ${shell} exits 0`);
    assert.equal(result.stderr, "", `completion ${shell} writes nothing to stderr`);
    assert.match(result.stdout, /\bcw\b/, `completion ${shell} mentions the real cw binary`);
    // Every one of these tokens must appear somewhere in the script —
    // proves the word list is the real MORE_COMMANDS_TOKENS set, not a
    // stale or truncated hand-copy.
    for (const token of ["quickstart", "doctor", "audit-run", "completion"]) {
      assert.ok(result.stdout.includes(token), `completion ${shell} includes the "${token}" word`);
    }
  }

  // --- shell-specific shape spot checks ---
  const bash = run(["completion", "bash"]).stdout;
  assert.match(bash, /complete -F _cw_complete cw/, "bash script registers a completion function for cw");
  assert.match(bash, /compgen -W/, "bash script uses compgen -W for the static word list");

  const zsh = run(["completion", "zsh"]).stdout;
  assert.match(zsh, /^#compdef cw/, "zsh script starts with the #compdef directive");

  const fish = run(["completion", "fish"]).stdout;
  assert.match(fish, /complete -c cw /, "fish script registers completions for the cw command");

  // --- jsonMode:"human" — --json is silently ignored, never JSON output ---
  const withJsonFlag = run(["completion", "bash", "--json"]);
  assert.equal(withJsonFlag.status, 0);
  assert.equal(withJsonFlag.stdout, bash, "--json has no effect on a human-only capability");
  assert.doesNotMatch(withJsonFlag.stdout, /^\s*[{[]/, "completion output is never JSON, even under --json");

  // --- "completion" is a real, suggestible top-level command ---
  const typo = run(["completon"]);
  assert.equal(typo.status, 1);
  assert.equal(typo.stderr, "cw: Unknown command: completon. Did you mean: completion?\n  Try: cw help\n");

  // --- discoverable via cw help ---
  const helpRoot = run(["help"]);
  assert.match(helpRoot.stdout, /\bcompletion\b/, "cw help's More commands section lists completion");

  const helpTopic = run(["help", "completion"]);
  assert.equal(helpTopic.status, 0);
  assert.match(helpTopic.stdout, /^cw completion\n/);
  assert.match(helpTopic.stdout, /bash, zsh, or fish/);
});
