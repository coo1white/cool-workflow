# Lessons — hard-won facts for future iterations

Durable, cross-cutting lessons captured from real work on CW, so the next agent
(or the operator) does not re-learn them the hard way. Each is a fact plus the
fix or the rule. Add a lesson when a mistake cost real time; keep it concrete and
point at the file/command that proves it. This complements — it does not replace
— `PROJECT_MEMORY.md` (session state) and `docs/HANDOFF_TODO.md` (in-flight work).

## Release & publish

- **Publishing is tag-driven, not merge-driven.** Merging a release PR to `main`
  does NOT publish. `npm-publish.yml` fires on `release-gate` success, which
  fires on a `push` of a `v*` tag. No tag ⇒ `release-gate`/`npm-publish` never
  run ⇒ nothing new in the Actions tab and npm stays on the old version. If
  someone asks "the PR merged, why isn't it on npm / why can't I see it in
  Actions?", the answer is almost always "no tag was cut yet."
- **Cut a release with the gated flow, never by hand.** From a clean checkout of
  `origin/main` with a clean working tree (the cut runs `git add -u`, so any
  uncommitted edit would ride into the immutable tag commit):
  `CW_AGENT_COMMAND="claude -p {{input}}" node plugins/cool-workflow/scripts/release-flow.js --cut --version X.Y.Z --push`.
  It runs the deterministic gate, delegates an independent reviewer that writes
  `.cw-release/review-<sha>.verdict` (`APPROVED <sha>`), commits it, tags, and
  atomic-pushes the branch + tag. The tag then drives `release-gate.yml` →
  `npm-publish.yml` (Trusted Publishing, provenance) + `github-release.yml`.
  Never hand-write a verdict file.
- **The independent reviewer must run EXECUTE-capable.** A read-only / low-effort
  reviewer cannot re-run the gate it is judging and fabricates a REJECTED verdict
  (the v0.1.97 codex case: two REJECTs in <65 s vs a ~12-min gate). Review intent
  is wired through as `CW_RELEASE_REVIEW=1`; the wrapper raises effort and opens
  the sandbox to workspace-write. Never trust a read-only/low-effort verdict.
- **What the gate actually runs.** `release-gate.sh` = build, `test:gate` (full
  suite), diff-substance / test-evidence / cadence checks, branch-naming. It does
  NOT run `readme:check` or the dogfood release-cut — those live only in the
  broader `release:check`. So the sandbox readme artifact (below) does not affect
  the gate or the reviewer.
- **If a version bump leaves `dist/version.js` stale**, it is the tsc incremental
  cache. `rm -f .cache/tsconfig.tsbuildinfo && npm run build` regenerates it;
  otherwise `mcp-app-surface-smoke` fails on a version mismatch.
- **`bump:version` has two modes.** Gate-mode stamps structured surfaces but skips
  docs; `--content` also stamps docs/man-pages. If gate-mode ran first, `--content`
  reports "already at X" — revert the structured files (keep `CHANGELOG.md`) and
  re-run `--content` from the clean prior version.

## The sandbox `127.0.0.1` git-URL-rewrite artifact

- In this cloud sandbox, outbound git is rewritten through a `127.0.0.1` proxy.
  That host gets injected into the *expected* README URL, so `readme:check` /
  `readme-sync-smoke` (and the dogfood release-cut verdict that cascades from it)
  **fail ONLY in the sandbox and are green in CI.** A `test:fast` run showing
  `169/170` with the lone failure being `readme-sync-smoke` is this artifact, not
  a regression.
- **Never run `npm run sync:readme` in the sandbox** — it would bake the
  `127.0.0.1` proxy host into the committed README. Leave README sync to CI.

## Ledger design & security (`cw ledger`)

- **Content-addressed `id` must be bound to content on the verify path.** `id` is
  excluded from the digest, so `verifyLedgerEntry` must check `id === deriveId(digest)`
  and fail closed (`ledger-id-mismatch`). Without it a forged or absent `id` slips
  through the mirror-union de-dup — a HIGH finding from the stage-3 adversarial
  review. Any field excluded from a digest needs its own binding check.
