# Cool Workflow Project Index

Generated from the current repository code on 2026-06-07 by `npm run sync:project-index`.

## Snapshot

- Package: `cool-workflow`
- Version: `0.1.21`
- Source modules: `30`
- Workflow apps: `6`
- Docs: `27`
- Smoke tests: `20`
- Repository: https://github.com/coo1white/cool-workflow

## Architecture

```text
workflow app -> runner -> dispatch -> isolated workers
    -> results -> feedback/candidates -> verifier gate
    -> commit/checkpoint -> report/trust audit

multi-agent host -> topology -> blackboard/coordinator
    -> fanout/fanin -> candidate score/select
```

## Source Map

### Core runtime

| Module | Responsibility |
| --- | --- |
| [orchestrator.ts](../src/orchestrator.ts) | Plans runs, loads workflows, records results, writes reports, and exposes runner commands. |
| [state.ts](../src/state.ts) | Persists run checkpoints, JSON state, run paths, and state migration entrypoints. |
| [state-node.ts](../src/state-node.ts) | Defines explicit state nodes, pipeline transitions, evidence checks, and node persistence. |
| [pipeline-contract.ts](../src/pipeline-contract.ts) | Builds the default pipeline contract used by run state. |
| [pipeline-runner.ts](../src/pipeline-runner.ts) | Finds runnable stages and advances/fails pipeline nodes with retry-aware errors. |
| [types.ts](../src/types.ts) | Owns the shared workflow, run, app, evidence, worker, candidate, audit, and topology types. |

### Verification and state gates

| Module | Responsibility |
| --- | --- |
| [verifier.ts](../src/verifier.ts) | Validates result envelopes, findings, evidence, and run gate completion. |
| [commit.ts](../src/commit.ts) | Creates verifier-gated commits and explicit manual checkpoints. |
| [candidate-scoring.ts](../src/candidate-scoring.ts) | Registers, scores, ranks, selects, rejects, and summarizes candidate outputs. |
| [error-feedback.ts](../src/error-feedback.ts) | Turns failures into persisted feedback records and correction tasks. |
| [trust-audit.ts](../src/trust-audit.ts) | Records provenance, sandbox decisions, host attestations, and acceptance rationale. |

### Workers and policy

| Module | Responsibility |
| --- | --- |
| [dispatch.ts](../src/dispatch.ts) | Selects runnable tasks and writes dispatch manifests. |
| [worker-isolation.ts](../src/worker-isolation.ts) | Allocates worker scopes, writes manifests, records worker outputs, and validates boundaries. |
| [sandbox-profile.ts](../src/sandbox-profile.ts) | Resolves named sandbox policy contracts and validates read/write/command/network boundaries. |
| [harness.ts](../src/harness.ts) | Renders task files for dispatched work. |

### Multi-agent layer

| Module | Responsibility |
| --- | --- |
| [multi-agent.ts](../src/multi-agent.ts) | Persists multi-agent runs, roles, groups, memberships, fanouts, and fanins. |
| [coordinator.ts](../src/coordinator.ts) | Owns blackboard topics, messages, context, artifacts, snapshots, and coordinator decisions. |
| [topology.ts](../src/topology.ts) | Defines and applies official map-reduce, debate, and judge-panel topologies. |
| [multi-agent-host.ts](../src/multi-agent-host.ts) | Provides the preferred host loop for run, status, step, blackboard, score, and select. |

### User and host surfaces

| Module | Responsibility |
| --- | --- |
| [cli.ts](../src/cli.ts) | Routes human CLI commands to runtime, app, topology, multi-agent, and operator flows. |
| [mcp-server.ts](../src/mcp-server.ts) | Exposes JSON-RPC/MCP tool parity for agent hosts. |
| [operator-ux.ts](../src/operator-ux.ts) | Formats status, reports, graph, worker, candidate, feedback, commit, and trust summaries. |
| [workflow-app-sdk.ts](../src/workflow-app-sdk.ts) | Validates app manifests and loads app entrypoints. |
| [workflow-api.ts](../src/workflow-api.ts) | Provides the fluent workflow, phase, task, artifact, and input API. |
| [daemon.ts](../src/daemon.ts) | Runs scheduled tasks through the desktop scheduler daemon. |
| [scheduler.ts](../src/scheduler.ts) | Creates, stores, computes, and runs schedules. |
| [triggers.ts](../src/triggers.ts) | Bridges routine triggers to explicit workflow events. |
| [version.ts](../src/version.ts) | Defines current package and state schema versions. |

### Other Source Modules

- [multi-agent-operator-ux.ts](../src/multi-agent-operator-ux.ts)
- [state-migrations.ts](../src/state-migrations.ts)

## Workflow Apps

