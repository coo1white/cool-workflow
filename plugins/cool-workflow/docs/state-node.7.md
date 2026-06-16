# STATE-NODE(7)

## NAME

StateNode, PipelineContract - inspectable CW runtime state and pipeline ABI

## SYNOPSIS

```ts
import {
  assertNodeSatisfiesContract,
  createStateNode,
  transitionStateNode
} from "./state-node";
import { createDefaultPipelineContract } from "./pipeline-contract";

const contract = createDefaultPipelineContract();
const result = createStateNode({
  kind: "result",
  status: "completed",
  loopStage: "observe",
  artifacts: [{ id: "result", kind: "markdown", path: "/repo/.cw/runs/run/results/task.md" }],
  evidence: [{ id: "result", locator: "/repo/src/file.ts:42" }]
});

assertNodeSatisfiesContract(result, contract, "verify");
const verified = transitionStateNode(result, { status: "verified", loopStage: "adjust" });
```

## DESCRIPTION

`StateNode` is the small runtime object used to show important CW transitions as JSON. It is not a workflow app model and it does not hold domain behavior.

The kernel owns node creation, clear status transitions, artifact paths, contract checks, and structured errors. Workflow apps own prompts, phase order, and the reading of domain-specific meaning.

CW writes node JSON artifacts in:

```text
.cw/runs/<run-id>/nodes/
```

The common flow is:

```text
input node -> task node -> dispatch node -> result node -> verifier node -> commit/report node
```

## CONTRACT

Every `StateNode` includes `schemaVersion`, `id`, `kind`, `status`, `loopStage`, timestamps, `inputs`, `outputs`, `artifacts`, `evidence`, `errors`, `parents`, `children`, optional `contractId`, and optional `metadata`.

Every `PipelineContract` includes `schemaVersion`, `id`, `title`, `stages`, optional input/output schemas, artifact/evidence/failure/commit policies, and compatibility bounds.

Each stage names the input node kinds and statuses it takes, the output kind it makes, required artifacts, required evidence, verifier gate, and retry/failure behavior.

## FAILURE MODES

Contract failures come up as `PipelineContractError`. Each error carries a structured `StateNodeError` with:

- `code`
- `message`
- `at`
- optional `nodeId`
- optional `path`
- optional `retryable`
- optional `details`

Illegal status transitions fail before they change the node. Missing artifacts and missing evidence fail with error records you can locate, ready for saving into a failure node.

Commit status is verifier-gated. A node cannot transition into `committed` unless it is already `verified`.

## COMPATIBILITY

`schemaVersion` is required on both nodes and contracts. The current schema is `1`.

New fields should be optional unless the runtime cannot go on without them. Older run state without `nodes` or `contracts` can still be read; those arrays are set up when loaded.

## EXAMPLES

Create a failure node:

```ts
const failed = recordNodeError(node, {
  code: "missing-required-evidence",
  message: "Verifier stage requires evidence",
  path: "/repo/.cw/runs/run/results/task.md",
  retryable: true
});
```

Link a verifier node to a commit node:

```ts
const [verifier, commit] = linkStateNodes(verifierNode, commitNode);
```
0.1.51
