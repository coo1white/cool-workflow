```text
══════════════════════════════════════════════════════════════════════
  C O O L   W O R K F L O W   ·   CW
  auditable agent-workflow control-plane — delegate, don't execute
  plan → dispatch → record → verify → commit → report
══════════════════════════════════════════════════════════════════════
```

[![CI](https://img.shields.io/github/actions/workflow/status/coo1white/cool-workflow/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/coo1white/cool-workflow/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/tag/coo1white/cool-workflow?style=flat-square&label=release&color=brightgreen&sort=semver)](https://github.com/coo1white/cool-workflow/tags)
[![license](https://img.shields.io/github/license/coo1white/cool-workflow?style=flat-square&label=license&color=blue)](LICENSE)
![MCP](https://img.shields.io/badge/MCP-native-8A2BE2?style=flat-square)
![runtime](https://img.shields.io/badge/runtime-TypeScript%20%C2%B7%20Node-3178C6?style=flat-square)

**Cool Workflow (CW)** is an Agent Workflow SDK for turning broad agent tasks
into durable, inspectable workflow runs. It records what happens; the agent
host still runs the models. CW makes the work durable, inspectable, verifiable,
and replayable — without ever becoming the executor.

**[Quick Start](#quick-start)** · [Install](#install-as-a-plugin) · [Concepts](#the-mental-model) · [What's Included](#what-is-included) · [Apps](#bundled-workflow-apps) · [Multi-Agent](#multi-agent-work) · [Eval / Replay](#eval-and-replay) · [Docs](#docs)

It is a small TypeScript/Node runtime with a CLI, MCP tools, reusable workflow
apps, multi-agent coordination records, and release-grade replay checks.

## What I actually built

Most "agent frameworks" treat a task as one long prompt and hope for the best.
Cool Workflow treats it as a **runtime problem**: make the work durable,
inspectable, and verifiable, the same way an OS makes processes durable and
inspectable.

The whole system is one idea repeated at every layer:

```text
plan → dispatch → record evidence → verify → verifier-gated commit → report
```

- **Explicit state, no magic.** Every run is plain JSON under `.cw/runs/<id>/`.
  You can read it, diff it, resume it, replay it. There is no hidden dashboard
  database and the runtime never *infers* success — ambiguity is a visible state.
- **Evidence over vibes.** Results carry provenance. The Evidence Adoption
  reasoning chain records *why* something was adopted or rejected — basis,
  authority, rationale, and the counterfactual it beat — and fails closed to
  `unexplained` rather than fabricating a reason.
- **Multi-agent as a process table.** Roles, memberships, a shared blackboard,
  and reusable topologies (map-reduce, debate, judge-panel) with policy + audit.
- **Verified, not hand-checked.** A deterministic eval/replay harness and a
  verifier-gated commit model gate every release; `release:check` is a dry-run
  that builds, type-checks, tests, replays, and self-dogfoods on this repo.
- **One kernel, many front doors.** A shared CLI + MCP (JSON-RPC 2.0) runtime;
  vendor plugin manifests (Claude, Codex, …) are *generated* from a single
  source of truth, with a fail-closed drift check so no adapter forks the logic.

Design philosophy is deliberately Unix/BSD:

```text
Small kernel. Explicit state. Composable pipes.
Isolated workers. Verifier-gated commits. Docs as man pages.
```

~22k lines across 34 modules · 26 smoke tests · 6 bundled workflow apps ·
evidence-gated commits · deterministic replay.

## Why CW Exists

Agent work gets hard to trust when the task is long, parallel, or high-stakes.
CW gives agent hosts a shared runtime contract:

| Problem | CW answer |
| --- | --- |
| Work disappears into chat history | Durable run state in `.cw/runs/<run-id>/` |
| Subtasks are hard to track | Task files, dispatch manifests, worker outputs |
| Results lack evidence | Result envelopes, provenance, audit records |
| Many candidates compete | Candidate scoring and explicit selection |
| Unsafe changes slip through | Verifier-gated commits or named checkpoints |
| Multi-agent work gets messy | Topologies, blackboards, fanout/fanin, operator views |
| Releases need confidence | Golden path, fixture compatibility, eval/replay gates |

## Quick Start

Get a cited architecture-risk report on any repo in **one command**:

```bash
git clone https://github.com/coo1white/cool-workflow.git
cd cool-workflow/plugins/cool-workflow

node scripts/cw.js quickstart architecture-review \
  --repo /path/to/your/repo \
  --question "What are the main architecture risks?" \
  --agent-command "claude -p"
```

That single command plans the run, drives every worker to completion, and writes
the report — no copied run id, no 10-step ritual. The JSON it prints back carries
the `runId`, `status`, `completedWorkers`, and the `reportPath`:

```bash
# read the generated report
cat /path/to/your/repo/.cw/runs/<runId>/report.md
```

**`quickstart` drives YOUR agent, it does not run a model.** CW is an auditable
control plane: the one command sequences the recorded `plan -> run --drive ->
report` pipeline and **delegates** every worker to the agent backend *you*
configure (`--agent-command "claude -p"`, `--agent-command "codex exec"`, or
`--agent-endpoint https://…`). CW never embeds a model SDK, never holds an API
key, and never executes a model itself. With **no** agent configured it **fails
closed** — it reports `status: blocked` and refuses rather than fabricating a
completion:

```bash
# no --agent-command and no CW_AGENT_COMMAND ⇒ status: blocked, never fabricated
node scripts/cw.js quickstart architecture-review --repo ../.. --question "risks?"
```

Set the backend once via the environment instead of a flag:

```bash
export CW_AGENT_COMMAND="claude -p"
node scripts/cw.js quickstart architecture-review --repo ../.. --question "risks?"
```

Add `--preview` for a read-only, deterministic dry run (it plans and projects the
next step but spawns nothing and commits nothing). `audit-run` is an alias of
`quickstart`.

### Under the hood

`quickstart` is a thin convenience wrapper, not a new engine — it composes the
existing verbs you can also run by hand. First, inspect the bundled runtime
(`dist/` is committed, so it works immediately):

```bash
node scripts/cw.js list
node scripts/cw.js app list
node scripts/cw.js app show architecture-review
```

Create a local architecture-review run:

```bash
node scripts/cw.js plan architecture-review \
  --repo ../.. \
  --question "What are the main architecture risks?"
```

Copy the returned `runId`, then drive it (delegating to your agent) and inspect:

```bash
node scripts/cw.js run <run-id> --drive --agent-command "claude -p"
node scripts/cw.js status <run-id>
node scripts/cw.js graph <run-id>
node scripts/cw.js worker summary <run-id>
node scripts/cw.js report <run-id> --show
```

Or step the pipeline manually, dispatching one worker at a time:

```bash
node scripts/cw.js dispatch <run-id> --limit 1 --sandbox readonly
node scripts/cw.js worker summary <run-id>
```

Run data is written to `.cw/runs/<run-id>/` in the target repo/cwd.
`dispatch` creates task manifests for an agent host or operator to execute; CW
records the state and evidence, while the host still runs the workers.

## Install as a Plugin

CW ships vendor manifests for multiple agent hosts. All of them are generated
from one source of truth (`plugins/cool-workflow/manifest/plugin.manifest.json`)
and point at the same shared runtime — no forked logic per vendor. See
[plugins/cool-workflow/manifest/README.md](plugins/cool-workflow/manifest/README.md).

### Claude Code

Add this repository as a local marketplace, then install the plugin:

```text
/plugin marketplace add /absolute/path/to/cool-workflow
/plugin install cool-workflow@cool-workflow
```

Or load it for a single session without installing:

```bash
claude --plugin-dir /absolute/path/to/cool-workflow/plugins/cool-workflow
```

To persist for a project/team, add to `.claude/settings.json`:

```json
{
  "enabledPlugins": { "cool-workflow@cool-workflow": true }
}
```

The Claude MCP server is auto-discovered from `plugins/cool-workflow/.mcp.json`
(it resolves `${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js`). After installing,
`/plugin list` confirms the plugin and `/reload-plugins` reloads after changes.

### Codex / other hosts

Codex reads `plugins/cool-workflow/.codex-plugin/plugin.json`, which references
its own `.codex-plugin/mcp.json`. The bundled `skills/` and `dist/` runtime are
shared across every vendor. Even where plugins are unavailable, the CLI
(`node scripts/cw.js ...`) is the lowest-common-denominator interface.

## The Mental Model

CW is a base system. Workflow apps are userland.

```text
workflow app
  -> validated inputs
  -> phases and tasks
  -> dispatch manifests
  -> worker outputs
  -> feedback, candidates, scores
  -> verifier-gated commit or checkpoint
  -> final report
```

The runtime records what happened. The agent host still executes workers and
enforces OS/process/network/environment controls.

## What Is Included

| Area | What it gives you |
| --- | --- |
| Workflow App SDK | Versioned app manifests, inputs, phases, tasks, artifacts, and validation |
| CLI runtime | Human-friendly commands for planning, dispatching, inspecting, and reporting |
| MCP surface | JSON-first tool parity for agent hosts |
| Sandbox Profiles | Named read/write/command/network/env policy contracts |
| Worker isolation | Worker manifests, result files, failure records, and scoped outputs |
| Candidate scoring | Register, score, rank, select, and reject competing outputs |
| Verifier-gated commits | Only verified state becomes committed state |
| Operator UX | `status`, `graph`, summaries, reports, and deterministic next actions |
| Coordinator / Blackboard | Shared topics, messages, artifacts, context, snapshots, and decisions |
| Multi-agent runtime | Runs, roles, groups, memberships, fanout/fanin, and lifecycle state |
| Multi-agent topologies | Official `map-reduce`, `debate`, and `judge-panel` recipes |
| Trust / policy / audit | Provenance, role authority, policy violations, judge rationale |
| Eval / replay harness | Deterministic snapshots, replay, comparison, scoring, gates, reports |

## Bundled Workflow Apps

| App | Use it for |
| --- | --- |
| `architecture-review` | Map a repo, assess risks, verify findings, synthesize a verdict |
| `pr-review-fix-ci` | Review a PR/branch, inspect CI, propose and verify fixes |
| `release-cut` | Prepare a release with checklist discipline and dry-run evidence |
| `research-synthesis` | Split a research question, verify claims, produce a concise synthesis |
| `end-to-end-golden-path` | Prove the public app -> worker -> score -> commit -> report chain |
| `workflow-app-sdk-demo` | Learn the app manifest and workflow entrypoint contract |

Useful commands:

```bash
node scripts/cw.js app list
node scripts/cw.js app show release-cut
node scripts/cw.js app validate apps/release-cut/app.json
node scripts/cw.js app init my-app --title "My App"
```

## Multi-Agent Work

CW records multi-agent coordination as ordinary state. The preferred high-level
host loop is:

```text
multi-agent run -> status -> step -> blackboard -> score -> select
```

Example:

```bash
node scripts/cw.js multi-agent run <run-id> --topology judge-panel --task <task-id>
node scripts/cw.js multi-agent status <run-id>
node scripts/cw.js multi-agent step <run-id> --sandbox readonly
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js multi-agent dependencies <run-id>
node scripts/cw.js multi-agent failures <run-id>
node scripts/cw.js multi-agent evidence <run-id>
```

Official topology recipes:

| Topology | Shape |
| --- | --- |
| `map-reduce` | Fan out mapper roles, collect evidence, then reduce |
| `debate` | Record opposing claims, rebuttals, conflicts, and synthesis |
| `judge-panel` | Gather independent judge outputs and select with provenance |

```bash
node scripts/cw.js topology list
node scripts/cw.js topology show map-reduce
node scripts/cw.js topology apply <run-id> map-reduce --task <task-id>
node scripts/cw.js topology summary <run-id>
node scripts/cw.js topology graph <run-id>
```

## Eval And Replay

For topology-backed multi-agent runs, CW can snapshot and replay run evidence
without live agents.

```bash
node scripts/cw.js eval snapshot <run-id> --id <suite-id>
node scripts/cw.js eval replay .cw/evals/<suite-id>/snapshot.json
node scripts/cw.js eval compare \
  .cw/evals/<suite-id>/snapshot.json \
  .cw/evals/<suite-id>/replay-run.json
node scripts/cw.js eval score .cw/evals/<suite-id>/replay-run.json
node scripts/cw.js eval gate .cw/evals/<suite-id>
node scripts/cw.js eval report .cw/evals/<suite-id>/replay-run.json
```

Artifacts live under `.cw/evals/<suite-id>/`.

## Development

Install dependencies only when you are changing TypeScript source or running
the full test suite.

```bash
cd plugins/cool-workflow
npm install
npm run build
npm run check
npm test
```

High-signal regression commands:

```bash
npm run canonical-apps
npm run golden-path
npm run eval:replay
npm run fixture-compat
npm run release:check
npm run dogfood:release
```

`release:check` is a dry-run gate. It builds, type-checks, runs tests,
validates canonical apps and golden path behavior, checks fixture
compatibility, verifies docs/version sync, and does not tag, push, publish, or
rewrite fixtures.

## Repository Layout

```text
plugins/cool-workflow/                CW package
plugins/cool-workflow/src/            TypeScript runtime source
plugins/cool-workflow/dist/           Committed JavaScript runtime output
plugins/cool-workflow/apps/           Canonical workflow apps and examples
plugins/cool-workflow/docs/           Feature and contract documentation
plugins/cool-workflow/scripts/cw.js   CLI entrypoint
plugins/cool-workflow/skills/         Agent host skill instructions
plugins/cool-workflow/test/           Smoke tests for public contracts
examples/                             Example workflow outputs
```

## Docs

Start here:

- [Getting Started](plugins/cool-workflow/docs/getting-started.md)
- [Project Index](plugins/cool-workflow/docs/project-index.md)
- [Workflow App SDK](plugins/cool-workflow/docs/workflow-app-sdk.7.md)
- [Operator UX](plugins/cool-workflow/docs/operator-ux.7.md)
- [MCP App Surface](plugins/cool-workflow/docs/mcp-app-surface.7.md)
- [Multi-Agent CLI + MCP Surface](plugins/cool-workflow/docs/multi-agent-cli-mcp-surface.7.md)
- [Multi-Agent Eval & Replay Harness](plugins/cool-workflow/docs/multi-agent-eval-replay-harness.7.md)
- [Agent Delegation Drive](plugins/cool-workflow/docs/agent-delegation-drive.7.md)
- [Release And Migration](plugins/cool-workflow/docs/release-and-migration.7.md)

Full docs map: [plugins/cool-workflow/docs/index.md](plugins/cool-workflow/docs/index.md)

## Status

CW is an independent Agent Workflow SDK by COOLWHITE LLC. It is released under
the BSD-2-Clause License.
