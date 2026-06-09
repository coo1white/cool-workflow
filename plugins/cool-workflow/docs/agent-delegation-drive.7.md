# Agent Delegation Drive

CW v0.1.38 adds Agent Delegation Drive: a way to run a natural-language-prompt
workflow **end-to-end by DELEGATING each worker to an EXTERNAL agent process**
(`claude -p` headless, `codex exec`, or a configured HTTP agent endpoint),
capturing each worker's `result.md` plus an attestation of which agent/model
produced it. It turns the `architecture-review` app into CW's first turnkey,
evidence-audited product: point CW at a repo, get an audited risk report — with
no human hand-writing any `result.md`.

Before v0.1.38, CW could `plan` a workflow, isolate workers, and accept their
output, but **nothing spawned the agent that wrote each `result.md`**. Running
`architecture-review` end-to-end meant an operator hand-writing all 14 worker
result files out-of-band, with no recorded attestation of which agent/model
produced each. The new `agent` backend + `run --drive` loop close that last mile.

## The red line — delegate, do not internalize

CW **DELEGATES, IT DOES NOT BECOME THE EXECUTOR.** The `agent` backend does the
same thing the `container`/`remote`/`ci` backends do: it `spawnSync`s an
out-of-process child (the agent CLI, argv-style, `shell:false`) or POSTs to a
configured endpoint, then records a `BackendExecutionHandle` (`kind: "process"`)
+ a `SandboxAttestation` + the canonical result envelope. **The model runs in the
agent's process, never inside CW.** CW imports no model SDK, holds no API key,
constructs no chat/completions request, and calls no model HTTP API. Any API key
flows from the agent's *own* inherited env; CW never reads or records it. Adding a
provider SDK to `package.json` would lose the neutral-audit moat and is the red
line.

## Operator-chosen model is policy; agent-reported model is the attestation

Any model id CW passes **into** the agent invocation (`CW_AGENT_MODEL`
interpolated into `{{model}}`) is **policy-as-data the operator chose**. It is
recorded only as part of the secret-stripped command-template/args provenance and
is **never** the source of the attested `UsageRecord.model`. The recorded/attested
model id comes solely from what the external agent reports back in its output. If
the agent reports no model, CW records `unreported` — it never backfills from
`CW_AGENT_MODEL`. A configured `CW_AGENT_MODEL` that differs from the agent's
reported model does not overwrite the host-reported model id.

## Two layers, never conflated

1. **Backend evidence triple.** `runAgentProcess` records the agent CHILD's
   `command` + `exitCode` + `sha256(stdout)` — the identical mechanism
   `runContainer`/`runHttpDelegation` use. This triple is byte-stable in SHAPE
   across `node`/`container`/`remote`/`ci`/`agent`. It NEVER reads, parses, or
   hashes a `result.md`.
2. **`result.md` acceptance.** The worker's `result.md` `cw:result` envelope is
   accepted in a SEPARATE layer (`recordWorkerOutput`), which validates it, copies
   it into `resultsDir`, runs the verifier gate, and records trust-audit +
   provenance — unchanged by this feature.

The agent handle (`kind: "process"`), the agent-reported model id, the prompt
digest, the secret-stripped args, and the result digest live in `provenance` and
the `worker.agent-delegation` trust-audit event — **never in `evidence`**.

## The drive lifecycle

`run --drive` is a thin orchestrator over the EXISTING verbs + the v0.1.37
scheduler. For each worker the planner emits, in deterministic phase/dispatch
order:

```
plan -> dispatch -> agent-fulfill (agent backend) -> recordWorkerOutput/verify -> commit
```

- **dispatch** allocates the worker scope (`input.md` + manifest; the worker's own
  sandbox profile, e.g. `readonly`).
- **agent-fulfill** delegates the worker to the `agent` backend out-of-process; the
  agent reads the input/manifest and writes `result.md`; CW captures the child's
  evidence triple + reported model.
- **accept** records + verifies `result.md`; the agent-hop attestation is folded
  into the result node's metadata (so the v0.1.35 replay engine covers it).
- **commit** is verifier-gated on the Verdict node once every worker completes.

