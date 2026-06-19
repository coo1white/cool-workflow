# Multi-Agent CLI + MCP Surface

CW v0.1.20 adds the best host-facing control loop for multi-agent work:

```text
multi-agent run -> status -> step -> blackboard -> score -> select
```

CW v0.1.25 extends this surface with State Explosion Management commands:
`summary refresh`, `summary show`, `blackboard summarize`,
`multi-agent summarize`, and `multi-agent graph --view <view>` (with optional
`--focus <id>` and `--depth <n>`). Matching MCP tools are `cw_summary_refresh`,
`cw_summary_show`, `cw_blackboard_summarize`, `cw_multi_agent_summarize`, and
`cw_multi_agent_graph_compact`. All responses keep source refs and hints for how
to open them up. See [state-explosion-management.7.md](state-explosion-management.7.md).

CW v0.1.26 adds `multi-agent reasoning <run-id> [--evidence <id>] [--refresh]`
(MCP: `cw_evidence_reasoning`, `cw_evidence_reasoning_refresh`), which makes clear
*why* each evidence item was taken in, and an added `rationaleStatus` field on
`multi-agent evidence` rows. See
[evidence-adoption-reasoning-chain.7.md](evidence-adoption-reasoning-chain.7.md).

This is userland over the kernel records that are already there. The low-level
topology, multi-agent, blackboard, candidate, audit, and commit primitives are
still there to use, but agent hosts should use this high-level surface when they
drive a run.

## CLI Loop

Make or join a topology-backed run without starting up workers:

```bash
node scripts/cw.js multi-agent run <run-id> --topology judge-panel --task <task-id>
node scripts/cw.js multi-agent run --app architecture-review --repo /path/to/repo --question "Review this" --topology map-reduce
```

Read the joined host status:

```bash
node scripts/cw.js multi-agent status <run-id>
node scripts/cw.js multi-agent status <run-id> --json
```

Do one deterministic step at a time:

```bash
node scripts/cw.js multi-agent step <run-id> --sandbox readonly
```

`step` may make a dispatch manifest, get fanin, snapshot the blackboard,
register a candidate, score a candidate with verifier evidence that is already
there, select a scored candidate, or put forward the verifier-gated commit
command. It never starts up agents on its own.

Work with the active blackboard when it is clear which one it is:

```bash
node scripts/cw.js multi-agent blackboard <run-id> summary
node scripts/cw.js multi-agent blackboard <run-id> topics
node scripts/cw.js multi-agent blackboard <run-id> post --topic <topic-id> --body "finding" --evidence <ref>
node scripts/cw.js multi-agent blackboard <run-id> add-artifact --topic <topic-id> --kind worker-result --path result.md
node scripts/cw.js multi-agent blackboard <run-id> snapshot
```

Score and select in a clear way:

```bash
node scripts/cw.js multi-agent score <run-id> <candidate-id> --criterion correctness=1 --criterion evidence=1 --evidence <ref>
node scripts/cw.js multi-agent select <run-id> <candidate-id> --score <score-id> --reason "verifier-backed candidate"
node scripts/cw.js commit <run-id> --selection <selection-id> --reason "verified winner"
```

## Operator Inspection

v0.1.21 adds to the host loop these pointed operator commands:

```bash
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js multi-agent dependencies <run-id>
node scripts/cw.js multi-agent failures <run-id>
node scripts/cw.js multi-agent evidence <run-id>
```

The human output is short and ready to use: agent graph, dependencies, failed
or blocked agents, evidence taken in, missing evidence, and the next action.
Use `--json` or `--format json` for deterministic script output.

## MCP Tools

MCP hosts should pick:

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
`cw_candidate_*` tools are still there as deep primitives.

## Stable Responses

Every high-level response is JSON and has in it:

- `runId`
- active topology and multi-agent ids
- blackboard and topic ids
- candidate, selection, commit, and audit ids
- `state`, `performed`, `nextAction`, and `nextActions`
- `blockedReasons`, `requiredHostAction`, and `evidenceRequirements`
- state, report, blackboard, audit, ranking, worker manifest, and result paths
- joined topology, multi-agent, multi-agent operator, blackboard, worker,
  candidate, feedback, commit, and audit summaries

## Fail-Closed Rules

The host surface fails closed when:

- it is not clear which active topology or blackboard state to use
- a fanout does not cover all the roles
- worker output has not been recorded
- fanin is missing required evidence or blackboard links
- score evidence is missing
- selection is missing a score or verifier readiness
- a verifier-gated commit is not ready

## Smoke Coverage

