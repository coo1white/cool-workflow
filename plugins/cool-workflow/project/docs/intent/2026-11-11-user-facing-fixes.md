# User-facing fixes first: the CLI a user can trust at a look

Intent and spec in ONE file (the shape of `2026-11-03-done-receipt.md`).
Accepted by the owner on 2026-11-11: "接受，开始 A 批".

## Intent

### Problem

The owner's view (2026-11-11): problems keep coming, and the work done so
far did not make the product feel better. Four sources of problems were
named: the downstream user (yokoten-doctor), the CLI polish list, the
release flow, and the owner's own use of `cw`.

In the owner's own use, four things are in the way:

1. after a run, it is not clear if it worked;
2. while a run is going, the progress is hard to read;
3. the report is hard to read;
4. there are too many commands to keep in mind.

### Proposed outcome

A user can tell at a look, with no file reading: did the run work, what
is going on now, what the answer is, and what to type next.

### The owner's words (2026-11-11, word for word)

- on what "issues" are: "下游 yokoten 报的问题, CLI 打磨清单, 发版老是出问题, 我自己用的时候不顺";
- on the goal: "先修用户碰得到的问题 (推荐)";
- on the rules: "全部保留 (推荐)";
- on the first batch: "CLI 打磨 12 条 (推荐)";
- on what went wrong before: "修一个又冒出一个, 忙了很多但用户没感觉, 太慢、要我参与太多, 说做完了其实没做完";
- on the owner's own pain: "跑完不知道成没成, 等待过程看不懂, 报告不好读, 命令太多记不住".

### Affected users and systems

- Every `cw` user in a terminal (text output on a TTY).
- Scripts and CI that read `cw` output or exit codes (yokoten-doctor is
  the one known). Every changed byte is a POLA change and needs the
  operator's named yes.
- `v2/conformance/` fixtures and the man pages, in the same PRs.

### Constraints

- All binding rules of `AGENTS.md` stay: POLA with a named yes, a test
  that fails before each fix, never push to main, gated signed release,
  zero runtime dependencies, JS/TS only.
- One goal per cycle; a fault fix and a clean-up in separate PRs.
- `.md` count is at its ceiling (130/130): this file takes the place of a
  closed intent, which moves into `2026-11-archive.md` in the same PR.

### Open questions

None open. The two from the draft (the exit code of a blocked run, and
`cw app list` on a TTY) are answered under "Operator decisions for
0.4.3".

## Measured facts

Each one from a command, on 2026-11-05 to 2026-11-11, cw 0.4.2.

- GitHub open issues: 0 (`list_issues state=OPEN`). The problems are not
  tracked there; this file and `BACKLOG.md` are the record.
- Size: 136 `.ts` files and 36,580 lines under `src/`; 295 smoke files;
  47 verbs under "More commands"; 125 `cw_*` MCP tools.
- Work rate: 266 commits on main since 2026-10-01; 48 start with `fix`.
- Release friction: the 0.4.0 cut was turned down three times, the 0.4.1
  cut three times (the third went to a human). 0.4.2 went through once.
- The twelve polish rows, each seen in real output (captures in the
  design board "Cool Workflow CLI Design", boards Screens and Polish):

  | # | Level | Seen in 0.4.2 | Owner pain |
  |---|---|---|---|
  | 1 | P1 | blocked run prints `✓ Report:` then `! Status: blocked — 0/14 workers`, exit 0 | 1 |
  | 2 | P1 | `Try: cw doctor` / `Next: cw report --open` / `Try: cw report --show`, in that order | 1 |
  | 3 | P2 | `==> Assess » (0/2)` but `==> Verify … (0/1)`: two marks for "running" | 2 |
  | 4 | P2 | "may take minutes…" on every worker line (6 times in a 6-worker run) | 2 |
  | 5 | P2 | "dispatched, spawning agent" on one path, "spawning agent" on the other | 2 |
  | 6 | P2 | `cw app list` prints JSON on a TTY; `cw doctor` prints text | 4 |
  | 7 | P3 | front page: two `-q` rows at column 45, three rows at column 44 | 4 |
  | 8 | P3 | `version` and `fix` are on the front page and in More commands | 4 |
  | 9 | P3 | nine vendor flags inside Flags | 4 |
  | 10 | P3 | doctor's sandbox line is about 250 characters of ✓ | 1 |
  | 11 | P3 | quick start dashes at columns 31, 32, 33 | 4 |
  | 12 | P3 | report.md: empty `- Invariants:`, State Commits with full paths before the findings | 3 |

