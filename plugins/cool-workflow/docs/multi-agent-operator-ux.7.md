# Multi-Agent Operator UX

CW v0.1.21 makes multi-agent operator inspection first-class. The feature is a
read-only userland view over existing run state. It does not create a hidden
dashboard database and does not infer success when evidence, dependency, or
lifecycle state is ambiguous.

The model is derived from:

- `WorkflowRun` tasks, dispatches, workers, nodes, feedback, candidates,
  selections, commits, and report paths
- multi-agent runs, roles, groups, memberships, fanouts, and fanins
- topology runs and their missing evidence/conflict records
- blackboard topics, messages, contexts, artifacts, snapshots, and coordinator
  decisions
- candidate score files, trust audit events, and verifier-gated commit records

## Operator Commands

Use the normal status and report commands for the broad view:

```bash
node scripts/cw.js status <run-id>
node scripts/cw.js graph <run-id>
node scripts/cw.js report <run-id> --show
```

Use the focused multi-agent views when the operator needs the process table:

```bash
node scripts/cw.js multi-agent status <run-id>
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js multi-agent dependencies <run-id>
node scripts/cw.js multi-agent failures <run-id>
node scripts/cw.js multi-agent evidence <run-id>
```

Every focused command supports deterministic JSON:

```bash
node scripts/cw.js multi-agent status <run-id> --json
node scripts/cw.js multi-agent dependencies <run-id> --json
node scripts/cw.js multi-agent failures <run-id> --format json
node scripts/cw.js multi-agent evidence <run-id> --json
```

The compact human output uses six stable panels:

```text
Agent Graph
Dependencies
Failed / Blocked Agents
Adopted Evidence
Missing Evidence
Next Action
```

## Graph

`multi-agent graph` shows the topology-backed agent graph plus downstream
acceptance records:

- MultiAgentRun, topology run, roles, groups, memberships, fanout, and fanin
- tasks, dispatches, workers, result nodes, and verifier gates
- blackboard topics, messages, artifacts, contexts, snapshots, and coordinator
  decisions
- candidates, score records, selections, verifier-gated commits, and feedback

Edges are labeled when the label carries operational meaning:

```text
owns
depends-on
dispatches
reports
cites
adopted-by
rejected-by
blocks
scores
selects
gates
commits
```

Direction follows the dependency or evidence flow. For example, a membership
depends on a task and worker, worker output reports into the membership,
blackboard artifacts are cited by fanin, scores evaluate candidates, selections
choose scored candidates, and commits record the selected verifier-gated result.

## Failures

`multi-agent failures` merges the records an operator normally has to inspect
one at a time:

- failed memberships and missing role coverage
- missing worker output and failed or rejected workers
- open feedback, including sandbox-policy failures
- fanin blocked reasons and missing blackboard evidence
- rejected or failed candidates
- score, selection, verifier, and commit-gate gaps
- ambiguous blocked dependencies

Each row includes the record id, kind, status, owner or role when known, linked
task/worker/membership/fanin/candidate when known, the exact reason, and the
next safe command.

## Evidence Adoption

`multi-agent evidence` explains why a result was accepted or not accepted. Each
row includes:

- evidence id/ref/path/locator
- source kind and source id
- adopted-by ids and rejected-by ids
- pending consumers
- candidate, score, selection, and commit links
- provenance or trust source when available
- status: `adopted`, `rejected`, `pending`, `superseded`, `conflicting`, or
  `missing`

An accepted path should be traceable like this:

```text
worker result -> blackboard artifact/message -> fanin -> candidate score
-> selection -> verifier-gated commit
```

When any link is missing, CW reports it as pending or missing and recommends the
next command rather than assuming the run is healthy.

## MCP Parity

MCP hosts can inspect the same derived data:

- `cw_multi_agent_status`
- `cw_multi_agent_graph`
- `cw_multi_agent_dependencies`
- `cw_multi_agent_failures`
- `cw_multi_agent_evidence`

`cw_multi_agent_status` preserves the v0.1.20 host envelope and adds the
derived operator model under `summaries.multiAgentOperator`.

## Example Trace

```bash
node scripts/cw.js multi-agent graph "$RUN"
node scripts/cw.js multi-agent dependencies "$RUN" --json
node scripts/cw.js multi-agent failures "$RUN"
node scripts/cw.js multi-agent evidence "$RUN"
node scripts/cw.js audit provenance "$RUN" --candidate "$CANDIDATE"
node scripts/cw.js commit "$RUN" --selection "$SELECTION" --reason "verified winner"
node scripts/cw.js report "$RUN" --show
```

The operator can start at an agent membership, follow `depends-on` to its task
and worker, follow `reports` to the blackboard artifact and fanin, follow
`scores` to the candidate score, follow `selects` to the selected result, and
follow `commits` to the verifier-gated state commit.

## Smoke Coverage

`test/multi-agent-operator-ux-smoke.js` creates a deterministic topology-backed
run with a successful worker evidence path, a failed worker path, blocked fanin
evidence, score and selection records, a verifier-gated commit, human CLI
assertions, JSON CLI assertions, MCP parity assertions, and report assertions.
It is included in `npm test` and `npm run release:check`.
