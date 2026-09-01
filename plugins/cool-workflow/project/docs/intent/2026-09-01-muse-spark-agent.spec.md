# Spec: muse (spark) as a delegated agent

Intent: [2026-09-01-muse-spark-agent.md](2026-09-01-muse-spark-agent.md)

## Interface record (probed live on the operator's machine, 2026-09-01)

Probed twice the same day: first on Muse Code 0.1.0, then again after
the CLI self-updated to 1.0.1 — the 1.0.1 record below is the one that
binds. Muse Code is made by Meta Superintelligence Labs; the current
model id is `muse-spark-1.2` (per dev.meta.ai docs and the operator).

- Binary: `muse` (Muse Code 1.0.1, build 1.0.1-R2006.1). Headless
  mode: `muse exec`.
- Flags that matter: `--json` (JSONL events on stdout), `--prompt-file
  <path>`, `--model <id>` (ACCEPTED ONLY with `--provider meta` — the
  echo provider rejects it, probed), `--provider echo|meta` (echo =
  credential-free, answers `echo: <prompt>`; meta = default, real),
  `--reasoning-effort none|minimal|low|medium|high|xhigh|ultra`
  (default high), `--workspace <path>` (roots muse's policy-gated
  tools; still present in 1.0.1), `--max-model-steps <n>`.
- Stream shape: JSONL records with a `payload_type` field. The final
  answer arrives in the LAST terminal event, `payload_type ===
  "run.terminal.completed"`, whose `payload.terminal === "completed"`
  and `payload.text` carries the full final text. `run.output.delta`
  events stream partial text before it. A run that ends with
  `payload.terminal !== "completed"` (or with no terminal event) is a
  FAILURE — the wrapper must exit non-zero, never fabricate a result.
