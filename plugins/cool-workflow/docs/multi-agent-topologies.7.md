# Multi-Agent Topologies

CW v0.1.19 adds the first official topology layer on top of the Multi-Agent
Runtime Core and Coordinator / Blackboard.

Topologies are userland recipes, not hidden automation. When you apply a
topology, it makes ordinary CW records: `MultiAgentRun`, roles, groups, fanouts,
fanins, blackboard topics, messages, coordinator decisions, audit events,
candidate links, selections, commits, and graph nodes.

## Official Topologies

- `map-reduce`: makes mapper roles, a reducer role, mapper fanout, mapper
  output topics, reducer synthesis topics, and fail-closed fanin readiness.
- `debate`: makes opposing roles, debate round topics, conflict context,
  coordinator claim decisions, and a final synthesis role.
- `judge-panel`: makes free judge roles, a panel chair, judge verdict
  topics, score aggregation expectations, and panel decision provenance.

## Contract

Each topology definition gives:

- roles and groups
- blackboard topics
- phases
- fanout and fanin strategy
- required evidence
- coordinator decision kinds
- candidate and scoring expectations
- verifier gates

Lasting topology run records are kept in:

```text
.cw/runs/<run-id>/topologies/index.json
.cw/runs/<run-id>/topologies/runs/<topology-run-id>.json
```

The topology record links to the made multi-agent run, roles, groups,
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

Apply commands are JSON-first. `summary` and `graph` also give human output
and `--json`.

## MCP

MCP parity tools:

- `cw_topology_list`
- `cw_topology_show`
- `cw_topology_validate`
- `cw_topology_apply`
- `cw_topology_summary`
- `cw_topology_graph`

There is no topology behavior that is made CLI-only on purpose.

## Fail Closed

Topology fanin uses the present `AgentFanin` checks. Required roles without
memberships, memberships without result evidence, and memberships without
indexed blackboard evidence stay blocked. A topology run can put forward the
next command, but it does not quietly mark missing evidence as complete.

For map-reduce, reducer readiness needs mapper evidence and blackboard
artifact refs. For debate, synthesis must cite messages, conflict context, and
coordinator decisions. For judge-panel, no judge output has authority until
fanin and score evidence back a panel decision.

## Operator UX

`status`, `report --show`, and `graph` take in topology progress:

- topology id and topology run id
- made multi-agent run and blackboard id
- roles, topics, fanouts, and fanins
- readiness and missing evidence
- conflicts
- deterministic next action

Trust audit summaries take in topology event counts, and audit provenance can
follow worker evidence into blackboard artifacts, fanin, candidate selection,
commits, and reports.

CW v0.1.22 adds policy-aware topology inspection. When you apply a topology, it
records role policies, message provenance, blackboard write audit, judge
rationale, panel decisions, and policy violations through the same trust-audit
log used by worker sandbox and evidence provenance records. Judge-panel
selection now needs evidence-backed judge rationale and panel-chair rationale.
0.1.51
