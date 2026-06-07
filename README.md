# Cool Workflow

Cool Workflow is a Unix-inspired workflow kernel for agentic work: a small TypeScript runtime that turns tasks, workers, evidence, verification, and commits into explicit, inspectable state.

CW makes the agent loop explicit:

```text
interpret -> act -> observe -> adjust -> checkpoint
```

## What It Includes

- Developer-facing workflow SDK contracts.
- Workflow App SDK for versioned, validated, reusable workflow apps.
- Complete MCP / App Surface for app runs, worker output, candidate scoring,
  sandbox resolution, verifier-gated commits, and operator summaries.
- Security / Trust Hardening for durable audit records, sandbox decision
  history, evidence provenance, acceptance rationale, and CLI/MCP audit tools.
- Coordinator / Blackboard for durable shared topics, messages, context frames,
  artifact refs, snapshots, coordinator decisions, conflict handling, and
  ready-for-fanin evidence summaries.
- Multi-Agent Runtime Core for first-class runs, roles, groups, memberships,
  fanout/fanin, lifecycle state, worker manifest metadata, Operator UX panels,
  and MCP parity.
- Release & Migration Discipline for explicit run-state migrations,
  fixture-based backward compatibility, version synchronization, and a dry-run
  release gate.
- Dogfood One Real Repo release proof that runs the canonical `release-cut`
  workflow against this repository with real command logs, candidate
  scoring/selection, verifier-gated CW state, and trust audit provenance.
- Canonical Workflow Apps for architecture review, PR/CI review, release
  preparation, and research synthesis.
- Operator UX for human `status`, run graphs, report summaries, resource
  summaries, and deterministic next-step recommendations.
- Router / Orchestrator for workflow definitions and phase gates.
- Subagent dispatch manifests for fan-out work.
- Deterministic harness prompts for repeatable agent tasks.
- Adversarial verifier with evidence gates.
- Git/state checkpoint snapshots for major transitions, plus verifier-gated
  committed state.
- MCP JSON-RPC 2.0 server for tool-based integrations.
- Scheduled tasks for loop, cron, and reminder-style workflow continuations.
- Local scheduler daemon for due scanning.
- Routine-style API and GitHub trigger bridge.
- Sandbox Profiles for named worker read/write/execute/network/env policy
  contracts.
- End-to-end golden path regression for the full app, worker, scoring,
  verifier-gated commit, and report chain.

## Agent SDK Philosophy

CW treats agent development as SDK development, not prompt improvisation.

The runtime owns the platform contract:

```text
workflow definition -> input validation -> task generation -> dispatch
-> evidence-backed result recording -> verifier gates
-> verifier-gated commit or explicit checkpoint -> report
```

Developers write workflow apps against that contract. A workflow app declares
inputs, phases, agent tasks, artifacts, limits, and evidence requirements. CW
then gives an agent host a deterministic way to run, inspect, pause, resume,
verify, and publish the work.

CW also follows a small set of Unix-inspired workflow principles:

```text
Small kernel.
Explicit state.
Composable pipes.
Isolated workers.
Verifier-gated commits.
```

See [unix-principles.md](plugins/cool-workflow/docs/unix-principles.md).
See [index.md](plugins/cool-workflow/docs/index.md) for the docs map.
See [getting-started.md](plugins/cool-workflow/docs/getting-started.md) for a
fresh clone path.
See [release-and-migration.7.md](plugins/cool-workflow/docs/release-and-migration.7.md)
for release and migration discipline.
See [dogfood-one-real-repo.7.md](plugins/cool-workflow/docs/dogfood-one-real-repo.7.md)
for the v0.1.16 real-repository dogfood release proof.
See [coordinator-blackboard.7.md](plugins/cool-workflow/docs/coordinator-blackboard.7.md)
for the v0.1.18 shared coordination substrate.
See [multi-agent-runtime-core.7.md](plugins/cool-workflow/docs/multi-agent-runtime-core.7.md)
for the v0.1.17 multi-agent runtime state model.
See [security-trust-hardening.7.md](plugins/cool-workflow/docs/security-trust-hardening.7.md)
for v0.1.15 audit and trust hardening.
See [mcp-app-surface.7.md](plugins/cool-workflow/docs/mcp-app-surface.7.md)
for the MCP runtime surface.
See [operator-ux.7.md](plugins/cool-workflow/docs/operator-ux.7.md) for
operator inspection commands.
See [workflow-app-sdk.7.md](plugins/cool-workflow/docs/workflow-app-sdk.7.md)
for the app contract.
See [canonical-workflow-apps.7.md](plugins/cool-workflow/docs/canonical-workflow-apps.7.md)
for the official app matrix.
See [verifier-gated-commit.7.md](plugins/cool-workflow/docs/verifier-gated-commit.7.md)
for the commit/checkpoint contract.
See [sandbox-profiles.7.md](plugins/cool-workflow/docs/sandbox-profiles.7.md)
for the worker sandbox policy contract.
See [end-to-end-golden-path.7.md](plugins/cool-workflow/docs/end-to-end-golden-path.7.md)
for the release integration proof.

