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

The rows above that change default bytes were first shipped under that
broad request alone. The 0.3.3 release review (grok, 2026-11-03) rejected
the cut for it: a broad request is not a quoted yes to each named
default. So each was then put to the operator as its own question
(2026-11-03). The questions and answers, word for word:

- For the last row of the table (the delegated agent child's env): "0.3.3 默认改动③（agent 环境变量）：0.3.2 时，CW 启动 agent（如 claude -p）只传 PATH、HOME、USER 和 CW_/ANTHROPIC_ 等 API key 变量，所以在代理后面的机器上，每个 worker 都报 "403 Request not allowed"（你 10 月 17 日的测试就遇到过）。0.3.3 改成：设置了的话，也把 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY（含小写）、NODE_EXTRA_CA_CERTS/SSL_CERT_FILE/SSL_CERT_DIR、以及所有 CLAUDE_* 变量（如 CLAUDE_CONFIG_DIR，claude 用它找登录信息）传给 agent。值不记录，只在审计事件 worker.agent-env 里记名字；沙箱 deny 列表里的名字仍会被去掉。你同意把这个作为 0.3.3 的新默认吗？"
  In English: Default change 3 (agent env): the delegated agent child also gets the proxy vars (upper and lower case), NODE_EXTRA_CA_CERTS / SSL_CERT_FILE / SSL_CERT_DIR, and every CLAUDE_* var, when set; only the names go in the worker.agent-env audit event; a policy deny still takes a name out. Agree to this as the 0.3.3 default?
  The operator's answer, word for word (2026-11-03): "同意，保留新默认".
- For the `[drive] ✗ ... trying again` row and the `[drive] ==> <Phase>` row: "0.3.3 默认改动④（终端进度行，只在终端或 CW_DRIVE_PROGRESS=1 时出现在 stderr，管道输出一个字节都不变）：(a) 一个 agent 失败、马上要重试时，新加一行 `[drive] ✗ <任务> (<阶段>) — <原因>; trying again (n/max)`，0.3.2 是什么都不显示；(b) 阶段标题行 `[drive] ==> <阶段> ...`，0.3.2 只在每个阶段第一轮后打印一次，0.3.3 在每个并发轮结束后都再打印一次，让你知道还在哪个阶段。你同意这两处终端显示的改动吗？"
  In English: Default change 4 (terminal progress lines; TTY or CW_DRIVE_PROGRESS=1, stderr only, piped bytes unchanged): (a) a new `[drive] ✗ ... trying again (n/max)` line when a failed hop will be tried again; (b) the `[drive] ==> <Phase>` line is printed again after every concurrent round, not once per phase. Agree to both?
  The operator's answer, word for word (2026-11-03): "同意两处都改".
- For the two refusal-text rows: "0.3.3 默认改动⑤（失败原因文字，出现在 --json 输出、state.json 和终端的 Why: 行）：(a) 并发轮里 agent 超时，原因从 "agent process returned no exit code (timed out or killed)" 改成 "agent process timed out after <毫秒>ms and was killed"，写明超时多久；(b) 整个批处理子进程失败时，从 "agent process failed to spawn: batch delegate failed: ..." 改成 "agent delegation failed: batch delegate failed: ..."，因为那种情况不是启动失败，旧文字说错了（超时还会写明上限）。你同意这两处文字的改动吗？"
  In English: Default change 5 (refusal text in --json, state.json and the TTY Why: line): (a) a timed-out concurrent agent reads "agent process timed out after <ms>ms and was killed"; (b) a failed batch child reads "agent delegation failed: batch delegate failed: ..." (not "failed to spawn"). Agree to both?
  The operator's answer, word for word (2026-11-03): "同意两处都改".

Rows not asked: the batch child's exit code is internal (read only by
`runAgentBatchOutcomes`), and `timedOutMs` is an added JSON key, which
POLA allows. The man pages and the 0.3.2 -> 0.3.3 version raise were
already in place for every row.

### Operator decisions for 0.3.3, third set (2026-11-03)

The fourth 0.3.3 release review (grok, 2026-11-03) found one more changed
default with no quoted yes: the `preinstall` guard taken out of the
package (commit a4f8b70c). A sweep of every non-docs commit in
`v0.3.2..main` found one more: the batch child starts the agents of a
TTY concurrent round with `CW_AGENT_STREAM=1` (commit f6526a8a), which
adds progress lines to a failed agent's `agent-stderr.log`. Each was put
to the operator as its own question. The questions and answers, word for
word:

