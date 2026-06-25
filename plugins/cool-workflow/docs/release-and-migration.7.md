# Release And Migration Discipline

CW v0.1.14 made release checks and durable run-state compatibility clear.

## Who Is Affected

Maintainers cutting CW releases should use `npm run release:check` from
`plugins/cool-workflow`. Operators loading old `.cw/runs/<run-id>/state.json`
files can check compatibility with:

```bash
node scripts/cw.js state check <run-id>
```

Use `--state /path/to/state.json` when checking a state file outside the
current `.cw/runs` tree. Add `--write` only when you truly want to write
the normalized/migrated state back to disk.

## State Policy

The current durable run-state schema is `1`, set by
`CURRENT_RUN_STATE_SCHEMA_VERSION` in `src/version.ts`.

Loading state goes in this order:

```text
read JSON -> detect schema -> migrate -> normalize -> validate -> report
```

CW supports old run state with no `schemaVersion` as past schema `0`
and migrates it to schema `1`. Schema versions newer than the runtime fail
closed. Bad state objects fail closed. Unknown user data is kept by
copying and adding required fields, not by building state again from the start.

## Dry Run

`state check` is dry-run by default. It reports:

- detected and current schema versions
- compatibility status: `current`, `migrated`, `normalized`, or `unsupported`
- whether writing would be needed
- every field CW would add or normalize
- warnings and errors

## Backward Compatibility Fixtures

Fixture runs live in `test/fixtures/runs/` and cover:

- pre-app/simple run state
- Sandbox Profiles
- Workflow App framework metadata
- End-to-End Golden Path
- Operator UX
- v0.1.13 MCP/App Surface

`npm run fixture-compat` copies each fixture into a short-term `.cw/runs` tree,
runs migration, and shows `status`, `graph`, and `report` still work. The
fixture files are hashed before and after the test to show they were not
changed.

## Release Check

`npm run release:check` is the release gate for v0.1.14 and later. It runs:

- docs presence checks
- `npm run build`
- `npm run check`
- `npm test`
- `node test/multi-agent-runtime-core-smoke.js`
- `node test/coordinator-blackboard-smoke.js`
- multi-agent topologies smoke coverage
- `node test/multi-agent-eval-replay-harness-smoke.js`
- `npm run eval:replay`
- dogfood release smoke coverage
- `npm run canonical-apps`
- `npm run golden-path`
- `npm run fixture-compat`
- `npm run version:sync`

The command is dry-run and non-destructive. Tagging, pushing, and publishing
stay manual release actions after the gate passes.

For v0.1.15, the same gate also includes the Security / Trust Hardening smoke
test so audit/provenance coverage stays part of release discipline.

For v0.1.18, the gate includes Coordinator / Blackboard smoke coverage and
fixture normalization for empty blackboard state on older runs.

For v0.1.19, the gate includes Multi-Agent Topologies smoke coverage and
fixture normalization for empty topology state on older runs.

For v0.1.20, the gate includes Multi-Agent CLI + MCP Surface smoke coverage.

For v0.1.21, the gate includes Multi-Agent Operator UX smoke coverage for
derived graph, dependency, failure, evidence adoption, report, and MCP parity
views.

For v0.1.22, the gate includes Multi-Agent Trust / Policy / Audit smoke
coverage for role policy, permission decisions, blackboard write audit, message
provenance, judge rationale, panel decisions, policy violations, report output,
audit provenance, and MCP parity.

For v0.1.24, the gate includes Multi-Agent Eval & Replay Harness smoke
coverage for replay snapshots, isolated replay runs, normalized comparison,
scoring, fail-closed regression detection, report output, and MCP parity.

For v0.1.25, the gate includes State Explosion Management smoke coverage for
durable summary records, compact and focused graph views, blackboard digests,
critical-path preservation, fail-closed stale-summary detection, eval/replay
summary metrics (`summary_freshness`, `compact_graph_parity`,
`blackboard_digest_parity`, `critical_path_parity`, `evidence_digest_parity`,
`expansion_ref_integrity`), and CLI/MCP parity. Summaries are derived userland
indexes; raw blackboard, graph, audit, and evidence records are never deleted,
and migrations stay backward compatible (pre-0.1.25 eval snapshots load with
empty summary sections).

For v0.1.26, the gate includes Evidence Adoption Reasoning Chain smoke coverage
for derived, fingerprinted reasoning chains, fail-closed `unexplained` detection,
reasoning steps exempt from compaction, eval/replay reasoning metrics
(`reasoning_freshness`, `reasoning_chain_parity`, `reasoning_unexplained_parity`),
and CLI/MCP parity. The reasoning chain is derived, never authoritative over raw
state, and pre-0.1.26 snapshots load with empty reasoning sections.

The host loop must keep CLI/MCP parity, stable JSON responses,
blackboard/audit provenance, evidence-required scoring, fail-closed selection,
and compatibility with the lower-level topology, multi-agent, blackboard, and
candidate primitives.

For v0.1.16, release discipline adds Dogfood One Real Repo. `npm run
dogfood:release` runs the canonical `release-cut` app against the real Cool
Workflow repository in dry-run mode and makes a CW report, audit summary,
provenance, release candidate, score, selection, and verifier-gated
commit/checkpoint. `npm run release:check` includes the dogfood smoke test so
the wiring stays covered without running the full release gate inside itself.

