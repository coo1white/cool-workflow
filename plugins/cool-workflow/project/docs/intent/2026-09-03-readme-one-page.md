# The README is one page

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: the operator, on 2026-09-03, after reading
the README as its own founder: "太杂太乱，容易吓走用户", and "特别重要的可以
挪到 wiki 里". Two more orders the same hour: "然后拿掉这个视频演示" (drop the terminal
recording GIF), and "要让用户决定容易上手，然后把支持的模型列个清单出来打勾：
哪些已支持，哪些还没适配" (a person must be able to decide in one
screen that this is easy to start, and see a checked list of which
agents are supported and which are not yet). Then: "给用户提供简单的打开 report 的方式", "用了我们的工具，生成了报告，怎么打开",
and "如果用户不会找文件的相对/绝对路径，怎么样能傻瓜式的让用户像打开 excel 一样简单"
(a person who has a report needs to see it with no path and no id,
the way a spreadsheet opens itself). Rule
already given the same day: anything a user reads is one page,
Jobs-simple.

## Intent

A person who lands on the repo should know in one screen what `cw` is,
type three commands, and get a report. Everything else lives one click
away in the wiki. Nothing is thrown away: every cut section moves to
the wiki page that already covers its subject, or to one new page.

## Measured facts (checked by command before design)

- Root `README.md` is 360 lines with 12 parts: hero and badges (1-21),
  What is this (22-47), Install (48-72), Quick Start (73-131, three
  steps), Why Cool Workflow (132-153), How It Works (154-168), What You
  Can Run (169-197), Can You Trust the Report (198-215), Use It From
  Your Editor (216-310, 95 lines, the largest), Troubleshooting
  (311-323), Repo Map (324-342), Docs & Wiki (343-357), License.
- Six of those parts have no twin sentence anywhere under
  `plugins/cool-workflow/project/docs/wiki/`: Why, How It Works, What
  You Can Run, Can You Trust, Editor, Repo Map (checked by grepping the
  first line of each part across the 15 wiki pages: no hit). The wiki
  pages that cover the same subjects exist: `Mental-Model.md` (127
  lines), `Architecture.md` (105), `Workflow-Apps.md` (113),
  `Trust-And-Audit.md` (90), `MCP-And-Manifests.md` (111). There is no
  wiki page for the repo map.
- Tests that read the root README's text: `test/readme-trust-claim-smoke.js`
  needs a "## Can You Trust the Report?" part that says the agent signs
  its findings, names `verify-bundle`, says the signed findings are
  present unaltered, says CW holds no private key, keeps the honest
  limit sentence, and does not overclaim; `test/claude-p-agent-wrapper-smoke.js`
  needs the string `builtin:claude` somewhere in the README (today in
  the Troubleshooting table); `test/readme-sync-smoke.js` needs
  `plugins/cool-workflow/README.md` to equal the output of
  `scripts/sync-readme.js` and to carry no repo-relative image or link.
  `scripts/release-check.js` needs the file present and its path
  citations to resolve (`citation:check`).
- Agents, measured from `src/shell/agent-config.ts` (known list: claude,
  codex, gemini, opencode, muse), the wrapper scripts under
  `plugins/cool-workflow/scripts/agents/` (claude-p, codex, muse,
  opencode, gemini-opencode, deepseek), and the README's own words:
  Claude Code, Codex CLI, Muse Code and OpenCode run natively and are
  found on `PATH` by `cw doctor`; Gemini and DeepSeek reach their models
  through `opencode` (DeepSeek also through an HTTP endpoint,
  `CW_AGENT_ENDPOINT`), and DeepSeek has no auto-detect. No wrapper
  exists for Cursor, GitHub Copilot CLI, Aider, Qwen Code, or Kimi.
- The README's second image (line 19) is a GIF of `cw demo tamper`'s
  terminal output; the operator asked for it to go. The hero image, the
  pipeline image and the topologies image are the other three.
- Opening a report today: the end-of-run line says `Next: cw report
  <run-id> --show` (`src/shell/reporter.ts`), which prints the report in
  the terminal; README step 3 says `cat .cw/runs/<run-id>/report.md`.
  The `report` binding in `src/wiring/capability-table/reporting.ts`
  requires the run id (`required(optionalArg(args.positionals[0]), "run
  id")`); there is no "newest run" default and no way to open the file
  in the system viewer. Run ids carry a UTC timestamp
  (`architecture-review-20260902T183411Z-4fcc79`), so the newest run of
  a repo is the largest id under `.cw/runs/`.
- `plugins/cool-workflow/README.md` is the npm page, made from the root
  by `npm run sync:readme`; edits go to the root only.
- md count on main after the freeze closing PR: 133/135 (two closed
  intents archived). This program adds this file and one wiki page:
  135/135.
