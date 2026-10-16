# End-to-End Golden Path

Cool Workflow v0.1.10 added a deterministic golden path. It proves the base
system is joined up, from workflow app planning, through verifier-gated commit,
to report generation.

Run it from the plugin root:

```bash
cd plugins/cool-workflow
npm run golden-path
```

The command uses only Node.js standard library APIs and the public CW CLI. It
does not use the network, sleeps, hidden daemon state, or real subagents.

v0.1.13 adds `test/mcp-app-surface-smoke.js`. This is a near deterministic proof
that drives the same app/worker/commit/operator chain over MCP stdio
JSON-RPC, in place of direct CLI commands.

## What It Proves

The runner works through this chain:

```text
workflow app -> plan -> dispatch -> isolated worker -> verifier
-> gated commit -> report
```

It uses the first-class `end-to-end-golden-path` app in
`apps/end-to-end-golden-path/`. The app has one phase and one worker task that
needs evidence, with the `readonly` sandbox profile.

## CLI Surface

The runner runs the same public commands that an operator would use:

```bash
cw app validate end-to-end-golden-path
cw plan end-to-end-golden-path --repo <tmp> --question "..."
cw dispatch <run-id> --limit 1 --sandbox readonly
cw worker manifest <run-id> <worker-id>
cw worker output <run-id> <worker-id> <result.md>
cw commit <run-id> --verifier <verifier-node-id> \
  --reason "golden path verifier-gated commit"
cw report <run-id>
cw status <run-id>
cw graph <run-id>
cw report <run-id> --show
```

After dispatch, the script reads the worker manifest it made, and writes a
good Markdown result to the worker's named `result.md`. The result has in it
a `cw:result` JSON fence with file:line evidence.

The commit names the verifier node the accepted worker output made. Up to
the multi-agent family's removal the path went through `cw candidate
register|score|rank|select` and `cw commit --selection`; those verbs are
gone (see release-and-migration(7), "Removed Surfaces").

## Files Written

The runner makes a temporary workspace under the OS temp directory:

```text
<tmp>/
  golden-evidence.md
  .cw/runs/<run-id>/
    state.json
    report.md
    tasks/
    dispatches/
    workers/<worker-id>/
      input.md
      worker.json
      manifest.json
      result.md
    results/
    nodes/
    commits/
```

By default the workspace is kept on disk, so you can look at the report and
state. Tests run the same script with `--cleanup`.

## Invariants

The golden path checks durable state, not just exit codes:

- run state has the workflow app id and version metadata in it
- MCP hosts can do the flow again with `cw_app_run`, `cw_dispatch`,
  `cw_worker_manifest`, `cw_worker_output`, `cw_commit`, and operator
  summary tools
- dispatch keeps a record of a worker id and `readonly` sandbox profile
- the worker manifest has the worked-out sandbox policy data in it
- the worker gets to `verified`
- result and verifier nodes are there
- the verifier node holds evidence
- the last commit has `verifierGated: true` and `checkpoint: false`
- the last commit points to the verifier node and evidence
- the report names the workflow app and the verifier-gated commit
- operator status, graph, report, and summary commands can look at the run
- no ErrorFeedback records are made

If this command fails, one of the base integration contracts is broken.
0.1.51
