# Agent Delegation Drive

CW v0.1.38 adds Agent Delegation Drive: a way to run a natural-language-prompt
workflow **end-to-end by DELEGATING each worker to an EXTERNAL agent process**
(`claude -p` headless, `codex exec`, or a configured HTTP agent endpoint). It
keeps each worker's `result.md` plus a record of which agent/model made it. It
turns the `architecture-review` app into CW's first ready-to-use,
evidence-audited product: point CW at a repo, get an audited risk report — with
no person hand-writing any `result.md`.

Before v0.1.38, CW could `plan` a workflow, keep workers apart, and take in their
output, but **nothing spawned the agent that wrote each `result.md`**. To run
`architecture-review` end-to-end, an operator had to hand-write all 14 worker
result files outside the loop, with no kept record of which agent/model made
each. The new `agent` backend + `run --drive` loop close that last gap.

## The red line — delegate, do not internalize

CW **DELEGATES, IT DOES NOT BECOME THE EXECUTOR.** The `agent` backend does the
same thing the `container`/`remote`/`ci` backends do: it `spawnSync`s an
out-of-process child (the agent CLI, argv-style, `shell:false`) or POSTs to a
configured endpoint, then keeps a record of a `BackendExecutionHandle`
(`kind: "process"`) + a `SandboxAttestation` + the canonical result envelope.
**The model runs in the agent's process, never inside CW.** CW brings in no model
SDK, holds no API key, builds no chat/completions request, and calls no model
HTTP API. Any API key comes from the agent's *own* inherited env; CW never reads
or keeps a record of it. Adding a provider SDK to `package.json` would lose the
neutral-audit moat and is the red line.

## Architecture — the boundary (core ↔ agent backend ↔ wrappers)

The core gives only an INTERFACE: the `agent` execution backend plus a small
text/process contract. The four vendors (claude / codex / gemini / deepseek)
live OUTSIDE the core as out-of-process wrapper scripts in `scripts/agents/` —
pure config, never imported by `src/`, behind the same seam.

```text
                       user
                       │  cw -q "…" -codex   (headline shortcut; also -claude/-gemini/-deepseek)
                       ▼
┌──────────── CW core  (src/ — zero runtime deps, imports NO model SDK, holds NO key) ───────────┐
│                                                                                                │
│  command-surface.ts        agent-config.ts                 execution-backend  ("agent" driver) │
│  -codex → builtin:codex ─► builtin:<name> ─►               runAgentProcess:                     │
│                            node <dir>/<name>-agent.js       spawnSync(binary, args, shell:false)│
│                            {{input}} {{result}}            · inherits env  · captures stdout    │
│                            (builtin-templates.json: DATA)  · records handle{process}+attestation│
└───────────────────────────────────────┬───────────────────────────────────────────────────────┘
     THE SEAM  (text / process contract) │
       in : argv  {{input}}=worker input.md   {{result}}=worker result.md
       out: wrapper writes result.md + ONE stdout JSON line {model,usage,result} → parseAgentReport
                                         │
   ── red line ──  core never reads a key; each wrapper resolves its OWN key from inherited env
                                         │
┌──────── external wrappers  (scripts/agents/*.js — "CONFIG, not a CW runtime dependency") ───────┐
│   claude-p-agent.js     codex-agent.js      gemini-opencode-agent.js    deepseek-agent.js       │
│        │                     │                        └──────────┬──────────────┘              │
│        ▼                     ▼                                   ▼  (3-line shims)              │
│   claude -p            codex exec                          opencode-agent.js                    │
│   (Anthropic CLI)      (-c effort, sandbox)               opencode run --model …                │
│                                                           (deepseek + gemini keys live here)    │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
   Add a vendor = drop a wrapper script + one line in builtin-templates.json — NO core edit.
```

