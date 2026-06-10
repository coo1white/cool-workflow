# Evidence Adoption Reasoning Chain

CW v0.1.26 adds the Evidence Adoption Reasoning Chain. Earlier releases can
already answer *what* was adopted: `multi-agent evidence <run-id>` reports each
evidence item as `adopted`, `rejected`, `pending`, `superseded`, `conflicting`,
or `missing`, and traces the path worker result -> blackboard -> fanin ->
candidate score -> selection -> verifier-gated commit. This release answers
*why* each adoption happened, as a first-class, inspectable reasoning chain.

The design keeps the base-system observability philosophy:

- raw state is the source of truth
- the reasoning chain is a derived userland view, never a replacement for source
  records and never authoritative over them
- mechanism is separate from policy: the chain captures, stores, and renders the
  recorded "why"; what counts as a *sufficient* reason stays with the verifier
  and role policy
- fail closed, never infer: a "why" that cannot be traced to a real record
  renders as `unexplained`, never a fabricated rationale, and an unexplained
  adoption is never silently treated as explained
- plain files, stable JSON, deterministic output
- backward compatible; pre-v0.1.26 run state loads and renders with derived,
  empty-where-absent reasoning records

## What the chain records

For every adopted, rejected, superseded, or conflicting evidence item the chain
makes the following traceable and machine-readable, per gate:

- DECISION - what was adopted/rejected and at which gate (`fanin`,
  `candidate-score`, `selection`, `verifier`, or `commit`).
- BASIS - the concrete evidence refs, provenance source, parent evidence ids,
  and audit event ids that grounded the decision. These link to existing
  `EvidenceProvenance` and trust-audit records; they are not duplicated.
- AUTHORITY - which role / membership / worker / scorer / verifier made the call,
  and the role `policyRef` under which it was permitted. Links to existing
  trust / policy / audit records.
- RATIONALE - the explicit recorded reason. The chain reuses existing rationale
  fields: selection `reason` and `AcceptanceRationale`, candidate score `notes`,
  verifier commit-gate result, commit `reason`, `CoordinatorDecision.reason`, and
  judge-rationale audit metadata. No new rationale source of truth is created.
- COUNTERFACTUAL - the rejected/losing alternatives (rejected candidates, failed
  scores, rejected or superseded coordinator decisions) and the recorded reason
  each lost, with a normalized score delta when computable, so an adoption is
  understood relative to its alternatives.
- INTEGRITY - a `sourceFingerprint` and `valid|stale|absent` freshness so a
  reader knows the explanation still matches the underlying records, plus the
  explicit `unexplained` state when a rationale is absent.

## Derived record model

The records live in `src/types.ts` and reuse existing provenance / trust /
rationale types by reference:

- `EvidenceReasoningStep` - one gate's reasoning: `gate`, `decision`, `basis`,
  `authority`, `rationale`, and `counterfactuals`.
- `EvidenceReasoningChain` - the full chain for one evidence item: `id`, `ref`,
  `evidenceStatus`, a rolled-up `rationaleStatus`
  (`explained`, `unexplained`, or `not-applicable`), `sourceKind`, `steps`,
  `sourceRecordIds`, and `unexplainedReasons`.
- `EvidenceReasoningReport` - the run-level report: `freshness`,
  `sourceFingerprint`, `totals`, `chains`, and a `nextAction`.

Status values mirror the existing evidence vocabulary and add the fail-closed
`unexplained` state. A chain is `explained` only when *every* decision-bearing
step is explained; if any adopting step has no traceable rationale the chain
rolls up to `unexplained`.

## Durable storage

`multi-agent reasoning <run-id> --refresh` materializes a durable, versioned,
provenance-backed index under `.cw/runs/<run-id>/reasoning/`:

- `index.json` - the `EvidenceReasoningIndex` (schema version, run id,
  `sourceFingerprint`, totals, and per-chain entries with their own
  fingerprints).
- `chain-<evidence-id>.json` - one record per reasoning chain.
- `report.json` - the rendered report at refresh time.

Raw results, candidates, scores, selections, commits, blackboard records, and
audit events are never deleted or overwritten. The reasoning view is derived and
re-derivable; the index only persists a snapshot for freshness comparison.

## Freshness

`multi-agent reasoning <run-id>` re-derives the chain from current source state
and compares its `sourceFingerprint` against the persisted index:

- `absent` - no index has been refreshed yet.
- `valid` - the persisted fingerprint matches current source state.
- `stale` - source records changed since the last refresh; re-run with
  `--refresh`.

This follows the v0.1.25 state-explosion summary discipline exactly. Freshness
is a visible state, never an inferred guess.

## Commands

`multi-agent reasoning <run-id>` (MCP: `cw_evidence_reasoning`) renders the
report. Add `--evidence <id>` to explain a single adoption, `--refresh` to
materialize the durable index first, and `--json` / `--format json` for the full
machine-readable report.

`multi-agent reasoning <run-id> --refresh` with no `--evidence` returns the
written index (MCP: `cw_evidence_reasoning_refresh`).

`multi-agent evidence <run-id>` is unchanged in shape but each row now carries an
additive `rationaleStatus` field (`explained`, `unexplained`, or
`not-applicable`), so the existing evidence surface answers both *what* and
whether the *why* is recorded.

The console report adds a single new panel, `Adoption Rationale`, alongside the
existing operator panels. It is the only panel added by this release.

## Composition with graph views and compaction

The reasoning chain composes with the existing graph views, especially
`multi-agent graph <run-id> --view evidence`. A reasoning step is on the critical
path: every decision-gate node backing an adopted chain (candidate, score,
selection, commit, and fanin nodes) is protected from state-explosion
compaction and is never collapsed into a synthetic summary node. In particular
score nodes, which are otherwise collapsible, stay expanded when they carry a
reasoning step.

## Eval / replay regression gates

The eval harness adds three deterministic, replay-stable metrics, reported under
the `Evidence Adoption Reasoning Chain` section of the replay report:

- `reasoning_freshness` - the derived chain totals and `sourceFingerprint` are
  stable across replay.
- `reasoning_chain_parity` - every chain's gates, decisions, rationale statuses,
  and counterfactual counts match the baseline.
- `reasoning_unexplained_parity` - the set of `unexplained` chains is unchanged,
  so a regression that hides or fabricates a rationale fails the gate.

These sections are optional on pre-v0.1.26 snapshots so older fixtures stay
loadable.

## Data flow

```
worker result / blackboard / coordinator decision
  -> EvidenceProvenance + trust-audit event        (BASIS)
  -> role / membership / worker + role policyRef    (AUTHORITY)
  -> fanin coverage / score notes+verdict / selection reason
     / verifier gate / commit reason / judge rationale  (RATIONALE)
  -> rejected candidates / failed scores / rejected decisions  (COUNTERFACTUAL)
  -> EvidenceReasoningChain (per evidence item)
  -> EvidenceReasoningReport + sourceFingerprint + freshness  (INTEGRITY)
```

No daemon, no hidden dashboard, no LLM call. The chain is derived from recorded
state by `src/evidence-reasoning.ts` and rendered on demand.
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

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77
