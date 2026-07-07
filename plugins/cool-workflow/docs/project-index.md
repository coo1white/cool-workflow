# Cool Workflow Project Index

Generated from the current repository code on 2026-07-07 by `npm run sync:project-index`.

## Snapshot

- Package: `cool-workflow`
- Version: `0.2.1`
- Source modules: `130`
- Workflow apps: `8`
- Docs: `62`
- Smoke tests: `181`
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
| [shell/orchestrator.ts](../src/shell/orchestrator.ts) | Plans runs, loads workflows, records results, writes reports, and exposes runner commands (a thin facade over the shell functions below). |
| [shell/run-store.ts](../src/shell/run-store.ts) | Persists run checkpoints, JSON state, run paths, and state migration entrypoints. |
| [core/state/state-node.ts](../src/core/state/state-node.ts) | Defines explicit state nodes, pipeline transitions, evidence checks, and node persistence. |
| [core/pipeline/contract.ts](../src/core/pipeline/contract.ts) | Builds the default pipeline contract used by run state. |
| [core/pipeline/runner.ts](../src/core/pipeline/runner.ts) | Finds runnable stages and advances/fails pipeline nodes with retry-aware errors. |
| [core/state/types.ts](../src/core/state/types.ts) | Owns the shared run/state types: WorkflowRun and everything it carries, StateNode, and the pipeline contract shape. |

### Verification and state gates

| Module | Responsibility |
| --- | --- |
| [shell/verifier.ts](../src/shell/verifier.ts) | Validates result envelopes, findings, evidence, and run gate completion. |
| [shell/commit.ts](../src/shell/commit.ts) | Creates verifier-gated commits and explicit manual checkpoints. |
| [core/multi-agent/candidate-scoring.ts](../src/core/multi-agent/candidate-scoring.ts) | Registers, scores, ranks, selects, rejects, and summarizes candidate outputs. |
| [core/pipeline/error-feedback.ts](../src/core/pipeline/error-feedback.ts) | Turns failures into persisted feedback records and correction tasks. |
| [shell/trust-audit.ts](../src/shell/trust-audit.ts) | Records provenance, sandbox decisions, host attestations, and acceptance rationale. |

### Workers and policy

| Module | Responsibility |
| --- | --- |
| [shell/dispatch.ts](../src/shell/dispatch.ts) | Selects runnable tasks and writes dispatch manifests. |
| [shell/worker-isolation.ts](../src/shell/worker-isolation.ts) | Allocates worker scopes, writes manifests, records worker outputs, and validates boundaries. |
| [shell/sandbox-profile.ts](../src/shell/sandbox-profile.ts) | Resolves named sandbox policy contracts and validates read/write/command/network boundaries. |
| [shell/harness.ts](../src/shell/harness.ts) | Renders task files for dispatched work. |

### Multi-agent layer

| Module | Responsibility |
| --- | --- |
| [core/multi-agent/runtime.ts](../src/core/multi-agent/runtime.ts) | Persists multi-agent runs, roles, groups, memberships, fanouts, and fanins. |
| [core/multi-agent/coordinator.ts](../src/core/multi-agent/coordinator.ts) | Owns blackboard topics, messages, context, artifacts, snapshots, and coordinator decisions. |
| [core/multi-agent/topology.ts](../src/core/multi-agent/topology.ts) | Defines and applies official map-reduce, debate, and judge-panel topologies. |
| [shell/multi-agent-host.ts](../src/shell/multi-agent-host.ts) | Provides the preferred host loop for run, status, step, blackboard, score, and select. |

### User and host surfaces

| Module | Responsibility |
| --- | --- |
| [cli.ts](../src/cli.ts) | Routes human CLI commands to runtime, app, topology, multi-agent, and operator flows. |
| [mcp-server.ts](../src/mcp-server.ts) | Exposes JSON-RPC/MCP tool parity for agent hosts. |
| [shell/operator-ux.ts](../src/shell/operator-ux.ts) | Formats status, reports, graph, worker, candidate, feedback, commit, and trust summaries. |
| [shell/workflow-app-loader.ts](../src/shell/workflow-app-loader.ts) | Validates app manifests and loads app entrypoints. |
| [core/workflow-apps/app-schema.ts](../src/core/workflow-apps/app-schema.ts) | Provides the fluent workflow, phase, task, artifact, and input API. |
| [shell/scheduler-io.ts](../src/shell/scheduler-io.ts) | Runs wall-clock schedules, the desktop scheduler daemon tick, and routine triggers. |
| [core/version.ts](../src/core/version.ts) | Defines current package and state schema versions. |

### Other Source Modules

