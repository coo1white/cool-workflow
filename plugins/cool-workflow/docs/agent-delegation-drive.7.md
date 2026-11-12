# Agent Delegation Drive

`cw -q "<question>"` runs the `architecture-review` workflow end to end by
handing each worker to an EXTERNAL agent process (`claude -p`, `codex exec`,
`opencode run`, ...). CW keeps each worker's `result.md`, checks it, and ends
the run in one verifier-gated commit and a `report.md`. No person writes a
`result.md` by hand.

## The red line — delegate, do not internalize

CW **delegates; it does not become the executor.** It starts the agent as a
child process (argv-style, `shell:false`) and reads back what the agent wrote.
**The model runs in the agent's process, never inside CW.** CW brings in no
model SDK, holds no API key, builds no chat request, and calls no model HTTP
API. Any API key comes from the agent's own env; CW never reads or records it.
Adding a provider SDK to `package.json` is the red line.

## The boundary — core, agent driver, wrappers

The vendors live OUTSIDE the core, as wrapper scripts in `scripts/agents/`:
config, never imported by `src/`.

```text
cw -q "..." -codex
  src/cli/entry.ts           -codex -> builtin:codex
  src/shell/agent-config.ts  builtin:<name> -> node <dir>/<name>-agent.js {{input}} {{result}}
                             (scripts/agents/builtin-templates.json is DATA)
  src/shell/execution-backend/agent.ts
                             runAgent: spawn(binary, args, shell:false), read stdout
  ---- the seam: argv in, result.md + one stdout JSON line out ----
  scripts/agents/claude-p-agent.js, codex-agent.js, muse-agent.js,
  opencode-agent.js (gemini, deepseek), copilot-agent.js,
  antigravity-agent.js, grok-agent.js
```

Add a vendor: drop a wrapper script and one line in `builtin-templates.json`.
No core edit. Any `CW_AGENT_COMMAND="node my-agent.js {{input}} {{result}}"`
plugs in the same way; the builtins are bundled examples.

## The agent contract (cw-agent/1)

- **How it is started.** CW runs the command with no shell, as separate argv
  words, in the target repository. In each word it puts `{{input}}` (the
  worker's `input.md`: the task), `{{result}}` (the `result.md` path to
  write), `{{manifest}}` (`manifest.json`), `{{workerDir}}`, `{{model}}`,
  `{{prompt}}`, `{{phase}}`, `{{taskId}}`, `{{workerId}}` and
  `{{priorResults}}`. `{{priorResults}}` is the path of
  `<workerDir>/prior-results.json`, `{"schemaVersion": 1, "taskId", "phase",
  "priorResults": [...]}`: the accepted result of each task in an earlier
  phase. The file is written only for a command that names it. Stdin is
  closed. The env is short and fixed (see security-trust-hardening(7)); CW's
  own signing keys are never in it.
- **What it has to do.** Write the answer to `{{result}}` and exit 0. CW reads
  `result.md` the same way on every accept: a fenced `cw:result` JSON block
  (`{"summary": ..., "findings": [...], "evidence": [...]}`), or else plain
  Markdown, whose first line is the summary. A `cw:result` block that is not
  valid JSON is refused.
- **What it may say.** One JSON line on stdout with `"model"` (and
  `"usage"`), which CW records as the reported model; without it, the run
  records `unreported`. Its stderr is for people: on a failure CW keeps the
  last part, keys hidden, in `<workerDir>/logs/agent-stderr.log`.
- **How it ends.** Exit 0 with a `result.md` is done. Any other exit, no exit
  code, or no `result.md` is a failed hop: tried again, then parked after 3
  tries. Past `CW_AGENT_TIMEOUT_MS` (or `--agent-timeout-ms`, or `timeoutMs`
  in `$CW_HOME/agent-config.json`; 10 minutes by default) the agent is
  killed and the worker parks at once: an agent that hung for the full limit
  would most likely hang again.

The model CW passes in (`--agent-model`, `CW_AGENT_MODEL`, `{{model}}`) is the
operator's policy. The recorded model comes only from what the agent reports;
CW never fills it in from the policy and never checks the claim.

## The drive

```text
plan -> delegate (each phase; a parallel phase runs up to maxConcurrentAgents at once)
     -> collect result.md -> accept gates -> one verifier-gated commit -> report.md
```

- Each worker gets `.cw/runs/<run-id>/workers/worker-<task>-0001/` with
  `input.md` and `manifest.json`; a refused result's reason goes at the top of
  the next `input.md`, under "## Previous Attempt".
