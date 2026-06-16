# Multi-Agent Runtime Core

CW v0.1.17 made multi-agent runtime state a first-class thing. Dispatches and worker
records are still here, but now they have clear process-table-style state around
them: `MultiAgentRun`, `AgentRole`, `AgentGroup`, `AgentMembership`,
`AgentFanout`, and `AgentFanin`.

CW v0.1.18 adds blackboard and topic links to these records so that fanout,
worker manifests, accepted worker output, and fanin evidence can point to the
Coordinator / Blackboard substrate.

This release is the runtime core, not a self-acting scheduler. CW keeps and
checks the state model. The agent host still runs agents and keeps watch over
OS/process/network/environment controls.

## State Model

Multi-agent state is kept in lasting run state:

```text
.cw/runs/<run-id>/state.json
  multiAgent:
    schemaVersion: 1
    runs: []
    roles: []
    groups: []
    memberships: []
    fanouts: []
    fanins: []
```

CW also copies records to local JSON files:

```text
.cw/runs/<run-id>/multi-agent/
  index.json
  runs/<multi-agent-run-id>.json
  roles/<role-id>.json
  groups/<group-id>.json
  memberships/<membership-id>.json
  fanouts/<fanout-id>.json
  fanins/<fanin-id>.json
```

All records have fixed ids, timestamps, schema versions, lifecycle history,
parent/child links where they are needed, and metadata. Records link back to the
present workflow run, phase, task, dispatch, worker, result, verifier,
candidate, commit, and audit surfaces.

## Runtime Objects

`MultiAgentRun` is the top-level runtime table entry for joined-up agent work.
Its lifecycle is:

```text
planned -> forming -> running -> collecting -> verifying -> completed
```

It may also move to `failed` or `cancelled`. Bad lifecycle transitions fail
closed.

`AgentRole` says what the work is, the evidence needed, sandbox profile hints,
the artifacts looked for, and fanin duties.

`AgentGroup` is a joined-up set of members for a phase or part-problem. Groups
hold role, task, membership, worker, fanout, and fanin ids.

`AgentMembership` ties one role to one task and, once dispatched, one worker.
A worker can be part of one or more groups only through clear membership
records. A copy of the same group, role, task, and worker membership fails
closed.

`AgentFanout` records why work was split, which roles/tasks/workers were
made or joined, concurrency limits, sandbox profile choices, dispatch ids,
and the return shape looked for.

`AgentFanin` records the way work is brought together, required roles, members that reported,
members that are missing, evidence coverage, blocked reasons, and verifier readiness.
Fanin does not quietly take missing evidence for required roles.

## Dispatch Integration

Present dispatch and worker flows are still valid:

```bash
node scripts/cw.js dispatch <run-id> --limit 1 --sandbox readonly
```

To tie dispatch to clear multi-agent state:

```bash
node scripts/cw.js multi-agent run <run-id> --id ma-release --objective "release verification"
node scripts/cw.js multi-agent role <run-id> verifier \
  --multi-agent-run ma-release \
  --responsibility "verify release evidence" \
  --required-evidence "release-check log"
node scripts/cw.js multi-agent group <run-id> release-group \
  --multi-agent-run ma-release \
  --phase "Verify" \
  --task verify:package
node scripts/cw.js multi-agent fanout <run-id> release-fanout \
  --group release-group \
  --reason "split release verification" \
  --role verifier \
  --task verify:package \
  --limit 1 \
  --sandbox-choice verifier=readonly
node scripts/cw.js dispatch <run-id> \
  --limit 1 \
  --sandbox readonly \
  --multi-agent-run ma-release \
  --multi-agent-group release-group \
  --multi-agent-role verifier \
  --multi-agent-fanout release-fanout
```

Worker manifests then include:

```json
{
  "multiAgent": {
    "runId": "ma-release",
    "groupId": "release-group",
    "roleId": "verifier",
    "membershipId": "membership-id",
    "fanoutId": "release-fanout"
  }
}
```

When CW takes worker output, it updates linked membership evidence and records
multi-agent trust audit events.

## Fanin

Gather fanin after worker output:

```bash
node scripts/cw.js multi-agent fanin <run-id> release-fanin \
  --group release-group \
  --fanout release-fanout \
  --required-role verifier
```

If a required role has no membership, or a membership has not reported evidence,
the fanin record is `blocked` and `verifierReady=false`. This is done on purpose:
missing evidence is a state error, not a quiet success.

## Inspect

Use the everyday operator commands:

```bash
node scripts/cw.js status <run-id>
node scripts/cw.js graph <run-id>
node scripts/cw.js report <run-id> --show
node scripts/cw.js audit summary <run-id>
node scripts/cw.js audit provenance <run-id>
```

Use the more pointed multi-agent commands:

```bash
node scripts/cw.js multi-agent summary <run-id>
node scripts/cw.js multi-agent summary <run-id> --json
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js multi-agent graph <run-id> --json
node scripts/cw.js multi-agent show <run-id> <multi-agent-run-id>
node scripts/cw.js multi-agent role <run-id> <role-id>
node scripts/cw.js multi-agent group <run-id> <group-id>
node scripts/cw.js multi-agent membership <run-id> <membership-id>
node scripts/cw.js multi-agent fanout <run-id> <fanout-id>
node scripts/cw.js multi-agent fanin <run-id> <fanin-id>
```

The status and report Multi-Agent panel shows group status, role coverage,
membership health, fanout/fanin progress, blocked reasons, and the next
suggested action.

## MCP Parity

MCP read/inspect tools:

```text
cw_multi_agent_summary
cw_multi_agent_graph
cw_multi_agent_run_show
cw_multi_agent_role_show
cw_multi_agent_group_show
cw_multi_agent_membership_show
cw_multi_agent_fanout_show
cw_multi_agent_fanin_show
```

Safe write tools are:

```text
cw_multi_agent_run_create
cw_multi_agent_run_transition
cw_multi_agent_role_create
cw_multi_agent_group_create
cw_multi_agent_membership_create
cw_multi_agent_fanout_create
cw_multi_agent_fanin_collect
```

There is no MCP-only or CLI-only core model. The dogfood release script is still
CLI-only because it is a local release-engineering build made from present CW
tools, not a new runtime primitive.

## Compatibility

Older v0.1.16 and earlier run state is made regular with:

```json
{
  "multiAgent": {
    "schemaVersion": 1,
    "runs": [],
    "roles": [],
    "groups": [],
    "memberships": [],
    "fanouts": [],
    "fanins": []
  }
}
```

User data that is not known is kept safe. Fixtures are copied before compatibility tests,
and fixture files are not changed.
0.1.51
