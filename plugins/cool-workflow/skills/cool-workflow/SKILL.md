---
name: cool-workflow
description: Use when the user asks for Cool Workflow, CW, Agent Workflow SDK, TypeScript workflow orchestration, phased multi-agent work, background workflow tasks, or reusable workflow apps.
---

# Cool Workflow

Cool Workflow is an Agent Workflow SDK. Use it to
turn broad tasks into a TypeScript/Node workflow platform run with phases, agent
task manifests, durable run state, and a final report.

## When To Use

Use this skill when the user asks for:

- `Cool Workflow` or `CW`
- Agent Workflow SDK
- TypeScript workflow runner/orchestration
- multi-agent phased work
- background task style planning
- reusable workflow apps/scripts
- architecture review workflows
- canonical workflow apps such as `architecture-review`, `pr-review-fix-ci`,
  `release-cut`, and `research-synthesis`

## Core Model

CW has three layers:

- Package: installable shared runtime.
- Skill: trigger and operating instructions for the agent host.
- TypeScript Node/Bun runtime: workflow definitions, state files, task queue,
  deterministic harness, verifier, commits, and reports.

Treat CW like a platform SDK. The runtime owns the contract, and developers
write workflow apps against it using `defineWorkflowApp`, `workflow`, `phase`,
`agent`, `artifact`, and `input`.

First-class workflow apps can live under `apps/<app-id>/app.json` with a
plain JavaScript workflow entrypoint. Legacy `workflows/*.workflow.js` factory
files remain valid and are wrapped as compatibility apps. The canonical app ids
are owned by app directories; legacy wrappers use explicit `legacy-*` ids when
needed to avoid duplicate discovery.

The runner does not directly spawn workers. It writes pending agent tasks to
`.cw/runs/<run-id>/tasks/*.md`. The agent host reads those tasks, spawns workers
when the user explicitly asks for agent/parallel/background work, then records
results with the runner.

v0.1.23 adds Multi-Agent Eval & Replay Harness. Use `eval snapshot`,
`eval replay`, `eval compare`, `eval score`, `eval gate`, and `eval report`
when a topology-backed multi-agent run needs release-gate evidence. Artifacts
live under `.cw/evals/<suite-id>/` as plain JSON plus `report.md`, and MCP
parity is available through `cw_eval_snapshot`, `cw_eval_replay`,
`cw_eval_compare`, `cw_eval_score`, `cw_eval_gate`, and `cw_eval_report`.

v0.1.22 adds Multi-Agent Trust / Policy / Audit over the existing trust-audit
layer. Use `audit multi-agent`, `audit policy`, `audit role`,
`audit blackboard`, and `audit judge` when an operator or host needs to inspect
role authority, message provenance, blackboard write decisions, judge
rationale, panel decisions, policy violations, and why a selected result is
trusted. Missing policy, missing evidence, missing provenance, and missing
judge rationale fail closed.

v0.1.21 adds Multi-Agent Operator UX over the high-level host loop. Use
`multi-agent graph`, `multi-agent dependencies`, `multi-agent failures`, and
`multi-agent evidence` when an operator or host needs to see who depends on
whom, who is blocked, and which evidence was adopted into the selected result.
The model is derived from WorkflowRun, topology, multi-agent, blackboard,
candidate, commit, feedback, and trust audit state; there is no hidden
dashboard state.

v0.1.20 adds the high-level Multi-Agent CLI + MCP host surface. Prefer
`multi-agent run -> status -> step -> blackboard -> score -> select` and the
matching MCP tools when an agent host needs to drive multi-agent work without
manual id plumbing. The surface wraps existing topology, multi-agent,
blackboard, candidate, commit, and audit primitives; it does not replace them.

v0.1.19 adds Multi-Agent Topologies as official userland recipes on top of the
process table and shared coordination filesystem. `map-reduce`, `debate`, and
`judge-panel` materialize ordinary MultiAgentRun, role, group, fanout/fanin,
blackboard topic/message/artifact, coordinator decision, candidate, commit, and
audit records. Topologies are deterministic recipes, not hidden autonomous
coordination.