`test/multi-agent-cli-mcp-surface-smoke.js` covers the full host loop over the
official `judge-panel` topology, CLI and MCP parity, the failure when the
topology is not clear, the failure when evidence is missing, score/select that
works, blackboard artifact/message linkage, audit provenance, and Operator UX
next actions. It is part of `npm test` and `npm run release:check`.

`test/multi-agent-operator-ux-smoke.js` covers the v0.1.21 graph,
dependencies, failures, evidence adoption, report output, and MCP parity.

`test/multi-agent-trust-policy-audit-smoke.js` covers the v0.1.22
role-policy, blackboard-write, message-provenance, judge-rationale,
policy-violation, report, audit provenance, and MCP parity surface.

`test/multi-agent-eval-replay-harness-smoke.js` covers the v0.1.24 eval/replay
commands and MCP tools: snapshot, replay, compare, score, gate, report, and the
way it finds regressions under control.
## CLI ↔ MCP Parity (v0.1.27)

Every command and tool named above is declared in the v0.1.27 capability
registry (`src/capability-registry.ts`) and checked by `npm run parity:check`,
so `cw <cmd> --json` and the matching `cw_<tool>` result show one data source.
See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).

## Run Registry / Control Plane (v0.1.28)

The runs talked about here can be indexed, searched, taken up again, put in an
archive, and run again across repos by the v0.1.28 Run Registry / Control Plane,
which builds a fingerprinted, fail-closed index over the same per-run
`.cw/runs/<id>/state.json` source of truth. See [run-registry-control-plane.7.md](run-registry-control-plane.7.md).

## Execution Backends (v0.1.29)

v0.1.29 takes execution up into a pluggable driver layer: one narrow
`ExecutionBackend` contract with `node`/`bun`/`shell`/`container`/`remote`/`ci`
drivers that you can swap, picked by `--backend` (in parallel to `--sandbox`) and
looked at through `backend list|show|probe`. The result/evidence envelope has the
same schema across backends; the backend id + sandbox attestation are recorded as
provenance, so this surface is the same no matter which backend ran a run. See
[execution-backends.7.md](execution-backends.7.md).
## Web / Desktop Workbench (v0.1.30)

v0.1.30 adds the Web / Desktop Workbench: a read-only, localhost-only human
console that shows this surface (and the other four operator panels — run
graph, blackboard, worker logs, candidate compare, audit timeline) for any run,
reading the SAME capability `--json` payloads. It is a THIRD FRONT DOOR by the
side of the CLI and MCP that holds no authoritative state and forks no schema:
each panel is the same as its `cw <cmd> --json` payload byte-for-byte
(parity-gated), and a refresh builds everything again from disk. See
[web-desktop-workbench.7.md](web-desktop-workbench.7.md).

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
work out durations, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and host-attested token/cost from durable run state that is
already there — no metrics database, no collector daemon, no hidden counter.
Usage is added on and not required (absent ⇒ `unreported`, never 0); cost is
`attested` (attested usage × a recorded pricing policy) or clearly `estimated`,
with pricing as policy. Both verbs are parity-gated and show read-only in the
v0.1.30 Workbench. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).


## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — required approvals from
authorized roles, made to happen inside `resolveCommitGate` AFTER the verifier
checks and never in place of them, failing closed on quorum/authority/self-approval
and recording who gave approval to the very artifact that shipped. Policy
(required approvals, authorized roles, self-approval) is data, off by default
(pre-v0.1.32 behavior the same). The verbs are parity-gated and show read-only in
the v0.1.30 Workbench. See [Team Collaboration](team-collaboration.7.md).

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a release gate that has no repeats. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends truly run (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is not there to use. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and on-its-own deterministic replay over StateNode, using the v0.1.23 eval harness again; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

start up an outside agent process per worker, take in result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the bulk that can be built again, prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock that puts in order the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object broken up into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

take in findings/evidence from any agent shape that makes sense (alt keys + prose), CW works out grounded evidence by itself, give a warning on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate that stops empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) in place of the mutable working tree — getting rid of false-red/false-green from working-tree writes at the same time (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, Map and Assess results you can use again, wrapper metrics you can measure, a background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without changing the full review contract.

## New Both-Surface Verbs (v0.1.81)

v0.1.81 adds `audit verify` (`cw_audit_verify`) and `run inspect-archive` (`cw_run_inspect_archive`) — both declared once in the capability registry and shown the same way on the CLI and MCP, fail-closed (non-zero exit / `ok:false` on a chain that is not verified or an archive that has been tampered with).
_No changes in v0.1.82._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing
