# Web / Desktop Workbench

CW v0.1.30 adds the Web / Desktop Workbench: a human-facing console that renders
a run's five operator surfaces — run graph, blackboard, worker logs, candidate
compare, and audit timeline — plus a cross-run entry point over the v0.1.28 Run
Registry. It is a THIRD FRONT DOOR, not a new brain.

Before v0.1.30 CW had no web/HTTP/UI surface at all: the CLI rendered for human
speed and the MCP server (JSON-RPC over stdio) rendered for machine context. The
Workbench adds human inspection at a glance — and adds NOTHING else. It computes,
decides, and stores nothing the CLI/MCP cannot already produce.

## The third front door (mechanism vs policy)

The kernel and the durable `.cw/` state are the MECHANISM. The CLI, the MCP
surface, and the Workbench are three renderings — three policies — over that one
mechanism:

- the per-run `.cw/runs/<id>/state.json` is the SINGLE source of truth
- the v0.1.28 Run Registry is a DERIVED, rebuildable index over runs across repos
- the Workbench is a STATELESS, READ-ONLY RENDERER over both

Every Workbench panel embeds, VERBATIM, the canonical `--json` payload of ONE
already-declared capability, assembled by calling the SAME capability core
entries the CLI and MCP route through (the v0.1.27 parity contract, see
[CLI ↔ MCP Parity](cli-mcp-parity.7.md)). The Workbench can show nothing the CLI
or MCP cannot; a `workbench.view` panel is byte-for-byte equal to its underlying
`cw <cmd> --json` payload, and that equality is parity-gated.

## No hidden dashboard database

CW's README promises there is "no hidden dashboard database." The Workbench
upholds that promise by holding ZERO authoritative state:

- it persists nothing — there is no Workbench store, cache, or schema
- every response is re-derived on demand from disk; refresh re-reads `.cw/`
- delete the host process and nothing is lost — the data IS the files
- it forks no run/state schema; the view models in `src/types.ts`
  (`WorkbenchRunView`, `WorkbenchPanel`, `WorkbenchServeDescriptor`) are DERIVED
  projections that embed existing payloads, never copies of them

The Workbench is OPTIONAL, like Bun is an optional execution backend: the
committed `dist/` and a plain `node` runtime keep working with the Workbench (and
its static UI assets under `ui/workbench/`) absent. The kernel imports the
Workbench never; the Workbench imports the kernel.

## The five panels

Each panel renders existing operator vocabulary, with the same names and
semantics as the CLI (least astonishment). For run `<id>`:

1. RUN GRAPH — `cw graph <id> --json` (operator graph) plus
   `cw multi-agent graph <id> [--view compact|critical-path] --json`. Backend
   ids/attestations (v0.1.29) ride on the nodes; the critical path, failures,
   missing evidence, and policy violations are never collapsed.
2. BLACKBOARD — `cw coordinator summary <id>`, `cw blackboard summarize <id>
   --json`, and `cw blackboard graph <id>`: topics, messages, contexts,
   artifacts, snapshots, decisions, conflicts, and adopted/missing evidence.
3. WORKER LOGS — `cw worker summary <id> --json`: manifests, outputs, scoped
   results, failures, and the recorded execution backend + sandbox attestation.
4. CANDIDATE COMPARE — `cw candidate summary <id> --json` plus
   `cw multi-agent reasoning <id> --json`: scores, selection, rejection reasons,
   and the v0.1.26 evidence-adoption reasoning chain (why adopted).
5. AUDIT TIMELINE — `cw audit summary <id>`, `cw audit multi-agent <id> --json`,
   `cw audit policy <id> --json`, and `cw audit judge <id> --json`: trust-audit
   events, role policy decisions, provenance, judge/chair rationale, and policy
   violations.

Cross-run entry lists/searches runs via the Run Registry (`cw registry show
--json` + `cw run list|search --json`); drilling into a run opens its five panels.

## Explicit, inspectable, fail closed

The Workbench surfaces freshness honestly. When a source capability is unreadable
(a run with no blackboard yet, or unresolvable state), the panel is rendered
`absent` with the honest error — exactly what the CLI would report — and the view
is `resolved: false`. It never fabricates a view when source state is unreadable.
The same `valid`/`stale`/`absent`/`missing` freshness the runtime already records
(Run Registry, Evidence Adoption Reasoning Chain, state-explosion summaries) flows
through verbatim.

## Trust boundary

The host is least-privilege and local by default:

- it binds the loopback interface `127.0.0.1` ONLY — never a public address
- it is READ-ONLY: every route is `GET`; any write verb is refused `405`
- it rejects non-localhost `Host` headers (a DNS-rebinding defense) with `403`
- it refuses path traversal out of `ui/workbench/` with `403`
- it serves nothing beyond the current user's `.cw/` scope and the Run Registry's
  registered repos
- it fails closed on anything it cannot read

The console is read-only. It offers no actions. If a future release adds an action
(resume, rerun, dispatch), that action MUST route through an existing declared
capability core entry — never a parallel code path — so it cannot drift from the
CLI/MCP and is covered by the parity gate.

## Surfaces

```
cw workbench view <run-id> [--json]         # five-panel WorkbenchRunView for one run
cw workbench serve [--port N] [--scope repo|home] [--once|--json]
```

`cw workbench serve` with `--once`/`--json` prints the serve descriptor (bind
host/port, scope, routes) and exits without starting a server; the default starts
the localhost host (like `schedule daemon`). The MCP tools `cw_workbench_view` and
`cw_workbench_serve` mirror these: `cw_workbench_view` returns the same view as the
CLI `--json`, and `cw_workbench_serve` returns the descriptor only — an MCP stdio
host cannot start a blocking server. That single side-effect difference is the
declared, documented payload divergence recorded in `src/capability-registry.ts`;
the descriptor payload itself is identical across surfaces.

The read-only HTTP routes the host serves:

```
GET /                       # static UI shell (dependency-light; absent -> JSON-only fallback)
GET /ui/*                   # static UI assets, read from disk
GET /api/index              # registry show + run list/search (cross-run entry)
GET /api/serve              # the serve descriptor
GET /api/run/:runId         # the five-panel WorkbenchRunView
```

## Version

This is CW v0.1.30. The Workbench changes no run-state schema and requires no
migration: it is a pure read-only projection over existing durable state and
existing capability payloads. Removing it leaves the SDK fully functional.

See also [Operator UX](operator-ux.7.md), [CLI ↔ MCP Parity](cli-mcp-parity.7.md),
and [Run Registry / Control Plane](run-registry-control-plane.7.md).

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
