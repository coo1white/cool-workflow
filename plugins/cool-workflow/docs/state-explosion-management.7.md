# State Explosion Management

CW v0.1.25 adds State Explosion Management. As multi-agent collaboration grows,
blackboard and graph output can become too large to read. This release adds a
first-class summarization and compaction layer that makes complex runs
understandable without hiding source truth.

CW v0.1.26 builds on this layer with the Evidence Adoption Reasoning Chain, which
reuses the same derived, fingerprinted, fail-closed discipline and whose
reasoning steps are exempt from the compaction described here. See
[evidence-adoption-reasoning-chain.7.md](evidence-adoption-reasoning-chain.7.md).

The design follows a base-system observability philosophy:

- raw state is the source of truth
- summaries are derived userland indexes, never replacements for source records
- plain files, stable JSON, deterministic output
- small composable commands and readable console views with full
  machine-readable output available
- fail closed when a summary is stale, incomplete, ambiguous, or loses
  provenance
- backward compatible; no hidden daemon; no lossy deletion of blackboard,
  graph, audit, or evidence records

## Derived summary model

Summary records are durable, versioned, and provenance-backed. Each carries
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
eval artifacts are never deleted or overwritten.

## Blackboard summarization

`blackboard summarize <run-id>` (MCP: `cw_blackboard_summarize`) returns a
deterministic structural digest with topic rollups, message thread summaries,
unresolved questions, conflicts, decisions, artifacts, adopted evidence,
missing evidence, policy violations, judge rationale, recent changes, and
high-signal records. Every entry preserves links back to source messages,
contexts, artifacts, snapshots, coordinator decisions, and audit events, plus an
expansion command for the raw records. Structural summaries exist without any
LLM output; any semantic summary must be explicit, provenance-backed, and
evidence-linked.

## Graph compaction

`multi-agent graph <run-id> --view <view>` produces compact graph views.
Supported views: `full`, `compact`, `critical-path`, `failures`, `evidence`,
`trust`, `topology`, `blackboard`, `candidate`, and `commit-gate`. Use
`--focus <id>` and `--depth <n>` to center the view on a node and its
neighborhood.

Compact views collapse high-volume groups, topics, fanouts, fanins, message
clusters, and evidence chains into synthetic summary nodes. Each synthetic node
exposes `collapsedNodeCount`, `collapsedEdgeCount`, `sourceIds`,
`dominantStatus`, an optional `blockedReason`, and an `expansionCommand`.

The critical path is always preserved, and failures, blocked records,
conflicts, missing evidence, policy violations, and judge rationale are never
collapsed.

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
Action. JSON output is never silently compacted; compaction is applied only to
human views or when a compact view is explicitly requested.

When thresholds are exceeded, human output automatically shows compact
summaries and tells the operator how to inspect the full data, for example:

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

Eval snapshots include summary artifacts, and replay comparison treats them as
regression-gated. Metrics: `summary_freshness`, `compact_graph_parity`,
`blackboard_digest_parity`, `critical_path_parity`, `evidence_digest_parity`,
and `expansion_ref_integrity`. The eval gate fails closed on stale summaries,
missing source refs, changed compact-graph shape, lost evidence refs, hidden
policy violations, lost judge rationale, changed critical path, and
summary/report mismatch.

## Trust and audit

Summary generation is recorded in the trust-audit log. `summary refresh` records
a `summary.refresh` event noting who or what generated the summary, which scopes
were summarized, how many records were included and omitted, whether the summary
is deterministic, the source fingerprint, and whether it is stale. `summary
show` records a `summary.stale` event when the persisted fingerprint no longer
matches current source state. Audit metadata never stores secrets or large raw
message bodies.

## Freshness and fail-closed behavior

`summary show` recomputes the current source fingerprint and compares it to the
persisted record. If they differ, the report status is `stale`, stale scopes are
listed, and the next action is `summary refresh`. This keeps derived indexes
honest: a summary is never trusted once its source records change.

## Migration

Pre-0.1.25 runs have no `summaries/` directory; `summary show` reports `absent`
and recommends `summary refresh`. Pre-0.1.25 eval snapshots load with empty
summary sections, so existing fixtures and replays remain backward compatible.
Newer unsupported run-state schemas still fail closed.
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
