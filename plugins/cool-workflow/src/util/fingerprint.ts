// Deterministic content fingerprint — the single canonical implementation.
// Replaces duplicated copies in observability.ts and run-registry.ts (v0.1.95).
// Pure function of its arguments; never imports run state or high-level modules.
import crypto from "node:crypto";

export function fingerprintStrings(values: string[]): string {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify([...values].sort()));
  return `sha256:${hash.digest("hex").slice(0, 32)}`;
}

export function fingerprintRecords(records: Array<{ id: string; status?: string; updatedAt?: string }>): string {
  return fingerprintStrings(records.map((r) => `${r.id}:${r.status || ""}`).sort());
}
