// Pure, stateless helpers for the state-explosion derived-index layer —
// status priority, fingerprinting, deterministic key-sorting, id/string
// utilities. Carved out of state-explosion.ts (FreeBSD-audit god-module carve)
// so the report/graph/digest builders no longer bundle the primitive helper
// layer. Nothing here touches run state beyond its arguments; every function is
// pure (`fingerprintStrings` is re-exported from state-explosion.ts to keep the
// public surface byte-identical for importers).
import crypto from "node:crypto";
import { WorkflowRun } from "../types";

export function isProtectedStatus(status: string): boolean {
  return ["failed", "blocked", "rejected", "conflicting"].includes(status);
}

export function dominantStatus(statuses: string[]): string {
  for (const priority of ["failed", "blocked", "rejected", "conflicting", "running", "pending"]) {
    if (statuses.includes(priority)) return priority;
  }
  return statuses[0] || "completed";
}

export function parentMap(edges: Array<{ from: string; to: string }>): Map<string, string> {
  const parents = new Map<string, string>();
  for (const edge of edges) {
    if (!parents.has(edge.to)) parents.set(edge.to, edge.from);
  }
  return parents;
}

export function fingerprintRecords(records: Array<{ id: string; status?: string; updatedAt?: string }>): string {
  return fingerprintStrings(records.map((r) => `${r.id}:${r.status || ""}`).sort());
}

export function fingerprintStrings(values: string[]): string {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify([...values].sort()));
  return `sha256:${hash.digest("hex").slice(0, 32)}`;
}

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

export function stripRunId(run: WorkflowRun, id: string): string {
  return id.startsWith(`${run.id}:`) ? id.slice(run.id.length + 1) : id;
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

export function truncate(value: string): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > 80 ? `${single.slice(0, 77)}...` : single;
}

export function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, "-");
}
