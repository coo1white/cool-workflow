# Measure it, then make it faster: count ratchets for CW's own time

Intent, spec and plan in ONE file, in the shape `AGENTS.md` "Intent
files (the playbook)" asks for. The three parts follow the AI-native
SDLC playbook (intent -> spec -> plan -> build -> test -> review ->
maintain). Source: the operator, 2026-09-26: make CW faster in its
design and its run time, using the method in "How we made claude.ai 3x
faster in two weeks" (2026-09-23), through the playbook's steps.

The one idea taken from that post: once a number can be counted
without noise, it can be pushed down, and a CI check can stop it from
going back up. Wall-clock time is what a person feels, but it is too
noisy to gate CI on. Counts (modules loaded, state reads, full-state
JSON round trips, fsyncs, git processes) are the same on every run.
So: count, prove the count follows wall-clock time, push it down, then
lock it with a ratchet.

## Part 1 — Intent

**Problem.** CW's own work (not the agent's) grows faster than the
work it does. For each worker step, a drive reads the whole
`state.json`, parses it, copies it with a second stringify and parse,
changes it, and writes the whole file back with fsync. It also starts a
`git rev-parse HEAD` process twice per worker. With N workers the bytes
moved grow as N squared. With a stub agent that takes no time, CW's
own time is most of the wall time: 0.3 s at 4 workers, 3.4 s at 64.

**Outcome.** CW's own time per drive step goes down, and stays down:
every gain is locked by a count that CI checks on every PR. No output
byte, file layout, exit code or record changes (POLA). A person sees
the same run, sooner.

**Who and what it touches.** Every `cw -q`, `cw run <app> --drive` and
`cw --resume` user; the MCP server (a long-lived process whose event
loop these sync reads and writes block). Code: `src/shell/run-store.ts`,
`src/core/state/migrations.ts`, `src/shell/commit.ts`, the cold-start
imports of `src/cli/`, and new bench files under `scripts/bench/` and
`test/`.