- The accept gates (security-trust-hardening(7)) run on each result. A worker
  that fails them 3 times is parked and the drive stops `blocked`; `report.md`
  is still written.
- When every worker is accepted, the commit is gated on the verdict task
  (verifier-gated-commit(7)). A refused commit leaves the run `blocked` on a
  `commit` step whose reason starts `final commit refused:`.
- `cw --resume --run <id>` runs the parked workers again, each with a fresh
  budget, and tries the commit again. Ctrl-C stops after the current step and
  prints that resume line; a second Ctrl-C exits at once.
- One drive per run: the drive holds `.cw/runs/<id>/drive.lock`
  (durable-state-and-locking(7)).

## Live output

Everything goes to stderr; stdout carries only data (`--json`).

- On a TTY, `[drive]` lines name each phase and each spawned agent; the
  wrapper draws the agent's live view. Piped, nothing is shown unless
  `CW_DRIVE_PROGRESS=1` (`[drive]` lines) or `CW_AGENT_STREAM=1` (the
  wrapper's plain trace). `--quiet` turns the `[drive]` lines off.
- While a round waits, one `[drive]   … <Phase> still working — 20s` line is
  added every `CW_DRIVE_TICK_MS` (10 s by default; `0` turns it off).
- A failed hop with tries left says why: `[drive] ✗ <task> (<phase>) — agent
  hop failed: ...; trying again (2/3)`.
- `--verbose` (`CW_VERBOSE=1`) shows the agent's full narration. The wrapper
  always writes it all to `transcript.md` next to the worker's `result.md`.
- `NO_COLOR` / `CW_NO_COLOR` (`--no-color`) turn color off; `FORCE_COLOR`
  forces it.

## Vendors

```text
-claude       builtin:claude       claude -p (native)
-codex        builtin:codex        codex exec (native)
-gemini       builtin:gemini       Gemini via opencode (CW_GEMINI_MODEL)
-opencode     builtin:opencode     opencode (its configured default model)
-deepseek     builtin:deepseek     DeepSeek via opencode (CW_DEEPSEEK_MODEL)
-muse         builtin:muse         muse exec (CW_MUSE_MODEL)
-copilot      builtin:copilot      copilot -p (beta)
-antigravity  builtin:antigravity  agy -p (beta)
-grok         builtin:grok         grok -p (CW_GROK_MODEL)
```

With no flag and no `CW_AGENT_COMMAND`, CW picks the first of claude, codex,
gemini, opencode, muse found on `PATH` (`CW_NO_AUTO_AGENT=1` turns this off).
Copilot, antigravity and grok are used only when asked for. Support tiers: a
release checks live only the vendors with a real-login receipt; a beta vendor
has a wrapper and an offline smoke only.

## CLI

```text
cw -q "Is the design sound?" -claude --repo <path>       # drive a repo end to end
cw -q "..." --agent-command "node <path>/scripts/agents/claude-p-agent.js {{input}} {{result}}"
cw --resume --run <run-id>                               # go on after a stop
cw report <run-id> --show                                # read the report
```

The bundled `claude-p-agent.js` wrapper feeds `input.md` to headless claude
read-only, writes `result.md` itself, and passes on claude's JSON
(model and usage). A bare `claude -p {{input}}` does NOT complete a worker:
headless claude gets no prompt content and cannot write `result.md`.

A `--repo` or `-d` that names no folder, or names a file, is refused before
anything is planned: exit 1, nothing written.

A run with no agent configured is still made, ends `blocked`, exits 2, and
prints how to set one.

## Compatibility

Agent Delegation Drive came in with CW v0.1.38. Batch 5 (2026-11-12) removed
the step verbs (`cw run`, `run --drive --once`, `run drive`, `quickstart`), the
execution backends other than the agent driver, the HTTP agent endpoint,
`--concurrency`, `--fast`, `--incremental`, `cw doctor --conformance`, and
replay through node snapshots. See release-and-migration(7), "Removed in
batch 5".

## See Also

verifier-gated-commit(7), security-trust-hardening(7),
durable-state-and-locking(7), doctor(7)

## Run Retention & Provable Reclamation (v0.1.39, removed)

tiered, append-only, hash-chained run reclamation (`cw gc`, `cw orphans`). Removed 2026-11-12; see release-and-migration(7), "Removed Surfaces".

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

0.1.96

0.1.97

0.1.98

0.2.0

0.2.1

0.2.2

0.2.3

0.2.4

0.2.5

0.2.6

0.2.7

0.2.8

0.3.0

0.3.1

0.3.2

0.3.3

0.4.0

0.4.1

0.4.2

0.4.3

0.4.4
