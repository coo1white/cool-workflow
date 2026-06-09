# Node Snapshot / Diff / Replay

CW v0.1.35 adds Node Snapshot / Diff / Replay: per-NODE granularity over the
v0.1.23 eval/replay harness. Before v0.1.35 the harness worked only at RUN/SUITE
granularity — `createMultiAgentReplaySnapshot(run)` captured a whole run; there
was no way to snapshot, fingerprint, diff, or replay a single `StateNode`. This
release adds that, reusing the harness's normalize/stable-stringify discipline and
the v0.1.25 fingerprint/freshness pattern — without forking `StateNode`, the eval
harness, or the run-state schema (all additive).

The discipline is the same base-system separation used elsewhere: the mechanism
captures/diffs/replays one node by id; nothing decides which node "matters".

## Snapshot — derived + fingerprinted

A `NodeSnapshot` is a DERIVED projection of one `StateNode`: its body is normalized
(timestamps/paths stripped via the eval harness's `normalizeValue`), so it is
byte-stable across captures of the same logical state. It carries a
`sourceFingerprint` — sha256 over the RAW node (`id:status:updatedAt` + artifact
and evidence ids/paths) — so any transition flips it.

```text
node snapshot <run-id> <node-id> [--json]
```

Persisted under `<run>/nodes/snapshots/<node-id>/<snapshot-id>.json`; the source
`<run>/nodes/<id>.json` stays the truth. The `snapshot-id` is content-addressed
(`snap-<node>-<fingerprint>`), so re-snapshotting an unchanged node is idempotent.

## Freshness — fail closed on drift

Every load recomputes the fingerprint from the current source and emits a
freshness verdict:

- `valid` — source matches the snapshot.
- `stale` — the source node changed since capture.
- `absent` — the node, or a referenced artifact path, is gone/unreadable.

`stale` and `absent` both REFUSE diff/replay with a structured `NodeSnapshotError`
naming the divergence — never a silent stale replay, never a best-effort partial.

## Diff — stable + structural

```text
node diff <run-id> <baseline-snapshot-id> <candidate-snapshot-id> [--json]
```

Per-section (`status`/`inputs`/`outputs`/`artifacts`/`evidence`/`errors`/`links`/
`metadata`) `added|removed|changed|same`, ordered deterministically by the same
`stableStringify` the eval comparison uses. Byte-identical across repeated runs.

## Replay — isolated + deterministic

```text
node replay <run-id> <snapshot-id> [--json]
```

Reconstructs the normalized node from the snapshot with `now` INJECTED — no
ambient `new Date()` in the deterministic payload. The result carries an
`outputFingerprint` over the normalized body, so two replays of one snapshot are
byte-identical (only `replayedAt`/`replayId`, which are now-derived, differ).
Replaying a `stale`/`absent` snapshot fails closed.

## Verify — replay vs source

```text
node verify <run-id> <replay-id> [--json]
```

Compares a replay to a FRESH snapshot of the source node and emits a pass/fail
verdict plus findings in the eval harness's `severity/category/reason/baselineRef/
replayRef` shape.

## Surfaces & Compatibility

`node.snapshot`/`node.diff`/`node.replay`/`node.replay.verify` are declared in the
capability registry as `surface: "both"`, so `cw node <verb> --json` and the
`cw_node_*` MCP tools render one core (`src/node-snapshot.ts`). Additive: no change
to `StateNode`, `STATE_NODE_SCHEMA_VERSION`, the run-state schema, the pipeline
contract, or existing eval-suite artifacts; pre-0.1.35 runs and snapshots stay
loadable. Exporting the previously-private eval-harness helpers
(`normalizeValue`/`stableStringify`/`lines`) and `fingerprintStrings` is purely
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

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.
