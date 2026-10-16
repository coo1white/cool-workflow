# Release gate: take the green CI on the reviewed commit, not a second local test run

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Issue #782. Source: the operator on 2026-10-16, after
the 0.3.0 cut. The operator was given three steps: (1) a `release:doctor`
preflight, (2) a CI release rehearsal, (3) the gate takes the green CI on
the exact reviewed commit in place of a local full test run. The answer,
in the operator's own words, on 2026-10-16:

> 三步都做，先做1和2

("Do all three steps; do 1 and 2 first.") Steps 1 and 2 shipped as #780
(`release:doctor`) and #781 (CI release rehearsal). This file is step 3.

## Intent

`npm run release -- X.Y.Z` stops running the full test suite again on the
operator's machine. The suite already ran in CI on the same commit. The
gate's test step now takes the checks `main`'s branch protection requires,
green on GitHub for the exact reviewed SHA, and fails closed on anything
less. The local full run stays as an opt-in for when CI cannot be reached.
This changes a release default, so it goes out in the next minor (0.4.0).

## Measured facts (2026-10-16)

- The local gate's test step (`npm run test:gate`, sequential) takes about
  10 minutes on the operator's machine (#782; the reviewer-timeout comment
  in `scripts/release-flow.js` says "~12 min").
- In the 0.3.0 cut it failed twice for reasons of the machine, not the
  code: a memory-heavy test ran out of time on a low-memory WSL, and npm 12
  changed the `npm pack --json` shape and broke a check. The same commit
  was green in CI.
- The CI legs are faster than the local run. `gh api
  repos/coo1white/cool-workflow/commits/<sha>/check-runs`: on `4778e19a`,
  `check (18)` 4m09s and `check (22)` 3m30s; on `f4900cf1`, `check (18)`
  3m58s and `check (22)` 4m07s.
- `gh api repos/coo1white/cool-workflow/branches/main/protection/required_status_checks`:
  `contexts` = `["check (18)", "check (22)"]`, both from app id 15368
  (GitHub Actions). `check (24)`, the macOS leg and the release rehearsal
  are not required.
- On `7f184b60` (the #781 merge) every `check` leg is `completed` with
  conclusion `cancelled`: the next merge came 2 minutes later and CI's
  `cancel-in-progress` stopped them. So "completed" alone is not green; a
  commit can be on `main` with no green run at all.
- `release:doctor`'s `head-current` check (#780) makes HEAD equal the
  `origin/main` tip before a cut, so the cut commit is on GitHub and has
  CI.
- `growth:check` before this file: md 123/124.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- **Keep the local run as the default, add `--tests-from-ci` as an
  opt-in:** turned down. No POLA record is needed, but every cut still
  pays the 10 minutes and the machine risk unless the operator remembers a
  flag, which is the problem #782 is about. Simple, small upkeep, easy to
  undo — and does not do the job.
- **Trust branch protection and skip the test step when HEAD is the
  `origin/main` tip:** turned down. Protection judges the PR head, not
  the merge commit on `main`, and a `main` run can be cancelled or red (see
  `7f184b60`). It would treat "could not check" as green.
- **Chosen:** `release-gate.js --tests-from-ci` reads the check runs for
  HEAD with `gh` and passes only on `completed` + `success`, from GitHub
  Actions, for the exact SHA; `release-flow.js` passes the flag by default;
  `--local-tests` / `CW_RELEASE_LOCAL_TESTS=1` is the old way. One small
  module, one list of names. Undone by dropping the flag from
  `release-flow.js`.

## Spec

- `scripts/release-ci-checks.js` (new): `REQUIRED_CHECKS = ["check (18)",
  "check (22)"]`, the one list; `evaluateCheckRuns` (pure) and
  `queryRequiredChecks` (git + gh, never throws). States: ok, pending,
  failure, missing, error. Only ok is green.
- `scripts/release-gate.js`: `--tests-from-ci` replaces the tests step
  with the CI read; on a pass it writes `.cw-release/gate-ci-<sha>.json`
  (not tracked). With no flag the gate is unchanged (`release.yml` runs the
  full suite on a tag push). Test seam `CW_RELEASE_GATE_GH_CMD`.
- `scripts/release-flow.js`: runs the gate with `--tests-from-ci` unless
  `--local-tests` or `CW_RELEASE_LOCAL_TESTS=1`; reads the evidence back
  and fails closed if it is missing or not green for HEAD; puts the mode
  and run URLs into the reviewer input; adds `gateTests` to its last JSON
  object (an added key).
- `scripts/release-oneclick.js`: in the cut stage, waits (45 min deadline)
  for the required checks on the cut commit; a red check stops it;
  `--local-tests` is passed on.
- `.github/workflows/ci.yml`: the `release-rehearsal` job runs
  `release-flow.js --check --local-tests` (it runs beside the `check`
  jobs and cannot wait on them). `test/ci-shape-gate-smoke.js` holds that
  and that each required name is a leg of the `check` matrix.
- `agents/release-reviewer.md` step 2, `docs/release-tooling.7.md`, and
  `AGENTS.md` say the new default and the opt-in.
- `test/release-gate-ci-checks-smoke.js` (new): green → pass with no
  local suite; red, cancelled, missing, pending, another app, another SHA,
  a red re-run, bad JSON, gh error, gh missing, non-GitHub origin → fail
  closed with no local suite; gate default unchanged; release-flow CI mode
  by default and local suite only on the opt-in. It fails before the
  change.

## Acceptance

- The new smoke and every release smoke pass; the full suite passes in CI.
- The 0.4.0 cut runs `npm run release -- 0.4.0` with no local test suite,
  and the reviewer input names the two green runs.

## Architecture snapshot diff (claims this program makes stale)

- `AGENTS.md` "What the gate actually runs" and "Cutting efficiently"
  said the cut runs the full suite locally and the reviewer runs the gate
  again. Fixed in this PR.
- `docs/release-tooling.7.md` "CI release rehearsal" showed
  `release-flow.js --check` with no flag. Fixed in this PR.

## What this spec got wrong (recorded at close)

(Filled by the closing PR.)

## Status ledger

| Step | State | PR |
|---|---|---|
| 1. `release:doctor` preflight | done | #780 |
| 2. CI release rehearsal | done | #781 |
| 3. Gate takes the green CI on the reviewed commit | in this PR | this PR |
| Ships in 0.4.0 (minor raise) | after merge | — |

## Operator decisions for 0.4.0 (2026-10-16)

Two more default changes go out in 0.4.0 under the POLA exception
(`AGENTS.md`, FreeBSD rule 1: the operator's own dated yes here, the
matching `docs/*.7.md` in the same diff, and a minor version raise at
release). The questions were put to the operator in plain words, as
written here:

1. "`cw run resume <id> --repo X`: if the run isn't in folder X, it
   currently goes and finds it in another folder. Should it stop with an
   error instead? — My recommendation: Yes, stop."
2. "`cw backend agent-config set`: when you switch to a new agent
   command, it keeps the old command's settings. Clear them? — My
   recommendation: Yes, clear them."

The operator's answer, word for word (2026-10-16): "ok to all"

| Decision | Issue | Branch | Man page |
|---|---|---|---|
| 1. A folder named with `--repo`/`--cwd` holds `run resume` to that folder | #786 | `claude/trusting-wozniak-d0z17o-resume-repo-strict` | `docs/run-registry-control-plane.7.md`, `docs/agent-delegation-drive.7.md` |
| 2. A changed `--agent-command` clears the stored args | #784 | `claude/trusting-wozniak-d0z17o-agent-config-set-args` | `docs/agent-delegation-drive.7.md` |
