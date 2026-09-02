# Architecture Roadmap After MCP Process Separation

## Purpose

This is the current architecture work map for Cool Workflow. `AGENTS.md`
carries product direction (its "Product Direction & Moat" section) and
build-memory facts/work order (its "Build Memory" section). This file gives
the small set of architecture changes still planned.

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

Status: complete in the schema version guard cycle.

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

Status: passed on 2026-07-14 after the human resume drive result was made
clear.

From a clean clone and clean home, follow the README and complete:

```text
plan -> run -> inspect -> resume
```

The path has to take less than five minutes. Keep safe commands and measured
time as evidence.

### Track B

Status: passed on 2026-07-14. Restore, strict check, resume, and the
before-write tamper refusal all passed.

Use two separate temporary roots. Export a run from the first, restore and
verify it in the second, then resume it. A changed archive has to be refused
before any target state is written.

### Track C

Status: passed on 2026-07-14 with Claude Code and Codex CLI.

Load generated manifests in at least two real AI clients. For each client,
prove MCP `initialize`, `tools/list`, and one read-only `tools/call`. Keep only
safe evidence with no user or machine data.

If a proof fails, the first real blocker becomes the next one-goal cycle.
The safe proof record is in `docs/audits/north-star-proof-2026-07-14.md`.

## Work Kept Out

Keep these items in `docs/BACKLOG.md` until new evidence changes their value:

- `withFileLockAsync`: the MCP control process no longer waits on tool locks.
- Large file splits: do them only when a file blocks real work or review.
- General util and small `loadRun` copy clean-up: local small code is cheaper
  than a new shared link.
- A formatter, directory moves, a model SDK, or a runtime dependency.
- `commitMessageTemplate`: removed 2026-09-02 (it had no real reader).

## Security Work Map

This work starts from the threat model in `.github/SECURITY.md`. It keeps the
same small control plane and does not add an auth server, model SDK, or runtime
package.

### 1. Canonical Archive File Table

Status: complete in PR #513.

Archive paths and rows are checked before a write. Paths have to be portable
and unique. Unknown roles, unsafe sizes, bad sha256 values, and reserved run
files fail closed. Clean archive bytes and success output stay the same.

### 2. Atomic Restore Publish

Status: complete in the atomic restore cycle.

`run restore` will make and check state in a same-disk staging place. It will
publish the run with one directory rename only after every check passes. A bad
check or an existing final run will leave the final path as it was.

### 3. Archive Intake Limits

Status: complete in the archive intake limits cycle.

`CW_MAX_RUN_ARCHIVE_BYTES`, `CW_MAX_RUN_ARCHIVE_FILES`, and
`CW_MAX_RUN_ARCHIVE_CONTENT_BYTES` let an operator set a raw archive byte
limit, a file count limit, and a decoded content byte limit. Bad settings and
over-limit input stop before a restore write. With no setting, present behavior
stays the same.

### 4. MCP Tool Authority Policy

Status: complete in the MCP tool authority cycle.

`CW_MCP_ENABLED_TOOLS` and `CW_MCP_DISABLED_TOOLS` give the MCP server an
enabled tool list and a disabled tool list. The disabled list has the last
word. Bad names stop server start. With no setting, the present `tools/list`
bytes and tool access stay the same.

After these cycles, run the Track A, B, and C product proofs again. A proof
failure becomes the next one-goal cycle. Do not start more inside-only security
work without such evidence.

## Robustness Work Map

### 1. MCP Tool Shutdown Containment

Status: complete in the MCP tool shutdown containment cycle.

The MCP parent already answers `ping` while a tool child waits on a file lock.
On `SIGINT` or `SIGTERM`, it must also stop that child before the parent ends.
The child must not wake later and write state. Normal stdin end keeps its old
ordered queue drain rule.

The held schedule-lock proof passed for both stop signals. No late schedule
write was made after the lock was freed. A new MCP server then answered ping.

### Measured Cost

