# Stop re-reading what the drive just wrote: state loads in the drive loop

Intent, spec and plan in ONE file, in the shape `AGENTS.md` "Intent
files (the playbook)" asks for, in the AI-native SDLC playbook's order
(intent -> spec -> plan -> build -> test -> review -> maintain). Source:
the operator, 2026-09-26, "approve" on the next goal named at the close
of the perf-ratchets program (`intent/2026-09-archive.md`, the
perf-ratchets part): cut the N-squared cost of the whole-state rewrite,
by an append-only state journal if that is the right tool. The measured
facts below say it is not; this file says why, and puts a smaller,
POLA-safe program in its place. The operator decides at the approval
gate which one runs.

## Part 1 — Intent

**Problem.** With N workers, CW's own time grows as N squared because
every drive step moves the whole `state.json`. After the perf-ratchets
program, the whole-state work at 64 workers is about 1.37 s of about
2.8 s of CW's own time: 0.96 s to write it (`saveCheckpoint`) and
0.41 s to read it back (`loadRunFromCwd`).

**Outcome.** The drive stops reading back from disk what it has just
written itself. Loads go down to the ones that can see a change made by
another process. No output byte, file layout, exit code or record
changes (POLA); `state.json` stays the single source of truth, current
after every save, as the docs promise.

**Who it touches.** Every `cw -q`, `cw run <app> --drive` and resume
user. Code: `src/shell/drive.ts` (the round cache and the progress
line), `src/shell/run-store.ts` (a file stamp after each save), `dist/`,
tests, the ratchet ceilings.

**North Star.** Track A (CW's part of the wait) and Track B (a resume
pays the same per-step cost again).

## Measured facts (checked by command before design)

On `main` at `a2cd113`, Linux, Node 22, built `dist/`, the perf-ratchets
fan app (N workers in one serial phase, a stub agent that writes its
result at once). Time is split by a `--require` hook that times each
fs call and each `JSON.parse`/`JSON.stringify` over 20 KB and groups it
by caller from the stack.

- Whole-state time per drive, by N (write bucket = `saveCheckpoint`'s
  stringify, write, fsync, open, rename; read bucket = the load path's
  read and parse), against the trust-audit append bucket:

  | N | state write | state read | trust-audit | CW self |
  |---|---|---|---|---|
  | 16 | 103 ms | 30 ms | 177 ms | 696 ms |
  | 32 | 279 ms | 104 ms | 381 ms | 1361 ms |
  | 64 | 961 ms | 412 ms | 790 ms | 2804 ms |

  State write and read grow about 3x per doubling (N squared); the
  audit bucket grows 2x (linear).
- At N=64, the write bucket: 131 stringifies of the whole state
  (365 ms, 137 MB), 262 writes (250 ms), 262 fsyncs (260 ms, file and
  directory), opens and renames (74 ms). The read bucket: 132 reads
  (140 ms) and 132 parses (272 ms, 140 MB).
- On one 977 KB state (N=32): `JSON.parse` 1.6 ms, `JSON.stringify`
  (2-space, the committed byte form) 2.4 ms, a full deep diff of two
  states 2.6 ms, `structuredClone` 3.3 ms, `writeFileSync` without fsync
  0.5 ms, `readFileSync` 0.8 ms.
- Where the reads come from, N=16 (`drive.stateReads` = 36, by call
  site): 17 are the round-cache seed at the start of each round
  (`withRoundCache`, `src/shell/drive.ts`); 17 are
  `emitPhaseProgress(loadRun(ctx))` in `driveOneRound`, which runs
  just AFTER the round cache is cleared, so it re-reads and re-parses
  the file the round has just saved, only to print a stderr progress
  line; 2 are the start and the final result.
- The disk is not the only writer. `cw worker`, `cw feedback`, audit,
  candidate, orchestrator and MCP mutations write `state.json` under
  `withRunStateLock`, not the drive lock; a real agent may call them
  while the drive waits on it. Every write is tmp + rename, so each one
  gives the file a new inode.
- What pins the current shape: "`state.json` is the SINGLE source of
  truth" (`docs/run-registry-control-plane.7.md`,
  `docs/web-desktop-workbench.7.md` and more man pages);
  `docs/durable-state-and-locking.7.md` ("old bytes OR new bytes");
  v2 conformance `state-json-bytes` (exact 2-space JSON); the SIGKILL
  smokes, which read raw `state.json` right after a kill and need the
  dispatch in it; three conformance cases that scan its raw text;
  `test/drive-round-cache-serial-smoke.js`, which pins the serial
  read count; `test/deferred-checkpoint-batching-smoke.js`, which pins
  the save count.
- md count: 134/135 before this file; this file makes 135.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- **Append-only state journal, on by default** (a base `state.json`
  plus one delta file per step, folded at the end): turned down. It
  breaks the single-source-of-truth promise in several man pages, the
  SIGKILL smokes (raw `state.json` after a kill would miss the
  dispatch) and the raw-text conformance cases, and the export packs
  every file in the run dir, so a journal file changes the export
  digest. A POLA break of this size needs a migration, a conformance
  rewrite and a new man page.