v0.1.18 adds Coordinator / Blackboard as the shared coordination substrate:
durable blackboards, topics, messages, context frames, artifact refs,
snapshots, and coordinator decisions under `.cw/runs/<run-id>/blackboard/`.
It is the shared filesystem used by higher-level topologies.

v0.1.17 added first-class multi-agent runtime state around dispatches:
`MultiAgentRun`, `AgentRole`, `AgentGroup`, `AgentMembership`, `AgentFanout`,
and `AgentFanin`. CW records and validates this state; the host still executes
agents and enforces OS/process/network/environment controls. Invalid lifecycle
transitions, duplicate memberships, ambiguous dispatch attachment, and missing
fanin evidence fail closed.

## Operating Loop

1. Pick or create a workflow.
2. Run `node scripts/cw.js plan <workflow-id> ...` from the plugin root or use
   the absolute plugin script path.
3. Run `node scripts/cw.js dispatch <run-id> --limit N` to create a dispatch
   manifest for the current phase. Use `--sandbox <profile-id>` when the user
   or workflow needs an explicit worker policy profile.
4. If the user explicitly asked for agents, spawn one subagent per dispatched
   task with disjoint scopes.
5. Save each subagent summary to `.cw/runs/<run-id>/results/<task-id>.md`.
6. Run `node scripts/cw.js result <run-id> <task-id> <result-file>`.
7. When all required work is complete, run `node scripts/cw.js report <run-id>`.
8. Synthesize the final user-facing answer from the report and verified evidence.

## Commands

Use the plugin root when possible:

