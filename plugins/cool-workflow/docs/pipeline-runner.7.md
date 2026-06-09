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

`Pipeline Runner` is the small execution kernel between workflow definitions,
pipeline contracts, state nodes, and CW operations such as dispatch, result,
verifier, commit, and report.

The runner does not implement business workflow behavior. It owns only stage
selection, contract validation, state-node transition, parent/child linking,
artifact and evidence attachment, and structured failure preservation.

The runner uses existing CW helpers:

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

A stage run receives a `WorkflowRun`, a `stageId`, and an input `StateNode` id.
It resolves the active `PipelineContract`, validates the stage, creates the
output node declared by the contract, links input and output nodes, writes node
JSON under `nodes/`, and returns a structured result.

The runner records progress in files. There is no hidden in-memory-only
pipeline cursor.

## CONTRACTS

Stages come from `PipelineContract.stages`. A stage declares accepted input node
kinds and statuses, required artifacts, required evidence, verifier gate
requirements, and the produced output node kind.

The runner does not duplicate contract validation. It uses the StateNode and
PipelineContract helpers as the ABI boundary.

## FAILURE MODES

Contract failures become `StateNodeError` records. When the stage or contract
failure policy preserves failure nodes, the runner creates an `error` node,
records the structured error, links it to the input node, and persists it under
`nodes/`.

Unknown run ids, unknown contract ids, unknown node ids, unknown stage ids, and
corrupt state remain hard errors because the caller cannot proceed safely.

Commit stages are verifier-gated. The default contract requires a verified
verifier node with evidence before a `committed` commit node can be created.
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

Inspection commands print stable JSON:

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

Preserve a failed stage:

```ts
const failed = runPipelineStage(run, "commit", taskNode.id, {
  outputNodeId: `${run.id}:failed-commit`
});
```

## COMPATIBILITY

Pipeline Runner is introduced in CW v0.1.3. It preserves v0.1.2 run state and
CLI behavior. New public types are plain TypeScript interfaces with optional
fields where practical.

Older runs without `nodes` or `contracts` remain readable through the existing
state loader, which initializes those arrays.
0.1.51
