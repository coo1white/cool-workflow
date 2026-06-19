# Node Snapshot / Diff / Replay

CW v0.1.35 adds Node Snapshot / Diff / Replay: per-NODE granularity over the
v0.1.23 eval/replay harness. Before v0.1.35 the harness worked only at RUN/SUITE
granularity — `createMultiAgentReplaySnapshot(run)` took a picture of a whole run;
there was no way to snapshot, fingerprint, diff, or replay a single `StateNode`. This
release adds that. It reuses the harness's normalize/stable-stringify way of working and
the v0.1.25 fingerprint/freshness pattern — without forking `StateNode`, the eval
harness, or the run-state schema (all additive).

This keeps the same base-system split used in other places: the mechanism
captures/diffs/replays one node by id; nothing decides which node "matters".

## Snapshot — derived + fingerprinted

A `NodeSnapshot` is a DERIVED projection of one `StateNode`: its body is normalized
(timestamps/paths taken out via the eval harness's `normalizeValue`), so it is
byte-stable across captures of the same logical state. It carries a
`sourceFingerprint` — sha256 over the RAW node (`id:status:updatedAt` + artifact
and evidence ids/paths) — so any change to the state turns it over.

```text
node snapshot <run-id> <node-id> [--json]
```

Kept under `<run>/nodes/snapshots/<node-id>/<snapshot-id>.json`; the source
`<run>/nodes/<id>.json` stays the truth. The `snapshot-id` is content-addressed
(`snap-<node>-<fingerprint>`), so taking a new snapshot of an unchanged node is idempotent.

## Freshness — fail closed on drift

Every load works out the fingerprint again from the current source and gives a
freshness verdict:

- `valid` — source matches the snapshot.
- `stale` — the source node changed after capture.
- `absent` — the node, or a referenced artifact path, is gone/unreadable.

`stale` and `absent` both REFUSE diff/replay with a structured `NodeSnapshotError`
naming the divergence — never a quiet stale replay, never a best-effort partial.

## Diff — stable + structural

```text
node diff <run-id> <baseline-snapshot-id> <candidate-snapshot-id> [--json]
```

Per-section (`status`/`inputs`/`outputs`/`artifacts`/`evidence`/`errors`/`links`/
`metadata`) `added|removed|changed|same`, put in order deterministically by the same
`stableStringify` the eval comparison uses. Byte-identical across repeated runs.

## Replay — isolated + deterministic

```text
node replay <run-id> <snapshot-id> [--json]
```

Builds the normalized node again from the snapshot with `now` INJECTED — no
ambient `new Date()` in the deterministic payload. The result carries an
`outputFingerprint` over the normalized body, so two replays of one snapshot are
byte-identical (only `replayedAt`/`replayId`, which come from now, are different).
Replaying a `stale`/`absent` snapshot fails closed.

## Verify — replay vs source

```text
node verify <run-id> <replay-id> [--json]
```

Compares a replay to a FRESH snapshot of the source node and gives a pass/fail
verdict plus findings in the eval harness's `severity/category/reason/baselineRef/
replayRef` shape.

## Surfaces & Compatibility

`node.snapshot`/`node.diff`/`node.replay`/`node.replay.verify` are declared in the
capability registry as `surface: "both"`, so `cw node <verb> --json` and the
`cw_node_*` MCP tools render one core (`src/node-snapshot.ts`). Additive: no change
to `StateNode`, `STATE_NODE_SCHEMA_VERSION`, the run-state schema, the pipeline
contract, or existing eval-suite artifacts; pre-0.1.35 runs and snapshots can still
be loaded. Making the once-private eval-harness helpers
(`normalizeValue`/`stableStringify`/`lines`) and `fingerprintStrings` public is purely
additive and changes no behavior.

## See Also

state-node(7), multi-agent-eval-replay-harness(7), state-explosion-management(7),
cli-mcp-parity(7)

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

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW works out grounded evidence by itself, gives a warning on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) instead of the mutable working tree — getting rid of false-red/false-green from working-tree writes that happen at the same time (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, wrapper metrics you can measure, a background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_No changes to node-snapshot diff/replay in v0.1.81._
_No change in behavior in v0.1.82 (the node projection field set was brought together into one source of truth; snapshot/replay digests are byte-identical)._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86
