# Codex Operating Notes

This file is the repo-local guide for Codex work on Cool Workflow. It
does not take the place of `AGENTS.md`; it gives the short list to look at before a run.

## Stack

- Runtime: Node.js 18+ with no runtime dependencies at all.
- Language: TypeScript in `plugins/cool-workflow/src`, made into committed
  CommonJS in `plugins/cool-workflow/dist`.
- CLI entrypoints: `plugins/cool-workflow/scripts/cw.js` and
  `plugins/cool-workflow/scripts/mcp-server.js`.
- State: simple files under `.cw/`; no secret database.
- Agent execution: outside wrappers and commands; CW gives the work to others and keeps the records.

## Commands

Run commands from `plugins/cool-workflow` if it is not said to do other.

```bash
npm run build
npm test
npm run gen:manifests -- --check
npm run index:check
node scripts/source-context.js export --profile core --ref HEAD > /tmp/cw-core.jsonl
node scripts/source-context.js manifest --profile core --ref HEAD > /tmp/cw-manifest.jsonl
```

Use worktrees for runs at the same time. Do not run agents at the same time in one shared
checkout when they may make changes to files.

## Code Style

- Be the same as the file around it in every way.
- Keep kernel parts in `src/`; rules go in apps, manifest data,
  scripts, wrappers, env, or docs.
- stdout is data; news of errors goes to stderr.
- Fail closed on bad input, old state, missing config, or
  records you can not be certain of.
- It is better to use small scripts and simple JSON/JSONL than framework state.

## Forbidden Files

Do not put these in the default core source context:

- `plugins/cool-workflow/dist/**`
- `plugins/cool-workflow/test/**`
- `plugins/cool-workflow/docs/**`
- `docs/assets/**`
- `.cw-release/**`
- `CHANGELOG.md`
- `ITERATION_LOG.md`

Do not make changes to committed `dist/` if the matching `src/` change does not make
a build artifact update necessary. Do not make changes to release records or changelog/history files
if the task does not clearly say to do release/log keeping.

## Review Rules

- Maker writes the change in a worktree kept by itself.
- Verifier runs the app, tests, screenshots for UI work, and log keeping.
- UI changes need screenshots; text logs are not enough.
- CI/PR/digest jobs that go on for a long time should become routines and not
  chat-only orders.
- Send work that costs a lot to stronger models only when the task makes it right to do so:
  GPT 5.5 high for hard implementation/review, GPT 5.5 Extra high for
  high-risk design or release verification.
- End every run by writing the lesson back to `PROJECT_MEMORY.md`, an eval case,
  a skill, or a tracked doc. A fix that stays only in chat comes to an end there.
