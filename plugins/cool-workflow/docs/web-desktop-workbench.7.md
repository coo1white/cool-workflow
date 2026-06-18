# Web / Desktop Workbench

CW v0.1.30 adds the Web / Desktop Workbench: a console for people that shows
a run's five operator surfaces — run graph, blackboard, worker logs, candidate
compare, and audit timeline — plus a way in across runs over the v0.1.28 Run
Registry. It is a THIRD FRONT DOOR, not a new brain.

Before v0.1.30 CW had no web/HTTP/UI surface at all: the CLI showed things at human
speed and the MCP server (JSON-RPC over stdio) showed things for machine context. The
Workbench lets a person look at a run quickly — and adds NOTHING else. It works out,
decides, and keeps nothing that the CLI/MCP cannot already make.

## The third front door (mechanism vs policy)

The kernel and the durable `.cw/` state are the MECHANISM. The CLI, the MCP
surface, and the Workbench are three ways to show it — three policies — over that one
mechanism:

- the per-run `.cw/runs/<id>/state.json` is the SINGLE source of truth
- the v0.1.28 Run Registry is a DERIVED index over runs across repos that you can build again
- the Workbench is a STATELESS, READ-ONLY RENDERER over both

Every Workbench panel holds, VERBATIM, the true `--json` payload of ONE
capability already named, put together by calling the SAME capability core
entries the CLI and MCP go through (the v0.1.27 parity contract, see
[CLI ↔ MCP Parity](cli-mcp-parity.7.md)). The Workbench can show nothing the CLI
or MCP cannot; a `workbench.view` panel is byte-for-byte equal to the
`cw <cmd> --json` payload under it, and that sameness is parity-gated.

## No hidden dashboard database

CW's README gives its word that there is "no hidden dashboard database." The Workbench
keeps that word by holding ZERO authoritative state:

- it keeps nothing — there is no Workbench store, cache, or schema
- every response is made again, when asked, from disk; refresh re-reads `.cw/`
- delete the host process and nothing is lost — the data IS the files
- it forks no run/state schema; the view models in `src/types.ts`
  (`WorkbenchRunView`, `WorkbenchPanel`, `WorkbenchServeDescriptor`) are DERIVED
  projections that hold payloads that already exist, never copies of them

The Workbench is OPTIONAL, the way Bun is an optional execution backend: the
committed `dist/` and a plain `node` runtime keep working when the Workbench (and
its static UI assets under `ui/workbench/`) is not there. The kernel imports the
Workbench never; the Workbench imports the kernel.

## The five panels

Each panel shows operator words that already exist, with the same names and
meaning as the CLI (least surprise). For run `<id>`:

1. RUN GRAPH — `cw graph <id> --json` (operator graph) plus
   `cw multi-agent graph <id> [--view compact|critical-path] --json`. Backend
   ids/attestations (v0.1.29) sit on the nodes; the critical path, failures,
   missing evidence, and policy violations are never folded away.
2. BLACKBOARD — `cw coordinator summary <id>`, `cw blackboard summarize <id>
   --json`, and `cw blackboard graph <id>`: topics, messages, contexts,
   artifacts, snapshots, decisions, conflicts, and adopted/missing evidence.
3. WORKER LOGS — `cw worker summary <id> --json`: manifests, outputs, scoped
   results, failures, and the recorded execution backend + sandbox attestation.
4. CANDIDATE COMPARE — `cw candidate summary <id> --json` plus
   `cw multi-agent reasoning <id> --json`: scores, selection, reasons for turning down,
   and the v0.1.26 evidence-adoption reasoning chain (why adopted).
5. AUDIT TIMELINE — `cw audit summary <id>`, `cw audit multi-agent <id> --json`,
   `cw audit policy <id> --json`, and `cw audit judge <id> --json`: trust-audit
   events, role policy decisions, provenance, judge/chair rationale, and policy
   violations.

The way in across runs lists/searches runs through the Run Registry (`cw registry show
--json` + `cw run list|search --json`); going into a run opens its five panels.

## Explicit, inspectable, fail closed

