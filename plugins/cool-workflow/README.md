# Cool Workflow

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
