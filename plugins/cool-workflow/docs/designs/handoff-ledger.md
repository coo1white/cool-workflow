# Design — Cross-agent handoff ledger

Status: DRAFT / proposal. Nothing here is built yet. This file ships no
behavior, no new command, no man-page contract, and changes no existing
output. It exists so two people (the operator and the reviewer agent) can
agree on the shape before any code is written.

North Star track: **Track B** (portable, verifiable state — the same
`run export` → `run restore` recovery story, now used as the channel
between two agents).

## Goal

Two agents work on two repositories:

- one agent scoped to repo **A** (for example `cool-workflow`),
- one agent scoped to repo **B** (for example `chime`).

The operator wants them to "share data, review each other, and each be
able to raise a pull request to the other". In plain terms:

- each side can hand the other a **change proposal**, and
- each side can hand the other a **review verdict** on a diff or PR,
- with saved, inspectable, fail-closed state — never a fabricated hand-off.

## The hard constraint (why the obvious design does not work)

The first idea is a shared local folder (for example `~/.chime/handoff/`)
that both agents read and append to. That only works when both agents run
on **one machine** with **one filesystem**.

In the operator's setup the two agents run as **two separate cloud
sessions**. Each session is a fresh, throwaway VM. Two facts follow, and
the design must respect both:

1. **No shared filesystem.** A file the B-agent writes to `~/.chime/handoff/`
   in its VM is invisible to the A-agent's VM, and is gone when the session
   ends. A local folder cannot be the channel.
2. **Single-repo scope.** Each session's GitHub reach is scoped to one repo
   at launch (A-agent → repo A, B-agent → repo B). The A-agent cannot read
   repo B through its GitHub tools, and the reverse is also true. Scope is
   fixed at launch and cannot be widened mid-session.

The only medium both sessions can durably reach is **git / GitHub**. So the
ledger is a set of committed files, not a local folder — and the scope wall
means the hand-off still needs either a shared repo or a human relay for the
cross-repo step. This document is honest about that; it does not pretend the
wall is not there.

## What we reuse (no new trust machinery)

CW already has the parts this needs. The design adds a thin verb layer over
them; it invents no new crypto and no new state format.

- `run export` produces a **verifiable bundle** (file digests, telemetry
  ledger, trust-audit hash chains).
- `run restore` **imports fail-closed**: it inspects first, refuses a corrupt
  or tampered bundle without writing anything, and exits non-zero when the
  chain does not verify. (`run import` is the exit-0 sibling; the hand-off
  path must use the fail-closed `restore` contract.)
- `report verify` checks a run's evidence and citations.

A hand-off entry is therefore just a CW bundle. The receiving side trusts it
the same way it trusts any restored run: by verification, not by good faith.

## Two verbs

Both live under a single new `cw ledger` verb, so the existing surface is
untouched and the new behavior is opt-in (POLA). (The name `handoff` was already
taken by an unrelated collaboration primitive — ownership transfer of a run/task
— so the cross-agent verb is `ledger`, not `handoff`.) Stage 1 ships as
`cw ledger propose|review|verify`; see
[cross-agent-ledger](../cross-agent-ledger.7.md) for the contract.

- **`propose`** — the read-only side writes a structured *change proposal*
  (title, rationale, target files, suggested diff) as a ledger entry. It does
  **not** mutate the other repo. The write-capable side picks the entry up,
  verifies it, and turns it into a **real GitHub pull request**.
- **`review`** — the reviewing side writes a structured *review verdict*
  (`APPROVED` / `REJECTED`, findings, the diff or PR it judged) as a ledger
  entry. The other side surfaces it and can act on it.

This keeps a read-only agent honest: it emits proposals and verdicts as
**data**, and the write-capable side is the only one that opens PRs. Neither
side has to be trusted to have mutated the other's code.

## Transports (how an entry actually crosses)

The verbs above produce and consume entries; the transport is how an entry
moves from one VM to the other. Two are in scope, smallest first.

- **T1 — Human relay (MVP, works today, zero infra).** The producing side
  prints the entry (a verifiable bundle, or its safe text form) to stdout;
  the operator carries it to the other session; the consuming side verifies
  it fail-closed and acts (opens the PR, or records the verdict). This is
  exactly the loop the operator is already running by hand. It needs no new
  code beyond a stable print/parse shape.
- **T2 — Git-as-ledger.** Each entry is committed to a repo under a known
  path (for example `handoff/<from>-<to>/<id>.bundle`). Because scope is
  single-repo, this needs one of:
  - **T2a — a shared handoff repo** both agents are scoped to (cleanest, but
    the operator must create it and launch both sessions against it), or
  - **T2b — each side writes to its own repo** and a bridge (the operator, or
    a scheduled job that *is* scoped to both) moves entries across. The
    cross-repo read cannot be automatic inside a single scoped session — this
    is the scope wall, stated plainly, not a gap to be quietly filled.

## Fail-closed rules (non-negotiable)

- An entry that does not verify is **refused**, never acted on. No PR is
  opened, no verdict is recorded, and the refusal is explicit on stderr with
  a non-zero exit — the same contract as `run restore`.
- A proposal is a **suggestion only**. It never edits the target repo by
  itself; a human-or-agent on the write side always makes the real PR, so the
  read-only vow of the proposing side holds.
- stdout stays data (the entry / the machine result); stderr stays
  diagnostics; a piped run is silent on success. `--json` is stable and
  decoration-free.

## Non-goals / POLA

- No existing command, output byte, exit code, or file layout changes.
- No new runtime dependency (zero-dependency red line holds).
- No vendor-specific logic in core; the verbs move opaque bundles.
- Nothing ships until its own cycle lands with a test that fails before and
  passes after, and a `docs/*.7.md` contract page — this design file is not
  that contract and claims no shipped behavior.

## Suggested rollout (each stage its own reviewed cycle)

0. **This design doc** (no behavior). ← you are here.
1. **T1 human-relay shape** — a stable, documented print/parse form for a
   proposal and a verdict, plus a smoke that round-trips one of each and
   proves a tampered entry is refused.
2. **`cw ledger propose` / `review`** over `run export` / `restore`, with the
   fail-closed refusal test.
3. **T2 git-ledger** (shared-repo first), then optionally a scoped bridge job
   for T2b.

## Open decisions for the operator

- T2a (shared handoff repo) or T2b (own repos + bridge)? T2a is simpler and
  should be the default unless a shared repo is not acceptable.
- Should a verdict be able to **block** a PR merge on the other side, or only
  advise? Advise-only is the safer default and matches "review as data".