After this proof, stop robustness work. Keep `withFileLockAsync` parked unless
a real product proof finds that a tool cannot stop, takes too long to stop, or
leaves bad state. A later change must first name the exact lock and write path,
and define sync and async re-entry before it changes a call chain.

## Performance Work Map

### 1. Workflow Overhead Baseline

Status: complete in the workflow-overhead baseline cycle.

The benchmark runner now has opt-in zero-delay and Workbench-skip modes. It
writes plan, drive, and total times for every run plus medians to a JSON report.
Old benchmark calls keep their same CSV stdout bytes and defaults.

Five low-delay runs gave a 994ms median cold drive. A later profile named one
safe cost in that path: 39 separate trust-audit durable appends took about
169ms in one six-worker drive.

### Stop Rule

### 2. Trust-Audit Round Batching

Status: complete; the measured gain did not meet the cold-drive goal.

Each concurrent round will keep its short dispatch and settlement audit groups
under the existing audit lock. Each group will make one durable append before
its present checkpoint. It will not hold that lock while an agent is running.
The event order, ids, hashes, bytes, checkpoint order, reports, and replay
records stay the same.

### Next Check

The same five-run measure gave an 828ms median cold drive. This is faster than
the 994ms baseline, but it is not the 630ms goal. Stop this performance line
here. Do not start the CI cycle. A later cycle needs a new measure and one
safe cost that can meet the goal without a change to checkpoint order, report
time, default cache use, agent count, phase order, output, or replay records.

CI feedback work starts only after a measured cold-path change. It must keep
the test set and protected checks the same.

### 3. Cold Path Proof

Status: complete; no safe next change meets the 630ms goal.

The benchmark runner now has an opt-in trace report. It gives per-round time,
self time, durable write count, and durable write bytes for dispatch, agent
wait, settlement, report, and checkpoint work. Old calls keep their CSV stdout
and JSON report bytes.

Five clean Node 22 runs gave a 783ms median cold drive. Agent wait was 269ms,
but it covers four batch children and does not prove that one safe change can
save 200ms. The trace saw 34 durable writes (1.33MB); they hold state,
telemetry, and audit facts. No single safe part has the needed room. Stop this
line here. A later cycle needs a new proof, or a clear product decision to
change the execution or durable-state contract.

## Simple UI/UX Work Map

The Workbench stays a small, read-only view. FreeBSD `style(9)` and `hier(7)`
give the rules for clear errors, man-page agreement, and one place for each
sort of state. Homebrew `brew(1)` and its External Commands guide give the
rules for a short front door, clear help, and no new inside path. Codex Best
practices and app commands give the rules for saved context, review, key
movement, and Back/Forward movement. The source links and full mapping are in
`plugins/cool-workflow/docs/web-desktop-workbench.7.md`.

Its read path makes no derived audit or metrics file. The normal CLI report
commands keep their durable files; the Workbench uses the same calculation in
an in-memory projection only.

### 1. Predictable Workbench Navigation

Status: complete in the predictable Workbench navigation cycle.

The page fragment names one run and one panel. Run and panel changes use
browser history, and reload, Back, and Forward keep the same view. A small
pure navigation helper gives the fragment and key rules. A latest-request
check stops an old run answer from taking the place of a new one. The run
list and panel tabs have full keyboard and ARIA links.

### 2. Action-First Inspection

Status: complete in the action-first Workbench inspection cycle.

When a present capability payload has integrity, problem, missing-evidence,
or next-action facts, the Workbench puts those source facts before the full
record. It does not make a new rank, state, or action. The full payload stays
in the panel, and CLI, MCP, and HTTP bytes stay the same.

## Release Rules

- Do not add a CLI command, MCP tool, flag, JSON field, or runtime dependency
  for these changes.
- Put all project text in English. Use Basic English for common words.
- Never push to `main`. Use a branch, PR, green CI, and oldest-ready-first
  merge order.
- Do not tag each cycle. A release needs one clear new user ability, the time
  rule, full gates, and independent review.