## Spec: batch A, the twelve rows

Each row: the text now, the text after, where it is made, and the man
page that says it. `--json` output does not change in any row, nor
does the JSON that `cw -q` and a piped `cw app list` print; row 1
changes only the exit code there. Piped text does change: `cw help`
(rows 7-9), `cw doctor` (rows 10-11) and report.md (row 12). Three pins under the repo root's `v2/conformance/`
hold some of these strings; they are named under "Operator decisions for
0.4.3". No file under `test/fixtures/runs/` holds any.

| # | Now | After | Made in | Man page |
|---|---|---|---|---|
| 1 | a run that ends `blocked` or `parked`: `✓ Report: <path>`, exit 0 | `! Report: <path>`, exit 2. `complete`: still `✓` and 0. `in-progress` (one `--once` step): still 0. The JSON is the same | `shell/reporter.ts`, `wiring/capability-table/pipeline.ts` | `operator-ux.7.md` |
| 2 | no agent set: `Try: cw doctor`, `Next: cw report --open`, `Try: cw report --show` | `Next: cw doctor`, `Try: cw report --show` (the "Report opened" line stays when the report was opened) | `shell/reporter.ts` | `operator-ux.7.md` |
| 3 | `==> Verify … (0/1)` for a phase that runs in order, `»` for one in parallel | `==> Verify » (0/1)`: one mark for a phase not yet done | `shell/term.ts` | `agent-delegation-drive.7.md` |
| 4 | `→ <label> (<phase>) — spawning agent, may take minutes…` on every worker line, and on every round line | `→ <label> (<phase>) — spawning agent`; `, may take minutes…` only on the first spawn line or round line of one cw command (a `--resume` is a new command) | `core/pipeline/drive-decide.ts`, `shell/drive.ts` | `agent-delegation-drive.7.md` |
| 5 | `— dispatched, spawning agent, may take minutes…` | `— spawning agent` | `core/pipeline/drive-decide.ts` | `agent-delegation-drive.7.md` |
| 6 | `cw app list` on a TTY: the JSON array | on a TTY: one `<id> — <title>` line for each app, a blank line, `Use cw app show <id> for full details.` Piped or `--json`: the same JSON | `wiring/capability-table/workflow-apps.ts`, `core/format/help.ts` | `workflow-app-framework.7.md` |
| 7 | the two `-q` rows put their text at column 45 | at column 44, as the other rows | `core/format/help.ts` | `operator-ux.7.md` |
| 8 | last More commands line: `man\|version\|fix\|completion\|check` | `man\|completion\|check` (shell completion still has `version` and `fix`) | `core/format/help.ts` | `operator-ux.7.md` |
| 9 | nine `-claude` … `-grok` rows inside `Flags` | a block `Agents` after `Flags`, the nine rows with the same text | `core/format/help.ts` | `operator-ux.7.md` |
| 10 | `✓ sandbox-enforceability: CW sandbox profiles validate policy and gate worker-output acceptance; …` (about 250 characters) | `✓ sandbox-enforceability: policy is checked by CW; OS isolation is the host's job (docs/sandbox-profiles.7.md).` The `--json` `detail` keeps the long text | `shell/doctor.ts` | `doctor.7.md` |
| 11 | `1. cw demo tamper        — …`, `2. cw demo bundle         — …` | the two dashes in line with row 3's | `shell/doctor.ts` | `doctor.7.md` |
| 12 | report.md: `- Invariants:` with nothing after it; order Answer, Phase Status, State Commits (full paths), Error Feedback, Workers, Sandbox Profiles, Trust Audit, Pending Tasks, Results | no `- Invariants:` line when there are none; order Answer, Phase Status, Results, Pending Tasks, Error Feedback, Workers, Sandbox Profiles, Trust Audit, State Commits (paths under the run folder) | `shell/report.ts` | `operator-ux.7.md` |