- [cli/dispatch.ts](../src/cli/dispatch.ts)
- [cli/entry.ts](../src/cli/entry.ts)
- [cli/io.ts](../src/cli/io.ts)
- [cli/parseargv.ts](../src/cli/parseargv.ts)
- [core/capability-table.ts](../src/core/capability-table.ts)
- [core/format/help.ts](../src/core/format/help.ts)
- [core/format/state-explosion-text.ts](../src/core/format/state-explosion-text.ts)
- [core/hash.ts](../src/core/hash.ts)
- [core/multi-agent/collaboration.ts](../src/core/multi-agent/collaboration.ts)
- [core/multi-agent/eval-replay.ts](../src/core/multi-agent/eval-replay.ts)
- [core/multi-agent/trust-policy.ts](../src/core/multi-agent/trust-policy.ts)
- [core/pipeline/commit-gate.ts](../src/core/pipeline/commit-gate.ts)
- [core/pipeline/dispatch.ts](../src/core/pipeline/dispatch.ts)
- [core/pipeline/drive-decide.ts](../src/core/pipeline/drive-decide.ts)
- [core/pipeline/loop-expansion.ts](../src/core/pipeline/loop-expansion.ts)
- [core/pipeline/result-normalize.ts](../src/core/pipeline/result-normalize.ts)
- [core/state/contract-migration.ts](../src/core/state/contract-migration.ts)
- [core/state/migrations.ts](../src/core/state/migrations.ts)
- [core/state/node-projection.ts](../src/core/state/node-projection.ts)
- [core/state/node-snapshot.ts](../src/core/state/node-snapshot.ts)
- [core/state/run-paths.ts](../src/core/state/run-paths.ts)
- [core/state/schema-validate.ts](../src/core/state/schema-validate.ts)
- [core/state/schema.ts](../src/core/state/schema.ts)
- [core/state/state-explosion/digest.ts](../src/core/state/state-explosion/digest.ts)
- [core/state/state-explosion/graph.ts](../src/core/state/state-explosion/graph.ts)
- [core/state/state-explosion/helpers.ts](../src/core/state/state-explosion/helpers.ts)
- [core/state/state-explosion/report.ts](../src/core/state/state-explosion/report.ts)
- [core/state/state-explosion/size.ts](../src/core/state/state-explosion/size.ts)
- [core/state/validation.ts](../src/core/state/validation.ts)
- [core/trust/evidence-grounding.ts](../src/core/trust/evidence-grounding.ts)
- [core/trust/ledger.ts](../src/core/trust/ledger.ts)
- [core/trust/telemetry-attestation.ts](../src/core/trust/telemetry-attestation.ts)
- [core/trust/telemetry-ledger.ts](../src/core/trust/telemetry-ledger.ts)
- [core/types.ts](../src/core/types.ts)
- [core/types/boundary.ts](../src/core/types/boundary.ts)
- [core/util/collate.ts](../src/core/util/collate.ts)
- [mcp/dispatch.ts](../src/mcp/dispatch.ts)
- [mcp/server.ts](../src/mcp/server.ts)
- [shell/agent-config.ts](../src/shell/agent-config.ts)
- [shell/app-run-cli.ts](../src/shell/app-run-cli.ts)
- [shell/audit-cli.ts](../src/shell/audit-cli.ts)
- [shell/audit-provenance.ts](../src/shell/audit-provenance.ts)
- [shell/candidate-scoring-io.ts](../src/shell/candidate-scoring-io.ts)
- [shell/collaboration-io.ts](../src/shell/collaboration-io.ts)
- [shell/commit-summary.ts](../src/shell/commit-summary.ts)
- [shell/coordinator-io.ts](../src/shell/coordinator-io.ts)
- [shell/demo-cli.ts](../src/shell/demo-cli.ts)
- [shell/doctor.ts](../src/shell/doctor.ts)
- [shell/drive.ts](../src/shell/drive.ts)
- [shell/error-feedback-io.ts](../src/shell/error-feedback-io.ts)
- [shell/eval-io.ts](../src/shell/eval-io.ts)
- [shell/eval-text.ts](../src/shell/eval-text.ts)
- [shell/evidence-reasoning.ts](../src/shell/evidence-reasoning.ts)
- [shell/exec-backend-cli.ts](../src/shell/exec-backend-cli.ts)
- [shell/execution-backend/agent.ts](../src/shell/execution-backend/agent.ts)
- [shell/execution-backend/ci.ts](../src/shell/execution-backend/ci.ts)
- [shell/execution-backend/container.ts](../src/shell/execution-backend/container.ts)
- [shell/execution-backend/envelopes.ts](../src/shell/execution-backend/envelopes.ts)
- [shell/execution-backend/local.ts](../src/shell/execution-backend/local.ts)
- [shell/execution-backend/probes.ts](../src/shell/execution-backend/probes.ts)
- [shell/execution-backend/registry.ts](../src/shell/execution-backend/registry.ts)
- [shell/execution-backend/remote.ts](../src/shell/execution-backend/remote.ts)
- [shell/execution-backend/types.ts](../src/shell/execution-backend/types.ts)
- [shell/feedback-cli.ts](../src/shell/feedback-cli.ts)
- [shell/feedback-operations.ts](../src/shell/feedback-operations.ts)
- [shell/fs-atomic.ts](../src/shell/fs-atomic.ts)
- [shell/ledger-cli.ts](../src/shell/ledger-cli.ts)
- [shell/ledger-io.ts](../src/shell/ledger-io.ts)
- [shell/man-cli.ts](../src/shell/man-cli.ts)
- [shell/metrics-cli.ts](../src/shell/metrics-cli.ts)
- [shell/multi-agent-cli.ts](../src/shell/multi-agent-cli.ts)
- [shell/multi-agent-io.ts](../src/shell/multi-agent-io.ts)
- [shell/multi-agent-operator-ux.ts](../src/shell/multi-agent-operator-ux.ts)
- [shell/node-store.ts](../src/shell/node-store.ts)
- [shell/observability-format.ts](../src/shell/observability-format.ts)
- [shell/observability-intake.ts](../src/shell/observability-intake.ts)
- [shell/observability.ts](../src/shell/observability.ts)
- [shell/onramp.ts](../src/shell/onramp.ts)
- [shell/operator-ux-text.ts](../src/shell/operator-ux-text.ts)
- [shell/pipeline-cli.ts](../src/shell/pipeline-cli.ts)
- [shell/pipeline.ts](../src/shell/pipeline.ts)
- [shell/reclamation-io.ts](../src/shell/reclamation-io.ts)
- [shell/registry-cli.ts](../src/shell/registry-cli.ts)
- [shell/remote-source.ts](../src/shell/remote-source.ts)
- [shell/report-cli.ts](../src/shell/report-cli.ts)
- [shell/report-view-cli.ts](../src/shell/report-view-cli.ts)
- [shell/report.ts](../src/shell/report.ts)
- [shell/reporter.ts](../src/shell/reporter.ts)
- [shell/run-export-cli.ts](../src/shell/run-export-cli.ts)
- [shell/run-export.ts](../src/shell/run-export.ts)
- [shell/run-registry-io.ts](../src/shell/run-registry-io.ts)
- [shell/scheduling-io.ts](../src/shell/scheduling-io.ts)
- [shell/state-cli.ts](../src/shell/state-cli.ts)
- [shell/state-explosion-cli.ts](../src/shell/state-explosion-cli.ts)
- [shell/telemetry-cli.ts](../src/shell/telemetry-cli.ts)
- [shell/telemetry-demo.ts](../src/shell/telemetry-demo.ts)
- [shell/telemetry-ledger-io.ts](../src/shell/telemetry-ledger-io.ts)
- [shell/term.ts](../src/shell/term.ts)
- [shell/topology-io.ts](../src/shell/topology-io.ts)
- [shell/trust-policy-io.ts](../src/shell/trust-policy-io.ts)
- [shell/workbench-host.ts](../src/shell/workbench-host.ts)
- [shell/workbench-text.ts](../src/shell/workbench-text.ts)
- [shell/workbench.ts](../src/shell/workbench.ts)
- [shell/worker-cli.ts](../src/shell/worker-cli.ts)

