# Multi-Agent Operator UX

CW v0.1.21 makes multi-agent operator inspection first-class. The feature is a
read-only userland view over existing run state. It does not create a hidden
dashboard database and does not infer success when evidence, dependency, or
lifecycle state is ambiguous.
CW v0.1.22 adds trust panels to the same operator path so role policy,
permission decisions, blackboard write audit, message provenance, judge
rationale, panel decisions, and policy violations are visible beside topology
and evidence state.
CW v0.1.24 uses the same operator-derived graph, dependency, failure, evidence,
trust, and report views as replay comparison inputs for the Multi-Agent Eval &
Replay Harness.
CW v0.1.25 layers State Explosion Management on top of these operator views: when
a run grows large, `summary show`, `multi-agent summarize`, and
`multi-agent graph --view compact` collapse high-volume records into synthetic
summary nodes while preserving the critical path, failures, missing evidence,
policy violations, and judge rationale. See
[state-explosion-management.7.md](state-explosion-management.7.md).

CW v0.1.26 adds the `Adoption Rationale` panel and the `multi-agent reasoning`
view, which explains *why* each evidence item was adopted. Reasoning steps are on
the critical path and are never collapsed by compaction. See
[evidence-adoption-reasoning-chain.7.md](evidence-adoption-reasoning-chain.7.md).

CW v0.1.27 adds an additive evidence `disposition` (`adopted` | `inspectable` |
`blocking`) and an `inspectableEvidence` list. The raw `status` (the adoption
state) is unchanged; `disposition` is the operator-facing reading of it. Before a
verifier-gated commit, a missing/pending row genuinely blocks. After a
verifier-gated commit the selected path is decided, so missing/pending evidence
for sibling roles that were never driven as separate workers — for example
undriven judge-panel judges — is inspectable operator state, not a hidden
failure. The `multi-agent status` "Missing Evidence" header and the `status`
panel report the blocking-vs-inspectable split so the operator is not misled.

The model is derived from:

- `WorkflowRun` tasks, dispatches, workers, nodes, feedback, candidates,
  selections, commits, and report paths
- multi-agent runs, roles, groups, memberships, fanouts, and fanins
- topology runs and their missing evidence/conflict records
- blackboard topics, messages, contexts, artifacts, snapshots, and coordinator
  decisions
- candidate score files, trust audit events, and verifier-gated commit records
- role policy, blackboard provenance, judge rationale, panel decisions, and
  policy violation audit records

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
## CLI ↔ MCP Parity (v0.1.27)

Every command and tool referenced above is declared in the v0.1.27 capability
registry (`src/capability-registry.ts`) and validated by `npm run parity:check`,
so `cw <cmd> --json` and the matching `cw_<tool>` result render one data source.
See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).

## Run Registry / Control Plane (v0.1.28)

The runs described here are indexed, searchable, resumable, archivable, and
rerunnable across repos by the v0.1.28 Run Registry / Control Plane, which derives
a fingerprinted, fail-closed index over the same per-run `.cw/runs/<id>/state.json`
source of truth. See [run-registry-control-plane.7.md](run-registry-control-plane.7.md).

## Execution Backends (v0.1.29)

v0.1.29 lifts execution into a pluggable driver layer: one narrow `ExecutionBackend`
contract with interchangeable `node`/`bun`/`shell`/`container`/`remote`/`ci`
drivers, selected by `--backend` (parallel to `--sandbox`) and inspected via
`backend list|show|probe`. The result/evidence envelope is schema-identical across
backends; the backend id + sandbox attestation are recorded as provenance, so this
surface is unchanged regardless of which backend executed a run. See
[execution-backends.7.md](execution-backends.7.md).
## Web / Desktop Workbench (v0.1.30)

v0.1.30 adds the Web / Desktop Workbench: a read-only, localhost-only human
console that renders this surface (and the other four operator panels — run
graph, blackboard, worker logs, candidate compare, audit timeline) for any run,
reading the SAME capability `--json` payloads. It is a THIRD FRONT DOOR alongside
the CLI and MCP that holds no authoritative state and forks no schema: each panel
equals its `cw <cmd> --json` payload byte-for-byte (parity-gated), and refresh
re-derives everything from disk. See
[web-desktop-workbench.7.md](web-desktop-workbench.7.md).

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
derive durations, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and host-attested token/cost from existing durable run state
— no metrics database, no collector daemon, no hidden counter. Usage is additive
and optional (absent ⇒ `unreported`, never 0); cost is `attested` (attested usage
× a recorded pricing policy) or clearly `estimated`, with pricing as policy. Both
verbs are parity-gated and render read-only in the v0.1.30 Workbench. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).


## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — required approvals from
authorized roles, enforced inside `resolveCommitGate` AFTER the verifier checks
and never instead of them, failing closed on quorum/authority/self-approval and
recording who approved the very artifact that shipped. Policy (required approvals,
authorized roles, self-approval) is data, default off (pre-v0.1.32 behavior
unchanged). The verbs are parity-gated and render read-only in the v0.1.30
Workbench. See [Team Collaboration](team-collaboration.7.md).

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

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the reconstructable bulk, prove it
