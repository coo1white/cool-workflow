# Spec: muse (spark) as a delegated agent

Intent: [2026-09-01-muse-spark-agent.md](2026-09-01-muse-spark-agent.md)

## Interface record (probed live on the operator's machine, 2026-09-01)

- Binary: `muse` (Muse Code 0.1.0). Headless mode: `muse exec`.
- Flags that matter: `--json` (JSONL events on stdout), `--prompt-file
  <path>`, `--model <id>`, `--workspace <path>`, `--provider echo|meta`
  (echo = credential-free, answers `echo: <prompt>`; meta = default,
  real).
- Stream shape: JSONL records with a `payload_type` field. The final
  answer arrives in the LAST terminal event, `payload_type ===
  "run.terminal.completed"`, whose `payload.terminal === "completed"`
  and `payload.text` carries the full final text. `run.output.delta`
  events stream partial text before it. A run that ends with
  `payload.terminal !== "completed"` (or with no terminal event) is a
  FAILURE — the wrapper must exit non-zero, never fabricate a result.
- No usage/token event was seen in echo mode. Usage extraction is
  best-effort: if a usage-bearing event exists (meta provider), report
  it; otherwise omit `usage` and let CW's telemetry record honest
  absence.

## Design

1. `scripts/agents/muse-agent.js` — new wrapper, same shape and
   helpers as `codex-agent.js` (`agent-adapter-core`: buildPrompt,
   parseJsonLines, emitReport, writeResult, renderer). Spawns
   `muse exec --json --prompt-file <input> --model $CW_MUSE_MODEL`
   (default `spark`) in the worker cwd; add `--workspace <cwd>` so
   muse's own policy-gated tools root at the worker dir. Contract:
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
   precedent) that emits the recorded JSONL shape above, including the
   failure case (terminal !== completed => wrapper exits non-zero,
   result.md absent). The REAL local proof (muse 0.1.0, echo provider)
   is run once by the executor on this machine and its output quoted
   in the PR body — the "wrapper stream shape proven by a local smoke"
   bar the earlier vendors met.

## Budget

Net src+test <= 400 lines. New files: wrapper + smoke only. New .md:
ZERO. Header comments <= 15 lines. Core source-context guard 54000
untouched (wrapper lives in scripts/, outside the profile — executor
verifies rather than assumes).

## Release step (after the feature merges)

The manager prepares the version-bump PR for 0.2.7 (`npm run
bump:version -- 0.2.7`, content surfaces per its gate, full
`release:check` green, reviewer-agent approval per AGENTS.md), merges
it on green, and STOPS. The operator runs `npm run release -- 0.2.7`
with the signing key — that step never moves to an agent.

## Status ledger

| Item | State | PR |
|---|---|---|
| Intent/spec | committed | — |
| muse wrapper + wiring | in build | — |
| Release-prep bump PR (0.2.7) | queued | — |