- "0.3.3 默认改动⑥（npm 安装）：0.2.8 到 0.3.2 的 package.json 里有一个 preinstall 脚本，本意是挡住贡献者在源码里用 npm（项目用 bun），但它也随包发给了用户，结果普通用户的 `npm i cool-workflow`（非全局安装）和 `npx cool-workflow` 都会失败（退出码 1，npx 甚至没有提示）。0.3.3 去掉了这个脚本，这两个命令现在能正常装、正常跑（退出码 0）；`npm i -g` 不受影响。贡献者误用 npm 改由测试门禁和 CI 拦下。你同意把这个作为 0.3.3 的新默认吗？"
  In English: "Default change 6 (npm install): up to 0.3.2 a `preinstall`
  script meant for the source checkout shipped to users, so a local
  `npm i cool-workflow` and `npx cool-workflow` failed (exit 1). 0.3.3
  removes it; both now install and run (exit 0); `npm i -g` is
  unchanged; a contributor's npm use is caught by the test gate and CI.
  Agree to this as the 0.3.3 default?"
  The operator's answer, word for word (2026-11-03): "同意，保留新默认".
- "0.3.3 默认改动⑦（agent 失败日志）：为了让「最后输出在 N 秒前」这条提示（你 11-02 已同意默认开启）对内置的 claude/codex/gemini 包装器也有效，并发轮在终端里运行时，CW 会给 agent 子进程设 CW_AGENT_STREAM=1（你自己设了值就用你的）。副作用：agent 失败时保存的 <worker>/logs/agent-stderr.log 里会多出每一步一行的进度文字；终端屏幕上的输出和管道输出都不变。你同意这个改动吗？"
  In English: "Default change 7 (agent failure log): so the 'last output
  N ago' note (on by default, agreed 11-02) is true for the bundled
  claude/codex/gemini wrappers, a TTY concurrent round starts the agent
  with CW_AGENT_STREAM=1 (a value you set is kept). Side effect: a failed
  agent's `<worker>/logs/agent-stderr.log` holds a progress line per
  step; the screen and piped output do not change. Agree?"
  The operator's answer, word for word (2026-11-03): "同意".

`docs/release-and-migration.7.md` ("Installing with npm and npx (0.3.3)")
and `docs/agent-delegation-drive.7.md` (the quiet-note paragraph) say the
new defaults; the version raise is 0.3.2 -> 0.3.3.

### Operator decisions for 0.3.3, fourth set (2026-11-03)

After four release-review rejections, an independent review swept the
whole `v0.3.2..` range against `agents/release-reviewer.md` and found a
bug and two more changed defaults with no yes that named them. Each was
put to the operator; the questions and answers, word for word:

- "① cw app list 读 ./apps 的副作用。审核发现两个问题：(1) 只要当前目录 apps/ 里有一个不是 CW 的 app.json（比如 Expo 项目常见的 apps/mobile/app.json），`cw app list`、`cw list`、`cw app show` 就会报错退出（0.3.2 是正常的），`cw quickstart --check` 还会误报 app 不可用。这个是 bug，我会直接修：跳过不是 CW 格式的 app.json，CW 格式但写错的仍然报错。(2) 列出 app 时会执行 ./apps/*/workflow.js 里的代码（0.3.2 只在你明确运行某个 app 时才执行）。第 (2) 点怎么处理？" Answer (2026-11-03): "列出时不执行代码". So (1) is fixed and
  (2) is taken back: listing `./apps` reads each `app.json` alone (a
  non-CW one is skipped; `phases` and `taskCount` are `null` in `cw app
  list --json` for those apps), and only `cw app show <id>` / `cw plan
  <id>` runs an app's code, as in 0.3.2. `docs/init.7.md` says so.
- "② cw doctor：设了自定义 CW_AGENT_COMMAND（比如你的 grok-review 脚本）或用 builtin:deepseek 时，0.3.2 的结论是 `ready — all checks passed`；0.3.3 不运行它，却多了一行 `! agent-runs: not probed: custom command …` 加一行 fix:，结论变成 `ready, with 1 warning`（退出码仍是 0）。另外，已知 CLI（claude/codex 等）运行 `--version` 失败时，doctor 退出码从 0 变成 1。怎么处理？" Answer (2026-11-03): "去掉那行警告，退出码变化保留". So a custom
  command or a CLI-less builtin adds no `agent-runs` row (doctor prints
  what 0.3.2 printed), and a known CLI that cannot run fails doctor, exit
  1 (`docs/doctor.7.md`, "agent-runs").
- "③ NODE_USE_ENV_PROXY：如果你自己设了这个变量，0.3.3 会把它传给 agent 子进程和允许联网的 local/container 任务（0.3.2 不传），名字会进 worker.agent-env 审计事件（不记录值）。之前问你的代理问题里漏了这个变量。怎么处理？" Answer (2026-11-03): "同意传递". So `NODE_USE_ENV_PROXY`, when
  the user set it, goes with the other proxy vars (`NETWORK_ENV_NAMES`);
  `docs/sandbox-profiles.7.md` names it.

