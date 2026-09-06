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
