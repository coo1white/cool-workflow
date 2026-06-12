# Project Memory

This is the repo-local memory for Cool Workflow agent runs. Keep it factual,
short, and append-friendly. Do not use it for speculation.

## Verified Facts

- Default context slimming must use the `core` source profile.
- The `core` profile includes:
  - `plugins/cool-workflow/src/**`
  - `plugins/cool-workflow/apps/**`
  - `plugins/cool-workflow/package.json`
  - `plugins/cool-workflow/tsconfig.json`
  - `plugins/cool-workflow/scripts/cw.js`
  - `plugins/cool-workflow/scripts/mcp-server.js`
  - `plugins/cool-workflow/scripts/agents/**`
- The `core` profile excludes:
  - `plugins/cool-workflow/dist/**`
  - `plugins/cool-workflow/test/**`
  - `plugins/cool-workflow/docs/**`
  - `docs/assets/**`
  - `.cw-release/**`
  - `CHANGELOG.md`
  - `ITERATION_LOG.md`
- Excluding `dist/` from the context pack is allowed; deleting committed `dist/`
  is a separate release-contract decision.
- Context slimming is opt-in and must not change existing CW command output.

## Failed Attempts

- Do not treat `.jsonl` slimming, god-object refactors, and physical repository
  line-count reduction as the same task. They have different risk profiles.
- Do not silently omit files from an AI context pack. Omitted files need a
  manifest entry with reason, size, line count, and digest.

## Last Session

- Decision: use a repo-local `core` JSONL source profile to cut default AI
  context roughly in half without deleting files or changing release behavior.
- Decision: use project memory, workflow skills, eval JSONL, maker/verifier
  separation, worktrees, screenshots for UI, routines for long jobs, and
  lesson-writeback as the standard operating method.

## Next Run

- Use `node plugins/cool-workflow/scripts/source-context.js export --profile core`
  to build the default source context.
- Use `node plugins/cool-workflow/scripts/source-context.js manifest --profile core`
  to prove what was included and omitted.
- When a repeated workflow improves, update the matching skill and add or revise
  `eval/<workflow>.jsonl`.
