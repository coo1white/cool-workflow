# Release Checklist

Use this checklist before publishing Cool Workflow v0.1.35 or later.

## Dry-Run Gate

From a fresh checkout:

```bash
cd plugins/cool-workflow
npm install
npm run release:check
npm run dogfood:release
```

`npm run release:check` is non-destructive. It does not tag, push, publish, or
rewrite fixture files. It verifies docs presence, build, type check, default
tests, canonical apps, golden path, fixture compatibility, dogfood smoke, and
version synchronization.

`npm run dogfood:release` is also non-destructive by default. It runs the
canonical `release-cut` workflow against the real repository and writes
`.cw/runs/<run-id>/dogfood-summary.json` with the run id, report path, audit
paths, candidate id, score id, selection id, commit/checkpoint id, command
logs, and release verdict.

## Required Manual Review

1. Confirm `CHANGELOG.md` contains the target version.
2. Confirm `plugins/cool-workflow/docs/release-and-migration.7.md` describes
   migration compatibility and unsupported cases.
3. Confirm `node scripts/cw.js state check <run-id>` reports expected migration
   status for any release-candidate run state you intend to preserve.
4. Confirm `npm run version:sync` passes after `npm run build`.
5. Confirm generated `plugins/cool-workflow/dist/` output is committed.
6. Confirm topology docs and smoke coverage are present:
   `docs/multi-agent-topologies.7.md` and
   `test/multi-agent-topologies-smoke.js`.
7. Confirm Multi-Agent CLI + MCP Surface docs and smoke coverage are present:
   `docs/multi-agent-cli-mcp-surface.7.md` and
   `test/multi-agent-cli-mcp-surface-smoke.js`.
8. Confirm Multi-Agent Operator UX docs and smoke coverage are present:
   `docs/multi-agent-operator-ux.7.md` and
   `test/multi-agent-operator-ux-smoke.js`.
9. Confirm Multi-Agent Trust / Policy / Audit docs and smoke coverage are
   present: `docs/multi-agent-trust-policy-audit.7.md` and
   `test/multi-agent-trust-policy-audit-smoke.js`.
10. Confirm Multi-Agent Eval & Replay Harness docs and smoke coverage are
   present: `docs/multi-agent-eval-replay-harness.7.md` and
   `test/multi-agent-eval-replay-smoke.js`.
11. Confirm `npm run eval:replay` passes and inspect `.cw/evals/<suite-id>/`
   artifacts: `snapshot.json`, `replay-run.json`, `comparison.json`,
   `score.json`, `findings.json`, `gate.json`, and `report.md`.
12. Confirm `npm run dogfood:release` reports `ready-dry-run` and inspect the
   run with `status`, `graph`, `report --show`, `candidate summary`,
   `commit summary`, `multi-agent dependencies`, `multi-agent failures`,
   `multi-agent evidence`, `audit summary`, `audit provenance`,
   `audit multi-agent`, `audit policy`, `audit blackboard`, and
   `audit judge`.

## Version Surfaces

The version synchronization check covers:

- `plugins/cool-workflow/package.json`
- `plugins/cool-workflow/.codex-plugin/plugin.json`
- `plugins/cool-workflow/src/version.ts`
- SDK and MCP server version use
- canonical workflow app manifests
- golden path and MCP smoke expectations
- dogfood release smoke expectations
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
git tag v0.1.24
git push origin main --tags
```

Package publication, marketplace updates, or plugin cache updates should be run
only when the maintainer intends to publish. Local tag creation, push, package
publish, and marketplace update remain separate visible steps. Dry-run dogfood
mode never performs them; execute-style flags must include an explicit
target-version confirmation such as `--confirm-release-actions=0.1.24`.