Each row gets a test that fails before the change.

## Operator decisions for 0.4.3

Asked on 2026-11-11, in one question with four parts; each part showed
the text before and after. The operator's answers, word for word:

1. Rows 2, 3, 4, 5, 7, 8, 9, 10, 11 — "全部同意 (推荐)". The quoted text:

   ```
   #2  Try: cw doctor / Next: cw report --open / Try: cw report --show
    -> Next: cw doctor / Try: cw report --show
   #3  ==> Verify … (0/1)
    -> ==> Verify » (0/1)
   #4  — spawning agent, may take minutes…   (every line)
    -> — spawning agent   ("may take minutes…" once per run)
   #5  — dispatched, spawning agent, may take minutes…
    -> — spawning agent
   #7  -q rows: text at column 45
    -> column 44, like the other rows
   #8  man|version|fix|completion|check
    -> man|completion|check
   #9  Flags: ... -claude ... -grok ...
    -> Flags (general) + Agents (-claude ... -grok)
   #10 ✓ sandbox-enforceability: CW sandbox profiles validate policy and gate ... (250 chars)
    -> ✓ sandbox-enforceability: policy is checked by CW; OS isolation is the host's job (docs/sandbox-profiles.7.md).
   #11 1. cw demo tamper        — ...
       2. cw demo bundle         — ...
    -> both dashes in line with row 3
   ```

2. Row 1 — "! 标记 + 退出码 2 (推荐)". The quoted text:

   ```
   before:
   ✓ Report: …/report.md
     ! Status: blocked — 0/14 workers
   $ echo $?  -> 0

   after:
   ! Report: …/report.md
     ! Status: blocked — 0/14 workers
   $ echo $?  -> 2

   (complete: still ✓ and 0; --once step: still 0)
   ```

3. Row 6 — "终端里显示列表 (推荐)". The quoted text:

   ```
   after (TTY):
   architecture-review — Architecture Review
   architecture-review-fast — Architecture Review Fast
   ...

   Use cw app show <id> for full details.

   (piped or --json: the same JSON as today)
   ```

4. Row 12 — "发现放前面 (推荐)". The quoted text:

   ```
   after:
   (no empty "- Invariants:" line)
   ## Answer
   ## Phase Status
   ## Results
   ## Pending Tasks
   ## Error Feedback
   ## Workers
   ## Sandbox Profiles
   ## Trust Audit
   ## State Commits   (paths under the run folder)
   ```

The new lines quoted above, as promise lines for `pola:check` (added with
batch B1 on 2026-11-11; each is held by a test):

```promise
! Report: <path>
Next: cw doctor
Try: cw report --show
<task> (<phase>) — spawning agent
==> <phase> » (0/1)
Use cw app show <id> for full details.
✓ sandbox-enforceability: policy is checked by CW; OS isolation is the host's job (docs/sandbox-profiles.7.md).
```

Man pages that say the new text, in the same PR as the change:
`operator-ux.7.md`, `agent-delegation-drive.7.md`,
`workflow-app-framework.7.md`, `doctor.7.md`.
The version goes to 0.4.3 (a patch raise on 0.x).

Pins changed by these answers (all under the repo root):

- `v2/conformance/cases/fixtures/cli-help/_root.txt` — rows 7, 8, 9;
  man page `operator-ux.7.md`.
- `v2/conformance/cases/report-md-shape.case.mjs` — row 12 (the new
  order, no empty `- Invariants:`, the short commit path, a newline at
  the end); man page `operator-ux.7.md`.
- `v2/conformance/cases/cli-quickstart-redirect.case.mjs` — row 1 (a
  `-q` run with no agent ends `blocked`, so its exit is 2); man page
  `operator-ux.7.md`.

The lines of `_root.txt` that are new or moved, word for word. The
question put rows 7, 8 and 9 in the short form quoted above; these are
the full lines that the answer makes:

