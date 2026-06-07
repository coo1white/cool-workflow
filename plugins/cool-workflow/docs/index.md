# Cool Workflow Docs

Read these in order when you are new to CW:

1. [Getting Started](getting-started.md) - clone, install, run a workflow, inspect it, and run the release check.
2. [Workflow App SDK](workflow-app-sdk.7.md) - userland app manifests, entrypoints, compatibility, and validation.
3. [Sandbox Profiles](sandbox-profiles.7.md) - named worker policy contracts for read/write/execute/network/env handling.
4. [Security / Trust Hardening](security-trust-hardening.7.md) - audit records, provenance, sandbox attestations, and acceptance rationale.
5. [Multi-Agent Runtime Core](multi-agent-runtime-core.7.md) - first-class MultiAgentRun, roles, groups, memberships, fanout, fanin, and lifecycle state.
6. [Operator UX](operator-ux.7.md) - `status`, `graph`, report, worker, candidate, feedback, commit, multi-agent, and trust summaries.
7. [MCP App Surface](mcp-app-surface.7.md) - JSON tool parity for agent hosts.
8. [End-to-End Golden Path](end-to-end-golden-path.7.md) - deterministic proof of app, worker, verifier, candidate, commit, and report flow.
9. [Dogfood One Real Repo](dogfood-one-real-repo.7.md) - dry-run release proof against the real Cool Workflow repository.
10. [Release And Migration](release-and-migration.7.md) - release and migration discipline for durable run state.

CW is the base system. Workflow apps are userland. Release and migration rules
must preserve that line: stable contracts, explicit compatibility checks, and
inspectable state.
