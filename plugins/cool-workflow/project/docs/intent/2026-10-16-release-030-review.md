# Release 0.3.0: the operator's yes to its default changes, and the review rule that reads it

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: the operator on 2026-10-16, after a release
review of 0.3.0 said no to eight default changes. Given three paths (A:
let the review take an operator-approved default change; B: put every old
default back; C: hold the release), the operator answered "选A，保留默认12个工具".
Asked about #753 (only the reviewer vendor has to be live for a cut), the
answer was "保留". Asked about #749 (the removed `cw sandbox resolve` alias and
`cw bands` family), the answer was "保留删除". Then "继续".

## Intent

A release can ship a default change the operator chose, and still be
reviewed against POLA. The reviewer takes such a change only with three
things it checks for itself: the operator's own words in an intent file,
the man page for the new default, and a minor version raise (0.x). Any
other default change is still a POLA break and a no.

## Measured facts (2026-10-16, on `f7f1d77e`)

- `git log v0.2.8..f7f1d77e --oneline | wc -l`: 54 commits;
  `git diff --stat v0.2.8..f7f1d77e`: 495 files, +9,488 / -2,783.
- A dry review (`CW_RELEASE_FLOW_GATE_CMD=true node scripts/release-flow.js
  --check`, reviewer `grok --prompt-file {{input}}`) gave `REJECTED`, kind
  `semantic-review`, with 8 findings. All 8 are real default changes; none
  is a bug. The output put `REJECTED` at the end of a line of prose, so
  `extractVerdictFromStdout` did not see it and the flow stopped with "no
  verdict" (fail closed, as it should).
- `agents/release-reviewer.md` had no way to take a chosen default change:
  "Any violation → REJECT regardless of capability". So any reviewer, on
  any vendor, has to say no to this range.
- `growth:check` before this file: md 134/135.

## The eight changes and their records

| # | Change (PR) | Operator's yes | Man page for the new default |
|---|---|---|---|
| 1 | `tools/list` gives the 12 core tools by default; `CW_MCP_TOOLS=full` for all (#750) | this file, 2026-10-16: "保留默认12个工具" | `cli-mcp-parity.7.md`, `mcp-app-surface.7.md` |
| 2 | `report.md` opens with `## Answer` (#734) | `2026-09-archive.md`, "The answer first", 2026-09-28: "默认加 ## Answer" | `report-verifiable-bundle.7.md` |
| 3 | The default review runs Map and Assess together (#735) | `2026-09-archive.md`, "The default review under five minutes", 2026-09-28: "做 #5：默认 review 压到 5 分钟内" | `canonical-workflow-apps.7.md`, `agent-delegation-drive.7.md` |
| 4 | A continued `--run` keeps its `appId`; one resume spelling (#741, #744) | `2026-09-archive.md`, "The first five minutes", 2026-09-28: "同意，按 1→8 修" | `agent-delegation-drive.7.md` |
| 5 | A resume runs a parked worker again (#729) | `2026-09-archive.md`, "Resume takes a parked run to the end", 2026-09-27: "默认就重试" | `agent-delegation-drive.7.md` |
| 6 | `--full` is gone (#742) | `2026-09-archive.md`, "The first five minutes", 2026-09-28: "--full 删掉" | `agent-delegation-drive.7.md` |
| 7 | `cw sandbox resolve`, `cw bands` and their 3 MCP tools are gone (#749) | this file, 2026-10-16: "保留删除" | `cli-mcp-parity.7.md`, `mcp-app-surface.7.md` (`control-bands.7.md` deleted) |
| 8 | A cut waits only on its reviewer vendor; other vendor checks warn (#753) | this file, 2026-10-16: "保留" | `agent-delegation-drive.7.md` "Support tiers", `release-tooling.7.md` |

The version goes from 0.2.8 (tag `v0.2.8`) to 0.3.0 (#757): a minor raise.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- **B, put every old default back behind new flags:** turned down. Eight
  PRs of work, it undoes choices the operator made in writing, and it
  keeps old surfaces (the full 104 KB `tools/list`, a `--full` that did
  nothing) that the operator chose to drop. Can be undone, but costly.
- **Loosen the reviewer in general ("a minor bump allows breaking
  changes"):** turned down. With no record of the operator's words, an
  agent could make any default change and call it planned. The yes must
  be the operator's own words, checked by the reviewer.
- **Chosen, A:** one exception in the reviewer prompt, written the same way
  in `AGENTS.md` and `docs/unix-principles.md` §7, with three checks that
  must all hold. Small upkeep: one bullet. Undone by deleting it.

## Spec

- `agents/release-reviewer.md`: after the FreeBSD discipline bullet, one
  "Operator-approved breaking change" bullet with the three checks. If one
  is missing, it is a POLA break → REJECT. The other checks stay in full.
- `AGENTS.md` FreeBSD rule 1 and `docs/unix-principles.md` POLA paragraph
  say the same exception.
- `docs/release-tooling.7.md` says what the reviewer takes.
- `test/release-flow-smoke.js` asserts the prompt carries the exception
  and its three checks; it fails on the old prompt.

## Acceptance

- The smoke passes; the full suite passes in CI.
- A new review of 0.3.0 is run once, and its verdict stands, APPROVED or
  REJECTED. No re-runs to get a different answer.

## Architecture snapshot diff (claims this program makes stale)

- `AGENTS.md` FreeBSD rule 1 and `docs/unix-principles.md` §7 POLA said a
  default never changes. Fixed in this PR: one exception, with checks.

## What this spec got wrong (recorded at close)

(Filled by the closing PR.)

## Status ledger

| Step | State | PR |
|---|---|---|
| Operator's answers recorded | done | this PR |
| Review rule, AGENTS.md, unix-principles, man page, smoke | in this PR | this PR |
| One review of 0.3.0 with the new rule | after merge | — |
