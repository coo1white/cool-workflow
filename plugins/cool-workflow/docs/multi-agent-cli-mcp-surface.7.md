# Multi-Agent CLI + MCP Surface

CW v0.1.20 adds the preferred host-facing control loop for multi-agent work:

```text
multi-agent run -> status -> step -> blackboard -> score -> select
```

This is userland over the existing kernel records. The low-level topology,
multi-agent, blackboard, candidate, audit, and commit primitives remain
available, but agent hosts should use this high-level surface when driving a
run.

## CLI Loop

Create or attach a topology-backed run without spawning workers:

```bash
node scripts/cw.js multi-agent run <run-id> --topology judge-panel --task <task-id>
node scripts/cw.js multi-agent run --app architecture-review --repo /path/to/repo --question "Review this" --topology map-reduce
```

Read the combined host status:

```bash
node scripts/cw.js multi-agent status <run-id>
```

Perform one deterministic step at a time:

```bash
node scripts/cw.js multi-agent step <run-id> --sandbox readonly
```

`step` may create a dispatch manifest, collect fanin, snapshot the blackboard,
register a candidate, score a candidate with existing verifier evidence, select
a scored candidate, or recommend the verifier-gated commit command. It never
spawns agents directly.

Work with the active blackboard when it is unambiguous:

```bash
node scripts/cw.js multi-agent blackboard <run-id> summary
node scripts/cw.js multi-agent blackboard <run-id> topics
node scripts/cw.js multi-agent blackboard <run-id> post --topic <topic-id> --body "finding" --evidence <ref>
node scripts/cw.js multi-agent blackboard <run-id> add-artifact --topic <topic-id> --kind worker-result --path result.md
node scripts/cw.js multi-agent blackboard <run-id> snapshot
```

Score and select explicitly:

```bash
node scripts/cw.js multi-agent score <run-id> <candidate-id> --criterion correctness=1 --criterion evidence=1 --evidence <ref>
node scripts/cw.js multi-agent select <run-id> <candidate-id> --score <score-id> --reason "verifier-backed candidate"
node scripts/cw.js commit <run-id> --selection <selection-id> --reason "verified winner"
```

## MCP Tools

MCP hosts should prefer:

- `cw_multi_agent_run`
- `cw_multi_agent_status`
- `cw_multi_agent_step`
- `cw_multi_agent_blackboard`
- `cw_multi_agent_score`
- `cw_multi_agent_select`

The older `cw_multi_agent_*`, `cw_topology_*`, `cw_blackboard_*`, and
`cw_candidate_*` tools remain advanced primitives.

## Stable Responses

Every high-level response is JSON and includes:

- `runId`
- active topology and multi-agent ids
- blackboard and topic ids
- candidate, selection, commit, and audit ids
- `state`, `performed`, `nextAction`, and `nextActions`
- `blockedReasons`, `requiredHostAction`, and `evidenceRequirements`
- state, report, blackboard, audit, ranking, worker manifest, and result paths
- combined topology, multi-agent, blackboard, worker, candidate, feedback,
  commit, and audit summaries

## Fail-Closed Rules

The host surface fails closed when:

- active topology or blackboard state is ambiguous
- a fanout has incomplete role coverage
- worker output has not been recorded
- fanin lacks required evidence or blackboard links
- score evidence is missing
- selection lacks score or verifier readiness
- a verifier-gated commit is not ready

## Smoke Coverage

`test/multi-agent-cli-mcp-surface-smoke.js` covers the full host loop over the
official `judge-panel` topology, CLI and MCP parity, ambiguous topology
failure, missing evidence failure, successful score/select, blackboard
artifact/message linkage, audit provenance, and Operator UX next actions. It is
included in `npm test` and `npm run release:check`.