```bash
node scripts/cw.js list
node scripts/cw.js app list
node scripts/cw.js app show architecture-review
node scripts/cw.js app show pr-review-fix-ci
node scripts/cw.js app show release-cut
node scripts/cw.js app show research-synthesis
node scripts/cw.js app validate apps/architecture-review/app.json
node scripts/cw.js app show workflow-app-sdk-demo
node scripts/cw.js app validate apps/workflow-app-sdk-demo/app.json
node scripts/cw.js app validate end-to-end-golden-path
node scripts/cw.js app package workflow-app-sdk-demo
node scripts/cw.js app init my-app --title "My App"
npm run canonical-apps
npm run golden-path
node scripts/cw.js init my-workflow --title "My Workflow"
node scripts/cw.js plan architecture-review --repo /path/to/repo --question "Is this architecture sound?"
node scripts/cw.js status <run-id>
node scripts/cw.js status <run-id> --json
node scripts/cw.js graph <run-id>
node scripts/cw.js graph <run-id> --json
node scripts/cw.js dispatch <run-id> --limit 6
node scripts/cw.js dispatch <run-id> --sandbox readonly
node scripts/cw.js topology list
node scripts/cw.js topology show map-reduce
node scripts/cw.js topology validate map-reduce
node scripts/cw.js topology apply <run-id> map-reduce --task task-id --mapper-count 2
node scripts/cw.js topology summary <run-id>
node scripts/cw.js topology graph <run-id>
node scripts/cw.js multi-agent summary <run-id>
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js multi-agent dependencies <run-id>
node scripts/cw.js multi-agent failures <run-id>
node scripts/cw.js multi-agent evidence <run-id>
node scripts/cw.js multi-agent run <run-id> --topology judge-panel --task task-id
node scripts/cw.js multi-agent status <run-id>
node scripts/cw.js multi-agent step <run-id> --sandbox readonly
node scripts/cw.js multi-agent blackboard <run-id> summary
node scripts/cw.js multi-agent score <run-id> candidate-id --criterion correctness=1 --evidence ref
node scripts/cw.js multi-agent select <run-id> candidate-id --reason "verified winner"
node scripts/cw.js eval snapshot <run-id> --id suite-id
node scripts/cw.js eval replay .cw/evals/suite-id/snapshot.json
node scripts/cw.js eval compare .cw/evals/suite-id/snapshot.json .cw/evals/suite-id/replay-run.json
node scripts/cw.js eval score .cw/evals/suite-id/replay-run.json
node scripts/cw.js eval gate .cw/evals/suite-id
node scripts/cw.js eval report .cw/evals/suite-id/replay-run.json
node scripts/cw.js multi-agent run <run-id> --id ma --objective "coordinated work"
node scripts/cw.js multi-agent role <run-id> role --multi-agent-run ma --responsibility "do work" --required-evidence "result evidence"
node scripts/cw.js multi-agent group <run-id> group --multi-agent-run ma --task task-id
node scripts/cw.js multi-agent fanout <run-id> fanout --group group --reason "split work" --role role --task task-id
node scripts/cw.js dispatch <run-id> --multi-agent-run ma --multi-agent-group group --multi-agent-role role --multi-agent-fanout fanout
node scripts/cw.js multi-agent fanin <run-id> fanin --group group --fanout fanout --required-role role
node scripts/cw.js blackboard summary <run-id>
node scripts/cw.js blackboard topic create <run-id> --id topic --title "Shared context"
node scripts/cw.js blackboard message post <run-id> --topic topic --body "message"
node scripts/cw.js blackboard context put <run-id> --topic topic --kind fact --key finding --value "evidence-backed fact"
node scripts/cw.js blackboard artifact add <run-id> --topic topic --path /path/to/result.md --kind worker-result
node scripts/cw.js blackboard snapshot <run-id>
node scripts/cw.js coordinator summary <run-id>
node scripts/cw.js coordinator decision <run-id> --kind conflict-resolution --outcome accepted --reason "evidence supports this"
node scripts/cw.js sandbox list
node scripts/cw.js sandbox show readonly
node scripts/cw.js sandbox validate ./site-sandbox.json
node scripts/cw.js result <run-id> <task-id> /path/to/result.md
node scripts/cw.js commit <run-id> --verifier <node-id> --reason "verified result"
node scripts/cw.js commit <run-id> --selection <selection-id> --reason "verified winner"
node scripts/cw.js commit <run-id> --allow-unverified-checkpoint --reason "manual checkpoint"
node scripts/cw.js report <run-id>
node scripts/cw.js report <run-id> --show
node scripts/cw.js worker summary <run-id>
node scripts/cw.js candidate summary <run-id>
node scripts/cw.js feedback summary <run-id>
node scripts/cw.js commit summary <run-id>
node scripts/cw.js state check <run-id>
npm run fixture-compat
npm run eval:replay
npm run version:sync
npm run release:check
node scripts/cw.js loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule create --kind loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule due
node scripts/cw.js schedule daemon --once
node scripts/cw.js routine create --kind github --prompt "Handle this GitHub event."
node scripts/cw.js routine fire github payload.json
```

When installed from a GitHub package source, the host resolves the package root
from the source snapshot. When working in this repository, use:

```text
plugins/cool-workflow
```

Run data is written to `.cw/runs/<run-id>/` in `--cwd`, or in `--repo` when
`--cwd` is not provided.

The runtime source is TypeScript under `src/` and compiles to `dist/`.

Operator UX is human-readable by default for `status`, `graph`, report
`--show`/`--summary`, and resource `summary` commands. Use `--json` or
`--format json` when scripts or MCP-style integrations need structured output.
Status recommendations should be treated as deterministic hints, not hidden
automation.

