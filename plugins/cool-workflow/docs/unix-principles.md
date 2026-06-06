# Unix-Inspired Workflow Principles

CW borrows a small set of durable systems ideas and applies them to agent
workflow engineering. These are design principles, not platform claims.

## 1. Everything Is State

Every meaningful workflow event should be represented as inspectable state.

CW already stores:

- workflow runs in `.cw/runs/<run-id>/state.json`
- task prompts in `.cw/runs/<run-id>/tasks/`
- dispatch manifests in `.cw/runs/<run-id>/dispatches/`
- result envelopes in `.cw/runs/<run-id>/results/`
- state snapshots in `.cw/runs/<run-id>/commits/`
- schedules in `.cw/schedules/tasks.json`
- routine trigger events in `.cw/routines/`

The practical rule is:

```text
prompt, task, dispatch, result, error, verifier decision, schedule, trigger
= state that can be inspected, replayed, snapshotted, or compared
```

This keeps the runtime deterministic and keeps agent work auditable.

## 2. Small Kernel, Composable Userland

CW should keep the kernel small. The kernel owns state transitions and contracts;
workflow apps own domain behavior.

Core system calls:

```text
plan()
dispatch()
recordResult()
verify()
commit()
report()
schedule()
trigger()
```

The kernel should avoid hard-coded business logic. New behavior should usually
enter as:

- a workflow app
- a verifier
- a scheduler policy
- a routine trigger
- an external worker

## 3. Pipelines Over Monoliths

CW favors explicit data flow over hidden orchestration.

The standard pipeline is:

```text
workflow definition
-> validated input
-> task files
-> dispatch manifest
-> worker result
-> result envelope
-> verifier gate
-> state commit
-> report
```

Each stage should have a readable artifact. If a stage fails, its error output
should become input for the next correction step instead of disappearing into a
black box.

## 4. Isolated Workers

Workers should be isolated by scope, state, and output.

Useful isolation layers:

- separate task prompts
- separate result files
- separate run directories
- separate workspace or sandbox directories for risky work
- separate score/evidence records for competing candidates

Worker failure should not corrupt the workflow kernel. A failed worker is a
state transition, not a process-wide failure.

## 5. Verifier-Gated Commits

CW should not merge every generated answer back into the main workflow state.
Generated work should pass through evidence and verifier gates first.

The preferred merge rule is:

```text
only verified state becomes committed state
```

For competing branches, the future shape is:

```text
candidate workers -> verifier scores -> selected winner -> commit()
```

## 6. Practical Operating Rule

```text
The kernel provides deterministic pipes.
Workers explore in isolation.
Verifiers decide what may be committed.
```

This keeps CW small, inspectable, and extensible.
