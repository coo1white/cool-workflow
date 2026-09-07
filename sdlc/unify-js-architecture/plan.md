# plan.md — cool-workflow: the Workbench as a Next 16.3.0 static export

Stage 3 of `~/Developer/sdlc/unify-js-architecture/` (intent and spec
signed by the owner 2026-09-07). Owner's words for this repo: "留 Next
16.3.0，同时保留 cli，2 种功能都要" and "统一包管理器全部为 bun".
Rule from the playbook: when a packet departs from this plan, the same
commit updates this file.

## What stays as it is

- The CLI (`cw`), `dist/`, the npm package's runtime: zero runtime
  dependencies, Node >= 18. Nothing in `src/` gains a React import.
- `src/core/format/report-html.ts`: a pure function; `report.html` is
  one offline file. It keeps sharing the built stylesheet.
- The read-only host (`src/shell/workbench-host.ts`): same two JSON
  routes, same headers. It serves files from a new directory only.

## Packets (one directory each, one PR each, in this order)

| # | Who | Directory | Work | Proof |
| --- | --- | --- | --- | --- |
| 0 | Fable | `sdlc/`, `project/docs/intent/`, root | this plan, `REVIEW.md`, four closed 2026-09-01 intents folded into the archive (md budget) | `growth:check` within budget |
| 1 | Opus | `plugins/cool-workflow/ui/workbench/` | the Next app: `package.json` (sub-package; `next` 16.3.0, `react` and `react-dom` 19.2.8 exact; `bun` as installer, `bun.lock`), `next.config.ts` (`output: "export"`, `basePath: "/ui"`, `images.unoptimized`), `app/layout.tsx` per spec 2.1 with the three faces vendored from cool-tunnel-server's `app/fonts/`, `app/globals.css` = today's `app.src.css` (the section 3 block plus `@source`), `app/icon.svg`, `src/next-shell/shell.tsx`, `nav-links.tsx`, `header-controls.tsx`, `src/next-nav-items.ts`, `app/page.tsx` as an empty shell; `out/` committed | `bun run build` clean; `out/index.html` has the theme script, the three font variables and `metadata` |
| 1b | Opus | `plugins/cool-workflow/src/shell/`, `scripts/`, `.github/` | host serves `ui/workbench/out/` at `/` and `/ui/*`; `scripts/build-css.js` reads `app/globals.css` and still writes `report-css.ts`; CI: `bun install --frozen-lockfile` and `bun run build` in the sub-package on Node 22, `git diff --exit-code` on `out/`; the Node 18 leg skips it; lang-policy exception path moves | host smoke serves the new index; drift check red on a stale `out/` |
| 2 | Sonnet | `plugins/cool-workflow/ui/workbench/src/` | port `app.js`, `navigation.js`, `inspection.js`: `RunList` is a server-rendered `menu` from the index JSON embedded at export time (`.cw/runs` read by a build-time loader; empty list on a bare tree), with one client island that re-reads `api/index`; `RunPanel`, `Tabs`, `NeedsYou`, `RawJson`, `FirstRun` as the smallest client islands; every pinned behavior kept (keyboard tab nav, `aria-controls`, the token hint, `showing latest N of M`, the recovery alert text, the stamp map, the `What matters` strip); the three old script files deleted | the seven Workbench tests pass against `out/` |
| 3 | Sonnet | `plugins/cool-workflow/test/`, `ui/workbench/tests/` | the seven Workbench tests move to `bun test` under `ui/workbench/tests/` and stay green; one render-to-string shell test; `test/css-framework-gate-smoke.js` becomes the spec 2.9 gate (pins, second framework, second UI library, one `.css`, layout parts, shell files, font host URL) with the temp-dir bite proof kept; the other 14 tests that read Workbench files re-pin to `out/` or behavior | `bun test` green in the sub-package; `npm test` green for the CLI |
| 4 | Sonnet | `plugins/cool-workflow/docs/`, `scripts/site-snapshot.js`, `README.md` | docs page names the Next app and the export; Pages snapshot copies `out/`; README line | Pages workflow green; `/` and `/ui/app…` 200 on Pages |
| 5 | Sonnet | root, `plugins/cool-workflow/` (not `src/`) | bun as the one installer: `bun.lock` replaces `package-lock.json`, CI installs with `bun install --frozen-lockfile`; the smoke runner keeps running under Node (the CLI ships to Node users), `bun test` runs the sub-package tests | CI green on all three Node legs; `npm pack` content unchanged |

Order: 0 → 1 → 1b → 2 → 3 → 4 → 5. Packets 1 and 1b are the same
author in sequence. About three working days with review.

## Gates every packet pastes into its PR

`bun test` tail (sub-package), `npm test` tail (CLI), `bun run build`
tail, `npm run dist:check`, the `out/` drift diff (empty), one
screenshot at `/` and one under the Pages prefix. Review by
`REVIEW.md`: bugs, security, compliance against the spec and this
plan.

## Known risks, named once

