# Write state.json from kept parts: the whole-state write, cut safely

Intent, spec and plan in ONE file, in the shape `AGENTS.md` "Intent
files (the playbook)" asks for, in the AI-native SDLC playbook's order.
Source: the operator, 2026-09-26: "做，auto-develop" on the whole-state
write, then, on the decision the state-writes record asked for (the
state-writes part of `intent/2026-09-archive.md`), the choice "records
immutable + cache". Auto-develop means the operator approved the gates
of this program ahead of time; this file is the record of what was
approved. The measurement below found a safer form of that choice: the
cache checks each element instead of freezing records, so no frozen
surface is edited and nothing new can throw.

## Part 1 — Intent

**Problem.** Every checkpoint turns the whole run into one 2-space JSON
string and writes it: 131 saves at 64 workers, about 0.6 s of stringify
and write. Most of each save is text that has not changed since the save
before.

**Outcome.** A save builds state.json from parts, and an array element
whose content has not changed reuses the bytes it had. The file is
byte-identical to today's, save after save; less CW time.

**Who it touches.** Every drive and every other `saveCheckpoint` caller.
Code: `src/shell/run-store.ts` (the serializer), `src/shell/fs-atomic.ts`
(a parts write), `dist/`, a unit test, the ratchet ceilings.

**North Star.** Track A (CW's part of the wait) and Track B (each resume
pays the same per-save cost).

## Measured facts (checked by command before the build PR)

On `main` at `8ee7d35`/`2ebcebb`, Linux, Node 22, built `dist/`, the perf
fan app (a stub agent), and one 1938 KB state from a 64-worker drive.

- A walk that checks an element against a kept snapshot (the same
  objects, the same keys in the same order, every value `===`) costs
  0.52 ms for all 712 array elements with `for...in` (1.38 ms with
  `Object.keys`); stringifying the same elements costs 2.73 ms.
- A first build that joined the kept texts into one string was slower
  than today (CW self at 64 workers 2204 -> 2352 ms, 9 pairs): joining
  1.9 MB of kept strings costs 3.7 ms against 5.5 ms for the native
  stringify, so the saving was eaten by the copy. Building the file
  from parts and writing them with `writev`, never joined, costs 0.85 ms
  against 6.55 ms for stringify plus `writeFileSync`.
- That parts build, with kept encoded bytes per element: CW self time
  over 9 alternating pairs, 64 workers 2216 -> 1852 ms (-16.4%), 16
  workers 528 -> 479 ms (-9.3%). In the save profile at 64 workers the
  384 ms of stringify is gone and the file write drops from 207 ms to
  under 60 ms.
- With the check against `JSON.stringify` forced on in `dist/` (not
  committed), the full smoke gate and the v2 conformance suite made 2444
  saves; every one was byte-identical.
- In-place edits that a freezing design would have to forbid do happen:
  `runReclamation` (`src/shell/reclamation-io.ts`, frozen) re-points a
  node, and tests edit workers (the state-writes record). The check
  turns each of them into a miss (that element is stringified again),
  not an error and not a stale byte.

## Paths weighed (complexity / upkeep / cost / can it be undone)

- **Freeze records when made, then cache:** what the operator chose.
  Turned down in favor of the checked cache: freezing needs
  `reclamation-io.ts` (frozen) changed and turns any in-place edit on an
  untested path into a thrown error; the check gives the same saving
  with neither.
- **Cache and join into one string:** built and measured slower (above).
- **Opt-in compact JSON; a schema bump that stores each sandbox policy
  once:** still open in `BACKLOG.md`; not needed for this saving.
- **Chosen:** keep, per array element, its encoded JSON text and a
  snapshot of its values; reuse the bytes only when the walk finds the
  element unchanged; write the file from parts with `writev`.

## Part 2 — Spec

- Byte-identical, always: the file is `JSON.stringify(run, null, 2)`
  and a newline after every save, whatever was edited in between, in
  place or not. An element holding anything JSON treats specially (a
  Date, NaN, a class instance, an array hole) is never kept.
- A short `writev` resumes where it stopped; no byte is lost or moved.
- `CW_STATE_WRITE_VERIFY=1` (tests only) makes `saveCheckpoint` compare
  with `JSON.stringify` and throw on any difference.
- The atomic write contract is unchanged: temp file, fsync, rename,
  directory fsync.
- The ratchet: `drive.stateRoundTrips` counts whole-state
  `JSON.stringify` and parse calls; a save no longer makes one, so it
  falls from 38 to 3 (the loads). The save's work is now measured by
  time, above, and the element walk.

## Part 3 — Plan

- **PR 1 (build):** `serializeRunState`/`runStateParts` and the element
  cache in `run-store.ts`, `writePartsDurable` in `fs-atomic.ts`,
  `saveCheckpoint` writes the parts; the unit test
  `test/shell/run-state-serializer.test.js` (every fixture state and
  every kind of edit, byte-for-byte against `JSON.stringify`; the saved
  file; short writes; the verify switch's teeth); the ceiling.
- **PR 2 (close):** receipt, the sections below, archive; the
  `BACKLOG.md` row for the whole-state write updated.

## Acceptance

- CW self at 64 workers at least 10% lower than `main` over 9
  alternating pairs; every save byte-identical under the forced check
  over the full smoke gate and the v2 conformance suite; the unit test
  fails with the unchanged-check or the short-write loop taken out.

## Architecture snapshot diff (claims this program makes stale)

(Filled by the closing PR.)

## What this spec got wrong (recorded at close)

(Filled by the closing PR.)

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent + spec + plan (this file) | open | |
| PR 1 — write state.json from kept parts | | |
| PR 2 — closing ledger | | |