- The first new-user walkthrough (2026-09-02) said the README was clear
  but the tester read only Install, Quick Start and Troubleshooting;
  none of the four stuck points came from the six parts this program
  moves.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- (1) Cut the README to one page and drop the rest: loses text people
  link to; (2) move each cut part to its wiki twin page, then cut, and
  leave one link per moved part in a short "Learn more" list: nothing
  lost, one move each, undone by revert; (3) keep the README and add a
  short summary at the top: the wall of text is still there and still
  the first thing a person sees. Chosen: 2.
- The trust part: (a) move it whole and move the test to the wiki page:
  the test guards the README against overclaiming, so it must stay on
  the README; (b) keep a five-line trust part on the README that holds
  the sentences the test needs, and move the rest. Chosen: b.
- The repo map: (a) into `Architecture.md`: mixes a contributor list
  into a user page; (b) one new wiki page `Repo-Map.md`: +1 md, inside
  the budget. Chosen: b.
- Effect framework: rejected for good (see the archive).

## Rules for every PR in this program

Same as the last programs: auto worktree for an isolated subagent,
`npm ci` first, Plan in the PR body before edits, all gates before push
with the pass lines quoted, three-dot diffs, CodeQL green before
auto-merge, max 3 rounds, the manager reads the pushed diff, a
stand-down is the last message a worker gets, hold work by spawning
later. Every changed doc line is Basic English and one-page simple: one
line that says what it is, at most six bullets, one link to start.

## The wiki takes the six parts (docs PR, first)

Files: `plugins/cool-workflow/project/docs/wiki/Mental-Model.md`,
`Architecture.md`, `Workflow-Apps.md`, `Trust-And-Audit.md`,
`MCP-And-Manifests.md`, new `Repo-Map.md`, `_Sidebar.md`, `Home.md`.

1. Plan step, measured before edits: for each of the six README parts,
   name the wiki page and the heading it goes under, and list any
   sentence the page already has that says the same thing (so it is not
   said twice). Table in the PR body.
2. Move the text, kept as is except: cut duplicates found in step 1,
   change repo-relative links to full GitHub links, and cut any word
   that only makes sense on the README ("above", "below"). The Editor
   part goes under a new heading "From your editor" in
   `MCP-And-Manifests.md`. The Repo Map becomes `Repo-Map.md` with one
   line of intro. `_Sidebar.md` gets "Repo Map" under "Go deeper";
   `Home.md` gets one row for it.
3. Nothing on the README changes in this PR.

Budget: net across the five existing pages <= +260 (the six parts total
about 250 lines); `Repo-Map.md` <= 30 lines; no other new file.

## Open the report in one step (code PR, may run beside the first)

Files: `src/core/format/report-html.ts` (new, pure), `src/shell/report-view-cli.ts`,
`src/wiring/capability-table/reporting.ts`, `src/shell/reporter.ts`,
`src/shell/pipeline-cli.ts` (the end-of-run hook), `src/core/format/help.ts`
(one help line), one new smoke `test/report-open-smoke.js`.

1. Plan step, measured before code: list every caller of the `report`
   binding and of `reportWriteCli`; show how run ids sort under
   `.cw/runs/` and that the largest id is the newest by `createdAt` in
   `state.json` (check three runs); list the markdown forms the report
   writer uses (headings, lists, tables, fenced code, links, bold), by
   reading `src/shell/report.ts`. Tables in the PR body.
2. `report-html.ts`: a small pure function that turns the report's own
   markdown forms (only those from step 1) into one HTML page with a
   little inline CSS, readable in any browser. Text is escaped. No
   dependency. At most 110 lines.
3. `cw report` with no run id uses the newest run under this repo's
   `.cw/runs/`; with no run at all it prints one line: `No run yet. Try:
   cw -q "<question>"`. The MCP handler keeps requiring `runId`.
4. `cw report --open` (with or without a run id) writes `report.html`
   beside `report.md` if it is missing or older, then opens it with the
   system opener: `open` on macOS, `xdg-open` on Linux, `start` on
   Windows, spawned argv-style with `shell: false`, and prints the path
   it opened. If the opener is missing, it prints the path and exits 0.
5. The foolproof step: when `cw -q` (and `cw quickstart`) ends with a
   report on an interactive terminal, and not in `--json` mode, CW does
   what step 4 does by itself, so the report opens in the browser with
   no path and no id typed. `--no-open` or `CW_NO_OPEN=1` turns it off.
   Never on a non-TTY (Rule of Silence).
6. The end-of-run line becomes `Report opened. Again later: cw report
   --open` (and `cw report --show` stays as the second hint). `cw help`
   shows `report [run-id] [--show|--open]`.
