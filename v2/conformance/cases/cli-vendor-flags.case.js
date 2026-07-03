#!/usr/bin/env node
"use strict";

// cli-vendor-flags — the vendor short flags -claude/-codex/-gemini/-deepseek
// rewrite --agent-command to "builtin:<vendor>" (SPEC/cli-surface.md
// "Vendor short flags map to --agent-command"). Proven black-box, with NO
// network and NO real agent call, by restricting PATH so the mapped
// command can never actually be found/succeed: with no agent flag at all,
// a drive comes back blocked/agentConfigured:false (fails closed, never
// fabricates a completion); with any vendor flag, agentConfigured flips to
// true because SOME command template is now configured, even though the
// underlying spawn then fails fast (ENOENT) — proving the flag rewired
// the option without needing the vendor CLI to be installed or reachable.
//
// Uses the 1-worker end-to-end-golden-path app to stay fast: a single
// task blocks/parks instead of running architecture-review's 14 workers.

const { run, gitRepo, caseMain, assert } = require("../lib");

// PATH is deliberately narrow so no vendor CLI (claude/codex/opencode/...)
// and not even `node` can be found on it — this can never reach a network.
const NARROW_PATH = { PATH: "/usr/bin:/bin" };

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  // No agent backend at all: fails closed. Status "blocked",
  // agentConfigured:false, and a hint naming CW_AGENT_COMMAND/--agent-command.
  const noAgent = run(["run", "end-to-end-golden-path", "--drive", "--question", "hi", "--json"], {
    cwd: repo,
    env: NARROW_PATH,
  });
  assert.equal(noAgent.status, 0);
  const noAgentPayload = JSON.parse(noAgent.stdout);
  assert.equal(noAgentPayload.agentConfigured, false);
  assert.equal(noAgentPayload.status, "blocked");
  const blockedStep = noAgentPayload.steps.find((s) => s.action === "blocked");
  assert.ok(blockedStep, "must have a blocked step");
  assert.match(blockedStep.reason, /agent backend not configured/);
  assert.match(blockedStep.reason, /CW_AGENT_COMMAND/);
  assert.match(blockedStep.reason, /--agent-command/);

  // Each vendor flag rewrites options["agent-command"] to "builtin:<vendor>"
  // — proven because agentConfigured flips to true, and a run id is still
  // minted (never fabricated as complete), even though the mapped command
  // then fails to spawn under the narrowed PATH.
  for (const flag of ["-claude", "-codex", "-gemini", "-deepseek"]) {
    const r = run(["run", "end-to-end-golden-path", flag, "--drive", "--question", "hi", "--json"], {
      cwd: repo,
      env: NARROW_PATH,
    });
    assert.equal(r.status, 0, `${flag}: exit 0 (a failed drive is still a valid JSON report, not a crash)`);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.agentConfigured, true, `${flag} must set agentConfigured:true`);
    assert.notEqual(payload.status, "complete", `${flag}: the mapped command cannot actually run under a narrow PATH`);
    assert.ok(payload.runId, `${flag}: a run id must still be minted`);
  }

  // -a / --agent-command short alias: passing an explicit (bogus) command
  // template directly also flips agentConfigured to true, the same way.
  const explicit = run(
    ["run", "end-to-end-golden-path", "-a", "node /no/such/agent.js {{input}} {{result}}", "--drive", "--question", "hi", "--json"],
    { cwd: repo, env: NARROW_PATH }
  );
  assert.equal(explicit.status, 0);
  const explicitPayload = JSON.parse(explicit.stdout);
  assert.equal(explicitPayload.agentConfigured, true);
});
