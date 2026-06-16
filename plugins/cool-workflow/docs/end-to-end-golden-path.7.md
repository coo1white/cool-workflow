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
that drives the same app/worker/candidate/commit/operator chain over MCP stdio
JSON-RPC, in place of direct CLI commands.

## What It Proves

The runner works through this chain:

```text
workflow app -> plan -> dispatch -> isolated worker -> candidate scoring
-> verifier -> gated commit -> report
```

It uses the first-class `end-to-end-golden-path` app in
`apps/end-to-end-golden-path/`. The app has one phase and one worker task that
needs evidence, with the `readonly` sandbox profile.

## CLI Surface

The runner runs the same public commands that an operator would use:

```bash
node scripts/cw.js app validate end-to-end-golden-path
node scripts/cw.js plan end-to-end-golden-path --repo <tmp> --question "..."
node scripts/cw.js dispatch <run-id> --limit 1 --sandbox readonly
node scripts/cw.js worker manifest <run-id> <worker-id>
node scripts/cw.js worker output <run-id> <worker-id> <result.md>
node scripts/cw.js candidate register <run-id> --worker <worker-id> --id golden-candidate
node scripts/cw.js candidate score <run-id> golden-candidate \
  --criterion correctness=4 \
  --criterion evidence=4 \
  --criterion fit=2 \
  --maxTotal 10 \
  --evidence <file:line>
node scripts/cw.js candidate rank <run-id>
node scripts/cw.js candidate select <run-id> golden-candidate --reason "golden path verified"
node scripts/cw.js commit <run-id> --selection <selection-id> \
  --reason "golden path verifier-gated commit"
node scripts/cw.js report <run-id>
node scripts/cw.js status <run-id>
node scripts/cw.js graph <run-id>
node scripts/cw.js report <run-id> --show
```

After dispatch, the script reads the worker manifest it made, and writes a
good Markdown result to the worker's named `result.md`. The result has in it
a `cw:result` JSON fence with file:line evidence.

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
    candidates/
      golden-candidate/
        scores/
      ranking.json
    commits/
```

By default the workspace is kept on disk, so you can look at the report and
state. Tests run the same script with `--cleanup`.

## Invariants

The golden path checks durable state, not just exit codes:

- run state has the workflow app id and version metadata in it
- MCP hosts can do the flow again with `cw_app_run`, `cw_dispatch`,
  `cw_worker_manifest`, `cw_worker_output`, `cw_candidate_score`,
  `cw_candidate_select`, `cw_commit`, and operator summary tools
- dispatch keeps a record of a worker id and `readonly` sandbox profile
- the worker manifest has the worked-out sandbox policy data in it
- the worker gets to `verified`
- result and verifier nodes are there
- the verifier node holds evidence
- `golden-candidate` gets to `verified` after selection
- candidate score and ranking files are there
- the last commit has `verifierGated: true` and `checkpoint: false`
- the last commit points to the selection, candidate, verifier node, and
  evidence
- the report names the workflow app, candidates, and verifier-gated commit
- operator status, graph, report, and summary commands can look at the run
- no ErrorFeedback records are made

If this command fails, one of the base integration contracts is broken.
0.1.51
