# Release Checklist

Use this checklist before you put out Cool Workflow v0.1.87 or any later one.

## Dry-Run Gate

Start from a fresh checkout:

```bash
cd plugins/cool-workflow
npm install
npm run release:check
npm run dogfood:release
```

`npm run release:check` does no harm. It does not tag, push, publish, or
rewrite fixture files. It makes a check of docs presence, build, type check, default
tests, canonical apps, golden path, fixture compatibility, dogfood smoke, and
version synchronization.

`npm run dogfood:release` also does no harm by default. It runs the
canonical `release-cut` workflow against the real repository and writes
`.cw/runs/<run-id>/dogfood-summary.json` with the run id, report path, audit
paths, candidate id, score id, selection id, commit/checkpoint id, command
logs, and release verdict.

## Required Manual Review

1. Make sure `CHANGELOG.md` contains the target version.
2. Make sure `plugins/cool-workflow/docs/release-and-migration.7.md` gives an account of
   migration compatibility and cases that are not supported.
3. Make sure `node scripts/cw.js state check <run-id>` reports the looked-for migration
   status for any release-candidate run state you have a mind to keep.
4. Make sure `npm run version:sync` passes after `npm run build`. This now also
   gates `Formula/cool-workflow.rb` (the Homebrew formula): `bump-version.js`
   auto-moves its `tag:`/`version` to the target, so no manual edit or checksum
   step is needed — it is a git-tag formula with no sha256.
5. Make sure generated `plugins/cool-workflow/dist/` output is committed.
6. Make sure topology docs and smoke coverage are present:
   `docs/multi-agent-topologies.7.md` and
   `test/multi-agent-topologies-smoke.js`.
7. Make sure Multi-Agent CLI + MCP Surface docs and smoke coverage are present:
   `docs/multi-agent-cli-mcp-surface.7.md` and
   `test/multi-agent-cli-mcp-surface-smoke.js`.
8. Make sure Multi-Agent Operator UX docs and smoke coverage are present:
   `docs/multi-agent-operator-ux.7.md` and
   `test/multi-agent-operator-ux-smoke.js`.
9. Make sure Multi-Agent Trust / Policy / Audit docs and smoke coverage are
   present: `docs/multi-agent-trust-policy-audit.7.md` and
   `test/multi-agent-trust-policy-audit-smoke.js`.
10. Make sure Multi-Agent Eval & Replay Harness docs and smoke coverage are
   present: `docs/multi-agent-eval-replay-harness.7.md` and
   `test/multi-agent-eval-replay-smoke.js`.
11. Make sure `npm run eval:replay` passes and have a look at `.cw/evals/<suite-id>/`
   artifacts: `snapshot.json`, `replay-run.json`, `comparison.json`,
   `score.json`, `findings.json`, `gate.json`, and `report.md`.
12. Make sure `npm run dogfood:release` reports `ready-dry-run` and have a look at the
    run with `status`, `graph`, `report --show`, `candidate summary`,
    `commit summary`, `multi-agent dependencies`, `multi-agent failures`,
    `multi-agent evidence`, `audit summary`, `audit provenance`,
    `audit multi-agent`, `audit policy`, `audit blackboard`, and
    `audit judge`.
13. Make sure the reviewer verdict is committed: `.cw-release/review-<FULLSHA>.verdict`
    must exist in the tag's commit history and its first line must be
    `APPROVED <FULLSHA>`. Run `node scripts/release-flow.js --cut --version x.y.z`
    to auto-create it and commit it, then `git push`. The `release-gate` CI workflow
    will verify this file is present at the tag commit.

## Version Surfaces

The version synchronization check takes in:

- `plugins/cool-workflow/package.json`
- `plugins/cool-workflow/.codex-plugin/plugin.json`
- `plugins/cool-workflow/src/version.ts`
- framework and MCP server version use
- canonical workflow app manifests
- golden path and MCP smoke expectations
- dogfood release smoke expectations
- README, changelog, release docs, and release/migration docs
- generated `dist/` output

## Migration Discipline

Run state that keeps lives at `.cw/runs/<run-id>/state.json`. Loading goes like this:

```text
read JSON -> detect schema -> migrate -> normalize -> validate -> report
```

Dry-run migration checks:

```bash
node scripts/cw.js state check <run-id>
node scripts/cw.js state check <run-id> --state /path/to/state.json
```

