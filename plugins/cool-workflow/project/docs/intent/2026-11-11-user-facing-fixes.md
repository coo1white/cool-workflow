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
page that says it. Piped output and `--json` do not change in any row
but row 1's exit code. Three pins under the repo root's `v2/conformance/`
hold some of these strings; they are named under "Operator decisions for
0.4.3". No file under `test/fixtures/runs/` holds any.

| # | Now | After | Made in | Man page |
|---|---|---|---|---|
| 1 | a run that ends `blocked` or `parked`: `✓ Report: <path>`, exit 0 | `! Report: <path>`, exit 2. `complete`: still `✓` and 0. `in-progress` (one `--once` step): still 0. The JSON is the same | `shell/reporter.ts`, `wiring/capability-table/pipeline.ts` | `operator-ux.7.md` |
| 2 | no agent set: `Try: cw doctor`, `Next: cw report --open`, `Try: cw report --show` | `Next: cw doctor`, `Try: cw report --show` (the "Report opened" line stays when the report was opened) | `shell/reporter.ts` | `operator-ux.7.md` |
| 3 | `==> Verify … (0/1)` for a phase that runs in order, `»` for one in parallel | `==> Verify » (0/1)`: one mark for a phase not yet done | `shell/term.ts` | `agent-delegation-drive.7.md` |
| 4 | `→ <label> (<phase>) — spawning agent, may take minutes…` on every worker line, and on every round line | `→ <label> (<phase>) — spawning agent`; `, may take minutes…` only on the first spawn line or round line of a run | `core/pipeline/drive-decide.ts`, `shell/drive.ts` | `agent-delegation-drive.7.md` |
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
| A — twelve rows (0.4.3) | intent accepted, the named yes recorded (this PR); build next |
| B — release flow | not started |
| C — downstream asks | not started |

## What this spec got wrong

(Filled at close.)

## Architecture snapshot diff

(Filled by the closing PR.)
