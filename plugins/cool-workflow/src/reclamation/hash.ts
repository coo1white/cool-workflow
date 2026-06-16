// Content addressing + byte measurement for run reclamation (NO `du` — in-process
// only). Carved out of reclamation.ts (FreeBSD-audit god-module carve) so the pure
// content-addressing leaf no longer sits inside the write-ahead reclamation
// transaction. These are pure functions of their path/string inputs — no run
// state, no module-level mutable state.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. reclamation.ts
// re-exports the public symbols (sha256OfString/sha256OfFile/dirBytes) so the
// module's surface stays byte-identical.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { compareBytes } from "../compare";

function sha256Hex(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
export function sha256OfString(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}
export function sha256OfFile(file: string): string {
  return `sha256:${sha256Hex(fs.readFileSync(file))}`;
}

/** Walk a path and sum file sizes IN-PROCESS (no `du`). Returns 0 if absent. A
 *  file returns its own size; a dir returns the recursive sum. */
export function dirBytes(p: string): number {
  let total = 0;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    return 0;
  }
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    total += dirBytes(path.join(p, entry.name));
  }
  return total;
}

/** Stable content digest of a path (file = its bytes; dir = digest over each
 *  member's relative path + bytes, sorted). Lets the freed-manifest record a
 *  single sha per freed dir. */
export function contentDigest(p: string): string {
  const stat = fs.statSync(p);
  if (stat.isFile()) return sha256OfFile(p);
  const parts: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => compareBytes(a.name, b.name))) {
      const abs = path.join(dir, entry.name);
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(abs, r);
      else parts.push(`${r}:${sha256OfFile(abs)}`);
    }
  };
  walk(p, "");
  return sha256OfString(parts.join("\n"));
}
