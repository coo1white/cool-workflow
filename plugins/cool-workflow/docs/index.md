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
15. [Run Registry / Control Plane](run-registry-control-plane.7.md) - derived, fingerprinted, fail-closed index over runs across repos: search, resume, archive, durable queue, cross-repo history, and failed-run rerun with provenance.
16. [Execution Backends](execution-backends.7.md) - the pluggable driver layer (node/bun/shell/container/remote/ci): one narrow `ExecutionBackend` contract, sandbox attestation, identical envelopes across backends, and fail-closed delegation.
17. [Operator UX](operator-ux.7.md) - `status`, `graph`, report, worker, candidate, feedback, commit, topology, multi-agent, blackboard, coordinator, and trust summaries.
18. [MCP App Surface](mcp-app-surface.7.md) - JSON tool parity for agent hosts.
19. [CLI ↔ MCP Parity](cli-mcp-parity.7.md) - the capability registry and fail-closed gate proving the CLI and MCP surfaces render one data source.
20. [End-to-End Golden Path](end-to-end-golden-path.7.md) - deterministic proof of app, worker, verifier, candidate, commit, and report flow.
21. [Dogfood One Real Repo](dogfood-one-real-repo.7.md) - dry-run release proof against the real Cool Workflow repository.
22. [Web / Desktop Workbench](web-desktop-workbench.7.md) - a read-only, localhost-only human console rendering the run graph, blackboard, worker logs, candidate compare, and audit timeline over existing capability payloads — a third front door that holds no authoritative state.
23. [Observability + Cost Accounting](observability-cost-accounting.7.md) - derived time/duration, failure/verifier/acceptance rates with sample counts and fail-closed `n/a`, plus host-attested token usage and attested-vs-estimated cost with explicit `unreported` coverage; pricing is policy as data.
24. [Team Collaboration](team-collaboration.7.md) - host-attested actor, append-only approvals/rejections/comments/handoffs provenance-linked to durable targets, and a review gate that stacks on the verifier gate (required approvals from authorized roles, fail-closed quorum/authority/self-approval); policy is data.
25. [Release And Migration](release-and-migration.7.md) - release and migration discipline for durable run state.
26. [Release Tooling](release-tooling.7.md) - one-command version bump across every surface, a per-feature scaffolder, forward-reference doc automation, and a de-duplicated release gate.
27. [Real Execution Backend Integrations](real-execution-backends.7.md) - container/remote/ci backends really execute (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, byte-stable evidence vs node, fail-closed on an unavailable runtime/endpoint.
28. [Node Snapshot / Diff / Replay](node-snapshot-diff-replay.7.md) - per-node snapshot, structural diff, and isolated deterministic replay over StateNode, reusing the eval harness; sha256-fingerprinted with fail-closed `valid|stale|absent` freshness.

CW is the base system. Workflow apps are userland. Release and migration rules
must preserve that line: stable contracts, explicit compatibility checks, and
inspectable state.
