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
- candidate scoring records in `.cw/runs/<run-id>/candidates/`
- commit gate failures in `.cw/runs/<run-id>/feedback/`
- sandbox profile selections in worker, dispatch, feedback, and report state
- workflow app identity and version in `.cw/runs/<run-id>/state.json`
- golden path proof artifacts in temporary `.cw/runs/<run-id>/` workspaces

The practical rule is:

```text
prompt, task, dispatch, result, error, verifier decision, schedule, trigger
= state that can be inspected, replayed, snapshotted, or compared
```

This keeps the runtime deterministic and keeps agent work auditable.

## 2. Small Kernel, Composable Userland

CW should keep the kernel small. The kernel owns state transitions and stable
contracts; workflow apps own domain behavior.

Core system calls:

```text
plan()
dispatch()
recordResult()
verify()
commit()
report()
sandbox()
schedule()
trigger()
```

The kernel should avoid hard-coded business logic. New behavior should usually
enter as:

- a workflow app
- a workflow app manifest under `apps/<app-id>/app.json`
- a verifier
- a scheduler policy
- a routine trigger
- an external worker

Workflow App SDK v0.1.9 makes this split concrete. The runner is the base
system. Apps are userland: versioned, validated, inspectable definitions that
can be listed, shown, validated, initialized, packaged, planned, and reported
without depending on hidden runner internals.

The v0.1.10 `end-to-end-golden-path` app is intentionally boring userland. It
has one readonly worker task and exists to prove that the base system pipes are
connected.

## 3. Pipelines Over Monoliths

CW favors explicit data flow over hidden orchestration.

The standard pipeline is:

```text
workflow definition
-> app contract validation
-> validated input
-> task files
-> dispatch manifest
-> worker result
-> result envelope
-> verifier gate
-> verifier-gated commit or explicit checkpoint
-> report
```

Each stage should have a readable artifact. If a stage fails, its error output
should become input for the next correction step instead of disappearing into a
black box.

The release golden path is the regression form of this rule:

```text
npm run golden-path
```

It exercises the public CLI and then inspects state files for app metadata,
dispatch, worker manifest, result node, verifier node, candidate score, ranking,
selection, verifier-gated commit, report, and absence of ErrorFeedback.

## 4. Isolated Workers

Workers should be isolated by scope, state, and output.

Useful isolation layers:

- separate task prompts
- separate result files
- separate run directories
- separate workspace or sandbox directories for risky work
- separate score/evidence records for competing candidates
- named sandbox profiles for read/write/execute/network/env policy

Worker failure should not corrupt the workflow kernel. A failed worker is a
state transition, not a process-wide failure.

Sandbox Profiles keep policy explicit. CW stores the profile id and resolved
policy in durable state, validates paths, and accepts or rejects worker output
against the write policy. The agent host remains responsible for OS-level file
access, command execution, network access, and environment filtering.

## 5. Verifier-Gated Commits

CW should not merge every generated answer back into the main workflow state.
Generated work should pass through evidence and verifier gates first.

The preferred merge rule is:

```text
only verified state becomes committed state
```

For competing branches, the shape is:

```text
candidate workers -> score records -> verifier-gated selection
-> verifier-gated commit()
```

Non-gated snapshots are checkpoints. They are allowed as audit and resume
records, but reports and commit records must not present them as verifier-gated
committed state.

## 6. Practical Operating Rule

```text
The kernel provides deterministic pipes.
Workers explore in isolation.
Verifiers decide what may be committed.
Hosts enforce runtime sandbox policy.
```

This keeps CW small, inspectable, and extensible.