- bun as installer: TECH-SPEC 6b notes bun mis-resolved packages in
  cool-tunnel (a `preinstall` guard blocks it there). The owner chose
  bun everywhere; packet 5 copies the resolution check from that guard
  as a test instead of a block, and reports the first mis-resolution
  if one shows.
- Node 18 cannot build Next 16: the build runs on Node 22 only; `out/`
  is committed with a drift check, like `dist/` and `app.css` today.
- The 21 test files that read Workbench files change meaning: from
  source strings to built output. Packet 3 lists each one.

## What this plan got wrong

Packet 1 (feat/workbench-next-app):
- The `@source` line for `report-html.ts` is three levels up from
  `app/globals.css`, not two.
- `next.config.ts` needs a fixed `generateBuildId` ("workbench"), or
  every build writes a new hashed directory and the drift check is red.
- `@types/react-dom` has no 19.2.8; dropped. `@types/react` `^19.2.0`,
  `typescript` `^5.9.3` (not pinned by the plan). bun resolved every pin;
  `next build` itself once ran pnpm for `@types/node`, so `@types/node`
  is listed and the pnpm lock deleted.
- The host keeps a fallback to the old flat files under `/ui/*` until
  packet 2 deletes them; `/ui` serves the index.
- `test/css-framework-gate-smoke.js` (packet 3's directory) took a
  small edit so it accepts `app/globals.css` and skips `out/` and
  `.next/`. Packet 3 still rewrites it as the 2.9 gate.
- `build-css.js` reads `app/globals.css`; the old `index.html` is no
  longer scanned, so `app.css` is 74K and the old page would show
  unstyled if reached (it is not: `out/index.html` wins at `/`).
- `workbench-host.ts` is a frozen path at 340 lines; packet 1 paid for
  its lines with a trimmed comment. Packet 2 must not grow it, or ask.
- `out/` is 1.0 MB in 33 files; each rebuild is a diff in the PR.
- CI's first build of `out/` drifted from the committed one: Turbopack
  chunk names hash module paths from an inferred root (nearest
  lockfile), which differs by machine. `next.config.ts` pins
  `turbopack.root` to the plugin dir; two builds from two absolute
  paths now give a byte-identical `out/` (`diff -rq`).
  CI still drifted after that: the names also differ by platform (macOS
  vs Linux). So `out/` is NOT committed: `.gitignore` has it, CI builds
  it on the Node 22 leg before the tests, the Pages job builds it, and
  `prepack` builds it for the npm package (`npm run build:ui`). The
  Node 18 and 24 legs test the host's fallback to the old files. The
  drift check for `out/` is gone; `app.css` and `dist/` keep theirs.

Packet 2 (feat/workbench-components):
- The old `index.html`/`app.js`/`navigation.js`/`inspection.js`/`app.css`/
  `app.src.css` files stay. Three tests (`web-desktop-workbench-smoke.js`,
  `workbench-inspection.test.js`, `workbench-navigation.test.js`) still
  read the first four by their path, and
  `build-css.js`/`lang-policy-check.js`/`css-framework-gate-smoke.js`
  still name the CSS pair as build input/output. Packet 3 (which owns the
  test change) can remove them once the tests move to `out/`.
  `workbench-host.ts`'s old-file fallback stays for the same reason.
- Two small shared files the plan did not name: `src/navigation.ts`
  (TAB_KEYS/moveTab/parseFragment/formatFragment/writeRoute, moved from
  the old navigation.js) and `src/api.ts` (apiUrl/getJson/the
  WorkbenchIndexView/WorkbenchRunView shapes, moved from app.js). Both
  are needed so `run-list.tsx` and `run-panel.tsx` — two client parts
  that each stand on their own — do not each hold a separate copy of the
  fetch/token/route code and its fixed error text.
- `run-list.tsx` and `run-panel.tsx` are each one client part, as asked,
  but they sit next to each other, not one inside the other: they hold no
  shared React state. Each one reads `location.hash` on its own and
  listens for `popstate`; a same-tab route change (a run click, a tab
  click) is told to the other part with a copy of the `popstate` event
  (`pushState`/`replaceState` send no event of their own). This is the
  same idea `web-desktop-workbench.7.md` already writes down — the page
  address holds the state — just split across two files in place of one
  script's shared state object. The Refresh button (in
  `src/next-shell/shell.tsx`, part of this packet's own folder) sends a
  `cw:refresh` window event that both parts listen for, in place of
  `app.js`'s `refreshAll()`.

Packet 3 (feat/workbench-tests):
- This file had an unresolved git conflict (`<<<<<<< HEAD` /
  `=======` / `>>>>>>>`) sitting in the committed text between the
  packet 1 and packet 2 entries above — both sides were real content,
  just merged carelessly. Fixed in this commit as a plain concatenation
  (no content lost).
- The port (packet 2) dropped one small piece of the old `navigation.js`
  behavior: `parseFragment` no longer returned `replace`, so an unknown
  tab named in the URL was never normalized back with `replaceState`.
  `workbench-navigation.test.js`'s existing assertions already pinned
  the old `replace` field and would not pass against the new module
  as shipped. Restored `replace` on `navigation.ts`'s `Route` and wired
  it into `run-panel.tsx`'s `applyRoute`, matching the old
  `applyLocationRoute`.
- The plan estimated "the other 14 `test/*.js` files" reading the old
  flat files besides the seven moving tests. The real count, by
  `grep -l`, is zero: only `web-desktop-workbench-smoke.js`,
  `workbench-inspection.test.js` and `workbench-navigation.test.js`
  (three of the seven) and `css-framework-gate-smoke.js` itself ever
  read `index.html`/`app.js`/`navigation.js`/`inspection.js`/
  `app.src.css`/`app.css`; a plain `app.js` substring search also hits
  ~15 unrelated files that use "app.js" as a generic fixture name for
  workflow-app tests, which is likely where the estimate came from.
- `scripts/build-css.js` now writes only `report-css.ts` (the preferred
  option TECH-SPEC 2b left open): the Tailwind CLI output goes to a
  temp file, read once and deleted, so `ui/workbench/app.css` is never
  written to the repo tree. `app.css` and `app.src.css` are deleted;
  their `lang-policy-check.js` exceptions are dropped.
- `.github/workflows/ci.yml` line ~46 still runs
  `git diff --exit-code -- ui/workbench/app.css src/core/format/report-css.ts`
  after `bun run build:css`; `ui/workbench/app.css` no longer exists,
  so that path in the diff is now a permanent no-op. `.github/` is out
  of this packet's scope — a follow-up should drop `app.css` from that
  line (keep the `report-css.ts` diff).
- `src/shell/onramp.ts`'s `CURATED_SMOKE_MAP` (frozen `src/`, out of
  this packet's scope) hardcodes the pre-move path
  `test/web-desktop-workbench-smoke.js` for the `ui/workbench/` pattern
  row, and `nodeSmokeCommand()` always builds `node test/<name>`.
  Worked around inside `test/onramp-check-smoke.js` (in scope) with a
  small `RELOCATED_SMOKES` lookup so the existence check follows the
  file to its real home instead of failing; the frozen map and command
  builder still need a real fix in a packet that can touch `src/`.
- `scripts/version-sync-check.js:127` hardcodes
  `plugins/cool-workflow/test/web-desktop-workbench-smoke.js` as a
  path-exists-and-includes check read from `git show HEAD:<path>`.
  `scripts/` (beyond `build-css.js`/`lang-policy-check.js`) is out of
  this packet's scope, so this is left red: `citation-check-smoke.js`
  (part of `test/run-all.js`) already catches it as one dead citation.
  This is the one known failure in the full suite (263/264 passed) —
  a follow-up changes that one line to
  `plugins/cool-workflow/ui/workbench/tests/web-desktop-workbench-smoke.test.js`.
- `test/run-all.js` (`-smoke.js`) and `test/run-unit.js` (`.test.js`)
  both discover files by scanning `test/` only, so moving the seven
  files out needed no code change there — they simply stopped being
  found. `bun test`'s own discovery needs `.test.`/`.spec.` in the
  filename even for an explicit path argument, so the four smokes
  without that marker (`cli-handler-workbench-smoke.js`,
  `web-desktop-workbench-smoke.js`, `workbench-load-smoke.js`,
  `workbench-port-range-smoke.js`) were renamed to `*.test.js` on the
  move — required for the plain `"test": "bun test"` in
  `ui/workbench/package.json` to run them at all (verified: bare
  `bun test` silently skips a `-smoke.js`-named file with no error).
- `run-panel.tsx`'s `StructTable` had a `<table>` with no
  `overflow-x-auto` wrapper (TECH-SPEC 2b.7 check 8); wrapped it rather
  than carry the exception. Four small className fixes
  (`text-left`→`text-start`, two `pl-`→`ps-`, `mr-auto`→`me-auto` in
  `run-list.tsx`/`classes.ts`/`run-panel.tsx`) clear check 9 the same
  way — Tailwind's logical utilities work in an English-only tree same
  as the physical ones, so there was no reason to carry them as debt.
  Both checks' named-exception lists in the new gate are empty as a
  result.

## Architecture snapshot diff (closing PR)

Live docs whose claims got old, and where each was fixed:
- `AGENTS.md` "Stack rule and this repo's exceptions": said the
  Workbench is plain HTML, pending #676. Fixed in the closing PR.
- `docs/web-desktop-workbench.7.md` "The face": said system fonts, no
  framework, no network. Fixed in #685.
- `project/docs/intent/2026-09-07-workbench-next.md`: status said
  "closed, stays plain HTML" from the owner's earlier word; the later
  word ("留 Next 16.3.0，同时保留 cli") won. Status fixed and the file
  archived in the closing PR.
- `README.md`: no claim about the Workbench's stack; unchanged.

Status ledger: packets 0 to 5 merged as #679, #681, #682, #684, #685,
#683 (bun). 0 open PRs. Pages serves the export from the merge of #685.

