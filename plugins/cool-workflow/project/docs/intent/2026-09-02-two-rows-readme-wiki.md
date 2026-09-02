# Two parked rows, and the README and wiki say what the tree does

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: the operator's order after the run-folder
program closed (receipt
`plugins/cool-workflow/project/docs/audits/run-folder-receipt-2026-09-02.json`,
PASS): write the two remaining small BACKLOG rows as the next intent,
and bring the GitHub README and wiki in line with the tree.

## Intent

Three things a person meets before they read code should be true: the
onramp gate names the type tree that exists, the test that counts MCP
tools says what it counts, and the README and wiki describe the tool as
it is after the last 57 merged PRs. Two BACKLOG rows from 2026-09-02
cover the first two. The third is measured below: the 14 wiki pages
kept in this repo all differ from what the public wiki shows, and the
public wiki has 39 more pages that nothing in the repo checks.

## Measured facts (checked by command before design)

- `src/shell/onramp.ts` filters `typeFiles` on the prefix
  `plugins/cool-workflow/src/types/` and excludes the same prefix from
  runtime files, while `isTypeSource` in the same file already accepts
  both `src/types/` and `src/core/types/` (PR #624). `src/types/` has
  been dead since commit bcb5db0d. `src/core/types/` holds three files
  (`boundary.ts`, `execution-backend.ts`, `observability.ts`) and none
  exports a `const`, `function`, `class`, `let`, or `enum`: they are
  type-only. The runtime value the BACKLOG row worried about,
  `APP_CODE_EXECUTION_MODE`, lives in `src/core/state/types.ts`, which
  is outside that directory.
- `test/mcp-tool-call-coverage-smoke.js` says in its header that 17
  tools it calls are deferred through `notYetImplemented`. A runtime
  walk of the 244 capability rows on 2026-09-02 found none that throw
  `CapabilityNotImplementedError`. In `src/`, `notYetImplemented` is
  defined in `src/core/capability-data.ts` and named in six comments;
  no code calls it.
- `plugins/cool-workflow/docs/agent-delegation-drive.7.md` shows
  `quickstart --resume` and `quickstart --run <id> --resume` in full but
  never the bare `cw --resume --run <id>` form PR #627 added, and does
  not say that form needs the cwd inside the project or `--repo`.
- The README `Troubleshooting` table already carries the two rows PRs
  #627 and #629 added. `plugins/cool-workflow/README.md` is made from
  the root `README.md` by `scripts/sync-readme.js`.
- The repo keeps 14 wiki pages under
  `plugins/cool-workflow/project/docs/wiki/` (last change 2026-09-01).
  The public wiki (`cool-workflow.wiki.git`, last commit 2026-08-25)
  holds 53 pages. All 14 shared pages differ, from 10 changed lines
  (`Trust-And-Audit.md`) to 147 (`Glossary.md`). The other 39 exist
  only on the public wiki: 12 `GitHub-Showcase-*` copies of the shared
  pages, and 27 deep pages (backends, topologies, registry, release
  tooling, stories). No script in the repo syncs the wiki;
  `scripts/sync-project-index.js` and `scripts/sync-readme.js` do other
  things. 57 PRs merged since the wiki's last commit.
- md count on main is 135/135. This spec PR merges the two historical
  verdict files under `project/docs/audits/` into one
  (`architecture-review-verdicts.md`, both texts kept word for word) so
  the count stays 135 with this file added. Nothing else linked to the
  two old names except the audits index, which now points at the one
  file.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- Wiki source of truth: (1) copy all 53 public pages into the repo:
  +39 .md, far over the budget; (2) keep the 14 repo pages as the
  source, treat the 39 public-only pages as wiki-only, and check each
  of them once against the surfaces the 57 merges changed; (3) delete
  the 39: throws away deep pages people link to. Chosen: 2.
- The 12 `GitHub-Showcase-*` copies: (a) keep and update twice; (b) each
  becomes a three-line page that points at its live page. Chosen: b,
  since a copy that drifts is what this program is fixing.
- Wiki publish: (1) a new `scripts/sync-wiki.js`: a new file and a
  credential path in code; (2) a four-line runbook note in `AGENTS.md`
  (clone, copy the 14 pages, commit, push) done by hand at each release.
  Chosen: 2; the wiki changes a few times a month, a script is not
  earned yet.
- `notYetImplemented`: (a) leave it since a comment names it; (b) if no
  code or test calls it, delete it in the same PR as the header fix.
  Chosen: b, measured first.
- Effect framework: rejected for good (see the four-fixes intent).

## Rules for every PR in this program

Same as the last two programs: one worker per PR, own worktree first,
Plan in the PR body before code, all gates run in `plugins/cool-workflow`
before push with the pass lines quoted, CodeQL green before auto-merge,
max 3 rounds, the manager reads the pushed diff and never the report,
no worker stops a process it did not start. All English written into
the repo or the wiki is Basic English; command names and paths stay as
they are.

## The onramp type rule names the live type tree (code PR)

Files: `src/shell/onramp.ts`, `test/onramp-smoke.js` (or the smoke that
already asserts the type-only class).

1. Plan step, measured before code: run a one-line check that no file
   under `src/core/types/` has a runtime export, and put the output in
   the body.
2. The two prefix strings in `onramp.ts` that say
   `plugins/cool-workflow/src/types/` become
   `plugins/cool-workflow/src/core/types/`; the comment near
   `isTypeSource` stops naming `src/types/` as a live tree.
3. Smoke: a diff touching only `src/core/types/boundary.ts` is classed
   as a type-only change; a diff touching `src/core/state/types.ts` is
   not.

Budget: src net 0 (edits in place), smoke net <= +12. No new files.

## The coverage smoke header says what it counts (test PR)

Files: `test/mcp-tool-call-coverage-smoke.js`, `src/core/capability-data.ts`
only if step 2 finds no caller.

1. Plan step, measured before code: count how many tools this smoke
   skips or defers today, by the smoke's own logic, and count callers
   of `notYetImplemented` in `src/` and `test/` with `grep -rn`. Both
   numbers go in the body.
2. Fix the header comment to the true count and the true reason. Do not
   change what the smoke asserts. If step 1 found zero callers, delete
   the `notYetImplemented` function and the comment lines that name it
   as live; if it found one, leave the function and say where.

Budget: test net between -3 and +3, src net between -12 and 0. No new
files. Haiku may take this PR; the measurement commands are fixed.

## The docs name the shortest resume form (docs PR)

Files: root `README.md` (then `npm run sync:readme`),
`plugins/cool-workflow/docs/agent-delegation-drive.7.md`.

1. The man page gets one line for `cw --resume --run <id>` beside the
   two forms it shows, and one sentence: it needs the cwd inside the
   project, or `--repo <path>`.
2. README `Troubleshooting`: the "Run stopped before the end" row is cut
   to the one command a user types, with the note that it needs the cwd
   inside the project or `--repo`; the other two forms move out of the
   row. No other README row changes unless step 3 finds it wrong.
3. Plan step, measured before code: read every README claim about the
   run folder, `doctor`, `--resume`, and what `cw -q` does in a folder
   that is not a project, against the tree at HEAD; list each claim and
   "true" or "fix" in the body. Fix only the ones marked "fix".

Budget: README net <= +2, man page net <= +3, no new files.

## The 14 wiki source pages match the tree (docs PR)

Files: `plugins/cool-workflow/project/docs/wiki/*.md` (14 files).

1. Plan step, measured before code: for each page, list every claim
   that names one of the changed surfaces: `--resume` forms,
   `run resume` with `--repo`, `doctor --onramp` sections, what `cw -q`
   does outside a project, the run folder's directory list, the `-q`
   help line, `src/types/`. Mark each "true" or "fix". Put the table in
   the body.
2. Fix the "fix" lines. `Recovery-And-Restore.md`, `Quickstart.md` and
   `Commands-or-API.md` get the bare `cw --resume --run <id>` form.
   `Glossary.md` says the blackboard directory is made on first write.
3. No page grows by more than 10 lines; no page is added or removed.

Budget: net <= +40 across the 14 files. No new files.

## Closing ledger, wiki publish, receipt (docs PR, last)

1. Clone `https://github.com/coo1white/cool-workflow.wiki.git` into the
   scratch area. Copy the 14 repo pages over their public twins. For
   each of the 12 `GitHub-Showcase-*` pages, replace the body with three
   lines: the title, "This page moved; the live page is", and a link to
   the shared page. For each of the 27 deep pages, run the same claim
   check as the wiki PR's step 1 and fix only "fix" lines, at most 10
   lines per page. Commit with a message that names the repo commit
   the pages match. Push to the wiki's `master`. The push is the one
   public action in this program; it is done once, after the four PRs
   above are merged, and its commit sha goes into the receipt.
2. `AGENTS.md`, in the release runbook: four lines, "After a release,
   publish the wiki: clone the wiki repo, copy the 14 pages from
   `plugins/cool-workflow/project/docs/wiki/`, commit naming the release
   commit, push."
3. Receipt at
   `plugins/cool-workflow/project/docs/audits/readme-wiki-receipt-<date>.json`,
   same shape as the run-folder receipt: `commit` (repo), `wikiCommit`,
   `version`, `startedAt`, `finishedAt`, checks: `wiki-14-pages-equal`
   (`diff -rq` of the 14 pages against the fresh wiki clone prints
   nothing), `showcase-pointers` (12 pages are three lines each),
   `backlog-rows-gone` (the two 2026-09-02 rows and the
   `agent-delegation-drive.7.md` row are absent), `onramp-type-only`
   (the new smoke case passes on main), `citations-resolve`
   (`citation:check` all resolve), `md-count` (135/135). `verdict` is
   "pass" only if all pass. Written from what was seen.
4. Delete the three BACKLOG rows (typeFiles retarget, coverage-smoke
   header, `agent-delegation-drive.7.md` gap). On a failed check, the
   row for that check stays and gains the receipt path.
5. Fill the three sections below and the ledger.

Budget: docs only in the repo, no src; md count stays 135/135.

## Acceptance

- Manager (per PR): CI green, CodeQL green, Plan + before/after in the
  body, budget held, Chain line, no internal labels in committed text,
  Basic English in every changed doc line.
- Architect (program): the receipt's six checks pass; the public wiki's
  14 shared pages are byte-equal to the repo; a new user reading the
  README `Troubleshooting` row types one command and it works from
  inside the project; `test:gate` all green with no new test file;
  `growth:check` md 135/135; BACKLOG is down to the four design rows.

## Architecture snapshot diff (claims this program makes stale)

Measured by `grep -rn` across the 53 files under
`plugins/cool-workflow/docs/*.7.md`, both README files, `AGENTS.md`, and
`plugins/cool-workflow/project/docs/wiki/*.md`, for the strings this
program's four merges touched: `src/types/`, `17 deferred`/`17 tools`,
`notYetImplemented`/`CapabilityNotImplementedError`, `14 wiki`/`14 pages`,
and the bare `cw --resume --run <id>` form.

- No live doc outside the files those four PRs themselves changed still
  carries a stale claim. `test/mcp-tool-call-coverage-smoke.js` now reads
  "All 65 tool calls execute successfully" with no deferred-tool count.
  `plugins/cool-workflow/docs/agent-delegation-drive.7.md` names the bare
  `cw --resume --run <id>` form and its cwd/`--repo` rule (line naming the
  bare form). `README.md`'s `Troubleshooting` row does the same. No doc
  names `src/types/` as a live tree; `src/shell/onramp.ts` and
  `test/onramp-smoke.js` are the only files that named it, and both were
  fixed in the onramp PR.
- Nothing measured stale and unfixed. No BACKLOG row is added for this
  check.

## What this spec got wrong (recorded at close)

- This spec told the worker to delete `notYetImplemented` since it read as
  having no callers. It has one live caller, in
  `src/wiring/capability-table/registry-core.ts`, as the fallback for every
  tool row with no real handler. Deleting it would have broken that
  fallback. Root cause: the measuring grep that fed this spec was cut short
  with `| head -8`, so the caller line never came up. The section's own
  rule — one or more callers means keep it and say where — is what saved
  it.
- The onramp smoke's old type-only case used `src/types/run.ts`. After the
  retarget to `src/core/types/`, that same case would have gone on passing
  while testing nothing at all. A test that passes for the wrong reason is
  worse than one that fails. The case was moved to
  `src/core/types/boundary.ts`, and a negative case was added for
  `src/core/state/types.ts`.
- This spec called the wiki source set "14 pages". That set also holds
  `Home.md` and `_Sidebar.md`, which the separate `User-Guide.md` page had
  to touch too. The set is now 15.
- The coverage smoke's test budget of "-3 to +3" was set before anyone
  measured the stale header. The stale text ran 13 lines; the change was
  net -10. Taken as is.
- The coverage smoke header was stale in three ways at once: it claimed 17
  deferred tools (true count 0), it claimed the smoke "stays red" while the
  gate was green, and it named a line number in the wrong file.
- This spec's closing section said "12 `GitHub-Showcase-*` pages" and "27
  deep pages" for the wiki-only set. A fresh clone of the public wiki
  measured **10** `GitHub-Showcase-*` pages and **28** deep pages (52
  `.md` files total, minus the 14 that already matched a repo page name).
  The spec's counts were wrong; the closing PR worked the true numbers,
  not the stated ones.
- Of the 28 deep pages the closing PR checked against the claim topics
  (`--resume` forms, `run resume --repo`, `doctor --onramp`, `cw -q`
  outside a project, the run folder's directory list, the `-q` help
  line, `src/types/`), only one, `Runtime-Contract.md`, needed a fix
  (+2 lines: `audit/` and `nodes/` were missing from its run-folder
  directory list). The other 27 either did not mention any of the
  claim topics, or their mentions were already accurate. This is a
  good result stated plainly: the deep pages had drifted far less than
  the spec feared, and the small diff means the check was run and came
  back nearly clean, not that it was skipped.

## How the work went (process notes, recorded at close)

- `agent-*` worktrees were reclaimed from disk under three workers while
  still running mid-task. Each of the three refused to fall back to a
  shared checkout and reported the loss instead of guessing.
  Correction to an earlier version of this note: "make your own worktree
  first" is the right rule ONLY for an agent that inherits a shared
  working directory. A worktree-isolated subagent cannot switch to a
  worktree it makes itself — its Bash/Read/Edit/Write tools stay locked
  to the one the harness handed it — so for that kind of agent the
  auto-made `agent-*` worktree IS the right one to work in, and trying
  `git worktree add` plus a switch is a dead end. Recorded so the next
  worker brief tells the two cases apart instead of sending an
  isolated subagent down that dead end.
- A fresh worktree has no `node_modules`, so `npm run build` dies with
  "tsc: command not found". Run `npm ci` first.
- A two-dot `git diff origin/main <branch>` on a branch that is behind
  main reads as if it reverts other people's merged work. Use `gh pr diff`
  or the three-dot `git diff origin/main...<branch>` instead.
- The package install (`npm ci`, `npm install`) was refused by the
  permission system for the coverage-smoke PR. Nobody retried it and
  nobody asked another agent to run it in their place. That PR's local
  gate ran with node directly and reported 263/265 plus release-check 15
  of 18, with the cause named plainly as "tsc: command not found, package
  install refused in this sandbox". CI on GitHub, which does install the
  packages, was the full gate and was green on all eight checks before the
  merge.
- The manager twice stated a guess as if it were a measurement: once
  reporting how many workers had lost their worktree, from a listing cut
  short by `tail -20`; once claiming every gate script was plain node with
  no need of the install, which was false for `test:gate` and
  `release:check`. A worker's own measurement corrected both times. This
  is the same fault as the `| head -8` grep above: a cut-short command
  read as a full one.
- A worker that had been stood down woke up on its own, pushed an old
  commit back to a branch whose work was already merged, and opened a
  duplicate PR. The duplicate was closed and the stale branch deleted;
  main was never touched. Lesson: a stand-down must be the last message
  that worker ever gets, since any later message can wake it and it may
  act on stale state.

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | merged | #638 fc4a8c23 |
| The onramp type rule names the live type tree | merged | #640 94068071 |
| The coverage smoke header says what it counts | merged | #643 e3917a0e |
| The docs name the shortest resume form | merged | #642 23e1a300 |
| The 14 wiki source pages match the tree | merged | #641 f174a971 |
| Closing ledger, wiki publish, receipt | open | #646 |

A new wiki page, `User-Guide.md`, landed on its own as #639 9e97a426. That
took the wiki source set from 14 pages to 15. Every "14" in this file's
older sections is the count at spec time; the true count from this point
on is 15.
