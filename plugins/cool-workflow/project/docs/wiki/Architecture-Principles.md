# Architecture Principles

*The rules CW is built on, and the reasons for them. To use CW you do not
need this page — start at [Getting Started](Getting-Started.md). For the
parts of the system, see [Architecture](Architecture.md).*

CW takes its ideas from old, tested systems work (Unix, and FreeBSD most of
all) without trying to be a copy of Unix. The short form:

```text
Small kernel.
Explicit state.
Composable pipes.
Isolated workers.
Verifier-gated commits.
```

## 1. Everything important is state

Every important event in a run is put on disk as state you can read:

- the question and the inputs,
- each task, and the dispatch that sent it out,
- each worker's result, and each error,
- each verifier decision,
- each commit and checkpoint,
- each trust-audit event.

It all lives under `.cw/runs/<run-id>/` as plain JSON and Markdown. You can
read it, compare two runs, resume it, replay one step of it, and use it as
evidence in the report. There is no hidden database.

## 2. A small kernel

The runtime (the kernel) has a small, fixed set of jobs:

```text
plan()  dispatch()  recordResult()  verify()  commit()  report()
schedule()  trigger()
```

The work itself lives outside the kernel: in workflow apps (what to do), in
the agent you configure (who does it), and in wrappers under
`scripts/agents/` (how each vendor's CLI is called). The kernel gives
**mechanism**; the **policy** — which model, which prices, which agent — is
yours. Code for one vendor never goes into the kernel.

## 3. Pipelines, not one big block

A run goes through one fixed line of steps, and each step leaves a file or a
state record behind:

```text
workflow app
-> checked inputs
-> task files
-> dispatch manifest
-> worker result (result.md)
-> result envelope, checked
-> verifier gate
-> verifier-gated commit, or a plain checkpoint
-> report
```

If any step fails, you can see which one, and why.

## 4. Isolated workers

A worker that goes wrong may not damage the kernel. Each worker gets:

- its own task input and its own output folder,
- a sandbox profile that says what it may read, write, run, and reach,
- a result envelope that CW checks before it takes anything in.

CW checks and records the sandbox profile, and refuses output that breaks
it. Stopping the agent process itself (files, network, other processes) is
the agent host's work — or, from 0.3.3, the job of Anthropic's sandbox
runtime `srt`, which CW can run each agent inside when you set
`CW_AGENT_SANDBOX=srt`. See `cw man sandbox-profiles`.

## 5. Verifier-gated commits

The last rule:

```text
only verified state becomes committed state
```

A verifier-gated commit needs a verifier node with `verified` status and
evidence. Output that is not checked stays a result or a checkpoint. It
never becomes committed state by chance.

## 6. Fail closed

When something is missing or wrong, CW says no in a clear way. It does not
make up a success, and it does not quietly go around the problem:

- no agent configured: the run is `blocked`;
- an agent that keeps failing: the worker is `parked` after 3 tries (after
  1 try if it went past its time limit, from 0.3.3);
- a result with no evidence, or evidence that names a file not on disk: the
  result is turned down;
- an index or snapshot that no longer matches its source: it is reported
  `stale`, never used.

## 7. The agent edge is a contract

CW gives the work to an outside agent, so the line between CW and the agent
has hard rules (the agent contract has the name `cw-agent/1`; see
`cw man agent-delegation-drive`):

- **Output schema.** A task may give a JSON `schema` for its result. CW
  checks the result against it with a small checker that has no
  dependencies; a result that does not match is turned down, and the worker
  is tried again, then parked. Parts of JSON Schema it does not know (such as
  `$ref` or `pattern`) are let go by, and never reported as "passed".
- **Token budget.** `limits.tokenBudget` is checked against the token use
  the agent *reported*. When the budget is used up, the next agent is not
  started (`blocked`); work already taken in is never taken back.
- **A one-way wall.** CW takes only plain data from the agent, never code
  it could call. The type `OneWayData<T>` in `src/core/types/boundary.ts`
  makes this part of the build: a function put into a result type breaks
  `npm run build`.

## 8. Many agents side by side

A phase made with `parallel()` sends out its tasks at the same time, up to
`limits.maxConcurrentAgents`. When some agents fail, hang, or give back
bad output:

- **Every agent is waited for.** A failure does not stop the others; it
  only keeps the next phase from starting.
- **A hung agent is stopped.** At its time limit (`CW_AGENT_TIMEOUT_MS`, 10
  minutes by default), CW stops the agent's whole process group, so a
  wrapper script and every process it started go together. From 0.3.3 you
  can also set `CW_AGENT_IDLE_TIMEOUT_MS` to stop an agent that writes
  nothing for that long.
- **The record is in a fixed order.** Results are saved in task order, not
  in the order the agents ended, so a replay gives the same bytes.

## 9. Mechanism apart from policy

The capability registry (`src/core/capability-data.ts`) is one table: each
row is one thing CW can do, with its CLI command and its MCP tool. Both
front doors read that one table, and a check (`npm run parity:check`) fails
the release if they go out of step. See
[MCP And Manifests](MCP-And-Manifests.md).

## 10. What CW will not do

- **No model calls in the kernel.** CW never imports a model SDK, never
  holds your keys, and never calls a model API. Your agent does that.
- **No hidden dashboard as the truth.** Every index and report is a view
  worked out from the files on disk; delete them and nothing is lost.
- **No guessed success.** A missing reason or missing evidence is a clear
  stop, not a pass.
- **No runtime dependencies.** The CLI and the MCP server run on Node.js
  alone.

## Related Pages

- [Architecture](Architecture.md)
- [Mental Model](Mental-Model.md)
- [Origin Story](Origin-Story.md)
- [Run Registry Control Plane](Run-Registry-Control-Plane.md)