Each box maps to one source seam: the flag map lives in `command-surface.ts`
(`-codex` → `builtin:codex`); `agent-config.ts` expands `builtin:<name>` into
`node <dir>/<name>-agent.js {{input}} {{result}}` by reading
`builtin-templates.json` (the registry is DATA, not a kernel literal); the
`agent` driver's `runAgentProcess` does the `spawnSync` and reads back the one
stdout JSON line via `parseAgentReport`. So the four vendors are **delegated
agent wrappers, not an event-"hook" system**. The seam is generic: any
`CW_AGENT_COMMAND="node my-agent.js {{input}} {{result}}"` or a configured HTTP
endpoint plugs in the same way — the four builtins are just bundled examples.

## Operator-chosen model is policy; agent-reported model is the attestation

Any model id CW passes **into** the agent invocation (`CW_AGENT_MODEL`
interpolated into `{{model}}`) is **policy-as-data the operator chose**. It is
kept only as part of the secret-stripped command-template/args provenance and is
**never** the source of the attested `UsageRecord.model`. The recorded/attested
model id comes only from what the external agent reports back in its output. If
the agent reports no model, CW writes down `unreported` — it never fills in from
`CW_AGENT_MODEL`. A configured `CW_AGENT_MODEL` that is not the same as the
agent's reported model does not overwrite the host-reported model id.

## Two layers, never conflated

1. **Backend evidence triple.** `runAgentProcess` keeps a record of the agent
   CHILD's `command` + `exitCode` + `sha256(stdout)` — the same mechanism
   `runContainer`/`runHttpDelegation` use. This triple has the same byte-stable
   SHAPE across `node`/`container`/`remote`/`ci`/`agent`. It NEVER reads, parses,
   or hashes a `result.md`.
2. **`result.md` acceptance.** The worker's `result.md` `cw:result` envelope is
   taken in a SEPARATE layer (`recordWorkerOutput`), which checks it, copies it
   into `resultsDir`, runs the verifier gate, and keeps a record of trust-audit +
   provenance — unchanged by this feature.

The agent handle (`kind: "process"`), the agent-reported model id, the prompt
digest, the secret-stripped args, and the result digest live in `provenance` and
the `worker.agent-delegation` trust-audit event — **never in `evidence`**.

## The drive lifecycle

`run --drive` is a thin orchestrator over the EXISTING verbs + the v0.1.37
scheduler. For each worker the planner sends out, in fixed phase/dispatch
order:

```
plan -> dispatch -> agent-fulfill (agent backend) -> recordWorkerOutput/verify -> commit
```

- **dispatch** sets up the worker scope (`input.md` + manifest; the worker's own
  sandbox profile, e.g. `readonly`).
- **agent-fulfill** hands the worker to the `agent` backend out-of-process; the
  agent reads the input/manifest and writes `result.md`; CW takes in the child's
  evidence triple + reported model.
- **accept** keeps + checks `result.md`; the agent-hop attestation is folded into
  the result node's metadata (so the v0.1.35 replay engine covers it).
- **commit** is verifier-gated on the Verdict node once every worker is done.

The Verdict `artifact` node is fulfilled through the SAME agent backend — it is a
worker scope with a `result.md` like any other. `--drive --once` moves on by
exactly one fixed step (injected `now`); bare `--drive` runs to the end or to a
parked/blocked stop. `run drive <run-id>` (no `--step`) is the read-only, fixed
preview of the next step.

## Fail closed — probe vs refusal vs park

- **Probe.** `backend probe agent` reports `readiness: "ready"` iff a
  command-template/endpoint is configured; if not, `readiness: "unverified"`,
  `ready: false`, with a reason that is not empty — byte-identical in shape to
  `backend probe remote` unconfigured. It is NEVER a hard `refused`/`unavailable`.
- **runBackend.** Unconfigured execution (no command-template AND no endpoint)
  returns a `delegation-target-missing` refusal — never a made-up `completed`.
