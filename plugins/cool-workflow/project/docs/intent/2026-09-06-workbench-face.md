# The Workbench face: one look says pass, needs you, or broke

Intent and spec in ONE file, in the shape `AGENTS.md` "Intent files (the
playbook)" asks for. Source: the operator, 2026-09-06: "利用 claude design，
对整个网站的 UI/UX 进行重构" and "要安全、稳定、简单、可靠，方便后续的迭代开发
和维护". The design canvas (seven artboards: run open, first run, blocked
run, report.html, tokens, two alternates not built) is at
https://claude.ai/code/artifact/655668ba-aa3d-47c9-bd88-5a320a384cf6.

## Intent

CW has two things a person sees in a browser: the Workbench
(`ui/workbench/`, served by `cw workbench serve`) and `report.html`
(`src/core/format/report-html.ts`, opened by `cw report --open` and at
the end of every run). Today both are a wall of tables and raw JSON in
the default system look. A new person cannot tell in one look if the
run passed, needs them, or broke, and the pages carry none of the CW
mark (the orange stamp of the README hero).

After this program, one look at either page answers three questions:
did it pass, what needs me, what do I run next. The raw JSON stays, one
line down, folded. Nothing else changes: same seven tabs, same two
read-only routes, same `.cw/` files as the one source, no framework, no
dependency, no font or byte from the network.

## Measured facts (checked by command before design)

- `ui/workbench/` is 793 lines in five files (app.js 512, app.css 152,
  index.html 34, inspection.js 51, navigation.js 44). `report-html.ts`
  is 95 lines; its style is one 3-line string. `wc -l`, 2026-09-06.
- Tests that read the UI source: `test/web-desktop-workbench-smoke.js`
  (85 asserts; 16 of them pin exact strings in app.js and index.html),
  `test/workbench-navigation.test.js` (17), `test/workbench-inspection.
  test.js` (12), `test/report-open-smoke.js` (12). There is no browser
  in the test tree; client behaviour is pinned as source strings.
- The run view is one JSON payload with 7 groups and 18 panels. The
  facts a person needs first already sit in it: `graph/compact.
  nextAction` (string), `candidate/summary.problems` (array),
  `blackboard/coordinator.missingEvidence` (array), `view.lifecycle`
  (word). Measured with `curl /api/run/<id>` on a real run, 2026-09-06.
- 14 runs on this machine, every one `release-cut`, all `completed`. The
  run row shows the full 40-char id and the full repo path; on a 320px
  rail the path wraps to three lines.
- Growth budget on main: md=135/135. Two intent files are closed with
  every PR merged and not yet in the archive (`2026-09-02-backlog-three-
  gates.md`, 149 lines; `2026-09-02-rot-cleanup.md`, 388 lines). Moving
  them frees two slots; this file takes one: 134/135 after.
- The brand: `project/docs/assets/cw-hero.png`. Warm near-black ground,
  one orange, mono caps labels, a round "PASS" stamp. No font file in
  the repo; the hero was drawn outside it.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- (1) A framework or a build step for the UI (React, Vite): more to
  learn and keep, breaks "static files only, no network"; no. (2) Keep
  vanilla files, new CSS, small JS edits in the render layer only:
  chosen; every line stays readable by a person and every test stays.
- Tabs: (a) fold the seven surfaces into one long page (Option C on the
  canvas): reads like report.md, but hides run switching, and needs new
  navigation code and test changes; no. (b) keep the seven tabs and put
  a "what matters" strip ABOVE them: chosen; zero navigation change.
- Fonts: (a) load a brand face from Google Fonts: a byte from the
  network on a page whose promise is "no network"; no. (b) system fonts,
  weight and letter-spacing carry the brand: chosen.
- report.html stamp: the verdict word is not in report.md's text today;
  adding a parser for it is code for one glyph. Skipped; the band and
  the type do the work. Add when report.md carries a verdict line.
- Screenshots in docs: a picture is a file the budget counts and a thing
  that rots; no. The canvas link is the picture.

## Design rules (from the canvas, for every packet)

- Tokens: dark `--bg #14120f --panel #1b1815 --panel-2 #23201b --line
  #33302a --ink #f2ede4 --muted #9a938a --accent #ef6c1f --present
  #58b86a --absent #d9a441 --bad #e5533f`; light (prefers-color-scheme)
  `#f7f4ee #ffffff #efeae0 #e2dcd0 #1e1b17 #7a7368 #c9540f #1f8a3b
  #9a6700 #c8321f`. Same variable names as today.
- Colour has one meaning each: green = done and checked; orange = the
  tool is working; amber = needs a person; red = broke.
- Type: system-ui body 14/1.45; mono (`ui-monospace, "SF Mono", Menlo`)
  for ids, cells, and 11px upper-case labels with .08em tracking; brand
  word 800 weight, .12em tracking. Radius 8 (cards), 6 (chips), 999
  (pills). Controls 30 to 34px tall, 1px line.
- Icons: inline SVG stroke, 14 to 20px. No emoji.

## Work packets (one directory each; never two in one directory)

**A. `ui/workbench/` — [sonnet] high.** Edits `app.css`, `index.html`,
`app.js` only. `navigation.js` and `inspection.js` do not change. Keeps
`TAB_KEYS`, the two routes, the request sequence guards, the element ids
`filter`, `run-list`, `registry-freshness`, `run-panel`, `refresh` (all
stay in the DOM under those names), and every string
`test/web-desktop-workbench-smoke.js` lines 549-574 pin. The strip and
the stamp read panels of tabs not open; same one payload, no new
request. What changes:
1. Top bar: orange mark (SVG), "COOL WORKFLOW" + "Workbench", the trust
   line, one Refresh button with an icon.
