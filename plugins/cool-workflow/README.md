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

**[Start Here](#start-here)** · [Quickstart](#quickstart) · [Developer Loop](#developer-loop) · [Commands](#commands) · [Release History](docs/release-history.md)

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

## Start Here

Use the short path first. The long notes below are history and deep reference,
not the first run.

```bash
cw demo tamper
cw doctor --onramp
cw quickstart architecture-review --check --repo /path/to/repo \
  --question "What are the main risks?" --agent-command builtin:claude
cw quickstart architecture-review --repo /path/to/repo \
  --question "What are the main risks?" --agent-command builtin:claude --bundle
cw report verify-bundle report.cwrun.json
```

For source work, keep the loop small:

```bash
npm run build
node test/<nearest-smoke>.js
npm run test:fast
```

Run `npm run release:check` only when the batch is ready for the full gate. Start
with `quickstart` and `report` before the multi-agent pages.

For the full capability and release history, see [docs/release-history.md](docs/release-history.md).
This README tracks CW v0.1.85.

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

Add `--bundle` when the report has to go to someone else; then check the file
offline with `cw report verify-bundle report.cwrun.json`.

CW DELEGATES worker execution to your own agent. With no `--agent-command` (or
`CW_AGENT_COMMAND`) the drive fails closed (status `blocked`) — it never makes up a
result. `--agent-command builtin:claude` points to a bundled read-only `claude -p`
wrapper (needs `claude` on your PATH). `--agent-command builtin:codex` points to
the bundled read-only Codex wrapper (needs `codex` on your PATH). With
`CW_AGENT_STREAM=1`, both wrappers can show a live stderr trace while stdout stays
the kept data channel.

**Re-prove a finished run, offline** (`cw` is the installed bin; or `npx cool-workflow <cmd>`):

```bash
cw telemetry verify <run-id>                  # re-checks the hash-chained ledger
cw telemetry verify <run-id> --pubkey pub.pem # also re-runs ed25519 signature checks
cw audit verify <run-id>                      # re-proves the trust-audit hash chain
```

More: `cw quickstart <app> --preview` (read-only dry run), `cw run resume <run-id> --drive`
(go on with a run that was stopped), `cw run inspect-archive <archive>` (integrity-check a
portable run archive without bringing it in).

## Developer Loop

Use the shortest check that fits the change:

```bash
npm run build
node test/<nearest-smoke>.js
npm run test:fast
```

For a source checkout, `cw doctor --onramp --changed-from origin/main` gives the
nearest smoke tests and release gate commands for the current change. Before a
release, run `npm run release:check`.

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

v0.1.86
