# plan.md — cool-workflow: one CI/CD shape

Stage 3 of `~/Developer/sdlc/unify-ci-cd/` (intent approved and spec
signed by the owner 2026-09-07). cool-workflow is in the last group
(row 7, with chime): it is on GitHub, so `runs-on: ubuntu-latest` is
right and the label rule does not apply. This file is the plan only;
no code until the root session approves it.

## Measured facts (2026-09-07, main at 9bde83b8)

- 8 files in `.github/workflows/`: `bench.yml`, `ci.yml`, `codeql.yml`,
  `github-release.yml`, `gitleaks.yml`, `npm-publish.yml`, `pages.yml`,
  `release-gate.yml`. No `.gitea/workflows/`.
- `runs-on`: `ubuntu-latest` ×10, `macos-latest` ×1 (the
  `cool-workflow-macos` job in `ci.yml`).
- `uses:` lines: 29 in all, every one a 40-hex SHA with a `# vX` note.
  Seven distinct actions (table below).
- `ci.yml` jobs: `cool-workflow` (matrix node 18/22/24),
  `cool-workflow-macos`, `steering-config-gate`. Branch protection on
  `main` requires the contexts `cool-workflow (18)` and
  `cool-workflow (22)` (read with `gh api .../branches/main/protection`).
  One ruleset, `main branch`, target branch.
- Couplings on the workflow NAME `release-gate`: `npm-publish.yml`
  (`workflow_run: workflows: ["release-gate"]`),
  `scripts/release-oneclick.js` (`gh run list --workflow release-gate`
  and `--workflow npm-publish`), and its stub in
  `test/release-oneclick-resume-repush-smoke.js`.
- Secrets used: `secrets.GITHUB_TOKEN` only. None of the four token
  aliases in spec R7 exist here.
- No `gitea.`, no `hashFiles(` in any file.
- Tests that already read workflow files: `package-manager-gate-smoke.js`,
  `release-pipeline-hygiene-smoke.js`, `npm-trusted-publish-smoke.js`,
  `verdict-signing-workflow-smoke.js`. There is no `stack-gate` test
  by that name; the spec R9 role is a new `test/ci-shape-gate-smoke.js`.
- Gitea copy (id 22, private) is a mirror pushed by
  `scripts/mirror-to-gitea.js`. It runs no CI. Nothing in this plan
  touches it.

## The fold (spec R2)

| Today | After | Why |
|---|---|---|
| `ci.yml` | `ci.yml` | stays; job id `cool-workflow` → `check` (matrix kept) |
| `bench.yml` | `scheduled.yml` | schedule + dispatch, read-only (spec S2: a comment says no token) |
| `release-gate.yml` + `github-release.yml` | `release.yml` | both fire on `push: tags: v*`; two jobs `gate` and `release`, `release` gets `needs: gate` and job-level `permissions: contents: write`; the workflow keeps `cancel-in-progress: false` |
| `codeql.yml` | exception | GitHub code scanning reads results by workflow; CodeQL needs its own `security-events: write` permission and its own schedule |
| `gitleaks.yml` | exception | a second scanner on every push and PR; its action needs `GITHUB_TOKEN` in env; kept apart so a scanner outage never blocks `check` |
| `pages.yml` | exception | GitHub Pages deploy needs `pages: write` + `id-token: write` and the `github-pages` environment; a deploy job does not belong in `ci.yml` |
| `npm-publish.yml` | exception | a `workflow_run` chain off the gate plus trusted publishing (OIDC); folding it into `release.yml` would change what npm-publish trusts, so it stays |

Fold side effects, all in the same packet:

- `npm-publish.yml`: `workflows: ["release-gate"]` → `["release"]`.
- `scripts/release-oneclick.js`: `--workflow release-gate` →
  `--workflow release`; the stub in
  `test/release-oneclick-resume-repush-smoke.js` follows.
- Behavior change, named: today npm-publish trusts the gate run alone.
  After the fold it trusts the whole `release` run, so a red
  `release` job (a `gh release create` failure) also holds back the
  npm publish. This is stricter, not looser. The operator recovers with
  `workflow_dispatch` on npm-publish, which already exists.
- `release-pipeline-hygiene-smoke.js` and `npm-trusted-publish-smoke.js`
  are re-run; any string they pin on the old file names moves.

## The macOS job

