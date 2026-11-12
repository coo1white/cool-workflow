# Durable State & Locking

Every write CW makes to run state is **atomic**; the authoritative ones are
also **fsync-durable**; and the stores more than one process can change are
**lock-serialized**. A run is driven by one process at a time.

## Atomic writes — order is the safety property

`writeJson(file, value, { durable? })` (`src/shell/fs-atomic.ts`) writes to a
unique temp file in the same folder and then `rename(2)`s it over the target.
Because rename is atomic on POSIX, a crash, `SIGKILL`, or `ENOSPC` part-way
through a write can never leave a cut-short `state.json` that throws `Invalid
JSON` on reload — a reader always sees **EITHER the old bytes OR the new
bytes**, never a torn file.

With `{ durable: true }` the temp file is also `fsync`'d before the rename, so
the bytes live through power loss. Durability is kept for **authoritative**
state — `state.json` and the telemetry ledger (`telemetry.json`) — while
rebuildable writes (worker manifests, the report) stay atomic but not
fsync'd.

## Locking

Two locks, both a `<target>.lock` file that holds the owner's pid:

- **The drive lock** (`.cw/runs/<run-id>/drive.lock`). `cw -q` and `cw
  --resume` hold it for the whole drive. A second process that tries to drive
  the same run is refused at once with the holder's pid; it never waits and
  never writes.
- **`withFileLock(target, fn)`** runs `fn` while it holds `<target>.lock`,
  waiting up to about 6 s. The telemetry ledger's append goes through it, so
  two writers cannot both read the same tail and drop a record. It is
  re-entrant inside one process.

A lock is taken with `link(2)` (a per-try temp file hard-linked onto the lock
path): `link` is single-winner, where `open(O_EXCL)` was seen not to be on
Node 18 under load. A lock whose holder pid is gone is taken over, but only by
the single winner of a `<lock>.steal` guard, which reads the pid again before
it renames its own file over the lock (`test/fs-atomic-lock-steal-race-smoke.mjs`
holds this: no two processes are ever inside the lock at once).

## Run paths come from where the run is

A run's `state.json` is data, not a list of places to write. Each load makes
the run's `paths` again from the folder it was found in
(`.cw/runs/<run-id>/`), so a `state.json` that names another folder cannot
send a write out of its run folder. A run id must be one safe path segment
(no `/`, no `..`); anything else is refused. A `state.json` from before batch
5 (schema 1), or one whose `id` is not its folder's name, is refused with one
line; CW never migrates or repairs state.

## Compatibility

Batch 5 (2026-11-12) removed the run registry, the home queue, the archive and
repos overlays, the whole-cycle run-state lock for operator verbs (there are
no operator verbs left that write a run), and state migrations. See
release-and-migration(7), "Removed in batch 5".

These changes alter only HOW bytes are written, never WHAT.

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any sensible agent shape (alt keys + prose), CW works out grounded evidence itself, warn on empty capture — fixes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now validate the committed blob (`git show HEAD:<path>`) instead of the changeable working tree — getting rid of false-red/false-green from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, wrapper metrics you can measure, and userland model policy flags for routing fast/strong workers without changing the full review contract.

## Deterministic Tombstone Hash (v0.1.81)

The reclamation tombstone's freed-manifest was path-sorted before it fed `tombstoneHash` (reclamation was removed on 2026-11-12). v0.1.81 also adds import-time refusal (`CW_REQUIRE_ARCHIVE_INTEGRITY=1`) and restore-time trust-audit re-proving — see run-registry-control-plane(7).
_No changes in v0.1.82._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

_No behavioral change in v0.1.88 (atomic writes, fsync-durability for audit-essential state, and lock-serialized cross-process stores are unchanged; the in-place `appendRunNode` optimization keeps `writeRunNode` and the persisted bytes identical)._

## 0.1.89 (v0.1.89)

_No behavioral change in v0.1.89 (CLI-surface golden-path + help-output fixes only; this subsystem is unchanged)._

0.1.90

0.1.91

0.1.93

0.1.94

0.1.95

0.1.96

0.1.97

0.1.98

0.2.0

0.2.1

0.2.2

0.2.3

0.2.4

0.2.5

0.2.6

0.2.7

0.2.8

0.3.0

0.3.1

0.3.2

0.3.3

0.4.0

0.4.1

0.4.2

0.4.3

0.4.4
