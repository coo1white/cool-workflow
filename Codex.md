# Codex Operating Notes

This file is the repo-local operating guide for Codex work on Cool Workflow. It
does not replace `AGENTS.md`; it gives the short checklist to load before a run.

## Stack

- Runtime: Node.js 18+ with zero runtime dependencies.
- Language: TypeScript in `plugins/cool-workflow/src`, compiled to committed
  CommonJS in `plugins/cool-workflow/dist`.
- CLI entrypoints: `plugins/cool-workflow/scripts/cw.js` and
  `plugins/cool-workflow/scripts/mcp-server.js`.
- State: plain files under `.cw/`; no hidden database.
- Agent execution: external wrappers and commands; CW delegates and records.

## Commands

Run commands from `plugins/cool-workflow` unless noted.

```bash
npm run build
npm test
npm run gen:manifests -- --check
npm run index:check
node scripts/source-context.js export --profile core --ref HEAD > /tmp/cw-core.jsonl
node scripts/source-context.js manifest --profile core --ref HEAD > /tmp/cw-manifest.jsonl
```

Use worktrees for parallel runs. Do not run parallel agents in one shared
checkout when they may edit files.

## Code Style

- Match the surrounding file exactly.
- Keep kernel mechanisms in `src/`; policy belongs in apps, manifest data,
  scripts, wrappers, env, or docs.
- stdout is data; diagnostics go to stderr.
- Fail closed on invalid input, stale state, missing config, or unverifiable
  records.
- Prefer small scripts and plain JSON/JSONL over framework state.

## Forbidden Files

Do not include these in the default core source context:

- `plugins/cool-workflow/dist/**`
- `plugins/cool-workflow/test/**`
- `plugins/cool-workflow/docs/**`
- `docs/assets/**`
- `.cw-release/**`
- `CHANGELOG.md`
- `ITERATION_LOG.md`

Do not edit committed `dist/` unless the matching `src/` change requires a
build artifact update. Do not edit release records or changelog/history files
unless the task explicitly calls for release/log maintenance.

## Review Rules

- Maker writes the change in an isolated worktree.
- Verifier runs the app, tests, screenshots for UI work, and log capture.
- UI changes require screenshots; text logs are not enough.
- Long-running CI/PR/digest jobs should become routines instead of chat-only
  instructions.
- Send expensive work to stronger models only when the task justifies it:
  GPT 5.5 high for difficult implementation/review, GPT 5.5 Extra high for
  high-risk design or release verification.
- End every run by writing the lesson back to `PROJECT_MEMORY.md`, an eval case,
  a skill, or a tracked doc. A fix that stays only in chat dies there.
