// core/state/validation.ts — RecordValidationError + per-record shape
// guards.
//
// MILESTONE 3. Byte-exact port of the parts of the old build's
// src/validation.ts this milestone's conformance filter actually reaches
// (NodeSnapshot / NodeReplayRun, both read at the `readNodeSnapshot`/
// `readNodeReplay` edge in shell/node-store.ts). WorkerScope/
// CandidateScore/CandidateRecord guards land with their owning milestone
// (5/9) rather than being spec'd ahead of need here.
//
// Two callers, two error semantics, both fail closed:
//   - validate*()     throws a descriptive Error on mismatch.
//   - tryValidate*()  returns null on mismatch (never throws).
//
// Dependency-light by construction: imports only from ./types. No fs, no
// clock, no randomness — pure structural checks, safe in replay/core paths.
//
// Evidence: SPEC/state-core.md "src/validation.ts — persisted-record shape
// guards", "Fail-closed record reads".

import { NodeReplayRun, NodeSnapshot, NodeSnapshotBody, NodeSnapshotFreshness } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((entry) => isRecord(entry));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

const SNAPSHOT_FRESHNESS: ReadonlySet<string> = new Set<NodeSnapshotFreshness>(["valid", "stale", "absent"]);

/** Descriptive integrity error — the message names the type and the field
 *  that broke, so a corrupt record is diagnosable from logs alone. */
export class RecordValidationError extends Error {
  code = "record-shape-invalid";
  typeName: string;
  field?: string;
  constructor(typeName: string, reason: string, field?: string) {
    super(`Invalid persisted ${typeName}: ${reason}`);
    this.name = "RecordValidationError";
    this.typeName = typeName;
    this.field = field;
  }
}

function nodeSnapshotBodyReason(value: unknown, prefix: string): { field?: string; reason: string } | undefined {
  if (!isRecord(value)) return { field: prefix, reason: "must be a NodeSnapshotBody object" };
  const requiredStrings: (keyof NodeSnapshotBody)[] = ["id", "kind", "status", "loopStage"];
  for (const field of requiredStrings) {
    if (!isString(value[field as string])) return { field: `${prefix}.${String(field)}`, reason: "must be a string" };
  }
  if (!isRecord(value.inputs)) return { field: `${prefix}.inputs`, reason: "must be an object" };
  if (!isRecord(value.outputs)) return { field: `${prefix}.outputs`, reason: "must be an object" };
  if (!isObjectArray(value.artifacts)) return { field: `${prefix}.artifacts`, reason: "must be a StateArtifact[]" };
  if (!isObjectArray(value.evidence)) return { field: `${prefix}.evidence`, reason: "must be a StateEvidence[]" };
  if (!isObjectArray(value.errors)) return { field: `${prefix}.errors`, reason: "must be a StateNodeError[]" };
  if (!isStringArray(value.parents)) return { field: `${prefix}.parents`, reason: "must be a string[]" };
  if (!isStringArray(value.children)) return { field: `${prefix}.children`, reason: "must be a string[]" };
  return undefined;
}

function nodeSnapshotReason(value: unknown): { field?: string; reason: string } | undefined {
  if (!isRecord(value)) return { reason: "not an object" };
  if (value.schemaVersion !== 1) return { field: "schemaVersion", reason: "must equal 1" };
  const requiredStrings: (keyof NodeSnapshot)[] = ["snapshotId", "runId", "nodeId", "capturedAt", "sourceFingerprint"];
  for (const field of requiredStrings) {
    if (!isString(value[field as string])) return { field: field as string, reason: "must be a string" };
  }
  return nodeSnapshotBodyReason(value.body, "body");
}

/** Throw-on-mismatch guard for NodeSnapshot (read edge requires the
 *  record). */
export function validateNodeSnapshot(value: unknown): NodeSnapshot {
  const problem = nodeSnapshotReason(value);
  if (problem) throw new RecordValidationError("NodeSnapshot", problem.reason, problem.field);
  return value as NodeSnapshot;
}

function nodeReplayRunReason(value: unknown): { field?: string; reason: string } | undefined {
  if (!isRecord(value)) return { reason: "not an object" };
  if (value.schemaVersion !== 1) return { field: "schemaVersion", reason: "must equal 1" };
  const requiredStrings: (keyof NodeReplayRun)[] = ["replayId", "runId", "nodeId", "snapshotId", "replayedAt", "outputFingerprint"];
  for (const field of requiredStrings) {
    if (!isString(value[field as string])) return { field: field as string, reason: "must be a string" };
  }
  if (!isString(value.freshness) || !SNAPSHOT_FRESHNESS.has(value.freshness)) {
    return { field: "freshness", reason: "must be a valid NodeSnapshotFreshness" };
  }
  if (typeof value.contractValidated !== "boolean") {
    return { field: "contractValidated", reason: "must be a boolean" };
  }
  return nodeSnapshotBodyReason(value.body, "body");
}

/** Throw-on-mismatch guard for NodeReplayRun (read edge requires the
 *  record). */
export function validateNodeReplayRun(value: unknown): NodeReplayRun {
  const problem = nodeReplayRunReason(value);
  if (problem) throw new RecordValidationError("NodeReplayRun", problem.reason, problem.field);
  return value as NodeReplayRun;
}
