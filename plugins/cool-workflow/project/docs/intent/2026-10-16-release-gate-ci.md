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
This changes a release default, so it goes out in the next release (0.3.1;
see "Operator decision on version numbers" below).

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
- The 0.3.1 cut runs `npm run release -- 0.3.1` with no local test suite,
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
| Ships in 0.3.1 (version raise) | after merge | — |

## Operator decisions for 0.3.1 (2026-10-16)

Two more default changes go out in 0.3.1 under the POLA exception
(`AGENTS.md`, FreeBSD rule 1: the operator's own dated yes here, the
matching `docs/*.7.md` in the same diff, and a version raise at
release). (Written as 0.4.0 at first; see the next part.) The
questions were put to the operator in plain words, as
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

## Operator decision on version numbers (2026-10-17)

The POLA exception asked for a minor version raise on 0.x (0.3.0 to 0.4.0)
when a default changes. The operator chose patch steps instead. Their
words, as written (2026-10-17): "I prefer v0.3.1, 0.3.2, 0.3.3 ....." and
"no, we just release v0.3.0, next release will be v0.3.1, not v0.4.0".

So on 0.x the third check of the exception is now "the release raises the
version", a patch raise included. The other two checks (the operator's
dated yes here, the man page in the same range) are unchanged. Changed in
the same diff: `AGENTS.md` FreeBSD rule 1, `agents/release-reviewer.md`
check 3, `docs/unix-principles.md`, `docs/release-tooling.7.md`, and
every "0.4.0" in the man pages, code notes and tests, now "0.3.1".

## Operator decisions for 0.3.2 (2026-10-17)

The release reviewer said no to the first 0.3.2 cut: changes users will
see had no quoted, dated yes from the operator (the slim-and-esm archive
only says "Answered by the operator on 2026-09-28: yes to all six"). The
questions were put to the operator in plain words, as written here.

First question, word for word: "The reviewer needs your own words, dated,
saying yes to the changes users will see in 0.3.2. Do you approve these:
(1) CW needs Node 22.13 or newer (Node 18 and 20 can no longer install
it); (2) `cw doctor` now says '(>= 22.13)' where it said '(>= 18)'; (3)
`cw doctor --onramp` (only in a CW checkout) names test files ending in
.mjs instead of .js?"

The operator's answer, word for word (2026-10-17): "Yes, approve all three"

Second question, word for word: "The reviewer's other rule: a release must
give users something new (a North Star track). 0.3.2 so far is mostly
cleanup (smaller code, new module style). What should we do?" The two
answers offered were "Add one small user fix (Recommended): Add a real
recovery fix to 0.3.2: if you copy a run folder by hand and open the copy,
CW today writes into the ORIGINAL folder by mistake. Fix: CW refuses and
tells you to use 'cw run import'. Serves Track B (recovery). About one PR,
then release." and "Wait for a bigger feature".

The operator's answer, word for word (2026-10-17): "Add one small user fix
(Recommended)"

The operator also wrote, word for word (2026-10-17): "accept refactor for
let software better". This is their general yes to the slim-and-ESM
refactor going out in 0.3.2. It does not take the place of the reviewer's
direction rule: the Track B fix named below is the part of 0.3.2 that
serves a track.

The exact byte changes the first answer covers, v0.3.1 to 0.3.2:

| Change | v0.3.1 | 0.3.2 | Code | Man page |
|---|---|---|---|---|
| `package.json` `engines.node` | `>=18` | `>=22.13.0` | `package.json` | `docs/release-and-migration.7.md` (Node floor) |
| `cw doctor` node check, ok detail | `Node <version> (>= 18).` | `Node <version> (>= 22.13).` | `src/shell/doctor.ts` | `docs/doctor.7.md` (CHECKS, node) |
| `cw doctor` node check, fail detail | `Node <version> is below the required v18.` | `Node <version> is below the required v22.13.` | `src/shell/doctor.ts` | `docs/doctor.7.md` (CHECKS, node) |
| `cw doctor` node check, fix | `Install Node.js 18+ (...)` | `Install Node.js 22.13+ (...)` | `src/shell/doctor.ts` | `docs/doctor.7.md` (CHECKS, node) |
| `cw doctor --onramp` smoke and script paths | `<name>-smoke.js`, `scripts/onramp-check.js`, `scripts/parity-check.js` | `<name>-smoke.mjs`, `scripts/onramp-check.mjs`, `scripts/parity-check.mjs` | `src/shell/onramp.ts` | `docs/doctor.7.md` (`--onramp`) |

`docs/release-and-migration.7.md` (Module Form) names these as the only
output changes of the ES module move.

The second answer also says yes, as an operator-approved default change
under the same POLA exception, to the copied-run-folder refusal: opening a
run folder that was copied by hand stops with an error that names
`cw run import`, where before CW wrote into the original folder. That
change goes out in its own PR, with its own man page change, in 0.3.2.

Then the operator wrote, word for word (2026-10-17): "if we can get more
useful feature in this cut, i'm ok for expand content".

Third question, word for word: "Which extra features should go into 0.3.2?
These are the small, safe ones from the project's own to-do list (each
about one PR). Pick any." The answers offered (more than one could be
picked) were:

- "Release notes say what's new: The release tool writes a short 'What
  changed' list (up to 6 plain bullets from the PR titles) at the top of
  each GitHub Release, so users know what to try. No AI call. Track A."
