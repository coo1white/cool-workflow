# Release And Migration Discipline

CW v0.1.14 made release checks and durable run-state compatibility explicit.

## Who Is Affected

Maintainers cutting CW releases should use `npm run release:check` from
`plugins/cool-workflow`. Operators loading old `.cw/runs/<run-id>/state.json`
files can inspect compatibility with:

```bash
node scripts/cw.js state check <run-id>
```

Use `--state /path/to/state.json` when checking a state file outside the
current `.cw/runs` tree. Add `--write` only when you deliberately want to write
the normalized/migrated state back to disk.

## State Policy

The current durable run-state schema is `1`, defined by
`CURRENT_RUN_STATE_SCHEMA_VERSION` in `src/version.ts`.

Loading state follows this order:

```text
read JSON -> detect schema -> migrate -> normalize -> validate -> report
```

CW supports legacy run state with no `schemaVersion` as historical schema `0`
and migrates it to schema `1`. Schema versions newer than the runtime fail
closed. Invalid state objects fail closed. Unknown user data is preserved by
copying and adding required fields instead of rebuilding state from scratch.

## Dry Run

`state check` is dry-run by default. It reports:

- detected and current schema versions
- compatibility status: `current`, `migrated`, `normalized`, or `unsupported`
- whether writing would be required
- every field CW would add or normalize
- warnings and errors

## Backward Compatibility Fixtures

Fixture runs live in `test/fixtures/runs/` and cover:

- pre-app/simple run state
- Sandbox Profiles
- Workflow App SDK metadata
- End-to-End Golden Path
- Operator UX
- v0.1.13 MCP/App Surface

`npm run fixture-compat` copies each fixture into a temporary `.cw/runs` tree,
runs migration, and proves `status`, `graph`, and `report` still operate. The
fixture files are hashed before and after the test to prove they were not
mutated.

## Release Check

`npm run release:check` is the release gate for v0.1.14 and later. It runs:

- docs presence checks
- `npm run build`
- `npm run check`
- `npm test`
- `node test/multi-agent-runtime-core-smoke.js`
- `node test/coordinator-blackboard-smoke.js`
- `node test/multi-agent-topologies-smoke.js`
- `node test/multi-agent-eval-replay-harness-smoke.js`
- `npm run eval:replay`
- dogfood release smoke coverage
- `npm run canonical-apps`
- `npm run golden-path`
- `npm run fixture-compat`
- `npm run version:sync`

The command is dry-run and non-destructive. Tagging, pushing, and publishing
remain manual release actions after the gate passes.

For v0.1.15, the same gate also includes the Security / Trust Hardening smoke
test so audit/provenance coverage remains part of release discipline.

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
and migrations remain backward compatible (pre-0.1.25 eval snapshots load with
empty summary sections).

For v0.1.26, the gate includes Evidence Adoption Reasoning Chain smoke coverage
for derived, fingerprinted reasoning chains, fail-closed `unexplained` detection,
reasoning steps exempt from compaction, eval/replay reasoning metrics
(`reasoning_freshness`, `reasoning_chain_parity`, `reasoning_unexplained_parity`),
and CLI/MCP parity. The reasoning chain is derived, never authoritative over raw
state, and pre-0.1.26 snapshots load with empty reasoning sections.

The host loop must preserve CLI/MCP parity, stable JSON responses,
blackboard/audit provenance, evidence-required scoring, fail-closed selection,
and compatibility with the lower-level topology, multi-agent, blackboard, and
candidate primitives.

For v0.1.16, release discipline adds Dogfood One Real Repo. `npm run
dogfood:release` runs the canonical `release-cut` app against the real Cool
Workflow repository in dry-run mode and produces a CW report, audit summary,
provenance, release candidate, score, selection, and verifier-gated
commit/checkpoint. `npm run release:check` includes the dogfood smoke test so
the wiring stays covered without recursively running the full release gate.

For v0.1.17, release discipline added Multi-Agent Runtime Core coverage.
`npm run release:check` runs `test/multi-agent-runtime-core-smoke.js` directly
and through `npm test`. Older fixture runs normalize with empty multi-agent
state under `multiAgent` and `.cw/runs/<run-id>/multi-agent/`, while unknown
user data remains preserved.

## Unsupported Cases

CW does not silently load:

- non-object JSON run state
- run state with a schema version newer than the runtime
- run state with a schema version below the supported minimum
- state that cannot be normalized into the required runtime fields

When compatibility is ambiguous, hold the release and add a fixture or migration
step before proceeding.
## v0.1.27 — CLI ↔ MCP Parity

v0.1.27 adds a declared capability registry and a fail-closed `npm run
parity:check` (wired into `release:check`) guaranteeing the CLI and MCP surfaces
are two renderings of one data source. No run-state schema change: pre-0.1.27
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
drivers, selected by `--backend` (parallel to `--sandbox`) and inspected via
`backend list|show|probe`. The result/evidence envelope is schema-identical across
backends; the backend id + sandbox attestation are recorded as provenance, so this
surface is unchanged regardless of which backend executed a run. See
[execution-backends.7.md](execution-backends.7.md).
## Web / Desktop Workbench (v0.1.30)

v0.1.30 adds the Web / Desktop Workbench: a read-only, localhost-only human
console that renders this surface (and the other four operator panels — run
graph, blackboard, worker logs, candidate compare, audit timeline) for any run,
reading the SAME capability `--json` payloads. It is a THIRD FRONT DOOR alongside
the CLI and MCP that holds no authoritative state and forks no schema: each panel
equals its `cw <cmd> --json` payload byte-for-byte (parity-gated), and refresh
re-derives everything from disk. See
[web-desktop-workbench.7.md](web-desktop-workbench.7.md).

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
derive time/duration, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and token/cost from existing durable run state — no metrics
database, no collector daemon, no hidden counter. The migration is ADDITIVE and
backward compatible: an optional, host-attested `UsageRecord` rides on the
task/worker record via the EXISTING result/worker intake (absent ⇒ `unreported`,
never 0); `ResultEnvelope` and the run-state schema are unchanged (schema version
stays 1), so old runs load and report `unreported` cost while still yielding
correct time and rate metrics from their recorded timestamps and outcomes. Cost
is `attested` only from attested usage × a recorded pricing policy; assumed
pricing is a separate `estimated` figure. Pricing is POLICY supplied as data
(`--pricing <path>|default`), out of the kernel. The per-run report persists a
rebuildable, fingerprinted snapshot under `.cw/runs/<id>/metrics/`, and the
cross-repo summary reports each snapshot's `valid|stale|absent` freshness against
current source. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).


## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — required approvals from
authorized roles, enforced inside `resolveCommitGate` AFTER the verifier checks
and never instead of them, failing closed on quorum/authority/self-approval and
recording who approved the very artifact that shipped. Policy (required approvals,
authorized roles, self-approval) is data, default off (pre-v0.1.32 behavior
unchanged). The verbs are parity-gated and render read-only in the v0.1.30
Workbench. See [Team Collaboration](team-collaboration.7.md).

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a de-duplicated release gate. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really execute (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is unavailable. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, reusing the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

spawn an external agent process per worker, capture result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit
