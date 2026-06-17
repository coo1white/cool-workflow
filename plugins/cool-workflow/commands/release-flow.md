---
description: Portable gated release flow — deterministic gate + vendor-agnostic independent reviewer, runnable from any harness.
---

Run the cool-workflow portable release flow. This is the multi-platform sibling
of `/release`: the orchestration lives in one zero-dependency script and the
independent review is DELEGATED to whatever agent you configure, so the exact
same flow runs under Claude, Codex, Gemini, OpenCode, or a plain shell.

Steps:

1. Configure the reviewer agent for THIS host (Claude):

   ```bash
   export CW_AGENT_COMMAND="claude -p --permission-mode acceptEdits {{input}}"
   export CW_AGENT_MODEL="claude-opus-4-8"   # optional; the agent picks otherwise
   # acceptEdits lets the headless reviewer WRITE its verdict file; without it the
   # review runs but the verdict can't be persisted and the flow fails closed at
   # [3/3]. The reviewer CLI must also be logged in (claude auth login).
   ```

2. Run the flow in check mode (gate + independent review, no mutation):

   ```bash
   node plugins/cool-workflow/scripts/release-flow.js --check
   ```

   It runs `scripts/release-gate.sh`, then spawns the configured agent
   (argv-style, shell:false — CW holds no key) to review the candidate and write
   `.cw-release/review-<HEAD>.verdict`. The flow fails closed unless the verdict
   begins with `APPROVED`.

3. To actually cut a tag once review is green:

   ```bash
   node plugins/cool-workflow/scripts/release-flow.js --cut --version <x.y.z> [--push]
   ```

Report the JSON summary (`verdict`, `capability`, `tagged`) and stop at the
first failure. Do not write the verdict file yourself — the delegated reviewer
is the only writer, and `release-gate.yml` re-checks it in CI.

See `docs/release-tooling.7.md` for the per-platform `CW_AGENT_COMMAND` presets
(Codex / Gemini / OpenCode / DeepSeek).