2. Run rows: dot + `appId · HH:MM` on line one, `lifecycle` and the date
   on line two; the full run id in the button's `title`; `data-runid`
   stays. The `<h2>Runs</h2>` stays; registry freshness becomes one pill
   in the same bar (the `registry-freshness` element).
3. Run header: label "run", the id in mono 20/600, pills for lifecycle
   and resolved, "as of". A CSS-only round stamp at the right whose word
   comes from `view.lifecycle`: completed → PASS (orange), blocked →
   BLOCKED (amber), failed → FAILED (red), running → RUNNING (orange),
   else the word itself, muted; no `lifecycle` key at all → no stamp.
4. A strip above the tabs, heading word "what needs you", three cards:
   problems, missing evidence, next action. Three
   `INSPECTION.actionFacts` calls, one per panel payload, each filtered
   to the one `fact.key` wanted: `problems` from `candidate/summary`,
   `missingEvidence` from `blackboard/coordinator`, `nextAction` from
   `graph/compact` (drop the `nextAction` fact `blackboard/coordinator`
   also returns). Empty array → "none" in green. Next action is a
   `<code>` chip. The per-panel `renderActionSummary` block ("What
   matters") stays as is; the test pins it. Both are string arrays.
5. Blocked or failed: the recovery line (the pinned text) moves above
   the strip into an amber box with a warning icon.
6. Panel cards: title + `cli` and `mcp` as two code chips + status pill;
   tables zebra with upper-case mono heads; the raw JSON `<pre>` goes
   inside `<details>` (closed) with the summary "raw payload". Keep the
   literal `card.appendChild(renderStructured(panel.data) || ...)` call
   (the test pins that substring and its order); build the `<details>`
   inside the `|| ...` fallback, and do the same for the second `<pre>`
   in `renderEventGroups`. Never rename or wrap that call.
7. Tabs: underline style, no boxes. Same buttons, same ARIA.
8. Empty state: the one command `cw -q "<question>"` (no vendor flag;
   the same line `report-open-smoke.js` pins for the CLI) in an
   orange-lined box and four words: ask, plan and dispatch, verify,
   report.
Size: net ≤ +240 lines across the three files; app.js may not grow by
more than 70. Comments: constraints only.

**B. `src/core/format/report-html.ts` — [sonnet] high.** The style
string becomes the light token set above plus: a dark brand band (mark,
"COOL WORKFLOW report", trust words) before the body, `h1` 34/800, `h2`
as an 11px mono upper-case label with a rule, zebra tables with mono
cells, `pre` dark. Column alignment is out of scope for B (the rule row
is thrown away today; keeping it is logic, not style). Pure function
stays pure. The test checks bare tags by substring (`<h1>`, `<table>`,
`<pre><code>`), so style by tag selector only; no class or attribute on
`h1`, `table`, `pre`, `code`. Keep the style as long concatenated string
lines, as today. Size: net ≤ +30 lines.

**C. `project/docs/intent/` — [haiku] high.** Append the two closed
intent files named under Measured facts to `2026-09-archive.md`, text
as is, each under its own `# ` title line, then delete the two files.
Gate: `npm run growth:check` says md=133/135. No other change.

**Checks — [opus] medium, read-only.** One plan check of this file
before A and B start (are the payload fields right, is the pinned
string list complete, is anything here a behaviour change). One
acceptance pass over each PR: the rules below, net lines, and a
screenshot by hand from `cw workbench serve`.

## Acceptance (every PR)

- `npm run build` and `npm test` green; the four UI tests pass with no
  edit under `test/`.
- No new file, no new dependency, no `<link>` or `fetch` to anything but
  the two existing routes. `npm run growth:check` within budget.
- Net line change inside the packet's cap; the PR body states net LOC,
  new files (0), new .md (0 for A and B).
- A person opens `cw workbench serve` on this machine and, on one
  completed run and one made-up blocked run, sees the stamp word, the
  strip, and the folded JSON. The reviewer says what they saw.

## What this spec got wrong

- Plan check (Opus, 2026-09-06), before any code: the strip's three
  fields sit in three panels, not one (one `actionFacts` call does not
  fit); a "What matters" block already exists in every panel card and
  is pinned by the test; `<details>` around the JSON as first written
  would delete a pinned substring; the empty-state command carried a
  vendor flag the core path does not; packet A's line cap was about a
  third too small; `lifecycle` can be absent; report.html has no column
  alignment to keep. All fixed above before A and B started.
- Dispatch: a Sonnet spawned with its own worktree was told to make a
  second worktree and to push; its sandbox let it do neither, so
  packet B stopped at a local commit (Fable pushed it) and packet A
  made no edit in ten minutes and was stopped; the operator said
  "你自己做" and Fable wrote packet A. Rule kept in memory: an
  isolated worker works where it is and never pushes; Fable pushes.

## Architecture snapshot diff

(filled by the closing PR: `docs/web-desktop-workbench.7.md` says "five
panels"; the trust line and empty-state command in the README FAQ)

## Status ledger

| Step | State | Where |
| --- | --- | --- |
| Design canvas | done | artifact 655668ba |
| C archive two intents | PR open | #663 |
| Intent + spec (this file) | branch pushed; PR after #663 merges | claude/project-iteration-ui-redesign-d6579d |
| Opus plan check | done: fix first, 7 fixes taken | above |
| A ui/workbench | PR open; net +105, tests green | #665 |
| B report-html.ts | PR open; net +16, tests green | #664 |
| Acceptance + close | A and B looked at by hand (Fable); user merges | |
