#!/usr/bin/env node

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
// A drive that cannot finish stops with exit 2 and a JSON report (batch 5,
// 2026-11-12: `cw -q` is the one drive entry; the step verbs are gone).

import fs from "node:fs";
import path from "node:path";
import { run, gitRepo, caseMain, assert } from "../lib.mjs";

// PATH is deliberately narrow so no vendor CLI (claude/codex/opencode/...)
// and not even `node` can be found on it — this can never reach a network.
// cw still needs git to see the project. On Windows git is not in /usr/bin,
// so the narrow PATH there is git's own folder alone.
const NARROW_PATH = { PATH: process.platform === "win32" ? gitFolder() : "/usr/bin:/bin" };

function gitFolder() {
  const dir = (process.env.PATH || "").split(";").find((d) => d && fs.existsSync(path.join(d, "git.exe")));
  if (!dir) throw new Error("cli-vendor-flags: git.exe is not on PATH");
  return dir;
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  // No agent backend at all: fails closed. Status "blocked",
  // agentConfigured:false, and a hint naming CW_AGENT_COMMAND/--agent-command.
  const noAgent = run(["-q", "hi", "--json"], {
    cwd: repo,
    env: NARROW_PATH,
  });
  assert.equal(noAgent.status, 2);
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
  for (const flag of ["-claude", "-codex", "-gemini", "-opencode", "-deepseek", "-muse", "-copilot", "-antigravity", "-grok"]) {
    const r = run(["-q", "hi", flag, "--json"], {
      cwd: repo,
      env: NARROW_PATH,
    });
    assert.equal(r.status, 2, `${flag}: exit 2 (a stopped drive is still a valid JSON report, not a crash)`);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.agentConfigured, true, `${flag} must set agentConfigured:true`);
    assert.notEqual(payload.status, "complete", `${flag}: the mapped command cannot actually run under a narrow PATH`);
    assert.ok(payload.runId, `${flag}: a run id must still be minted`);
  }

  // -a / --agent-command short alias: passing an explicit (bogus) command
  // template directly also flips agentConfigured to true, the same way.
  const explicit = run(
    ["-q", "hi", "-a", "node /no/such/agent.js {{input}} {{result}}", "--json"],
    { cwd: repo, env: NARROW_PATH }
  );
  assert.equal(explicit.status, 2);
  const explicitPayload = JSON.parse(explicit.stdout);
  assert.equal(explicitPayload.agentConfigured, true);
});
