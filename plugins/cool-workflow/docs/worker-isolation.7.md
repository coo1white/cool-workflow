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

Worker Isolation is the small boundary layer that sits between dispatch
manifests, worker task prompts, worker-local files, result envelopes, StateNode
records, PipelineRunner verifier gates, ErrorFeedback, and reports.

It is not a process sandbox, container runtime, lease manager, or autonomous
agent spawner. CW still writes task artifacts. Operators or the agent host run
workers themselves and send results back through named files.

The kernel keeps only these jobs:

- worker scope allocation
- stable worker manifests
- worker-local path layout
- sandbox profile selection and durable policy records
- boundary validation
- output collection
- structured failure preservation

## WORKER MODEL

Dispatch moves runnable tasks to `running` and gives one worker scope to each
dispatched task. Each worker gets a plain input file and a result path.

The normal flow is:

```text
dispatch task -> worker scope -> worker.json + manifest.json/input.md -> result.md
-> result node -> verifier node -> commit/report
```

Worker output does not change shared run state on its own. CW records accepted
output as result and verifier nodes after the boundary checks are passed.

## ISOLATION BOUNDARIES

Isolation is based on path and contract.

In CW v0.1.8, named Sandbox Profiles set the worker read paths, write paths,
command policy, network policy, environment policy, worker output allowances,
and host enforcement instructions. See `sandbox-profiles.7.md`.

Accepted output paths must be inside the selected profile's resolved
`writePaths`, the declared `result.md` when `workerOutput.result` is allowed,
inside `artifacts/` when `workerOutput.artifacts` is allowed, inside `logs/`
when `workerOutput.logs` is allowed, or inside an explicitly allowed path
passed by the legacy runtime policy.

Reads and writes are shown apart from each other. CW checks the accepted output
writes that it records. The agent host must enforce the real OS-level read and
write limits while the worker is running.

Out-of-scope output is rejected and kept as:

- a failed or rejected worker scope
- an `error` StateNode
- an ErrorFeedback record with worker and sandbox profile metadata

## FILES

```text
.cw/runs/<run-id>/workers/index.json
.cw/runs/<run-id>/workers/<worker-id>/worker.json
.cw/runs/<run-id>/workers/<worker-id>/manifest.json
.cw/runs/<run-id>/workers/<worker-id>/input.md
.cw/runs/<run-id>/workers/<worker-id>/result.md
.cw/runs/<run-id>/workers/<worker-id>/artifacts/
.cw/runs/<run-id>/workers/<worker-id>/logs/
.cw/runs/<run-id>/nodes/
.cw/runs/<run-id>/feedback/
.cw/runs/<run-id>/report.md
```

`worker.json` is the durable worker-scope state record. `manifest.json` is the
worker-facing view that hosts and agents read before they write `result.md`.
Keeping them apart stops a rebuilt manifest from writing over scope-only runtime
state such as retry counters, lifecycle metadata, or later operator notes. New
v0.1.8 worker records hold `sandboxProfileId`, `sandboxPolicy`, and a `sandbox`
host contract with `enforcedByCW` and `hostRequired`.

## FAILURE MODES

Missing result files are worker failures that can be retried.

Boundary violations are rejected worker outputs. They are not taken into result
state. Sandbox write denials use `sandbox-write-denied`; unknown and invalid
profiles use `sandbox-profile-not-found` and `sandbox-profile-invalid`.

Verifier failures stay verifier failures. Worker Isolation keeps the worker
directory and records feedback so the operator can look at or fix the result.

Corrupt run state, unknown workers, and unknown tasks are hard errors because
the runtime cannot go on safely.

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

Worker Isolation is first added in CW v0.1.5. It adds optional worker fields to
run paths, tasks, dispatch tasks, dispatch records, summaries, and run state.

Sandbox Profiles are first added in CW v0.1.8. The legacy `allowedPaths` field
is still there and now matches the effective write acceptance paths for older
hosts. New hosts should use `sandboxPolicy.readPaths`,
`sandboxPolicy.writePaths`, `sandboxPolicy.workerOutput`, and
`sandbox.hostRequired`.

The existing `plan`, `dispatch`, `result`, `node`, `contract`, and `feedback`
commands still work. The legacy `result` command still takes a task id and
result file. The stricter boundary-aware path is the `worker output` command.
0.1.51
