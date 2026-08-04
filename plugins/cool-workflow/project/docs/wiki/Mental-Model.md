# Mental Model

> If you read one page to see *why* Cool Workflow is shaped the way it is,
> read this one. The design test every feature must pass lives in AGENTS.md's
> [Product Direction & Moat](https://github.com/coo1white/cool-workflow/blob/main/AGENTS.md#product-direction--moat):
> **the model is fuel; CW is the dashboard, the black-box recorder, and the gearbox — never the engine.**

## The problem is not a dumb model

Most agent frameworks take a task as one long prompt and hope for the best.
For a quick one-off, that is fine. But the moment work gets **long, parallel,
or high-stakes**, that bet falls apart in the same ways every time:

- The work is lost in chat history. You can scroll it; you cannot *question* it.
- Subtasks fan out and disappear. Nobody can say which ran, or what they
  returned.
- Results come back with no trail — "done," with no answer to *why this
  answer, over which other options, under what rules.*
- Failure is invisible. When something is wrong you cannot replay it, cannot
  diff it, cannot point at the step that lied.

The natural move is to ask for a *smarter* model. That is usually the wrong
fix. What this work is missing is the **power to see, not IQ**. So CW treats
it as a **runtime problem** — the way an operating system keeps processes
safe and visible — not a model problem. We do not make the model smarter. We
make its work possible to read.

## One loop, repeated at every layer

The whole system is one idea, used from the top-level app down to a single
task:

```text
plan → dispatch → record evidence → verify → verifier-gated commit → report
```

A workflow app is *userland* (a program); the runtime is the *base system*
(the OS under it). The runtime records what happened; your agent still does
the work and enforces OS, process, and network controls.

## The four commitments

### 1. Model as fuel, not engine

CW **never calls a model API.** Worker execution always goes to an outside
agent — Claude, Codex, Gemini, or any backend you configure. This is a hard
line in the code itself (*"CW DELEGATES, IT DOES NOT BECOME THE EXECUTOR"*).
Handing the work out is the **feature**, not a gap:

- Your model keys and your code stay with you. CW has nothing to upload.
- The backend is a driver you can swap — node, shell, container, remote — and
  the core never learns which one ran a task. That is what keeps CW free of
  vendor lock-in.
- The value lives in the evidence and the decisions, not in the power to run
  a prompt.

### 2. Evidence-gated decisions — show your work, or no commit

A model saying "done" is not enough. Every result CW takes in keeps its full
trail: the **basis** (the sources), the **authority** (who decided), the
**rationale** (the stated reason), and the **counterfactual** (which other
option lost, and why). When that chain is missing, the result does *not*
quietly pass, and CW does *not* make up a reason — it comes to rest in a
clear `unexplained` state.

This is the direct cure for the three quiet ways agent work goes bad: the
**silent pass**, the **made-up reason**, and the **unexplained adoption**.
Only checked state becomes committed state.

### 3. Deterministic, local replay — all state, no magic

Every step is plain JSON under `.cw/runs/<id>/` — open to read, diff, resume,
and replay. There is no hidden dashboard database, and the runtime never
*guesses* success. The snapshot / diff / replay harness lets you re-run a
recorded session **with no live agents**, put it against a baseline, score
it, and gate a release on the outcome.

Deterministic here means: the same run, replayed, gives the same answer. That
is a hard requirement, not a nice extra — it is *why* CW keeps phases static.
Phases that change shape mid-run would buy flexibility but give up replay,
and replay is the wall that holds the weight.

### 4. Vendor-neutral portability — one kernel, many front doors

One source-of-truth manifest **generates** the per-vendor plugin adapters
(Claude, Codex, …) over one shared CLI + MCP (JSON-RPC 2.0) runtime, and a
fail-closed drift check in CI stops any adapter from forking the logic. You
do not get *zero* cost of moving between vendors — you get a **shared runtime
and a drift gate**, so the surfaces cannot quietly grow apart.

## When it is worth it — and when it is not

CW trades speed for a record you can check. You pay up front in task
structure; you get back trust, policy enforcement, and portability. That
trade is wise only when **the cost of being wrong is higher than the cost of
being explicit.**

**Worth the structure**
- Structured tasks with clear phases and decision gates.
- Workflows you repeat, where the cost of recording is paid back over many
  runs.
- High-stakes reviews that need evidence you can point to later.
- Cross-vendor work, where lock-in is a real risk.
- Release gates that need dry-run trust that replays the same way every time.

**Too much**
- One-off exploration — just run the prompt.
- Real-time back-and-forth work, where recording gets in the way.
- Tasks that must *change shape* mid-run — CW's static phases trade that
  flexibility for replay.

CW does not claim to fit every job. It is built for the cases where the added
cost pays back in trust you can measure.

## We eat our own cooking

CW's own `architecture-review` workflow audits CW's own repository, and
`release:check` gates releases on replay evidence instead of a human eye.
From the early releases through today, **every release made the record
deeper, the replay stronger, or the tool more portable — none made the model
smarter.** That was never the job.

---

**Next:** [Getting Started](Getting-Started.md) to run it ·
[Glossary](Glossary.md) for the words ·
[Trust And Audit](Trust-And-Audit.md) for exactly what is proven.
