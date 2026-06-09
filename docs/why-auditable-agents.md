# Why Auditable Agents

> A narrative on what Cool Workflow (CW) is for, what it deliberately refuses to
> be, and the narrow set of jobs where its trade-offs actually pay off. If you
> want the design thesis in one line, it's in [`DIRECTION.md`](../DIRECTION.md):
> **the model is fuel; CW is the dashboard, the blackbox recorder, and the
> gearbox — never the engine.**

## The problem isn't that the model is dumb

Most agent frameworks treat a task as one long prompt and hope for the best. For
a quick one-off that's fine. But the moment work gets *long*, *parallel*, or
*high-stakes*, that bet breaks down in a predictable way:

- The work disappears into chat history. You can scroll it; you can't query it.
- Subtasks fan out and vanish. Nobody can say which ones ran, or what they returned.
- Results arrive with no provenance — "done" with no answer to *why this answer,
  over which alternatives, under what policy.*
- Failure is opaque. When something is wrong you can't replay it, can't diff it,
  can't point at the step that lied.

The instinct is to ask for a *smarter* model. That's usually the wrong fix. The
deficit on this kind of work is **visibility, not IQ**. A perfect model with no
record of what it did is still unusable for anything you have to defend later. So
CW treats this as a **runtime problem**, the same way an OS makes processes
durable and inspectable — not a modeling problem. We don't make the model
smarter. We make its work *legible*.

## Four commitments

### 1. Model as fuel, not engine

CW never calls a model API. Worker execution is always delegated to an external
agent — Claude, Codex, or any framework you already run. This is stated as a red
line in the code itself: *"CW DELEGATES, IT DOES NOT BECOME THE EXECUTOR"*
([`execution-backend.ts`](../plugins/cool-workflow/src/execution-backend.ts)).

Delegation is the **feature**, not a gap we haven't closed yet. Because CW never
internalizes execution, the backend is a swappable driver — node, shell,
container, remote — and the kernel never learns which one ran a task. That's what
keeps the moat *vendor-neutral*: the value lives in the evidence and the
decisions, not in the ability to run a prompt. The day CW became another thin
wrapper around an LLM API, it would lose the only thing it has that the fuel
vendors don't. See [`execution-backends.7.md`](../plugins/cool-workflow/docs/execution-backends.7.md).

### 2. Evidence-gated decisions — show your work or don't commit

A model saying "done" doesn't count. Every adopted result carries provenance: the
**basis** (concrete references), the **authority** (who decided), the
**rationale** (the explicit reason), and the **counterfactual** (what alternative
lost, and why). When that chain is missing, the result doesn't silently pass and
CW doesn't invent a reason for it — it lands in an explicit `unexplained` state.

This is not bureaucracy. It is the direct antidote to the three ways agent work
quietly rots: the *silent pass*, the *fabricated rationale*, and the
*unexplained adoption*. The Evidence Adoption reasoning chain makes the reasoning
**visible**, not harder; and only verified state becomes committed state. Depth
in [`evidence-adoption-reasoning-chain.7.md`](../plugins/cool-workflow/docs/evidence-adoption-reasoning-chain.7.md)
and [`verifier-gated-commit.7.md`](../plugins/cool-workflow/docs/verifier-gated-commit.7.md).

### 3. Deterministic replay — all state, no magic

Every step is plain JSON under `.cw/runs/<id>/` — readable, diffable, resumable,
replayable. There is no hidden dashboard database and the runtime never *infers*
success; ambiguity is a visible state. The shared blackboard that coordinates
multi-agent work is itself persisted under `.cw/runs/<id>/blackboard/` by the
1300+ line coordinator ([`coordinator.ts`](../plugins/cool-workflow/src/coordinator.ts)) —
an asset CW deepens, not reinvents.

Determinism is a hard constraint, not a nice-to-have. The snapshot / diff /
replay harness lets you re-run a recorded session **without live agents**,
compare it against a baseline, score it, and gate a release on the result. That
is precisely *why* CW keeps phases static: dynamic phases would buy flexibility
at the cost of reproducible replay, and replay is the load-bearing wall. Scope
and limits in [`multi-agent-eval-replay-harness.7.md`](../plugins/cool-workflow/docs/multi-agent-eval-replay-harness.7.md).

### 4. Vendor-neutral portability — one kernel, many front doors

A single source-of-truth manifest *generates* the per-vendor plugin adapters
(Claude, Codex, …) over one shared CLI + MCP (JSON-RPC 2.0) runtime, and a
fail-closed drift check in CI stops any adapter from forking the logic. Be honest
about what this buys: not *zero* cost to move between vendors, but a *shared
runtime plus a drift gate*, so the effort is small and the surfaces can't quietly
diverge. The CLI + MCP layer is the lowest-common-denominator interface every
front door speaks.

## When this is worth it — and when it is not

CW trades velocity for auditability. You pay up front in task structure. You get
back confidence, compliance, and portability. That trade is only sane when **your
cost of being wrong is higher than your cost of being explicit.** So be candid:

**Worth the structure:**

- *Structured tasks* with clear phases and discrete decision gates.
- *Repeatable workflows*, where the cost of recording and replaying amortizes
  over many runs.
- *High-stakes reviews* that need citable evidence you can defend later.
- *Cross-vendor work*, where lock-in is a real risk.
- *Release gates* that need deterministic, dry-run confidence.

**Overkill:**

- One-off explorations — just run the prompt.
- Real-time interactive work, where the recording overhead is in the way.
- Tasks that need *emergent* adaptation. CW's static phases trade flexibility for
  repeatability on purpose; if the shape of the work has to change mid-flight,
  that trade is working against you.

CW does not pretend to be one-size-fits-all. The cases above are the
*high-confidence* ones where the overhead pays back measurably.

## The trade works — we eat our own cooking

This isn't aspirational. CW's own architecture-review workflow audits CW's own
repository, and `release:check` gates releases on replay evidence rather than a
human eyeball. The worked, line-cited output of that loop is published at
[`../examples/audits/self-audit-cool-workflow-v0.1.42.md`](../examples/audits/self-audit-cool-workflow-v0.1.42.md) —
a real architecture-risk report whose every cite resolves to a `file:line` in the
tree. And the version history is the cleanest proof of the thesis: from v0.1.27
through the recent releases, **every release deepened auditability,
reproducibility, or portability. None made the model smarter.** That was never
the job.

---

Ready to try it? Start at the README **[Quick Start](../README.md#quick-start)**.
For the design filter every new idea has to pass, read
[`DIRECTION.md`](../DIRECTION.md).