7. Smoke `test/report-open-smoke.js`: the converter on a sample report
   (headings, table, code, link, bold present in the HTML, text
   escaped); no id picks the newest of two fixture runs; `--open` with
   `CW_OPENER` set to a stub script records the path it was given (the
   stub is how the smoke avoids opening a real viewer); no run prints
   the one line; the end-of-run hook does not fire on a non-TTY.

Budget: src net <= +190 (converter <= 110, the rest <= 80), smoke
<= +70, one new test file (the program's one). This PR merges before
the README PR, whose step 3 says the report opens by itself and shows
`cw report --open` for later.

## The README is one page (docs PR, second, after the first two merge)

Files: root `README.md`, then `npm run sync:readme`.

1. The README keeps, in this order: hero image and one line under it;
   one badge row; What is this, cut to three bullets and the one quoted
   line; Install (npm, with Homebrew in the folded `<details>`); Quick
   Start with its three steps, each cut to the command and one line of
   what you see, step 3 being "the report opens in your browser by itself" with
   `cw report --open` as the one command for later; "Can You Trust the Report?" cut to five lines that
   keep every sentence `test/readme-trust-claim-smoke.js` needs;
   Troubleshooting with at most seven rows, one of them still naming
   `builtin:claude`; "Works with your agent": one table, one row per
   agent, three columns (agent, flag, status), status is a check mark
   with one short note for the six supported (Claude Code `-claude`,
   Codex CLI `-codex`, Muse Code `-muse`, OpenCode `-opencode`, Gemini
   `-gemini` "through opencode", DeepSeek `-deepseek` "through opencode
   or an HTTP endpoint") and an empty box with "not yet" for Cursor,
   GitHub Copilot CLI, Aider, Qwen Code, Kimi; this table sits right
   under Install so a person decides in one screen; "Learn more": one
   link per moved part (User Guide
   first, then Why, How it works, What you can run, From your editor,
   Trust, Repo map, and the wiki home); License.
2. Plan step, measured before edits: the line count of the draft, and
   the output of `node test/readme-trust-claim-smoke.js`,
   `node test/claude-p-agent-wrapper-smoke.js`, `node test/readme-sync-smoke.js`
   and `node scripts/citation-check.js` on the draft. All four must pass
   before the PR opens.
3. The `cw demo tamper` GIF is removed from the README (the command and
   its one line of what you see stay in Quick Start step 1). The hero
   image stays. The pipeline image stays only if the page is still
   under the cap with it; the topologies image goes to
   `Workflow-Apps.md`. The GIF file itself stays in the assets folder
   until nothing links to it, then a later cleanup removes it.

Budget: README <= 120 lines after the cut (from 360). No new files.

## Closing ledger, wiki publish, receipt (docs PR, last)

1. Wiki publish, the one public step: the architect, holding the
   operator's word, pushes the 16 source pages (the 15 of today plus
   `Repo-Map.md`; `_Sidebar.md` and `Home.md` are among them) to
   `cool-workflow.wiki.git` as a fast-forward, after the
   closing worker has prepared the commit in a scratch clone and
   stopped. The worker never pushes.
2. Receipt at
   `plugins/cool-workflow/project/docs/audits/readme-one-page-receipt-<date>.json`,
   same shape as the earlier receipts: `commit`, `wikiCommit`,
   `version`, `startedAt`, `finishedAt`, checks: `readme-under-cap`
   (`wc -l README.md` <= 120), `readme-tests-pass` (the three README
   tests), `citations-resolve`, `six-parts-in-wiki` (the first line of
   each moved part is found in its wiki page), `wiki-pages-equal`
   (`diff -rq` of the 16 pages against a fresh wiki clone prints
   nothing), `md-count` (135/135), `agent-table` (the README holds one table with
   the six supported agents checked and the not-yet list, and no
   `demo.gif` reference). `verdict` pass only if all pass.
3. Fill the three sections below and the ledger. Archive nothing (the
   two-rows and run-folder files are already archived).

Budget: docs only, no src. The receipt gains one check, `report-open`
(`cw report --open` with no id on the walkthrough sample, with
`CW_OPENER` set to a stub, writes `report.html` and hands the stub its
path).

## Acceptance

- Manager (per PR): CI green, CodeQL green, Plan + before/after in the
  body, budget held, Chain line, no internal labels in committed text.
- Architect (program): the receipt's eight checks pass; then the new-user
  walkthrough is run again with the README on main as the only entry
  point (brief `newuser/rerun-brief-2026-09-03.md`), and its report
  says in one line whether the README made the tester want to try the
  tool or made them leave. That walkthrough is the operator's own order
  and is the last step of this program.

## Architecture snapshot diff (claims this program makes stale)

(filled by the closing PR)

## What this spec got wrong (recorded at close)

(filled at close)

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | open | |
| The wiki takes the six parts | | |
| Open the report in one step | | |
| The README is one page | | |
| Closing ledger, wiki publish, receipt | | |