```
  -q "question" [-<vendor>]                 Ask a question, get a report
  -q "question" --link <url>                Review a remote repo by URL
  --verbose              Show full agent narration live (default: compact)
  --no-color             Disable ANSI color (also honors NO_COLOR / FORCE_COLOR)
  --json                 Print JSON for commands that support it
  --quiet                Suppress [drive] progress lines (not agent output)
  --resume --run <id>    Continue an interrupted run to completion
Agents
  man|completion|check
```

## Paths weighed

- Taken: fix what the user sees, in batches, each batch one release.
  Hard: low to medium. Upkeep: lower (fewer odd cases). Cost: one
  named-yes question per batch. Undo: revert one PR.
- Turned down: one more inner structure program. 0.4.0 was that (seven
  phases); the owner's word is that the user did not feel it.
- Turned down: cut features down to the core path. It removes things
  that work, breaks the downstream user, and does not fix the four pains.
- Turned down: a rewrite. Longest, most risk, and the 295 smokes and the
  conformance suite say the present code does what its spec says.

## Program: three batches, in this order

1. **Batch A — 0.4.3: the twelve rows.** P1 first (rows 1-2), then P2
   (3-6), then P3 (7-12). One named-yes question for all rows, each
   before and after quoted.
2. **Batch B — the release flow.** A look back at each 0.4.x cut: where it
   stopped and why; fix the causes that came up more than once.
3. **Batch C — the downstream asks.** Wire the result validator into
   intake (needs its own yes: it turns down results accepted today),
   check each finding's `path:line`, and `:` in file names with native
   Windows support.

After each batch: a short note to the owner of what a user can now do.

## Spec: batch B, the release flow

### Measured facts (2026-11-11)

From the "Operator decisions" parts of `2026-10-16-release-gate-ci.md`,
the commit bodies of `git log v0.3.3..v0.4.2`, and `git log --format=%ad`
of each tag:

| Cut | Tagged | Stops before the tag | What stopped it |
|---|---|---|---|
| 0.4.0 | 2026-11-03 | 3 rejections | 1: no user-visible capability in the range. 2: the quotes did not name the strings they let change; two `cw check` faults (piped noise, unreadable tree hashed as a fixed word). 3: a sixth `cw help` front-page row, `check` in More commands and `cw completion` with no yes, a fix with no test that fails before it |
| 0.4.1 | 2026-11-05 | 2 rejections, 1 hand-over | 1: `release:doctor` printed a text other than the one the yes quoted; stage 0 turned a warning into a failure no yes named. 2: one more path printed the old text. 3: the reviewer gave the call to the operator (its rule after two rejections), and `release-flow.mjs` read a valid `.cw-release/...:1` locator as invalid |
| 0.4.2 | 2026-11-05 | 0 | — |

Faults in the release tool itself that only a real cut met, each fixed
with a test: the checkout left on a deleted record branch (after 0.3.3,
`9ee8a547`); a leftover `release/vX.Y.Z-cut` branch after each stopped
cut (0.4.0, `611ff392`); the locator with a leading dot (0.4.1,
`6aeccd8a`); npm provenance naming main, not the tag, for 0.3.3 to 0.4.2
(`ba0dbbdd`).

Counts: 5 rejections and 1 hand-over in 0.4.0 to 0.4.2. 4 of the 5
rejections were an output that the operator's named yes did not cover,
or that was not the text the yes quoted. 1 was no capability.