The Verdict `artifact` node is fulfilled through the SAME agent backend — it is a
worker scope with a `result.md` like any other. `--drive --once` advances exactly
one deterministic step (injected `now`); bare `--drive` runs to completion or to a
parked/blocked stop. `run drive <run-id>` (no `--step`) is the read-only,
deterministic preview of the next step.

## Fail closed — probe vs refusal vs park

- **Probe.** `backend probe agent` reports `readiness: "ready"` iff a
  command-template/endpoint is configured; otherwise `readiness: "unverified"`,
  `ready: false`, with a non-empty reason — byte-identical in shape to
  `backend probe remote` unconfigured. It is NEVER a hard `refused`/`unavailable`.
- **runBackend.** Unconfigured execution (no command-template AND no endpoint)
  returns a `delegation-target-missing` refusal — never a fabricated `completed`.
- **Failed hop.** A spawned agent that exits non-zero, returns no exit code,
  produces no `result.md`, or produces a `result.md` that fails validation yields a
  `refused`/`failed` envelope (or a rejected accept) — never a fabricated
  completion.
- **Park.** In the drive loop, a worker whose agent hop keeps failing exhausts its
  scheduling retry budget and lands **parked** (reuse v0.1.37 `retryOrPark`) — the
  drive stops; it is never silently re-driven forever.

## Replay determinism (bound to node-snapshot)

The attested record (model id, prompt digest, args, result digest, exit) is plain
data folded into the snapshotted node body. Replaying a recorded drive run via
`snapshotNode`/`replayNodeSnapshot`/`verifyNodeReplay` reproduces the SAME
audit/provenance graph and the same recorded digests, **without re-spawning the
agent or re-reading the live `result.md`** — even with the agent binary
unavailable. Two replays with different injected `now` are byte-identical in body
+ `sourceFingerprint`/`outputFingerprint`.

## Vendor neutrality + durable config

WHICH agent (claude / codex / ollama / an HTTP endpoint) is **policy expressed as
DATA** — a command-template and/or endpoint resolved flags > env
(`CW_AGENT_COMMAND` / `CW_AGENT_ENDPOINT` / `CW_AGENT_MODEL`) > a durable
`$CW_HOME/agent-config.json`. claude / codex / ollama are CONFIGS, never CW
dependencies. No secrets are written into the config or `.cw/`: it holds a
command-template + endpoint + operator-chosen model only; recorded command/args
are secret-stripped.

## CLI

```text
# configure the agent (policy as data; no API key is ever written)
node dist/cli.js backend agent config set --agent-command "claude -p --output-format json {{input}}" --agent-model claude-opus-4-8
node dist/cli.js backend agent config            # show the effective config (secret-stripped)
node dist/cli.js backend probe agent --json      # ready iff configured, else unverified

# drive a real repo end-to-end (zero hand-written result.md)
node dist/cli.js run architecture-review --drive --repo /path/to/repo --question "Is the design sound?"
node dist/cli.js run architecture-review --drive --once --repo /path/to/repo --question "..."   # one step
node dist/cli.js run drive <run-id> --json       # read-only preview of the next step
```

`{{manifest}}`, `{{input}}`, `{{result}}`, `{{workerDir}}`, `{{model}}`, and
`{{prompt}}` are substituted into DISCRETE argv elements (never a shell-interpreted
string). Each verb is declared once in `capability-registry.ts`, so `cw <cmd>
--json` is byte-identical to the matching `cw_<tool>` MCP tool for the read-only
preview/config-show verbs.

## Compatibility

Agent Delegation Drive is introduced in CW v0.1.38. Adding the `agent` row leaves
`node`/`bun`/`shell`/`container`/`remote`/`ci` byte-identical; `backendIds()`
simply grows by one to the sorted 7-row set
`["agent","bun","ci","container","node","remote","shell"]`. A run driven manually
(plan → dispatch → `worker output` → commit) still works unchanged. Fields are
additive and optional; older run state loads unchanged. No `.cw/` layout change.

## See Also

execution-backends(7), real-execution-backends(7), node-snapshot-diff-replay(7),
control-plane-scheduling(7), dogfood-one-real-repo(7), cli-mcp-parity(7),
observability-cost-accounting(7)

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the reconstructable bulk, prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.
