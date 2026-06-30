# State Explosion Management

CW v0.1.25 adds State Explosion Management. When multi-agent work grows,
blackboard and graph output can get too big to read. This release adds a
first-class summarization and compaction layer that makes hard runs
clear to read without hiding source truth.

CW v0.1.26 builds on this layer with the Evidence Adoption Reasoning Chain, which
reuses the same derived, fingerprinted, fail-closed way of working and whose
reasoning steps are free from the compaction talked about here. See
[evidence-adoption-reasoning-chain.7.md](evidence-adoption-reasoning-chain.7.md).

The design keeps to a base-system observability way of thinking:

- raw state is the source of truth
- summaries are derived userland indexes, never a substitute for source records
- plain files, stable JSON, deterministic output
- small composable commands and readable console views, with full
  machine-readable output ready to use
- fail closed when a summary is stale, not complete, not clear, or loses
  provenance
- backward compatible; no hidden daemon; no lossy deletion of blackboard,
  graph, audit, or evidence records

## Derived summary model

Summary records are durable, versioned, and backed by provenance. Each one carries
`schemaVersion`, `runId`, a summary `id`, a `scope`
(`run`, `topology`, `multi-agent-run`, `group`, `role`, `membership`, `fanout`,
`fanin`, `blackboard`, `topic`, `evidence`, `trust`, or `eval`),
`sourceRecordIds`, a deterministic `sourceFingerprint`, `includedCount` and
`omittedCount`, `importantRefs`, `evidenceRefs`, `trustAuditEventRefs`,
`generatedAt`, a `status` (`valid`, `stale`, or `absent`), a `deterministic`
flag, and a `nextAction`.

Record types:

- `MultiAgentSummaryIndex` - the index of all summary records for a run
- `BlackboardSummaryRecord` - the deterministic blackboard digest
- `GraphSummaryRecord` - a compact or focused graph view
- `OperatorDigest` - the combined operator-facing digest
- `StateExplosionReport` - the top-level report with all panels and freshness

Summaries are written under `.cw/runs/<run-id>/summaries/` as plain JSON. Raw
blackboard messages, graph nodes, graph edges, audit events, evidence refs, and
eval artifacts are never deleted or written over.

Within a single summary build, CW shares the derived full operator graph,
operator status, blackboard digest, state-size record, and graph view records
through a short-lived in-memory context. This way it does not build the same graph
again for `summary refresh`, `summary show`, and the top-level state-explosion report.
It is not a daemon or persistent cache: the next command reads run state from
disk again, works out source fingerprints again, and still fails closed on stale summaries.

## Blackboard summarization

`blackboard summarize <run-id>` (MCP: `cw_blackboard_summarize`) returns a
deterministic structural digest with topic rollups, message thread summaries,
unresolved questions, conflicts, decisions, artifacts, adopted evidence,
missing evidence, policy violations, judge rationale, recent changes, and
high-signal records. Every entry keeps links back to source messages,
contexts, artifacts, snapshots, coordinator decisions, and audit events, plus an
expansion command for the raw records. Structural summaries exist without any
LLM output; any semantic summary must be clear, backed by provenance, and
linked to evidence.

## Graph compaction

`multi-agent graph <run-id> --view <view>` produces compact graph views.
Supported views: `full`, `compact`, `critical-path`, `failures`, `evidence`,
`trust`, `topology`, `blackboard`, `candidate`, and `commit-gate`. Use
`--focus <id>` and `--depth <n>` to put the view on a node and the
nodes near it.

Compact views fold high-volume groups, topics, fanouts, fanins, message
clusters, and evidence chains into synthetic summary nodes. Each synthetic node
shows `collapsedNodeCount`, `collapsedEdgeCount`, `sourceIds`,
`dominantStatus`, an optional `blockedReason`, and an `expansionCommand`.

The critical path is always kept, and failures, blocked records,
conflicts, missing evidence, policy violations, and judge rationale are never
folded.

## CLI

```text
node scripts/cw.js summary refresh <run-id> [--json] [--view <view> ...]
node scripts/cw.js summary show <run-id> [--json]
node scripts/cw.js blackboard summarize <run-id> [--json]
node scripts/cw.js multi-agent summarize <run-id> [--json]
node scripts/cw.js multi-agent graph <run-id> --view compact [--json]
node scripts/cw.js multi-agent graph <run-id> --view critical-path [--json]
node scripts/cw.js multi-agent graph <run-id> --focus <id> --depth <n> [--json]
node scripts/cw.js report <run-id> --show
```

Every command supports deterministic JSON with `--json` or `--format json`.
Human output is organized into stable panels: State Size, Compact Graph,
Blackboard Digest, Critical Path, Failures / Blockers, Evidence Digest,
Trust / Policy Digest, Hidden Source Records, Expansion Commands, and Next
Action. JSON output is never quietly compacted; compaction is used only on
human views or when a compact view is clearly asked for.

When thresholds are gone past, human output by itself shows compact
summaries and tells the operator how to look at the full data, for example:

```text
Graph compacted: 420 nodes collapsed into 18 summary nodes
Use: node scripts/cw.js multi-agent graph <run-id> --view full --json
Use: node scripts/cw.js blackboard message list <run-id> --topic <topic-id>
```

