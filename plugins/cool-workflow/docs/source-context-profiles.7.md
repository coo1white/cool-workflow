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

## Narrow Profiles

Use a narrower opt-in profile when the question is already scoped:

- `runtime`: the full `src/**` runtime kernel plus package and TypeScript
  metadata.
- `mcp`: capability core/registry, CLI routing, MCP server, MCP launcher scripts,
  and shared types.
- `workflow-apps`: canonical apps plus the Workflow App framework and app
  planning/orchestration surface.
- `release`: release flow, gates, manifest/version tooling, package metadata, and
  release-tooling docs.
- `agent-wrappers`: external agent wrappers, agent config, execution backend,
  drive loop, and agent-delegation docs.

The narrow profiles are policy data only. Selecting one changes only the JSONL
context pack; it does not change runtime behavior, release contents, or the
default `core` profile.

## Commands

```bash
node scripts/source-context.js profiles
node scripts/source-context.js manifest --profile core --ref HEAD --repo-root /path/to/repo > manifest.jsonl
node scripts/source-context.js export --profile core --ref HEAD --repo-root /path/to/repo > core-source.jsonl
node scripts/source-context.js export --profile mcp --ref HEAD --repo-root /path/to/repo > mcp-source.jsonl
node scripts/source-context.js export --profile mcp --changed-from origin/main --ref HEAD --repo-root /path/to/repo > mcp-changed.jsonl
node scripts/source-context.js export --profile core --ref HEAD --repo-root /path/to/repo --cache-dir .cw/cache/source-context > core-source.jsonl
```

`manifest` emits one JSON object per tracked file at the selected ref:

```json
{"path":"plugins/cool-workflow/src/state.ts","included":true,"reason":"included:plugins/cool-workflow/src/**","sha256":"..."}
```

`export` emits only included text files and adds `content`. Both commands use
stdout for JSONL data only. Diagnostics and refusal messages go to stderr.

`--changed-from REF` is opt-in diff-aware mode. It filters `manifest` and
`export` to paths changed between the resolved base commit and `--ref`, then
applies the selected profile include/exclude rules. Deleted files are omitted
because there is no blob at the target ref. Records include `changedFrom` with
the resolved base commit. Empty diffs are valid and emit empty JSONL.

`export --cache-dir DIR` is opt-in. The cache key is the resolved git commit SHA
plus a digest of the selected source profile, so changing either the ref or the
include/exclude policy produces a different JSONL cache file. Cache hits write the
same JSONL bytes to stdout and stay silent on stderr. Corrupt or mismatched cache
records fail closed instead of falling back silently. Diff-aware exports include
the resolved `--changed-from` commit in the cache key, so full and changed exports
do not share cache files.

`--repo-root DIR` is also opt-in; when omitted, the script keeps its historical
default and reads the Cool Workflow repository root.

## Verification

The smoke test checks that:

- the profile includes and excludes exactly the remembered paths;
- `dist/`, tests, docs, release records, and long logs are manifest-only;
- exported records are parseable JSONL with content and sha256;
- narrow profiles are slimmer than `core` and include/exclude their intended
  surfaces;
- `--changed-from` emits only changed current-ref files, still honors excludes,
  and caches separately from full exports;
- cached exports are byte-identical to uncached exports and corrupt cache hits
  fail closed;
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