Only use `--write` when you have a mind to normalize a state file in place.

## Publish Steps

After the dry-run gate and manual review pass, cutting the release is a
maintainer action taken through the gated tool — never a raw `git push`:

```bash
node scripts/release-flow.js --cut --version x.y.z --push
```

This re-runs the deterministic gate, delegates to the independent reviewer,
bumps every version surface, commits the reviewer verdict, creates the tag,
and (because of `--push`) pushes the tag and the verdict commit and creates
the GitHub Release — all in one gated step. Leave off `--push` for a local-only
cut (tag created but nothing pushed or published).

Package publication, marketplace updates, or plugin cache updates should be run
only when the maintainer has a mind to publish. Local tag creation, push, package
publish, and marketplace update are still separate steps you can see. Dry-run dogfood
mode never does them; execute-style flags must take in a clear
target-version confirmation such as `--confirm-release-actions=0.1.24`.

## Verdict Signing (optional)

`grep -q '^APPROVED'` alone can't tell a real reviewer verdict from a
hand-written one. Set up ed25519 signing once to close that gap:

```bash
node scripts/verdict-keygen.js --out-dir ~/.cw-keys
# .cw-release/ lives at the REPO ROOT, not under plugins/cool-workflow (where
# this checklist's cwd has been since the top) — anchor on the real root so
# the public key lands where release-gate.yml/npm-publish.yml/
# block-unapproved-tag.sh actually look for it, not silently under
# plugins/cool-workflow/.cw-release/ where no verifier will ever find it.
REPO_ROOT="$(git rev-parse --show-toplevel)"
cp ~/.cw-keys/verdict-signing.pub "$REPO_ROOT/.cw-release/verdict-signing.pub"
git -C "$REPO_ROOT" add .cw-release/verdict-signing.pub
git -C "$REPO_ROOT" commit -m "chore: add release-verdict signing public key"
export CW_RELEASE_VERDICT_PRIVKEY=~/.cw-keys/verdict-signing.key   # keep this OFF the repo
```

Once `.cw-release/verdict-signing.pub` is committed, `release-flow.js`
signs every verdict it writes (a `.sig` sidecar next to the `.verdict`
file, included in the cut's verdict commit), and `release-gate.yml`,
`npm-publish.yml`, and the local `block-unapproved-tag.sh` hook all start
REQUIRING a valid signature on top of the existing `APPROVED` text check.
Until that public key is committed, every check stays exactly as before
(grep-only) — this is opt-in, not a breaking change.

## Cutting efficiently (wall-clock)

The full ~4-minute test suite can run up to five times across one cut
(`release-flow`'s own gate, the independent reviewer's gate pass, a local
`release:check`, the tag's `release-gate` CI, and the PR's CI). To keep a cut to
~15-20 minutes in place of an hour:

- **Cut on a quiet machine.** The suite is parallel-friendly but ~3x slower under
  CPU contention; do not run a cut while a number of workflows/agents are in a fight for cores.
- **Two gate passes is the top.** `release-flow` runs the gate once, then the
  independent reviewer runs it one more time (zero-trust). The reviewer has orders
  to run it EXACTLY ONCE (`agents/release-reviewer.md` step 2) — a deterministic
  gate cannot make a different verdict on a re-run, so a third pass is pure waste.
- **You can let the separate local `release:check` go before pushing.** The cut's
  gate + the reviewer's independent gate + the tag's `release-gate` CI already
  take care of it; pushing and letting CI gate is quicker (a tag/branch is cheap to redo
  if CI reds). Keep the local check only when you cannot get to CI.
- **Put related changes together into fewer PRs.** Each PR is a full CI cycle; a stack
  of tiny fix-PRs makes CI time much greater. Group a clear change set into one PR
  but for when independent review/revert granularity is truly needed.

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, wrapper metrics you can measure, background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_This checklist is true through v0.1.81._
_Current release: v0.1.84._

## Privacy Release (v0.1.84)

This release removes saved reviewer input files with local user paths, makes new
release review prompts use repo-local paths, and adds a tracked-file scan for the
blocked local user markers before release.

0.1.85

0.1.88

0.1.89

0.1.90

0.1.91

0.1.93

0.1.94

0.1.95

0.1.96

0.1.97

0.1.98

0.2.0

0.2.1

0.2.2
