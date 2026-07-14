# Project Memory

This is the repo-local memory for Cool Workflow agent runs. Keep it true to fact,
short, and simple to add to. Do not use it for guesses.

Since 2026-07-13 this is the ONE memory file: it took in the old
`docs/LESSONS.md` (durable lessons) and `docs/HANDOFF_TODO.md` (in-flight
relay) — see the "Lessons" and "In-flight relay" sections. `docs/BACKLOG.md`
stays separate: it parks ideas that serve no North Star track.

## Current Work Direction

- Fix known faults in the runtime and release work first.
- After that, take out dead files, old copies, and paths which have no use.
- Keep `core`, `shell`, and `wiring` separate. Put decisions in `core`, file
  and process work in `shell`, and CLI/MCP links in `wiring`.
- Keep command output, JSON, exit codes, file layouts, and replay records as
  they are. Put new behavior behind a new command, flag, or opt-in setting.
- Give each cycle one goal. Keep a fault fix and a tree clean-up in separate
  PRs.
- Use small control points and saved state. Put long or waiting work in a
  process outside the MCP control process.
- New work has to help a North Star track. Put other ideas in
  `docs/BACKLOG.md`.
- `DIRECTION.md` is the source for product direction. This section gives the
  present work order.

## Verified Facts

- Default context slimming has to use the `core` source profile.
- The `core` profile takes in:
  - `plugins/cool-workflow/src/**`
  - `plugins/cool-workflow/apps/**`
  - `plugins/cool-workflow/package.json`
  - `plugins/cool-workflow/tsconfig.json`
  - `plugins/cool-workflow/scripts/cw.js`
  - `plugins/cool-workflow/scripts/mcp-server.js`
  - `plugins/cool-workflow/scripts/agents/**`
- The `core` profile keeps out:
  - `plugins/cool-workflow/dist/**`
  - `plugins/cool-workflow/test/**`
  - `plugins/cool-workflow/docs/**`
  - `docs/assets/**`
  - `.cw-release/**`
  - `CHANGELOG.md`
  - `ITERATION_LOG.md`
- Keeping `dist/` out of the context pack is let through; deleting committed `dist/`
  is a separate release-contract decision.
- Context slimming is opt-in and must not change the CW command output we have now.
- `core` is still the default source context profile. Narrow opt-in profiles are there
  for scoped runs: `runtime`, `mcp`, `workflow-apps`, `release`, and
  `agent-wrappers`.
- `source-context --changed-from REF` is an opt-in diff-aware mode. It cuts the
  manifest/export down to changed current-ref files before profile inclusion, leaves out
  deleted files, keeps a note of the worked-out `changedFrom` base, and uses a separate
  cache key from full exports.
- Skill trigger metadata has to be in normal YAML frontmatter. Every
  `SKILL.md` needs `name` and a `description` full of triggers; the body is loaded
  only after a skill triggers and must not be the one place the trigger text comes from.
- Plan for making the runtime quicker:
  1. Add an opt-in fast architecture-review path that runs Map and Assess work
     as parallel phases in place of serial agent calls.
  2. Keep separate `fast` and `full` review modes so users can get a useful
     first result quickly while the deep review we have now is still there to use.
  3. Make one JSONL source context per run and give that fixed context to
     agent wrappers in place of making every worker go and find the repository again.
  4. Send cheap, fast models to mapping and summarization work, and keep the
     stronger models for verification and last verdict tasks.
  5. Cache source context and middle maps by git SHA plus profile digest,
     and fail closed when the digest does not match.
  6. Move long full reviews to routines/background runs so foreground user
     flows give back progress and a fast report in place of stopping for 40 minutes.
- `architecture-review-fast` is the opt-in fast/full split build. It
  keeps `architecture-review` the same, plans 6 workers in place of 14, runs Map
  and Assess as parallel phases, takes in possible `sourceContext` and
  `sourceContextDigest` inputs, and reads model hints from
  `CW_ARCHITECTURE_REVIEW_FAST_MODEL` and
  `CW_ARCHITECTURE_REVIEW_STRONG_MODEL`.
- For model routing in user workflows, it is better to use wrapper flags:
  `architecture-review-fast --fast-model <fast> --strong-model <strong>`. The
  flags set the same task-level hints as the env vars; the model attestation kept on record
  still comes only from the outside agent output.
- `source-context export --cache-dir DIR` caches JSONL by resolved git commit SHA
  plus source-profile digest; cache hits must be byte-identical JSONL and corrupt
  cache records fail closed.
- `scripts/architecture-review-fast.js` is the automated fast-review wrapper. It
  exports cached source context for a target repo, computes the JSONL digest,
  starts `architecture-review-fast`, and can schedule a one-shot background
  `architecture-review` run with `--schedule-full`.