## Language Contract

```text
Core runtime: 100% TypeScript
Runtime target: Node.js / Bun-compatible CommonJS
Workflow apps: JavaScript orchestration modules
Workflow app manifests: apps/<app-id>/app.json
Published runtime: generated JavaScript in dist/
```

This keeps the runtime strongly typed while workflow apps remain easy to save,
share, and run.

## Install From GitHub

Clone the repository and run the bundled CLI from the package directory:

```bash
git clone https://github.com/coo1white/cool-workflow.git
cd cool-workflow/plugins/cool-workflow
node scripts/cw.js list
```

## Local Development

```bash
cd plugins/cool-workflow
npm install --no-package-lock
npm run build
npm run check
npm run release:check
npm run dogfood:release
npm run canonical-apps
npm run golden-path
node scripts/cw.js list
rm -rf node_modules package-lock.json
```

The package intentionally commits `plugins/cool-workflow/dist/` so users can run
CW without installing TypeScript dependencies.

## CLI Quick Start

```bash
cd plugins/cool-workflow
node scripts/cw.js list
node scripts/cw.js app list
node scripts/cw.js app show architecture-review
node scripts/cw.js app validate apps/architecture-review/app.json
node scripts/cw.js app show release-cut
node scripts/cw.js app validate end-to-end-golden-path
npm run canonical-apps
npm run golden-path
npm run dogfood:release
npm run fixture-compat
npm run version:sync
node test/mcp-app-surface-smoke.js
node scripts/cw.js app show workflow-app-sdk-demo
node scripts/cw.js app validate apps/workflow-app-sdk-demo/app.json
node scripts/cw.js plan architecture-review \
  --repo /path/to/repo \
  --question "Is this architecture sound?"
node scripts/cw.js dispatch <run-id> --limit 6
node scripts/cw.js dispatch <run-id> --sandbox readonly
node scripts/cw.js status <run-id>
node scripts/cw.js status <run-id> --json
node scripts/cw.js graph <run-id>
node scripts/cw.js report <run-id> --show
node scripts/cw.js worker summary <run-id>
node scripts/cw.js candidate summary <run-id>
node scripts/cw.js feedback summary <run-id>
node scripts/cw.js commit summary <run-id>
node scripts/cw.js state check <run-id>
node scripts/cw.js sandbox list
node scripts/cw.js sandbox show readonly
node scripts/cw.js report <run-id>
```

## Scheduled Tasks And Routines

```bash
cd plugins/cool-workflow

node scripts/cw.js loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule daemon --once
node scripts/cw.js schedule pause <schedule-id>
node scripts/cw.js schedule resume <schedule-id>
node scripts/cw.js schedule run-now <schedule-id>
node scripts/cw.js schedule history <schedule-id>

node scripts/cw.js routine create --kind github --prompt "Review this GitHub event."
node scripts/cw.js routine fire github payload.json
node scripts/cw.js routine events
```

## Repository Layout

```text
.agents/plugins/marketplace.json      Optional local package catalog
plugins/cool-workflow/                CW package
plugins/cool-workflow/src/            TypeScript source
plugins/cool-workflow/dist/           Runtime JavaScript committed for users
plugins/cool-workflow/skills/         Agent host skill entrypoint
plugins/cool-workflow/workflows/      Bundled workflow definitions
plugins/cool-workflow/apps/           Canonical apps and SDK examples
plugins/cool-workflow/docs/           Feature and SDK notes
examples/                             Example workflow outputs
```

## Status

CW is an independent Agent Workflow SDK by COOLWHITE LLC. It is released under
the BSD-2-Clause License.