**North Star.** Track A (the 5-minute demo: CW's part of the wait) and
Track B (long runs and resume: the N-squared cost is paid again on
every resume).

## Measured facts (checked by command before design)

All on this repo at `383c69a`, Linux, Node 22, built `dist/`, a stub
agent that writes its result at once (the recipe in
`test/cli-progress-summary-smoke.js`). Timing is the median of 5-15
runs; counts come from a `--require` hook that wraps `fs`,
`child_process` and `JSON`.

- The node floor is `node -e 0`: p50 27 ms. Cold journeys, p50:
  `cw version` 47 ms (30 CW modules, 398 KB), `cw help` 46 ms,
  `cw` 49 ms, `cw doctor` 72 ms (45 modules), `cw app list` 68 ms
  (46), `cw demo tamper` 73 ms (44), `cw status` with no run 104 ms
  (92 modules, 1.45 MB, to print a 4-line "No run selected"). MCP
  `initialize`: 56 ms; `tools/list` (201 tools, 104 KB): 2.7 ms.
- `cw -q` on a 2-file repo with `architecture-review` (14 workers):
  p50 694 ms; agent wait 245 ms (from the existing
  `CW_BENCH_TRACE_FILE` trace, `src/shell/perf-trace.ts`), so CW's own
  time is about 450 ms. In that one run: `state.json` read 13 times
  (4.2 MB), `audit/events.jsonl` read whole 16 times (3.2 MB), 26 JSON
  parses and 26 stringifies over 20 KB (7.4 MB and 6.5 MB).
  `state.json` ends at 431 KB for two source files; one sandbox policy
  (2.6 KB) is copied into every node, every worker and every audit
  event.
- Scale test, an app with N workers in one serial phase (stub agent):

  | N | wall | agent wait | CW self | durable writes | bytes written | state.json |
  |---|---|---|---|---|---|---|
  | 4 | 425 ms | 119 ms | 306 ms | 47 | 1.0 MB | 137 KB |
  | 8 | 653 ms | 236 ms | 417 ms | 87 | 3.0 MB | 256 KB |
  | 16 | 1198 ms | 473 ms | 725 ms | 167 | 10.1 MB | 496 KB |
  | 32 | 2380 ms | 974 ms | 1405 ms | 327 | 36.9 MB | 977 KB |
  | 64 | 5247 ms | 1907 ms | 3340 ms | 647 | 140.7 MB | 1938 KB |

  Bytes written go up about 3.8x each time N doubles: N squared.
- At N=64, what calls the big JSON work (over 100 KB each): 132
  `readJson` parses of `state.json` (140 MB); 130 `saveCheckpoint`
  stringifies (137 MB); and 130 stringify + 130 parse (107.5 MB each)
  in `clone()` at `src/core/state/migrations.ts` — `migrateRunState`
  deep-copies an object that `readJson` has just parsed and nothing
  else holds.
- At N=64 a CPU profile of CW's own time (about 3.4 s): the load-time
  `clone` 426 ms; 130 `git rev-parse HEAD` processes from
  `readGitHead` in `src/shell/commit.ts` (2.6 ms each, about 340 ms);
  `open` 740 ms and `fsync` 528 ms (846 fsyncs, 1614 renames);
  stringify in `writeJson` 422 ms; parse in `readJson` 261 ms.
- Proof by experiment (not a guess): skipping only the load-time clone
  in a scratch copy of `dist/` took CW self time at N=64 from 3711 /
  3912 ms to 3482 / 3397 ms (two paired runs, -6% to -13%); at N=16 the
  change is inside the noise. This is why the gate is on counts, not
  on milliseconds.
- What is there already: `src/shell/perf-trace.ts` (opt-in group
  timings and durable-write counts), `scripts/bench/run.js` (a k6 +
  stub-agent bench, not in CI), and a round cache in
  `src/shell/drive.ts` that already serves loads from memory inside a
  concurrent round. Nothing in CI checks a count or a time.
- md count: 134/135 before this file; this file makes 135. The
  closing PR moves it into `intent/2026-09-archive.md`.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- **Gate on wall-clock ms in CI**: simple, but the scale test above
  moves ±10% between identical runs; a gate on it is either flaky or
  too loose to catch anything. Turned down.
- **Instruction counts under Valgrind (`node --predictable`)**, as the
  post did: exact, but a 700 ms run takes minutes under Valgrind, and
  CI runners do not have it. Kept for local proofs only.
- **Counts of the costly things (chosen)**: modules loaded, state
  reads, full-state JSON round trips, durable writes, fsyncs, git
  processes. Cheap (one stub drive, about 1.5 s), exact, and each one
  is proved to follow wall-clock time before it becomes a gate. Easy
  to undo: one smoke and one JSON file.
- **Fix N squared at the root with an append-only state journal**
  (a base file plus one delta per step): the biggest gain, but it
  changes the `state.json` layout, the replay record and every reader
  — a POLA break that needs its own intent, a migration, and a Track B
  proof. Not in this program; logged as the next step if the ratchets
  show the remaining cost is still the full rewrite.
- **Fewer checkpoints per step** (join saves): fewer fsyncs, but a
  crash then loses more steps. That changes recovery, which Track B
  promises. Not in this program.

## Part 2 — Spec

### The journeys (what a person waits on)

| Id | Journey | Now | Target |
|---|---|---|---|
| J1 | `cw` / `cw help` / `cw version` cold start | 46-49 ms, 30 modules | fewer modules; ratchet on count |
| J2 | `cw doctor`, `cw app list`, `cw demo tamper`, `cw status` (no run) | 68-104 ms, 44-92 modules | `status` with no run: fewer than half its modules |
| J3 | MCP `initialize` + `tools/list` | 56 ms + 2.7 ms | ratchet on modules only |
| J4 | Drive step: `cw -q` / `cw run <app> --drive` / resume | CW self 3.4 s at N=64 | -20% CW self at N=64, and a lower count for every row below |

### The counts (the ratchet)

One stub drive of a fixture app with 16 workers in one serial phase,
plus one cold call of each J1-J3 command. The counts are:

- `modules.<journey>`: CW files loaded (a `Module._extensions` hook).
- `drive.stateReads`: reads of `state.json`.
- `drive.stateRoundTrips`: JSON stringify or parse of a whole run
  state (an object or text with `workflow`, `paths` and `nodes`) —
  size-free, so the path length of the temp dir does not change it.
- `drive.durableWrites`, `drive.fsyncs`, `drive.renames`.
- `drive.gitProcesses`: `git` child processes CW starts.

Rules: a count may never go up (CI fails). A PR that makes a count go
down must lower its ceiling in the same diff (CI fails if the ceiling
is out of date), so every gain shows in review. `--update` writes new
ceilings and refuses to raise one. Each count gets a line in the bench
receipt that shows its wall-clock effect (ms per unit, measured).

### Guardrails (before any speed change lands)

- Tests first: each speed PR adds a test that fails before it (a count
  above the new ceiling) and passes after.
- Byte-identical: each speed PR runs the same pinned stub drive on
  `main` and on the branch (time pinned with
  `scripts/fake-date-for-reproduction.js`, one run id) and diffs the
  run folders: `state.json`, nodes, commits, audit, report — zero
  byte change, or the PR does not merge.
- The full gate, the v2 conformance suite and CodeQL as usual. No
  flag is needed, since no byte a person or script sees changes.

## Part 3 — Plan (one PR each, in this order)

### PR 1 — The bench and the ratchet (tooling + test, no runtime change)

Files: new `scripts/bench/perf-counts.js` (runs the journeys, prints
the counts as JSON; `--update` lowers ceilings), new
`scripts/bench/perf-count-hook.js` (the `--require` hook), new
`scripts/bench/perf-ceilings.json`, new fixture app
`test/fixtures/apps/fan/` (N from the env, default 16), new
`test/perf-ratchet-smoke.js`, `docs/project-index.md` (smoke count).

1. The smoke runs `perf-counts.js`, fails on any count above its
   ceiling and on any ceiling above its count, and has teeth: a
   throwaway ceiling file one below and one above the real count are
   both refused.
2. The PR body carries the "does it follow wall-clock time" proof: for
   each drive count, the ms per unit measured at N=16 and N=64.

### PR 2 — Parse the state once per load (runtime)

Files: `src/core/state/migrations.ts`, `src/shell/run-store.ts`,
`dist/`, a unit test under `test/core/state/`, the ceilings.

1. `migrateRunState` gets an `owned` option: when the caller gives an
   object that nothing else holds (a fresh `readJson`), it migrates in
   place and skips `clone()`. Every other caller keeps the copy.
2. `loadRunStateFile` passes `owned: true`.
3. Expected: `drive.stateRoundTrips` falls by one third (from 3 per
   load-save to 2); CW self at N=64 -0.3 to -0.5 s (measured above).
   Unit test: the caller's object is not touched when `owned` is
   absent, and the result is deep-equal either way.

### PR 3 — Read HEAD without starting git (runtime)

Files: `src/shell/commit.ts` (or a small `src/shell/git-head.ts`),
`dist/`, a unit test, the ceilings.

1. `readGitHead` reads `.git/HEAD` and the loose ref file it names
   directly, and remembers the answer keyed on the size and mtime of
   those files. Anything else — `.git` is a file (worktree), the ref is
   only in `packed-refs`, a stat fails, the text is not a 40-hex sha —
   falls back to `git rev-parse HEAD` as today. Fail closed: never a
   made-up sha; same `undefined` on no repo.
2. Expected: `drive.gitProcesses` from 2 per worker to 0 on a plain
   repo; about -2.6 ms per worker step (-340 ms at N=64). Unit test:
   plain repo, detached HEAD, a commit between two reads, a worktree
   and a packed ref all give the same sha as `git rev-parse HEAD`.

### PR 4 — Cold start: load what the command needs (runtime)

Files: the `src/cli/` and `src/wiring/capability-table/` import sites
the profile names, `dist/`, the ceilings.

1. Turn the top-level imports that `cw status` (no run), `cw help`
   and `cw version` do not use into loads inside the handler that
   needs them (the pattern `loadPipelineCli` in
   `src/wiring/capability-table/pipeline.ts` already uses).
2. Expected: `modules.status-no-run` from 92 to under 46;
   `modules.help` and `modules.version` lower; about -10 to -50 ms per
   cold call. Output bytes unchanged (the v2 conformance suite pins
   them).

### PR 5 — Closing ledger (docs)

1. A receipt at
   `project/docs/audits/perf-ratchets-receipt-<date>.json`: the counts
   and the scale-test table before and after, and the
   byte-identical diff result of each speed PR.
2. Fill the three sections below and the status ledger; move this
   file into `intent/2026-09-archive.md`.
3. The playbook's leading measures, one line each: time from this
   intent to its first build PR, and first-pass CI success rate of the
   program's PRs.

## Rules for every PR in this program

- One goal per PR. A count may go down, never up. No output, JSON,
  exit code, file layout or record changes; if a change needs one, it
  stops and goes back to the operator as a new intent.
- The PR body has: Plan, before/after counts, before/after wall time
  (median of 5 at N=16 and N=64), the byte-identical diff result, the
  test summary.
- Frozen surfaces are not touched (none of the files above is on the
  list).

## Acceptance

- Manager (per PR): CI green, CodeQL green, counts at or below the
  ceilings, byte-identical diff clean, body complete.
- Architect (program): the ratchet is in CI; CW self time at N=64 is
  at least 20% lower than 3340 ms on the same machine; every count is
  at or below its first ceiling; nothing a person or script reads has
  changed.

## Architecture snapshot diff (claims this program makes stale)

(filled by the closing PR)

## What this spec got wrong (recorded at close)

(filled at close)

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec + plan (this file) | open | |
| PR 1 — bench and ratchet | | |
| PR 2 — parse the state once per load | | |
| PR 3 — read HEAD without starting git | | |
| PR 4 — cold start | | |
| PR 5 — closing ledger | | |