`cool-workflow-macos` stays as a job in `ci.yml`. It is the only run of
the CLI on macOS, the operator's own platform, and its comment already
says it is not a required check. `macos-latest` is right on GitHub.
The gate's label set for this repo is `{ubuntu-latest, macos-latest}`,
the one difference spec §5.4 allows.

## `ci.yml` after (spec R3)

- Triggers: `push` to `main`, `pull_request`. Unchanged.
- `concurrency` with `cancel-in-progress: true` stays. Spec R3 (amended
  2026-09-07) no longer asks for it; GitHub honors it, so this repo keeps
  the block it has. The gate does not check it.
- Job `check` (was `cool-workflow`): checkout → setup-node + setup-bun
  → `bun install --frozen-lockfile` → `bun run check` (lint +
  typecheck) → tests → `bun run build`. Today `build` runs before the
  tests because `dist/` is what the smokes run. The plan keeps that
  order and names it here as the one departure from R3's step order:
  the tests need the built CLI, so build comes first, and
  `dist:check` after it proves the build is the committed one.
- `steering-config-gate` stays as a second job (not required; runs
  only when its files change). R3 says one job `check`; this repo has
  two more, both named in the gate's exception list with one reason
  each (macOS proof run; path-scoped steering check).

## Branch protection (owner's step, spec §5.2)

Today: `cool-workflow (18)`, `cool-workflow (22)`. After: `check (18)`,
`check (22)`. The owner changes the rule in the same window as the
merge. Until then the renamed contexts show as "expected, missing" on
the PR itself, so the packet PR is merged by the owner by hand (or the
rule is changed first, then the PR auto-merges).

## Pin table for `ops/gitea/docs/actions-pins.md`

All 29 `uses:` lines are in this table. The root session copies the
last four rows into the ops table.

| Action | SHA | Version |
|---|---|---|
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 (×10) |
| `actions/setup-node` | `820762786026740c76f36085b0efc47a31fe5020` | v7.0.0 (×7) |
| `oven-sh/setup-bun` | `0c5077e51419868618aeaa5fe8019c62421857d6` | v2 = v2.2.0 (`git ls-remote --tags`, 2026-09-07) (×7) |
| `github/codeql-action/init`, `/analyze` | `cdf488f595d80d6e07e03d4674febd5ab45fa938` | v4.37.9 (×2) |
| `gitleaks/gitleaks-action` | `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` | v3.0.0 (×1) |
| `actions/upload-pages-artifact` | `fc324d3547104276b827a68afc52ff2a11cc49c9` | v5.0.0 (×1) |
| `actions/deploy-pages` | `368f82528645a54fb793d4d04e342629a3f51346` | v5.0.1 (×1) |

## The gate: `test/ci-shape-gate-smoke.js` (spec R9, §2)

Plain file reads and string asserts, no YAML library. Constants: the
pin table above, `LABELS = ["ubuntu-latest", "macos-latest"]` (GitHub
host), `EXCEPTIONS = ["codeql.yml", "gitleaks.yml", "pages.yml",
"npm-publish.yml"]`, `EXTRA_JOBS = ["cool-workflow-macos",
"steering-config-gate"]`.

1. no `.gitea/workflows/` directory;
2. file names ⊆ {`ci.yml`, `release.yml`, `scheduled.yml`} ∪ EXCEPTIONS;
3. `ci.yml` has a job id `check`; `release.yml` has no
   `cancel-in-progress: true` (the npm-publish chain must never lose a
   gate run);
4. every `runs-on:` value ∈ LABELS;
5. every `uses:` matches `^[^@]+@[0-9a-f]{40} # v` and the SHA is in
   the table;
6. no `gitea.`, no `hashFiles(` (the `ubuntu-` and `macos-latest`
   lines of spec item 6 are dropped: GitHub host);
7. no `secrets.CT_GITEA_TOKEN`, `CI_VENDOR_TOKEN`, `AUTOMERGE_TOKEN`,
   `RENOVATE_TOKEN`, and no `secrets.GITHUB_TOKEN` (spec amendment
   2026-09-07: write `${{ github.token }}`, the same value on GitHub and
   never empty on Gitea).

Bite proof: the test copies `.github/workflows/` to a temp dir, plants
one fault per check (seven copies), runs the check function on each,
and asserts red. Same shape as `css-framework-gate-smoke.js`. The test
joins `test/run-all.js` so the release gate runs it too.