## Workflow Apps

| App | Type | Inputs | Sandbox | Source |
| --- | --- | --- | --- | --- |
| `architecture-review` - Map a repository architecture, assess risks, verify important findings, and synthesize an evidence-backed verdict. | canonical | `repo`, `question`, `invariant`, `focus` | `readonly` | [manifest](../apps/architecture-review/app.json) / [workflow](../apps/architecture-review/workflow.js) |
| `architecture-review-fast` - Run a shorter architecture review with parallel map and assess phases for faster first results. | canonical | `repo`, `question`, `invariant`, `focus`, `sourceContext`, `sourceContextDigest` | `readonly` | [manifest](../apps/architecture-review-fast/app.json) / [workflow](../apps/architecture-review-fast/workflow.js) |
| `end-to-end-golden-path` - Deterministic one-worker workflow app for proving the CW integration chain. | userland | `question` | `readonly` | [manifest](../apps/end-to-end-golden-path/app.json) / [workflow](../apps/end-to-end-golden-path/workflow.js) |
| `pdca-blackboard-loop` - Three agents use one blackboard to plan, build, check, and choose the next step. | example | `goal`, `repo`, `acceptance` | `readonly`, `workspace-write` | [manifest](../apps/pdca-blackboard-loop/app.json) / [workflow](../apps/pdca-blackboard-loop/workflow.js) |
| `pr-review-fix-ci` - Review a pull request or branch, inspect CI failures, diagnose actionable issues, optionally patch, verify, and summarize with evidence. | canonical | `repo`, `pr`, `branch`, `base`, `ci`, `mode` | `readonly`, `workspace-write` | [manifest](../apps/pr-review-fix-ci/app.json) / [workflow](../apps/pr-review-fix-ci/workflow.js) |
| `release-cut` - Prepare a release with checklist discipline: version checks, changelog, tests, packaging, release notes, and final verification. | canonical | `repo`, `version`, `previousVersion`, `releaseBranch`, `dryRun` | `readonly`, `workspace-write` | [manifest](../apps/release-cut/app.json) / [workflow](../apps/release-cut/workflow.js) |
| `research-synthesis` - Split a research question into claims, investigate sources, cross-check evidence, verify claims, and synthesize a concise answer. | canonical | `question`, `source`, `scope`, `freshness` | `readonly`, `locked-down` | [manifest](../apps/research-synthesis/app.json) / [workflow](../apps/research-synthesis/workflow.js) |
| `workflow-app-framework-demo` - Small framework app showing inputs, phases, evidence gates, and sandbox profile hints. | example | `question` | `readonly`, `workspace-write` | [manifest](../apps/workflow-app-framework-demo/app.json) / [workflow](../apps/workflow-app-framework-demo/workflow.js) |