For v0.1.17, release discipline added Multi-Agent Runtime Core coverage.
`npm run release:check` runs `test/multi-agent-runtime-core-smoke.js` directly
and through `npm test`. Older fixture runs normalize with empty multi-agent
state under `multiAgent` and `.cw/runs/<run-id>/multi-agent/`, while unknown
user data stays kept.

## Unsupported Cases

CW does not quietly load:

- non-object JSON run state
- run state with a schema version newer than the runtime
- run state with a schema version below the supported minimum
- state that cannot be normalized into the required runtime fields

When compatibility is not clear, hold the release and add a fixture or migration
step before going on.
## v0.1.27 — CLI ↔ MCP Parity

v0.1.27 adds a declared capability registry and a fail-closed `npm run
parity:check` (wired into `release:check`) that makes sure the CLI and MCP surfaces
are two views of one data source. No run-state schema change: pre-0.1.27
runs load unchanged, and every pre-0.1.27 CLI command and MCP tool keeps working.
See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).

## Run Registry / Control Plane (v0.1.28)

v0.1.28 adds a derived, rebuildable run registry over the same durable run state.
No run-state schema change: pre-0.1.28 single-repo runs and existing `.cw/runs/`
layouts keep working with an empty registry (`registry show` reports `absent`
until the first `registry refresh`), and the registry, archive/provenance
overlays, queue, and home discovery set are all derivable files that can be
deleted and rebuilt from source. See
[run-registry-control-plane.7.md](run-registry-control-plane.7.md).

## Execution Backends (v0.1.29)

v0.1.29 lifts execution into a pluggable driver layer: one narrow `ExecutionBackend`
contract with interchangeable `node`/`bun`/`shell`/`container`/`remote`/`ci`
drivers, picked by `--backend` (parallel to `--sandbox`) and inspected via
`backend list|show|probe`. The result/evidence envelope is schema-identical across
backends; the backend id + sandbox attestation are recorded as provenance, so this
surface is unchanged no matter which backend executed a run. See
[execution-backends.7.md](execution-backends.7.md).
## Web / Desktop Workbench (v0.1.30)

v0.1.30 adds the Web / Desktop Workbench: a read-only, localhost-only human
console that renders this surface (and the other four operator panels — run
graph, blackboard, worker logs, candidate compare, audit timeline) for any run,
reading the SAME capability `--json` payloads. It is a THIRD FRONT DOOR next to
the CLI and MCP that holds no authoritative state and forks no schema: each panel
equals its `cw <cmd> --json` payload byte-for-byte (parity-gated), and refresh
derives everything again from disk. See
[web-desktop-workbench.7.md](web-desktop-workbench.7.md).

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
derive time/duration, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and token/cost from existing durable run state — no metrics
database, no collector daemon, no hidden counter. The migration is ADDITIVE and
backward compatible: an optional, host-attested `UsageRecord` rides on the
task/worker record via the EXISTING result/worker intake (absent ⇒ `unreported`,
never 0); `ResultEnvelope` and the run-state schema are unchanged (schema version
stays 1), so old runs load and report `unreported` cost while still giving
correct time and rate metrics from their recorded timestamps and outcomes. Cost
is `attested` only from attested usage × a recorded pricing policy; guessed
pricing is a separate `estimated` figure. Pricing is POLICY given as data
(`--pricing <path>|default`), out of the kernel. The per-run report keeps a
rebuildable, fingerprinted snapshot under `.cw/runs/<id>/metrics/`, and the
cross-repo summary reports each snapshot's `valid|stale|absent` freshness against
current source. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).


## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — required approvals from
authorized roles, enforced inside `resolveCommitGate` AFTER the verifier checks
and never in place of them, failing closed on quorum/authority/self-approval and
recording who approved the very artifact that shipped. Policy (required approvals,
authorized roles, self-approval) is data, default off (pre-v0.1.32 behavior
unchanged). The verbs are parity-gated and render read-only in the v0.1.30
Workbench. See [Team Collaboration](team-collaboration.7.md).

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a de-duplicated release gate. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really run (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is not there. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, reusing the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

spawn an external agent process per worker, capture result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the reconstructable bulk, prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate that blocks empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now validate the committed blob (`git show HEAD:<path>`) in place of the mutable working tree — taking away false-red/false-green from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, measurable wrapper metrics, actionable background full-review handoff, and userland model policy flags for routing fast/strong workers without changing the full review contract.

## Migration Compatibility (v0.1.81)

v0.1.81 is additive: every change is a new flag/verb/env (`audit verify`, `run inspect-archive`, `verify-import --strict`, `CW_REQUIRE_ARCHIVE_INTEGRITY`, `quickstart --resume`, `run resume --drive`) or an internal behavior-preserving carve. Run-state schema, existing outputs, files, and exit codes are byte-identical, so runs and archives from earlier versions load and verify unchanged. No migration action is needed.
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

_No behavioral change in v0.1.88 (`release:check` and the durable run-state compatibility/`state check` path are unchanged; this release's release-flow verdict-capture work lives in the Release Tooling scripts, not in the release-check or migration discipline)._

## 0.1.89 (v0.1.89)

_No behavioral change in v0.1.89 (CLI-surface golden-path + help-output fixes only; this subsystem is unchanged)._

0.1.90

0.1.91

0.1.93
