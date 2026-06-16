# MCP App Surface

Cool Workflow v0.1.13 makes the MCP bridge complete as a runtime surface for agent
hosts. The CLI is still the chief interface, and MCP gives the same
working contracts as clear JSON tools.

The bridge keeps to CW's base-system rules:

- old tool names still work
- read-only inspection tools do not change state
- state-changing tools write run files that last
- inputs use fixed names such as `runId`, `appId`, `workerId`,
  `candidateId`, `selectionId`, `profileId`, `cwd`, `reason`, `evidence`, and
  `criteria`
- errors fail closed through JSON-RPC errors and lasting ErrorFeedback where the
  runtime already keeps feedback

## App Run Flow

Use `cw_app_list`, `cw_app_show`, and `cw_app_validate` to look at app
contracts. `cw_app_package` writes a package artifact. `cw_app_run` makes a
run from a Workflow App framework app id and ordered inputs:

```json
{
  "appId": "end-to-end-golden-path",
  "cwd": "/repo",
  "inputs": {
    "question": "Prove the MCP runtime surface."
  },
  "sandbox": "readonly"
}
```

The result has `runId`, workflow/app id and version, `statePath`,
`reportPath`, waiting task count, short operator status, next actions, and
the worked-out sandbox profile when one was asked for.

`cw_plan` is still the lower-level planning tool and gives back the full run object
so old uses keep working.

## Worker Inspection

Worker isolation is fully supported over MCP:

- `cw_worker_list`
- `cw_worker_show`
- `cw_worker_manifest`
- `cw_worker_validate`
- `cw_worker_output`
- `cw_worker_fail`
- `cw_worker_summary`

Worker records show the worker id, task id, status, worker directory,
`input.md`, `result.md`, artifacts/logs directories, sandbox profile id,
sandbox policy, feedback ids, multi-agent metadata when there is some, and
result/verifier node ids.

An agent host should look at `cw_worker_manifest`, write worker-local output to
the manifest `resultPath`, then call `cw_worker_output`. CW checks the
worker boundary, reads the `cw:result` block, makes result and verifier
nodes, brings the task up to date, writes reports, and checkpoints state.

## Candidate Scoring

Candidate operations are the same as the CLI:

- `cw_candidate_register`
- `cw_candidate_list`
- `cw_candidate_show`
- `cw_candidate_score`
- `cw_candidate_rank`
- `cw_candidate_select`
- `cw_candidate_reject`
- `cw_candidate_summary`

`cw_candidate_score` takes ordered `criteria` and evidence locators:

```json
{
  "runId": "run-id",
  "candidateId": "candidate-one",
  "criteria": { "correctness": 4, "evidence": 4, "fit": 2 },
  "maxTotal": 10,
  "evidence": ["docs/mcp-app-surface.7.md:1"],
  "verdict": "pass",
  "notes": "Evidence-backed candidate."
}
```

`cw_candidate_rank` and `cw_candidate_select` keep the same
evidence/verifier-gate policy as the CLI with `requireEvidence`,
`requireVerifierGate`, `minNormalized`, and `allowUnverified`. When evidence
or verifier gates are not there, they fail closed and give ordered feedback through the
candidate scoring layer.

## Sandbox Profiles

The sandbox tools that are already there stay:

- `cw_sandbox_list`
- `cw_sandbox_show`
- `cw_sandbox_validate`

v0.1.13 adds `cw_sandbox_choose` and `cw_sandbox_resolve` as read-only helpers
that check and work out `sandbox`, `sandboxProfile`, `sandboxProfileId`, or
`profileId` without sending out work. `cw_dispatch` takes all three sandbox
field spellings so it works with different hosts.

## Multi-Agent Runtime

v0.1.17 adds MCP parity for fully supported multi-agent state.

v0.1.20 adds host-facing tools that are now the right ones to use for the full multi-agent loop:

