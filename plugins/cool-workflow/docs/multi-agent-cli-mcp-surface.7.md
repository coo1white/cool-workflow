# Multi-Agent CLI + MCP Surface

CW v0.1.20 adds the preferred host-facing control loop for multi-agent work:

```text
multi-agent run -> status -> step -> blackboard -> score -> select
```

CW v0.1.25 extends this surface with State Explosion Management commands:
`summary refresh`, `summary show`, `blackboard summarize`,
`multi-agent summarize`, and `multi-agent graph --view <view>` (with optional
`--focus <id>` and `--depth <n>`). Matching MCP tools are `cw_summary_refresh`,
`cw_summary_show`, `cw_blackboard_summarize`, `cw_multi_agent_summarize`, and
`cw_multi_agent_graph_compact`. All responses keep source refs and expansion
hints. See [state-explosion-management.7.md](state-explosion-management.7.md).

CW v0.1.26 adds `multi-agent reasoning <run-id> [--evidence <id>] [--refresh]`
(MCP: `cw_evidence_reasoning`, `cw_evidence_reasoning_refresh`), which explains
*why* each evidence item was adopted, and an additive `rationaleStatus` field on
`multi-agent evidence` rows. See
[evidence-adoption-reasoning-chain.7.md](evidence-adoption-reasoning-chain.7.md).

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
node scripts/cw.js multi-agent status <run-id> --json
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

## Operator Inspection

v0.1.21 extends the host loop with focused operator commands:

```bash
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js multi-agent dependencies <run-id>
node scripts/cw.js multi-agent failures <run-id>
node scripts/cw.js multi-agent evidence <run-id>
```

The human output is compact and operational: agent graph, dependencies, failed
or blocked agents, adopted evidence, missing evidence, and the next action.
Use `--json` or `--format json` for deterministic script output.

## MCP Tools

MCP hosts should prefer:

- `cw_multi_agent_run`
- `cw_multi_agent_status`
- `cw_multi_agent_step`
- `cw_multi_agent_blackboard`
- `cw_multi_agent_score`
- `cw_multi_agent_select`
- `cw_multi_agent_graph`
- `cw_multi_agent_dependencies`
- `cw_multi_agent_failures`
- `cw_multi_agent_evidence`

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
- combined topology, multi-agent, multi-agent operator, blackboard, worker,
  candidate, feedback, commit, and audit summaries

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

`test/multi-agent-operator-ux-smoke.js` covers the v0.1.21 graph,
dependencies, failures, evidence adoption, report output, and MCP parity.

`test/multi-agent-trust-policy-audit-smoke.js` covers the v0.1.22
role-policy, blackboard-write, message-provenance, judge-rationale,
policy-violation, report, audit provenance, and MCP parity surface.

`test/multi-agent-eval-replay-harness-smoke.js` covers the v0.1.24 eval/replay
commands and MCP tools: snapshot, replay, compare, score, gate, report, and
controlled regression detection.
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

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now validate the committed blob (`git show HEAD:<path>`) instead of the mutable working tree — eliminating false-red/false-green from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter giving any non-Claude AI agent one common interface to CW.
