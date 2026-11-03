# REVIEW.md — how a PR is reviewed here

Three passes, in this order, by a reviewer that did not write the
code (cw's own reviewer agent, or a person):

1. Bugs and logic: does the change do what its PR text says, on the
   happy path and the empty, missing and wrong-input paths?
2. Security: no secret in the tree, no new network call, no new
   runtime dependency in the CLI, no path built from run text, every
   run string escaped before HTML.
3. Compliance: the diff matches the program's `spec.md` and `plan.md`
   (`project/docs/sdlc/` and `project/docs/intent/`); a departure updates the plan
   in the same commit; the PR pastes the gates the plan names.

Merge needs green CI and the reviewer's word. The agent that wrote the
code never approves it. Release is the operator's own command.

## What a reviewer stops

The binding rules, with what checks each, are the table in `AGENTS.md`.
Below are the lessons: things a reviewer has stopped before, each one
rule and its reason. When a new lesson is learned, add it here.

### Release

- **A hand-made release.** Never `git tag` by hand; never hand-write a
  verdict file; the operator runs `npm run release -- X.Y.Z`. Why: only
  the gated flow (gate, independent review, signed verdict) may put a
  tag on npm. Runbook: `plugins/cool-workflow/docs/release-tooling.7.md`.
- **A read-only or low-effort release review.** The independent reviewer
  must run EXECUTE-capable; never trust a read-only/low-effort verdict.
  Why: a reviewer that cannot run the gate it judges makes up a REJECTED
  verdict (the v0.1.97 codex case: two REJECTs in under 65 s against a
  gate of about 12 minutes). Review intent goes through as
  `CW_RELEASE_REVIEW=1`; the wrapper raises effort and opens the sandbox
  to workspace-write.

### Context packs and agent output

- **One PR for `.jsonl` slimming, god-object refactors and line-count
  cuts.** Do not treat them as the same task. Why: they have different
  risk profiles.
- **A file left out of an AI context pack with no record.** Do not
  silently omit files; each one needs a manifest entry with reason, size,
  line count, and digest. Why: a reader cannot see what is not there.
- **Live agent output on by default.** Do not make live agent output
  default behavior on an existing wrapper or drive path. Stream-json
  rendering must be explicit opt-in (`CW_AGENT_STREAM=1`), TTY-gated, and
  still silent when piped. Why: default stdout/stderr bytes are a POLA
  contract.
- **One more context or cache mechanism.** Map, Assess, Verify and
  Verdict have opt-in result cache use; do not add another context or
  cache mechanism without new measured need. Use narrow source profiles
  first.

### `cw ledger` and other digests

- **A field left out of a digest with no binding check.** A
  content-addressed `id` must be bound to content on the verify path:
  `id` is left out of the digest, so `verifyLedgerEntry` must check
  `id === deriveId(digest)` and fail closed (`ledger-id-mismatch`). Why:
  any field left out of a digest can be changed unseen unless it has its
  own binding check.
- **A merge step for ledger mirrors.** Multi-mirror union is
  conflict-free by construction, because entries are immutable and
  content-addressed, so a union is a set-union, not a merge.
- **Derived state from unverified entries.** Only verified entries may
  drive derived state; the inbox `resolution` takes no note of unverified
  entries. Why: a tampered review could then resolve a proposal; it has
  to stay `pending` (fail closed).
- **A kernel that picks a winner.** Report, do not adjudicate — mechanism,
  not policy: the ledger reports a `contested` proposal when reviews do
  not agree. Every new field must be used by a real code path and asserted
  by a test that fails if the impl is reverted (not a `typeof` check).

### Naming and POLA

- **A new verb with a name already used.** Check for an existing verb
  before naming a new one; grep the command surface first. Why: `cw
  handoff` already existed (run/task ownership transfer; removed with the
  multi-agent family on 2026-09-28), so the cross-agent primitive had to
  be a NEW verb, `cw ledger`.
- **Output that changes or takes away a key.** Extend output additively:
  new JSON keys are POLA-safe; changing or removing existing keys is not.
  Guard the byte-identical default with a POLA assertion in the smoke
  (for one, a single `--dir` keeps `dir`, not `dirs`).

### Gates and repo mechanics

- **A new smoke with no index line.** Tests are auto-discovered from
  `test/*-smoke.mjs` by `run-all.mjs`, but a new smoke adds a line to the
  smoke list in `plugins/cool-workflow/docs/project-index.md`, so run
  `npm run sync:project-index` or `index:check` fails. The index keeps no
  date and no counts (2026-11-02). Why: a line that every PR rewrites made
  any two open PRs conflict; the lists are sorted, so two new smokes add
  two separate lines.
- **A unit test out of place.** Unit tests sit in folders that mirror
  `src/` (a test of `src/core/state/run-paths.ts` goes in
  `test/core/state/`); smokes stay flat at the top of `test/`.
  `test/test-layout-smoke.mjs` holds this shape.
- **A ratchet gain not locked.** `test/perf-ratchet-smoke.mjs` fails when
  a count in `scripts/bench/perf-ceilings.json` (modules loaded, state
  reads, whole-state JSON round trips, fsyncs, git processes) goes up, and
  also when it goes down: lock a gain by lowering the ceiling in the same
  diff (`node scripts/bench/perf-counts.mjs --update`, which never raises
  one). Why: CW's own work is held by this count ratchet.
- **A copied helper.** A pure helper of twenty lines or less that three
  files need lives once in `src/core/util/`; a copy is a bug. Today that
  is `cli-args.ts` (with `findProgram`, the one PATH walk) and
  `collate.ts` (`compareBytes`, `formatCounts`), modules every command
  already loads, so sharing adds no module load (a new module would raise
  the ratchet above). Copies whose bodies differ in what they do stay
  apart. `test/core/util/cli-args-sharedhelpers.test.mjs`,
  `cli-args-findprogram.test.mjs` and
  `test/core/pipeline/drivedecide-moved-from-drive.test.mjs` hold the
  merged ones to one home. Test set-up has the same rule: scratch folders,
  agent env, stub agents and the `cw` runner live once in `test/helpers/`.
- **A file moved between the two docs trees without a check.**
  `plugins/cool-workflow/docs/` is the shipped man-page tree:
  `sync-project-index.mjs` indexes it (non-recursively — one directory
  level only), and it is in `package.json`'s npm `files` allowlist, so it
  ships to every `npm`/`brew` install. `plugins/cool-workflow/project/docs/`
  (moved from repo-root `docs/` in the root consolidation, 2026-08-04) is
  repo-internal engineering material — audits, the v2 rebuild SPEC, the
  wiki mirror, benchmark notes — outside the `files` allowlist (so it
  never ships) and outside the project-index scan (so it never inflates
  the doc count). Do not move a file between these trees without checking
  both consequences.
- **Moving `v2/` into the package.** `v2/` stays at the repo root,
  deliberately. Every other movable root directory was folded into
  `plugins/cool-workflow/` in the 2026-08-04 root consolidation, but
  `v2/conformance/` (the black-box CLI conformance suite CI runs on every
  PR) was kept as a sibling of the package it judges. Its own README
  states the suite must "never share code with the thing it judges" —
  nesting it inside the package would leave only `package.json`'s `files`
  allowlist standing between it and being shipped, and would blur an
  arm's-length relationship that is now structural (a directory boundary),
  not just a convention. Do not move it without re-litigating this
  tradeoff.
- **A root entry with no reason.** Every root entry is named, with its
  reason, in `ROOT_ENTRIES` in
  `plugins/cool-workflow/test/root-layout-smoke.mjs`; a new root file is
  added there in the same diff. The same smoke holds the `.editorconfig`
  text style (LF, a final newline, no tab indents) outside the byte-exact
  paths.
- **A behavior change with no man-page change.** Man-page sync is
  binding: a shipped behavior change must update the matching
  `docs/*.7.md` in the same diff, or the reviewer rejects it.
- **Deleting an "unreferenced" file on a grep alone.** A reference grep
  does not find every pin: a file can be pinned by CONTENT (a test doing
  `readFileSync` + assert on it) or by a runtime path convention
  (`cw man <topic>` serves `docs/<topic>.7.md`). Before deleting
  "unreferenced" files, run the FULL suite against the committed head;
  that is the real net.

### Multi-agent work

- **A new MCP server or policy layer for agents working together.** First
  try the parts CW already has: workflow apps give the work shape, worker
  output gives checked facts, each phase reads the results of the phase
  before it, MCP gives tool access to the same run state, `cw ledger`
  hands work between agents in two repos, and smoke tests prove the loop.
  Do not make a new MCP server when the existing server can show the same
  run state; add a workflow app first, then prove it with one smoke that
  uses both CLI and MCP.
- **A three-agent loop out of order.** Keep the order plain: `plan ->
  build -> audit -> next action`, one phase each. If audit evidence is
  missing, let the worker evidence gate refuse the result instead of
  adding a new policy layer.
- **The blackboard coming back.** The blackboard, the multi-agent runtime,
  and the `pdca-blackboard-loop` app were removed on 2026-09-28
  (slim-and-esm step 2, decision D1); do not bring them back as a
  shared-state layer without a new intent and the operator's yes.

### Git and branches

- **A push to `main`.** `git push` never goes to `main` directly (the
  HARD RULE in `AGENTS.md`): feature branch → PR → review → merge. A
  release cut pushes only the tag; the verdict record reaches `main`
  through a PR.
- **Mixed changes in one PR.** Keep distinct changes on distinct branches
  and PRs. Why: mixing a docs change, a code feature, and a lessons update
  muddies the story.
- **Running `npm run sync:readme` in a cloud sandbox.** Never do it: it
  would bake the sandbox's `127.0.0.1` proxy host into the committed
  README. Leave README sync to CI.

## Traps that are not faults

- **`readme-sync-smoke` red only in a cloud sandbox.** Outbound git may be
  rewritten through a `127.0.0.1` proxy there; that host gets into the
  *expected* README URL, so `readme:check` / `readme-sync-smoke` (and the
  dogfood release-cut verdict that follows from it) fail ONLY in the
  sandbox and are green in CI. A run whose lone failure is
  `readme-sync-smoke` is this, not a regression.
- **"stale info" on `--force-with-lease` after a merge.** The remote branch
  was auto-deleted when its PR merged. `git remote prune origin`, then a
  normal push; when a branch's PR has already merged, restart it from the
  default branch: `git checkout -B <branch> origin/main`.
- **403 from a repo-scoped cloud session.** It cannot reach outside its
  scope; cross-repo calls return 403. Shared-repo creation and scoping are
  operator web-UI steps.
- **Operator machine (macOS).** Interactive zsh does not take `#` as a
  comment, so give the operator comment-free command blocks. `npm i -g .`
  can put `cw` into a shadowed prefix; `npm i -g cool-workflow@latest` is
  the reliable path. git credentials use the osxkeychain helper; a token
  added once is used again.
