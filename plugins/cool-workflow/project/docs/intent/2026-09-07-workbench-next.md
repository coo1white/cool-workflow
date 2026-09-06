# Intent: move the Workbench to Next 16.3.0 + React 19.2.8

Author: the operator (project owner), 2026-09-07, in the owner's own
words: "现在请全部统一 javascript 架构: Next 16.3.0 + React 19.2.8".
Status: proposed. Playbook stage 1: the owner merges this PR to say
"move the Workbench to Next", or closes it to say "the Workbench stays
plain HTML as a named exception". The spec is written only after a
merge.

## Problem

Every frontend under `~/Developer` is to be one HTML layer: Next 16.3.0
+ React 19.2.8, exact pins (TECH-SPEC 6b, decided 2026-09-07). The one
exception is cool-code-platform (Vue, an upstream fork). The Workbench
is plain HTML + JS with no framework, so it is the odd one out: a
person who keeps the other four cannot use the same skills here.

## Proposed outcome

The Workbench is a Next app that builds to static files. The read-only
host serves those files as it serves `index.html` today. Same page,
same two JSON routes, same behaviors, same tests' meaning. The plugin
keeps zero runtime dependencies.

## Affected users and systems

Operators who open the Workbench (no change they can see). The host
(`src/shell/workbench-host.ts`), `ui/workbench/`, 21 test files that
read the Workbench files, the Pages snapshot script, the CSS build,
the CI matrix (Node 18 leg), the docs page for the Workbench.

## Constraints

- Zero runtime dependencies in the plugin's own `package.json`.
- No network at build or run time; fonts stay named, not fetched.
- `report.html` stays a pure function (no React in the CLI).
- Tailwind 4.3.3 + daisyUI 5.7.28 and the TECH-SPEC section 3 theme.
- md budget (135) and the frozen surfaces hold.

## Open questions

- Node 18 cannot build Next 16 (engines >= 20.9). Keep the built files
  committed, with a drift check, as `dist/` and `app.css` are today?
- Do the 21 tests keep pinning source strings, or move to the built
  DOM? (The spec says: built DOM, since source strings change shape.)

## Measured facts (2026-09-07)

- Workbench today: 730 lines (`index.html` 41, `app.js` 594,
  `navigation.js` 44, `inspection.js` 51); `app.css` 96K, built.
  `wc -l ui/workbench/*`.
- Plugin runtime deps: 0; devDeps: 6; `node_modules` 55M, 32 packages.
- Data: two read-only JSON routes only. One page, no routing, no
  server rendering, no images. `grep -n "/api/" ui/workbench/app.js`.
- Tests that read Workbench files: 21 of 455 (`grep -l`).
- Next 16.3.0 `engines.node` is `>=20.9.0`; this repo's CI matrix is
  18/22/24. The `next` package on this machine is 198M.
- `report-html.ts` is a pure markdown-to-HTML function used by the
  CLI (`cw report --open`); Next cannot produce that file from a CLI.

## The author's own judgment (numbers above)

For this Workbench, Next is a net cost: 0 to 198M of dependencies, a
build step where today a refresh shows the change, 21 test files to
re-pin, and nothing a user can see changes. Next's three strengths
(routing, server rendering, images) are not used here. The one real
gain is the owner's: one skill set across all five projects. If that
gain is worth the cost, merge. If not, close, and the Workbench takes
only the page-shell contract (TECH-SPEC 3b) and the gate.

## Five words, one line each

- Safe: the host stays read-only localhost; the UI sub-package grows
  the supply chain from 32 packages to some hundreds.
- Stable: zero deps cannot break; Next has a major every 6 to 12
  months, so upgrade work from then on.
- Simple: 730 plain lines and a refresh, versus components, config,
  and a build before any change shows.
- Reliable: static export is a well-worn path; committed output with a
  drift check is this repo's own pattern.
- Easy to keep: one skill set across the five repos, the only real
  gain, and it is the owner's.

## Paths weighed

- **Keep plain HTML (turned down by the owner).** Cost 0; upkeep 0;
  can be undone: n/a. Turned down because it leaves one project on a
  second skill set.
- **React 19.2.8 + Vite, no Next.** Hard: medium; upkeep: one more
  toolchain; cost: ~60M deps; can be undone: yes. Turned down: it is a
  second architecture next to Next, against the one-layer rule.
- **Next with a running server.** Turned down: the host is a read-only
  localhost file server by design; a second server is a new surface.
- **Chosen: Next static export**, served by the host as files.
