---
name: cool-workflow
description: >-
  Use when the user asks for Cool Workflow, CW, agent workflow control-plane,
  TypeScript workflow orchestration, phased multi-agent work, background
  workflow tasks, reusable workflow apps, or auditable agent run state.
---

# Cool Workflow

Cool Workflow (CW) is an agent workflow control-plane. Use it to turn broad tasks into a
TypeScript/Node workflow run with phases, agent task manifests, durable run
state, verifier-gated commits, and a final report.

CW is a control plane: it makes an agent host's work durable, inspectable,
verifiable, and replayable. **It delegates execution; it never runs models
itself.** The host still executes agents and enforces OS/process/network/
environment controls — CW records, validates, and gates.

## When To Use

Use this skill when the user asks for:

- `Cool Workflow` or `CW`
- agent workflow control-plane
- TypeScript workflow runner/orchestration
- multi-agent phased work
- background task style planning
- reusable workflow apps/scripts
- architecture review workflows
- canonical workflow apps such as `architecture-review`, `pr-review-fix-ci`,
  `release-cut`, and `research-synthesis`

## Core Model

CW has three layers:

- **Package**: installable shared runtime.
- **Skill**: trigger and operating instructions for the agent host (this file).
- **TypeScript Node/Bun runtime**: workflow definitions, state files, task
  queue, deterministic harness, verifier, commits, and reports.

Treat CW like a platform framework. The runtime owns the contract; developers write
workflow apps against it using `defineWorkflowApp`, `workflow`, `phase`,
`agent`, `artifact`, and `input`. First-class apps live under
`apps/<app-id>/app.json` with a plain JavaScript entrypoint; legacy
`workflows/*.workflow.js` factories remain valid as wrapped compatibility apps.

The runner does **not** spawn workers. It writes pending agent tasks to
`.cw/runs/<run-id>/tasks/*.md`. The agent host reads those tasks, spawns workers
only when the user explicitly asks for agent/parallel/background work, then
records results back with the runner.

CW records the model loop explicitly as:

```text
interpret -> act -> observe -> adjust -> checkpoint
```

Use this loop to explain workflow progress when reporting status.

## Operating Loop

1. Pick or create a workflow.
2. `node scripts/cw.js plan <workflow-id> ...` from the plugin root (or the
   absolute plugin script path).
3. `node scripts/cw.js dispatch <run-id> --limit N` to create a dispatch
   manifest for the current phase. Add `--sandbox <profile-id>` when an explicit
   worker policy profile is needed.
4. If — and only if — the user explicitly asked for agents, spawn one subagent
   per dispatched task with disjoint scopes.
5. Save each subagent summary to `.cw/runs/<run-id>/results/<task-id>.md`.
6. `node scripts/cw.js result <run-id> <task-id> <result-file>`.
7. When all required work is complete, `node scripts/cw.js report <run-id>`.
8. Synthesize the final user-facing answer from the report and verified
   evidence.

Run data is written to `.cw/runs/<run-id>/` under `--cwd`, or under `--repo`
when `--cwd` is not given. Durable state lives at
`.cw/runs/<run-id>/state.json`; `state check <run-id>` dry-runs migration and
normalization, failing closed on newer unsupported schemas while preserving
unknown user data. The runtime source is TypeScript under `src/`, compiled to
`dist/`.

## Capabilities

CW layers these on top of the plan → dispatch → record → verify → commit →
report chain. See `references/commands.md` for the exact invocations.

- **Workflow apps** — discover, validate, plan, package, and scaffold apps;
  canonical apps are `architecture-review`, `pr-review-fix-ci`, `release-cut`,
  `research-synthesis`.
- **Topologies** — `map-reduce`, `debate`, and `judge-panel` as deterministic
  userland recipes, not hidden autonomous coordination.
- **Multi-agent host surface** — high-level `run -> status -> step ->
  blackboard -> score -> select` plus operator views (dependencies, failures,
  adopted evidence), wrapping the low-level runtime state and the coordination
  filesystem.
- **Coordinator / blackboard** — durable shared substrate (topics, messages,
  context frames, artifact refs, snapshots, coordinator decisions).
- **Trust / policy / audit** — inspect role authority, message provenance,
  blackboard write decisions, and judge/panel rationale; missing
  policy/evidence/provenance/rationale fail closed.
- **State explosion management** — derived, provenance-backed digests for runs
  too large to read; summaries never delete raw records and fail closed when
  stale.
- **Eval & replay** — deterministic snapshot/replay/compare/score/gate/report
  for release-gate evidence under `.cw/evals/<suite-id>/`.
- **Sandbox profiles** — named CW policy contracts (read/write paths, command,
  network, environment, host enforcement); CW validates, the host enforces.
- **Scheduling & routines** — loop/cron/reminder schedules and API/GitHub
  trigger routines.

## Essential Commands

```bash
node scripts/cw.js list
node scripts/cw.js plan architecture-review --repo /path/to/repo --question "Is this architecture sound?"
node scripts/cw.js dispatch <run-id> --limit 6
node scripts/cw.js result <run-id> <task-id> /path/to/result.md
node scripts/cw.js report <run-id> --show
```

When working in this repository, the plugin root is `plugins/cool-workflow`.
When installed from a GitHub package source, the host resolves the package root
from the source snapshot.

**For the full command catalog and the matching MCP tool surface, read
`references/commands.md`.** It covers apps, topologies, the multi-agent host and
low-level state, eval/replay, blackboard/coordinator, sandbox profiles, commit/
state/summaries, scheduling/routines, and release scripts.

## CLI / MCP Parity

When an MCP host is available, the same runtime surface is exposed with
JSON-first `cw_*` tools (see `references/commands.md`). Operator output is
human-readable by default; pass `--json` / `--format json` for structured
output. **Preserve CLI/MCP parity when extending CW** — every CLI capability
must have a matching MCP tool and vice versa. Status recommendations are
deterministic hints, not hidden automation.

## Multi-Agent Rule

Only spawn workers when the user explicitly asks for agents, delegation,
parallel work, or background work. Otherwise run the phases locally in the main
thread and still use CW state/report files when helpful.

## Result Quality

Subagent results should be concise, evidence-based, and ready for synthesis.
Avoid raw logs unless they are the evidence. Use absolute file paths and line
numbers when referencing local code. Verification and verdict tasks must include
a `cw:result` JSON fence with `findings` and `evidence`; CW rejects P0/P1/P2
findings without evidence.

## Release Discipline

Run `npm run release:check` before tagging a release. It is a dry-run gate that
builds, type-checks, runs tests, validates canonical apps and the golden path,
checks old run fixtures, runs the multi-agent / topology / CLI-MCP / operator /
trust-audit / eval-replay / dogfood smoke coverage, and verifies version
synchronization — without tagging, pushing, publishing, or mutating fixtures.
Use `npm run dogfood:release` to exercise the canonical `release-cut` app
against this repo in dry-run mode. See `references/commands.md` for the full
release/maintenance script list.
