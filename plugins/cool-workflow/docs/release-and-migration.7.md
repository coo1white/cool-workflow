# Release And Migration Discipline

CW v0.1.14 made release checks and durable run-state compatibility explicit.

## Who Is Affected

Maintainers cutting CW releases should use `npm run release:check` from
`plugins/cool-workflow`. Operators loading old `.cw/runs/<run-id>/state.json`
files can inspect compatibility with:

```bash
node scripts/cw.js state check <run-id>
```

Use `--state /path/to/state.json` when checking a state file outside the
current `.cw/runs` tree. Add `--write` only when you deliberately want to write
the normalized/migrated state back to disk.

## State Policy

The current durable run-state schema is `1`, defined by
`CURRENT_RUN_STATE_SCHEMA_VERSION` in `src/version.ts`.

Loading state follows this order:

```text
read JSON -> detect schema -> migrate -> normalize -> validate -> report
```

CW supports legacy run state with no `schemaVersion` as historical schema `0`
and migrates it to schema `1`. Schema versions newer than the runtime fail
closed. Invalid state objects fail closed. Unknown user data is preserved by
copying and adding required fields instead of rebuilding state from scratch.

## Dry Run

`state check` is dry-run by default. It reports:

- detected and current schema versions
- compatibility status: `current`, `migrated`, `normalized`, or `unsupported`
- whether writing would be required
- every field CW would add or normalize
- warnings and errors

## Backward Compatibility Fixtures

Fixture runs live in `test/fixtures/runs/` and cover:

- pre-app/simple run state
- Sandbox Profiles
- Workflow App SDK metadata
- End-to-End Golden Path
- Operator UX
- v0.1.13 MCP/App Surface

`npm run fixture-compat` copies each fixture into a temporary `.cw/runs` tree,
runs migration, and proves `status`, `graph`, and `report` still operate. The
fixture files are hashed before and after the test to prove they were not
mutated.

## Release Check

`npm run release:check` is the release gate for v0.1.14 and later. It runs:

- docs presence checks
- `npm run build`
- `npm run check`
- `npm test`
- `node test/multi-agent-runtime-core-smoke.js`
- dogfood release smoke coverage
- `npm run canonical-apps`
- `npm run golden-path`
- `npm run fixture-compat`
- `npm run version:sync`

The command is dry-run and non-destructive. Tagging, pushing, and publishing
remain manual release actions after the gate passes.

For v0.1.15, the same gate also includes the Security / Trust Hardening smoke
test so audit/provenance coverage remains part of release discipline.

For v0.1.16, release discipline adds Dogfood One Real Repo. `npm run
dogfood:release` runs the canonical `release-cut` app against the real Cool
Workflow repository in dry-run mode and produces a CW report, audit summary,
provenance, release candidate, score, selection, and verifier-gated
commit/checkpoint. `npm run release:check` includes the dogfood smoke test so
the wiring stays covered without recursively running the full release gate.

For v0.1.17, release discipline adds Multi-Agent Runtime Core coverage.
`npm run release:check` runs `test/multi-agent-runtime-core-smoke.js` directly
and through `npm test`. Older fixture runs normalize with empty multi-agent
state under `multiAgent` and `.cw/runs/<run-id>/multi-agent/`, while unknown
user data remains preserved.

## Unsupported Cases

CW does not silently load:

- non-object JSON run state
- run state with a schema version newer than the runtime
- run state with a schema version below the supported minimum
- state that cannot be normalized into the required runtime fields

When compatibility is ambiguous, hold the release and add a fixture or migration
step before proceeding.
