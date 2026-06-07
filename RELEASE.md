# Release Checklist

Use this checklist before publishing Cool Workflow v0.1.15 or later.

## Dry-Run Gate

From a fresh checkout:

```bash
cd plugins/cool-workflow
npm install
npm run release:check
```

`npm run release:check` is non-destructive. It does not tag, push, publish, or
rewrite fixture files. It verifies docs presence, build, type check, default
tests, canonical apps, golden path, fixture compatibility, and version
synchronization.

## Required Manual Review

1. Confirm `CHANGELOG.md` contains the target version.
2. Confirm `plugins/cool-workflow/docs/release-and-migration.7.md` describes
   migration compatibility and unsupported cases.
3. Confirm `node scripts/cw.js state check <run-id>` reports expected migration
   status for any release-candidate run state you intend to preserve.
4. Confirm `npm run version:sync` passes after `npm run build`.
5. Confirm generated `plugins/cool-workflow/dist/` output is committed.

## Version Surfaces

The version synchronization check covers:

- `plugins/cool-workflow/package.json`
- `plugins/cool-workflow/.codex-plugin/plugin.json`
- `plugins/cool-workflow/src/version.ts`
- SDK and MCP server version use
- canonical workflow app manifests
- golden path and MCP smoke expectations
- README, changelog, release docs, and release/migration docs
- generated `dist/` output

## Migration Discipline

Durable run state lives at `.cw/runs/<run-id>/state.json`. Loading follows:

```text
read JSON -> detect schema -> migrate -> normalize -> validate -> report
```

Dry-run migration checks:

```bash
node scripts/cw.js state check <run-id>
node scripts/cw.js state check <run-id> --state /path/to/state.json
```

Only use `--write` when intentionally normalizing a state file in place.

## Publish Steps

After the dry-run gate and manual review pass, tagging, pushing, and publishing
remain explicit maintainer actions:

```bash
git tag v0.1.15
git push origin main --tags
```

Package publication, marketplace updates, or plugin cache updates should be run
only when the maintainer intends to publish.