- Failure detail (probed on 1.0.1 with a rejected API key): the
  `run.terminal.failed` event carries `payload.reason` in plain words
  (for example: "your saved API key was rejected — run `muse login`
  or add a new key"). The wrapper MUST print that reason as its own
  error line — the user then knows the next step without any digging.
- Event names seen on 1.0.1 (echo probe): `runtime.command.accepted`,
  `session.run.linked`, `turn.input.user`, `run.lifecycle.started`,
  `task.lifecycle.*`, `run.output.delta`, `run.terminal.completed` —
  the terminal contract is unchanged from 0.1.0.
- No usage/token event was seen in echo mode. Usage extraction is
  best-effort: if a usage-bearing event exists (meta provider), report
  it; otherwise omit `usage` and let CW's telemetry record honest
  absence.

## Design

1. `scripts/agents/muse-agent.js` — new wrapper, same shape and
   helpers as `codex-agent.js` (`agent-adapter-core`: buildPrompt,
   parseJsonLines, emitReport, writeResult, renderer). Spawns
   `muse exec --json --prompt-file <input> --model $CW_MUSE_MODEL`
   (default `muse-spark-1.2` — the official Meta model id; a bare
   `spark` is NOT a listed id) in the worker cwd; add `--workspace
   <cwd>` so muse's own policy-gated tools root at the worker dir.
   Reasoning effort follows the codex-agent precedent: pass
   `--reasoning-effort $CW_MUSE_REASONING_EFFORT` (default `low` for
   a fast delegated worker; a release review under CW_RELEASE_REVIEW=1
   defaults to `high`; an explicit env value always wins). On a failed
   terminal event, print `payload.reason` word for word. Contract:
   argv[2] = input.md, argv[3] = result.md; stdout = one
   `{ model, usage, result }` JSON; stderr trace only when
   `CW_AGENT_STREAM=1` (render payload_type highlights). Model field =
   the id actually passed (self-reported convention). Fail closed on
   non-completed terminal, non-zero muse exit, or unparseable stream.
2. `scripts/agents/builtin-templates.json` — add `"muse":
   "muse-agent.js"` (data-only vendor add, as designed).
3. `src/cli/entry.ts` — `-muse` flag mapping to `builtin:muse`,
   mirroring `-deepseek`.
4. Auto-detect + doctor: follow the existing mechanism for `codex`
   (executor locates it — likely `agent-config.ts` detect list and
   doctor's agent probe) and add `muse` the same way. If auto-detect
   is table-driven, this is one row; if not, escalate before writing.
5. Docs (edits only, ZERO new .md): the sites that enumerate agent
   CLIs — root README ("one agent CLI on your machine": add muse; run
   `sync:readme` for the npm mirror), `docs/getting-started.md`, and
   the agent-delegation man page's vendor list. Nothing else.
6. Tests: one new smoke `agent-muse-native-smoke.js`, hermetic — a
   FAKE `muse` executable on PATH (per the gemini-native smoke's
   precedent) that emits the recorded 1.0.1 JSONL shape above,
   including the failure case (terminal !== completed => wrapper exits
   non-zero, result.md absent, AND the fake's `payload.reason` text
   appears in the wrapper's stderr). The REAL local proof (muse 1.0.1,
   echo provider — WITHOUT `--model`, which echo rejects) is run once
   by the executor on this machine and its output quoted in the PR
   body — the "wrapper stream shape proven by a local smoke" bar the
   earlier vendors met.

## Budget

Net src+test <= 400 lines. New files: wrapper + smoke only. New .md:
ZERO. Header comments <= 15 lines. Core source-context guard 54000
holds. CORRECTION (from the manager's acceptance, 2026-09-01): this
spec first said the wrapper is "outside the profile" — that was
false. `scripts/agents/**` is counted INSIDE both the `core` (54000)
and `agent-wrappers` (14000) source-context profiles. The numbers
still held: core closed at 52682/54000, agent-wrappers at 6346/14000.

## Vendor default refresh (pre-release, own small PR)

Ruling from the operator's product direction (2026-09-01): CW adapts
to the user's models — a pinned default that has gone stale is OUR
defect, never the user's problem. A web check of every vendor's
official pages (six research agents, 2026-09-01) found two rotten
pins and no other break:

- `deepseek-agent.js` default `deepseek/deepseek-chat`: the
  `deepseek-chat` alias was discontinued by DeepSeek on 2026-07-24
  (api-docs.deepseek.com/updates). New default:
  `deepseek/deepseek-v4-flash`. The executor MUST verify the exact
  id against the local opencode install (models.dev naming) before
  pinning, and quote that check in the PR body.
- `gemini-opencode-agent.js` default `google/gemini-3.5-flash`: still
  a live model, but two GA releases behind. New default:
  `google/gemini-3.7-flash` (GA 2026-08-13, built for coding work).
  Same local verification rule.
- All other vendors follow each CLI's own default — nothing to do.
  The codex wrapper was proven live on codex-cli 0.139.0 (model
  gpt-5.6-terra, usage complete, result exact) on 2026-09-01.

Budget: string + doc-line changes only, no new files, zero new .md.

## Release step (after the feature merges)

The manager prepares the version-bump PR for 0.2.7 (`npm run
bump:version -- 0.2.7`, content surfaces per its gate, full
`release:check` green, reviewer-agent approval per AGENTS.md), merges
it on green, and STOPS. The operator runs `npm run release -- 0.2.7`
with the signing key — that step never moves to an agent.

## Status ledger

Program COMPLETE on the agent side 2026-09-01. The one open step is
the operator's own: `npm run release -- 0.2.7` with the signing key.

| Item | State | PR |
|---|---|---|
| Intent/spec | merged | #592 |
| Spec update to muse 1.0.1 + default refresh | merged | #594 |
| muse wrapper + wiring | merged | #593 |
| Vendor default refresh | merged | #595 |
| Release-prep bump PR (0.2.7) | merged | #596 |

Closing numbers: test:gate 265/265 (the new muse smoke included);
conformance 106/106 on every PR; net wrapper lines exactly 400/400;
core source-context 52682/54000; agent-wrappers 6346/14000; new .md
ZERO across the whole program. Fix rounds: 3 (wrapper) + 1 + 1. Known
ceiling left behind: the `-q` headline help line sits at 75 of its
80-char cap with five vendor flags — a sixth vendor flag needs a
wrapping mechanism first (parked in BACKLOG.md). A real meta-provider
proof stays open until the operator runs `muse login` (the saved
Meta API key was rejected; the echo-provider proof shipped instead).
