# End-to-End Golden Path

Cool Workflow v0.1.10 added a deterministic golden path that proves the base
system is connected from workflow app planning through verifier-gated commit and
report generation.

Run it from the plugin root:

```bash
cd plugins/cool-workflow
npm run golden-path
```

The command uses only Node.js standard library APIs and the public CW CLI. It
does not use the network, sleeps, hidden daemon state, or real subagents.

v0.1.13 adds `test/mcp-app-surface-smoke.js`, a sibling deterministic proof
that drives the same app/worker/candidate/commit/operator chain over MCP stdio
JSON-RPC instead of direct CLI commands.

## What It Proves

The runner exercises this chain:

```text
workflow app -> plan -> dispatch -> isolated worker -> candidate scoring
-> verifier -> gated commit -> report
```

It uses the first-class `end-to-end-golden-path` app in
`apps/end-to-end-golden-path/`. The app has one phase and one evidence-required
worker task with the `readonly` sandbox profile.

## CLI Surface

The runner performs the same public commands an operator would use:

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

After dispatch, the script reads the generated worker manifest and writes a
valid Markdown result to the worker's declared `result.md`. The result contains
a `cw:result` JSON fence with file:line evidence.

## Files Written

The runner creates a temporary workspace under the OS temp directory:

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
      result.md
    results/
    nodes/
    candidates/
      golden-candidate/
        scores/
      ranking.json
    commits/
```

By default the workspace is left on disk so the report and state can be
inspected. Tests run the same script with `--cleanup`.

## Invariants

The golden path asserts durable state, not just exit codes:

- run state includes workflow app id and version metadata
- MCP hosts can reproduce the flow with `cw_app_run`, `cw_dispatch`,
  `cw_worker_manifest`, `cw_worker_output`, `cw_candidate_score`,
  `cw_candidate_select`, `cw_commit`, and operator summary tools
- dispatch records a worker id and `readonly` sandbox profile
- the worker manifest includes resolved sandbox policy data
- the worker reaches `verified`
- result and verifier nodes exist
- the verifier node carries evidence
- `golden-candidate` reaches `verified` after selection
- candidate score and ranking files exist
- the final commit has `verifierGated: true` and `checkpoint: false`
- the final commit references the selection, candidate, verifier node, and
  evidence
- the report mentions the workflow app, candidates, and verifier-gated commit
- operator status, graph, report, and summary commands can inspect the run
- no ErrorFeedback records are produced

If this command fails, one of the base integration contracts is broken.
0.1.51