The guards added after the 0.4.0 rejections (`043b3524`: `pola:check`
line level, the `cw completion` pin, the five-row cap,
`fails-before:check`) hold `v2/conformance/` and `test/fixtures/runs/`.
`scripts/pola-check.mjs` says what they do not hold: "exact text asserted
inside plugins/cool-workflow/test/*.mjs smokes". Both 0.4.1 rejections
were there: the `release:doctor` text is held by
`test/release-doctor-smoke.mjs`, not by a pin. Since those guards came
in, every rejection has been in that gap.

### The causes seen more than once

1. **A promised text that the code does not print** (0.4.1 rejections 1
   and 2). The yes quotes the new line; nothing checks that a test holds
   that line, so a different line passes CI.
2. **An output change that no yes names** (0.4.0 rejection 3, 0.4.1
   rejection 1, and 0.3.3 before them). The agent writes the question from
   memory of the diff; a changed string it did not think of is not in the
   question, and only the model reviewer finds it, at the cut.
3. **The reviewer's own output read wrong** (0.3.0: `REJECTED` at the end
   of prose; 0.4.1: the leading-dot locator). Each fix covered one shape.

### Plan

- **B1, promise lines.** An "Operator decisions for <version>" part may
  hold a fenced block whose info string is `promise`: each line is a full
  new output line, word for word, `<name>` standing for any text. For the
  version in `package.json`, `pola:check` fails when a promise line
  matches no line of any file under `plugins/cool-workflow/test/` or
  `v2/conformance/`. So the promised text has a test, and a different
  text fails that test in PR CI. Catches cause 1.
- **B2, the change sheet.** `npm run pola:check -- --sheet` prints every
  string literal added or changed under `src/` and `scripts/` since the
  last tag, as `path:line` with the text before and after, on stdout. The
  agent writes the named-yes question from the sheet, not from memory, and
  `release-flow.mjs` puts the sheet in the reviewer's input. It is a list
  to read, not a gate: a changed string is not always output. Catches
  cause 2 before the question, not at the cut.
- **B3, reviewer output shapes.** One table test of the shapes reviewers
  have given or are likely to give (a fence, a heading, bold, a CRLF, a
  `./` or `.` path, a backticked locator, a bullet in place of a number)
  through `extractVerdictFromStdout` and `validateSemanticRejection`. A
  shape that is a real verdict is read as one; a shape that is not stays
  fail closed. Catches cause 3 as a class.

None of B1 to B3 changes a `cw` output, exit code or flag; they are
release tooling only.

The owner was asked which to build (B1 to B3, B1 and B2, or wait for
the 0.4.3 cut) and answered, word for word (2026-11-11): "B1 + B2 + B3
(Recommended)".

### Paths weighed (batch B)

- Taken: B1 to B3, each a small check where the record or the test is
  already made. Hard: low. Upkeep: one more block in a decisions part.
  Undo: revert one PR.
- Turned down: add `test/*.mjs` to the `pola:check` pin roots. The smokes
  mix pins with new checks line by line (the script's own header), so
  every new test line would need a yes.
- Turned down: run the model review in PR CI. CW does not run models,
  and CI holds no reviewer key.

## Spec: batch C, the downstream asks

### Measured facts (2026-11-11)

| Fact | Command | Number |
|---|---|---|
| `validateResultEnvelope` (`src/shell/verifier.ts`) is called by nothing | `git grep -n validateResultEnvelope -- src` | 1 line, its own definition |
| Apps that give a task an output `schema` | `git grep -n '"schema"' -- apps` | 0 of 8 |
| The accept path checks the result's evidence, not each finding's | `src/shell/worker-isolation.ts`, `recordWorkerOutput` | a P1 finding with only free text as evidence is taken in |
| The verdict accept check asks only that a cited file is on disk | `resolveEvidenceLocator` in `src/core/trust/evidence-grounding.ts` | `README.md:7` on a 1-line file is taken in |
| Worker folder names keep `:` (`safeFileName` in `src/shell/fs-atomic.ts` keeps it) | `/[^a-zA-Z0-9_.:-]+/g` | every worker folder, such as `worker-golden:path-0001` |

### Plan

- **C1.** Call `validateResultEnvelope` when a result is accepted. Its one
  check a result can fail today: a P0, P1 or P2 finding with no grounded
  evidence of its own. The result is turned down
  (`result-contract-violation`), tried again with the reason at the top of
  `input.md`, then parked.
- **C2.** For a verdict/synthesis task that requires evidence (the same rule
  as `verdict-evidence-unresolvable`), a `path:line` or `path:a-b` locator in
  the result's or a finding's evidence that names a line past the end of a
  file on disk is turned down (`verdict-evidence-past-end`), the same way.
  The pure check is `lineCitedPastEnd` in `core/trust/evidence-grounding.ts`.
- **C3, later.** Worker folder names without `:` change the run folder
  layout (a POLA change of its own), and native Windows is not supported
  (the README says WSL). It goes to its own program.

The owner was asked which to build (C1 and C2 now with C3 later, all
three, or C1 only) and answered, word for word (2026-11-11): "C1 + C2 now,
C3 later (Recommended)".

### Paths weighed (batch C)

- Taken: two refusals on the path that already turns down a bad verdict
  citation; a result is retried, then parked, and a resume opens it again.
  Hard: low. Upkeep: two failure codes. Undo: revert one PR.
- Turned down: a warning in `report.md` in place of a refusal. It keeps a
  finding no one can check in the run, and a warning is not fail closed.

## Operator decisions for 0.4.4

The owner's yes for batch C, word for word (2026-11-11): "C1 + C2 now, C3
later (Recommended)". The question quoted the two new reasons, each a
result that was taken in before and is now turned down:

- 「Task <id> finding <fid> severity <P1> requires grounded evidence (a
  path-like locator, URL, or namespace:value token)」
- 「Task <id> cites a line past the end of its file: <path>:<line> (<path>
  has <n> lines)」

No pinned output file changes. The promised lines:

```promise
Task <id> finding <fid> severity <sev> requires grounded evidence (a path-like locator, URL, or namespace:value token)
Task <id> cites a line past the end of its file: <path>:<line> (<path> has <n> lines)
Give each P0, P1 or P2 finding its own evidence: a path-like locator, URL, or namespace:value token.
Cite only lines that are in the file.
```

Man pages that say the new text: `docs/worker-isolation.7.md`,
`docs/agent-delegation-drive.7.md`.

## Working rules for this program (the answer to "what went wrong before")

| What went wrong | The rule here | What holds it |
|---|---|---|
| fix one, a new one comes up | Before a fix, sweep the whole tree for the same class of fault and fix all in one PR; the PR lists the sweep command and its count | reviewer; the PR body |
| much work, no user feeling | Each batch ends in a release whose notes say what a user sees; no batch is only inner work | release reviewer |
| slow, too much asked of the owner | One question per batch (the named yes), with a recommended answer; the owner runs only the release command and its one approval | this file |
| "done" that was not done | "Done" comes with the command and its output; what was not checked is said in the same message | every report |

## How the work is split

- The lead model plans, cuts the work into packets, reads every diff and
  owns the final check. Packets that do not share files go to sub-agents
  in their own worktrees, two or three at a time; a separate checker
  agent only runs and reports, it does not fix.
- The article the owner named for model choice
  (`claude.dev/blog/which-claude-model-should-you-build-with`) could not
  be read from this environment (host not reachable). This split is the
  default until the owner gives its text.

## Stages (after "The AI-native SDLC playbook")

| Stage | Artefact | Who decides |
|---|---|---|
| Plan | this intent, accepted | the owner |
| Design | the spec part of this file: each row's exact before and after, and its test | the owner (the named yes) |
| Build | a plan per batch; nothing is built before it; code follows it or the plan is changed in the same commit | the lead model; the owner for a risky step |
| Test | a failing test first for each row; full local suite before each push | `fails-before:check`, CI |
| Deploy | PR, green CI, merge; bump PR; the operator's release command and approval | the owner |
| Maintain | each fault found later becomes a row here or in `BACKLOG.md`, with a test | the lead model |

## Status ledger

| Batch | State |
|---|---|
| A — twelve rows (0.4.3) | built and merged (#891, 2026-11-11); waiting on the operator's release command |
| B — release flow | the owner chose B1 to B3 (2026-11-11); built: B1 promise lines and B2 the change sheet in `pola:check`, B3 the reviewer output table (7 real rejection shapes were read as invalid output). On its first run B1 held all seven 0.4.3 promise lines, one after a fix to the line: the quote's example phase `Verify` became `<phase>` |
| C — downstream asks | the owner chose C1 and C2, C3 later (2026-11-11); built: C1 the finding evidence check on intake, C2 the line past the end check for verdicts; for 0.4.4, so it merges after the 0.4.3 cut |

## What this spec got wrong

(Filled at close.)

## Architecture snapshot diff

(Filled by the closing PR.)
