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
# the bundled wrapper feeds input.md to headless claude READ-ONLY, persists
# result.md itself, and forwards claude's JSON (model+usage) for provenance.
# A bare "claude -p" or "claude -p {{input}}" does NOT complete a worker:
# headless claude gets no prompt content / cannot write result.md without it.
node dist/cli.js backend agent config set --agent-command "node $(pwd)/scripts/agents/claude-p-agent.js {{input}} {{result}}" --agent-model claude-opus-4-8
node dist/cli.js backend agent config            # show the effective config (secret-stripped)
node dist/cli.js backend probe agent --json      # ready iff configured, else unverified

# drive a real repo end-to-end (zero hand-written result.md)
node dist/cli.js run architecture-review --drive --repo /path/to/repo --question "Is the design sound?"
node dist/cli.js run architecture-review --drive --once --repo /path/to/repo --question "..."   # one step
node dist/cli.js run drive <run-id> --json       # read-only preview of the next step

# quickstart --resume: a guided stop-then-resume a newcomer can WITNESS in <5 min
node dist/cli.js quickstart --resume --repo /path/to/repo --question "..."   # advances ONE step, prints a continue line
node dist/cli.js quickstart --run <run-id> --resume                          # continues that run to completion
```

`quickstart --resume` with no `--run` drives a single step and prints a
copy-pasteable `cw quickstart --run <id> --resume` continue line; rerun it with the
`--run <id>` to finish. The continuing invocation echoes `resumedFrom: <id>`. Bare
`quickstart` (no `--resume`) is unchanged — it drives straight to completion.

For faster first results, use the opt-in fast app instead of changing the full
review contract:

```text
node scripts/architecture-review-fast.js --repo /path/to/repo --question "Is the design sound?" --fast-model gpt-5.5-high --strong-model gpt-5.5-extra-high --metrics --schedule-full
```

`architecture-review-fast` has six workers: two Map and two Assess workers in
parallel, then sequential Verify and Verdict workers. The original
`architecture-review` app remains the full 14-worker review and is the right
target for background routines when a deep audit can finish outside the user's
foreground wait.

The model flags are policy, not attestation: they set task-level `{{model}}`
hints for the delegated agent process. The recorded model still comes only from
the agent-reported output.

The wrapper computes the source-context digest and supplies it to the fast app.
For external repositories, the documented no-profile command creates a repo-local
default `repo` profile over common tracked text surfaces. If the selected profile
exports zero records, the wrapper refuses rather than handing the app an empty
context digest.
The two Map workers opt in to result caching keyed by source-context digest plus
prompt digest. The two Assess workers also opt in, but their cache key includes
the completed previous-phase result digests so stale Map outputs do not satisfy
an Assess cache hit. A cache hit still passes through `recordWorkerOutput`
validation; a corrupt cached result parks/fails closed rather than spawning a
silent fallback.

`--metrics` is diagnostic and opt-in. It adds elapsed milliseconds, step counts,
agent-spawn counts, and `result-cache` hit counts to the wrapper JSON payload;
without it, the wrapper's default output shape stays unchanged.

`{{manifest}}`, `{{input}}`, `{{result}}`, `{{workerDir}}`, `{{model}}`, and
`{{prompt}}` are substituted into DISCRETE argv elements (never a shell-interpreted
string). Each verb is declared once in `capability-registry.ts`, so `cw <cmd>
--json` is byte-identical to the matching `cw_<tool>` MCP tool for the read-only
preview/config-show verbs.

## Live output — opt-in stderr passthrough (Unix-clean)

A drive can show the agent's activity live, without touching the evidence
contract, when the operator opts in with `CW_AGENT_STREAM=1`:

- **Default stays buffered.** Without `CW_AGENT_STREAM=1`, the bundled wrapper
  preserves the legacy `--output-format json` path and forwards claude's JSON
  stdout verbatim after writing `result.md`.
- **The opt-in wrapper renders; stderr only.** With `CW_AGENT_STREAM=1`, the
  bundled wrapper runs claude in `--output-format stream-json` and renders a
  concise human trace (tool uses, assistant text, per-turn summaries) to its
  **stderr** — diagnostics, never data. It reconstructs the single
  `{model, usage, result}` object for stdout only on that opt-in path.
- **Core forwards, never parses.** `runAgentProcess` passes the agent child's
  stderr straight through to the operator's terminal (`stdio` inherit) only when
  `CW_AGENT_STREAM=1`, CW's own stderr is a TTY, and `CW_NO_STREAM` is not set.
  Piped / CI runs stay silent (the Rule of Silence). Vendor-specific rendering
  lives in the wrapper (policy), not the kernel (mechanism).
- **Determinism intact.** The backend evidence triple hashes stdout only, so
  the live stderr stream never affects recorded evidence or replay.

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

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now validate the committed blob (`git show HEAD:<path>`) instead of the mutable working tree — eliminating false-red/false-green from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter giving any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, measurable wrapper metrics, actionable background full-review handoff, and userland model policy flags for routing fast/strong workers without changing the full review contract.

## Resumable Drive & Resume Routing (v0.1.81)

Adds `run resume <id> --drive/--once` alongside `quickstart --resume`: a stopped pipeline resumes in-place, advancing to completion (`--drive`) or one deterministic step (`--once`) over the same plan->dispatch->agent-fulfill->accept->commit lifecycle, echoing `resumedFrom: <id>`. Fixes the `run resume --drive` CLI routing so the drive flag reaches the resumed run instead of being read as an app name. Replay determinism and the agent evidence triple are unchanged.
_No behavioral change in v0.1.82 (drive/quickstart resolve the run repo via an explicit base directory rather than process.chdir; delegation behavior is unchanged)._
