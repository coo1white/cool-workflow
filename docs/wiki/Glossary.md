# Glossary

The core vocabulary of Cool Workflow, grouped by theme. New to CW? Read the
[Mental Model](Mental-Model.md) first, then use this page as a reference.

## The run model

**Control-plane** — What CW *is*. It plans, records, verifies, and reports, but **delegates execution**
to your agent. It embeds no model SDK and holds no API key. *The model is fuel; CW keeps the books.*

**Run** — A single execution of a workflow, stored durably under `.cw/runs/<id>/`. Resumable,
diffable, replayable. Nothing about a run lives in a hidden database.

**Workflow app** — A versioned manifest that defines a job: its inputs, **phases**, **tasks**,
artifacts, and validation. Apps are *userland*; the runtime is the *base system*. (e.g.
`architecture-review`, `pr-review-fix-ci`, `research-synthesis`, `release-cut`.)

**Phase** — A stage within an app. Phases are **static** by design — fixed phases are what make a run
deterministically replayable.

**Task** — A unit of work inside a phase, packaged for execution.

**Dispatch** — Turning tasks into manifests for your agent (or an operator) to execute. CW records the
state and evidence; the host actually runs the worker.

**Worker** — One isolated execution of a task. Produces a result envelope plus a transcript, with
scoped outputs and failure records.

**Result envelope** (`result.md`) — A worker's output together with its provenance — the structured
thing CW verifies, not just free text.

## Evidence & trust

**Evidence Adoption reasoning chain** — The record of *why* a result was adopted or rejected, capturing
four things: **basis** (the references), **authority** (who decided), **rationale** (the stated
reason), and **counterfactual** (the alternative that lost, and why).

**`unexplained`** — The explicit, fail-closed state a result lands in when its evidence or rationale is
missing. CW never fabricates a reason or silently passes.

**Verifier gate / verifier-gated commit** — The rule that **only verified state becomes committed
state.** Unverified work cannot advance.

**Commit / checkpoint** — A verified state checkpoint written under `.cw/runs/<id>/commits/`.

**Provenance** — Where a result came from: its sources, authority, and decision trail.

**Telemetry ledger** (`telemetry.json`) — A hash-chained record of the run's usage. Tamper-evident, and
**ed25519**-signable by the executing agent. `cw telemetry verify` re-proves it offline.

**Audit** — Provenance, policy, and decision records under `audit/`, re-checkable with
`cw audit verify`. See [Trust And Audit](Trust-And-Audit.md).

**Bundle** (`*.cwrun.json`) — A run sealed into one portable file. `cw report verify-bundle` re-checks
it offline with nothing but the file (and `--require-signatures` to insist findings are signed).

## Multi-agent

**Coordinator / Blackboard** — The shared coordination store for multi-agent work (topics, messages,
artifacts, context, snapshots, decisions), kept under `.cw/runs/<id>/blackboard/`.

**Role / group / membership** — Multi-agent work modeled as a *process table*: who is who, which group
they belong to, and their lifecycle state.

**Topology** — A reusable multi-agent recipe:

| Topology | Shape |
| --- | --- |
| `map-reduce` | Fan out mapper roles, collect evidence, then reduce. |
| `debate` | Record opposing claims, rebuttals, conflicts, and a synthesis. |
| `judge-panel` | Gather independent judge outputs and select with provenance. |

**Fanout / fanin** — Spreading work across workers and folding their outputs back together.

## Surfaces & portability

**CLI** — The `cw` command: the lowest-common-denominator interface every host has words for.

**MCP** — The same runtime exposed as JSON-RPC 2.0 tools, so editors and agent hosts (Claude Desktop,
Cursor, VS Code) call CW as a tool. CLI and MCP share one registry and are **parity-checked**.

**Manifest** — The single source of truth that **generates** every vendor plugin adapter (Claude,
Codex, …). A fail-closed **drift check** in CI keeps adapters from forking the logic.

**Execution backend** — The swappable driver that actually runs a worker (node, shell, container,
remote). The kernel never learns which one ran a task — that's what keeps CW vendor-neutral.

**Sandbox profile** — A named read / write / command / network / env policy contract applied to worker
execution (e.g. `--sandbox readonly`).

## Operations

**Replay / eval harness** — Deterministic snapshot → replay → compare → score → gate, run **without
live agents**. Used to gate releases on regression evidence.

**`--drive` / `--incremental`** — The high-level host loop. `--incremental` reuses every step whose
inputs didn't change, so re-runs are fast.

**`subWorkflow` / `loop()`** — Flow composition: a task can run a whole child workflow, and a `loop()`
phase can iterate until a predicate or token budget says stop.

**`release:check`** — A non-destructive dry-run gate. It builds, type-checks, tests, validates canonical
apps and the golden path, checks fixture and manifest compatibility, and self-dogfoods on this repo —
without tagging, pushing, or publishing.

---

**See also:** [Mental Model](Mental-Model.md) · [Getting Started](Getting-Started.md) ·
[Architecture](Architecture.md) · [Commands or API](Commands-or-API.md)
