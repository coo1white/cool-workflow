# Architecture Roadmap After MCP Process Separation

## Purpose

This is the current architecture work map for Cool Workflow. `DIRECTION.md`
is the source for product direction. `PROJECT_MEMORY.md` keeps facts and work
order. This file gives the small set of architecture changes still planned.

Keep this order true:

```text
fail closed -> take out dead paths -> make boundaries clear -> prove North Stars
```

Each code cycle has one goal, one branch, one PR, and one fail-first test.
Normal CLI and MCP output, JSON, exit codes, file layout, and replay records
stay as they are.

## Current Base

The main architecture work before this map is complete:

- `core`, `shell`, and `wiring` are separate layers.
- The capability table is split into a pure data source and wiring slices.
- CLI and MCP use the same capability registry.
- The MCP control process and serial tool process are separate.
- Core unit tests and purity, parity, manifest, and release gates are in use.
- `architecture-review-fast` has opt-in result cache use in Map, Assess,
  Verify, and Verdict.
- The manifest vendor registry is now required. The dead hard-coded build path
  was taken out in PR #507.

The old rebuild work packages are history. They are not work to do again.

## Work Map

### 1. Independent CLI Proof in the Parity Gate

Status: complete in the independent parity proof cycle.

The top-level parity gate must not use a CLI token list made from the registry
as proof that the same CLI rows are live.

- Probe every declared CLI path through the live dispatcher.
- Read help-visible commands from real `cw help` output.
- Keep live MCP `tools/list` checks.
- Keep CLI-process to MCP payload checks for `payloadIdentical` rows.
- Keep the present parity JSON keys and successful output shape.
- Keep `buildParityReport()` adversarial tests with direct test input.

Done means a fixture with a broken CLI binding fails the gate, while the
public CLI and MCP surfaces stay byte-identical.

### 2. Run Directory IO in Shell

Status: complete in the run-directory shell boundary cycle.

`core/state/run-paths.ts` must do path math only.

- Keep `createRunPaths()` in `core`.
- Move `ensureRunDirs()` to the run-store shell layer.
- Keep the shell export used by current callers.
- Take the `node:fs` entry for `core/state/run-paths.ts` out of the purity
  baseline.
- Keep every `.cw/runs/<id>/` directory and fallback path as it is.

Done means core has no file-system import for run paths, and create, export,
restore, and resume tests keep the same file layout.

### 3. One Schema Version Definition for Each Domain

Status: next code cycle.

Replay domains need one version definition each. Different domains do not
need one global version.

- Add a checked inventory of schema domains and their definition files.
- Fail on a second definition in one domain.
- Fail on an unknown domain or an inventory entry which has no use.
- Keep all current schema numbers and JSON fields.
- Run the check from `release:check`.

Done means a duplicate fixture fails, while archive, restore, migration, and
replay records keep their present bytes.

## North Star Proof

After the three open code cycles, stop internal structure work and prove the
three user tracks.

### Track A

From a clean clone and clean home, follow the README and complete:

```text
plan -> run -> inspect -> resume
```

The path has to take less than five minutes. Keep safe commands and measured
time as evidence.

### Track B

Use two separate temporary roots. Export a run from the first, restore and
verify it in the second, then resume it. A changed archive has to be refused
before any target state is written.

### Track C

Load generated manifests in at least two real AI clients. For each client,
prove MCP `initialize`, `tools/list`, and one read-only `tools/call`. Keep only
safe evidence with no user or machine data.

If a proof fails, the first real blocker becomes the next one-goal cycle.

## Work Kept Out

Keep these items in `docs/BACKLOG.md` until new evidence changes their value:

- `withFileLockAsync`: the MCP control process no longer waits on tool locks.
- Large file splits: do them only when a file blocks real work or review.
- General util and small `loadRun` copy clean-up: local small code is cheaper
  than a new shared link.
- A formatter, directory moves, a model SDK, or a runtime dependency.
- `commitMessageTemplate`: it has no real reader.

## Release Rules

- Do not add a CLI command, MCP tool, flag, JSON field, or runtime dependency
  for these changes.
- Put all project text in English. Use Basic English for common words.
- Never push to `main`. Use a branch, PR, green CI, and oldest-ready-first
  merge order.
- Do not tag each cycle. A release needs one clear new user ability, the time
  rule, full gates, and independent review.
