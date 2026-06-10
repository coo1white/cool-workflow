# Cool Workflow — Command & MCP Reference

Full CLI catalog and the matching MCP tool surface. The `SKILL.md` body covers
the operating loop and the handful of commands you need most; come here when you
need the exact invocation for a specific capability.

Run CLI commands from the plugin root (`plugins/cool-workflow`) or with the
absolute plugin script path. Run data is written to `.cw/runs/<run-id>/` under
`--cwd`, or under `--repo` when `--cwd` is not given.

## Contents

- [Discovery & apps](#discovery--apps)
- [Plan / dispatch / result / report](#plan--dispatch--result--report)
- [Topologies](#topologies)
- [Multi-agent host surface](#multi-agent-host-surface)
- [Multi-agent low-level state](#multi-agent-low-level-state)
- [Eval & replay](#eval--replay)
- [Blackboard & coordinator](#blackboard--coordinator)
- [Sandbox profiles](#sandbox-profiles)
- [Commit, state & summaries](#commit-state--summaries)
- [Scheduling & routines](#scheduling--routines)
- [Release & maintenance npm scripts](#release--maintenance-npm-scripts)
- [MCP tools](#mcp-tools)

## Discovery & apps

```bash
node scripts/cw.js list
node scripts/cw.js app list
node scripts/cw.js app show architecture-review
node scripts/cw.js app show pr-review-fix-ci
node scripts/cw.js app show release-cut
node scripts/cw.js app show research-synthesis
node scripts/cw.js app validate apps/architecture-review/app.json
node scripts/cw.js app show workflow-app-framework-demo
node scripts/cw.js app validate apps/workflow-app-framework-demo/app.json
node scripts/cw.js app validate end-to-end-golden-path
node scripts/cw.js app package workflow-app-framework-demo
node scripts/cw.js app init my-app --title "My App"
node scripts/cw.js init my-workflow --title "My Workflow"
```

The canonical app ids are `architecture-review`, `pr-review-fix-ci`,
`release-cut`, and `research-synthesis`. First-class apps live under
`apps/<app-id>/app.json`; legacy `workflows/*.workflow.js` factories remain valid
and are wrapped as compatibility apps with explicit `legacy-*` ids.

## Plan / dispatch / result / report

```bash
node scripts/cw.js plan architecture-review --repo /path/to/repo --question "Is this architecture sound?"
node scripts/cw.js status <run-id>
node scripts/cw.js status <run-id> --json
node scripts/cw.js graph <run-id>
node scripts/cw.js graph <run-id> --json
node scripts/cw.js dispatch <run-id> --limit 6
node scripts/cw.js dispatch <run-id> --sandbox readonly
node scripts/cw.js result <run-id> <task-id> /path/to/result.md
node scripts/cw.js report <run-id>
node scripts/cw.js report <run-id> --show
```

Operator UX is human-readable by default for `status`, `graph`, report
`--show`/`--summary`, and resource `summary` commands. Use `--json` or
`--format json` when scripts or MCP-style integrations need structured output.
Status recommendations are deterministic hints, not hidden automation.

## Topologies

Official userland recipes on top of the process table and shared coordination
filesystem. `map-reduce`, `debate`, and `judge-panel` materialize ordinary run,
role, group, fanout/fanin, blackboard, coordinator, candidate, commit, and audit
records — deterministic recipes, not hidden autonomous coordination.

```bash
node scripts/cw.js topology list
node scripts/cw.js topology show map-reduce
node scripts/cw.js topology validate map-reduce
node scripts/cw.js topology apply <run-id> map-reduce --task task-id --mapper-count 2
node scripts/cw.js topology summary <run-id>
node scripts/cw.js topology graph <run-id>
```

## Multi-agent host surface

Prefer this high-level surface (`run -> status -> step -> blackboard -> score ->
select`) when an agent host needs to drive multi-agent work without manual id
plumbing. It wraps the topology, multi-agent, blackboard, candidate, commit, and
audit primitives; it does not replace them.

```bash
node scripts/cw.js multi-agent run <run-id> --topology judge-panel --task task-id
node scripts/cw.js multi-agent status <run-id>
node scripts/cw.js multi-agent step <run-id> --sandbox readonly
node scripts/cw.js multi-agent blackboard <run-id> summary
node scripts/cw.js multi-agent score <run-id> candidate-id --criterion correctness=1 --evidence ref
node scripts/cw.js multi-agent select <run-id> candidate-id --reason "verified winner"
```

Operator views (who depends on whom, who is blocked, which evidence was adopted):

```bash
node scripts/cw.js multi-agent summary <run-id>
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js multi-agent dependencies <run-id>
node scripts/cw.js multi-agent failures <run-id>
node scripts/cw.js multi-agent evidence <run-id>
```

State Explosion Management — when a run grows too large to read, use derived,
provenance-backed digests (they never delete raw records and fail closed when
stale; every synthetic node carries source ids and an expansion command):

```bash
node scripts/cw.js summary refresh <run-id>
node scripts/cw.js summary show <run-id>
node scripts/cw.js blackboard summarize <run-id>
node scripts/cw.js multi-agent summarize <run-id>
node scripts/cw.js multi-agent graph <run-id> --view compact|critical-path|failures|... [--focus <id>] [--depth <n>]
```

Trust / Policy / Audit — inspect role authority, message provenance, blackboard
write decisions, judge rationale, panel decisions, and why a result is trusted
(missing policy/evidence/provenance/rationale fail closed):

```bash
node scripts/cw.js audit multi-agent <run-id>
node scripts/cw.js audit policy <run-id>
node scripts/cw.js audit role <run-id>
node scripts/cw.js audit blackboard <run-id>
node scripts/cw.js audit judge <run-id>
```

## Multi-agent low-level state

First-class runtime state around dispatches (`MultiAgentRun`, `AgentRole`,
`AgentGroup`, `AgentMembership`, `AgentFanout`, `AgentFanin`). CW records and
validates this state; the host still executes agents. Invalid lifecycle
transitions, duplicate memberships, ambiguous dispatch attachment, and missing
fanin evidence fail closed.

```bash
node scripts/cw.js multi-agent run <run-id> --id ma --objective "coordinated work"
node scripts/cw.js multi-agent role <run-id> role --multi-agent-run ma --responsibility "do work" --required-evidence "result evidence"
node scripts/cw.js multi-agent group <run-id> group --multi-agent-run ma --task task-id
node scripts/cw.js multi-agent fanout <run-id> fanout --group group --reason "split work" --role role --task task-id
node scripts/cw.js dispatch <run-id> --multi-agent-run ma --multi-agent-group group --multi-agent-role role --multi-agent-fanout fanout
node scripts/cw.js multi-agent fanin <run-id> fanin --group group --fanout fanout --required-role role
```

## Eval & replay

Use when a topology-backed multi-agent run needs release-gate evidence.
Artifacts live under `.cw/evals/<suite-id>/` as plain JSON plus `report.md`.

```bash
node scripts/cw.js eval snapshot <run-id> --id suite-id
node scripts/cw.js eval replay .cw/evals/suite-id/snapshot.json
node scripts/cw.js eval compare .cw/evals/suite-id/snapshot.json .cw/evals/suite-id/replay-run.json
node scripts/cw.js eval score .cw/evals/suite-id/replay-run.json
node scripts/cw.js eval gate .cw/evals/suite-id
node scripts/cw.js eval report .cw/evals/suite-id/replay-run.json
```

## Blackboard & coordinator

The shared coordination substrate: durable blackboards, topics, messages,
context frames, artifact refs, snapshots, and coordinator decisions under
`.cw/runs/<run-id>/blackboard/`.

```bash
node scripts/cw.js blackboard summary <run-id>
node scripts/cw.js blackboard topic create <run-id> --id topic --title "Shared context"
node scripts/cw.js blackboard message post <run-id> --topic topic --body "message"
node scripts/cw.js blackboard context put <run-id> --topic topic --kind fact --key finding --value "evidence-backed fact"
node scripts/cw.js blackboard artifact add <run-id> --topic topic --path /path/to/result.md --kind worker-result
node scripts/cw.js blackboard snapshot <run-id>
node scripts/cw.js coordinator summary <run-id>
node scripts/cw.js coordinator decision <run-id> --kind conflict-resolution --outcome accepted --reason "evidence supports this"
```

## Sandbox profiles

Named CW policy contracts describing worker read paths, write paths, command
policy, network policy, environment exposure, and host enforcement requirements.
CW enforces profile validation and worker result acceptance; the agent host
enforces OS/process/network/environment controls.

```bash
node scripts/cw.js sandbox list
node scripts/cw.js sandbox show readonly
node scripts/cw.js sandbox validate ./site-sandbox.json
node scripts/cw.js worker manifest <run-id> <worker-id>
```

## Commit, state & summaries

Durable run state lives at `.cw/runs/<run-id>/state.json`. `state check`
dry-runs migration and normalization; newer unsupported schemas fail closed and
unknown user data is preserved.

```bash
node scripts/cw.js commit <run-id> --verifier <node-id> --reason "verified result"
node scripts/cw.js commit <run-id> --selection <selection-id> --reason "verified winner"
node scripts/cw.js commit <run-id> --allow-unverified-checkpoint --reason "manual checkpoint"
node scripts/cw.js worker summary <run-id>
node scripts/cw.js candidate summary <run-id>
node scripts/cw.js feedback summary <run-id>
node scripts/cw.js commit summary <run-id>
node scripts/cw.js state check <run-id>
```

## Scheduling & routines

CW supports loop, cron, and reminder schedules in `.cw/schedules/tasks.json`.
Use `schedule due` to find due work and `schedule complete <id>` after the due
prompt is handled. `routine create`/`routine fire` handle API/GitHub trigger
events.

```bash
node scripts/cw.js loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule create --kind loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule due
node scripts/cw.js schedule daemon --once
node scripts/cw.js routine create --kind github --prompt "Handle this GitHub event."
node scripts/cw.js routine fire github payload.json
```

## Release & maintenance npm scripts

```bash
npm run canonical-apps   # validate + plan the official app matrix (no network)
npm run golden-path      # release regression for the full public chain
npm run dogfood:release  # real-repo release-cut dry-run against this repo
npm run fixture-compat   # check old run fixtures still load
npm run eval:replay      # deterministic multi-agent eval/replay harness
npm run version:sync     # verify version synchronization across surfaces
npm run release:check    # dry-run release gate (build, types, tests, replay, dogfood)
```

`golden-path` exercises `workflow app -> plan -> dispatch -> isolated worker ->
candidate scoring -> verifier -> gated commit -> report`, writing a simulated
worker `cw:result` and asserting durable state files rather than exit codes.
`release:check` does not tag, push, publish, or mutate fixtures.

## MCP tools

When an MCP host is available, the same runtime surface is exposed with
JSON-first tools. **Preserve CLI/MCP parity when extending CW** — every CLI
capability must have a matching MCP tool and vice versa.

`cw_app_run`, `cw_dispatch`, `cw_worker_manifest`, `cw_worker_output`,
`cw_candidate_register`, `cw_candidate_score`, `cw_candidate_select`,
`cw_commit`, `cw_operator_status`, `cw_operator_graph`, `cw_operator_report`,
`cw_topology_list`, `cw_topology_show`, `cw_topology_validate`,
`cw_topology_apply`, `cw_topology_summary`, `cw_topology_graph`,
`cw_multi_agent_summary`, `cw_multi_agent_graph`, `cw_multi_agent_dependencies`,
`cw_multi_agent_failures`, `cw_multi_agent_evidence`, `cw_multi_agent_run`,
`cw_multi_agent_status`, `cw_multi_agent_step`, `cw_multi_agent_blackboard`,
`cw_multi_agent_score`, `cw_multi_agent_select`, `cw_multi_agent_run_create`,
`cw_multi_agent_role_create`, `cw_multi_agent_group_create`,
`cw_multi_agent_membership_create`, `cw_multi_agent_fanout_create`,
`cw_multi_agent_fanin_collect`, `cw_eval_snapshot`, `cw_eval_replay`,
`cw_eval_compare`, `cw_eval_score`, `cw_eval_gate`, `cw_eval_report`,
`cw_blackboard_summary`, `cw_blackboard_context_put`,
`cw_blackboard_artifact_add`, `cw_coordinator_decision`, `cw_summary_refresh`,
`cw_summary_show`, `cw_blackboard_summarize`, `cw_multi_agent_summarize`, and
`cw_multi_agent_graph_compact`.
