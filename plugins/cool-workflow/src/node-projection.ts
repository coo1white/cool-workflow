// Canonical StateNode projection (F9 de-triplication) — the SINGLE source of
// truth for which StateNode fields make up the derived, fingerprinted body.
//
// Previously this 13-field set was hand-copied in three places: node-snapshot.ts's
// snapshotBody, reclamation.ts's snapshotProjectionDigest, and reclamation.ts's
// rawNodeBody/nodeBodyDigest (whose comment literally said "Mirror
// node-snapshot.ts"). Any field added in one place but not the others would drift
// the projection — and because reclamation hashes are tombstone-chained, a drift
// would silently break the chain. This module collapses the list to ONE export so
// the field set can only change in one place.
//
// BYTE-IDENTITY [load-bearing]: the projection / digest OUTPUT here is identical to
// the prior in-line implementations. `normalizeValue` sorts object keys, so the
// literal field ORDER never affected the bytes — only the field SET ever mattered.
// `replayStableStringify(value) === JSON.stringify(normalizeValue(value))` and
// `normalizeValue` is idempotent, so the projected-body digest and the raw-body
// digest funnel through the same canonical bytes (node-snapshot-diff-replay +
// reclamation smokes verify this).
//
// Pure: no I/O, no wall-clock, no random — safe in core/state/replay logic.

import { normalizeValue, replayStableStringify } from "./multi-agent-eval";
import { NodeSnapshotBody, StateNode } from "./types";

/** The raw (un-normalized) projection input: the canonical field set, copied off
 *  the StateNode with no scrubbing. `normalizeValue`/`replayStableStringify` apply
 *  the timestamp/path scrubbing downstream. This is the ONE place the field list
 *  lives — add or drop a projected field here and every consumer follows. */
export function rawNodeProjection(node: StateNode): Record<string, unknown> {
  return {
    id: node.id,
    kind: node.kind,
    status: node.status,
    loopStage: node.loopStage,
    inputs: node.inputs,
    outputs: node.outputs,
    artifacts: node.artifacts,
    evidence: node.evidence,
    errors: node.errors,
    parents: node.parents,
    children: node.children,
    contractId: node.contractId,
    metadata: node.metadata
  };
}

/** The normalized, derived projected body of one StateNode — timestamps/paths
 *  stripped via the eval normalizer, so it is byte-stable across captures of the
 *  same logical state. This is exactly node-snapshot.ts's historical snapshotBody. */
export function projectNodeBody(node: StateNode): NodeSnapshotBody {
  return normalizeValue(rawNodeProjection(node)) as NodeSnapshotBody;
}

/** Stable digest input for the projected body: the canonical bytes that the
 *  snapshot/reconstruction digests bind. `replayStableStringify` re-normalizes, so
 *  feeding the raw projection or the already-normalized body yields identical bytes. */
export function nodeProjectionDigestInput(node: StateNode): string {
  return replayStableStringify(rawNodeProjection(node));
}