## Documentation Map

- [Agent Delegation Drive](agent-delegation-drive.7.md)
- [Workflow App framework](agent-framework.md)
- [CANDIDATE-SCORING(7)](candidate-scoring.7.md)
- [Canonical Workflow Apps](canonical-workflow-apps.7.md)
- [CAPABILITY-TOPOLOGY-REGISTRY(7) — Cool Workflow Agent-Driven Self-Evolution](capability-topology-registry.7.md)
- [CLI ↔ MCP Parity](cli-mcp-parity.7.md)
- [Contract Migration Tooling](contract-migration-tooling.7.md)
- [Control-Plane Scheduling](control-plane-scheduling.7.md)
- [Coordinator / Blackboard](coordinator-blackboard.7.md)
- [Cross-Agent Handoff Ledger](cross-agent-ledger.7.md)
- [DEMO(7)](demo.7.md)
- [DOCTOR(7)](doctor.7.md)
- [Dogfood One Real Repo](dogfood-one-real-repo.7.md)
- [Durable State & Locking](durable-state-and-locking.7.md)
- [End-to-End Golden Path](end-to-end-golden-path.7.md)
- [ERROR-FEEDBACK(7)](error-feedback.7.md)
- [Evidence Adoption Reasoning Chain](evidence-adoption-reasoning-chain.7.md)
- [EXECUTION-BACKENDS(7)](execution-backends.7.md)
- [FIX(7)](fix.7.md)
- [Getting Started](getting-started.md)
- [Handoff ledger — shared-repo setup (T2a)](handoff-setup.md)
- [Cool Workflow Docs](index.md)
- [INIT(7)](init.7.md)
- [MCP App Surface](mcp-app-surface.7.md)
- [Multi-Agent CLI + MCP Surface](multi-agent-cli-mcp-surface.7.md)
- [Multi-Agent Eval & Replay Harness](multi-agent-eval-replay-harness.7.md)
- [Multi-Agent Operator UX](multi-agent-operator-ux.7.md)
- [Multi-Agent Runtime Core](multi-agent-runtime-core.7.md)
- [Multi-Agent Topologies](multi-agent-topologies.7.md)
- [Multi-Agent Trust / Policy / Audit](multi-agent-trust-policy-audit.7.md)
- [Node Snapshot / Diff / Replay](node-snapshot-diff-replay.7.md)
- [Observability + Cost Accounting](observability-cost-accounting.7.md)
- [Operator UX](operator-ux.7.md)
- [PIPELINE-RUNNER(7)](pipeline-runner.7.md)
- [PIPELINE-VERBS(7)](pipeline-verbs.7.md)
- [Cool Workflow Project Index](project-index.md)
- [Cool Workflow](readme-v0.1.87-full.md)
- [Real Execution Backend Integrations](real-execution-backends.7.md)
- [Release And Migration Discipline](release-and-migration.7.md)
- [Cool Workflow Release History](release-history.md)
- [Release Tooling](release-tooling.7.md)
- [Remote-Source Review (`--link`)](remote-source-review.7.md)
- [Verifiable Report Bundle](report-verifiable-bundle.7.md)
- [ROUTINE(7)](routine.7.md)
- [Routines](routines.md)
- [Run Registry / Control Plane](run-registry-control-plane.7.md)
- [Run Retention & Provable Reclamation](run-retention-reclamation.7.md)
- [SANDBOX-PROFILES(7)](sandbox-profiles.7.md)
- [Scheduled Tasks](scheduled-tasks.md)
- [Security / Trust Hardening](security-trust-hardening.7.md)
- [Source Context Profiles](source-context-profiles.7.md)
- [State Explosion Management](state-explosion-management.7.md)
- [STATE-NODE(7)](state-node.7.md)
- [Team Collaboration](team-collaboration.7.md)
- [Trust Audit Anchor](trust-audit-anchor.7.md)
- [Trust Model & Limitations](trust-model.md)
- [Unix-Inspired Workflow Principles](unix-principles.md)
- [Vendor Manifest Loadability](vendor-manifest-loadability.7.md)
- [VERIFIER-GATED-COMMIT(7)](verifier-gated-commit.7.md)
- [Web / Desktop Workbench](web-desktop-workbench.7.md)
- [WORKER-ISOLATION(7)](worker-isolation.7.md)
- [Workflow App framework](workflow-app-framework.7.md)

