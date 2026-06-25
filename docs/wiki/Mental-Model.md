# Mental Model

> If you read one page to understand *why* Cool Workflow is shaped the way it is, read this one.
> The design test every feature must pass lives in
> [`DIRECTION.md`](https://github.com/coo1white/cool-workflow/blob/main/DIRECTION.md):
> **the model is fuel; CW is the dashboard, the black-box recorder, and the gearbox — never the engine.**

## The problem isn't a dumb model

Most agent frameworks take a task as one long prompt and hope for the best. For a quick one-off, that's
fine. But the moment work gets **long, parallel, or high-stakes**, the bet falls apart in predictable
ways:

- The work is lost in chat history. You can scroll it; you can't *question* it.
- Subtasks fan out and disappear. Nobody can say which ran, or what they returned.
- Results arrive with no provenance — "done," with no answer to *why this answer, over which
  alternatives, under what policy.*
- Failure is invisible. When something is wrong you can't replay it, can't diff it, can't point at the
  step that lied.

The instinct is to ask for a *smarter* model. That's usually the wrong fix. What this work lacks is the
**power to see, not IQ**. So CW treats it as a **runtime problem** — the way an operating system makes
processes durable and inspectable — not a modeling problem. We don't make the model smarter. We make
its work legible.

## One loop, repeated at every layer

The whole system is a single idea, applied from the top-level app down to a single task:

```text
plan → dispatch → record evidence → verify → verifier-gated commit → report
```

A workflow app is *userland*; the runtime is the *base system*. The runtime records what happened; your
agent still executes the work and enforces OS/process/network controls.

## The four commitments

### 1. Model as fuel, not engine

CW **never calls a model API.** Worker execution is always delegated to an outside agent — Claude,
Codex, Gemini, or any backend you configure. This is a hard line in the code itself
(*"CW DELEGATES, IT DOES NOT BECOME THE EXECUTOR"*). Delegation is the **feature**, not a gap:

- Your model credentials and your code stay with you. CW has nothing to upload.
- The backend is a driver you can swap — node, shell, container, remote — and the kernel never learns
  which one ran a task. That's what keeps CW **vendor-neutral**.
- The value lives in the evidence and the decisions, not in the power to run a prompt.

### 2. Evidence-gated decisions — show your work or don't commit

A model saying "done" is not enough. Every adopted result keeps its provenance: the **basis** (the
references), the **authority** (who decided), the **rationale** (the stated reason), and the
**counterfactual** (which alternative lost, and why). When that chain is missing, the result does *not*
quietly pass and CW does *not* fabricate a reason — it comes to rest in an explicit `unexplained` state.

This is the direct cure for the three quiet failure modes of agent work: the **silent pass**, the
**fabricated rationale**, and the **unexplained adoption**. Only verified state becomes committed state.

### 3. Deterministic, local replay — all state, no magic

Every step is plain JSON under `.cw/runs/<id>/` — open to read, diff, resume, and replay. There is no
hidden dashboard database, and the runtime never *guesses* success. The snapshot / diff / replay
harness lets you re-run a recorded session **without live agents**, compare it to a baseline, score it,
and gate a release on the outcome.

Determinism is a hard requirement, not a nicety — it's *why* CW keeps phases static. Phases that mutate
mid-run would buy flexibility but give up reproducible replay, and replay is the wall that holds the
weight.

### 4. Vendor-neutral portability — one kernel, many front doors

A single source-of-truth manifest **generates** the per-vendor plugin adapters (Claude, Codex, …) over
one shared CLI + MCP (JSON-RPC 2.0) runtime, and a fail-closed drift check in CI stops any adapter from
forking the logic. You don't get *zero* switching cost — you get a **shared runtime and a drift gate**,
so surfaces can't quietly diverge.

## When it's worth it — and when it isn't

CW trades speed for auditability. You pay up front in task structure; you get back trust, policy
enforcement, and portability. That trade is wise only when **your cost of being wrong is higher than
your cost of being explicit.**

**Worth the structure**
- Structured tasks with clear phases and decision gates.
- Repeatable workflows, where the cost of recording is amortized over many runs.
- High-stakes reviews that need evidence you can point to later.
- Cross-vendor work, where lock-in is a real risk.
- Release gates that need deterministic, dry-run trust.

**Overkill**
- One-off exploration — just run the prompt.
- Real-time interactive work, where recording gets in the way.
- Tasks that must *change shape* mid-run — CW's static phases trade that flexibility for replay.

CW doesn't pretend to be one-size-fits-all. It's built for the high-confidence cases where the added
cost pays back in trust you can measure.

## We eat our own cooking

CW's own `architecture-review` workflow audits CW's own repository, and `release:check` gates releases
on replay evidence instead of a human eye. From early releases through today, **every release deepened
auditability, reproducibility, or portability — none made the model smarter.** That was never the job.

---

**Next:** [Getting Started](Getting-Started.md) to run it · [Glossary](Glossary.md) for the vocabulary ·
[Trust And Audit](Trust-And-Audit.md) for exactly what's proven.
