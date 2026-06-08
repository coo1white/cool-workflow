# Coordinator / Blackboard

CW v0.1.18 adds the Coordinator / Blackboard layer. Multi-Agent Runtime Core is
the process table; the blackboard is the shared coordination filesystem.

CW v0.1.25 adds `blackboard summarize <run-id>` (MCP: `cw_blackboard_summarize`),
a deterministic blackboard digest with topic rollups, thread summaries,
unresolved questions, conflicts, decisions, artifacts, adopted and missing
evidence, policy violations, judge rationale, recent changes, and high-signal
records. The digest is a derived userland index: it preserves links back to
source messages, contexts, artifacts, snapshots, coordinator decisions, and
audit events, and never deletes raw records. See
[state-explosion-management.7.md](state-explosion-management.7.md).

This release defines stable primitives for shared context, messages, artifact
indexing, snapshots, and coordinator decisions. It does not implement debate,
judge, map-reduce, swarm, committee, or synthesis topologies yet. Those
topologies should consume this substrate later.

## State Model

Blackboard state lives in run state:

```text
.cw/runs/<run-id>/state.json
  blackboard:
    schemaVersion: 1
    boards: []
    topics: []
    messages: []
    contexts: []
    artifacts: []
    snapshots: []
    decisions: []
```

Runtime objects are:

- `Blackboard`
- `BlackboardTopic`
- `BlackboardMessage`
- `BlackboardContext`
- `BlackboardArtifactRef`
- `BlackboardSnapshot`
- `CoordinatorDecision`

Every record carries schema version, stable id, timestamps, author/source,
scope, status, parent references, tags, metadata, and links back to workflow,
multi-agent, worker, task, candidate, verifier, commit, audit, and evidence
records where applicable.

## Storage Layout

CW mirrors blackboard state to durable local files:

```text
.cw/runs/<run-id>/blackboard/
  index.json
  messages.jsonl
  topics/<topic-id>.json
  contexts/<context-id>.json
  artifacts/<artifact-ref-id>.json
  snapshots/<snapshot-id>.json
  decisions/<decision-id>.json
```

`messages.jsonl` is append-friendly. `index.json` is regenerated
deterministically from run state. CW does not store secrets or raw environment
values in blackboard metadata.

## Context Semantics

Shared context supports:

- `fact`
- `constraint`
- `assumption`
- `question`
- `decision`

Context updates do not silently overwrite older records. If a new update has
the same topic, kind, and key as an active context record but a different value,
CW marks the records `conflicting` and records a `CoordinatorDecision`.

Use `--supersedes <context-id>` to intentionally replace older context. The
older record is marked `superseded`, and the new record links to it.

## Artifact Index

`BlackboardArtifactRef` indexes worker outputs, logs, result files, evidence
locators, generated artifacts, reports, commit snapshots, and external paths.

Artifact refs include kind, path or locator, owner, source, provenance,
evidence refs, checksum when the path is a readable file, and trust audit links.
Existing `StateArtifact` records remain valid; blackboard refs bridge them into
shared coordination state instead of replacing them.

## Multi-Agent Integration

`MultiAgentRun`, groups, roles, memberships, fanout, and fanin can link to a
blackboard id and topic ids. Worker manifests for blackboard-enabled work
include:

```json
{
  "blackboard": {
    "id": "bb-release",
    "topicIds": ["release-evidence"],
    "indexPath": ".cw/runs/<run-id>/blackboard/index.json",
    "messagesPath": ".cw/runs/<run-id>/blackboard/messages.jsonl"
  }
}
```

Accepted worker output can publish result summaries and artifacts into the
blackboard. Fanin can require indexed blackboard evidence and fails closed when
required role memberships have no blackboard message or artifact refs.

## CLI

```bash
node scripts/cw.js blackboard summary <run-id>
node scripts/cw.js blackboard graph <run-id>
node scripts/cw.js blackboard resolve <run-id> --id bb --title "Shared state"
node scripts/cw.js blackboard topic create <run-id> --id topic --title "Synthesis"
node scripts/cw.js blackboard message post <run-id> --topic topic --body "..."
node scripts/cw.js blackboard message list <run-id> [--topic topic]
node scripts/cw.js blackboard context put <run-id> --topic topic --kind fact --key k --value v
node scripts/cw.js blackboard artifact add <run-id> --topic topic --path result.md --kind worker-result
node scripts/cw.js blackboard artifact list <run-id>
node scripts/cw.js blackboard snapshot <run-id>
node scripts/cw.js coordinator summary <run-id>
node scripts/cw.js coordinator decision <run-id> --kind conflict-resolution --outcome accepted --reason "..."
```

The CLI is JSON-friendly by default for focused blackboard and coordinator
commands.

## MCP Parity

MCP exposes matching tools:

```text
cw_blackboard_summary
cw_blackboard_graph
cw_blackboard_resolve
cw_blackboard_topic_create
cw_blackboard_message_post
cw_blackboard_message_list
cw_blackboard_context_put
cw_blackboard_artifact_add
cw_blackboard_artifact_list
cw_blackboard_snapshot
cw_coordinator_summary
cw_coordinator_decision
```

There is no intentional CLI-only behavior for core blackboard operations.

## Operator UX

`status`, `report --show`, and graph output include a Blackboard / Coordinator
panel. It shows topics, message counts, open questions, conflicts, missing
evidence, artifact counts, snapshot paths, ready-for-fanin state, and next
recommended action.

Use:

```bash
node scripts/cw.js status <run-id>
node scripts/cw.js graph <run-id>
node scripts/cw.js report <run-id> --show
node scripts/cw.js audit summary <run-id>
node scripts/cw.js audit provenance <run-id>
```

## Migration

Older v0.1.17 and earlier runs normalize with empty blackboard state and a
`.cw/runs/<run-id>/blackboard/` path. Unknown user data is preserved.

Newer unsupported run-state schemas still fail closed.