The same review found `startedAt`, `endedAt` and `lastOutputAt` on each
batch-child line, which no code read; they were taken out (the drive
ticker reads its own alive file). The version raise is 0.3.2 -> 0.3.3.

### `cw doctor` runs the agent one time (agent-runs)

In the operator's 0.3.3 acceptance test, `cw doctor` said all was well
(`✓ agent-binary: Agent binary ... found`), but the agent could not run:
`claude` printed `Error: claude native binary not installed. ... Or
reinstall without --ignore-scripts / --omit=optional.` and exited 1 (npm
had stopped its postinstall). Doctor only looked to see that the file was
there.

The question, word for word, as it was shown (in Chinese): "0.3.3
发布前，还要加哪些？（可多选；都不选就直接发 0.3.3）" In English: "Before
0.3.3 goes out, what more should be added? (More than one may be picked;
pick none and 0.3.3 goes out as it is.)"

The answer picked, its label word for word: "doctor 真的运行一次 agent".
Its description as it was shown, word for word: "cw doctor 运行 agent 的
--version，跑不起来就报错并贴出它的修复提示（这次的安装不完整问题能提前发现）。会改变
doctor 的输出。" In English: "`cw doctor` runs the agent's `--version`; if it
will not run, doctor says so and shows the agent's own fix hint (so this
time's broken install is seen before a run). It changes doctor's output."

The operator's full answer, word for word (2026-10-17): "doctor 真的运行一次
agent,把 ⇉ 换成常见符号,修正进度行互相打架" In English: "doctor really
runs the agent once; put a common sign in place of ⇉; fix the progress
lines that get in each other's way." This part covers the first of the
three; the other two are in their own PRs.

So this default change is approved under the POLA exception (AGENTS.md,
FreeBSD rule 1). The bytes that change, 0.3.2 to 0.3.3:

| Change | 0.3.2 | 0.3.3 | Code | Man page |
|---|---|---|---|---|
| `cw doctor` human output, an agent command set | no `agent-runs` line | one more line after the agent lines: `✓ agent-runs: <cli> --version → <first line>`, `✗ agent-runs: ...` with a `fix:` line, or `! agent-runs: not probed: ...` | `src/shell/doctor.ts`, `src/shell/agent-config.ts` (`agentProbeTarget`), `scripts/agents/builtin-templates.json` (`versionProbe`) | `docs/doctor.7.md` (CHECKS, agent-runs) |
| `cw doctor --json`, an agent command set | no `agent-runs` entry | one more entry in `checks`, the same `name`/`status`/`detail`/`fix` shape | same | same |
| `cw doctor` verdict and exit code when the set agent's CLI will not run | `ready`, exit 0 | `1 blocking problem found`, `ok: false`, exit 1 | same | same |
| `cw doctor` with a custom `CW_AGENT_COMMAND` (not a known vendor CLI) | `ready — all checks passed` | `ready, with 1 warning` (`not probed: custom command`); the custom command is never run | same | same |

With no agent set, or an HTTP endpoint only, doctor's bytes do not change.
The other checks keep their bytes. Doctor never prints env values.

### Terminal display: the » mark, and progress lines that no longer fight

Before 0.3.3 went out, the operator was asked what more to put in it. The
question, word for word, as it was shown (in Chinese): "0.3.3 发布前，还要加哪些？（可多选；都不选就直接发 0.3.3）"
In English: "Before 0.3.3 goes out, what more should go in? (Pick any
number; pick none and 0.3.3 goes out as it is.)"

Two of the answers picked, word for word, with the words shown under
them:

- "把 ⇉ 换成常见符号" — "换成几乎所有字体都有的符号，不再显示方框。只影响终端里的进度提示。"
  In English: "Put a common mark in place of ⇉": use a mark that nearly
  every font has, so no box is shown. Only the progress lines in the
  terminal are changed.
- "修正进度行互相打架" — "Verify/Verdict 阶段不再重复刷 ● claude: reading…，也不再两条进度挤在一行。只影响终端显示。"
  In English: "Stop the progress lines fighting": in the Verify and
  Verdict phases, `● claude: reading…` is no longer printed again and
  again, and two progress lines are no longer joined into one. Only what
  the terminal shows is changed.

The operator's full answer, word for word (2026-10-17): "doctor 真的运行一次 agent,把 ⇉ 换成常见符号,修正进度行互相打架"

