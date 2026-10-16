# MCP App Surface

Cool Workflow v0.1.13 makes the MCP bridge complete as a runtime surface for agent
hosts. The CLI is still the chief interface, and MCP gives the same
working contracts as clear JSON tools.

The bridge keeps to CW's base-system rules:

- old tool names still work
- read-only inspection tools do not change state
- state-changing tools write run files that last
- inputs use fixed names such as `runId`, `appId`, `workerId`,
  `profileId`, `cwd`, and `reason`
- errors fail closed through JSON-RPC errors and lasting ErrorFeedback where the
  runtime already keeps feedback
- a failed `tools/call` (a bad tool name, a missing needed value, or the
  tool's own code failing) comes back as a normal result shaped
  `{ content: [...], isError: true }`, with a `Try: <hint>` line when one
  applies, not a bare JSON-RPC error — so a host that does not show
  protocol errors to the model still lets it read the message and try
  again

## Control and Tool Processes

The MCP parent process reads JSON-RPC, writes JSON-RPC, and answers `ping`.
One child process runs `tools/call` work in order. A file lock wait or a long
agent call in that child does not stop the parent from answering `ping`.

The child sends back the same JSON text that the old in-process tool call gave
back. Tool names, input names, output shapes, run files, and CLI parity stay
the same.

If the child stops during a tool call, CW gives an `isError: true` result for
that call. CW does not run the call again, because it may have written part of
a run. Read the saved run state before you try the call again. The next tool
call starts a new child process.

When stdin ends, CW keeps the ordered tool queue to its end and then stops the
child. This lets a client send a last batch and close stdin without losing its
replies. On `SIGINT` or `SIGTERM`, CW stops the child at once and then ends by
the same signal. A tool waiting on a file lock cannot wake later and write
state after its parent has ended.

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
sandbox policy, feedback ids, and result/verifier node ids.

An agent host should look at `cw_worker_manifest`, write worker-local output to
the manifest `resultPath`, then call `cw_worker_output`. CW checks the
worker boundary, reads the `cw:result` block, makes result and verifier
nodes, brings the task up to date, writes reports, and checkpoints state.

## Sandbox Profiles

The sandbox tools that are already there stay:

- `cw_sandbox_list`
- `cw_sandbox_show`
- `cw_sandbox_validate`

v0.1.13 adds `cw_sandbox_choose` as a read-only helper
that checks and work out `sandbox`, `sandboxProfile`, `sandboxProfileId`, or
`profileId` without sending out work. `cw_dispatch` takes all three sandbox
field spellings so it works with different hosts.

## Verifier-Gated Commit

`cw_commit` takes verifier-gate fields:

```json
{
  "runId": "run-id",
  "verifier": "run-id:verifier:task-id",
  "reason": "verified result"
}
```

It also takes `verifierNode`, `allowUnverifiedCheckpoint`, and `reason`. The
MCP response has `runId`, `commitId`, `verifierGated`, `checkpoint`, the
verifier node id, `evidenceCount`, `snapshotPath`, and the commit record under
it.

Use `cw_commit_summary` for a read-only view of verifier-gated commits and
named checkpoints.

## Operator Views

MCP gives ordered JSON forms equal to Operator UX:

- `cw_operator_status`
- `cw_operator_graph`
- `cw_operator_report`
- `cw_worker_summary`
- `cw_feedback_summary`
- `cw_commit_summary`

These tools give back JSON summaries in place of console text. `cw_operator_report`
refreshes the Markdown report the same way the CLI renderer does; the rest are
read-only inspection tools.

## Run Reports

`cw_report` renders a run's report and gives back `{ path }`, the same
JSON as `cw report <run-id> --json`. Two MCP-only arguments give a model
the answer in one call, with no second file read:

- `answer: true` adds `answer`: `{ taskId, summary, evidence }`, the
  report's "## Answer" part, or `null` when the run has no completed
  verdict or synthesis task yet.
- `markdown: true` adds `markdown`, the full text of report.md.

With neither, the result is byte-identical to before they existed.

The server also gives run reports as MCP resources, and `initialize`
declares `capabilities: { tools: {}, resources: {} }`:

- `resources/list` names every run under `<server cwd>/.cw/runs/` that has a
  report.md, as `cw://runs/<run-id>/report.md` (`text/markdown`), oldest
  run first.
- `resources/read` with that URI gives the file's text as it is on disk.
  It never renders a report; `cw_report` does that.

These fail closed: a URI of any other form or with an unsafe run id is
error -32602, a run with no report.md (or one that is not a plain file) is
-32002 with a `Try: cw_report` line, and a `CW_MCP_ENABLED_TOOLS` /
`CW_MCP_DISABLED_TOOLS` policy that turns `cw_report` off turns both
methods off (-32601).

## Tool Profile

`tools/list` gives only the `core` profile by default: `cw_app_list`,
`cw_app_show`, `cw_app_run`, `cw_run_drive_step`, `cw_status`, `cw_report`,
`cw_run_resume`, `cw_run_list`, `cw_audit_verify`, `cw_backend_probe`,
`cw_run_export`, `cw_run_restore`. These take a client from picking an app
to a checked, saved report, and keep the list small (about 6.7 KB in place of
about 104 KB). Start the server with `CW_MCP_TOOLS=full` to list every tool;
any other value stops server start. The profile is not a permission: every
tool this page names can still be called with `tools/call`. A
`CW_MCP_ENABLED_TOOLS` / `CW_MCP_DISABLED_TOOLS` policy, when set, decides the
list in place of the profile. See cli-mcp-parity(7), "MCP Tool Profile".

## CLI/MCP Parity

The CLI is still the easiest way for people to drive a run. MCP is the steady
tool surface for agent hosts. New runtime powers should come up in both
surfaces, keep old names as aliases or wrappers, and use clear JSON
contracts in place of host-specific policy hidden in the bridge.

## Implementation

The app-management surface (`listWorkflows`, `listApps`, `showApp`,
`validateApp`, `initApp`, `packageApp`) lives on the `CoolWorkflowRunner`
facade as thin delegators with no logic of their own. Their bodies sit in
`src/shell/workflow-app-loader.ts` as pure functions — the same v0.1.40
router pattern used by the other `src/orchestrator/*-operations.ts` modules.
The runner-owned calls (`resolveFromBase`, `validateApp`) are passed in as
callbacks so the moved bodies stay byte-for-byte the same. The public method
names, signatures, and return types do not change, so the CLI/MCP parity gate
stays green.
0.1.51
