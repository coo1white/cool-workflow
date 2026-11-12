# The first launch: one channel, one proof, one number a week

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: the operator, 2026-09-03: "产品力已经有了，接下
来要深耕的就是营销；市场营销极度重要，哪怕这是一个开源项目", and 2026-09-04:
"营销的话，我有 X 账号". Two things the operator did not say, taken as
assumptions until they say otherwise: posts go out in English and
Chinese on the same day; the first goal is that 100 people reach a
report of their own.

## Intent

People who would use `cw` do not know it exists. The product side is
done enough to show: one command, a saved report with every claim tied
to a line, a README a person reads in one screen, receipts that prove
each claim. This program turns those into a launch that is measured,
not guessed: one channel the operator owns (X), one post a week, each
post one line, one command, one proof link, and a reach number written
down every Monday. No agent ever posts; the operator sends.

## Measured facts (checked by command before design)

- GitHub on 2026-09-03: 2 stars, 0 forks, 0 watchers; repo made
  2026-06-06; 15 topics set. npm: 395 downloads in the last month, 84 in
  the last week; `cool-workflow@0.2.7` published 2026-09-02.
- Proof that exists today: four receipts under
  `plugins/cool-workflow/project/docs/audits/` (two walkthroughs, the run
  folder, the core path, the README), each bound to a commit; the wiki
  User Guide, written from a real first-use test; the v0.2.7 release
  page, one page.
- The public wiki holds four story pages nothing links to from the
  README or Home: Origin Story, Manifesto (Agents Need FreeBSD), The Car
  Metaphor, One Frame Five Lenses.
- No launch text exists anywhere in the repo (grep for "Show HN",
  "Product Hunt", "Hacker News", "reddit": only spec files). Six X posts
  were drafted on 2026-09-04 outside the repo, in English and Chinese.
- The operator owns one channel: an X account. The README is the landing
  page (117 lines as of #659) and the User Guide is the first page a
  person is sent to.
- md count: 134/135 after #660; this file makes 135.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- (1) One big launch day on many channels: one shot, nothing learned,
  and channels the operator does not own; (2) one post a week on the one
  channel the operator owns, each with one proof, and a number written
  down every Monday: small, repeatable, stops any time: chosen; (3) paid
  reach: no.
- Where the posts live: (a) in the repo: a public repo is not a drafts
  folder, and every post would cost an .md; (b) outside the repo, with
  the operator, and only the count and the dates in the receipt: chosen.
- The number: (a) "100 people reach a report" cannot be counted
  directly, since CW phones nothing home; (b) three proxies written
  weekly: stars, npm weekly downloads, and replies that say "got a
  report": chosen, and the goal is restated as proxies.
- Effect framework: rejected for good (see the archive).

## Rules for every PR in this program

Same as the last programs; docs only; every changed line a person reads
is one page, six bullets, Jobs-simple. No agent posts anything anywhere.

## One proof page and the story links (docs PR)

Files: new `plugins/cool-workflow/project/docs/wiki/Proof.md`,
`Home.md`, `_Sidebar.md`.

1. `Proof.md`: one line on what a receipt is, then one table with one
   row per receipt (date, what was tested, verdict, the commit, a link
   to the JSON), then the four story pages as one short list under
   "Why it is built this way". Under 40 lines.
2. `Home.md` gets one row for Proof under "Go deeper"; `_Sidebar.md` one
   line.
3. The closing PR of this program publishes the wiki (17 pages) the
   usual way: the worker prepares the commit and stops; the architect
   pushes.

Budget: `Proof.md` <= 40 lines (the one new .md), `Home.md` +1,
`_Sidebar.md` +1.

## The reach receipt (docs PR)

Files: new `plugins/cool-workflow/project/docs/audits/reach.json`,
`AGENTS.md` (three lines in the release runbook).

1. `reach.json` is an append-only list; one entry per week:
   `{ "week": "<ISO date of the Monday>", "stars", "forks",
   "npmWeekly", "posts": <number sent that week>, "replies": <number
   that say they got a report> }`. The first entry is week 0 with the
   measured facts above.
2. `AGENTS.md` gets three lines: every Monday, run `gh repo view --json
   stargazerCount,forkCount` and the npm downloads API, append one
   entry, commit as docs. Done by hand or by the agent on the
   operator's word; never a cron the operator did not ask for.

Budget: `reach.json` is JSON (no md cost); `AGENTS.md` +3.

## User reports: reply in a day, fix, name the reporter (docs PR)

Source: the operator, 2026-11-12: "整理成具体做法吧", after a look at
magpie, where most fixes in a day of commits name the person who
reported the problem. Measured on 2026-11-12: this repo has had 6
issues, all opened by the owner; 0 from users. The first gap is a way
in, not the speed of the fix.

1. A way in: the README Troubleshooting part ends with one line to open
   an issue; the bug form asks for one thing only ("What happened"), the
   rest is optional, and it puts the `from-user` label on by itself. A
   problem seen on X is put into an issue by the operator or, on the
   operator's word, by the agent, with "(<name> on X)" in the title.
2. A reply within a day: "seen, and here is how it happens again", or
   the one thing still needed. The reporter's steps become the test that
   fails before the fix (`fails-before:check` holds it already).
3. Name the reporter: the fix PR title is `fix(<area>): <what>
   (#<issue>, reported by @<name>)`, the body says `Fixes #<issue>`, and
   the PR carries the `from-user` label. `.github/release.yml` puts those
   PRs first in the release notes, under "Fixed from user reports".
4. Ship it the same day: a user fix may be a release of its own (the
   operator runs `npm run release`; no cap on how often). After it, one
   comment on the issue: "Fixed in vX.Y.Z: `npm i -g
   cool-workflow@latest`. Thank you." The operator may say thanks on X.
5. Count it: the Monday entry in `reach.json` adds `userIssues`,
   `firstReplyHours` (mean) and `fixReleaseHours` (mean, report to the
   release with the fix).

Not here: a "report a problem" line in `cw` output is a change to
default output and needs the operator's named yes first (POLA).

## Closing ledger (docs PR, last)

1. Receipt at `plugins/cool-workflow/project/docs/audits/first-launch-receipt-<date>.json`:
   checks `proof-page` (exists, under 40 lines, every receipt row links
   to a file that exists), `reach-week0` (entry present with the
   numbers), `wiki-pages-equal` (fresh clone, 17 pages), `posts-drafted`
   (the operator confirms six drafts exist outside the repo; the count
   and nothing else), `no-agent-post` (the ledger says no agent posted).
2. Fill the three sections below and the ledger. Archive nothing.

## Acceptance

- Manager (per PR): CI green, CodeQL green, Plan + before/after, budget
  held, Chain line.
- Architect (program): the receipt passes; four weeks later the reach
  receipt has five entries and the operator reads one line: the trend,
  whatever it is.

## Architecture snapshot diff (claims this program makes stale)

(filled by the closing PR)

## What this spec got wrong (recorded at close)

(filled at close)

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec (this file) | open | |
| One proof page and the story links | | |
| User reports: reply in a day, fix, name the reporter | landed | (this PR) |
| The reach receipt | | |
| Closing ledger | | |