When an MCP host is available, the same runtime surface is exposed with
JSON-first tools: `cw_app_run`, `cw_dispatch`, `cw_worker_manifest`,
`cw_worker_output`, `cw_candidate_register`, `cw_candidate_score`,
`cw_candidate_select`, `cw_commit`, `cw_operator_status`, `cw_operator_graph`,
`cw_operator_report`, `cw_topology_list`, `cw_topology_show`,
`cw_topology_validate`, `cw_topology_apply`, `cw_topology_summary`,
`cw_topology_graph`, `cw_multi_agent_summary`, `cw_multi_agent_graph`,
`cw_multi_agent_dependencies`, `cw_multi_agent_failures`,
`cw_multi_agent_evidence`,
`cw_multi_agent_run`, `cw_multi_agent_status`, `cw_multi_agent_step`,
`cw_multi_agent_blackboard`, `cw_multi_agent_score`, `cw_multi_agent_select`,
`cw_multi_agent_run_create`, `cw_multi_agent_role_create`,
`cw_multi_agent_group_create`, `cw_multi_agent_membership_create`,
`cw_multi_agent_fanout_create`, `cw_multi_agent_fanin_collect`,
`cw_eval_snapshot`, `cw_eval_replay`, `cw_eval_compare`, `cw_eval_score`,
`cw_eval_gate`, `cw_eval_report`, `cw_blackboard_summary`, `cw_blackboard_context_put`,
`cw_blackboard_artifact_add`, and `cw_coordinator_decision`. Preserve CLI/MCP
parity when extending CW.

Use `npm run canonical-apps` from `plugins/cool-workflow` to validate and plan
the official app matrix without network access:

```text
architecture-review
pr-review-fix-ci
release-cut
research-synthesis
```

Use `npm run golden-path` from `plugins/cool-workflow` as the release regression
for the full public chain:

```text
workflow app -> plan -> dispatch -> isolated worker -> candidate scoring
-> verifier -> gated commit -> report
```

The golden path uses a temporary workspace, writes a simulated worker
`cw:result` to the worker manifest's declared `result.md`, and asserts durable
state files instead of relying only on exit codes.

Use `npm run dogfood:release` for v0.1.16+ real-repository release dogfooding.
It runs the canonical `release-cut` app against the current Cool Workflow repo
in dry-run mode, records real command logs through CW worker outputs, scores and
selects a release candidate only with verifier evidence, creates a
verifier-gated CW state commit or held checkpoint, and writes
`.cw/runs/<run-id>/dogfood-summary.json`.

Use `npm run release:check` for v0.1.15+ release discipline. It is a dry-run
gate that builds, type-checks, runs tests, validates canonical apps and golden
path behavior, checks old run fixtures, runs multi-agent runtime, topology,
CLI/MCP host-surface, operator-UX, trust/audit, and eval/replay smoke coverage,
runs dogfood smoke coverage, verifies version synchronization, and does not
tag, push, publish, or mutate fixtures.

Durable run state lives at `.cw/runs/<run-id>/state.json`. Use
`node scripts/cw.js state check <run-id>` to dry-run migration and
normalization. Newer unsupported schemas fail closed; unknown user data should
be preserved.

Sandbox Profiles are named CW policy contracts. They describe worker read
paths, write paths, command policy, network policy, environment exposure, and
host enforcement requirements. CW enforces profile validation and worker result
acceptance; the agent host enforces OS/process/network/environment controls.
Inspect profile state with `worker manifest <run-id> <worker-id>`.

CW records the model loop explicitly as:

```text
interpret -> act -> observe -> adjust -> checkpoint
```

Use this loop to explain workflow progress when reporting status to the user.

## Scheduled Tasks

CW supports loop, cron, and reminder schedules in `.cw/schedules/tasks.json`.
Use `schedule due` to find due work and `schedule complete <id>` after the due
prompt has been handled. Use `schedule daemon` for local desktop-style due
scanning. Use `routine create` and `routine fire` for API/GitHub trigger events.

## Multi-Agent Rule

Only spawn workers when the user explicitly asks for agents, delegation,
parallel work, or background work. If the user does not ask for agents, run the
phases locally in the main thread and still use CW state/report files when
helpful.

## Result Quality

Subagent results should be concise, evidence-based, and ready for synthesis.
Avoid raw logs unless they are the evidence. Use absolute file paths and line
numbers when referencing local code.

Verification and verdict tasks must include a `cw:result` JSON fence with
`findings` and `evidence`. CW rejects P0/P1/P2 findings without evidence.
