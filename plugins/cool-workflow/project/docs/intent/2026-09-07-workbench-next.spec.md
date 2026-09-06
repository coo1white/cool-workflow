# Spec: Workbench as a Next 16.3.0 static export

Intent: [2026-09-07-workbench-next.md](2026-09-07-workbench-next.md).
Status: draft, waiting on the intent's yes. Constrained by
`~/Developer/TECH-SPEC.md` sections 3, 3b (page shell, when final),
5, 6b.

## Shape

- `ui/workbench/` becomes its own package: `package.json` with `next`
  16.3.0, `react` 19.2.8, `react-dom` 19.2.8 as devDependencies,
  `output: "export"`, `basePath: "/ui"`. The plugin's own
  `package.json` stays at zero runtime dependencies and lists none of
  them; the npm package ships `ui/workbench/out/` only.
- Built files are committed (as `dist/` and `app.css` are). CI runs
  the build on Node 22 and fails on drift; the Node 18 leg skips the
  build the way `build:css` does.
- The host serves `ui/workbench/out/` at `/` and `/ui/*`, same
  headers as today (`no-store`, `nosniff`). No new route.
- The page is one client component tree reading `api/index` and
  `api/run/<id>` with relative paths, so it works at `/` and under the
  Pages prefix. Components: `RunList`, `RunPanel`, `Tabs`, `NeedsYou`,
  `RawJson`, `FirstRun`.
- Behaviors kept one for one: keyboard tab nav and `aria-controls`,
  the token hint text, `showing latest N of M`, the recovery alert
  text, the stamp map, the `What matters` strip.
- `report-html.ts` is not touched. It shares `app.css`.
- CSS: the same `app.src.css`; `@source` points at the components.
- Gate: `test/css-framework-gate-smoke.js` already pins react/next
  exact and bars other frameworks; the sub-package is added to its
  scan.

## Out of scope

New features, a Next server, a theme switch, vendored fonts.

## Plan (stage 3; each row one PR, one directory)

| # | Who | Files | Tests |
| --- | --- | --- | --- |
| 1 | Opus | `ui/workbench/package.json`, `next.config`, `tsconfig`, host `out/` wiring, `scripts/build-css.js`, CI drift step, lang-policy note | host smoke serves `out/index.html`; drift check red on a stale build |
| 2 | Sonnet | components under `ui/workbench/app/`, port of `app.js` | the seven Workbench smokes pass against the built DOM |
| 3 | Sonnet | the other 14 tests that read Workbench files | each pins the built output or the behavior, not source strings |
| 4 | Sonnet | `docs/web-desktop-workbench.7.md`, `scripts/site-snapshot.js` | Pages snapshot smoke |

About three working days of agent time with review. Haiku has no
gated single edit here.

## Verification (stage 4)

Every packet pastes: `npm test` tail, `npm run dist:check`, the CSS
drift diff, and one screenshot of the Workbench at `/` and one at the
Pages prefix.

## What this spec got wrong

(filled as packets land)

## Architecture snapshot diff

(filled by the closing PR)
