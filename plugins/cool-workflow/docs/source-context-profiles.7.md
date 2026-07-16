# Source Context Profiles

CW keeps source-context slimming out of the runtime kernel. The profile is policy
data in `manifest/source-context-profiles.json`; `scripts/source-context.js` is a
small part that reads a git ref and writes JSONL to stdout.

## Core Profile

The default `core` profile is the project memory for AI source imports. It keeps
runtime source and app/userland entrypoints, and leaves made artifacts,
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

Leaving a file out does not delete it and does not change release behavior. `dist/`
stays a committed release artifact till the release contract is clearly
changed.

## Narrow Profiles

Use a narrower opt-in profile when the question is already scoped down:

- `runtime`: the full `src/**` runtime kernel plus package and TypeScript
  metadata.
- `mcp`: capability core/registry, CLI routing, MCP server, MCP launcher scripts,
  and shared types.
- `workflow-apps`: the true apps plus the Workflow App framework and app
  planning/orchestration surface.
- `release`: release flow, gates, manifest/version tooling, package metadata, and
  release-tooling docs.
- `agent-wrappers`: outside agent wrappers, agent config, execution backend,
  drive loop, and agent-delegation docs.

The narrow profiles are policy data only. Picking one changes only the JSONL
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
node scripts/source-context.js export --profile-file /path/to/repo.json --max-lines 200000 --repo-root /path/to/repo > repo-source.jsonl
```

`--profile` defaults to `core` for the bundled profiles. With a custom
`--profile-file` that defines a single profile, `--profile` may be omitted — that
sole profile is used; a file with several profiles and no `--profile` fails closed
with the choices. `--max-lines N` overrides the selected profile's `maxLines`
guard (`0` disables the cap), so a mid-size foreign repo does not need a
hand-edited profile just to raise the line limit.

`manifest` emits one JSON object per tracked file at the selected ref:

```json
{"path":"plugins/cool-workflow/src/state.ts","included":true,"reason":"included:plugins/cool-workflow/src/**","sha256":"..."}
```

`export` emits only included text files and adds `content`. Both commands use
stdout for JSONL data only. Diagnostics and refusal messages go to stderr.

A file that cannot join a UTF-8 text pack is a recorded omission — `included:false`
with a `reason`, `bytes` and `sha256` of the raw blob kept and `lines:null` — in
both `manifest` and `export`, rather than aborting the run:

- `reason:"binary"` — the blob holds a NUL byte (images, UTF-16, compiled output).
- `reason:"non-utf8"` — the blob has no NUL but is not valid UTF-8 (latin-1, GBK,
  Shift-JIS, a lone `0xFF`). Its lossy `toString("utf8")` is never emitted, so an
  exported record's content always hashes back to its `sha256` and the export
  cache never poisons on re-read.
- `reason:"submodule"` — the entry is a git submodule (a gitlink), which has no
  blob in this repo.

This keeps a real foreign repo — one whose docs carry images, whose fixtures hold
non-UTF-8 or non-ASCII text, or which uses submodules — exportable while still
documenting every dropped file. Enumeration uses `git ls-tree -r -z` and blobs are
read by object id, so a filename of any byte class (non-ASCII such as `docs/中文.md`,
or one holding a backslash, quote, or control char) is neither lost to git's path
quoting nor able to break the request stream.

`--changed-from REF` is opt-in diff-aware mode. It cuts `manifest` and
`export` down to paths changed between the resolved base commit and `--ref`, then
applies the selected profile include/exclude rules. Deleted files are left out
because there is no blob at the target ref. Records take in `changedFrom` with
the resolved base commit. Empty diffs are good and emit empty JSONL.

`export --cache-dir DIR` is opt-in. The cache key is the resolved git commit SHA
plus a digest of the selected source profile, so changing the ref or the
include/exclude policy makes a different JSONL cache file. Cache hits write the
same JSONL bytes to stdout and stay quiet on stderr. Broken or wrong cache
records fail closed in place of falling back without a word. Diff-aware exports take in
the resolved `--changed-from` commit in the cache key, so full and changed exports
do not share cache files.

`--repo-root DIR` is opt-in too; when left out, the script keeps its past
default and reads the Cool Workflow repository root.

## Verification

The smoke test checks that:

- the profile takes in and leaves out the very same remembered paths;
- `dist/`, tests, docs, release records, and long logs are manifest-only;
- exported records are JSONL that parses with content and sha256;
- narrow profiles are slimmer than `core` and include/exclude the surfaces they
  are meant to;
- `--changed-from` emits only changed current-ref files, still keeps its excludes,
  and caches apart from full exports;
- cached exports are byte-identical to uncached exports and broken cache hits
  fail closed;
- the `core` profile stays under its `maxLines` guard;
- a binary in the include set is a recorded omission (`reason:"binary"`, not a
  die) and a non-ASCII filename exports as-is.

Run:

```bash
node test/source-context-profile-smoke.js
node test/source-context-external-repo-smoke.js
```

## FreeBSD Discipline

This feature is opt-in and does not change present CLI output. It is mechanism,
not policy: profile selection lives in data, and vendor prompt/stream behavior
stays in wrappers. It fails closed on bad profiles, unknown refs, and line-count
drift past the set guard. A file that cannot join a text pack (binary, non-UTF-8,
or a submodule) is a recorded omission with its `reason`, not a fatal error — a
documented drop, never a silent one.
