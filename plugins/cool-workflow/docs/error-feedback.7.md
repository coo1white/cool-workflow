# ERROR-FEEDBACK(7)

## NAME

Error Feedback Loop - diagnostic and correction state you can look into for Cool Workflow

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
operator correction. It keeps failures as long-lasting JSON, gives them plain
identifiers, makes optional correction tasks, and clears records only after
verifier evidence is there.

It does not fix code, do stages again, or own domain workflow behavior. Workflow
apps and operators say how corrections are put to use.

The loop goes like this:

```text
error -> classify -> feedback record -> correction task -> verify -> checkpoint
```

## FEEDBACK MODEL

Each feedback record is an `ErrorFeedbackRecord` with schema version `1`.
The chief fields are:

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

The runtime also keeps `run.feedback` in `state.json` for a quick look.

## FAILURE CLASSIFICATION

Classifications are fixed, plain strings:

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

Classification is careful. The feedback loop does not copy the
`PipelineContract` validation logic; it gives identifiers to structured errors
already made by StateNode, PipelineRunner, verifier, or CLI surfaces.

## CORRECTION TASKS

Correction tasks are normal task Markdown files under the run `tasks/`
directory. They take in the first error, the touched node/stage/contract, the
evidence, the looked-for verification command, and help on doing it again.

Making a correction task marks the feedback record as `tasked`. It does not
make code changes.

To resolve feedback you need a node id whose status is `verified` or `committed`.
Turned-down corrections are kept by setting status to `rejected`.

## FILES

```text
.cw/runs/<run-id>/feedback/<feedback-id>.json
.cw/runs/<run-id>/feedback/index.json
.cw/runs/<run-id>/state.json
.cw/runs/<run-id>/tasks/feedback:<feedback-id>.md
.cw/runs/<run-id>/report.md
```

## EXAMPLES

Get together failed node errors:

```text
node dist/cli.js feedback collect <run-id>
```

List feedback records:

```text
node dist/cli.js feedback list <run-id>
```

Give one feedback record:

```text
node dist/cli.js feedback show <run-id> <feedback-id>
```

Create a correction task:

```text
node dist/cli.js feedback task <run-id> <feedback-id> --verify "npm test"
```

Clear it after a verified node:

```text
node dist/cli.js feedback resolve <run-id> <feedback-id> --node <verified-node-id>
```

All commands put out fixed JSON.

## COMPATIBILITY

Error Feedback comes in with CW v0.1.4. It adds optional `feedback` state and
`feedbackDir` path metadata. Older runs can still be read; missing fields are
started up when the run is loaded.

The workflow, node, contract, pipeline, and CLI behavior you have now is kept.
0.1.51
