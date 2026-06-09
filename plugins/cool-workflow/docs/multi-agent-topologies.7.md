# Multi-Agent Topologies

CW v0.1.19 adds the first official topology layer on top of the Multi-Agent
Runtime Core and Coordinator / Blackboard.

Topologies are userland recipes, not hidden automation. Applying a topology
materializes ordinary CW records: `MultiAgentRun`, roles, groups, fanouts,
fanins, blackboard topics, messages, coordinator decisions, audit events,
candidate links, selections, commits, and graph nodes.

## Official Topologies

- `map-reduce`: creates mapper roles, a reducer role, mapper fanout, mapper
  output topics, reducer synthesis topics, and fail-closed fanin readiness.
- `debate`: creates opposing roles, debate round topics, conflict context,
  coordinator claim decisions, and a final synthesis role.
- `judge-panel`: creates independent judge roles, a panel chair, judge verdict
  topics, score aggregation expectations, and panel decision provenance.

## Contract

Each topology definition declares:

- roles and groups
- blackboard topics
- phases
- fanout and fanin strategy
- required evidence
- coordinator decision kinds
- candidate and scoring expectations
- verifier gates

Durable topology run records live in:

```text
.cw/runs/<run-id>/topologies/index.json
.cw/runs/<run-id>/topologies/runs/<topology-run-id>.json
```

The topology record links to the generated multi-agent run, roles, groups,
fanouts, fanins, blackboard topics, messages, coordinator decisions,
candidates, selections, commits, and trust audit events.

## CLI

```bash
node scripts/cw.js topology list
node scripts/cw.js topology show map-reduce
node scripts/cw.js topology validate map-reduce
node scripts/cw.js topology apply <run-id> map-reduce --task map:server-api --mapper-count 2
node scripts/cw.js topology summary <run-id>
node scripts/cw.js topology graph <run-id>
```

Apply commands are JSON-first. `summary` and `graph` also support human output
and `--json`.

## MCP

MCP parity tools:

- `cw_topology_list`
- `cw_topology_show`
- `cw_topology_validate`
- `cw_topology_apply`
- `cw_topology_summary`
- `cw_topology_graph`

There is no topology behavior that is intentionally CLI-only.

## Fail Closed

Topology fanin uses the existing `AgentFanin` checks. Required roles without
memberships, memberships without result evidence, and memberships without
indexed blackboard evidence remain blocked. A topology run can recommend the
next command, but it does not silently mark missing evidence as complete.

For map-reduce, reducer readiness requires mapper evidence and blackboard
artifact refs. For debate, synthesis must cite messages, conflict context, and
coordinator decisions. For judge-panel, no judge output is authoritative until
fanin and score evidence support a panel decision.

## Operator UX

`status`, `report --show`, and `graph` include topology progress:

- topology id and topology run id
- generated multi-agent run and blackboard id
- roles, topics, fanouts, and fanins
- readiness and missing evidence
- conflicts
- deterministic next action

Trust audit summaries include topology event counts, and audit provenance can
follow worker evidence into blackboard artifacts, fanin, candidate selection,
commits, and reports.

CW v0.1.22 adds policy-aware topology inspection. Applying a topology records
role policies, message provenance, blackboard write audit, judge rationale,
panel decisions, and policy violations through the same trust-audit log used by
worker sandbox and evidence provenance records. Judge-panel selection now
requires evidence-backed judge rationale and panel-chair rationale.
0.1.51
