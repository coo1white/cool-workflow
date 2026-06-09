# Cool Workflow

```text
══════════════════════════════════════════════════════════════════════
  auditable agent-workflow control-plane — delegate, don't execute
  plan → dispatch → record → verify → commit → report
══════════════════════════════════════════════════════════════════════
```

[![CI](https://img.shields.io/github/actions/workflow/status/coo1white/cool-workflow/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/coo1white/cool-workflow/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/tag/coo1white/cool-workflow?style=flat-square&label=release&color=brightgreen&sort=semver)](https://github.com/coo1white/cool-workflow/tags)
[![license](https://img.shields.io/github/license/coo1white/cool-workflow?style=flat-square&color=blue)](../../LICENSE)
![MCP](https://img.shields.io/badge/MCP-native-8A2BE2?style=flat-square)
![runtime](https://img.shields.io/badge/runtime-TypeScript%20%C2%B7%20Node-3178C6?style=flat-square)

**[Structure](#structure)** · [Commands](#commands) · [Result Envelope](#result-envelope) · [Scheduled Tasks](#scheduled-tasks) · [License](#license)

Cool Workflow, or CW, is an independent Agent Workflow SDK packaged as a
TypeScript runtime. It provides a COL-Architecture: Router / Orchestrator,
Subagent Dispatch, Deterministic Harness, Adversarial Verifier, Git/State
Commit, and MCP JSON-RPC 2.0 bridge.

The mental model is base system plus userland apps: CW provides the runtime and
contracts, while developers write reusable workflow apps in
`apps/<app-id>/app.json`. Legacy `workflows/*.workflow.js` files remain
loadable as compatibility wrappers.

CW records the model workflow loop explicitly:

```text
interpret -> act -> observe -> adjust -> checkpoint
```

These loop stages are stored in `state.json`, task records, reports, and state
commit snapshots.

CW keeps orchestration state and task queues in files. An agent host executes
the tasks and feeds results back into the workflow.

CW follows a small set of Unix-inspired workflow principles: small kernel,
explicit state, composable pipes, isolated workers, and verifier-gated commits.
See [docs/unix-principles.md](docs/unix-principles.md).

CW v0.1.32 adds Team Collaboration: a host-attested actor, append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target
(`run|task|candidate|selection|commit|node`), and a review gate that STACKS ON the
verifier gate. Identity is ATTESTED provenance, never authenticated — an absent
identity is the explicit `unattributed` actor, never a fabricated one. The review
gate is POLICY layered on the verifier MECHANISM: it runs inside `resolveCommitGate`
AFTER the verifier checks and can only ADD a required-approvals constraint, never
remove the verifier's — so an approval can never turn an unverified result into a
committed one. It FAILS CLOSED on quorum, authority, self-approval, and
unattributed actors, recording exactly which approvals are missing, and a
gate-satisfied commit is stamped with WHO approved the very artifact that shipped.
Required approvals, authorized roles, and the self-approval rule are POLICY as data
(`review policy`), default off (pre-v0.1.32 behavior unchanged). Each verb is
declared once in the capability registry so `cw <cmd> --json` is identical to
`cw_<tool>`; the v0.1.30 Workbench renders the review timeline read-only and the
v0.1.31 metrics report adds derived approval-rate/time-to-approval/handoff-count.
See [docs/team-collaboration.7.md](docs/team-collaboration.7.md).

CW v0.1.29 adds Execution Backends: the execution layer is lifted OUT of the
kernel into pluggable, swappable drivers — `node`, `bun`, `shell`, `container`,
`remote`, and `ci` — behind ONE narrow `ExecutionBackend` contract
(`src/execution-backend.ts`). Modeled on a BSD VFS / device-driver layer, the
kernel (orchestrator/dispatch/pipeline-runner) never learns which backend ran a
task: WHAT to run and which evidence to record is kernel policy; HOW and WHERE it
runs is the driver's concern. The sandbox profile is the contract — every backend
enforces or attests each requested read/write/command/network/env dimension, or
FAILS CLOSED rather than silently running unsandboxed. The result/evidence
envelope is schema-identical across backends (CW's own self-verify produces
byte-stable evidence on `node`, `shell`, and `bun`); the backend id + sandbox
attestation are recorded AS provenance, so eval/replay, the verifier gates, and
the v0.1.28 run registry stay backend-agnostic. The container/remote/ci drivers
DELEGATE and record a handle + attestation + result — CW does not become the
executor. Selection mirrors `--sandbox` with a parallel `--backend` flag and
`backend list|show|probe`, declared once in the capability registry so
`cw <cmd> --json` is schema-identical to `cw_<tool>`. The default (`node`) backend
reproduces pre-v0.1.29 behavior exactly. See
[docs/execution-backends.7.md](docs/execution-backends.7.md).

CW v0.1.31 adds Observability + Cost Accounting: time/duration, failure rate,
verifier pass rate, candidate acceptance rate, and token/cost — all DERIVED from
the run state CW already keeps (timestamps → durations; verifier nodes → pass
rate; candidates → acceptance; failed workers/feedback → failure rate). There is
NO metrics database, NO collector daemon, NO hidden counter. A rate over zero
samples is `n/a`, never a fabricated 0%/100%. Cost is ATTESTED, never measured:
CW does not call the model, so token usage is recorded as host-attested
provenance on the existing result/worker intake (absent ⇒ `unreported`, never 0),
and a monetary figure is `attested` only from attested usage × a recorded pricing
policy — assumed pricing is a SEPARATE `estimated` figure, never conflated.
Pricing is POLICY as data (`--pricing <path>|default`), out of the kernel.
`metrics show`/`metrics summary` are declared once in the capability registry so
`cw <cmd> --json` is byte-identical to `cw_<tool>`, and the v0.1.30 Workbench
renders a read-only metrics panel from the same payload. See
[docs/observability-cost-accounting.7.md](docs/observability-cost-accounting.7.md).

CW v0.1.30 adds the Web / Desktop Workbench: a human-facing console rendering a
run's run graph, blackboard, worker logs, candidate compare, and audit timeline,
plus a cross-run entry point over the v0.1.28 Run Registry. It is a THIRD FRONT
DOOR alongside the CLI (human speed) and MCP (machine context) — all three are
presentation policy over ONE mechanism. Upholding CW's "no hidden dashboard
database" promise, the Workbench holds ZERO authoritative state: it is a
stateless, READ-ONLY renderer over the durable `.cw/` files and the existing
capability payloads, so each panel equals its `cw <cmd> --json` payload
byte-for-byte (parity-gated) and refresh re-derives everything from disk — delete
the host and nothing is lost. The optional localhost host (`cw workbench serve`)
binds `127.0.0.1` only, is read-only (writes refused `405`), rejects non-localhost
`Host` headers and path traversal, and fails closed on unreadable state. It is an
OPTIONAL surface: the committed `dist/` and a plain `node` runtime keep working
with the Workbench (and its dependency-light static UI) absent. See
[docs/web-desktop-workbench.7.md](docs/web-desktop-workbench.7.md).

CW v0.1.28 adds the Run Registry / Control Plane: a layer that manages MANY
workflow runs across repositories — `run search`, `run resume`, `run archive`, a
durable `queue`, cross-repo `history`, and failed-run `run rerun` — over the
per-run `.cw/runs/<id>/state.json`, which stays the single source of truth. The
registry (`src/run-registry.ts`) is a DERIVED, rebuildable, fingerprinted index:
it classifies a documented lifecycle (`queued → running → blocked → completed →
failed → archived`), discovers runs cross-repo through a plain-file home registry
(`CW_HOME`/XDG), and fails closed — tampered or missing source surfaces as
`stale`/`missing` and triggers a rebuild, never a fabricated status. Resume
continues a run, rerun creates a NEW run linked to the original by provenance, and
archive marks without deleting source. Every verb is declared once in the
capability registry, so `cw <cmd> --json` is schema-identical to `cw_<tool>`. See
[docs/run-registry-control-plane.7.md](docs/run-registry-control-plane.7.md).

CW v0.1.27 adds CLI ↔ MCP Parity: the command-line surface and the MCP surface
are now two renderings of ONE data source, declared in a single capability
registry (`src/capability-registry.ts`) and enforced fail-closed. Each capability
names one shared core `entry`; `cw <cmd> --json` is payload-identical to the
matching `cw_<tool>` MCP result, the CLI stays terse for humans while MCP stays
complete for machines, and `npm run parity:check` (wired into `release:check`)
blocks any drift — a capability on only one surface, an undeclared tool or
command, or a payload divergence. See
[docs/cli-mcp-parity.7.md](docs/cli-mcp-parity.7.md).

CW v0.1.26 adds the Evidence Adoption Reasoning Chain: a derived, fingerprinted,
fail-closed view that explains *why* each evidence item was adopted, rejected,
superseded, or conflicting. For every gate (`fanin`, `candidate-score`,
`selection`, `verifier`, `commit`) it records the decision, basis (evidence +
provenance + trust source), authority (role/membership/worker + role policy),
rationale (reusing existing reason fields), and counterfactual (the alternatives
that lost). A "why" that cannot be traced to a real record renders as
`unexplained` rather than a fabricated rationale. New surfaces: `multi-agent
reasoning <run-id> [--evidence <id>] [--refresh]`, the MCP tools
`cw_evidence_reasoning` and `cw_evidence_reasoning_refresh`, and an additive
`rationaleStatus` on `multi-agent evidence`. The chain is derived, never
authoritative over raw state, and stored under `.cw/runs/<run-id>/reasoning/`.
See
[docs/evidence-adoption-reasoning-chain.7.md](docs/evidence-adoption-reasoning-chain.7.md).

CW v0.1.25 adds State Explosion Management: durable, versioned,
provenance-backed summary records (`MultiAgentSummaryIndex`,
`BlackboardSummaryRecord`, `GraphSummaryRecord`, `OperatorDigest`,
`StateExplosionReport`), compact and focused graph views with synthetic summary
nodes, blackboard digests, and eval/replay-gated freshness checks. Summaries are
derived userland indexes that never delete raw blackboard, graph, audit, or
evidence records and fail closed when stale. New surfaces: `summary refresh`,
`summary show`, `blackboard summarize`, `multi-agent summarize`, and
`multi-agent graph --view`. See
[docs/state-explosion-management.7.md](docs/state-explosion-management.7.md).

CW v0.1.24 hardens state loading, migrations, MCP tool calls, multi-agent and
blackboard persistence, and eval/replay artifact validation with fail-closed
operator diagnostics.

CW v0.1.23 adds Multi-Agent Eval & Replay Harness: deterministic snapshots,
isolated replays, normalized comparisons, replay scoring, release gates, human
reports, and MCP parity for topology-backed multi-agent runs. See
[docs/multi-agent-eval-replay-harness.7.md](docs/multi-agent-eval-replay-harness.7.md).

CW v0.1.22 adds Multi-Agent Trust / Policy / Audit: role policies, permission
decisions, provenance-rich blackboard messages, blackboard write audit, judge
rationale, panel decisions, and policy violations in the existing trust-audit
log. See
[docs/multi-agent-trust-policy-audit.7.md](docs/multi-agent-trust-policy-audit.7.md).

CW v0.1.21 adds Multi-Agent Operator UX: compact graph, dependencies,
failures, and evidence adoption views for topology-backed multi-agent runs.
Operators can trace agent -> dependency -> evidence -> fanin -> score ->
selection -> verifier-gated commit without a separate dashboard state. See
[docs/multi-agent-operator-ux.7.md](docs/multi-agent-operator-ux.7.md).

CW v0.1.20 adds Multi-Agent CLI + MCP Surface: the preferred host loop for
`multi-agent run`, `multi-agent status`, `multi-agent step`,
`multi-agent blackboard`, `multi-agent score`, and `multi-agent select`.
The matching MCP tools are `cw_multi_agent_run`, `cw_multi_agent_status`,
`cw_multi_agent_step`, `cw_multi_agent_blackboard`, `cw_multi_agent_score`,
and `cw_multi_agent_select`. See
[docs/multi-agent-cli-mcp-surface.7.md](docs/multi-agent-cli-mcp-surface.7.md).

CW v0.1.19 adds Multi-Agent Topologies: official `map-reduce`, `debate`, and
`judge-panel` coordination definitions with validation, apply-time
materialization, topology run state, topology graphs, Operator UX panels, trust
audit provenance, CLI commands, and MCP parity. Applying a topology creates the
linked MultiAgentRun, roles, groups, fanout, blackboard topics, coordinator
decisions, and deterministic next actions that the agent host can execute.
See [docs/multi-agent-topologies.7.md](docs/multi-agent-topologies.7.md).

CW v0.1.18 adds Coordinator / Blackboard: first-class shared topics,
messages, context frames, artifact refs, snapshots, and coordinator decisions.
The blackboard is the coordination filesystem used by topology runs to index
evidence, conflicts, fanin readiness, and synthesis decisions. See
[docs/coordinator-blackboard.7.md](docs/coordinator-blackboard.7.md).

CW v0.1.17 added Multi-Agent Runtime Core: first-class `MultiAgentRun`,
`AgentRole`, `AgentGroup`, `AgentMembership`, `AgentFanout`, and `AgentFanin`
state with lifecycle validation, dispatch attachment, worker manifest metadata,
fanin evidence coverage, Operator UX panels, trust audit events, CLI commands,
and MCP parity. See
[docs/multi-agent-runtime-core.7.md](docs/multi-agent-runtime-core.7.md).

CW v0.1.16 adds Dogfood One Real Repo: a dry-run release proof that runs the
canonical `release-cut` app against this repository, records real command
evidence, scores/selects a release candidate, creates a verifier-gated CW state
commit, and explains trust through audit provenance. See
[docs/dogfood-one-real-repo.7.md](docs/dogfood-one-real-repo.7.md).

CW v0.1.15 adds Security / Trust Hardening: durable trust audit records,
worker sandbox decision history, evidence provenance, acceptance rationale,
and CLI/MCP audit inspection. See
[docs/security-trust-hardening.7.md](docs/security-trust-hardening.7.md).

CW v0.1.14 added Release & Migration Discipline: explicit run-state schema
migration policy, fixture-based backward compatibility tests, version
synchronization checks, and a dry-run release gate. See
[docs/release-and-migration.7.md](docs/release-and-migration.7.md).

CW v0.1.13 completes the MCP / App Surface so agent hosts can treat CW as a
runtime instead of a CLI wrapper. MCP now covers app runs, worker inspection and
output recording, candidate scoring/selection, sandbox profile resolution,
verifier-gated commits, and structured operator summaries while preserving old
tool names. See [docs/mcp-app-surface.7.md](docs/mcp-app-surface.7.md).

CW v0.1.12 added Operator UX: human-readable status, graph, report summaries,
resource summaries, commit/feedback/worker/candidate panels, and deterministic
next-step recommendations. JSON remains available with `--json` or
`--format json`. See [docs/operator-ux.7.md](docs/operator-ux.7.md).

CW v0.1.11 added Canonical Workflow Apps: official app-directory userland for
`architecture-review`, `pr-review-fix-ci`, `release-cut`, and
`research-synthesis`. They validate and plan through `npm run canonical-apps`
and are the app matrix used to judge whether the SDK is pleasant, stable, and
expressive. See
[docs/canonical-workflow-apps.7.md](docs/canonical-workflow-apps.7.md).

CW v0.1.10 added the End-to-End Golden Path: a deterministic regression command
that validates a first-class app, plans a run, dispatches a readonly isolated
worker, records a simulated worker result, scores/selects a candidate, creates a
verifier-gated commit, and renders a report. See
[docs/end-to-end-golden-path.7.md](docs/end-to-end-golden-path.7.md).

CW v0.1.9 added the Workflow App SDK: first-class app metadata, validation,
deterministic app discovery, app CLI/MCP tools, app templates, and run
state/report metadata. See
[docs/workflow-app-sdk.7.md](docs/workflow-app-sdk.7.md).

CW v0.1.8 added Sandbox Profiles: named worker policy contracts for read paths,
write paths, command execution, network access, and environment exposure. CW
stores and validates the policy, while the agent host enforces OS/process
runtime controls. See [docs/sandbox-profiles.7.md](docs/sandbox-profiles.7.md).

## Structure

```text
cool-workflow
  skills/cool-workflow/SKILL.md
  src/
  dist/
  scripts/cw.js
  workflows/architecture-review.workflow.js
  workflows/research-synthesis.workflow.js
  apps/architecture-review/app.json
  apps/end-to-end-golden-path/app.json
  apps/pr-review-fix-ci/app.json
  apps/release-cut/app.json
  apps/research-synthesis/app.json
  apps/workflow-app-sdk-demo/app.json
  docs/index.md
  docs/getting-started.md
  docs/coordinator-blackboard.7.md
  docs/multi-agent-runtime-core.7.md
  docs/multi-agent-eval-replay-harness.7.md
  docs/dogfood-one-real-repo.7.md
  docs/release-and-migration.7.md
  docs/agent-sdk.md
  docs/unix-principles.md
  docs/mcp-app-surface.7.md
  docs/operator-ux.7.md
  docs/workflow-app-sdk.7.md
  docs/sandbox-profiles.7.md
  docs/candidate-scoring.7.md
  docs/verifier-gated-commit.7.md
  docs/run-registry-control-plane.7.md
  docs/execution-backends.7.md
```

## Commands

List bundled workflows:

```bash
node scripts/cw.js list
```

List, inspect, validate, and create workflow apps:

```bash
node scripts/cw.js app list
node scripts/cw.js app show architecture-review
node scripts/cw.js app validate apps/architecture-review/app.json
node scripts/cw.js app show pr-review-fix-ci
node scripts/cw.js app show release-cut
node scripts/cw.js app show research-synthesis
node scripts/cw.js app show workflow-app-sdk-demo
node scripts/cw.js app validate apps/workflow-app-sdk-demo/app.json
node scripts/cw.js app validate end-to-end-golden-path
node scripts/cw.js app package architecture-review
node scripts/cw.js app init my-app --title "My App"
```

Create a reusable workflow script:

```bash
node scripts/cw.js init my-workflow --title "My Workflow"
```

Create a run:

```bash
node scripts/cw.js plan architecture-review \
  --repo /path/to/repo \
  --question "Is this architecture sound?" \
  --invariant "single-box self-hosted"
```

Inspect a run as an operator:

```bash
node scripts/cw.js status <run-id>
node scripts/cw.js status <run-id> --json
node scripts/cw.js graph <run-id>
node scripts/cw.js graph <run-id> --json
node scripts/cw.js report <run-id> --show
node scripts/cw.js topology summary <run-id>
node scripts/cw.js topology graph <run-id>
node scripts/cw.js worker summary <run-id>
node scripts/cw.js multi-agent summary <run-id>
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js candidate summary <run-id>
node scripts/cw.js feedback summary <run-id>
node scripts/cw.js commit summary <run-id>
node scripts/cw.js state check <run-id>
```

MCP hosts can drive the same flow with JSON tools:

```text
cw_app_run -> cw_dispatch -> cw_worker_manifest -> cw_worker_output
-> cw_candidate_register -> cw_candidate_score -> cw_candidate_select
-> cw_commit -> cw_operator_report
```

MCP also exposes topology tools:

```text
cw_topology_list
cw_topology_show
cw_topology_validate
cw_topology_apply
cw_topology_summary
cw_topology_graph
```

List, inspect, validate, and apply official multi-agent topologies:

```bash
node scripts/cw.js topology list
node scripts/cw.js topology show map-reduce
node scripts/cw.js topology show debate
node scripts/cw.js topology show judge-panel
node scripts/cw.js topology validate map-reduce
node scripts/cw.js topology apply <run-id> map-reduce --task <task-id> --mappers 2
node scripts/cw.js topology apply <run-id> debate --id debate-round --rounds 2
node scripts/cw.js topology apply <run-id> judge-panel --judgeCount 3
node scripts/cw.js topology summary <run-id>
node scripts/cw.js topology summary <run-id> --json
node scripts/cw.js topology graph <run-id>
node scripts/cw.js topology graph <run-id> --json
node scripts/cw.js topology show <run-id> <topology-run-id>
```

Topology runs are stored under `.cw/runs/<run-id>/topologies/`, referenced from
`state.json`, included in operator status and graph output, and counted in the
trust audit summary.

Create a dispatch manifest for the current runnable phase:

```bash
node scripts/cw.js dispatch <run-id> --limit 6
node scripts/cw.js dispatch <run-id> --sandbox readonly
node scripts/cw.js dispatch <run-id> --multi-agent-run ma --multi-agent-group group --multi-agent-role role
node scripts/cw.js dispatch <run-id> --multi-agent-fanout <fanout-id>
```

Inspect sandbox profiles:

```bash
node scripts/cw.js sandbox list
node scripts/cw.js sandbox show readonly
node scripts/cw.js sandbox validate ./site-sandbox.json
```

Record an agent result after a worker finishes:

```bash
node scripts/cw.js result <run-id> <task-id> path/to/result.md
```

Register, score, rank, and verifier-gate a candidate output:

```bash
node scripts/cw.js candidate register <run-id> --worker <worker-id>
node scripts/cw.js candidate score <run-id> <candidate-id> \
  --criterion correctness=4 \
  --criterion evidence=4 \
  --criterion fit=2 \
  --maxTotal 10 \
  --evidence /path/to/file.ts:42
node scripts/cw.js candidate rank <run-id>
node scripts/cw.js candidate select <run-id> <candidate-id> --reason "verified winner"
```

Create a deterministic state commit:

```bash
node scripts/cw.js commit <run-id> --verifier <node-id> --reason "verified result"
node scripts/cw.js commit <run-id> --selection <selection-id> --reason "verified winner"
node scripts/cw.js commit <run-id> --allow-unverified-checkpoint --reason "manual checkpoint"
```

The first two commands create verifier-gated committed state. The last command
creates an explicit non-gated checkpoint.

Render a report:

```bash
node scripts/cw.js report <run-id>
```

Manage runs across repos with the control plane (derived, fail-closed registry):

```bash
node scripts/cw.js registry refresh --scope home
node scripts/cw.js run search --app architecture-review --status failed
node scripts/cw.js run show <run-id>
node scripts/cw.js run resume <run-id>
node scripts/cw.js run rerun <failed-run-id> --reason "retry"
node scripts/cw.js run archive <run-id> --reason "old"
node scripts/cw.js queue add --app release-cut --priority 10
node scripts/cw.js queue list
node scripts/cw.js queue drain --limit 1
node scripts/cw.js history --scope home --json
```

Run the deterministic release golden path:

```bash
npm run dogfood:release
npm run release:check
npm run canonical-apps
npm run golden-path
npm run fixture-compat
npm run version:sync
npm test
```

Run data lives under `.cw/runs/<run-id>/` in `--cwd`, or in `--repo` when
`--cwd` is omitted.

Build the TypeScript runtime:

```bash
npm install --no-package-lock
npm run build
```

See [docs/agent-sdk.md](docs/agent-sdk.md) for the developer contract.
See [docs/index.md](docs/index.md) for a docs map.
See [docs/getting-started.md](docs/getting-started.md) for a clone-to-run path.
See [docs/release-and-migration.7.md](docs/release-and-migration.7.md) for
release and migration discipline.
See [docs/dogfood-one-real-repo.7.md](docs/dogfood-one-real-repo.7.md) for the
real-repository dogfood release proof.
See [docs/operator-ux.7.md](docs/operator-ux.7.md) for the operator command
surface.
See [docs/workflow-app-sdk.7.md](docs/workflow-app-sdk.7.md) for the app
contract.
See [docs/canonical-workflow-apps.7.md](docs/canonical-workflow-apps.7.md) for
the canonical app matrix.
See [docs/candidate-scoring.7.md](docs/candidate-scoring.7.md) for the
candidate scoring file contract.
See [docs/verifier-gated-commit.7.md](docs/verifier-gated-commit.7.md) for the
commit gate contract.
See [docs/sandbox-profiles.7.md](docs/sandbox-profiles.7.md) for the sandbox
profile contract.
See [docs/end-to-end-golden-path.7.md](docs/end-to-end-golden-path.7.md) for
the release golden path contract.
See [docs/run-registry-control-plane.7.md](docs/run-registry-control-plane.7.md)
for the cross-repo run registry / control plane contract.

## License

CW is released under the BSD-2-Clause License.

## Scheduled Tasks

```bash
node scripts/cw.js loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule create --kind loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule due
node scripts/cw.js schedule pause <schedule-id>
node scripts/cw.js schedule resume <schedule-id>
node scripts/cw.js schedule run-now <schedule-id>
node scripts/cw.js schedule history <schedule-id>
node scripts/cw.js schedule daemon --once
```

See [docs/scheduled-tasks.md](docs/scheduled-tasks.md).

## Routine-Style Triggers

```bash
node scripts/cw.js routine create --kind api --prompt "Handle this API event."
node scripts/cw.js routine create --kind github --prompt "Handle this GitHub event."
node scripts/cw.js routine fire api payload.json
node scripts/cw.js routine events
```

## Result Envelope

Verification and synthesis tasks require a structured result block:

````text
```cw:result
{
  "summary": "short summary",
  "findings": [
    {
      "id": "risk-1",
      "classification": "real",
      "severity": "P1",
      "evidence": ["/absolute/path/file.ts:42"]
    }
  ],
  "evidence": ["/absolute/path/file.ts:42"]
}
```
````

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a de-duplicated release gate. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really execute (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is unavailable. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, reusing the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

spawn an external agent process per worker, capture result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable disk reclamation: `gc plan|run|verify` seal the audit skeleton, free the reconstructable/scratch bulk, and prove it via a hash-chained tombstone. Write-ahead + fail-closed (skeleton -> tombstone -> fsync -> free); explicit capability downgrade (verify-only / re-runnable-by-reconstruction); CW never reclaims by default.

## Durable State & Locking (v0.1.40)

every authoritative write is now atomic (temp -> rename, so a crash can never truncate state.json) with fsync-durability for the audit-essential stores; the cross-process read-modify-write stores (home queue, archive overlay, reclamation chain) are serialized by a portable stale-stealing file lock. Closes the architecture self-audit's non-atomic/unlocked P1 and pulls reclamation's result-node re-point inside the write-ahead boundary (durable persist + dangling-ref proof before any free) with a content-validated skeleton.

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

closes the v0.1.41 architecture self-audit's real findings and pays down its top maintainability debt. Hardening: evidence-gated commits now require GROUNDED locators (path/URL/namespace:value), not just presence, with opt-in `CW_REQUIRE_RESOLVABLE_EVIDENCE` on-disk resolution; the trust-audit event log is appended with fsync (durable like state.json); path containment is symlink-hardened (realpath of the deepest existing ancestor) across sandbox checks and reclamation proofs; worker ids are deterministic; coordinator secret redaction recurses. Maintainability: the `descriptor.id ===` switches in the execution backend are gone — drivers self-describe through a `registerBackend` registry — and the ~2100-line CoolWorkflowRunner god-object is decomposed into per-domain operation modules under `src/orchestrator/`, leaving the runner a pure `loadRun -> delegate` router. Behavior-preserving (verified by adversarial review + full release:check).

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.
