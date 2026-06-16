# PIPELINE-RUNNER(7)

## NAME

Pipeline Runner - contract-driven StateNode execution kernel for Cool Workflow

## SYNOPSIS

```ts
import { createPipelineRunner } from "./pipeline-runner";

const runner = createPipelineRunner();
const contract = runner.getRunContract(run);
const runnable = runner.findRunnablePipelineStages(run, contract);

const result = runner.runPipelineStage(run, "verify", resultNode.id, {
  outputNodeId: `${run.id}:verifier:${task.id}`,
  outputStatus: "verified",
  evidence: resultNode.evidence
});
```

## DESCRIPTION

`Pipeline Runner` is the small execution kernel that sits between workflow
definitions, pipeline contracts, state nodes, and CW operations such as
dispatch, result, verifier, commit, and report.

The runner does not do business workflow behavior. It does only these things:
stage selection, contract validation, state-node transition, parent/child
linking, artifact and evidence attachment, and the keeping of structured
failures.

The runner uses CW helpers that are already there:

- `validatePipelineContract`
- `assertNodeSatisfiesContract`
- `transitionStateNode`
- `recordNodeError`
- `linkStateNodes`
- `appendRunNode`
- `upsertRunContract`

## EXECUTION MODEL

The default CW pipeline is:

```text
input -> plan -> dispatch -> result -> verify -> commit -> report
```

A stage run takes a `WorkflowRun`, a `stageId`, and an input `StateNode` id.
It finds the active `PipelineContract`, checks the stage, makes the output node
named by the contract, links input and output nodes, writes node JSON under
`nodes/`, and gives back a structured result.

The runner keeps a record of progress in files. There is no hidden
in-memory-only pipeline cursor.

## CONTRACTS

Stages come from `PipelineContract.stages`. A stage says which input node
kinds and statuses it takes, which artifacts and evidence it needs, what the
verifier gate needs, and the output node kind it makes.

The runner does not do contract validation a second time. It uses the StateNode
and PipelineContract helpers as the ABI boundary.

## FAILURE MODES

Contract failures turn into `StateNodeError` records. When the stage or contract
failure policy keeps failure nodes, the runner makes an `error` node, records
the structured error, links it to the input node, and keeps it under `nodes/`.

Unknown run ids, unknown contract ids, unknown node ids, unknown stage ids, and
broken state stay hard errors because the caller is not able to go on safely.

Commit stages are verifier-gated. The default contract needs a verified
verifier node with evidence before a `committed` commit node can be made.
Non-gated snapshots are written as `completed` checkpoint nodes outside the
commit stage.

## FILES

```text
.cw/runs/<run-id>/state.json
.cw/runs/<run-id>/nodes/<node-id>.json
.cw/runs/<run-id>/dispatches/*.json
.cw/runs/<run-id>/results/*.md
.cw/runs/<run-id>/commits/*.json
```

Commands that look at runs print stable JSON:

```text
cw.js contract show <run-id> [contract-id]
cw.js node list <run-id>
cw.js node show <run-id> <node-id>
cw.js node graph <run-id>
```

## EXAMPLES

Find runnable stages:

```ts
const stages = findRunnablePipelineStages(run);
```

Run a legal plan stage:

```ts
runPipelineStage(run, "plan", `${run.id}:input`, {
  outputNodeId: `${run.id}:task:${task.id}`,
  outputStatus: "pending",
  artifacts: [{ id: "task", kind: "markdown", path: task.taskPath }]
});
```

Keep a failed stage:

```ts
const failed = runPipelineStage(run, "commit", taskNode.id, {
  outputNodeId: `${run.id}:failed-commit`
});
```

## COMPATIBILITY

Pipeline Runner is first added in CW v0.1.3. It keeps v0.1.2 run state and
CLI behavior. New public types are plain TypeScript interfaces with optional
fields where it makes sense.

Older runs with no `nodes` or `contracts` stay readable through the existing
state loader, which sets up those arrays.
0.1.51