## Test Surface

Smoke tests mirror the public contracts. The high-signal suites are:

- [agent-backend-concurrent-user-env-smoke.js](../test/agent-backend-concurrent-user-env-smoke.js)
- [agent-backend-user-env-smoke.js](../test/agent-backend-user-env-smoke.js)
- [agent-config-atomic-write-smoke.js](../test/agent-config-atomic-write-smoke.js)
- [agent-delegation-drive-smoke.js](../test/agent-delegation-drive-smoke.js)
- [agent-stream-gate-smoke.js](../test/agent-stream-gate-smoke.js)
- [append-run-node-no-realloc-smoke.js](../test/append-run-node-no-realloc-smoke.js)
- [architecture-review-fast-automation-smoke.js](../test/architecture-review-fast-automation-smoke.js)
- [architecture-review-fast-phase-cache-smoke.js](../test/architecture-review-fast-phase-cache-smoke.js)
- [architecture-review-fast-smoke.js](../test/architecture-review-fast-smoke.js)
- [architecture-review-question-aware-smoke.js](../test/architecture-review-question-aware-smoke.js)
- [artifact-integrity-smoke.js](../test/artifact-integrity-smoke.js)
- [audit-verify-smoke.js](../test/audit-verify-smoke.js)
- [backend-registry-smoke.js](../test/backend-registry-smoke.js)
- [batch-output-overflow-smoke.js](../test/batch-output-overflow-smoke.js)
- [blackboard-state-explosion-management-smoke.js](../test/blackboard-state-explosion-management-smoke.js)
- [block-unapproved-tag-smoke.js](../test/block-unapproved-tag-smoke.js)
- [budget-scaling-loop-smoke.js](../test/budget-scaling-loop-smoke.js)
- [bump-version-idempotent-smoke.js](../test/bump-version-idempotent-smoke.js)
- [candidate-scoring-smoke.js](../test/candidate-scoring-smoke.js)
- [canonical-workflow-apps-smoke.js](../test/canonical-workflow-apps-smoke.js)
- [claude-p-agent-wrapper-smoke.js](../test/claude-p-agent-wrapper-smoke.js)
- [cli-arg-parsing-smoke.js](../test/cli-arg-parsing-smoke.js)
- [cli-command-surface-smoke.js](../test/cli-command-surface-smoke.js)
- [cli-format-smoke.js](../test/cli-format-smoke.js)
- [cli-handler-clones-smoke.js](../test/cli-handler-clones-smoke.js)
- [cli-handler-eval-node-smoke.js](../test/cli-handler-eval-node-smoke.js)
- [cli-handler-maintenance-smoke.js](../test/cli-handler-maintenance-smoke.js)
- [cli-handler-workbench-smoke.js](../test/cli-handler-workbench-smoke.js)
- [cli-io-smoke.js](../test/cli-io-smoke.js)
- [cli-jsonmode-parity-smoke.js](../test/cli-jsonmode-parity-smoke.js)
- [cli-mcp-parity-smoke.js](../test/cli-mcp-parity-smoke.js)
- [cli-progress-summary-smoke.js](../test/cli-progress-summary-smoke.js)
- [cli-recoverable-errors-smoke.js](../test/cli-recoverable-errors-smoke.js)
- [cli-render-smoke.js](../test/cli-render-smoke.js)
- [clones-gc-smoke.js](../test/clones-gc-smoke.js)
- [codex-agent-wrapper-smoke.js](../test/codex-agent-wrapper-smoke.js)
- [collaboration-ops-unit-smoke.js](../test/collaboration-ops-unit-smoke.js)
- [concurrency-default-smoke.js](../test/concurrency-default-smoke.js)
- [concurrent-failure-semantics-smoke.js](../test/concurrent-failure-semantics-smoke.js)
- [concurrent-subworkflow-cache-nesting-smoke.js](../test/concurrent-subworkflow-cache-nesting-smoke.js)
- [concurrent-workflow-dsl-smoke.js](../test/concurrent-workflow-dsl-smoke.js)
- [contract-migration-tooling-smoke.js](../test/contract-migration-tooling-smoke.js)
- [control-plane-scheduling-smoke.js](../test/control-plane-scheduling-smoke.js)
- [coordinator-blackboard-smoke.js](../test/coordinator-blackboard-smoke.js)
- [cw-help-per-command-smoke.js](../test/cw-help-per-command-smoke.js)
- [dead-export-removal-guard-smoke.js](../test/dead-export-removal-guard-smoke.js)
- [deepseek-agent-wrapper-smoke.js](../test/deepseek-agent-wrapper-smoke.js)
- [deferred-checkpoint-batching-smoke.js](../test/deferred-checkpoint-batching-smoke.js)
- [demo-bundle-smoke.js](../test/demo-bundle-smoke.js)
- [det-ids-b-smoke.js](../test/det-ids-b-smoke.js)
- [dispatch-legacy-burndown-smoke.js](../test/dispatch-legacy-burndown-smoke.js)
- [doctor-smoke.js](../test/doctor-smoke.js)
- [dogfood-architecture-review-smoke.js](../test/dogfood-architecture-review-smoke.js)
- [dogfood-release-smoke.js](../test/dogfood-release-smoke.js)
- [drive-concurrency-flag-smoke.js](../test/drive-concurrency-flag-smoke.js)
- [drive-exhaustion-blocked-smoke.js](../test/drive-exhaustion-blocked-smoke.js)
- [durable-atomic-write-smoke.js](../test/durable-atomic-write-smoke.js)
- [end-to-end-demo-smoke.js](../test/end-to-end-demo-smoke.js)
- [end-to-end-golden-path-smoke.js](../test/end-to-end-golden-path-smoke.js)
- [error-feedback-resolution-smoke.js](../test/error-feedback-resolution-smoke.js)
- [error-feedback-smoke.js](../test/error-feedback-smoke.js)
- [evidence-adoption-reasoning-smoke.js](../test/evidence-adoption-reasoning-smoke.js)
- [evidence-content-extraction-smoke.js](../test/evidence-content-extraction-smoke.js)
- [execution-backend-agent-smoke.js](../test/execution-backend-agent-smoke.js)
- [execution-backend-ci-smoke.js](../test/execution-backend-ci-smoke.js)
- [execution-backends-smoke.js](../test/execution-backends-smoke.js)
- [feedback-ops-unit-smoke.js](../test/feedback-ops-unit-smoke.js)
- [freebsd-audit-fixes-smoke.js](../test/freebsd-audit-fixes-smoke.js)
- [gemini-agent-wrapper-smoke.js](../test/gemini-agent-wrapper-smoke.js)
- [gemini-opencode-agent-wrapper-smoke.js](../test/gemini-opencode-agent-wrapper-smoke.js)
- [h7-custom-profile-persist-smoke.js](../test/h7-custom-profile-persist-smoke.js)
- [headline-commands-smoke.js](../test/headline-commands-smoke.js)
- [incremental-resume-smoke.js](../test/incremental-resume-smoke.js)
- [ledger-apply-smoke.js](../test/ledger-apply-smoke.js)
- [ledger-resolution-smoke.js](../test/ledger-resolution-smoke.js)
- [ledger-verify-smoke.js](../test/ledger-verify-smoke.js)
- [loop-bounded-expansion-smoke.js](../test/loop-bounded-expansion-smoke.js)
- [mcp-app-surface-smoke.js](../test/mcp-app-surface-smoke.js)
- [mcp-surface-registry-smoke.js](../test/mcp-surface-registry-smoke.js)
- [mcp-tool-call-coverage-smoke.js](../test/mcp-tool-call-coverage-smoke.js)
- [metrics-summary-limit-smoke.js](../test/metrics-summary-limit-smoke.js)
- [multi-agent-cli-mcp-surface-smoke.js](../test/multi-agent-cli-mcp-surface-smoke.js)
- [multi-agent-eval-determinism-regression-smoke.js](../test/multi-agent-eval-determinism-regression-smoke.js)
- [multi-agent-eval-replay-harness-smoke.js](../test/multi-agent-eval-replay-harness-smoke.js)
- [multi-agent-eval-replay-smoke.js](../test/multi-agent-eval-replay-smoke.js)
- [multi-agent-operator-ux-smoke.js](../test/multi-agent-operator-ux-smoke.js)
- [multi-agent-runtime-core-smoke.js](../test/multi-agent-runtime-core-smoke.js)
- [multi-agent-topologies-debate-smoke.js](../test/multi-agent-topologies-debate-smoke.js)
- [multi-agent-topologies-judge-panel-smoke.js](../test/multi-agent-topologies-judge-panel-smoke.js)
- [multi-agent-topologies-map-reduce-smoke.js](../test/multi-agent-topologies-map-reduce-smoke.js)
- [multi-agent-trust-policy-audit-smoke.js](../test/multi-agent-trust-policy-audit-smoke.js)
- [no-false-green-smoke.js](../test/no-false-green-smoke.js)
- [node-snapshot-diff-replay-smoke.js](../test/node-snapshot-diff-replay-smoke.js)
- [npm-global-install-smoke.js](../test/npm-global-install-smoke.js)
- [npm-trusted-publish-smoke.js](../test/npm-trusted-publish-smoke.js)
- [observability-cost-accounting-smoke.js](../test/observability-cost-accounting-smoke.js)
- [one-way-boundary-smoke.js](../test/one-way-boundary-smoke.js)
- [onramp-check-smoke.js](../test/onramp-check-smoke.js)
- [opencode-agent-wrapper-smoke.js](../test/opencode-agent-wrapper-smoke.js)
- [operator-ux-smoke.js](../test/operator-ux-smoke.js)
- [orphan-runs-gc-smoke.js](../test/orphan-runs-gc-smoke.js)
- [parallel-onramp-smoke.js](../test/parallel-onramp-smoke.js)
- [parity-doc-sync-smoke.js](../test/parity-doc-sync-smoke.js)
- [parse-guard-smoke.js](../test/parse-guard-smoke.js)
- [parse-hardening-round2-smoke.js](../test/parse-hardening-round2-smoke.js)
- [path-containment-smoke.js](../test/path-containment-smoke.js)
- [pdca-blackboard-loop-smoke.js](../test/pdca-blackboard-loop-smoke.js)
- [pii-redaction-smoke.js](../test/pii-redaction-smoke.js)
- [pipeline-auto-advance-smoke.js](../test/pipeline-auto-advance-smoke.js)
- [pipeline-runner-smoke.js](../test/pipeline-runner-smoke.js)
- [project-index-sync-smoke.js](../test/project-index-sync-smoke.js)
- [quickstart-bundle-smoke.js](../test/quickstart-bundle-smoke.js)
- [quickstart-check-smoke.js](../test/quickstart-check-smoke.js)
- [quickstart-corpus-smoke.js](../test/quickstart-corpus-smoke.js)
- [quickstart-no-agent-smoke.js](../test/quickstart-no-agent-smoke.js)
- [quickstart-readme-path-smoke.js](../test/quickstart-readme-path-smoke.js)
- [quickstart-smoke.js](../test/quickstart-smoke.js)
- [readme-sync-smoke.js](../test/readme-sync-smoke.js)
- [readme-trust-claim-smoke.js](../test/readme-trust-claim-smoke.js)
- [real-execution-backends-smoke.js](../test/real-execution-backends-smoke.js)
- [registry-corrupt-fail-closed-smoke.js](../test/registry-corrupt-fail-closed-smoke.js)
- [release-check-skip-smoke.js](../test/release-check-skip-smoke.js)
- [release-flow-smoke.js](../test/release-flow-smoke.js)
- [release-gate-smoke.js](../test/release-gate-smoke.js)
- [release-pipeline-hygiene-smoke.js](../test/release-pipeline-hygiene-smoke.js)
- [release-tooling-smoke.js](../test/release-tooling-smoke.js)
- [remote-link-archive-smoke.js](../test/remote-link-archive-smoke.js)
- [remote-link-git-smoke.js](../test/remote-link-git-smoke.js)
- [report-bundle-smoke.js](../test/report-bundle-smoke.js)
- [report-verify-bundle-smoke.js](../test/report-verify-bundle-smoke.js)
- [result-normalize-smoke.js](../test/result-normalize-smoke.js)
- [robustness-failclosed-smoke.js](../test/robustness-failclosed-smoke.js)
- [robustness-hardening-smoke.js](../test/robustness-hardening-smoke.js)
- [run-all-agent-env-hermetic-smoke.js](../test/run-all-agent-env-hermetic-smoke.js)
- [run-all-json-summary-smoke.js](../test/run-all-json-summary-smoke.js)
- [run-export-cross-machine-smoke.js](../test/run-export-cross-machine-smoke.js)
- [run-export-import-smoke.js](../test/run-export-import-smoke.js)
- [run-export-restore-rerun-smoke.js](../test/run-export-restore-rerun-smoke.js)
- [run-export-restore-resume-smoke.js](../test/run-export-restore-resume-smoke.js)
- [run-fixture-compat-smoke.js](../test/run-fixture-compat-smoke.js)
- [run-import-path-traversal-smoke.js](../test/run-import-path-traversal-smoke.js)
- [run-import-tamper-failclosed-smoke.js](../test/run-import-tamper-failclosed-smoke.js)
- [run-inspect-archive-smoke.js](../test/run-inspect-archive-smoke.js)
- [run-registry-control-plane-smoke.js](../test/run-registry-control-plane-smoke.js)
- [run-restore-failclosed-smoke.js](../test/run-restore-failclosed-smoke.js)
- [run-resume-drive-smoke.js](../test/run-resume-drive-smoke.js)
- [run-retention-reclamation-smoke.js](../test/run-retention-reclamation-smoke.js)
- [run-state-lock-concurrency-smoke.js](../test/run-state-lock-concurrency-smoke.js)
- [sample-determinism-smoke.js](../test/sample-determinism-smoke.js)
- [sandbox-env-batch-hardening-smoke.js](../test/sandbox-env-batch-hardening-smoke.js)
- [sandbox-profile-smoke.js](../test/sandbox-profile-smoke.js)
- [sched-policy-validation-smoke.js](../test/sched-policy-validation-smoke.js)
- [schedule-routine-daemon-smoke.js](../test/schedule-routine-daemon-smoke.js)
- [scheduling-routine-lock-concurrency-smoke.js](../test/scheduling-routine-lock-concurrency-smoke.js)
- [schema-validation-smoke.js](../test/schema-validation-smoke.js)
- [security-trust-hardening-smoke.js](../test/security-trust-hardening-smoke.js)
- [self-audit-hardening-smoke.js](../test/self-audit-hardening-smoke.js)
- [source-context-batch-smoke.js](../test/source-context-batch-smoke.js)
- [source-context-profile-smoke.js](../test/source-context-profile-smoke.js)
- [state-node-smoke.js](../test/state-node-smoke.js)
- [sub-workflow-nesting-smoke.js](../test/sub-workflow-nesting-smoke.js)
- [surface-explicit-cwd-smoke.js](../test/surface-explicit-cwd-smoke.js)
- [tamper-evidence-demo-smoke.js](../test/tamper-evidence-demo-smoke.js)
- [team-collaboration-smoke.js](../test/team-collaboration-smoke.js)
- [telemetry-attest-wrap-smoke.js](../test/telemetry-attest-wrap-smoke.js)
- [telemetry-attestation-smoke.js](../test/telemetry-attestation-smoke.js)
- [telemetry-fail-closed-smoke.js](../test/telemetry-fail-closed-smoke.js)
- [telemetry-ledger-smoke.js](../test/telemetry-ledger-smoke.js)
- [telemetry-metrics-coverage-smoke.js](../test/telemetry-metrics-coverage-smoke.js)
- [telemetry-verify-signatures-smoke.js](../test/telemetry-verify-signatures-smoke.js)
- [token-budget-enforcement-smoke.js](../test/token-budget-enforcement-smoke.js)
- [trust-audit-anchor-smoke.js](../test/trust-audit-anchor-smoke.js)
- [vendor-manifest-load-smoke.js](../test/vendor-manifest-load-smoke.js)
- [vendor-preflight-smoke.js](../test/vendor-preflight-smoke.js)
- [verifier-gated-commit-smoke.js](../test/verifier-gated-commit-smoke.js)
- [verify-import-audit-chain-smoke.js](../test/verify-import-audit-chain-smoke.js)
- [web-desktop-workbench-smoke.js](../test/web-desktop-workbench-smoke.js)
- [worker-accept-path-architecture-smoke.js](../test/worker-accept-path-architecture-smoke.js)
- [worker-isolation-smoke.js](../test/worker-isolation-smoke.js)
- [worker-retry-count-smoke.js](../test/worker-retry-count-smoke.js)
- [workflow-app-framework-smoke.js](../test/workflow-app-framework-smoke.js)

## Sync Targets

- Repository docs: [docs/project-index.md](project-index.md)
- Obsidian vault (optional): set `CW_OBSIDIAN_VAULT` to your local vault path.
- GitHub Wiki: the `cool-workflow.wiki` working tree (override with `CW_GITHUB_WIKI_DIR`).

## Maintenance

Run this after changing source modules, workflow app manifests, public docs, or smoke test coverage:

```bash
cd plugins/cool-workflow
npm run sync:project-index
```

Then review the Obsidian page and GitHub Wiki working tree before publishing wiki changes.
