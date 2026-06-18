# Cool Workflow

```text
══════════════════════════════════════════════════════════════════════
  auditable agent-workflow control-plane — delegate, don't execute
  plan → dispatch → record → verify → commit → report
══════════════════════════════════════════════════════════════════════
```

[![CI](https://img.shields.io/github/actions/workflow/status/coo1white/cool-workflow/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/coo1white/cool-workflow/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/cool-workflow?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/cool-workflow)
[![downloads](https://img.shields.io/npm/dm/cool-workflow?style=flat-square&label=downloads)](https://www.npmjs.com/package/cool-workflow)
[![release](https://img.shields.io/github/v/tag/coo1white/cool-workflow?style=flat-square&label=release&color=brightgreen&sort=semver)](https://github.com/coo1white/cool-workflow/tags)
[![license](https://img.shields.io/badge/license-BSD--2--Clause-blue?style=flat-square)](../../LICENSE)
![MCP](https://img.shields.io/badge/MCP-native-8A2BE2?style=flat-square)
![runtime](https://img.shields.io/badge/runtime-TypeScript%20%C2%B7%20Node-3178C6?style=flat-square)

**[Structure](#structure)** · [Commands](#commands) · [Result Envelope](#result-envelope) · [Scheduled Tasks](#scheduled-tasks) · [License](#license)

Cool Workflow, or CW, is a free-standing agent workflow control-plane put up as a
TypeScript runtime. It gives a COL-Architecture: Router / Orchestrator,
Subagent Dispatch, Deterministic Harness, Adversarial Verifier, Git/State
Commit, and MCP JSON-RPC 2.0 bridge.

The way to see it is a base system plus userland apps: CW gives the runtime and
contracts, while makers write apps they can use again in
`apps/<app-id>/app.json`. Old `workflows/*.workflow.js` files still
load as fit-together wrappers.

CW writes down the model workflow loop in a clear way:

```text
interpret -> act -> observe -> adjust -> checkpoint
```

These loop stages are kept in `state.json`, task records, reports, and state
commit snapshots.

CW keeps orchestration state and task queues in files. An agent host does
the tasks and gives results back to the workflow.

CW keeps to a small set of Unix-based workflow rules: small kernel,
clear state, pipes that join, workers kept apart, and verifier-gated commits.
See [docs/unix-principles.md](docs/unix-principles.md).

CW v0.1.32 adds Team Collaboration: a host-attested actor, append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target
(`run|task|candidate|selection|commit|node`), and a review gate that STACKS ON the
verifier gate. Identity is ATTESTED provenance, never authenticated — a missing
identity is the clear `unattributed` actor, never a made-up one. The review
gate is POLICY put on top of the verifier MECHANISM: it runs inside `resolveCommitGate`
AFTER the verifier checks and can only ADD a required-approvals rule, never
take away the verifier's — so an approval can never turn an unverified result into a
committed one. It FAILS CLOSED on quorum, authority, self-approval, and
unattributed actors, writing down just which approvals are not there, and a
gate-satisfied commit is marked with WHO approved the very artifact that went out.
Required approvals, authorized roles, and the self-approval rule are POLICY as data
(`review policy`), off to start with (pre-v0.1.32 behavior unchanged). Each verb is
declared once in the capability registry so `cw <cmd> --json` is the same as
`cw_<tool>`; the v0.1.30 Workbench shows the review timeline read-only and the
v0.1.31 metrics report adds derived approval-rate/time-to-approval/handoff-count.
See [docs/team-collaboration.7.md](docs/team-collaboration.7.md).

CW v0.1.29 adds Execution Backends: the execution layer is lifted OUT of the
kernel into drivers you can plug in and swap — `node`, `bun`, `shell`, `container`,
`remote`, and `ci` — behind ONE small `ExecutionBackend` contract
(`src/execution-backend.ts`). Built on the lines of a BSD VFS / device-driver layer, the
kernel (orchestrator/dispatch/pipeline-runner) never learns which backend ran a
task: WHAT to run and which evidence to record is kernel policy; HOW and WHERE it
runs is the driver's business. The sandbox profile is the contract — every backend
makes good or attests each requested read/write/command/network/env dimension, or
FAILS CLOSED instead of quietly running unsandboxed. The result/evidence
envelope is schema-identical across backends (CW's own self-verify makes
byte-stable evidence on `node`, `shell`, and `bun`); the backend id + sandbox
attestation are recorded AS provenance, so eval/replay, the verifier gates, and
the v0.1.28 run registry stay backend-agnostic. The container/remote/ci drivers
DELEGATE and record a handle + attestation + result — CW does not become the
executor. Selection is like `--sandbox` with a parallel `--backend` flag and
`backend list|show|probe`, declared once in the capability registry so
`cw <cmd> --json` is schema-identical to `cw_<tool>`. The default (`node`) backend
gives pre-v0.1.29 behavior just the same. See
[docs/execution-backends.7.md](docs/execution-backends.7.md).

CW v0.1.31 adds Observability + Cost Accounting: time/duration, failure rate,
verifier pass rate, candidate acceptance rate, and token/cost — all DERIVED from
the run state CW already keeps (timestamps → durations; verifier nodes → pass
rate; candidates → acceptance; failed workers/feedback → failure rate). There is
NO metrics database, NO collector daemon, NO secret counter. A rate over zero
samples is `n/a`, never a made-up 0%/100%. Cost is ATTESTED, never measured:
CW does not call the model, so token usage is recorded as host-attested
provenance on the existing result/worker intake (absent ⇒ `unreported`, never 0),
and a money figure is `attested` only from attested usage × a recorded pricing
policy — guessed pricing is a SEPARATE `estimated` figure, never mixed in.
Pricing is POLICY as data (`--pricing <path>|default`), out of the kernel.
`metrics show`/`metrics summary` are declared once in the capability registry so
`cw <cmd> --json` is byte-identical to `cw_<tool>`, and the v0.1.30 Workbench
shows a read-only metrics panel from the same payload. See
[docs/observability-cost-accounting.7.md](docs/observability-cost-accounting.7.md).

CW v0.1.30 adds the Web / Desktop Workbench: a console for people that shows a
run's run graph, blackboard, worker logs, candidate compare, and audit timeline,
plus a cross-run way in over the v0.1.28 Run Registry. It is a THIRD FRONT
DOOR next to the CLI (human speed) and MCP (machine context) — all three are
presentation policy over ONE mechanism. Keeping CW's "no hidden dashboard
database" promise, the Workbench holds ZERO authoritative state: it is a
stateless, READ-ONLY renderer over the durable `.cw/` files and the existing
capability payloads, so each panel is the same as its `cw <cmd> --json` payload
byte-for-byte (parity-gated) and refresh works it all out again from disk — delete
the host and nothing is lost. The optional localhost host (`cw workbench serve`)
binds `127.0.0.1` only, is read-only (writes refused `405`), says no to non-localhost
`Host` headers and path traversal, and fails closed on unreadable state. It is an
OPTIONAL surface: the committed `dist/` and a plain `node` runtime keep working
with the Workbench (and its dependency-light static UI) gone. See
[docs/web-desktop-workbench.7.md](docs/web-desktop-workbench.7.md).

CW v0.1.28 adds the Run Registry / Control Plane: a layer that looks after MANY
workflow runs across repositories — `run search`, `run resume`, `run archive`, a
durable `queue`, cross-repo `history`, and failed-run `run rerun` — over the
per-run `.cw/runs/<id>/state.json`, which stays the one true source. The
registry (`src/run-registry.ts`) is a DERIVED, rebuildable, fingerprinted index:
it sorts a documented lifecycle (`queued → running → blocked → completed →
failed → archived`), finds runs cross-repo through a plain-file home registry
(`CW_HOME`/XDG), and fails closed — tampered or missing source comes up as
`stale`/`missing` and starts a rebuild, never a made-up status. Resume
goes on with a run, rerun makes a NEW run tied to the first one by provenance, and
archive marks it without deleting source. Every verb is declared once in the
capability registry, so `cw <cmd> --json` is schema-identical to `cw_<tool>`. See
[docs/run-registry-control-plane.7.md](docs/run-registry-control-plane.7.md).

CW v0.1.27 adds CLI ↔ MCP Parity: the command-line surface and the MCP surface
are now two views of ONE data source, declared in a single capability
registry (`src/capability-registry.ts`) and kept fail-closed. Each capability
names one shared core `entry`; `cw <cmd> --json` is payload-identical to the
matching `cw_<tool>` MCP result, the CLI stays short for people while MCP stays
full for machines, and `npm run parity:check` (wired into `release:check`)
stops any drift — a capability on only one surface, an undeclared tool or
command, or a payload that does not match. See
[docs/cli-mcp-parity.7.md](docs/cli-mcp-parity.7.md).

CW v0.1.26 adds the Evidence Adoption Reasoning Chain: a derived, fingerprinted,
fail-closed view that makes clear *why* each evidence item was adopted, rejected,
superseded, or conflicting. For every gate (`fanin`, `candidate-score`,
`selection`, `verifier`, `commit`) it records the decision, basis (evidence +
provenance + trust source), authority (role/membership/worker + role policy),
rationale (using existing reason fields again), and counterfactual (the other choices
that lost). A "why" that cannot be traced to a real record comes up as
`unexplained` rather than a made-up rationale. New surfaces: `multi-agent
reasoning <run-id> [--evidence <id>] [--refresh]`, the MCP tools
`cw_evidence_reasoning` and `cw_evidence_reasoning_refresh`, and an added
`rationaleStatus` on `multi-agent evidence`. The chain is derived, never
the top authority over raw state, and kept under `.cw/runs/<run-id>/reasoning/`.
See
[docs/evidence-adoption-reasoning-chain.7.md](docs/evidence-adoption-reasoning-chain.7.md).

CW v0.1.25 adds State Explosion Management: durable, versioned,
provenance-backed summary records (`MultiAgentSummaryIndex`,
`BlackboardSummaryRecord`, `GraphSummaryRecord`, `OperatorDigest`,
`StateExplosionReport`), small and pointed graph views with built-up summary
nodes, blackboard digests, and eval/replay-gated freshness checks. Summaries are
derived userland indexes that never delete raw blackboard, graph, audit, or
evidence records and fail closed when stale. New surfaces: `summary refresh`,
`summary show`, `blackboard summarize`, `multi-agent summarize`, and
`multi-agent graph --view`. See
[docs/state-explosion-management.7.md](docs/state-explosion-management.7.md).

CW v0.1.24 makes harder state loading, migrations, MCP tool calls, multi-agent and
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

CW v0.1.21 adds Multi-Agent Operator UX: small graph, dependencies,
failures, and evidence adoption views for topology-backed multi-agent runs.
Operators can trace agent -> dependency -> evidence -> fanin -> score ->
selection -> verifier-gated commit with no separate dashboard state. See
[docs/multi-agent-operator-ux.7.md](docs/multi-agent-operator-ux.7.md).

CW v0.1.20 adds Multi-Agent CLI + MCP Surface: the host loop to go for, for
`multi-agent run`, `multi-agent status`, `multi-agent step`,
`multi-agent blackboard`, `multi-agent score`, and `multi-agent select`.
The matching MCP tools are `cw_multi_agent_run`, `cw_multi_agent_status`,
`cw_multi_agent_step`, `cw_multi_agent_blackboard`, `cw_multi_agent_score`,
and `cw_multi_agent_select`. See
[docs/multi-agent-cli-mcp-surface.7.md](docs/multi-agent-cli-mcp-surface.7.md).

CW v0.1.19 adds Multi-Agent Topologies: official `map-reduce`, `debate`, and
`judge-panel` coordination definitions with validation, apply-time
materialization, topology run state, topology graphs, Operator UX panels, trust
audit provenance, CLI commands, and MCP parity. Applying a topology makes the
linked MultiAgentRun, roles, groups, fanout, blackboard topics, coordinator
decisions, and deterministic next actions that the agent host can do.
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
evidence, scores/selects a release candidate, makes a verifier-gated CW state
commit, and makes trust clear through audit provenance. See
[docs/dogfood-one-real-repo.7.md](docs/dogfood-one-real-repo.7.md).

CW v0.1.15 adds Security / Trust Hardening: durable trust audit records,
worker sandbox decision history, evidence provenance, acceptance rationale,
and CLI/MCP audit inspection. See
[docs/security-trust-hardening.7.md](docs/security-trust-hardening.7.md).

CW v0.1.14 added Release & Migration Discipline: clear run-state schema
migration policy, fixture-based backward compatibility tests, version
synchronization checks, and a dry-run release gate. See
[docs/release-and-migration.7.md](docs/release-and-migration.7.md).

CW v0.1.13 completes the MCP / App Surface so agent hosts can take CW as a
runtime in place of a CLI wrapper. MCP now covers app runs, worker inspection and
output recording, candidate scoring/selection, sandbox profile resolution,
verifier-gated commits, and structured operator summaries while keeping old
tool names. See [docs/mcp-app-surface.7.md](docs/mcp-app-surface.7.md).

CW v0.1.12 added Operator UX: human-readable status, graph, report summaries,
resource summaries, commit/feedback/worker/candidate panels, and deterministic
next-step suggestions. JSON is still there with `--json` or
`--format json`. See [docs/operator-ux.7.md](docs/operator-ux.7.md).

CW v0.1.11 added Canonical Workflow Apps: official app-directory userland for
`architecture-review`, `pr-review-fix-ci`, `release-cut`, and
`research-synthesis`. They validate and plan through `npm run canonical-apps`
and are the app matrix used to judge if the framework is nice to use, steady, and
able to say much. See
[docs/canonical-workflow-apps.7.md](docs/canonical-workflow-apps.7.md).

CW v0.1.10 added the End-to-End Golden Path: a deterministic regression command
that validates a first-class app, plans a run, dispatches a readonly isolated
worker, records a simulated worker result, scores/selects a candidate, makes a
verifier-gated commit, and renders a report. See
[docs/end-to-end-golden-path.7.md](docs/end-to-end-golden-path.7.md).

CW v0.1.9 added the Workflow App framework: first-class app metadata, validation,
deterministic app discovery, app CLI/MCP tools, app templates, and run
state/report metadata. See
[docs/workflow-app-framework.7.md](docs/workflow-app-framework.7.md).

CW v0.1.8 added Sandbox Profiles: named worker policy contracts for read paths,
write paths, command execution, network access, and environment exposure. CW
keeps and validates the policy, while the agent host makes good the OS/process
runtime controls. See [docs/sandbox-profiles.7.md](docs/sandbox-profiles.7.md).

## Quickstart

**30-second proof, no install** — see that a recorded telemetry verdict can't be faked:

```bash
npx cool-workflow demo tamper
# builds a signed ed25519 ledger, forges it 2 ways, both caught offline
# -> VERDICT: tamper-evidence holds ✓
```

**Try a real run** — no clone needed; drive an architecture review with your own agent:

```bash
npx cool-workflow quickstart architecture-review --repo /path/to/repo \
  --question "Is this architecture sound?" --agent-command builtin:claude
```

CW DELEGATES worker execution to your own agent. With no `--agent-command` (or
`CW_AGENT_COMMAND`) the drive fails closed (status `blocked`) — it never makes up a
result. `--agent-command builtin:claude` points to a bundled read-only `claude -p`
wrapper (needs `claude` on your PATH).

**Re-prove a finished run, offline** (`cw` is the installed bin; or `npx cool-workflow <cmd>`):

```bash
cw telemetry verify <run-id>                  # re-checks the hash-chained ledger
cw telemetry verify <run-id> --pubkey pub.pem # also re-runs ed25519 signature checks
cw audit verify <run-id>                      # re-proves the trust-audit hash chain
```

More: `cw quickstart <app> --preview` (read-only dry run), `cw run resume <run-id> --drive`
(go on with a run that was stopped), `cw run inspect-archive <archive>` (integrity-check a
portable run archive without bringing it in).

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
  apps/workflow-app-framework-demo/app.json
  docs/index.md
  docs/getting-started.md
  docs/coordinator-blackboard.7.md
  docs/multi-agent-runtime-core.7.md
  docs/multi-agent-eval-replay-harness.7.md
  docs/dogfood-one-real-repo.7.md
  docs/release-and-migration.7.md
  docs/agent-framework.md
  docs/unix-principles.md
  docs/mcp-app-surface.7.md
  docs/operator-ux.7.md
  docs/workflow-app-framework.7.md
  docs/sandbox-profiles.7.md
  docs/candidate-scoring.7.md
  docs/verifier-gated-commit.7.md
  docs/run-registry-control-plane.7.md
  docs/execution-backends.7.md
```

## Commands

Installed via npm, the bin is `cw` (alias `cool-workflow`): e.g. `cw list`,
`cw quickstart …`. From a cloned source checkout, before `npm run build`, use the
matching `node scripts/cw.js <cmd>` form shown in the examples below.

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
node scripts/cw.js app show workflow-app-framework-demo
node scripts/cw.js app validate apps/workflow-app-framework-demo/app.json
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

Topology runs are kept under `.cw/runs/<run-id>/topologies/`, pointed to from
`state.json`, put into operator status and graph output, and counted in the
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

The first two commands make verifier-gated committed state. The last command
makes a clear non-gated checkpoint.

Render a report:

```bash
node scripts/cw.js report <run-id>
```

Look after runs across repos with the control plane (derived, fail-closed registry):

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
`--cwd` is left out.

Build the TypeScript runtime:

```bash
npm install --no-package-lock
npm run build
```

See [docs/agent-framework.md](docs/agent-framework.md) for the developer contract.
See [docs/index.md](docs/index.md) for a docs map.
See [docs/getting-started.md](docs/getting-started.md) for a clone-to-run path.
See [docs/release-and-migration.7.md](docs/release-and-migration.7.md) for
release and migration discipline.
See [docs/dogfood-one-real-repo.7.md](docs/dogfood-one-real-repo.7.md) for the
real-repository dogfood release proof.
See [docs/operator-ux.7.md](docs/operator-ux.7.md) for the operator command
surface.
See [docs/workflow-app-framework.7.md](docs/workflow-app-framework.7.md) for the app
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

Verification and synthesis tasks need a structured result block:

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

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a release gate that has no copies. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really do the work (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is not there to use. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, using the v0.1.23 eval harness again; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

start up an outside agent process per worker, catch result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable disk reclamation: `gc plan|run|verify` close up the audit skeleton, free the reconstructable/scratch bulk, and prove it by way of a hash-chained tombstone. Write-ahead + fail-closed (skeleton -> tombstone -> fsync -> free); clear capability downgrade (verify-only / re-runnable-by-reconstruction); CW never reclaims to start with.

## Durable State & Locking (v0.1.40)

every authoritative write is now atomic (temp -> rename, so a crash can never cut short state.json) with fsync-durability for the audit-essential stores; the cross-process read-modify-write stores (home queue, archive overlay, reclamation chain) are serialized by a portable stale-stealing file lock. Closes the architecture self-audit's non-atomic/unlocked P1 and pulls reclamation's result-node re-point inside the write-ahead boundary (durable persist + dangling-ref proof before any free) with a content-validated skeleton.

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

closes the v0.1.41 architecture self-audit's real findings and pays down its top maintainability debt. Hardening: evidence-gated commits now need GROUNDED locators (path/URL/namespace:value), not just presence, with opt-in `CW_REQUIRE_RESOLVABLE_EVIDENCE` on-disk resolution; the trust-audit event log is appended with fsync (durable like state.json); path containment is symlink-hardened (realpath of the deepest existing ancestor) across sandbox checks and reclamation proofs; worker ids are deterministic; coordinator secret redaction recurses. Maintainability: the `descriptor.id ===` switches in the execution backend are gone — drivers self-describe through a `registerBackend` registry — and the ~2100-line CoolWorkflowRunner god-object is broken up into per-domain operation modules under `src/orchestrator/`, leaving the runner a pure `loadRun -> delegate` router. Behavior-preserving (verified by adversarial review + full release:check).

## Robust Result Ingest (v0.1.42)

catch findings/evidence from any agent shape that makes sense (alt keys + prose), CW works out grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate stopping empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now validate the committed blob (`git show HEAD:<path>`) in place of the mutable working tree — doing away with false-red/false-green from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one shared way in to CW.

## Migration DAG (v0.1.45)

Puts in place of the linear migration chain a BFS graph path resolver (`findMigrationPath()`) over directed migration edges. Each `StateMigrationStep` carries an optional `reverse()` function, which makes rollback/downgrade paths possible by way of `reverseRunState()`.

## Capability Auto-Discovery (v0.1.46)

`registerCapability()` builder pattern takes the place of by-hand registry entries. Capabilities self-register at implementation sites by way of Map-based dedup; no need to touch `capability-registry.ts`. New capabilities call `registerCapability()` next to their entry function.

## Vendor-Adapter Registry (v0.1.47)

Data-driven manifest generation: vendor JSON shapes taken out of `gen-manifests.js` into declarative templates in `plugin.manifest.json`. A `_resolveTemplate()` engine works out `{{path.to.field}}` markers. Adding a new AI platform is pure data. Cross-vendor is proven by boot, not just by generation: `npm run manifest:load-check` (`node test/vendor-manifest-load-smoke.js`) loads every generated manifest (claude, codex, agents, gemini, opencode) and makes sure each shows the full tool surface (184 tools).

## P2 Fixes (v0.1.48)

State auto-compaction by way of `setPostSaveCallback()` hook — after every `saveCheckpoint()`, the orchestrator checks `computeStateSize()` and auto-starts compaction. Agent dedup docs, npm `ci` aggregate script.

## CI Content-Surface Fix (v0.1.49)

CHANGELOG.md and RELEASE.md are content surfaces checked by the dogfood-release gate. The bump-version script covers structured surfaces only; content surface updates are now written down as a release step.

## Auto-Compaction Fix (v0.1.50, v0.1.51)

Auto-compaction hook moved from `saveCheckpoint()` to clear `maybeCompactRun()` calls after big lifecycle mutations. Fixes test fixture fingerprint instability. Also fixes the dogfood-release version-sync pipeline: always use `npm run bump:version`, never hand-edit version.ts alone.

## Control-plane naming (v0.1.76)

Positioning consistency: every self-describing surface names CW an auditable workflow control-plane / Workflow App framework, not an "SDK" (which lives on only in the red-line disclaimer "embeds no model SDK").

## Workflow orchestration: Tracks 1–3 (v0.1.77)

The orchestration vision came in one release, all reviewer-gated:

- **Track 1 — telemetry attestation**: each agent's reported token usage is checked against an operator ed25519 trust key (`attested`/`unattested`/`absent`, shown loudly), recorded in a tamper-evident hash-chained ledger; opt-in `require-attested-telemetry` fails closed on usage it cannot check.
- **Track 2 — concurrent failure semantics**: a `parallel()` phase runs its agents at the same time with declared collapse rules — **collect-all** (a failing hop never stops siblings) and **kill-on-timeout** (a hung agent is killed at its deadline and counted as one failure). 16 agents with a forced hang + crash + dirty-return finish with no deadlock and a replay-complete record.
- **Track 3 — boundary contract**: per-task output `schema` validation (dependency-free, parks on mismatch), `limits.tokenBudget` made good against recorded usage, and the one-way executor boundary welded into the type layer (a callable crossing it fails `npm run build`).

## Working onboarding + npm distribution (v0.1.78)

`--agent-command builtin:claude` points to a bundled read-only claude wrapper that finishes workers with a real agent; the cross-directory quickstart crash is fixed; missing optional inputs no longer let `{{name}}` slip into prompts. Published to npm (`cool-workflow`, bins `cw`/`cool-workflow`) with LICENSE and metadata. Live dogfood proof committed under `docs/dogfood/`.

## Tamper-evidence demo (v0.1.79)

`cw demo tamper` — a hermetic, one-command proof that a recorded telemetry verdict cannot be faked without being caught: it builds a real ed25519-signed ledger, fakes it at the ledger layer (verdict flip + recomputed local hash → the chain still breaks) and the signature layer (inflated tokens, reused signature → ed25519 rejects), all checked offline with only the public key. `cw telemetry verify <run>` (`cw_telemetry_verify` on MCP) is the operator-facing re-proof: by default it recomputes the hash chain on disk so any later edit to a recorded verdict or usage digest is caught; add `--pubkey <pem-or-path>` to re-run each `attested` hop's ed25519 signature check against the stored raw usage too. What this does and does **not** prove — taking in the single-keyholder ceiling — is set down in a true way in [Trust Model & Limitations](docs/trust-model.md); read it before you put trust in a green verdict.

## Opt-in live agent output during a drive (on main, ships next)

Set `CW_AGENT_STREAM=1` to see each worker's live agent trace. The bundled claude wrapper (`builtin:claude` / `scripts/agents/claude-p-agent.js`) keeps the legacy `--output-format json` path by default; only the opt-in path runs claude in `--output-format stream-json` and renders a short human trace (tool uses, assistant text, per-turn summaries) to **stderr**. CW core sends that stderr on to the operator's terminal only when `CW_AGENT_STREAM=1`, CW's own stderr is a TTY, and `CW_NO_STREAM` is not set; piped/CI runs stay quiet (Rule of Silence). Core only sends the stream on, never reads it — vendor-specific rendering is the wrapper's business (policy), not the kernel's (mechanism).

v0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, Map and Assess results you can use again, wrapper metrics you can measure, a background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_This documentation tracks Cool Workflow v0.1.82. See [CHANGELOG](../../CHANGELOG.md) for the release notes._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

This release removes local user path text from saved release review input and adds a scan that keeps those words out of tracked files.

v0.1.85