- **Multi-mirror union is conflict-free by construction** because entries are
  immutable + content-addressed, so a union is a set-union, not a merge. Multi-host
  is for redundancy/reachability, never load (the traffic is KB-sized commits).
- **Only verified entries may drive derived state.** The inbox `resolution`
  (proposal↔review pairing) ignores unverified entries, so a tampered review can
  never resolve a proposal — it stays `pending` (fail-closed).
- **Report, don't adjudicate — mechanism, not policy.** The ledger reports a
  `contested` proposal when reviews disagree rather than picking a winner; whether
  a REJECTED verdict blocks a merge stays outside the kernel. The release-reviewer
  rejects policy-in-kernel and declared-but-never-read type fields (spec accretion),
  so every new field must be consumed by a real code path and asserted by a test
  that fails if the impl is reverted (not a `typeof` check).

## Naming & POLA

- **Check for an existing verb before naming a new one.** `cw handoff` already
  existed (run/task ownership transfer), so the cross-agent primitive had to be a
  NEW verb, `cw ledger` — overloading `handoff` would have broken POLA. Grep the
  command surface first.
- **Extend output additively.** New JSON keys are POLA-safe; changing or removing
  existing keys is not. Guard the byte-identical default with a POLA assertion in
  the smoke (e.g. single-`--dir` keeps `dir`, not `dirs`).

## Gates & repo mechanics

- **`onramp:check` requires an `ITERATION_LOG.md` cycle row for any source / app /
  script change** (goal | files | tests | gate | tagged). Docs-only changes do not
  require one. Add the row or the gate fails closed.
- **Tests are auto-discovered from `test/*-smoke.js`** by `run-all.js` — a new
  smoke runs the moment it lands (nothing to wire), but it bumps the smoke count
  in `plugins/cool-workflow/docs/project-index.md`, so run `npm run sync:project-index`
  or `index:check` fails.
- **Two docs trees, different gate scope.** `sync-project-index.js` indexes
  `plugins/cool-workflow/docs/` only, so a new file there needs an index regen;
  repo-root `docs/` (this file, `BACKLOG.md`, `HANDOFF_TODO.md`) is outside that
  scan — no index churn.
- **`docs/BACKLOG.md` is only for ideas parked because they serve no North Star
  track** (reviewer Gate 4). In-flight, started work goes in `docs/HANDOFF_TODO.md`;
  durable lessons go here. Don't conflate the three.
- **Man-page sync is binding.** A shipped behavior change must update the matching
  `docs/*.7.md` in the same diff, or the reviewer rejects it.

## Git & cross-session operations

- **`git push` never goes to `main` directly** (AGENTS.md hard rule): feature
  branch → PR → review → merge. A release cut pushes its *feature branch* + the
  tag (tags are not `main`); the verdict commit reaches `main` via the PR.
- **"stale info" on `--force-with-lease` after a merge** means the remote branch
  was auto-deleted when its PR merged, so the lease is stale. `git remote prune
  origin`, then a normal `git push` (the branch is gone — there is nothing to
  overwrite). Per the task rule, when a designated branch's PR has already merged,
  restart it from the default branch: `git checkout -B <branch> origin/main`.
- **A repo-scoped cloud session cannot reach outside its scope.** `create_repository`
  and cross-repo calls return 403. The operator must create a shared handoff repo
  and grant each environment a git token; scoping a second environment (e.g. chime)
  into it is a web-UI step, not something the scoped agent can do.
- **Keep distinct changes on distinct branches / PRs.** Docs handoff, a code
  feature, and a lessons doc are three PRs, not one — the reviewer wants focused
  diffs, and mixing them muddies the story.

## Operator environment quirks (macOS)

- Interactive **zsh does not treat `#` as a comment**, so a pasted command block
  with trailing `# ...` throws a parse error near `)`. Give the operator
  comment-free command blocks.
- `npm i -g .` can install `cw` into a **shadowed prefix**; symlinking the
  git-version entrypoint into `/usr/local/bin/cw` is the reliable fix until a
  released `npm i -g cool-workflow@latest` is available.
- git credentials use the **osxkeychain** helper; a token added once is reused.
