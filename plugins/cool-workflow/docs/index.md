# Cool Workflow Docs

Read these in order when you are new to CW:

1. [Getting Started](getting-started.md) - clone, install, run a workflow, inspect it, and run the release check.
2. [Project Index](project-index.md) - code-derived map of source modules, workflow apps, docs, tests, and sync targets.
3. [Workflow App SDK](workflow-app-sdk.7.md) - userland app manifests, entrypoints, compatibility, and validation.
4. [Sandbox Profiles](sandbox-profiles.7.md) - named worker policy contracts for read/write/execute/network/env handling.
5. [Security / Trust Hardening](security-trust-hardening.7.md) - audit records, provenance, sandbox attestations, and acceptance rationale.
6. [Multi-Agent Runtime Core](multi-agent-runtime-core.7.md) - first-class MultiAgentRun, roles, groups, memberships, fanout, fanin, and lifecycle state.
7. [Coordinator / Blackboard](coordinator-blackboard.7.md) - shared topics, messages, context frames, artifact refs, snapshots, decisions, conflicts, and fanin evidence.
8. [Multi-Agent Topologies](multi-agent-topologies.7.md) - official map-reduce, debate, and judge-panel recipes built on multi-agent and blackboard records.
9. [Multi-Agent CLI + MCP Surface](multi-agent-cli-mcp-surface.7.md) - preferred host loop for run, status, step, blackboard, score, and select.
10. [Multi-Agent Operator UX](multi-agent-operator-ux.7.md) - graph, dependencies, failures, and evidence adoption for topology-backed multi-agent runs.
11. [Multi-Agent Trust / Policy / Audit](multi-agent-trust-policy-audit.7.md) - role authority, message provenance, blackboard write audit, judge rationale, and policy violations.
12. [Multi-Agent Eval & Replay Harness](multi-agent-eval-replay-harness.7.md) - snapshots, isolated replays, comparison, scoring, gates, reports, and MCP parity.
13. [State Explosion Management](state-explosion-management.7.md) - durable summary records, compact and focused graph views, blackboard digests, and stale-aware compaction for large multi-agent runs.
14. [Evidence Adoption Reasoning Chain](evidence-adoption-reasoning-chain.7.md) - derived, fingerprinted reasoning chains explaining why each evidence item was adopted/rejected with basis, authority, rationale, and counterfactual, and a fail-closed `unexplained` state.
15. [Operator UX](operator-ux.7.md) - `status`, `graph`, report, worker, candidate, feedback, commit, topology, multi-agent, blackboard, coordinator, and trust summaries.
16. [MCP App Surface](mcp-app-surface.7.md) - JSON tool parity for agent hosts.
17. [End-to-End Golden Path](end-to-end-golden-path.7.md) - deterministic proof of app, worker, verifier, candidate, commit, and report flow.
18. [Dogfood One Real Repo](dogfood-one-real-repo.7.md) - dry-run release proof against the real Cool Workflow repository.
19. [Release And Migration](release-and-migration.7.md) - release and migration discipline for durable run state.

CW is the base system. Workflow apps are userland. Release and migration rules
must preserve that line: stable contracts, explicit compatibility checks, and
inspectable state.
