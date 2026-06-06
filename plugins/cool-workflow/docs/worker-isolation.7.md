# WORKER-ISOLATION(7)

## NAME

Worker Isolation - explicit path and contract boundary for dispatched CW workers

## SYNOPSIS

```ts
import {
  allocateWorkerScope,
  recordWorkerOutput,
  recordWorkerFailure
} from "./worker-isolation";

const scope = allocateWorkerScope(run, task, { dispatchId: task.dispatchId });
recordWorkerOutput(run, scope.id, scope.resultPath);
recordWorkerFailure(run, scope.id, "worker failed before producing output");
```

```text
node dist/cli.js worker list <run-id>
node dist/cli.js worker show <run-id> <worker-id>
node dist/cli.js worker output <run-id> <worker-id> <result-file>
```

## DESCRIPTION

Worker Isolation is the small boundary layer between dispatch manifests, worker
task prompts, worker-local files, result envelopes, StateNode records,
PipelineRunner verifier gates, ErrorFeedback, and reports.

It is not a process sandbox, container runtime, lease manager, or autonomous
agent spawner. CW still writes task artifacts. Operators or the agent host run
workers explicitly and return results through declared files.

The kernel owns only:

- worker scope allocation
- stable worker manifests
- worker-local path layout
- boundary validation
- output collection
- structured failure preservation

## WORKER MODEL

Dispatch moves runnable tasks to `running` and allocates one worker scope per
dispatched task. Each worker receives a plain input file and a result path.

The normal flow is:

```text
dispatch task -> worker scope -> worker.json/input.md -> result.md
-> result node -> verifier node -> commit/report
```

Worker output does not mutate shared run state directly. CW records accepted
output as result and verifier nodes after boundary checks pass.

## ISOLATION BOUNDARIES

Isolation is path and contract based.

Accepted output paths must be the declared `result.md`, inside the worker
`artifacts/` directory, inside the worker `logs/` directory, or inside an
explicitly allowed path passed by the runtime.

Out-of-scope output is rejected and preserved as:

- a failed or rejected worker scope
- an `error` StateNode
- an ErrorFeedback record with worker metadata

## FILES

```text
.cw/runs/<run-id>/workers/index.json
.cw/runs/<run-id>/workers/<worker-id>/worker.json
.cw/runs/<run-id>/workers/<worker-id>/input.md
.cw/runs/<run-id>/workers/<worker-id>/result.md
.cw/runs/<run-id>/workers/<worker-id>/artifacts/
.cw/runs/<run-id>/workers/<worker-id>/logs/
.cw/runs/<run-id>/nodes/
.cw/runs/<run-id>/feedback/
.cw/runs/<run-id>/report.md
```

`worker.json` is both the durable scope record and the worker manifest. New
fields should be optional where possible.

## FAILURE MODES

Missing result files are retryable worker failures.

Boundary violations are rejected worker outputs. They are not accepted into
result state.

Verifier failures remain verifier failures. Worker Isolation preserves the
worker directory and records feedback so the operator can inspect or correct the
result.

Corrupt run state, unknown workers, and unknown tasks are hard errors because
the runtime cannot proceed safely.

## EXAMPLES

List workers:

```text
node dist/cli.js worker list <run-id>
```

Show one worker:

```text
node dist/cli.js worker show <run-id> <worker-id>
```

Record worker output:

```text
node dist/cli.js worker output <run-id> <worker-id> .cw/runs/<run-id>/workers/<worker-id>/result.md
```

Record a failure:

```text
node dist/cli.js worker fail <run-id> <worker-id> --message "worker could not inspect assigned files"
```

## COMPATIBILITY

Worker Isolation is introduced in CW v0.1.5. It adds optional worker fields to
run paths, tasks, dispatch tasks, dispatch records, summaries, and run state.

Existing `plan`, `dispatch`, `result`, `node`, `contract`, and `feedback`
commands remain compatible. The legacy `result` command still accepts a task id
and result file. The stricter boundary-aware path is the `worker output`
command.
