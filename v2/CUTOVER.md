# v2 cutover plan — make the rebuild the shipping product

## Context

`v2/` is a from-scratch rebuild that passes the 101-case `v2/conformance/` suite
byte-for-byte against the shipping `plugins/cool-workflow` build, plus 152 pure
unit tests. The decision is made: v2 becomes the product. But conformance only
proves **CLI runtime behavior**. A grounded gap analysis found the rest — the
packaging, release tooling, CI, vendor manifests, the app/doc/ui payload, and
~75 distribution-focused smokes — is missing or borrowed. This plan sequences
that gap into gated, reversible phases.

**Guiding fact that shapes everything:** the runtime is already
conformance-proven. So the cutover must change **zero runtime behavior** — it is
additive packaging/tooling/CI work, and the 101-case conformance suite is the
standing guardrail that proves runtime stays byte-identical at every step. Any
phase that turns a conformance case red is wrong and stops the line.

## Two decisions to lock before Phase 1

### Decision 1 — Swap in place, do NOT build a standalone `/v2` package (recommended)

The cheapest, safest shape is **not** "make `/v2` its own npm package." It is:
keep `plugins/cool-workflow` as the published package — its `apps/`, `docs/`,
`ui/`, `manifest/`, `skills/`, `workflows/`, `scripts/`, `.github/` CI, and
release-flow all stay exactly where they are — and replace only its `src/` (and
the `dist/` build) with v2's `core/`+`shell/`+`cli/`+`mcp/`.

This collapses most of the gap:

- The hard-coded walk-up in `v2/src/shell/workflow-app-loader.ts` that reaches
  for `plugins/cool-workflow/apps` now resolves to the co-located `apps/` for
  free — no payload migration, no path surgery beyond confirming it resolves.
- `docs/`, `ui/`, `manifest/`, `skills/`, `workflows/`, the vendor plugin dirs,
  `.mcp.json`, and every release/dist script stay in place and keep working.
- The npm `files[]` array, `bin`, CI, and release-flow need no relocation.

The gap then shrinks to one real question: **does v2's `src/` satisfy everything
the shipping package's gate already checks — not just the 101 conformance cases,
but the full 173-smoke suite and `release:check`?**

The alternative (standalone `/v2` package) means migrating 8 apps + 67 docs + 5
skills + UI + workflows + 18 scripts + manifests into `/v2` and repointing all of
CI/release. More work, more risk, no benefit. Recommended: swap in place.

### Decision 2 — Explicit sign-off on the facade collapse

v2's headline structural change replaces the 141-method orchestrator facade and
the hand-written CLI + MCP dual surface with one `core/capability-table.ts` and
generic dispatchers. The shipping build keeps that facade and dual surface **on
purpose** — it is a documented, parity-gated anti-goal (see the project's own
"orchestrator facade is intentional" note). Cutover overrides that decision.

Consequence: the `parity-check.js` / `parity-doc-sync` model changes from "two
hand-written surfaces diffed against a registry" to "one table both surfaces read"
— those gates must be re-expressed against v2's single-table model in Phase 2,
not deleted. This needs a human's explicit "yes, the facade goes" before Phase 2.

## Phased plan — each phase is its own PR, gated, reversible

### Phase 0 — Baseline guardrail (do this first; valuable even if cutover stalls)
Wire the 101-case conformance suite into CI, run against the SHIPPING
`plugins/cool-workflow/dist/cli.js` (already 101/101). This locks the product's
observable behavior as a black-box regression net now, and becomes the objective
"runtime unchanged" proof for every later phase.
**Gate:** CI runs `v2/conformance/run.js --bin <shipping cli>` green.

### Phase 1 — Test-structure reconciliation
Triage the 173 `plugins/cool-workflow/test/*-smoke.js` into:
- **Behavioral** (drive the CLI, assert output/state) — must stay green against
  v2's `src/`; these are already covered in spirit by conformance.
- **Structural / white-box** (read `src/` shape, assert specific files/exports,
  e.g. `cli-command-surface-smoke.js` asserts `src/cli.ts` ≤80 lines and delegates
  to `command-surface`) — these encode the OLD internal structure and will fail
  on v2's `core/`+`shell/` layout. Rewrite each to assert v2's equivalent
  invariant, or retire it with a one-line justification tied to the conformance
  case that now covers its intent.
**Gate:** an adapted smoke suite passes against a v2-src build; every retirement
is justified in the PR.

### Phase 2 — Doc / manifest / parity tooling (where the facade collapse lands)
Re-express `gen-manifests.js`, `gen-parity-doc.js`, `parity-check.js`,
`sync-readme.js`, `sync-project-index.js` against `core/capability-table.ts` as
the single source. The parity gate becomes a self-consistency check on the one
table (no duplicate ids, every cli-only/mcp-only row has a reason) plus the live
payload-identity probe — replacing the two-surface diff.
**Gate:** manifests regenerate byte-identically where they must (POLA on shipped
manifest bytes); `parity-doc-sync` and `readme-sync` smokes pass on the new source.

### Phase 3 — Release tooling
Port/adapt `bump-version.js`, `release-check.js`, `release-flow.js`,
`release-gate.sh`, `version-sync-check.js`, `vendor-preflight.js`,
`onramp-check.js`, `coverage-gate.js`, `golden-path.js`, `dogfood-release.js`,
`canonical-apps.js` to v2's layout. Most are path/structure edits, not rewrites.
**Gate:** `release:check --skip-tests` green against the v2-src build.

### Phase 4 — The swap
`git mv` v2's `core/`+`shell/`+`cli/`+`mcp/` (and `test/`) into
`plugins/cool-workflow/src` + `test/`, replacing the old tree; rebuild `dist/`;
confirm `workflow-app-loader` resolves the co-located `apps/`; bump version to a
major (`0.2.0` — total internal rewrite, identical external behavior);
regenerate all manifests.
**Gate (the full product gate):** `npm run build` + the adapted smoke suite +
`v2/conformance/run.js --bin dist/cli.js` (101/101) + `release:check` all green,
run in CI, twice for flakiness.

### Phase 5 — Ship
Cut `v0.2.0` through the existing gated `release-flow --cut` (never tag directly).
Move `v2/SPEC`, `v2/PLAN.md`, `v2/DESIGN_MINIMAL_KERNEL.md`, and this file under
`plugins/cool-workflow/docs/` (or an `docs/rebuild/`) as the rebuild's provenance;
keep `v2/conformance/` as a permanent black-box regression suite in CI.

## Verification (standing, every phase)

- `v2/conformance/run.js --bin <build>` stays 101/101 — the runtime-unchanged proof.
- The adapted 173-smoke suite green before Phase 4 ships.
- `release:check` green before Phase 5.
- Dogfood: run the `release-cut` app on this repo (CW releases itself).

## Risk / rollback

Each phase is a separate PR off `main`; nothing touches `main` without CI green.
Phase 4 (the swap) is the point of no easy return, but it is a single git commit
and fully revertible, and conformance is the objective proof that observable
behavior did not change across it. Phases 0–3 are pure additions and carry
near-zero product risk.

## Rough sizing

Weeks, not days — dominated by Phase 1 (triaging/adapting ~173 smokes, of which
maybe 40–60 are structural) and Phase 2 (re-expressing the parity model on the
capability table). Phases 0, 3, 4, 5 are each days. Recommend running Phase 0
immediately (it is cheap and valuable standalone), then gating the rest on the
Decision-2 facade sign-off.