- "Live progress lines in order: When CW runs several agents at once, the
  screen prints 'spawning agent' for each one only AFTER they all finish,
  which is backwards. Fix: print them when they start. Only changes what
  you see in a terminal; piped output stays the same. Track A."
- "Keep feedback written during a run: If you record feedback (cw feedback
  / cw worker) while a run is being driven, the next save can silently
  erase it. Fix: keep the other write instead of losing it. Bigger and
  riskier (touches saving). Track B."

The operator's answer, word for word (2026-10-17): "Release notes say
what's new,Live progress lines in order,Keep feedback written during a run"

So these are operator-approved changes for 0.3.2 too, each going out in
its own PR with its own man page change: the "What changed" list in
release notes; the TTY-only change to the order of the "spawning agent"
lines on stderr (piped output keeps its bytes); and the save that keeps
feedback written by another process during a driven run in place of
erasing it.

## Operator decisions for 0.3.3 (2026-10-17)

A user report on 0.3.2 (a `cw -q` run with a user wrapper script as
`CW_AGENT_COMMAND`, on a TTY) showed three rounds of about 10 minutes
each, then a park whose reason said the agent "failed to spawn". The
agent had started; it ran past its time limit, and the drive tried the
same round three times with no word of why. PR #818 fixes this. One part
of the fix changes a default, so the question was put to the operator.

The question, word for word, as it was shown (in Chinese): "Agent
超时后，CW 现在还会再试 2 次（共 3 次，约 30 分钟）。卡住 10 分钟的 agent
再试基本也会卡住。要改吗？（改默认行为需要你的同意）"

In English: "After an agent times out, CW now tries it 2 more times (3 in
all, about 30 minutes). An agent that hung for 10 minutes will most likely
hang again. Change it? (Changing a default needs your yes.)"

The answers offered, word for word:

- "超时只试 1 次 (Recommended)" — "超时后立刻停下保存，屏幕告诉你：调大
  CW_AGENT_TIMEOUT_MS 或检查 agent 脚本。最多等 10 分钟。其他失败仍试 3
  次。" In English: "Only 1 try on a timeout (Recommended)": stop and save
  at once after a timeout, and the screen tells you to raise
  CW_AGENT_TIMEOUT_MS or check the agent script. At most a 10-minute wait.
  Other failures still get 3 tries.
- "超时最多再试 1 次" In English: "At most 1 more try after a timeout."
- "不改，保持 3 次" In English: "No change; keep 3 tries."

The operator's answer, word for word (2026-10-17): "超时只试 1 次
(Recommended)"

So this default change is approved under the POLA exception (AGENTS.md,
FreeBSD rule 1): a hop refused because the agent ran past its time limit
(the serial path and the concurrent round both) parks on its first try,
with a reason that ends `(attempt 1/1; limit <time>) — not tried again:
raise CW_AGENT_TIMEOUT_MS (or --agent-timeout-ms) or check the agent
command`. Every other failure keeps 3 tries. A resume still gives a parked
worker a fresh try. The rule is in `src/core/pipeline/drive-decide.ts`
(`retryOrPark`, `timeoutAttemptLimit`); `docs/agent-delegation-drive.7.md`
("A timeout parks at once") says the new default. The version raise comes
in the 0.3.3 bump PR.

The other changes in PR #818 that users can see are fixes, shipped under
the operator's request to fix everything before 0.3.3. Their words, as
written (2026-10-17), after a 0.3.2 run lost about 30 minutes to a stuck
agent: "有没有办法全部修复好，发版一个无法正常使用的版本，没有任何意义"
("Is there a way to fix it all? Putting out a version that does not work
right has no point."). Which of them change default bytes:

| Change | Before (0.3.2) | 0.3.3 | Default bytes changed? |
|---|---|---|---|
| Refusal text for a concurrent-round agent that timed out | `agent process returned no exit code (timed out or killed)` | `agent process timed out after <ms>ms and was killed` | Yes: the park `reason` in `--json` stdout, `state.json`, and the TTY `Why:` line |
| Refusal text when the whole batch child fails | `agent process failed to spawn: batch delegate failed: ...` | `agent delegation failed: batch delegate failed: ...` (an ETIMEDOUT also names its limit) | Yes, same places, only on that failure |
| `[drive] ✗ <label> (<phase>) — <why>; trying again (n/max)` line | none | printed when a hop fails and will be tried again | TTY or `CW_DRIVE_PROGRESS=1` only, stderr only; piped bytes unchanged |
| `[drive] ==> <Phase> ...` line | after the first round of a phase only | after every concurrent round | TTY or `CW_DRIVE_PROGRESS=1` only, stderr only; piped bytes unchanged |
| Batch delegate child exit code after a stop signal | 0 when every job then ended on its own | 130 (SIGINT) or 143 (SIGTERM) | Internal: the child's exit code is read only by `runAgentBatchOutcomes`, not shown to users |
| A refused envelope for a timeout | no `timedOutMs` key | `timedOutMs: <ms>` added | Additive JSON key, only on a timeout |
| Env of the delegated agent child (found in the operator's 0.3.3 test run: `claude -p` worked in the shell, but every `cw -q ... -claude` worker got `403 Request not allowed`, as the proxy vars were dropped) | `PATH`, `HOME`, `expose`, provider-key vars, `USER` | also `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (and the lowercase forms), `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, and `CLAUDE_*` | Only the names list of the `worker.agent-env` audit event, and only when such vars are set; values are never kept; a policy `deny` still takes them out |
