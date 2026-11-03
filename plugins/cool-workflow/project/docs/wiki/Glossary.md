# Glossary

The core words of Cool Workflow, grouped by theme. New to CW? Read the
[Mental Model](Mental-Model.md) first, then use this page as a reference.

## The run model

**Control-plane** — What CW *is*: the part that plans, records, checks, and
reports, but **hands the execution to your agent**. It has no model SDK
inside it and holds no API key. *The model is fuel; CW keeps the books.*

**Run** — One execution of a workflow, saved under `.cw/runs/<id>/`. You can
resume it, diff it, and replay it. Nothing about a run lives in a hidden
database.

**Workflow app** — A versioned manifest that defines a job: its inputs,
**phases**, **tasks**, outputs, and checks. Apps are *userland* (programs);
the runtime is the *base system* (the OS under them). Examples:
`architecture-review`, `pr-review-fix-ci`, `research-synthesis`,
`release-cut`.

**Phase** — A stage inside an app. Phases are **static** by design — fixed
phases are what let a run replay the same way every time.

**Task** — One unit of work inside a phase, packaged so a worker can run it.

**Dispatch** — Turning tasks into manifests for your agent (or an operator)
to execute. CW records the state and the evidence; the host actually runs the
worker.

**Worker** — One execution of one task, in its own separate space. It
produces a result envelope plus a transcript, with its outputs kept apart and
its failures recorded.

**Result envelope** (`result.md`) — A worker's output together with its
evidence trail — a structured thing CW can check, not just free text.

## Evidence & trust

**Evidence** — The places in the sources (such as `file.ts:42`) that hold up
a result. A result with no evidence, or with evidence that names a file that
is not there, is turned down. CW never makes up a reason or lets a result
quietly pass.

**`blocked` / `parked`** — The clear, fail-closed states a run stops in.
`blocked`: the work cannot go on (for example, no agent is configured).
`parked`: a worker failed again and again (or went past its time limit) and
was stopped in place of being made to look done. Fix the cause, then
`cw --resume --run <run-id>`.

**Verifier gate / verifier-gated commit** — The rule that **only checked
state becomes committed state.** Unchecked work cannot move forward.

**Commit / checkpoint** — A checkpoint of checked state, written under
`.cw/runs/<id>/commits/`.

**Provenance** — Where a result came from: its sources, its authority, and
the trail of decisions behind it.

**Telemetry ledger** (`telemetry.json`) — The record of the run's usage. Each
entry is chained to the one before by a hash, so any later edit shows. Your
agent can sign it with **ed25519**. `cw telemetry verify` re-checks it
offline.

**Audit** — The records of sources, policy, and decisions under `audit/`,
re-checkable with `cw audit verify`. See [Trust And Audit](Trust-And-Audit.md).

**Bundle** (`*.cwrun.json`) — A run sealed into one portable file.
`cw report verify-bundle` re-checks it offline with nothing but the file
(add `--require-signatures` to demand that findings are signed).

## Surfaces & portability

**CLI** — The `cw` command: the simplest common interface, one every host has
words for.

**MCP** — The same runtime offered as JSON-RPC 2.0 tools, so editors and
agent hosts (Claude Desktop, Cursor, VS Code) can call CW as a tool. CLI and
MCP share one registry and are **parity-checked** — kept the same by a test.

**Manifest** — The one source of truth that **generates** every vendor plugin
adapter (Claude, Codex, …). A fail-closed **drift check** in CI stops the
adapters from forking the logic.

**Execution backend** — The swappable driver that actually runs a worker
(agent, node, bun, shell, container, remote, ci). The core never learns which one ran a
task — that is what keeps CW free of vendor lock-in.

**Sandbox profile** — A named policy contract for what a worker may read,
write, run, and reach on the network (e.g. `--sandbox readonly`).

## Operations

**Snapshot / replay** — `cw node snapshot`, `cw node diff`, and `cw node
replay` take one step of a run, compare it, and replay it **with no live
agents**; a replay gives the same bytes every time, and a snapshot whose
source has changed is refused as `stale`.

**`--drive` / `--incremental`** — The high-level host loop. `--incremental`
reuses every step whose inputs did not change, so a re-run is fast.

**`subWorkflow` / `loop()`** — Ways to put flows together: a task can run a
whole child workflow, and a `loop()` phase goes round until a condition or a
token budget says stop.

**`release:check`** — A dry-run gate that changes nothing. It builds,
type-checks, tests, validates the canonical apps and the golden path, checks
fixture and manifest compatibility, and runs CW on this repo itself — without
tagging, pushing, or publishing.

---

**See also:** [Mental Model](Mental-Model.md) · [Getting Started](Getting-Started.md) ·
[Architecture](Architecture.md) · [Commands or API](Commands-or-API.md)
