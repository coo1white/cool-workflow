# Multi-Agent Runtime Core

CW v0.1.17 made multi-agent runtime state first-class. Dispatches and worker
records still exist, but they now have explicit process-table-style state around
them: `MultiAgentRun`, `AgentRole`, `AgentGroup`, `AgentMembership`,
`AgentFanout`, and `AgentFanin`.

CW v0.1.18 extends these records with blackboard and topic links so fanout,
worker manifests, accepted worker output, and fanin evidence can cite the
Coordinator / Blackboard substrate.

This release is the runtime core, not an autonomous scheduler. CW records and
validates the state model. The agent host still executes agents and enforces
OS/process/network/environment controls.

## State Model

Multi-agent state lives in durable run state:

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

CW also mirrors records to local JSON files:

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

All records carry stable ids, timestamps, schema versions, lifecycle history,
parent/child links where relevant, and metadata. Records link back to the
existing workflow run, phase, task, dispatch, worker, result, verifier,
candidate, commit, and audit surfaces.

## Runtime Objects

`MultiAgentRun` is the top-level runtime table entry for coordinated agent work.
Its lifecycle is:

```text
planned -> forming -> running -> collecting -> verifying -> completed
```

It may also move to `failed` or `cancelled`. Invalid lifecycle transitions fail
closed.

`AgentRole` describes responsibility, required evidence, sandbox profile hints,
expected artifacts, and fanin obligations.

`AgentGroup` is a coordinated set of members for a phase or subproblem. Groups
hold role, task, membership, worker, fanout, and fanin ids.

`AgentMembership` binds one role to one task and, once dispatched, one worker.
A worker can belong to one or more groups only through explicit membership
records. Duplicate membership for the same group, role, task, and worker fails
closed.

`AgentFanout` records why work was split, which roles/tasks/workers were
created or attached, concurrency limits, sandbox profile choices, dispatch ids,
and the expected return shape.

`AgentFanin` records aggregation strategy, required roles, reported members,
missing members, evidence coverage, blocked reasons, and verifier readiness.
Fanin does not silently accept missing evidence for required roles.

## Dispatch Integration

Existing dispatch and worker flows remain valid:

```bash
node scripts/cw.js dispatch <run-id> --limit 1 --sandbox readonly
```

To attach dispatch to explicit multi-agent state:

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

When CW accepts worker output, it updates linked membership evidence and records
multi-agent trust audit events.

## Fanin

Collect fanin after worker output:

```bash
node scripts/cw.js multi-agent fanin <run-id> release-fanin \
  --group release-group \
  --fanout release-fanout \
  --required-role verifier
```

If a required role has no membership, or a membership has not reported evidence,
the fanin record is `blocked` and `verifierReady=false`. This is intentional:
missing evidence is a state error, not an implicit success.

## Inspect

Use normal operator commands:

```bash
node scripts/cw.js status <run-id>
node scripts/cw.js graph <run-id>
node scripts/cw.js report <run-id> --show
node scripts/cw.js audit summary <run-id>
node scripts/cw.js audit provenance <run-id>
```

Use focused multi-agent commands:

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
recommended action.

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

Safe write tools:

```text
cw_multi_agent_run_create
cw_multi_agent_run_transition
cw_multi_agent_role_create
cw_multi_agent_group_create
cw_multi_agent_membership_create
cw_multi_agent_fanout_create
cw_multi_agent_fanin_collect
```

There is no MCP-only or CLI-only core model. The dogfood release script remains
CLI-only because it is a local release-engineering composition of existing CW
tools, not a new runtime primitive.

## Compatibility

Older v0.1.16 and earlier run state normalizes with:

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

Unknown user data is preserved. Fixtures are copied before compatibility tests,
and fixture files are not mutated.
0.1.51