| App | Type | Inputs | Sandbox | Source |
| --- | --- | --- | --- | --- |
| `architecture-review` - Map a repository architecture, assess risks, verify important findings, and synthesize an evidence-backed verdict. | canonical | `repo`, `question`, `invariant`, `focus` | `readonly` | [manifest](../apps/architecture-review/app.json) / [workflow](../apps/architecture-review/workflow.js) |
| `end-to-end-golden-path` - Deterministic one-worker workflow app for proving the CW integration chain. | userland | `question` | `readonly` | [manifest](../apps/end-to-end-golden-path/app.json) / [workflow](../apps/end-to-end-golden-path/workflow.js) |
| `pr-review-fix-ci` - Review a pull request or branch, inspect CI failures, diagnose actionable issues, optionally patch, verify, and summarize with evidence. | canonical | `repo`, `pr`, `branch`, `base`, `ci`, `mode` | `readonly`, `workspace-write` | [manifest](../apps/pr-review-fix-ci/app.json) / [workflow](../apps/pr-review-fix-ci/workflow.js) |
| `release-cut` - Prepare a release with checklist discipline: version checks, changelog, tests, packaging, release notes, and final verification. | canonical | `repo`, `version`, `previousVersion`, `releaseBranch`, `dryRun` | `readonly`, `workspace-write` | [manifest](../apps/release-cut/app.json) / [workflow](../apps/release-cut/workflow.js) |
| `research-synthesis` - Split a research question into claims, investigate sources, cross-check evidence, verify claims, and synthesize a concise answer. | canonical | `question`, `source`, `scope`, `freshness` | `readonly`, `locked-down` | [manifest](../apps/research-synthesis/app.json) / [workflow](../apps/research-synthesis/workflow.js) |
| `workflow-app-sdk-demo` - Small SDK app showing inputs, phases, evidence gates, and sandbox profile hints. | example | `question` | `readonly`, `workspace-write` | [manifest](../apps/workflow-app-sdk-demo/app.json) / [workflow](../apps/workflow-app-sdk-demo/workflow.js) |

## Documentation Map

- [Agent Workflow SDK](agent-sdk.md)
- [CANDIDATE-SCORING(7)](candidate-scoring.7.md)
- [Canonical Workflow Apps](canonical-workflow-apps.7.md)
- [Coordinator / Blackboard](coordinator-blackboard.7.md)
- [Dogfood One Real Repo](dogfood-one-real-repo.7.md)
- [End-to-End Golden Path](end-to-end-golden-path.7.md)
- [ERROR-FEEDBACK(7)](error-feedback.7.md)
- [Getting Started](getting-started.md)
- [Cool Workflow Docs](index.md)
- [MCP App Surface](mcp-app-surface.7.md)
- [Multi-Agent CLI + MCP Surface](multi-agent-cli-mcp-surface.7.md)
- [Multi-Agent Operator UX](multi-agent-operator-ux.7.md)
- [Multi-Agent Runtime Core](multi-agent-runtime-core.7.md)
- [Multi-Agent Topologies](multi-agent-topologies.7.md)
- [Operator UX](operator-ux.7.md)
- [PIPELINE-RUNNER(7)](pipeline-runner.7.md)
- [Cool Workflow Project Index](project-index.md)
- [Release And Migration Discipline](release-and-migration.7.md)
- [Routines](routines.md)
- [SANDBOX-PROFILES(7)](sandbox-profiles.7.md)
- [Scheduled Tasks](scheduled-tasks.md)
- [Security / Trust Hardening](security-trust-hardening.7.md)
- [STATE-NODE(7)](state-node.7.md)
- [Unix-Inspired Workflow Principles](unix-principles.md)
- [VERIFIER-GATED-COMMIT(7)](verifier-gated-commit.7.md)
- [WORKER-ISOLATION(7)](worker-isolation.7.md)
- [Workflow App SDK](workflow-app-sdk.7.md)

## Test Surface

Smoke tests mirror the public contracts. The high-signal suites are:

- [candidate-scoring-smoke.js](../test/candidate-scoring-smoke.js)
- [canonical-workflow-apps-smoke.js](../test/canonical-workflow-apps-smoke.js)
- [coordinator-blackboard-smoke.js](../test/coordinator-blackboard-smoke.js)
- [dogfood-release-smoke.js](../test/dogfood-release-smoke.js)
- [end-to-end-golden-path-smoke.js](../test/end-to-end-golden-path-smoke.js)
- [error-feedback-smoke.js](../test/error-feedback-smoke.js)
- [mcp-app-surface-smoke.js](../test/mcp-app-surface-smoke.js)
- [multi-agent-cli-mcp-surface-smoke.js](../test/multi-agent-cli-mcp-surface-smoke.js)
- [multi-agent-operator-ux-smoke.js](../test/multi-agent-operator-ux-smoke.js)
- [multi-agent-runtime-core-smoke.js](../test/multi-agent-runtime-core-smoke.js)
- [multi-agent-topologies-smoke.js](../test/multi-agent-topologies-smoke.js)
- [operator-ux-smoke.js](../test/operator-ux-smoke.js)
- [pipeline-runner-smoke.js](../test/pipeline-runner-smoke.js)
- [run-fixture-compat-smoke.js](../test/run-fixture-compat-smoke.js)
- [sandbox-profile-smoke.js](../test/sandbox-profile-smoke.js)
- [security-trust-hardening-smoke.js](../test/security-trust-hardening-smoke.js)
- [state-node-smoke.js](../test/state-node-smoke.js)
- [verifier-gated-commit-smoke.js](../test/verifier-gated-commit-smoke.js)
- [worker-isolation-smoke.js](../test/worker-isolation-smoke.js)
- [workflow-app-sdk-smoke.js](../test/workflow-app-sdk-smoke.js)

## Sync Targets

- Repository docs: [docs/project-index.md](project-index.md)
- Obsidian: `/Users/lukebai/Documents/Nick/Cool Workflow/CW Project Index.md`
- GitHub Wiki: `/Users/lukebai/Documents/cool-workflow.wiki/Project-Index.md`

## Maintenance

Run this after changing source modules, workflow app manifests, public docs, or smoke test coverage:

```bash
cd plugins/cool-workflow
npm run sync:project-index
```

Then review the Obsidian page and GitHub Wiki working tree before publishing wiki changes.
