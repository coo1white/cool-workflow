# MCP App Surface

Cool Workflow v0.1.13 completes the MCP bridge as a runtime surface for agent
hosts. The CLI remains the reference interface, and MCP exposes the same
operational contracts as explicit JSON tools.

The bridge follows CW's base-system discipline:

- old tool names remain compatible
- read-only inspection tools do not mutate state
- state-changing tools write durable run files
- inputs use stable names such as `runId`, `appId`, `workerId`,
  `candidateId`, `selectionId`, `profileId`, `cwd`, `reason`, `evidence`, and
  `criteria`
- errors fail closed through JSON-RPC errors and durable ErrorFeedback where the
  runtime already records feedback

## App Run Flow

Use `cw_app_list`, `cw_app_show`, and `cw_app_validate` to inspect app
contracts. `cw_app_package` writes a package artifact. `cw_app_run` creates a
run from a Workflow App SDK app id and structured inputs:

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

The result includes `runId`, workflow/app id and version, `statePath`,
`reportPath`, pending task count, compact operator status, next actions, and
the resolved sandbox profile when one was requested.

`cw_plan` remains the lower-level planning tool and returns the full run object
for compatibility.

## Worker Inspection

Worker isolation is first-class over MCP:

- `cw_worker_list`
- `cw_worker_show`
- `cw_worker_manifest`
- `cw_worker_validate`
- `cw_worker_output`
- `cw_worker_fail`
- `cw_worker_summary`

Worker records expose the worker id, task id, status, worker directory,
`input.md`, `result.md`, artifacts/logs directories, sandbox profile id,
sandbox policy, feedback ids, multi-agent metadata when present, and
result/verifier node ids.

An agent host should inspect `cw_worker_manifest`, write worker-local output to
the manifest `resultPath`, then call `cw_worker_output`. CW validates the
worker boundary, parses the `cw:result` block, creates result and verifier
nodes, updates the task, writes reports, and checkpoints state.

## Candidate Scoring

Candidate operations mirror the CLI:

- `cw_candidate_register`
- `cw_candidate_list`
- `cw_candidate_show`
- `cw_candidate_score`
- `cw_candidate_rank`
- `cw_candidate_select`
- `cw_candidate_reject`
- `cw_candidate_summary`

`cw_candidate_score` accepts structured `criteria` and evidence locators:

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

`cw_candidate_rank` and `cw_candidate_select` support the same
evidence/verifier-gate policy as the CLI with `requireEvidence`,
`requireVerifierGate`, `minNormalized`, and `allowUnverified`. Missing evidence
or verifier gates fail closed and produce structured feedback through the
candidate scoring layer.

## Sandbox Profiles

Existing sandbox tools remain:

- `cw_sandbox_list`
- `cw_sandbox_show`
- `cw_sandbox_validate`

v0.1.13 adds `cw_sandbox_choose` and `cw_sandbox_resolve` as read-only helpers
that validate and resolve `sandbox`, `sandboxProfile`, `sandboxProfileId`, or
`profileId` without dispatching work. `cw_dispatch` accepts all three sandbox
field spellings for compatibility with different hosts.

## Multi-Agent Runtime

v0.1.17 adds MCP parity for first-class multi-agent state.

v0.1.20 adds preferred host-facing tools for the full multi-agent loop:

- `cw_multi_agent_run`
- `cw_multi_agent_status`
- `cw_multi_agent_step`
- `cw_multi_agent_blackboard`
- `cw_multi_agent_score`
- `cw_multi_agent_select`

Use these when an agent host wants to drive `run -> status -> step ->
blackboard -> score -> select` without manually plumbing topology, blackboard,
candidate, and audit ids. The lower-level tools below remain advanced
primitives.

Read and inspect:

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

These tools mirror the CLI state model. CW records and validates roles, groups,
memberships, fanout/fanin, and lifecycle state; the host still executes agents
and enforces OS/process/network/environment controls.

## Verifier-Gated Commit

`cw_commit` accepts verifier-gate fields:

```json
{
  "runId": "run-id",
  "selection": "selection-id",
  "reason": "verified candidate selected"
}
```

It also supports `verifier`, `verifierNode`, `candidate`, `selection`,
`allowUnverifiedCheckpoint`, and `reason`. The MCP response includes `runId`,
`commitId`, `verifierGated`, `checkpoint`, verifier/candidate/selection ids,
`evidenceCount`, `snapshotPath`, next actions, and the underlying commit record.

Use `cw_commit_summary` for a read-only view of verifier-gated commits and
explicit checkpoints.

## Operator Views

MCP exposes structured JSON equivalents of Operator UX:

- `cw_operator_status`
- `cw_operator_graph`
- `cw_operator_report`
- `cw_worker_summary`
- `cw_candidate_summary`
- `cw_feedback_summary`
- `cw_commit_summary`
- `cw_multi_agent_summary`

These tools return JSON summaries instead of console text. `cw_operator_report`
refreshes the Markdown report the same way the CLI renderer does; the rest are
read-only inspection tools.

## CLI/MCP Parity

The CLI remains the easiest way for humans to drive a run. MCP is the stable
tool surface for agent hosts. New runtime capabilities should appear in both
surfaces, keep old names as aliases or wrappers, and use explicit JSON
contracts rather than host-specific policy hidden in the bridge.
