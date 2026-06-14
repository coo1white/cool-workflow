// Leaf helpers for the execution-backend driver layer. Carved out of
// execution-backend.ts (FreeBSD-audit god-module carve) so the driver layer no
// longer bundles its pure utilities; the parent re-exports `sha256` to keep the
// public surface byte-identical, and imports the rest internally.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Each function is a
// pure leaf (no dependency on the rest of the module), matching the existing
// router pattern (run-registry/derive.ts + format.ts, orchestrator/*-operations.ts).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sha256(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function hasExecutable(name: string): boolean {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return true;
    } catch {
      // ignore unreadable PATH entries
    }
  }
  return false;
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
