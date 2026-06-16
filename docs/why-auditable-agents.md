# Why Auditable Agents

> A story of what Cool Workflow (CW) is for, what it has made up its mind not to
> be, and the small group of jobs where its trade-offs truly give back more than
> they take. If you want the design idea in one line, it is in
> [`DIRECTION.md`](../DIRECTION.md):
> **the model is fuel; CW is the dashboard, the blackbox recorder, and the
> gearbox — never the engine.**

## The problem isn't that the model is dumb

Most agent frameworks take a task as one long prompt and have hope for the best.
For a quick one-off that is all right. But the minute work gets *long*,
*parallel*, or *high-stakes*, that bet comes apart in a way you could have seen
coming:

- The work is lost in chat history. You may go through it; you cannot question it.
- Subtasks fan out and go out of view. No one can say which ones ran, or what they sent back.
- Results come with no provenance — "done" with no answer to *why this answer,
  over which other choices, under what policy.*
- Failure is shut off from view. When something is wrong you cannot replay it,
  cannot diff it, cannot put your finger on the step that gave a false account.

The first thought is to ask for a *smarter* model. That is normally the wrong
fix. What this kind of work is short of is **the power to see, not IQ**. A model
without errors but with no record of what it did is still of no use for anything
you have to give an account of later. So CW takes this as a **runtime problem**,
the same way an OS makes processes long-lived and open to looking at — not a
modeling problem. We do not make the model smarter. We make its work *clear to
read*.

## Four commitments

### 1. Model as fuel, not engine

CW never makes a call to a model API. Worker execution is at all times handed off
to an outside agent — Claude, Codex, or any framework you are running now. This is
put down as a hard line in the code itself: *"CW DELEGATES, IT DOES NOT BECOME THE
EXECUTOR"*
([`execution-backend.ts`](../plugins/cool-workflow/src/execution-backend.ts)).

Handing the work off is the **feature**, not a hole we have not yet shut. Because
CW never takes execution into itself, the backend is a driver you can take out and
put in — node, shell, container, remote — and the kernel never gets to know which
one ran a task. That is what keeps the moat *vendor-neutral*: the value is in the
evidence and the decisions, not in the power to run a prompt. The day CW became
one more thin wrapper round an LLM API, it would give up the one thing it has that
the fuel vendors do not. See [`execution-backends.7.md`](../plugins/cool-workflow/docs/execution-backends.7.md).

### 2. Evidence-gated decisions — show your work or don't commit

A model saying "done" is not enough. Every result taken up keeps its provenance:
the **basis** (clear references), the **authority** (who made the decision), the
**rationale** (the stated reason), and the **counterfactual** (what other choice
did not win, and why). When that chain is not there, the result does not go
through in quiet and CW does not make up a reason for it — it comes to rest in a
clear `unexplained` state.

This is not red tape. It is the straight cure for the three ways agent work goes
bad in quiet: the *silent pass*, the *fabricated rationale*, and the
*unexplained adoption*. The Evidence Adoption reasoning chain makes the reasoning
**open to see**, not harder; and only state that has been checked becomes
committed state. More depth
in [`evidence-adoption-reasoning-chain.7.md`](../plugins/cool-workflow/docs/evidence-adoption-reasoning-chain.7.md)
and [`verifier-gated-commit.7.md`](../plugins/cool-workflow/docs/verifier-gated-commit.7.md).

### 3. Deterministic replay — all state, no magic

Every step is plain JSON under `.cw/runs/<id>/` — open to read, to diff, to take
up again, to replay. There is no dashboard database kept out of view and the
runtime never *guesses* success; what is not clear is shown as a state you can
see. The shared blackboard that gets multi-agent work working together is itself
kept under `.cw/runs/<id>/blackboard/` by the
1300+ line coordinator ([`coordinator.ts`](../plugins/cool-workflow/src/coordinator.ts)) —
a thing of value CW makes deeper, not one it makes again from the start.

Determinism is a hard need, not a nice-to-have. The snapshot / diff /
replay harness lets you run a recorded session again **without live agents**, put
it side by side with a baseline, give it a score, and gate a release on the
outcome. That is the very *reason* CW keeps phases static: phases that change as
they go would get flexibility but give up replay you can do again the same way,
and replay is the wall that holds the weight. Scope
and limits in [`multi-agent-eval-replay-harness.7.md`](../plugins/cool-workflow/docs/multi-agent-eval-replay-harness.7.md).

### 4. Vendor-neutral portability — one kernel, many front doors

A single source-of-truth manifest *makes* the per-vendor plugin adapters
(Claude, Codex, …) over one shared CLI + MCP (JSON-RPC 2.0) runtime, and a
fail-closed drift check in CI keeps any adapter from sending the logic down its
own road. Be straight about what this gets you: not *no* cost to move between
vendors, but a *shared runtime and a drift gate*, so the work is small and the
surfaces cannot go their own way in quiet. The CLI + MCP layer is the simplest
common interface every front door has words for.

## When this is worth it — and when it is not

CW gives up speed to get auditability. You pay first in task structure. You get
back trust, the power to keep to the rules, and portability. That trade is wise
only when **your cost of being wrong is higher than your cost of being clear.** So
be open about it:

**Worth the structure:**

- *Structured tasks* with clear phases and separate decision gates.
- *Repeatable workflows*, where the cost of recording and replaying is shared out
  over many runs.
- *High-stakes reviews* that need evidence you can point to and give an account of
  later.
- *Cross-vendor work*, where lock-in is a true danger.
- *Release gates* that need deterministic, dry-run trust.

**Overkill:**

- One-off looking-about — just run the prompt.
- Real-time interactive work, where the cost of recording is in the way.
- Tasks that need *emergent* change as they go. CW's static phases give up
  flexibility to get the power to do the same thing again, by design; if the shape
  of the work has to change in the middle, that trade is working against you.

CW does not make out it is one-size-fits-all. The cases over this are the
*high-confidence* ones where the added cost gives back more in a way you can
measure.

## The trade works — we eat our own cooking

This is not just a hope. CW's own architecture-review workflow audits CW's own
repository, and `release:check` gates releases on replay evidence in place of a
human eye. The worked-out output of that loop, with every line cited, is put up at
[`../examples/audits/self-audit-cool-workflow-v0.1.42.md`](../examples/audits/self-audit-cool-workflow-v0.1.42.md) —
a true architecture-risk report where every cite points to a `file:line` in the
tree. And the version history is the clearest proof of the idea: from v0.1.27
through the late releases, **every release made auditability, reproducibility, or
portability deeper. Not one made the model smarter.** That was never the job.

---

Ready to give it a go? Start at the README
**[Quick Start](../README.md#quick-start)**.
For the design test every new idea has to get through, read
[`DIRECTION.md`](../DIRECTION.md).
