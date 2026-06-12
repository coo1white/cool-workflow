# Source Context Profiles

CW keeps source-context slimming out of the runtime kernel. The profile is policy
data in `manifest/source-context-profiles.json`; `scripts/source-context.js` is a
small mechanism that reads a git ref and writes JSONL to stdout.

## Core Profile

The default `core` profile is the project memory for AI source imports. It keeps
runtime source and app/userland entrypoints, and leaves generated artifacts,
tests, docs, release records, and long logs as manifest-only records.

Included:

- `plugins/cool-workflow/src/**`
- `plugins/cool-workflow/apps/**`
- `plugins/cool-workflow/package.json`
- `plugins/cool-workflow/tsconfig.json`
- `plugins/cool-workflow/scripts/cw.js`
- `plugins/cool-workflow/scripts/mcp-server.js`
- `plugins/cool-workflow/scripts/agents/**`

Excluded from exported content:

- `plugins/cool-workflow/dist/**`
- `plugins/cool-workflow/test/**`
- `plugins/cool-workflow/docs/**`
- `docs/assets/**`
- `.cw-release/**`
- `CHANGELOG.md`
- `ITERATION_LOG.md`

Exclusion does not delete files and does not change release behavior. `dist/`
remains a committed release artifact until the release contract is explicitly
changed.

## Commands

```bash
node scripts/source-context.js profiles
node scripts/source-context.js manifest --profile core --ref HEAD > manifest.jsonl
node scripts/source-context.js export --profile core --ref HEAD > core-source.jsonl
```

`manifest` emits one JSON object per tracked file at the selected ref:

```json
{"path":"plugins/cool-workflow/src/state.ts","included":true,"reason":"included:plugins/cool-workflow/src/**","sha256":"..."}
```

`export` emits only included text files and adds `content`. Both commands use
stdout for JSONL data only. Diagnostics and refusal messages go to stderr.

## Verification

The smoke test checks that:

- the profile includes and excludes exactly the remembered paths;
- `dist/`, tests, docs, release records, and long logs are manifest-only;
- exported records are parseable JSONL with content and sha256;
- the `core` profile stays under its `maxLines` guard.

Run:

```bash
node test/source-context-profile-smoke.js
```

## FreeBSD Discipline

This feature is opt-in and does not alter existing CLI output. It is mechanism,
not policy: profile selection lives in data, and vendor prompt/stream behavior
stays in wrappers. It fails closed on invalid profiles, unknown refs, binary
included files, and line-count drift past the configured guard.