The Workbench shows freshness in a true way. When a source capability cannot be read
(a run with no blackboard yet, or state that cannot be worked out), the panel is shown
`absent` with the true error — just what the CLI would report — and the view
is `resolved: false`. It never makes up a view when source state cannot be read.
The same `valid`/`stale`/`absent`/`missing` freshness the runtime already records
(Run Registry, Evidence Adoption Reasoning Chain, state-explosion summaries) goes
through verbatim.

## Trust boundary

The host has least privilege and is local by default:

- it binds the loopback interface `127.0.0.1` ONLY — never a public address
- it is READ-ONLY: every route is `GET`; any write verb is turned away with `405`
- it turns away non-localhost `Host` headers (a DNS-rebinding defense) with `403`
- it turns away path traversal out of `ui/workbench/` with `403`
- it serves nothing past the current user's `.cw/` scope and the Run Registry's
  registered repos
- it fails closed on anything it cannot read

The console is read-only. It offers no actions. If a later release adds an action
(resume, rerun, dispatch), that action MUST go through a declared
capability core entry that already exists — never a side code path — so it cannot drift from the
CLI/MCP and is covered by the parity gate.

## Surfaces

```
cw workbench view <run-id> [--json]         # five-panel WorkbenchRunView for one run
cw workbench serve [--port N] [--scope repo|home] [--once|--json]
```

`cw workbench serve` with `--once`/`--json` prints the serve descriptor (bind
host/port, scope, routes) and stops without starting a server; the default starts
the localhost host (like `schedule daemon`). The MCP tools `cw_workbench_view` and
`cw_workbench_serve` match these: `cw_workbench_view` gives back the same view as the
CLI `--json`, and `cw_workbench_serve` gives back the descriptor only — an MCP stdio
host cannot start a server that blocks. That one side-effect difference is the
declared, documented payload divergence written down in `src/capability-registry.ts`;
the descriptor payload itself is the same across surfaces.

The read-only HTTP routes the host serves:

```
GET /                       # static UI shell (dependency-light; absent -> JSON-only fallback)
GET /ui/*                   # static UI assets, read from disk
GET /api/index              # registry show + run list/search (cross-run entry)
GET /api/serve              # the serve descriptor
GET /api/run/:runId         # the five-panel WorkbenchRunView
```

## Version

This is CW v0.1.30. The Workbench changes no run-state schema and needs no
migration: it is a pure read-only projection over durable state that already exists and
capability payloads that already exist. Taking it away leaves the framework fully working.

See also [Operator UX](operator-ux.7.md), [CLI ↔ MCP Parity](cli-mcp-parity.7.md),
and [Run Registry / Control Plane](run-registry-control-plane.7.md).

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
work out durations, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and host-attested token/cost from durable run state that already exists
— no metrics database, no collector daemon, no hidden counter. Usage is additive
and optional (absent ⇒ `unreported`, never 0); cost is `attested` (attested usage
× a recorded pricing policy) or clearly `estimated`, with pricing as policy. Both
verbs are parity-gated and show read-only in the v0.1.30 Workbench. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).


## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — required approvals from
authorized roles, enforced inside `resolveCommitGate` AFTER the verifier checks
and never in place of them, failing closed on quorum/authority/self-approval and
recording who approved the very artifact that shipped. Policy (required approvals,
authorized roles, self-approval) is data, off by default (pre-v0.1.32 behavior
unchanged). The verbs are parity-gated and show read-only in the v0.1.30
Workbench. See [Team Collaboration](team-collaboration.7.md).

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a release gate that has no doubled steps. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really run (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is not there. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, reusing the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover that checks it. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

start an outside agent process for each worker, take result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the bulk that can be built again, prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

take findings/evidence from any reasonable agent shape (alt keys + prose), CW works out grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate that blocks empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) in place of the mutable working tree — taking away false-red/false-green from working-tree writes at the same time (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, Map and Assess results you can use again, wrapper metrics you can measure, a background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_No changes to the Web / Desktop Workbench in v0.1.81._
_No changes in v0.1.82._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85
