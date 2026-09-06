# plan.md — cool-workflow: bun as the one package manager

Stage 3 of `~/Developer/sdlc/unify-package-manager-bun/` (intent and
spec signed by the owner 2026-09-07). Owner's words: "统一包管理器全部为
bun". Playbook rule: when a packet departs from this plan, the same
commit updates this file. This is also packet 5 of
`sdlc/unify-js-architecture/plan.md`.

## What stays as it is

- The npm package: `npm install -g cool-workflow` for users, `npm
  publish` in the release flow, `npm pack` in the smokes. bun is the
  developer's installer, not the user's.
- The CLI runtime: Node >= 18, zero runtime dependencies.
- The smoke runner (`test/run-all.js`) stays a Node script; it runs the
  CLI as users run it.

## Measured facts (2026-09-07)

- Lockfiles: `plugins/cool-workflow/package-lock.json` (npm) and
  `plugins/cool-workflow/ui/workbench/bun.lock` (already bun, packet 1
  of the JS plan). No pnpm lock anywhere.
- `npm ci` / `npm install` / `npm run` appear 33 times across
  `.github/workflows/*.yml` and `scripts/release-*.js`.
- CI matrix: Node 18, 22, 24 plus a macOS job; every job starts with
  `npm ci --ignore-scripts`.
- devDependencies: 6 in the plugin (tailwindcss, @tailwindcss/cli,
  daisyui, @tailwindcss/typography, typescript, and one more), all
  exact pins.

## Packet (one PR, plan and code together, auto-merge)

| # | Who | Directory | Work | Proof |
| --- | --- | --- | --- | --- |
| B1 | Sonnet | `plugins/cool-workflow/` (package.json, bunfig.toml, bun.lock, scripts/), `.github/workflows/` | `"packageManager": "bun@1.4.1"`; `bunfig.toml` with `[install] exact = true`; `bun install` writes `bun.lock`; `package-lock.json` deleted; `scripts/check-package-manager.js` as `preinstall`, the cool-tunnel guard turned round to accept only bun (`npm_execpath` contains `bun`, `npm_config_user_agent` empty or starts with `bun/`), with one named exception: `npm pack` and `npm publish` do not run `preinstall`, so nothing more is needed for them; every CI job installs with `oven-sh/setup-bun` (pinned sha, `bun-version: 1.4.1`) then `bun install --frozen-lockfile`, and `npm run <x>` in workflows becomes `bun run <x>`; the release scripts keep `npm publish` and `npm view` but any `npm install`/`npm ci` in them becomes `bun install --frozen-lockfile`; `test/package-manager-gate-smoke.js` = spec R8 (source text: `packageManager` is `bun@1.4.1`, `bun.lock` exists, no `package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`, `preinstall` names the guard, `bunfig.toml` has `exact = true`, no workflow line installs with npm/pnpm/yarn; a bad copy in a temp dir goes red) | the proof step below; CI green on all four jobs |

## The proof step (spec section 3, adapted: the old lock is npm's)

1. Throwaway worktree on `main`.
2. `bun install` (no frozen flag) writes `bun.lock`.
3. Script: for every package in `bun.lock`, find its version in
   `package-lock.json`; print every mismatch as `name npm=X bun=Y`.
4. The repo's own gate: `npm run build`, `dist:check`, lang-policy,
   onramp, index, growth, `node test/run-all.js` (full).
5. Any mismatch: pin it under `"overrides"` in `package.json`, rerun
   from step 2; if the gate still fails, stop and write the reason into
   spec section 5.
6. The mismatch list and the gate tail go into the PR body.

## Known risks, named once

- The guard blocks `npm ci` on a developer's machine. The README line
  for contributors changes to `bun install`. The operator's release
  command (`npm run release -- X.Y.Z`) still works: `npm run` does not
  run `preinstall`.
- Node 18 leg: bun runs on its own runtime, so `bun install` works
  there; the CLI tests still run under Node 18 as before.
- `dist/` is built by `tsc` from `node_modules/typescript`; a version
  drift between npm's and bun's resolution would show in `dist:check`.
  The proof step catches it before the PR.

## What this plan got wrong

(filled as the packet lands, same commit as the departure)
