# Multi-Agent Eval & Replay Harness

CW v0.1.23 added a deterministic replay harness for topology-backed
multi-agent runs. It turns a completed run into plain JSON evidence that can be
replayed without live agents, compared with normalized rules, scored, and used
as a release gate.

CW v0.1.25 extends the harness with State Explosion Management metrics so the
derived summary layer is regression-gated alongside the raw run:
`summary_freshness`, `compact_graph_parity`, `blackboard_digest_parity`,
`critical_path_parity`, `evidence_digest_parity`, and `expansion_ref_integrity`.
Pre-0.1.25 snapshots load with empty summary sections, so old fixtures stay
backward compatible. See
[state-explosion-management.7.md](state-explosion-management.7.md).

CW v0.1.26 adds Evidence Adoption Reasoning Chain metrics: `reasoning_freshness`,
`reasoning_chain_parity`, and `reasoning_unexplained_parity`. Pre-0.1.26
snapshots load with empty reasoning sections. See
[evidence-adoption-reasoning-chain.7.md](evidence-adoption-reasoning-chain.7.md).

The harness is intentionally file-first:

- snapshots, replay runs, comparisons, scores, findings, gates, and reports are
  stored under `.cw/evals/<suite-id>/`
- the baseline run is not mutated during replay
- replay output is written to an isolated `replay/` directory
- every CLI command supports deterministic JSON with `--json` or
  `--format json`
- MCP tools return JSON only and include generated artifact paths

## Commands

Create a snapshot from a multi-agent run:

```bash
node scripts/cw.js eval snapshot <run-id> --id <suite-id>
node scripts/cw.js eval snapshot <run-id> --id <suite-id> --json
```

Replay without live agents:

```bash
node scripts/cw.js eval replay .cw/evals/<suite-id>/snapshot.json
```

Compare, score, gate, and report:

```bash
node scripts/cw.js eval compare \
  .cw/evals/<suite-id>/snapshot.json \
  .cw/evals/<suite-id>/replay-run.json

node scripts/cw.js eval score .cw/evals/<suite-id>/replay-run.json
node scripts/cw.js eval gate .cw/evals/<suite-id>
node scripts/cw.js eval report .cw/evals/<suite-id>/replay-run.json
```

`npm run eval:replay` runs the deterministic smoke suite and is included in
`npm test` and `npm run release:check`.

Human output uses stable panels:

```text
Eval Suite
Replay Status
Graph Comparison
Evidence Comparison
Trust / Policy / Audit Comparison
Candidate Score Comparison
Selection / Commit Gate
Regression Findings
Final Verdict
Next Action
```

## Artifacts

Each suite writes predictable files:

- `suite.json`
- `snapshot.json`
- `replay-run.json`
- `comparison.json`
- `score.json`
- `findings.json`
- `gate.json`
- `report.md`

The snapshot captures workflow app identity, inputs, topology shape, roles,
groups, memberships, fanout/fanin state, blackboard records, worker outputs,
candidate scores, selection rationale, verifier-gated commit inputs,
trust/policy/audit records, expected operator summaries, evidence adoption, and
report sections.

## Comparison Rules

The comparison checks:

- topology id and topology run shape
- roles, groups, memberships, fanout, and fanin records
- dependency edges and failure rows
- blackboard records and message provenance
- role policies, permission decisions, write audit, judge rationale, panel
  decisions, and policy violations
- evidence adoption status
- candidate scores, selected candidate, and selection rationale
- verifier-gated commit readiness
- report sections

Normalization removes unstable paths, timestamps, generated temp roots, and
machine-local directories. It does not hide changed evidence, policy,
selection, scoring, or commit-gate behavior.

## Scoring

Scores are deterministic metrics:

- `replay_completed`
- `graph_parity`
- `role_parity`
- `group_parity`
- `membership_parity`
- `fanout_parity`
- `fanin_parity`
- `dependency_parity`
- `failure_parity`
- `blackboard_record_parity`
- `evidence_adoption_parity`
- `trust_audit_parity`
- `role_policy_parity`
- `permission_decision_parity`
- `policy_violation_parity`
- `blackboard_provenance_parity`
- `judge_rationale_parity`
- `panel_decision_parity`
- `candidate_score_parity`
- `selection_parity`
- `verifier_commit_gate_parity`
- `report_parity`

Each metric returns `id`, `status`, `score`, `maxScore`, `reason`, evidence
refs, baseline refs, and replay refs.

## Gate

`eval gate` fails closed when replay artifacts are missing or when comparison
findings show a regression. This includes missing judge rationale, changed
selected candidate, changed evidence adoption, changed policy violations,
missing provenance, lost verifier-gated commit readiness, or graph/dependency
loss.

Improvements can be represented as changed findings in future suites, but they
must be visible in `score.json`, `findings.json`, and `report.md` before a
release gate can accept them.

## MCP Parity

The MCP surface mirrors the CLI:

- `cw_eval_snapshot`
- `cw_eval_replay`
- `cw_eval_compare`
- `cw_eval_score`
- `cw_eval_gate`
- `cw_eval_report`

MCP responses are deterministic JSON and include artifact paths.

## Release Use

Use this harness after a topology-backed run reaches score, selection, and a
verifier-gated commit:

```bash
node scripts/cw.js eval snapshot <run-id> --id release-replay
node scripts/cw.js eval replay .cw/evals/release-replay/snapshot.json
node scripts/cw.js eval compare .cw/evals/release-replay/snapshot.json .cw/evals/release-replay/replay-run.json
node scripts/cw.js eval score .cw/evals/release-replay/replay-run.json
node scripts/cw.js eval gate .cw/evals/release-replay
node scripts/cw.js eval report .cw/evals/release-replay/replay-run.json
```

The gate proves the replay completed, graph/dependencies stayed stable,
evidence adoption stayed traceable, trust/policy/audit records remained
explainable, judge rationale is present, scoring/selection did not regress, and
verifier-gated commit readiness still holds.
## CLI ↔ MCP Parity (v0.1.27)

Every command and tool referenced above is declared in the v0.1.27 capability
registry (`src/capability-registry.ts`) and validated by `npm run parity:check`,
so `cw <cmd> --json` and the matching `cw_<tool>` result render one data source.
See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).

## Run Registry / Control Plane (v0.1.28)

The runs described here are indexed, searchable, resumable, archivable, and
rerunnable across repos by the v0.1.28 Run Registry / Control Plane, which derives
a fingerprinted, fail-closed index over the same per-run `.cw/runs/<id>/state.json`
source of truth. See [run-registry-control-plane.7.md](run-registry-control-plane.7.md).

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
derive durations, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and host-attested token/cost from existing durable run state
— no metrics database, no collector daemon, no hidden counter. Usage is additive
and optional (absent ⇒ `unreported`, never 0); cost is `attested` (attested usage
× a recorded pricing policy) or clearly `estimated`, with pricing as policy. Both
verbs are parity-gated and render read-only in the v0.1.30 Workbench. See
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