## Packet (one PR, plan and code together, auto-merge after the owner
moves the protection rule)

| # | Who | Directory | Work | Proof |
|---|---|---|---|---|
| C1 | Sonnet | `.github/workflows/`, `plugins/cool-workflow/scripts/release-oneclick.js`, `plugins/cool-workflow/test/` (new gate + the two stubs), `sdlc/unify-ci-cd/` | the fold table, the `check` rename, the name changes, the gate test, this file's ledger | CI green on the PR (a real `pull_request` run of the new `ci.yml`); one real `push` of a throwaway tag `v0.0.0-ci-shape` on a branch is NOT done: tags run the release gate for real and the tag hook blocks unapproved tags. `release.yml` is proven by the next real release (0.2.9); `scheduled.yml` by one `workflow_dispatch` run after merge (read-only, no token, so dispatch is a fair proof here) |

Directory rule: this packet is the only one touching
`.github/workflows/` in its batch.

## Known risks, named once

- The rename of the required contexts (spec §5.2). Owner's step, above.
- `release.yml` cannot be proven before merge without a real tag. The
  next release is the proof; if it goes red the fix is one file.
- `gh run list --workflow release` matches by workflow name; the new
  `name:` in `release.yml` must be exactly `release`.

## What this plan got wrong

- The plan named only `release-oneclick.js` and its test stub for the
  `release-gate` → `release` name change. In fact the literal file name
  `release-gate.yml` (not the script `release-gate.js`, which keeps its
  name) is quoted in comments across nine more files: `scripts/block-
  unapproved-tag.js`, `scripts/release-flow.js`, `scripts/release-gate.js`,
  `scripts/verdict-keygen.js`, `scripts/verify-bump-reproduction.js`,
  `scripts/verify-release-verdict.js`, `scripts/verify-verdict-
  signature.js`, `test/block-unapproved-tag-smoke.js`, `test/release-gate-
  detached-head-smoke.js`. All renamed to `release.yml` (the packet's own
  grep instruction covered this once widened to all of `scripts/*.js` and
  `test/*.js`, not just the two named files).
- `test/verdict-signing-workflow-smoke.js` reads `.github/workflows/
  release-gate.yml` by path (`GATE_YML`) to extract the verdict step's
  real `run:` text. That path had to move to `release.yml` too, or the
  test would fail closed the moment the old file was deleted — this
  was implied by the fold but not spelled out as its own line item.
- AGENTS.md has no clean `# Stack rule and this repo's exceptions`
  heading — it lives as inline text inside the Iteration Loop's item
  (c), closed later by a stray `# North Star)`. The one line landed in
  that same block, next to the other two named exceptions (hosting,
  Workbench), rather than under a heading that does not exist.
- AGENTS.md also has older prose mentions of `release-gate` as a CI
  concept and two more `release-gate.yml` path mentions (its release
  playbook section, further down) that this packet's item 4 did not
  name and did not touch — a separate cleanup, not in this packet's
  scope.
- `bench.yml`'s job id (`bench:`) was left unchanged inside the renamed
  `scheduled.yml` — the packet said "same content" plus the `name:` and
  a read-only comment, and did not ask for a job-id rename.

## Architecture snapshot diff (closing PR)

- `AGENTS.md` "Stack rule and this repo's exceptions": add one line,
  the three workflow names and the four named exceptions.
- `~/Developer/UPGRADE-PLAN.md` §6 row for cool-workflow: root session.

Status ledger: plan written 2026-09-07; approved by the root session the same day (build-before-test, the stricter npm-publish trust, and the 0.2.9 proof all accepted; GitHub repos run in parallel with the Gitea queue, start after the ops pin table merges). Packet C1 done 2026-09-07 on `feat/ci-shape`: the fold, the `check` rename, the name sweep (widened per "What this plan got wrong" above), `test/ci-shape-gate-smoke.js` (green, seven bite proofs), and this file's own ledger. Full proof suite (`test/run-all.js`) green. Not done: the owner's branch-protection rename (`cool-workflow (18/22)` → `check (18/22)`), the real tag push proving `release.yml`, and the post-merge `workflow_dispatch` proving `scheduled.yml` — all named in the plan as steps outside this packet.