- **Failed hop.** A spawned agent that exits non-zero, returns no exit code,
  makes no `result.md`, or makes a `result.md` that fails the check gives back a
  `refused`/`failed` envelope (or a turned-down accept) — never a made-up
  completion.
- **Park.** In the drive loop, a worker whose agent hop keeps failing uses up its
  scheduling retry budget and lands **parked** (reuse v0.1.37 `retryOrPark`) — the
  drive stops; it is never quietly re-driven forever.

## Replay determinism (bound to node-snapshot)

The attested record (model id, prompt digest, args, result digest, exit) is plain
data folded into the snapshotted node body. Replaying a recorded drive run via
`snapshotNode`/`replayNodeSnapshot`/`verifyNodeReplay` makes the SAME
audit/provenance graph again and the same recorded digests, **without re-spawning
the agent or re-reading the live `result.md`** — even with the agent binary not
on hand. Two replays with different injected `now` are byte-identical in body
+ `sourceFingerprint`/`outputFingerprint`.

## Vendor neutrality + durable config

WHICH agent (claude / codex / ollama / an HTTP endpoint) is **policy put as
DATA** — a command-template and/or endpoint worked out from flags > env
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
node dist/cli.js quickstart architecture-review --check --repo /path/to/repo --question "Is the design sound?" --agent-command "node $(pwd)/scripts/agents/claude-p-agent.js {{input}} {{result}}"
node dist/cli.js run architecture-review --drive --repo /path/to/repo --question "Is the design sound?"
node dist/cli.js run architecture-review --drive --once --repo /path/to/repo --question "..."   # one step
node dist/cli.js run drive <run-id> --json       # read-only preview of the next step