- `architecture-review-fast --schedule-full` stores foreground handoff context in
  the schedule prompt: fast run id, fast report path, source-context digest and
  profile, plus an instruction to return the full review report path and digest.
- `scripts/architecture-review-fast.js --metrics` is opt-in. Default JSON output
  remains unchanged; the metrics payload reports elapsed milliseconds, source
  context bytes, fast-review step counts, agent-spawn counts, and result-cache
  hit counts.
- Live baseline on 2026-06-13 using the bundled Claude wrapper against this repo
  with the `core` profile: first `architecture-review-fast --once --metrics`
  completed the two Map workers in 190118ms with `agentSpawns=2` and
  `resultCacheHits=0`; the immediate second identical run completed in 703ms
  with `agentSpawns=0` and `resultCacheHits=2`.
- Continuing that same live run showed Assess at 209149ms, Verify at 133709ms,
  Verdict at 127522ms, and the final commit at 323ms. Assess is the largest
  remaining measured foreground phase.
- Task `resultCache` is explicit opt-in. `architecture-review-fast` Map workers
  cache accepted results by `sourceContextDigest` plus rendered prompt digest;
  Assess workers additionally include completed previous-phase result digests in
  the cache key. Cache hits copy the cached result into the worker-local result
  path and still pass through normal worker-output validation. Missing or
  invalid cache entries never fabricate success.

## Failed Attempts

- Do not treat `.jsonl` slimming, god-object refactors, and physical repository
  line-count reduction as the same task. They have different risk profiles.
- Do not silently omit files from an AI context pack. Omitted files need a
  manifest entry with reason, size, line count, and digest.
- Do not make live agent output default behavior on an existing wrapper or drive
  path. Default stdout/stderr bytes are a POLA contract; stream-json rendering
  must be explicit opt-in (`CW_AGENT_STREAM=1`), TTY-gated, and still silent when
  piped.

## In-flight relay (was docs/HANDOFF_TODO.md — keep the state lines honest)

- **Scope chime's environment into the shared handoff repo (operator, web
  UI).** `coo1white/handoff` (Private) is created, guarded, and verified; the
  cool-workflow (Mac) side is proven end-to-end. `cw ledger` has been on npm
  since v0.1.98 (v0.2.4 is out now). The remaining step is a web-UI action —
  add the `chime` environment's repository scope + a git token that can
  read/write it. A cool-workflow-scoped session cannot do this itself
  (`create_repository`/cross-repo calls return 403). Then on the chime side:
  `npm i -g cool-workflow@latest`, clone the handoff repo, and verify with
  `cw ledger list --dir ledger` (fail-closed). Setup runbook:
  `plugins/cool-workflow/docs/handoff-setup.md` and
  `plugins/cool-workflow/docs/cross-agent-ledger.7.md`.
- (Done, kept for the record: the old "cut the v0.1.98 tag" blocker shipped
  on 2026-07-03; releases through v0.2.4 are live on npm.)

## Cross-agent handoff ledger (verified)

