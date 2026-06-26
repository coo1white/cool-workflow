# Multi-Agent Eval & Replay Harness

CW v0.1.23 added a deterministic replay harness for topology-backed
multi-agent runs. It turns a finished run into plain JSON evidence. You can
replay this evidence without live agents, compare it with normalized rules,
score it, and use it as a release gate.

CW v0.1.25 adds State Explosion Management metrics to the harness, so the
derived summary layer is regression-gated next to the raw run:
`summary_freshness`, `compact_graph_parity`, `blackboard_digest_parity`,
`critical_path_parity`, `evidence_digest_parity`, and `expansion_ref_integrity`.
Pre-0.1.25 snapshots load with empty summary sections, so old fixtures keep
working. See
[state-explosion-management.7.md](state-explosion-management.7.md).

CW v0.1.26 adds Evidence Adoption Reasoning Chain metrics: `reasoning_freshness`,
`reasoning_chain_parity`, and `reasoning_unexplained_parity`. Pre-0.1.26
snapshots load with empty reasoning sections. See
[evidence-adoption-reasoning-chain.7.md](evidence-adoption-reasoning-chain.7.md).

The harness is file-first by design:

- snapshots, replay runs, comparisons, scores, findings, gates, and reports are
  stored under `.cw/evals/<suite-id>/`
- the baseline run is not changed during replay
- replay output is written to a separate `replay/` directory
- every CLI command can give deterministic JSON with `--json` or
  `--format json`
- MCP tools return JSON only and include the paths of generated artifacts

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

`npm run eval:replay` runs the deterministic smoke suite. It is part of
`npm test` and `npm run release:check`.

Human output uses fixed panels:

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

Each suite writes these fixed files:

- `suite.json`
- `snapshot.json`
- `replay-run.json`
- `comparison.json`
- `score.json`
- `findings.json`
- `gate.json`
- `report.md`

The snapshot keeps workflow app identity, inputs, topology shape, roles,
groups, memberships, fanout/fanin state, blackboard records, worker outputs,
candidate scores, selection rationale, verifier-gated commit inputs,
trust/policy/audit records, expected operator summaries, evidence adoption, and
report sections.

## Comparison Rules

The comparison checks these:

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

Normalization takes out unstable paths, timestamps, generated temp roots, and
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

Each metric gives back `id`, `status`, `score`, `maxScore`, `reason`, evidence
refs, baseline refs, and replay refs.

## Gate

`eval gate` fails closed when replay artifacts are missing or when comparison
findings show a regression. This includes missing judge rationale, changed
selected candidate, changed evidence adoption, changed policy violations,
missing provenance, lost verifier-gated commit readiness, or graph/dependency
loss.

You can show improvements as changed findings in later suites, but they
must be seen in `score.json`, `findings.json`, and `report.md` before a
release gate can take them.

## MCP Parity

The MCP surface matches the CLI:

- `cw_eval_snapshot`
- `cw_eval_replay`
- `cw_eval_compare`
- `cw_eval_score`
- `cw_eval_gate`
- `cw_eval_report`

MCP responses are deterministic JSON and include artifact paths.

## Release Use

Use this harness after a topology-backed run gets a score, a selection, and a
verifier-gated commit:

```bash
node scripts/cw.js eval snapshot <run-id> --id release-replay
node scripts/cw.js eval replay .cw/evals/release-replay/snapshot.json
node scripts/cw.js eval compare .cw/evals/release-replay/snapshot.json .cw/evals/release-replay/replay-run.json
node scripts/cw.js eval score .cw/evals/release-replay/replay-run.json
node scripts/cw.js eval gate .cw/evals/release-replay
node scripts/cw.js eval report .cw/evals/release-replay/replay-run.json
```

The gate proves the replay finished, graph/dependencies stayed stable,
evidence adoption stayed traceable, trust/policy/audit records stayed
explainable, judge rationale is there, scoring/selection did not regress, and
verifier-gated commit readiness still holds.
## CLI ↔ MCP Parity (v0.1.27)

Every command and tool named above is declared in the v0.1.27 capability
registry (`src/capability-registry.ts`) and checked by `npm run parity:check`,
so `cw <cmd> --json` and the matching `cw_<tool>` result show one data source.
See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).

## Run Registry / Control Plane (v0.1.28)

The runs described here are indexed, searchable, resumable, archivable, and
rerunnable across repos by the v0.1.28 Run Registry / Control Plane. It derives
a fingerprinted, fail-closed index over the same per-run `.cw/runs/<id>/state.json`
source of truth. See [run-registry-control-plane.7.md](run-registry-control-plane.7.md).

## Execution Backends (v0.1.29)

v0.1.29 moves execution into a pluggable driver layer: one narrow `ExecutionBackend`
contract with interchangeable `node`/`bun`/`shell`/`container`/`remote`/`ci`
drivers, chosen by `--backend` (next to `--sandbox`) and looked at with
`backend list|show|probe`. The result/evidence envelope has the same schema across
backends; the backend id + sandbox attestation are kept as provenance, so this
surface stays the same no matter which backend ran a run. See
[execution-backends.7.md](execution-backends.7.md).
## Web / Desktop Workbench (v0.1.30)

v0.1.30 adds the Web / Desktop Workbench: a read-only, localhost-only human
console that shows this surface (and the other four operator panels — run
graph, blackboard, worker logs, candidate compare, audit timeline) for any run,
reading the SAME capability `--json` payloads. It is a THIRD FRONT DOOR next to
the CLI and MCP that holds no authoritative state and forks no schema: each panel
equals its `cw <cmd> --json` payload byte-for-byte (parity-gated), and a refresh
re-derives everything from disk. See
[web-desktop-workbench.7.md](web-desktop-workbench.7.md).

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
derive durations, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and host-attested token/cost from run state that is already
durable — no metrics database, no collector daemon, no hidden counter. Usage is
additive and optional (absent ⇒ `unreported`, never 0); cost is `attested` (attested usage
× a recorded pricing policy) or clearly `estimated`, with pricing as policy. Both
verbs are parity-gated and show read-only in the v0.1.30 Workbench. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).


## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — required approvals from
authorized roles, enforced inside `resolveCommitGate` AFTER the verifier checks
and never in place of them, failing closed on quorum/authority/self-approval and
recording who approved the same artifact that shipped. Policy (required approvals,
authorized roles, self-approval) is data, default off (pre-v0.1.32 behavior is
the same). The verbs are parity-gated and show read-only in the v0.1.30
Workbench. See [Team Collaboration](team-collaboration.7.md).

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a de-duplicated release gate. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really execute (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is not there. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, using the v0.1.23 eval harness again; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

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

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — fixes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate that blocks empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) instead of the mutable working tree — this removes false-red/false-green from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, measurable wrapper metrics, useful background full-review handoff, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_No changes to the multi-agent eval/replay harness in v0.1.81 (the multi-agent-eval module was split into behavior-preserving siblings; replay output is byte-identical)._
_v0.1.82 — replay now RE-DERIVES the projection from the raw captured state instead of copying the baseline, so a nondeterministic projection is caught instead of passing quietly; a new regression smoke (including an intrinsic-nondeterminism case) proves the moat has teeth._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

_No change in behavior in v0.1.88 (no harness code changed; the new `loop-control` state node and loop result nodes replay byte-identically through the existing normalize/replay machinery, and pre-0.1.88 snapshots load unchanged)._

## 0.1.89 (v0.1.89)

_No behavioral change in v0.1.89 (CLI-surface golden-path + help-output fixes only; this subsystem is unchanged)._

0.1.90

0.1.91

0.1.93

0.1.94