# quickstart --resume: a guided stop-then-resume a newcomer can WITNESS in <5 min
node dist/cli.js quickstart --resume --repo /path/to/repo --question "..."   # advances ONE step, prints a continue line
node dist/cli.js quickstart --run <run-id> --resume                          # continues that run to completion
node dist/cli.js quickstart --run <run-id> --resume --bundle                  # continues, then seals a completed run
```

`quickstart --check` is a zero-write preflight. It does not make a run, write
`.cw/`, call the agent, write a report, or commit. It checks the app id, repo,
question, agent config, and (with `--bundle`) the trust-key shape, then gives the
next command to run. A blocked check exits non-zero, so scripts may use it as a
gate before a real run.

`quickstart --resume` with no `--run` drives a single step and prints a
copy-pasteable `cw quickstart --run <id> --resume` continue line; run it again with
the `--run <id>` to finish. The continuing invocation echoes `resumedFrom: <id>`.
Bare `quickstart` (no `--resume`) is unchanged — it drives straight to the end.
When `--bundle` is present on the fresh resume step, no bundle is sealed until
the run is complete; the continue line keeps `--bundle` so the second command
finishes and seals the report.

For faster first results, use the opt-in fast app in place of changing the full
review contract:

```text
node scripts/architecture-review-fast.js --repo /path/to/repo --question "Is the design sound?" --fast-model gpt-5.5-high --strong-model gpt-5.5-extra-high --metrics --schedule-full
```

`architecture-review-fast` has six workers: two Map and two Assess workers at the
same time, then Verify and Verdict workers one after the other. The original
`architecture-review` app stays the full 14-worker review and is the right target
for background routines when a deep audit can finish outside the user's
foreground wait.

The model flags are policy, not attestation: they set task-level `{{model}}`
hints for the delegated agent process. The recorded model still comes only from
the agent-reported output.

The wrapper works out the source-context digest and gives it to the fast app. For
external repositories, the documented no-profile command makes a repo-local
default `repo` profile over common tracked text surfaces. If the chosen profile
exports zero records, the wrapper refuses rather than handing the app an empty
context digest.
The two Map workers opt in to result caching keyed by source-context digest plus
prompt digest. The two Assess workers also opt in, but their cache key takes in
the completed previous-phase result digests so stale Map outputs do not count as
an Assess cache hit. A cache hit still goes through `recordWorkerOutput`
validation; a corrupt cached result parks/fails closed rather than spawning a
quiet fallback.

Verify and Verdict also get the source-context instruction so they do not have to
start by scanning the repo again. They are not result-cached; they still have to
cite evidence and make the final check from the accepted Map and Assess work.

`--metrics` is diagnostic and opt-in. It adds elapsed milliseconds, step counts,
agent-spawn counts, `result-cache` hit counts, source-context bytes/digest, and
one row per driven task with phase, task id, elapsed time, and spawn/cache state
to the wrapper JSON payload; without it, the wrapper's default output shape stays
unchanged.

`{{manifest}}`, `{{input}}`, `{{result}}`, `{{workerDir}}`, `{{model}}`, and
`{{prompt}}` are put into DISCRETE argv elements (never a shell-interpreted
string). Each verb is declared once in `capability-registry.ts`, so `cw <cmd>
--json` is byte-identical to the matching `cw_<tool>` MCP tool for the read-only
preview/config-show verbs.

## Live output — a calm live view, on stderr, Unix-clean

A drive shows the agent's activity live without ever touching the evidence
contract. The async per-vendor wrapper owns the live region (it parses
`--output-format stream-json` and its event loop is free); cw renders the calm
orchestration between agents plus the end-of-run summary. **Everything goes to
stderr — stdout stays the byte-exact data channel** (the `cw:result` fence, the
wrapper's `{model, usage, result}` JSON, cw's `--json` payload), so a pipe is
never polluted.

- **Interactive (TTY).** The wrapper renders ONE in-place status line: a Braille
  spinner + the current action + elapsed (e.g. `⠹ Read app.js 1.2s`). Tool calls
  fold to a single line each — spinning while running, then resolving to
  `✓ Read app.js (0.3s)` / `✗ Bash (1.1s)` (dimmed, args width-truncated). The
  cursor is hidden while the spinner runs and **ALWAYS restored** on exit /
  Ctrl-C / SIGTERM (Ctrl-C exits non-zero, leaving a clean terminal).
- **Non-TTY stays SILENT by default** (the Rule of Silence). `CW_AGENT_STREAM=1`
  opts a CI/piped run into a **plain append-only** trace (`→ …` / `✓ … (Xs)`
  lines, zero ANSI/cursor bytes) for debuggability — mirroring `CW_DRIVE_PROGRESS=1`.
- **Verbosity.** Default is compact: the current action + folded tool lines, with
  the model's narration/reasoning HIDDEN. `--verbose` (sets `CW_VERBOSE=1`)
  surfaces the full narration inline; `--full` (sets `CW_OUTPUT=full`) implies
  verbose AND prints the report inline at run end.
- **Transcript always on disk.** Regardless of verbosity — even when the screen
  view is silent or compact — the wrapper writes the COMPLETE narration + tool I/O
  to `transcript.md` next to that worker's `result.md`. The end-of-run summary
  prints the run dir where the transcripts live, so nothing is ever lost to a
  compact view.
- **Color control.** `NO_COLOR` / `CW_NO_COLOR` (the `--no-color` flag sets the
  latter) disable ANSI; `FORCE_COLOR` forces it even when piped; otherwise color
  follows isTTY. Honored identically by cw (`term.ts`) and every wrapper.
- **End-of-run summary (cw side).** A COMPACT findings table — id / severity /
  classification + counts, re-parsed from each completed worker's `cw:result` —
  plus the report path, status, and run dir. NOT the full prose (that stays in
  `report.md` + the transcript); `--full` also prints the report inline.
- **Determinism intact.** The backend evidence triple hashes stdout only, so the
  live stderr view never changes recorded evidence or replay.

The built-in templates are:

```text
--agent-command builtin:claude       # claude -p (native)
--agent-command builtin:codex        # codex exec (native)
--agent-command builtin:gemini       # Gemini via opencode (google/gemini-3.5-flash)
--agent-command builtin:gemini-cli   # native gemini CLI (needs GEMINI_API_KEY)
--agent-command builtin:opencode     # opencode (its configured default model)
--agent-command builtin:deepseek     # DeepSeek via opencode (deepseek/deepseek-chat)
```

claude and codex run their own CLIs; gemini and deepseek route through opencode
(where their keys live), each proven by a local, deterministic wrapper smoke
(override the model with CW_GEMINI_MODEL / CW_DEEPSEEK_MODEL). GLM stays an
external agent command or HTTP endpoint. CW still imports no model SDK. The same
headline shortcuts pick these builtins on the top-level CLI: `cw -q "..."
-claude` / `-codex` / `-gemini` / `-deepseek`.

The codex wrapper caps codex's reasoning effort for CW runs so a heavy
`model_reasoning_effort = "high"` in the user's `~/.codex/config.toml` does not
make every read/grep turn slow. It passes `codex exec -c
model_reasoning_effort=<effort>` (default `low`) for THAT run only — the user's
interactive codex is untouched. Raise it with `CW_CODEX_REASONING_EFFORT`
(`low` | `medium` | `high`).

When an agent hop fails, CW core keeps only the child's stdout + exit code, so a
bare `failed (exit 1)` hid the real cause (a relay 5xx, an auth error, a killed
run). Each wrapper now also drops the failed child's stderr to
`<run>/workers/<worker>/logs/agent-stderr.log`, so the reason is readable after
the fact without changing the recorded, byte-stable evidence.

## Compatibility

Agent Delegation Drive comes in first in CW v0.1.38. Adding the `agent` row leaves
`node`/`bun`/`shell`/`container`/`remote`/`ci` byte-identical; `backendIds()`
just grows by one to the sorted 7-row set
`["agent","bun","ci","container","node","remote","shell"]`. A run driven by hand
(plan → dispatch → `worker output` → commit) still works unchanged. Fields are
added on and optional; older run state loads unchanged. No `.cw/` layout change.

## See Also

execution-backends(7), real-execution-backends(7), node-snapshot-diff-replay(7),
control-plane-scheduling(7), dogfood-one-real-repo(7), cli-mcp-parity(7),
observability-cost-accounting(7)

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the bulk that can be built again, prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) in place of the changeable working tree — getting rid of false-red/false-green from working-tree writes at the same time (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter giving any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, Map and Assess results you can use again, wrapper metrics you can measure, a background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without changing the full review contract.

## Resumable Drive & Resume Routing (v0.1.81)

Adds `run resume <id> --drive/--once` next to `quickstart --resume`: a stopped pipeline starts up again in place, moving on to the end (`--drive`) or one fixed step (`--once`) over the same plan->dispatch->agent-fulfill->accept->commit lifecycle, echoing `resumedFrom: <id>`. Fixes the `run resume --drive` CLI routing so the drive flag reaches the resumed run in place of being read as an app name. Replay determinism and the agent evidence triple are unchanged.
_No behavioral change in v0.1.82 (drive/quickstart work out the run repo via an explicit base directory rather than process.chdir; delegation behavior is unchanged)._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

Orchestration-parity for the agent drive: `run --drive --incremental` step-level resume (unchanged-input tasks replay from a content-addressed cache, zero re-spawns), inline `subWorkflow()` nesting (a task runs a child app and binds its verified report back, bounded depth + cycle guard, no telemetry fabricated), bounded dynamic `loop()` phases that expand at runtime under a static replay-stable cap, and a `claude -p` wrapper now on the canonical result contract.

## 0.1.89 (v0.1.89)

The one-command `cw -q` headline now routes the question and defaults the repo to the caller cwd before driving the agent; the delegation contract, drive, and accept path are unchanged.

0.1.90

0.1.91

0.1.93

0.1.94

0.1.95
