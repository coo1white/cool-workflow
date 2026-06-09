# ERROR-FEEDBACK(7)

## NAME

Error Feedback Loop - inspectable diagnostic and correction state for Cool Workflow

## SYNOPSIS

```ts
import {
  collectRunErrors,
  createCorrectionTask,
  recordFeedback,
  resolveFeedback
} from "./error-feedback";

const records = collectRunErrors(run);
const task = createCorrectionTask(run, records[0].id, {
  verifierCommand: "npm test"
});
const resolved = resolveFeedback(run, records[0].id, {
  status: "resolved",
  nodeId: verifiedNode.id
});
```

## DESCRIPTION

The Error Feedback Loop is the small layer between structured failures and
operator correction. It records failures as durable JSON, classifies them with
plain identifiers, creates optional correction tasks, and resolves records only
after verifier evidence is present.

It does not repair code, retry stages, or own domain workflow behavior. Workflow
apps and operators decide how corrections are applied.

The loop follows:

```text
error -> classify -> feedback record -> correction task -> verify -> checkpoint
```

## FEEDBACK MODEL

Each feedback record is an `ErrorFeedbackRecord` with schema version `1`.
Important fields are:

- `id`
- `runId`
- `status`
- `severity`
- `classification`
- `source`
- `code`
- `message`
- `nodeId`
- `stageId`
- `contractId`
- `taskId`
- `path`
- `retryable`
- `evidence`
- `artifacts`
- `correctionTaskId`
- `resolvedByNodeId`
- `metadata`

The runtime also keeps `run.feedback` in `state.json` for quick inspection.

## FAILURE CLASSIFICATION

Classifications are stable, plain strings:

```text
contract-violation
verifier-failure
state-transition
missing-artifact
missing-evidence
parse-error
pipeline-failure
runtime-error
unknown
```

Classification is conservative. The feedback loop does not duplicate
`PipelineContract` validation logic; it classifies structured errors already
produced by StateNode, PipelineRunner, verifier, or CLI surfaces.

## CORRECTION TASKS

Correction tasks are normal task Markdown files under the run `tasks/`
directory. They include the original error, affected node/stage/contract,
evidence, expected verification command, and retry guidance.

Creating a correction task marks the feedback record as `tasked`. It does not
apply code changes.

Resolving feedback requires a node id whose status is `verified` or `committed`.
Rejected corrections are preserved by setting status to `rejected`.

## FILES

```text
.cw/runs/<run-id>/feedback/<feedback-id>.json
.cw/runs/<run-id>/feedback/index.json
.cw/runs/<run-id>/state.json
.cw/runs/<run-id>/tasks/feedback:<feedback-id>.md
.cw/runs/<run-id>/report.md
```

## EXAMPLES

Collect failed node errors:

```text
node dist/cli.js feedback collect <run-id>
```

List feedback records:

```text
node dist/cli.js feedback list <run-id>
```

Show one feedback record:

```text
node dist/cli.js feedback show <run-id> <feedback-id>
```

Create a correction task:

```text
node dist/cli.js feedback task <run-id> <feedback-id> --verify "npm test"
```

Resolve after a verified node:

```text
node dist/cli.js feedback resolve <run-id> <feedback-id> --node <verified-node-id>
```

All commands print stable JSON.

## COMPATIBILITY

Error Feedback is introduced in CW v0.1.4. It adds optional `feedback` state and
`feedbackDir` path metadata. Older runs remain readable; missing fields are
initialized when the run is loaded.

Existing workflow, node, contract, pipeline, and CLI behavior is preserved.
0.1.51
