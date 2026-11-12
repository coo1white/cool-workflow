# Cool Workflow — notes for coding agents

One page. Each rule here is held by a machine check or was paid for by a
real fault. A new rule needs the same: name the fault, or name the check.
Rewritten 2026-11-12 on the owner's word ("approve": the mission below,
large deletions, breaking changes while on 0.x, and agents merging and
shipping patch releases on green CI).

## What CW is

CW keeps the books for AI work. It never runs a model, never holds a key,
never uploads code. An agent does the work; CW records each claim with the
lines it rests on, signs nothing itself, verifies offline, and can replay
a run. The aim: after AI does most of the work, people can still see it,
check it, and stop it.

A change earns its place when it helps a user get, read, or check a
receipt for agent work. Anything else is cut, not frozen.

## The floor (machine-checked)

| Rule | Checked by (under `plugins/cool-workflow/`) |
|---|---|
| Never push to `main`. Branch, PR, green CI, merge. | branch protection |
| A fix comes with a test that fails before it. | `scripts/fails-before-check.mjs` |
| Zero runtime dependencies in the CLI. | reviewer |
| `src/` stays at 10,000 lines or fewer. | `scripts/size-check.mjs` |
| core decides, shell does I/O, wiring joins; imports point one way. | `scripts/purity-gate.mjs` |
| Data crossing the executor boundary holds no callable. | `test/one-way-boundary-smoke.mjs` |
| No `shell: true` in src/; children are spawned argv-style. | `test/architecture-smoke.mjs` |
| Private keys never live in src/ or reach a child process. | `test/architecture-smoke.mjs` |
| Committed `dist/` is exactly the build of `src/`. | `scripts/dist-drift-check.mjs` |
| JS/TS only; another language is a named exception. | `scripts/lang-policy-check.mjs` |
| `--json` output, exit codes and flags do not change shape. Human text and HTML may change. | `test/cli-command-surface-smoke.mjs` |
| No unused locals; no barrel files in src/. | `tsc`, `test/architecture-smoke.mjs` |
| Unit tests mirror src/; smokes stay flat in test/. | `test/test-layout-smoke.mjs` |

## How work moves

1. One goal per PR. A fix and a clean-up are separate PRs.
2. Before a push: `npm run build`, the tests the change touches, and
   `npm run test:unit`. CI runs the rest; `check (22)` and `check (24)`
   must be green.
3. On green CI the agent merges its own PR (squash). Oldest ready PR
   first.
4. A merged fix ships as a patch release by itself: when CI is green on
   `main`, the `auto-patch` job in `.github/workflows/release.yml` tags the
   next patch and starts the npm publish; the operator only approves the
   `npm` environment run. A minor or major is the operator's signed cut,
   `npm run release -- X.Y.0` (runbook: "Release (operator runbook)" in
   `plugins/cool-workflow/docs/reference.md`). Never `git tag` by
   hand; the signing key stays with the operator. `CW_AUTO_RELEASE=off`
   (a repo variable) stops the automatic patches.
5. A big new capability gets a short plan in the PR text: what was
   measured, one other way turned down. No separate intent file.

All `npm run` commands run in `plugins/cool-workflow/`.

## Issues

An issue stays open only when it can be made to happen again, differs
from what the docs say, and touches the core path (`cw -q`, the report,
resume, verify). Anything else is closed the same day with one line of
reason. Ideas are not issues. Keep five or fewer open; above five, no new
feature work. A fix for a user's report names them in the PR title:
`fix(<area>): <what> (#<n>, reported by @<name>)`, with the `from-user`
label.

## Merge conflicts

Rebase the work branch on `main`; never merge `main` in. Mechanical
conflicts may be resolved. Two sides that changed the same logic, or any
conflict in signing, release, redaction or fail-closed code, go to the
owner.

## Privacy

No personal data in GitHub text: no user names, real names, emails, home
paths, hosts, IPs, tokens. Write `$HOME/...`, `<path>`, `<user>`.

## Lessons

What reviewers have stopped before, with reasons: root `REVIEW.md`. Add
a lesson there when a fault gets through.
