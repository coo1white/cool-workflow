# Cool Workflow Docs

Start with the first run. Use the developer loop when you change code. Read the
advanced pages only when you need those parts.

## First Run

1. [Getting Started](getting-started.md) - clone, install, run `doctor --onramp`, run one workflow, inspect it, and run the right check.
2. [End-to-End Golden Path](end-to-end-golden-path.7.md) - deterministic proof of app, worker, verifier, candidate, commit, and report flow.
3. [Verifiable Report Bundle](report-verifiable-bundle.7.md) - make a portable report bundle and verify it offline.
4. [Trust Model & Limitations](trust-model.md) - what the ed25519 and hash-chain proof does and does not prove.

## Developer Loop

1. [Project Index](project-index.md) - code-derived map of source modules, workflow apps, docs, tests, and sync targets.
2. [Workflow App framework](workflow-app-framework.7.md) - userland app manifests, entrypoints, compatibility, and validation.
3. [Sandbox Profiles](sandbox-profiles.7.md) - named worker policy contracts for read/write/execute/network/env handling.
4. [CLI <-> MCP Parity](cli-mcp-parity.7.md) - the capability registry and fail-closed gate proving the CLI and MCP surfaces render one data source.
5. [Release And Migration](release-and-migration.7.md) - release and migration discipline for durable run state.
6. [Release Tooling](release-tooling.7.md) - version bump, feature scaffold, forward-reference docs, and release gates.
7. [Cool Workflow Release History](release-history.md) - long capability notes moved out of the README.

## Advanced And Multi-Agent

1. [Agent Delegation Drive](agent-delegation-drive.7.md) - the `agent` backend delegates workers to an external process and drives plan -> report.
2. [Run Registry / Control Plane](run-registry-control-plane.7.md) - search, resume, archive, queue, history, and rerun across repos.
3. [Execution Backends](execution-backends.7.md) - node/bun/shell/container/remote/ci drivers, sandbox attestation, and fail-closed delegation.
4. [Multi-Agent Runtime Core](multi-agent-runtime-core.7.md) - MultiAgentRun, roles, groups, memberships, fanout, fanin, and lifecycle state.
5. [Coordinator / Blackboard](coordinator-blackboard.7.md) - topics, messages, context, artifacts, snapshots, decisions, conflicts, and fanin evidence.
6. [Multi-Agent Topologies](multi-agent-topologies.7.md) - map-reduce, debate, and judge-panel recipes.
7. [Multi-Agent CLI + MCP Surface](multi-agent-cli-mcp-surface.7.md) - host loop for run, status, step, blackboard, score, and select.
8. [Multi-Agent Operator UX](multi-agent-operator-ux.7.md) - graph, dependencies, failures, and evidence adoption.
9. [Multi-Agent Trust / Policy / Audit](multi-agent-trust-policy-audit.7.md) - role authority, message provenance, blackboard audit, judge rationale, and policy violations.
10. [Multi-Agent Eval & Replay Harness](multi-agent-eval-replay-harness.7.md) - snapshots, replay, comparison, scoring, gates, reports, and MCP parity.

## Reference

- [Operator UX](operator-ux.7.md) - `status`, `graph`, reports, worker, candidate, feedback, commit, topology, blackboard, coordinator, and trust summaries.
- [MCP App Surface](mcp-app-surface.7.md) - JSON tool parity for agent hosts.
- [Dogfood One Real Repo](dogfood-one-real-repo.7.md) - dry-run release proof against this repository.
- [Web / Desktop Workbench](web-desktop-workbench.7.md) - read-only localhost console over existing run state.
- [Observability + Cost Accounting](observability-cost-accounting.7.md) - derived durations, rates, token usage, and cost.
- [Team Collaboration](team-collaboration.7.md) - append-only approvals, comments, handoffs, and review gates.
- [Real Execution Backend Integrations](real-execution-backends.7.md) - real container/remote/ci execution under the sandbox contract.
- [Node Snapshot / Diff / Replay](node-snapshot-diff-replay.7.md) - per-node snapshots, structural diff, and deterministic replay.
- [Contract Migration Tooling](contract-migration-tooling.7.md) - declared migration registry and compatibility proofs.
- [Control-Plane Scheduling](control-plane-scheduling.7.md) - priority, leases, retry/backoff, and scheduling policy.
- [Run Retention & Provable Reclamation](run-retention-reclamation.7.md) - tiered, hash-chained disk reclamation.
- [Durable State & Locking](durable-state-and-locking.7.md) - atomic writes, fsync durability, and portable file locks.
- [Source Context Profiles](source-context-profiles.7.md) - opt-in JSONL source exports for context slimming.
- [Security / Trust Hardening](security-trust-hardening.7.md) - audit records, provenance, sandbox attestations, and acceptance rationale.
- [State Explosion Management](state-explosion-management.7.md) - summaries, compact graph views, blackboard digests, and stale-aware compaction.
- [Evidence Adoption Reasoning Chain](evidence-adoption-reasoning-chain.7.md) - why evidence was adopted or rejected.

CW is the base system. Workflow apps are userland. Release and migration rules
must keep that line clear: stable contracts, clear compatibility checks, and
state you can look at.
