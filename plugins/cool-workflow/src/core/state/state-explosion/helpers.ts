// core/state/state-explosion/helpers.ts — pure, stateless helpers for the
// state-explosion derived-index layer.
//
// MILESTONE 4. Byte-exact port of the old build's
// src/state-explosion/helpers.ts. `fingerprintStrings`/`fingerprintRecords`
// live in core/hash.ts (the one hash module, per docs/rebuild/PLAN.md's byte-compat
// item 2) and are re-exported here so every importer of this file keeps
// the same surface the old build had.
//
// BYTE-COMPAT ITEM 3 [load-bearing]: this file's `unique` DROPS falsy
// values AND SORTS its output. This is the kernel-side, SORTING variant —
// a later milestone's topology/candidate/host-decide code has its OWN
// separate `unique` (dedup-only, unsorted) that must NEVER be merged with
// this one; collapsing them changes persisted record order and eval
// parity (docs/rebuild/PLAN.md byte-compat item 3, Open risk 2). See
// core/state/state-node.ts's own local `unique` for the sibling that must
// stay separate.
//
// Evidence: SPEC/state-core.md "Helpers (src/state-explosion/helpers.ts)".

import { fingerprintRecords, fingerprintStrings } from "../../hash";

export { fingerprintRecords, fingerprintStrings };

/** True for `failed`, `blocked`, `rejected`, `conflicting` — the never-
 *  collapse status set (docs/rebuild/PLAN.md byte-compat item 9). */
export function isProtectedStatus(status: string): boolean {
  return ["failed", "blocked", "rejected", "conflicting"].includes(status);
}

/** Priority order `failed, blocked, rejected, conflicting, running,
 *  pending`; else the first status; else `"completed"`. */
export function dominantStatus(statuses: string[]): string {
  for (const priority of ["failed", "blocked", "rejected", "conflicting", "running", "pending"]) {
    if (statuses.includes(priority)) return priority;
  }
  return statuses[0] || "completed";
}

/** First edge in wins — `Map<childId, parentId>` built by iterating edges
 *  in order and only setting an id the first time it is seen as a `to`. */
export function parentMap(edges: Array<{ from: string; to: string }>): Map<string, string> {
  const parents = new Map<string, string>();
  for (const edge of edges) {
    if (!parents.has(edge.to)) parents.set(edge.to, edge.from);
  }
  return parents;
}

/** Key-sorted `JSON.stringify` — used for deterministic eval lines. */
export function stableLine(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) result[key] = sortKeys(record[key]);
    return result;
  }
  return value;
}

export function stripRunId(run: { id: string }, id: string): string {
  return id.startsWith(`${run.id}:`) ? id.slice(run.id.length + 1) : id;
}

/** DROPS falsy values, then sorts (default string sort). This is the
 *  kernel-side SORTING `unique` — see the file header's byte-compat note;
 *  never merge with an unsorted dedup-only sibling. */
export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

/** Whitespace-collapsed; over 80 chars becomes the first 77 chars + `...`. */
export function truncate(value: string): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > 80 ? `${single.slice(0, 77)}...` : single;
}

/** Chars outside `[a-zA-Z0-9._:-]` become `-`. */
export function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, "-");
}