So these two changes are approved under the POLA exception (AGENTS.md,
FreeBSD rule 1). Bytes change only in `[drive]` progress on stderr, which
is on only on a TTY or with `CW_DRIVE_PROGRESS=1`; a piped run's stdout
and stderr keep their bytes. `docs/agent-delegation-drive.7.md` says the
new behavior ("One writer at a time on the terminal", "» marks a
concurrent round"); the version raise comes in the 0.3.3 bump PR.

| Change | Before (0.3.2) | 0.3.3 | Code |
|---|---|---|---|
| Concurrent round line | `[drive] ⇉ concurrent round: N agents …` | `[drive] » concurrent round: N agents …` | `src/shell/drive.ts` |
| Active parallel phase line | `[drive] ==> Map ⇉ (0/2)` | `[drive] ==> Map » (0/2)` | `src/shell/term.ts` `phaseProgressLine` |
| `[drive]   … <Phase> still working — Ns` in a serial hop whose agent draws a live view on the terminal | written into the view: joined to the spinner row, and one more `● …` row left behind at each tick | not written while the view holds the `CW_DRIVE_TTY_CLAIM` file | `scripts/children/drive-ticker.mjs`, `scripts/agents/agent-adapter-core.mjs` `createRenderer`, `src/shell/execution-backend/agent.ts` |

Why `»` (U+00BB): it is in Latin-1, so every terminal font has it
(Cascadia, Consolas, DejaVu Sans Mono, Menlo); `⇉` (U+21C9, in the Arrows
block) is not in every one of them, and Windows Terminal on WSL showed a
box. ASCII `>>` was weighed and turned down: `==> Map >> (0/2)` is hard to
tell from the `==>` mark itself, and `»` keeps the one-column shape.

## Operator decisions for 0.3.3, second set (2026-11-02)

While 0.3.3 waited to be cut, a study of a sibling project (yokoten, record 0029: keep
"is it alive" apart from "how did it end") gave three ideas for CW. The
first, an opt-in idle limit (`CW_AGENT_IDLE_TIMEOUT_MS`, PR #827), changes
no default. The second, `cw doctor --conformance` (PR #828), is a new
flag. The third shows on the TTY how long the agents have been quiet, and
that changes the bytes of an existing line, so it was put to the operator.

The proposal, as it was shown (in Chinese), in part: "进度行（只在终端里
显示）：现在 `… still working — 4m 10s`，改成 `… still working — 4m 10s
(last output 3m 50s ago)` … 我的建议：第 3 层默认打开。它只在终端（TTY）
出现，被管道接走时一个字节都不变" and the question: "第 3 层（终端进度行显示
'最后输出在 N 秒前'）默认打开，同意吗？"

In English: "The progress line (shown only on a terminal): now
`… still working — 4m 10s`, changed to `… still working — 4m 10s (last
output 3m 50s ago)` … My advice: turn layer 3 on by default. It shows only
on a TTY; a piped run's bytes do not change by one byte." and the question:
"Turn layer 3 (the terminal progress line shows 'last output N seconds
ago') on by default — do you agree?"

The operator's answer, word for word (2026-11-02): "ok，都按推荐来"
In English: "ok, do all of it as recommended".

So this default change is approved under the POLA exception (AGENTS.md,
FreeBSD rule 1): in a concurrent round, the drive ticker's
`still working` line ends with `(last output <time> ago)` for one running
agent, or `(<n> agents running, longest without output <time>)` for more.
A serial hop, a tick before the first write, and a piped run keep the old
bytes. The code is `scripts/children/drive-ticker.mjs` (`quietNote`),
`scripts/children/batch-delegate-child.mjs` (`CW_BATCH_ALIVE_FILE`) and
`src/shell/drive.ts` (`withDriveTicker`); `docs/agent-delegation-drive.7.md`
("How long the agents have been quiet") says the new default.

The version raise. These changes were first labelled 0.3.4, to follow a
0.3.3 that was not yet cut. The operator then chose, word for word
(2026-11-02): "我建议放v0.3.3" and "这样才算是一个大版本". In English: "I
suggest putting it in v0.3.3" and "only that makes it a big release". So
0.3.3 is cut after this work and the agent sandbox work (an opt-in
`srt` run of the agent, still to come), and the labels say 0.3.3. The
version raise is 0.3.2 -> 0.3.3, already on `main` from the bump PR #824;
0.3.2 is the last version on npm.

### `cw init` writes to ./apps by default (2026-11-02)

A doc audit found that `cw init <id>` (and `cw app init`) with no
`--output` wrote the new app into the `apps/` folder of the CW package
that was running: for an installed CW, a folder inside `node_modules`,
which may not be writable and is wiped on the next upgrade. The question
was put to the operator, in Chinese; in English: "By default `cw init`
puts a new app inside the installed CW package, which may not be
writable and is lost on upgrade. My advice: make the default `./apps` in
the current folder. That changes behaviour, so it needs your yes. Change
it?"

The operator's answer, word for word (2026-11-02): "同意，cw init 默认改成
./apps". In English: "Agreed, change the cw init default to ./apps".

So under the POLA exception: with no `--output` (or `--directory`), the
app folder is `$CW_APPS_DIR/<id>` when `CW_APPS_DIR` is set, else
`./apps/<id>` in the folder the command runs in (the MCP tool's `cwd`
when it gives one). `--output` still wins. The app is still found by id
(`cw plan <id>`, `cw run`) from that folder, since `./apps` was already a
place CW looks. `cw app list` then did not show such an app (it listed only the first
apps root it found), so a second question followed: list `./apps` too? The
operator's answer, word for word (2026-11-02): "同意，cw app list 也显示
./apps" ("Agreed, cw app list shows ./apps too"). So `cw app list` (and
`cw list`, which reads the same records) now also lists the apps in
`./apps` of the folder it runs in, when that folder is not the apps root
already listed. An id that is in both fails closed, as any duplicate id
always has ("Duplicate workflow app id ..."), so an app is never shown
twice or silently hidden.

Standing instruction from the operator, word for word (2026-11-02): "别问我了，
都按照你的推荐迭代" ("Stop asking me; iterate on all of it as you
recommend"). Changes of a default made under it still get their own part
here, naming that instruction as the yes. The code is `initWorkflowApp` in
`src/shell/workflow-app-loader.ts`; `docs/init.7.md` says the new default;
the version raise is 0.3.2 -> 0.3.3.

### Proxy and CA vars for CW's other children (2026-11-02)

The first set above passed the proxy and CA vars to the delegated agent
child only. While 0.3.3 waited, the operator's own test of `srt` on WSL
showed the same fault one step out (a child that loses the proxy vars
cannot reach the network behind a proxy), so the question was put to the
operator, in Chinese, word for word: "\"以点带面，全局检查修复\" — 你指的“点”是
哪一个？", with, among others, this choice, its label and description word
for word: "所有子进程的代理/环境变量" — "把 CW 启动子进程的每一处（agent、doctor
探测、release 流程、wrapper、git 等）都查一遍代理、证书变量是否正确传递，统一修。"
In English: "Proxy/env vars for every child process — go through every
place CW starts a child process (agent, doctor probes, the release flow,
wrappers, git, and so on), check that the proxy and certificate vars are
passed right, and fix them all the same way."

The operator picked it (2026-11-02), with the other two choices, and then
said, word for word: "继续，都修好" ("Go on, fix all of it"). That choice
did not name the default it changes, and the 0.3.3 release review (grok,
2026-11-02) rejected the cut for it. So the default itself was put to the
operator as its own question, word for word:

"0.3.3 默认行为改动①（代理）：0.3.2 之前，CW 的 local 后端（node/bun/shell 任务）和 container 后端（docker/podman）只传 PATH 和 HOME，所以在代理后面联网会失败。0.3.3 改成：只要沙箱配置允许联网（default、workspace-write），就把 HTTP_PROXY/HTTPS_PROXY/NO_PROXY、证书变量（NODE_EXTRA_CA_CERTS 等）也传给它们；readonly、locked-down 不变；remote/ci 永远不传（代理地址可能含密码）。另外 CW 自己用 fetch 的子进程（HTTP agent、remote/ci、下载 --repo 压缩包），在设了代理时会自动加 NODE_USE_ENV_PROXY=1，让它们走代理。你同意把这个作为 0.3.3 的新默认吗？"

In English: "0.3.3 default change 1 (proxy): up to 0.3.2, CW's local
backend (node/bun/shell tasks) and container backend (docker/podman)
passed only PATH and HOME, so going online behind a proxy failed. 0.3.3
changes this: when the sandbox profile lets the network through
(default, workspace-write), HTTP_PROXY/HTTPS_PROXY/NO_PROXY and the
certificate vars (NODE_EXTRA_CA_CERTS and so on) are passed to them too;
readonly and locked-down do not change; remote/ci never get them (a proxy
URL may hold a password). Also, CW's own children that use fetch (the
HTTP agent, remote/ci, the --repo archive download) get
NODE_USE_ENV_PROXY=1 when a proxy is set, so they go through the proxy.
Do you agree to make this the new default in 0.3.3?"

The operator's answer, word for word (2026-11-02): "同意，保留新默认"
("Agreed, keep the new default").

So under the POLA exception (PR #831): the `local` and `container`
backends pass the same proxy and CA vars when the profile lets the
network through (`network.mode` is not `none`); under `readonly` and
`locked-down` nothing changes, and the `remote` and `ci` backends never
get them (a proxy URL may hold a password). When a proxy var is set, the
children CW starts to run `fetch` (the HTTP agent, the `remote` and `ci`
backends, the archive `--repo` download) get `NODE_USE_ENV_PROXY=1`
unless the user set it, and Node's "experimental" note is kept out of
their stderr. The code is `NETWORK_ENV_NAMES`, `addNetworkEnv` and
`fetchChildEnv` in `src/core/util/cli-args.ts`, used by
`src/shell/execution-backend/local.ts`, `container.ts`, `remote.ts`,
`agent.ts` and `src/shell/remote-source.ts`; `docs/sandbox-profiles.7.md`
("Proxy and CA for the other children") says the new default; the version
raise is 0.3.2 -> 0.3.3.

### `cw help ledger`: the `--diff` line (2026-11-02)

A doc audit (PR #830) found that the help line for `cw ledger propose
--diff`, "The change as one diff file.", reads as if `--diff` takes a file
path; it takes the diff text itself. The line was changed, and the 0.3.3
release review (grok, 2026-11-02) rejected the cut as that changed the
bytes of `cw help ledger` without the operator's yes. The question, word
for word:

"0.3.3 默认行为改动②（帮助文字）：`cw help ledger` 里 --diff 的说明，0.3.2 是 "The change as one diff file."（意思是传一个 diff 文件），但实际上它要的是 diff 的文本内容，不是文件路径，原说明会误导人。0.3.3 改成了 "The change itself, as diff text (e.g. "$(git diff)")."。只是帮助文字变了，--diff 的行为没变。你同意这个帮助文字的改动吗？"

In English: "0.3.3 default change 2 (help text): in `cw help ledger`, the
--diff line in 0.3.2 is \"The change as one diff file.\" (that is, pass a
diff file), but it in fact takes the diff's text, not a file path, so the
old line misleads. 0.3.3 changed it to \"The change itself, as diff text
(e.g. \"$(git diff)\").\". Only the help text changed; what --diff does did
not. Do you agree to this help text change?"

The operator's answer, word for word (2026-11-02): "同意，用新说明"
("Agreed, use the new text").

So under the POLA exception: `cw help ledger` (and the matching MCP tool
description) shows the new `--diff` line. The code is
`src/wiring/capability-table/trust-ledger.ts`; the v2 fixture
`v2/conformance/cases/fixtures/cli-help/ledger.txt` and
`test/ledger-verify-smoke.mjs` pin it; `docs/cross-agent-ledger.7.md`
says it; the version raise is 0.3.2 -> 0.3.3.

## Operator decisions for 0.4.0 (2026-11-03)

The 0.4.0 cut was rejected by the release review: the range had no
user-visible capability. A walk through the first run as a new user found
three places where CW's own hints lead nowhere. The operator was asked
which way to go and picked fixing them with the done-receipt feature, word
for word (2026-11-03): "修卡点 + 收据 (推荐)" ("fix the stuck points, plus
the receipt"). The question named the three points. Two more words of the
operator's set the bar for every new text: "一定要用户的UX闭环" ("the
user's UX loop must be closed") and "新手用户也能 流畅易用" ("a new user
must find it smooth and easy too").

Default output this changes, each said in its man page, version 0.3.3 ->
0.4.0:

- The no-agent fix in `cw doctor`, `cw quickstart --check` and the `cw -q`
  hint: from `Pass --agent-command "claude -p", ...` (a form that does not
  complete a worker) to `Install an agent CLI such as Claude Code, then add
  -claude to your cw command, ...` (`doctor.7.md`,
  `agent-delegation-drive.7.md`).
- The parked hint, when the stopped worker has an `agent-stderr.log`: it
  names that file in place of `cw run show` (no JSON key added or taken
  out); the terminal `Why:` block gains an `All of it: <log>` line
  (`agent-delegation-drive.7.md`).
- `cw report bundle` on a terminal prints where the file went, how to put
  it elsewhere (`--output`) and one next step, in place of the JSON; a pipe
  or `--json` keeps the JSON bytes (`report-verifiable-bundle.7.md`).

Left as it is: the bundle's default place (the folder `cw` runs in), which
a change would move for every script that reads it there.

Two more default outputs change with the done receipt, the 0.4.0
headline the same answer picked ("修卡点 + 收据 (推荐)"): `cw help` gains
the row `check -- <command>  Run your tests, keep a receipt` (and `check`
joins the known command words), and `cw doctor --onramp` gains the
quick-start line `cw check -- npm test — keep a receipt that your tests
passed; a result can cite it (no agent needed)`. Both are said in
`verifier-gated-commit.7.md`; the v2 fixture `cli-help/_root.txt` pins
the first. A run that cites no receipt keeps its report and bundle bytes.

### Operator decisions for 0.4.0, named (2026-11-03)

The 0.4.0 cut was rejected a second time: the quotes above did not name
the strings they let change. The operator was then asked about each one
by name, and answered, word for word (2026-11-03): "5 处全部同意 (推荐)"
("all 5 agreed"). The question, word for word, listed the five:

> 1) cw doctor / cw quickstart --check / cw -q 在没配 agent 时的修复提示，从「Pass --agent-command "claude -p"…」改成「Install an agent CLI such as Claude Code, then add -claude to your cw command…」；2) worker 失败停下时的提示改成点名 agent-stderr.log 日志文件，终端的 Why: 下多一行「All of it: <日志路径>」；3) cw report bundle 在终端里显示人话（存到哪、怎么换位置、下一步），不再显示 JSON；管道和 --json 不变；4) cw help 首页新增一行「check -- <command>  Run your tests, keep a receipt」；5) cw doctor --onramp 新增一行「cw check -- npm test — keep a receipt that your tests passed」。

Each is said in its man page: 1 in `doctor.7.md` and
`agent-delegation-drive.7.md`; 2 in `agent-delegation-drive.7.md`; 3 in
`report-verifiable-bundle.7.md`; 4 and 5 in `verifier-gated-commit.7.md`
(DONE RECEIPTS, "Where a new user finds it"), 5 also in `doctor.7.md`.
The version raise is 0.3.3 -> 0.4.0.

The pins these answers cover, for `npm run pola:check` (added after the
answer; it names files, not new consent):

- 1 (the no-agent fix line, which `cw fix` gives back as the same
  doctor fix text): `v2/conformance/cases/report-doctor.case.mjs`,
  `v2/conformance/cases/report-fix.case.mjs`,
  `v2/conformance/cases/exec-doctor-agent-config.case.mjs`,
  `v2/conformance/cases/cli-doctor-fix-app-validate.case.mjs`.
- 4 (the `check` row in `cw help`, and `check` as a known command word):
  `v2/conformance/cases/fixtures/cli-help/_root.txt`,
  `v2/conformance/cases/cli-help-topics.case.mjs`.

`cw fix` was not named in that question, so the operator was asked about
it by name, word for word (2026-11-03): "你上次同意的第 1 处改动（没配
agent 时的修复提示，从「Pass --agent-command "claude -p", set
$CW_AGENT_COMMAND, or use --agent-command builtin:claude.」改成「Install
an agent CLI such as Claude Code, then add -claude to your cw command, for
one: cw -q "your question" -claude (or set
CW_AGENT_COMMAND=builtin:claude). -codex, -gemini and -opencode work
too.」），是否也包括 cw fix 命令显示的同一句话？" The answer, word for
word: "包括 cw fix (推荐)" ("cw fix is included"). So `cw fix`, which
prints the same doctor fix line (`doctor.7.md`), is covered by change 1.

The same review found two faults in `cw check` (new in 0.4.0, so no
default changes): a piped run echoed the command's output on stderr
(now only on a terminal, Rule of Silence), and changes that could not be
read were hashed as a fixed word, so two unreadable trees matched (now
the code state is unknown and a receipt tied to it is refused,
`receipt-stale`, fail closed).

### Operator decisions for 0.4.0, third review (2026-11-03)

The cut was rejected a third time. The `check` row on the `cw help`
front page made six entries where unix-principles(7) allows five, and
`check` had also gone into the "More commands" list and so into `cw
completion`, which no yes named. Item 4 of the answer above is therefore
NOT used: the front page gives the same bytes as 0.3.3.

`check` cannot leave `cw help` altogether: the parity check
(`cli-mcp-parity-smoke`, `cli-arg-parsing-smoke`) holds that every
command `cw` knows is listed in it. The operator was asked about the two
changes that keeps, by name, and answered, word for word (2026-11-03):
"2 处都同意 (推荐)" ("both agreed"). The question, word for word, named
the two:

> 1) `cw help` 的 More commands 最后一行，从「  man|version|fix|completion」变成「  man|version|fix|completion|check」；
> 2) `cw completion`（bash/zsh/fish 的命令补全）的命令词列表多一个词 `check`。
> 首页还是 0.3.3 的 5 行，不变。

Both are said in `verifier-gated-commit.7.md` (DONE RECEIPTS, "Where a
new user finds it"); the v2 fixture `cli-help/_root.txt` pins the first.
The version raise is 0.3.3 -> 0.4.0. A new user finds `cw check` by
item 5 (`cw doctor --onramp`), the README, the "More commands" list and
`cw help check`.

The same review found that no test held the `readCodeState` fix
(unreadable changes give `treeDigest: null`); a unit test with a git
runner and a file reader passed in now does.

## Operator decisions for 0.4.1 (2026-11-03)

Three rejected 0.4.0 cuts each left a `release/v0.4.0-cut` branch that the
operator had to delete by hand before `release:doctor` would pass. The
operator asked "后续可以自动清理吗" ("can it clean up by itself later"). The
cleanup changes the release tool's output, so the operator was asked about
each change by name, and answered, word for word (2026-11-03):
"3 处都同意 (推荐)" ("all 3 agreed"). The question, word for word, named the
three:

> 1) `npm run release:doctor` 的 cut-branch 检查：如果留下的分支是发版工具自己做的，从 FAIL「leftover branch … — it holds old code」改成 WARN「leftover branch … — made by the release tool (<原因>); `npm run release -- X.Y.Z` removes it at the start」；如果分支上有不是工具做的提交，仍是 FAIL，但文字变成「… — <原因>; the cut stage would reset it from origin/main」，并提示先用 git log 看一下要不要保留；其他情况仍是 FAIL，末尾多一句「; not removed for you: <原因>」。
> 2) `npm run release` 开始时，如果删掉了上次留下的分支，stderr 多一行「release-oneclick: removed leftover branch release/vX.Y.Z-cut (<sha>) from an earlier cut that stopped: <原因>.」。
> 3) `npm run release` 中途停下（比如 grok 拒绝）时，stderr 多一行，要么「release-oneclick: removed release/vX.Y.Z-cut (<sha>), made by this run: the cut stopped before tag vX.Y.Z was made, <原因>; back on <你原来的分支>.」，要么「release-oneclick: kept release/vX.Y.Z-cut: <原因> (`npm run release:doctor -- X.Y.Z` says what to do with it).」。
> 它只删本地分支，绝不删 tag、远程分支或 main；证明不了是工具做的就保留。下次发版是 0.4.1。

All three are said in `release-tooling.7.md` ("The leftover cut branch is
cleaned up", and the `cut-branch` row). The version raise is 0.4.0 -> 0.4.1.

### Operator decisions for 0.4.1, three more agents (2026-11-04)

The owner asked for the same "Works with" list as another tool of theirs
(Claude Code, Codex, Copilot, Antigravity, Muse Code, OpenCode, Grok,
DeepSeek). Three new builtin agents, each a wrapper plus a data line, change
the `cw help` output, so the owner was asked by name. The question, word for
word (2026-11-04):

> 新加 GitHub Copilot CLI、Antigravity、Grok 三家 agent（三家都有无界面运行模式 `-p`）。这会改 `cw help` 的 Flags 部分：在「  -muse                  Use Muse Code agent」下面加 3 行：
> 「  -copilot               Use GitHub Copilot CLI agent」
> 「  -antigravity           Use Antigravity agent」
> 「  -grok                  Use Grok agent」
> 其他输出不变。同意这 3 行吗？

The answer, word for word: "3 行都同意 (推荐)" ("all 3 rows agreed").

A second answer the same day, on auto-detect: "先不加，标 beta" ("do not add
them yet; mark them beta"). So `detectAgentFromPath` in
`src/shell/agent-config.ts` keeps its list; the three are used only by
`-copilot`, `-antigravity`, `-grok` or `CW_AGENT_COMMAND=builtin:<name>`,
and the docs and README mark them beta until a real login has passed
`cw doctor --conformance`.

Pins this changes:

- `v2/conformance/cases/fixtures/cli-help/_root.txt`: the three rows above,
  below `-muse`, and nothing else.
- `v2/conformance/cases/exec-doctor-agent-config.case.mjs`: the refusal for
  an unknown `builtin:<name>` lists the templates file in order, so its
  `available:` list now ends `muse, copilot, antigravity, grok`. The question
  above did not name this line, so the owner was asked about it by name
  the same day. The question, word for word:

  > 接入 Copilot、Antigravity、Grok 会多改一行输出，上次问你时漏掉了。用户写错 agent 名字时（比如 CW_AGENT_COMMAND=builtin:doesnotexist），报错信息末尾的可用列表会变：
  > 从「cw: Unknown builtin agent template "doesnotexist" — available: claude, codex, gemini, gemini-cli, opencode, deepseek, muse」
  > 变成「cw: Unknown builtin agent template "doesnotexist" — available: claude, codex, gemini, gemini-cli, opencode, deepseek, muse, copilot, antigravity, grok」
  > 同意这一行吗？

  The answer, word for word: "同意 (推荐)" ("agreed").

The new text is said in `agent-delegation-drive.7.md` ("Beta vendors:
copilot, antigravity, grok"). The version raise is the 0.4.1 one above.
