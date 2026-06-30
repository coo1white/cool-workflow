# Multi-Agent Operator UX

CW v0.1.21 makes multi-agent operator inspection a first-class part. The feature is a
read-only userland view of the run state you already have. It does not make a hidden
dashboard database, and it does not guess success when evidence, dependency, or
lifecycle state is not clear.
CW v0.1.22 adds trust panels to the same operator path, so role policy,
permission decisions, blackboard write audit, message provenance, judge
rationale, panel decisions, and policy violations are seen next to topology
and evidence state.
CW v0.1.24 uses the same operator-derived graph, dependency, failure, evidence,
trust, and report views as replay comparison inputs for the Multi-Agent Eval &
Replay Harness.
CW v0.1.25 puts State Explosion Management on top of these operator views: when
a run gets large, `summary show`, `multi-agent summarize`, and
`multi-agent graph --view compact` fold high-volume records into made-up
summary nodes, while keeping the critical path, failures, missing evidence,
policy violations, and judge rationale. See
[state-explosion-management.7.md](state-explosion-management.7.md).

CW v0.1.26 adds the `Adoption Rationale` panel and the `multi-agent reasoning`
view, which makes clear *why* each evidence item was adopted. Reasoning steps are on
the critical path and are never folded away by compaction. See
[evidence-adoption-reasoning-chain.7.md](evidence-adoption-reasoning-chain.7.md).

CW v0.1.27 adds an additive evidence `disposition` (`adopted` | `inspectable` |
`blocking`) and an `inspectableEvidence` list. The raw `status` (the adoption
state) is not changed; `disposition` is how the operator reads it. Before a
verifier-gated commit, a missing/pending row truly blocks. After a
verifier-gated commit the selected path is fixed, so missing/pending evidence
for sibling roles that were never driven as separate workers — for example
undriven judge-panel judges — is inspectable operator state, not a hidden
failure. The `multi-agent status` "Missing Evidence" header and the `status`
panel show the blocking-vs-inspectable split so the operator is not given the wrong idea.

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

Use the normal status and report commands for the wide view:

```bash
node scripts/cw.js status <run-id>
node scripts/cw.js graph <run-id>
node scripts/cw.js report <run-id> --show
```

Use the focused multi-agent views when the operator needs the process table.

```bash
node scripts/cw.js multi-agent status <run-id>
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js multi-agent dependencies <run-id>
node scripts/cw.js multi-agent failures <run-id>
node scripts/cw.js multi-agent evidence <run-id>
```

Every focused command can give deterministic JSON:

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

`multi-agent graph` shows the topology-backed agent graph and the downstream
acceptance records:

- MultiAgentRun, topology run, roles, groups, memberships, fanout, and fanin
- tasks, dispatches, workers, result nodes, and verifier gates
- blackboard topics, messages, artifacts, contexts, snapshots, and coordinator
  decisions
- candidates, score records, selections, verifier-gated commits, and feedback

Edges are labeled when the label gives operational meaning:

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
blackboard artifacts are cited by fanin, scores judge candidates, selections
pick scored candidates, and commits record the selected verifier-gated result.

## Failures

`multi-agent failures` joins the records an operator normally has to look at
one at a time:

- failed memberships and missing role coverage
- missing worker output and failed or rejected workers
- open feedback, including sandbox-policy failures
- fanin blocked reasons and missing blackboard evidence
- rejected or failed candidates
- score, selection, verifier, and commit-gate gaps
- ambiguous blocked dependencies

Each row has the record id, kind, status, owner or role when known, linked
task/worker/membership/fanin/candidate when known, the exact reason, and the
next safe command.

## Evidence Adoption

`multi-agent evidence` makes clear why a result was accepted or not accepted. Each
row has:

- evidence id/ref/path/locator
- source kind and source id
- adopted-by ids and rejected-by ids
- pending consumers
- candidate, score, selection, and commit links
- provenance or trust source when available
- status: `adopted`, `rejected`, `pending`, `superseded`, `conflicting`, or
  `missing`

An accepted path should be possible to trace like this:

```text
worker result -> blackboard artifact/message -> fanin -> candidate score
-> selection -> verifier-gated commit
```

When any link is missing, CW reports it as pending or missing and points to the
next command, instead of taking it for granted that the run is healthy.

## MCP Parity

MCP hosts can look at the same derived data:

