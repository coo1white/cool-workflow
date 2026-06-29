# PIPELINE-VERBS(7)

## NAME

`cw plan`, `cw dispatch`, `cw result` — the three core pipeline engine verbs

## SYNOPSIS

```text
node dist/cli.js plan <workflow-id> [--question Q] [--repo PATH] [--sandbox PROFILE]
node dist/cli.js dispatch <run-id> [--sandbox PROFILE]
node dist/cli.js result <run-id> <task-id> <result-file>
```

## DESCRIPTION

These three verbs are the engine that drives every CW run. A run goes through
three stages: plan (get ready), dispatch (hand out work), and result (take work
back). Together they make the CW pipeline loop — a worker gets a task, does it,
and hands in a result file; CW checks the result and moves the run forward.

None of these verbs starts or stops the agent host. They give the control-plane
data that the host reads and acts on. The host keeps its own loop: call
`dispatch`, give the task to an agent, get back a result file, call `result`.

## PLAN

`cw plan <workflow-id>` makes a new run and gives back its canonical plan
summary in JSON. The plan has the run id, the first task (or tasks) to do,
the sandbox profile, and the state of the run.

The workflow id names a workflow app that gives the run its shape: inputs,
steps, evidence gates, and sandbox policy. Use `cw list` to see the workflow
apps you have.

The plan output is stable JSON, good for scripts and the agent host.

Options:
: `--question`, `--repo`, `--sandbox` — the same inputs the workflow app
expects. Different apps take different inputs; see `cw info <workflow-id>`
for the list.

## DISPATCH

`cw dispatch <run-id>` makes the next task ready for a worker. It gives back
a dispatch manifest in JSON: the task id, the prompt, the sandbox profile, and
the input and output paths the worker should use.

The dispatch picks the next runnable task in the pipeline. If no task is ready
— for example, all tasks are done or waiting on evidence — the dispatch payload
says so, and the host should wait or check the run status.

Options:
: `--sandbox PROFILE` — pick a sandbox profile for the worker. The default is
the one the workflow app asked for.

## RESULT

`cw result <run-id> <task-id> <result-file>` records a worker's result against
a task. The result file is a Markdown file the agent wrote — it must have a
`cw:result` JSON fence with the agent's `findings` and `evidence`.

CW accepts the result, checks it, and advances the run pipeline. If the result
is bad (missing, broken, or the evidence does not check out), CW rejects it and
gives back an error feedback record. The host can then try again or give the
task a different agent.

After `result`, the run may be done or have more tasks waiting. Check with
`cw status <run-id>` or `cw next <run-id>`.

## FILES

```text
.cw/runs/<run-id>/state.json
.cw/runs/<run-id>/dispatches/<dispatch-id>.json
.cw/runs/<run-id>/tasks/<task-id>.json
.cw/runs/<run-id>/results/<task-id>.md
.cw/runs/<run-id>/workers/<worker-id>/worker.json
```

## PIPELINE FLOW

```text
plan -> dispatch -> [agent does work] -> result -> [dispatch...] -> done
                                        └─ rejected -> feedback -> retry
```

## SEE ALSO

cw init — make a new workflow definition from nothing
cw status — see the current state of a run
cw next — find the next action for a run
pipeline-runner.7.md — the full pipeline engine detail
