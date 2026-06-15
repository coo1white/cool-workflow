// Pure, self-contained primitive helpers for the coordinator/blackboard layer
// (FreeBSD-audit R-carve). Carved out of coordinator.ts so the module no longer
// bundles the generic id/string/redaction utilities alongside the stateful
// blackboard operations. Re-exported from coordinator.ts to keep the public
// surface byte-identical.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Every function
// here is a function of its inputs only: no WorkflowRun, no blackboard state, no
// filesystem mutation. They depend on node:crypto / node:fs only for checksum +
// file read, and on ./compare + ./state for the byte comparator and safe file
// name (the same helpers the originals used).
import crypto from "node:crypto";
import fs from "node:fs";
import { compareBytes } from "../compare";
import { safeFileName } from "../state";
import type { BlackboardGraph } from "../coordinator";

export function checksumFile(file: string): string {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

export function assertUnique(items: Array<{ id: string }>, id: string, label: string): void {
  if (items.some((item) => item.id === id)) throw new Error(`Duplicate ${label} id: ${id}`);
}

export function assertNoRecordPathCollisions(label: string, records: Array<{ id: string }>): void {
  const seen = new Map<string, string>();
  for (const record of records) {
    const safe = safeFileName(record.id);
    const existing = seen.get(safe);
    if (existing && existing !== record.id) {
      throw new Error(`${label} ids ${existing} and ${record.id} collide on safe file name ${safe}`);
    }
    seen.set(safe, record.id);
  }
}

export function indexRow(record: { id: string; status?: string; updatedAt?: string; blackboardId?: string; topicId?: string }): Record<string, unknown> {
  return { id: record.id, blackboardId: record.blackboardId, topicId: record.topicId, status: record.status, updatedAt: record.updatedAt };
}

export function compareRecords(left: { createdAt: string; id: string }, right: { createdAt: string; id: string }): number {
  return compareBytes(left.createdAt, right.createdAt) || compareBytes(left.id, right.id);
}

export function uniqueEdges(edges: BlackboardGraph["edges"]): BlackboardGraph["edges"] {
  const seen = new Set<string>();
  const result: BlackboardGraph["edges"] = [];
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.label || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

// Deterministic record id — single source of truth in ../multi-agent/ids.
// Re-exported here so coordinator.ts importers stay byte-unchanged (F10 dedup:
// the multi-agent kernel shares the exact same helper).
export { createId } from "../multi-agent/ids";

export function touch<T extends { updatedAt: string }>(record: T): T {
  record.updatedAt = timestamp();
  return record;
}

export function timestamp(): string {
  return new Date().toISOString();
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function sortTags(values: string[] | undefined): string[] {
  return unique(values || []);
}

export function truncate(value: string): string {
  return value.length > 64 ? `${value.slice(0, 61)}...` : value;
}

export function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && (!Array.isArray(entry) || entry.length > 0)));
}

// Recursive secret redaction (v0.1.40 self-audit P3): the previous scrub only
// inspected TOP-LEVEL keys, so a secret nested under an allowed key
// (e.g. `metadata.config.token`) leaked into the recorded coordinator decision.
// Now we recurse into nested objects and arrays so a secret-named key at any depth
// is dropped and an obvious credential value is redacted.
const SECRET_KEY_RE = /secret|token|password|credential|authorization|api[_-]?key|env/i;
const SECRET_VALUE_RE = /secret|token|password|credential/i;

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") return scrub(value as Record<string, unknown>);
  if (typeof value === "string" && SECRET_VALUE_RE.test(value)) return "[redacted]";
  return value;
}

export function scrub(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (SECRET_KEY_RE.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = scrubValue(entry);
    }
  }
  return Object.keys(result).length ? result : undefined;
}