- `cw_multi_agent_status`
- `cw_multi_agent_graph`
- `cw_multi_agent_dependencies`
- `cw_multi_agent_failures`
- `cw_multi_agent_evidence`

`cw_multi_agent_status` keeps the v0.1.20 host envelope and adds the
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
`scores` to the candidate score, follow `selects` to the picked result, and
follow `commits` to the verifier-gated state commit.

## Smoke Coverage

`test/multi-agent-operator-ux-smoke.js` makes a deterministic topology-backed
run with a good worker evidence path, a failed worker path, blocked fanin
evidence, score and selection records, a verifier-gated commit, human CLI
assertions, JSON CLI assertions, MCP parity assertions, and report assertions.
It is part of `npm test` and `npm run release:check`.
## CLI ↔ MCP Parity (v0.1.27)

Every command and tool named above is declared in the v0.1.27 capability
registry (`src/capability-registry.ts`) and checked by `npm run parity:check`,
so `cw <cmd> --json` and the matching `cw_<tool>` result show one data source.
See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).

## Run Registry / Control Plane (v0.1.28)

The runs talked about here are indexed, searchable, resumable, archivable, and
rerunnable across repos by the v0.1.28 Run Registry / Control Plane, which makes
a fingerprinted, fail-closed index over the same per-run `.cw/runs/<id>/state.json`
source of truth. See [run-registry-control-plane.7.md](run-registry-control-plane.7.md).

## Execution Backends (v0.1.29)

v0.1.29 moves execution into a pluggable driver layer: one narrow `ExecutionBackend`
contract with swappable `node`/`bun`/`shell`/`container`/`remote`/`ci`
drivers, chosen by `--backend` (parallel to `--sandbox`) and looked at through
`backend list|show|probe`. The result/evidence envelope is schema-identical across
backends; the backend id + sandbox attestation are recorded as provenance, so this
surface stays the same no matter which backend ran a run. See
[execution-backends.7.md](execution-backends.7.md).
## Web / Desktop Workbench (v0.1.30)

v0.1.30 adds the Web / Desktop Workbench: a read-only, localhost-only human
console that shows this surface (and the other four operator panels — run
graph, blackboard, worker logs, candidate compare, audit timeline) for any run,
reading the SAME capability `--json` payloads. It is a THIRD FRONT DOOR next to
the CLI and MCP that holds no authoritative state and forks no schema: each panel
is the same as its `cw <cmd> --json` payload byte-for-byte (parity-gated), and refresh
makes everything again from disk. See
[web-desktop-workbench.7.md](web-desktop-workbench.7.md).

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
work out durations, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and host-attested token/cost from the durable run state you
already have — no metrics database, no collector daemon, no hidden counter. Usage is additive
and optional (absent ⇒ `unreported`, never 0); cost is `attested` (attested usage
× a recorded pricing policy) or clearly `estimated`, with pricing as policy. Both
verbs are parity-gated and show read-only in the v0.1.30 Workbench. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).


## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — required approvals from
authorized roles, made to happen inside `resolveCommitGate` AFTER the verifier checks
and never in place of them, failing closed on quorum/authority/self-approval and
recording who approved the very artifact that shipped. Policy (required approvals,
authorized roles, self-approval) is data, default off (pre-v0.1.32 behavior
not changed). The verbs are parity-gated and show read-only in the v0.1.30
Workbench. See [Team Collaboration](team-collaboration.7.md).

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a de-duplicated release gate. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends truly execute (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is not there to use. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, using again the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

spawn an outside agent process per worker, take result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the reconstructable bulk, and prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

take findings/evidence from any reasonable agent shape (alt keys + prose), CW works out grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate that blocks empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) instead of the changeable working tree — taking away false-red/false-green from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, measurable wrapper metrics, useful background full-review handoff, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_No changes to the multi-agent operator UX surface in v0.1.81 (the operator-ux module was cut into behavior-preserving siblings; output is byte-identical)._
_No changes in v0.1.82._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

_No behavioral change in v0.1.88 (no operator-view code changed; the new sub-workflow `subRunId`/`subRunDir` and `loopRound` run-state fields surface read-only through the existing derived graph/dependency/evidence views, which neither fabricate state nor guess success)._

## 0.1.89 (v0.1.89)

_No behavioral change in v0.1.89 (CLI-surface golden-path + help-output fixes only; this subsystem is unchanged)._

0.1.90

0.1.91

0.1.93

0.1.94

0.1.95

0.1.96

0.1.97