- **The same journal, opt-in** (`CW_STATE_JOURNAL=1`, folded into an
  identical `state.json` at every drive exit): turned down on cost.
  Nothing in the code says what a step changed, so a delta has to be
  found by a diff against a copy of the last save: 3.3 ms (copy) +
  2.6 ms (diff) per save, against 2.4 ms (stringify) + 0.5 ms (write)
  today. The CPU cost goes UP; only the bytes written and the fsync
  size go down. A journal that wins needs every writer to say what it
  changed: 17 writer files, six of them frozen surfaces
  (`candidate-scoring-io.ts`, `multi-agent-cli.ts`,
  `collaboration-io.ts`, `orchestrator.ts`, `telemetry-demo.ts`,
  `state-explosion-cli.ts`). That is its own program with its own
  intent, if the write side still matters after this one.
- **Fewer saves per step** (join the dispatch save into the accept
  save): turned down. A crash between them loses the dispatch, which
  the SIGKILL smokes and Track B's resume promise rely on.
- **Chosen: stop the reads that can only return what this process just
  wrote.** Two steps. (1) The progress line uses the run the round
  already holds. (2) The next round seeds from the run the last round
  saved when the file is exactly the one this process wrote (same
  device, inode, size, mtime and ctime, from a `bigint` stat taken
  right after the save); anything else, including any other writer,
  reads from disk as today. No new file, no format change, easy to
  undo (two small diffs).

## Part 2 — Spec

### Journeys and target

| Id | Journey | Now | Target |
|---|---|---|---|
| J4 | Drive step: `cw -q` / `cw run <app> --drive` / resume | state read bucket 412 ms at N=64; `drive.stateReads` 36 at N=16 | `drive.stateReads` at most 4; state read bucket under 60 ms at N=64; CW self at N=64 at least 10% lower, paired |

The write bucket (0.96 s at N=64) is not in this program's target; the
program's close records what is left of it.

### Rules

- A reused run must be deep-equal to what a fresh load would return at
  the same point. The check is a test-only switch
  (`CW_STATE_REUSE_VERIFY=1`, read only by the drive): on every reuse it
  also loads from disk and throws on any difference. The full smoke
  suite and the conformance suite run once with it on, in the PR that
  adds reuse.
- Any change to the file stamp (another writer, a hand edit, a restore)
  means a load from disk, as today. No stamp (the stat fails) means a
  load from disk. The reuse never crosses a drive-lock boundary: a new
  `drive()` call always seeds from disk.
- Byte-identical: the pinned stub drives (the fan app and
  `architecture-review`) give the same run folders on `main` and on
  each PR, and stderr progress lines are the same.
- The ratchet: `drive.stateReads` and `drive.stateRoundTrips` go down
  and their ceilings go down in the same diff; no other count moves.

## Part 3 — Plan (one PR each, in this order)

### PR 1 — The progress line uses the round's run (runtime)

Files: `src/shell/drive.ts`, `dist/`, a test, the ceilings.

1. `driveOneRound` hands the run its round already holds to
   `emitPhaseProgress` instead of `loadRun(ctx)` after the round cache
   is gone. Where the round left changes it had not saved yet, the
   test below catches a different line.
2. Test: the progress lines on stderr are the same (a TTY-forced
   drive), and `drive.stateReads` falls by one per round (36 -> 19 at
   N=16). `test/drive-round-cache-serial-smoke.js`'s read count moves
   with it, with the reason in the diff.

### PR 2 — Seed the next round from the last save (runtime)

Files: `src/shell/run-store.ts` (a stamp after each `saveCheckpoint`),
`src/shell/drive.ts` (`withRoundCache` seeds from the last saved run
when the stamp still matches), `dist/`, tests, the ceilings.

1. `saveCheckpoint` records, per state path, the `bigint` stat of the
   file it just renamed into place and the run object it wrote.
   `withRoundCache` reuses that object only when a fresh `bigint` stat
   matches all five fields; else it loads from disk.
2. Tests: another process writes between two rounds (`cw worker ...`
   from a stub agent) and the drive sees its change; a hand edit of
   the same size is seen; `CW_STATE_REUSE_VERIFY=1` over the full smoke
   and conformance suites finds no difference.
3. Expected: `drive.stateReads` 19 -> at most 4 at N=16; the read
   bucket at N=64 from 412 ms to under 60 ms.

### PR 3 — Closing ledger (docs)

1. A receipt at `project/docs/audits/state-reads-receipt-<date>.json`:
   counts, the bucket table before and after, the paired N=64 result,
   the byte-identical and reuse-verify results.
2. Fill the sections below and the status ledger; move this file into
   `intent/2026-09-archive.md`.
3. Leading measures: time from this intent to its first build PR, and
   first-pass CI of the program's PRs.

## Rules for every PR in this program

- One goal per PR. Counts go down, never up. No output, JSON, exit
  code, file layout or record change; a change that needs one stops
  and goes back to the operator as a new intent.
- Local checks before every push: build, `dist:check`, the unit tests,
  the full smoke gate, `release:check --skip-tests` (the onramp
  contract lives there), `perf-counts --check`.
- Frozen surfaces are not touched.

## Acceptance

- Manager (per PR): CI green, counts at or below the ceilings,
  byte-identical diff clean, body complete.
- Architect (program): `drive.stateReads` at most 4 at N=16; the state
  read bucket under 60 ms at N=64; CW self at N=64 at least 10% lower
  than `main` at `a2cd113`, over 9 alternating pairs; nothing a person
  or script reads has changed.

## Architecture snapshot diff (claims this program makes stale)

(Filled by the closing PR.)

## What this spec got wrong (recorded at close)

(Filled by the closing PR.)

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec + plan (this file) | open | |
| PR 1 — progress line uses the round's run | | |
| PR 2 — seed the next round from the last save | | |
| PR 3 — closing ledger | | |
