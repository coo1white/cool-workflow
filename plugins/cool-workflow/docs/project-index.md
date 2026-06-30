# Cool Workflow Project Index

Generated from the current repository code on 2026-06-30 by `npm run sync:project-index`.

## Snapshot

- Package: `cool-workflow`
- Version: `0.1.96`
- Source modules: `68`
- Workflow apps: `8`
- Docs: `59`
- Smoke tests: `164`
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
| [workflow-app-framework.ts](../src/workflow-app-framework.ts) | Validates app manifests and loads app entrypoints. |
| [workflow-api.ts](../src/workflow-api.ts) | Provides the fluent workflow, phase, task, artifact, and input API. |
| [daemon.ts](../src/daemon.ts) | Runs scheduled tasks through the desktop scheduler daemon. |
| [scheduler.ts](../src/scheduler.ts) | Creates, stores, computes, and runs schedules. |
| [triggers.ts](../src/triggers.ts) | Bridges routine triggers to explicit workflow events. |
| [version.ts](../src/version.ts) | Defines current package and state schema versions. |

### Other Source Modules

- [agent-config.ts](../src/agent-config.ts)
- [capability-core.ts](../src/capability-core.ts)
- [capability-registry.ts](../src/capability-registry.ts)
- [clones.ts](../src/clones.ts)
- [collaboration.ts](../src/collaboration.ts)
- [compare.ts](../src/compare.ts)
- [contract-migration.ts](../src/contract-migration.ts)
- [doctor.ts](../src/doctor.ts)
- [drive.ts](../src/drive.ts)
- [evidence-grounding.ts](../src/evidence-grounding.ts)
- [evidence-reasoning.ts](../src/evidence-reasoning.ts)
- [execution-backend.ts](../src/execution-backend.ts)
- [gates.ts](../src/gates.ts)
- [loop-expansion.ts](../src/loop-expansion.ts)
- [mcp-surface.ts](../src/mcp-surface.ts)
- [multi-agent-eval.ts](../src/multi-agent-eval.ts)
- [multi-agent-operator-ux.ts](../src/multi-agent-operator-ux.ts)
- [multi-agent-trust.ts](../src/multi-agent-trust.ts)
- [node-projection.ts](../src/node-projection.ts)
- [node-snapshot.ts](../src/node-snapshot.ts)
- [observability.ts](../src/observability.ts)
- [onramp.ts](../src/onramp.ts)
- [reclamation.ts](../src/reclamation.ts)
- [remote-source.ts](../src/remote-source.ts)
- [reporter.ts](../src/reporter.ts)
- [result-normalize.ts](../src/result-normalize.ts)
- [run-export.ts](../src/run-export.ts)
- [run-registry.ts](../src/run-registry.ts)
- [run-state-schema.ts](../src/run-state-schema.ts)
- [scheduling.ts](../src/scheduling.ts)
- [schema-validate.ts](../src/schema-validate.ts)
- [state-explosion.ts](../src/state-explosion.ts)
- [state-migrations.ts](../src/state-migrations.ts)
- [telemetry-attestation.ts](../src/telemetry-attestation.ts)
- [telemetry-demo.ts](../src/telemetry-demo.ts)
- [telemetry-ledger.ts](../src/telemetry-ledger.ts)
- [term.ts](../src/term.ts)
- [validation.ts](../src/validation.ts)
- [workbench-host.ts](../src/workbench-host.ts)
- [workbench.ts](../src/workbench.ts)

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
- [Trust Model & Limitations](trust-model.md)
- [Unix-Inspired Workflow Principles](unix-principles.md)
- [Vendor Manifest Loadability](vendor-manifest-loadability.7.md)
- [VERIFIER-GATED-COMMIT(7)](verifier-gated-commit.7.md)
- [Web / Desktop Workbench](web-desktop-workbench.7.md)
- [WORKER-ISOLATION(7)](worker-isolation.7.md)
- [Workflow App framework](workflow-app-framework.7.md)

## Test Surface

Smoke tests mirror the public contracts. The high-signal suites are:

- [agent-config-atomic-write-smoke.js](../test/agent-config-atomic-write-smoke.js)
- [agent-delegation-drive-smoke.js](../test/agent-delegation-drive-smoke.js)
- [agent-stream-gate-smoke.js](../test/agent-stream-gate-smoke.js)
- [append-run-node-no-realloc-smoke.js](../test/append-run-node-no-realloc-smoke.js)
- [architecture-review-fast-automation-smoke.js](../test/architecture-review-fast-automation-smoke.js)
- [architecture-review-fast-phase-cache-smoke.js](../test/architecture-review-fast-phase-cache-smoke.js)
- [architecture-review-fast-smoke.js](../test/architecture-review-fast-smoke.js)
- [artifact-integrity-smoke.js](../test/artifact-integrity-smoke.js)
- [audit-verify-smoke.js](../test/audit-verify-smoke.js)
- [backend-registry-smoke.js](../test/backend-registry-smoke.js)
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
- [concurrent-workflow-dsl-smoke.js](../test/concurrent-workflow-dsl-smoke.js)
- [contract-migration-tooling-smoke.js](../test/contract-migration-tooling-smoke.js)
- [control-plane-scheduling-smoke.js](../test/control-plane-scheduling-smoke.js)
- [coordinator-blackboard-smoke.js](../test/coordinator-blackboard-smoke.js)
- [cw-help-per-command-smoke.js](../test/cw-help-per-command-smoke.js)
- [dead-export-removal-guard-smoke.js](../test/dead-export-removal-guard-smoke.js)
- [deepseek-agent-wrapper-smoke.js](../test/deepseek-agent-wrapper-smoke.js)
- [demo-bundle-smoke.js](../test/demo-bundle-smoke.js)
- [det-ids-b-smoke.js](../test/det-ids-b-smoke.js)
- [doctor-smoke.js](../test/doctor-smoke.js)
- [dogfood-architecture-review-smoke.js](../test/dogfood-architecture-review-smoke.js)
- [dogfood-release-smoke.js](../test/dogfood-release-smoke.js)
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
- [loop-bounded-expansion-smoke.js](../test/loop-bounded-expansion-smoke.js)
- [mcp-app-surface-smoke.js](../test/mcp-app-surface-smoke.js)
- [mcp-surface-registry-smoke.js](../test/mcp-surface-registry-smoke.js)
- [mcp-tool-call-coverage-smoke.js](../test/mcp-tool-call-coverage-smoke.js)
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
- [sample-determinism-smoke.js](../test/sample-determinism-smoke.js)
- [sandbox-env-batch-hardening-smoke.js](../test/sandbox-env-batch-hardening-smoke.js)
- [sandbox-profile-smoke.js](../test/sandbox-profile-smoke.js)
- [sched-policy-validation-smoke.js](../test/sched-policy-validation-smoke.js)
- [schedule-routine-daemon-smoke.js](../test/schedule-routine-daemon-smoke.js)
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