## MCP parity

- `cw_summary_refresh`
- `cw_summary_show`
- `cw_blackboard_summarize`
- `cw_multi_agent_summarize`
- `cw_multi_agent_graph_compact`

MCP responses include source refs and expansion hints.

## Eval / replay integration

Eval snapshots take in summary artifacts, and replay comparison treats them as
regression-gated. Metrics: `summary_freshness`, `compact_graph_parity`,
`blackboard_digest_parity`, `critical_path_parity`, `evidence_digest_parity`,
and `expansion_ref_integrity`. The eval gate fails closed on stale summaries,
missing source refs, changed compact-graph shape, lost evidence refs, hidden
policy violations, lost judge rationale, changed critical path, and
summary/report mismatch.

## Trust and audit

Summary generation is recorded in the trust-audit log. `summary refresh` records
a `summary.refresh` event noting who or what made the summary, which scopes
were summarized, how many records were put in and left out, whether the summary
is deterministic, the source fingerprint, and whether it is stale. `summary
show` records a `summary.stale` event when the kept fingerprint no longer
matches current source state. Audit metadata never keeps secrets or large raw
message bodies.

## Freshness and fail-closed behavior

`summary show` works out the current source fingerprint again and compares it to the
kept record. If they are not the same, the report status is `stale`, stale scopes are
listed, and the next action is `summary refresh`. This keeps derived indexes
true: a summary is never trusted once its source records change.

## Migration

Pre-0.1.25 runs have no `summaries/` directory; `summary show` reports `absent`
and tells you to use `summary refresh`. Pre-0.1.25 eval snapshots load with empty
summary sections, so existing fixtures and replays stay backward compatible.
Newer unsupported run-state schemas still fail closed.
## CLI ↔ MCP Parity (v0.1.27)

Every command and tool named above is declared in the v0.1.27 capability
registry (`src/capability-registry.ts`) and checked by `npm run parity:check`,
so `cw <cmd> --json` and the matching `cw_<tool>` result show one data source.
See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).

## Run Registry / Control Plane (v0.1.28)

The runs talked about here are indexed, searchable, resumable, archivable, and
rerunnable across repos by the v0.1.28 Run Registry / Control Plane, which derives
a fingerprinted, fail-closed index over the same per-run `.cw/runs/<id>/state.json`
source of truth. See [run-registry-control-plane.7.md](run-registry-control-plane.7.md).

## Execution Backends (v0.1.29)

v0.1.29 lifts execution into a pluggable driver layer: one narrow `ExecutionBackend`
contract with swappable `node`/`bun`/`shell`/`container`/`remote`/`ci`
drivers, picked by `--backend` (parallel to `--sandbox`) and looked at through
`backend list|show|probe`. The result/evidence envelope is schema-identical across
backends; the backend id + sandbox attestation are recorded as provenance, so this
surface stays the same no matter which backend ran a run. See
[execution-backends.7.md](execution-backends.7.md).
## Web / Desktop Workbench (v0.1.30)

v0.1.30 adds the Web / Desktop Workbench: a read-only, localhost-only human
console that shows this surface (and the other four operator panels — run
graph, blackboard, worker logs, candidate compare, audit timeline) for any run,
reading the SAME capability `--json` payloads. It is a THIRD FRONT DOOR next to
the CLI and MCP that holds no authoritative state and forks no schema: each panel
equals its `cw <cmd> --json` payload byte-for-byte (parity-gated), and refresh
derives everything again from disk. See
[web-desktop-workbench.7.md](web-desktop-workbench.7.md).

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
derive durations, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and host-attested token/cost from existing durable run state
— no metrics database, no collector daemon, no hidden counter. Usage is additive
and optional (absent ⇒ `unreported`, never 0); cost is `attested` (attested usage
× a recorded pricing policy) or clearly `estimated`, with pricing as policy. Both
verbs are parity-gated and show read-only in the v0.1.30 Workbench. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).


## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — required approvals from
authorized roles, enforced inside `resolveCommitGate` AFTER the verifier checks
and never in place of them, failing closed on quorum/authority/self-approval and
recording who approved the very artifact that shipped. Policy (required approvals,
authorized roles, self-approval) is data, default off (pre-v0.1.32 behavior
not changed). The verbs are parity-gated and show read-only in the v0.1.30
Workbench. See [Team Collaboration](team-collaboration.7.md).

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a de-duplicated release gate. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really run (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is not there to use. See real-execution-backends(7).

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

capture findings/evidence from any sensible agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate stopping empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) instead of the changeable working tree — taking away false-red/false-green from working-tree writes at the same time (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter giving any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, measurable wrapper metrics, useful background full-review handoff, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_No changes to the state-explosion management surface in v0.1.81 (the module was cut into behavior-preserving siblings; output is byte-identical)._
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

_No behavioral change in v0.1.88 (the summarization/compaction layer and its fail-closed derived summaries are untouched)._

## 0.1.89 (v0.1.89)

_No behavioral change in v0.1.89 (CLI-surface golden-path + help-output fixes only; this subsystem is unchanged)._

0.1.90

0.1.91

0.1.93

0.1.94

0.1.95

0.1.96

0.1.97
