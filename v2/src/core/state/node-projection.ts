// core/state/node-projection.ts — the canonical StateNode projection.
//
// MILESTONE 3. Byte-exact port of the old build's src/node-projection.ts
// PLUS the `normalizeValue`/`replayStableStringify` pair it depends on
// (src/multi-agent-eval/normalize.ts:9-45). This is the SINGLE source of
// truth for the 13-field projected-node shape; node-snapshot.ts and (in a
// later milestone) reclamation.ts's tombstone chain both read from here so
// the field set can only change in one place.
//
// BYTE-IDENTITY [load-bearing]: `normalizeValue` sorts object keys, so field
// ORDER never affects the bytes — only the field SET matters.
// `replayStableStringify(value) === JSON.stringify(normalizeValue(value))`.
//
// Pure: no I/O, no wall-clock, no random.
//
// Evidence: SPEC/state-core.md "src/node-projection.ts — the canonical node
// projection", "normalizeValue ... drops the keys createdAt, updatedAt,
// recordedAt, selectedAt, replayedAt, generatedAt ...".

import { NodeSnapshotBody, StateNode } from "./types";

const SCRUBBED_TIMESTAMP_KEYS = new Set(["createdAt", "updatedAt", "recordedAt", "selectedAt", "replayedAt", "generatedAt"]);

/** Recursively sorts object keys, drops timestamp-shaped keys, and scrubs
 *  timestamp/tmp-path substrings out of every string value (so a snapshot
 *  body captured at two different wall-clock times, in two different tmp
 *  dirs, is byte-identical). Ported literally from the old build's
 *  src/multi-agent-eval/normalize.ts — this is the ONE normalizer every
 *  node snapshot/replay/diff/eval-line path shares. */
export function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return normalizeString(value);
    return value;
  }
  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (SCRUBBED_TIMESTAMP_KEYS.has(key)) continue;
    if (key.endsWith("Path") || key === "path" || key === "cwd" || key === "runDir" || key.endsWith("Dir")) {
      normalized[key] = normalizeString(String(record[key]));
    } else {
      normalized[key] = normalizeValue(record[key]);
    }
  }
  return normalized;
}

function normalizeString(value: string): string {
  return value
    .replace(/[0-9]{8}T[0-9]{6}Z/g, "<timestamp>")
    .replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/g, "<timestamp>")
    .replace(/\/[^"\s]+\/\.cw\/runs\/[^"\s/]+/g, "<run-dir>")
    .replace(/\/[^"\s]+\/\.cw\/evals\/[^"\s/]+/g, "<eval-dir>")
    .replace(/\/var\/folders\/[^"\s]+|\/tmp\/[^"\s]+|\/private\/tmp\/[^"\s]+/g, "<tmp>");
}

/** Deterministic bytes over a normalized value. */
export function replayStableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

/** The ONE place that lists the 13 projected fields (no `createdAt`/
 *  `updatedAt`/`schemaVersion`). Add or drop a projected field here and
 *  every consumer follows. */
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
    metadata: node.metadata,
  };
}

/** `normalizeValue(rawNodeProjection(node))` — the `NodeSnapshotBody`. */
export function projectNodeBody(node: StateNode): NodeSnapshotBody {
  return normalizeValue(rawNodeProjection(node)) as NodeSnapshotBody;
}

/** `replayStableStringify(rawNodeProjection(node))` — shared with a later
 *  milestone's reclamation tombstone chain so it cannot drift. */
export function nodeProjectionDigestInput(node: StateNode): string {
  return replayStableStringify(rawNodeProjection(node));
}
