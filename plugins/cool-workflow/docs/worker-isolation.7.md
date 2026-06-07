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
node dist/cli.js worker manifest <run-id> <worker-id>
node dist/cli.js worker output <run-id> <worker-id> <result-file>
node dist/cli.js dispatch <run-id> --sandbox readonly
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
- sandbox profile selection and durable policy records
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

In CW v0.1.8, named Sandbox Profiles define the worker read paths, write paths,
command policy, network policy, environment policy, worker output allowances,
and host enforcement instructions. See `sandbox-profiles.7.md`.

Accepted output paths must be inside the selected profile's resolved
`writePaths`, the declared `result.md` when `workerOutput.result` is allowed,
inside `artifacts/` when `workerOutput.artifacts` is allowed, inside `logs/`
when `workerOutput.logs` is allowed, or inside an explicitly allowed path
passed by the legacy runtime policy.

Reads and writes are represented separately. CW validates accepted output writes
it records. The agent host must enforce actual OS-level read/write restrictions
while the worker is running.

Out-of-scope output is rejected and preserved as:

- a failed or rejected worker scope
- an `error` StateNode
- an ErrorFeedback record with worker and sandbox profile metadata

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
fields should be optional where possible. New v0.1.8 worker records include
`sandboxProfileId`, `sandboxPolicy`, and a `sandbox` host contract with
`enforcedByCW` and `hostRequired`.

## FAILURE MODES

Missing result files are retryable worker failures.

Boundary violations are rejected worker outputs. They are not accepted into
result state. Sandbox write denials use `sandbox-write-denied`; unknown and
invalid profiles use `sandbox-profile-not-found` and `sandbox-profile-invalid`.

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

Sandbox Profiles are introduced in CW v0.1.8. The legacy `allowedPaths` field
remains available and now mirrors effective write acceptance paths for older
hosts. New hosts should prefer `sandboxPolicy.readPaths`,
`sandboxPolicy.writePaths`, `sandboxPolicy.workerOutput`, and
`sandbox.hostRequired`.

Existing `plan`, `dispatch`, `result`, `node`, `contract`, and `feedback`
commands remain compatible. The legacy `result` command still accepts a task id
and result file. The stricter boundary-aware path is the `worker output`
command.