- `cw ledger propose|review|verify|list` (CLI + MCP; design #317, impl #318) lets
  two agents scoped to two separate repos hand each other a change proposal or a
  review verdict as a digest-sealed JSON entry, verified fail-closed.
- Transport is git-host-agnostic. An entry is a file under `ledger/` in a shared
  repo both agents can push/pull; the kernel holds NO git logic. Write =
  `cw ledger propose > ledger/<id>.json`; read = `cw ledger list --dir ledger`
  (fail-closed inbox — exits 1 if any entry is tampered or malformed). `git
  add/commit/push` is the operator's step, kept out of the kernel.
- Entry digest = `sha256:` over the key-sorted canonical JSON of every field
  except `id`/`digest`; `id` = `ldg-` + the first 16 hex of the digest.
- Shared-repo (T2a) setup and the GitHub-vs-self-hosted (Gitea) trade-off live in
  `plugins/cool-workflow/docs/handoff-setup.md`.
- A cool-workflow-scoped web session CANNOT create a GitHub repo outside its scope
  (`create_repository` returns 403). The operator creates the shared repo and sets
  each environment's git token; scoping both environments is a web-UI step.
- Reachability decides host choice: github.com is in the default Trusted network
  allowlist (cloud sessions reach it with no policy change); a self-hosted Gitea
  host is NOT, so it needs the environment network policy to permit that host.

## Handoff ledger — future direction

- Direction, not load: the ledger carries KB-sized JSON commits, so there is no
  throughput problem to "share". Multi-host is for REDUNDANCY and geo-
  REACHABILITY (e.g. Gitea mirrors on VPSes in several countries when one host or
  region is unreachable), never for load-balancing a non-existent load.
- Why multi-host is safe HERE where general multi-master git is not: entries are
  immutable, content-addressed (`id` = digest), and self-verifying. Two agents
  never write the same filename with different content, so union of N mirror
  directories is a conflict-free set-union of self-verifying files. Write
  consistency — not throughput — is the real constraint, and immutability +
  content-addressing resolves it with no merge step.
- Mechanism for it: `cw ledger list` takes a repeatable `--dir` and union-verifies
  the mirrors into ONE fail-closed inbox (a tampered entry in ANY mirror fails the
  whole batch). Single `--dir` stays byte-identical (POLA); 2+ dirs is the new
  union path.
- Host path: start on GitHub private (reachable out of the box), add self-hosted
  Gitea mirrors later for redundancy/reachability. Migration is zero code cost —
  the transport is git-host-agnostic, so only the git remote(s) change. Each
  added node is one more network-allowlist entry and one more thing to keep
  online; add nodes for a concrete availability/reachability driver, not by
  default (more nodes = larger failure surface).

## Lessons (was docs/LESSONS.md — a fact plus the fix, kept concrete)

### Release & publish

- **Publishing is tag-driven, not merge-driven.** Merging a release PR to `main`
  does NOT publish. `npm-publish.yml` fires on `release-gate` success, which
  fires on a `push` of a `v*` tag. No tag ⇒ nothing new in Actions and npm stays
  on the old version.
- **Cut a release with the gated flow, never by hand.** As of v0.2.3+ the flow
  is two steps: the agent preps the CHANGELOG + version-bump PR, then the
  OPERATOR runs `npm run release -- X.Y.Z` in their own terminal (fail-fast
  preflight, gated cut, tag-only push, CI wait; a re-run resumes). Never
  hand-write a verdict file; never `git tag` by hand. Full rules: `RELEASE.md`
  and AGENTS.md "Shipping a release".
- **The independent reviewer must run EXECUTE-capable.** A read-only / low-effort
  reviewer cannot re-run the gate it is judging and fabricates a REJECTED verdict
  (the v0.1.97 codex case: two REJECTs in <65 s vs a ~12-min gate). Review intent
  is wired through as `CW_RELEASE_REVIEW=1`; the wrapper raises effort and opens
  the sandbox to workspace-write. Never trust a read-only/low-effort verdict.
- **What the gate actually runs.** `release-gate.js` = build, `test:gate` (full
  suite), diff-substance / test-evidence / cadence checks, branch-naming. It does
  NOT run `readme:check` or the dogfood release-cut — those live only in the
  broader `release:check`.
- **If a version bump leaves `dist/version.js` stale**, it is the tsc incremental
  cache. `rm -f .cache/tsconfig.tsbuildinfo && npm run build` regenerates it;
  otherwise `mcp-app-surface-smoke` fails on a version mismatch.
- **`bump:version` has two modes.** Gate-mode stamps structured surfaces but skips
  docs; `--content` also stamps docs/man-pages. If gate-mode ran first, `--content`
  reports "already at X" — revert the structured files (keep `CHANGELOG.md`) and
  re-run `--content` from the clean prior version.

### The sandbox `127.0.0.1` git-URL-rewrite artifact

- In a cloud sandbox, outbound git may be rewritten through a `127.0.0.1` proxy.
  That host gets injected into the *expected* README URL, so `readme:check` /
  `readme-sync-smoke` (and the dogfood release-cut verdict that cascades from it)
  **fail ONLY in the sandbox and are green in CI.** A run whose lone failure is
  `readme-sync-smoke` is this artifact, not a regression.
- **Never run `npm run sync:readme` in the sandbox** — it would bake the
  `127.0.0.1` proxy host into the committed README. Leave README sync to CI.

### Ledger design & security (`cw ledger`)

- **Content-addressed `id` must be bound to content on the verify path.** `id` is
  excluded from the digest, so `verifyLedgerEntry` must check `id === deriveId(digest)`
  and fail closed (`ledger-id-mismatch`). Any field excluded from a digest needs
  its own binding check.
- **Multi-mirror union is conflict-free by construction** because entries are
  immutable + content-addressed, so a union is a set-union, not a merge.
- **Only verified entries may drive derived state.** The inbox `resolution`
  ignores unverified entries, so a tampered review can never resolve a proposal —
  it stays `pending` (fail-closed).
- **Report, don't adjudicate — mechanism, not policy.** The ledger reports a
  `contested` proposal when reviews disagree rather than picking a winner. Every
  new field must be consumed by a real code path and asserted by a test that
  fails if the impl is reverted (not a `typeof` check).

### Naming & POLA

- **Check for an existing verb before naming a new one.** `cw handoff` already
  existed (run/task ownership transfer), so the cross-agent primitive had to be a
  NEW verb, `cw ledger`. Grep the command surface first.
- **Extend output additively.** New JSON keys are POLA-safe; changing or removing
  existing keys is not. Guard the byte-identical default with a POLA assertion in
  the smoke (e.g. single-`--dir` keeps `dir`, not `dirs`).

### Gates & repo mechanics

- **`onramp:check` requires an `ITERATION_LOG.md` cycle row for any source / app /
  script change** (goal | files | tests | gate | tagged). Docs-only changes do not
  require one.
- **Tests are auto-discovered from `test/*-smoke.js`** by `run-all.js` — a new
  smoke runs the moment it lands, but it bumps the smoke count in
  `plugins/cool-workflow/docs/project-index.md`, so run `npm run sync:project-index`
  or `index:check` fails.
- **Two docs trees, different gate scope.** `sync-project-index.js` indexes
  `plugins/cool-workflow/docs/` only; repo-root `docs/` is outside that scan.
- **Where notes go:** durable lessons go HERE; in-flight started work goes in
  "In-flight relay" above; `docs/BACKLOG.md` is only for ideas parked because
  they serve no North Star track.
- **Man-page sync is binding.** A shipped behavior change must update the matching
  `docs/*.7.md` in the same diff, or the reviewer rejects it.
- **A reference grep does not find every pin.** A file can be pinned by CONTENT
  (a test doing `readFileSync` + assert on it — see the `src/core/types.ts`
  restore, 2026-07-13) or by a runtime path convention (`cw man <topic>` serves
  `docs/<topic>.7.md`). Before deleting "unreferenced" files, run the FULL suite
  against the committed head; that is the real net.

### Multi-agent loops (PDCA blackboard)

- When a task asks for agents to work together, first try the parts CW already
  has: workflow apps give the work shape, worker output gives checked facts, the
  blackboard gives shared state, MCP gives tool access to the same state, smoke
  tests prove the loop. Do not make a new MCP server when the existing server
  can show the same run state; add a workflow app first, then prove it with one
  smoke that uses both CLI and MCP.
- For a three-agent loop keep the order plain: `plan -> build -> audit -> next
  action`. Each agent writes one blackboard message and, when there is a result
  file, one artifact ref. If audit evidence is missing, let the worker evidence
  gate refuse the result instead of adding a new policy layer.

### Git & cross-session operations

- **`git push` never goes to `main` directly** (AGENTS.md hard rule): feature
  branch → PR → review → merge. A release cut pushes its *feature branch* + the
  tag; the verdict commit reaches `main` via the PR.
- **"stale info" on `--force-with-lease` after a merge** means the remote branch
  was auto-deleted when its PR merged. `git remote prune origin`, then a normal
  push; when a branch's PR has already merged, restart it from the default
  branch: `git checkout -B <branch> origin/main`.
- **A repo-scoped cloud session cannot reach outside its scope.** Cross-repo
  calls return 403; shared-repo creation and scoping are operator web-UI steps.
- **Keep distinct changes on distinct branches / PRs.** Focused diffs; mixing
  a docs change, a code feature, and a lessons update muddies the story.

### Operator environment quirks (macOS)

- Interactive **zsh does not treat `#` as a comment** — give the operator
  comment-free command blocks.
- `npm i -g .` can install `cw` into a **shadowed prefix**; `npm i -g
  cool-workflow@latest` is the reliable path now that releases are published.
- git credentials use the **osxkeychain** helper; a token added once is reused.

## Next Run

- The structure roadmap and all three North Star proofs are complete. See
  `docs/audits/north-star-proof-2026-07-14.md`.
- Keep inside-only work stopped. A later product proof has to give a real
  blocker before another structure cycle starts.
- The chime scope item in "In-flight relay" is operator work. It is separate
  from the code roadmap.
- Use `node plugins/cool-workflow/scripts/architecture-review-fast.js --repo <repo> --profile core --once --metrics --schedule-full`
  for the automated 1→6 path on a CW-shaped repo. Use `--profile-file` for
  non-CW repositories.
- Map, Assess, Verify, and Verdict now have opt-in result cache use. Do not add
  another context or cache mechanism without new measured need.
- Use narrow source profiles before a more complex context mechanism: `mcp`,
  `workflow-apps`, `release`, and `agent-wrappers` are much smaller than
  `core`; `runtime` carries the full `src/**` kernel on purpose.
- For incremental review, prefer `--changed-from origin/main` plus a narrow
  profile. Treat the changed JSONL as an overlay, not a replacement for a full
  audit when broad architectural context is required.
- When a repeated workflow improves, update the matching skill.