- `cw_multi_agent_run`
- `cw_multi_agent_status`
- `cw_multi_agent_step`
- `cw_multi_agent_blackboard`
- `cw_multi_agent_score`
- `cw_multi_agent_select`

Use these when an agent host wants to drive `run -> status -> step ->
blackboard -> score -> select` without joining up topology, blackboard,
candidate, and audit ids by hand. The lower-level tools below are still
deeper primitives.

v0.1.22 adds audit parity for multi-agent trust:

- `cw_audit_multi_agent`
- `cw_audit_policy`
- `cw_audit_role`
- `cw_audit_blackboard`
- `cw_audit_judge`

These tools show role policies, permission decisions, blackboard write audit,
message provenance, judge reasons, panel decisions, and policy breaks in
fixed JSON.

v0.1.24 adds eval/replay parity for multi-agent regression gates:

- `cw_eval_snapshot`
- `cw_eval_replay`
- `cw_eval_compare`
- `cw_eval_score`
- `cw_eval_gate`
- `cw_eval_report`

These tools make replay snapshots, run separate replays, put side by side normalized
baseline/replay records, score metrics, fail closed on regressions, and give back
artifact paths in fixed JSON.

v0.1.25 adds State Explosion Management parity for large multi-agent runs:

- `cw_summary_refresh`
- `cw_summary_show`
- `cw_blackboard_summarize`
- `cw_multi_agent_summarize`
- `cw_multi_agent_graph_compact`

These tools refresh lasting, versioned summary records, read the stale-aware
state-explosion report, give back the blackboard digest, and give back compact or
focused graph views with made-up summary nodes. Every response keeps source
refs and expansion hints and never takes away raw blackboard, graph, audit, or
evidence records.

Read and look at:

- `cw_multi_agent_summary`
- `cw_multi_agent_graph`
- `cw_multi_agent_run_show`
- `cw_multi_agent_role_show`
- `cw_multi_agent_group_show`
- `cw_multi_agent_membership_show`
- `cw_multi_agent_fanout_show`
- `cw_multi_agent_fanin_show`

Safe writes:

- `cw_multi_agent_run_create`
- `cw_multi_agent_run_transition`
- `cw_multi_agent_role_create`
- `cw_multi_agent_group_create`
- `cw_multi_agent_membership_create`
- `cw_multi_agent_fanout_create`
- `cw_multi_agent_fanin_collect`

These tools are the same as the CLI state model. CW keeps and checks roles, groups,
memberships, fanout/fanin, and lifecycle state; the host still runs agents
and puts in force OS/process/network/environment controls.

## Verifier-Gated Commit

`cw_commit` takes verifier-gate fields:

```json
{
  "runId": "run-id",
  "selection": "selection-id",
  "reason": "verified candidate selected"
}
```

It also takes `verifier`, `verifierNode`, `candidate`, `selection`,
`allowUnverifiedCheckpoint`, and `reason`. The MCP response has `runId`,
`commitId`, `verifierGated`, `checkpoint`, verifier/candidate/selection ids,
`evidenceCount`, `snapshotPath`, next actions, and the commit record under it.

Use `cw_commit_summary` for a read-only view of verifier-gated commits and
named checkpoints.

## Operator Views

MCP gives ordered JSON forms equal to Operator UX:

- `cw_operator_status`
- `cw_operator_graph`
- `cw_operator_report`
- `cw_worker_summary`
- `cw_candidate_summary`
- `cw_feedback_summary`
- `cw_commit_summary`
- `cw_multi_agent_summary`

These tools give back JSON summaries in place of console text. `cw_operator_report`
refreshes the Markdown report the same way the CLI renderer does; the rest are
read-only inspection tools.

## CLI/MCP Parity

The CLI is still the easiest way for people to drive a run. MCP is the steady
tool surface for agent hosts. New runtime powers should come up in both
surfaces, keep old names as aliases or wrappers, and use clear JSON
contracts in place of host-specific policy hidden in the bridge.
0.1.51
