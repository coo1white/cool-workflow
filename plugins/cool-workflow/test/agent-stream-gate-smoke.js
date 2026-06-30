#!/usr/bin/env node
// @cw-smoke: tags fast
// agent-stream-gate-smoke — the parent-side gate that decides whether cw FORWARDS
// the agent wrapper's live stderr view (stdio "inherit") or captures it ("pipe").
//
// The man page (agent-delegation-drive.7.md "Live output") promises:
//   - Non-TTY stays SILENT by default (Rule of Silence).
//   - CW_AGENT_STREAM=1 opts a CI/piped run into a plain append-only trace.
// The old inline gate AND-ed on isTTY, so CW_AGENT_STREAM=1 was swallowed in a
// pipe — code contradicting its own contract. This locks the documented matrix,
// including the previously-broken (CW_AGENT_STREAM=1, non-TTY) -> true case, while
// keeping the env-unset default byte-identical to the prior gate (POLA).

const assert = require("node:assert");
const { shouldStreamAgentStderr } = require("../dist/execution-backend.js");

let passed = 0;
function check(env, isTTY, expected, why) {
  const got = shouldStreamAgentStderr(env, isTTY);
  assert.strictEqual(got, expected, `${why}: env=${JSON.stringify(env)} isTTY=${isTTY} -> expected ${expected}, got ${got}`);
  passed += 1;
}

// Default (no env): follow isTTY — byte-identical to the prior inline gate.
check({}, true, true, "default TTY streams");
check({}, false, false, "default non-TTY silent (Rule of Silence)");

// Explicit opt-in: honored regardless of TTY — THE FIX (non-TTY case failed before).
check({ CW_AGENT_STREAM: "1" }, false, true, "CW_AGENT_STREAM=1 forces on in a pipe");
check({ CW_AGENT_STREAM: "1" }, true, true, "CW_AGENT_STREAM=1 stays on on a TTY");

// Explicit opt-out: off on a TTY too.
check({ CW_AGENT_STREAM: "0" }, true, false, "CW_AGENT_STREAM=0 forces off");
check({ CW_NO_STREAM: "1" }, true, false, "CW_NO_STREAM=1 forces off");

// CW_NO_STREAM=1 is the master kill switch — wins over CW_AGENT_STREAM=1.
check({ CW_AGENT_STREAM: "1", CW_NO_STREAM: "1" }, false, false, "CW_NO_STREAM=1 beats CW_AGENT_STREAM=1");

// A non-canonical value is not the opt-in token: falls back to isTTY.
check({ CW_AGENT_STREAM: "2" }, false, false, "only the exact \"1\" opts in");

console.log(`agent-stream-gate-smoke: ok (${passed} cases — default=isTTY, CW_AGENT_STREAM=1 honored in non-TTY, CW_NO_STREAM master off)`);
