// Orphan Run Sweep — reclaims run directories left behind by a killed or
// interrupted process BEFORE it ever wrote a state.json (a gap found 2026-07-02:
// a release-cut gate tripped on stray `.cw/runs/` entries the existing v0.1.39 gc
// (./gc.ts) can never reach — `reclaimEligibility` needs a `RunRecord`, and a run
// with no state.json is never even derived into one; see ../run-registry.ts
// `deriveRecord` (state.json existence check) and `scanRepo` (silently drops a
// directory with none — not even counted as "missing").
//
// This is ORTHOGONAL to gc.plan/gc.run, not an extension of them: those tier LIVE
// -> ARCHIVED -> RECLAIMED runs that HAVE durable state worth a skeleton and a
// tombstone. A directory with no state.json has recorded nothing — zero audit
// value by construction (the "pure scratch" free-eligible class from
// docs/run-retention-reclamation.7.md) — so there is nothing to seal and no
// tombstone is produced. This mirrors ../clones.ts's simpler list+TTL-gc shape,
// not the write-ahead reclamation transaction.
//
// Fail-closed boundary: a directory is an orphan candidate ONLY when state.json is
// genuinely ABSENT. A directory whose state.json exists but fails to parse is left
// alone — something was durably attempted there; that is gc.ts's territory (it
// will correctly report `unreadable`), not this one's. Age is the newest mtime
// found ANYWHERE in the directory tree, never just the directory's own mtime
// (which only reflects direct-child changes) — so a run still being populated is
// never swept out from under it. Known (indexed) run directories are excluded
// defense-in-depth, even though an indexed run always has a state.json by
// definition.

import fs from "node:fs";
import path from "node:path";
import { GcHost } from "./gc";

export interface OrphanRunEntry {
  repo: string;
  runId: string;
  path: string;
  ageMinutes: number;
  bytes: number;
}
export interface OrphanRunsListResult {
  schemaVersion: 1;
  scope: "repo" | "home";
  repos: string[];
  count: number;
  totalBytes: number;
  entries: OrphanRunEntry[];
}
export interface OrphanRunsGcResult {
  schemaVersion: 1;
  scope: "repo" | "home";
  removed: Array<{ repo: string; runId: string; path: string; bytes: number }>;
  freedBytes: number;
  keptCount: number;
  minAgeMinutes: number | null;
  all: boolean;
}

export const DEFAULT_ORPHAN_MIN_AGE_MINUTES = 60;

function resolveNowMs(now?: string): number {
  if (now === undefined) return Date.now();
  const ms = new Date(now).getTime();
  if (!Number.isFinite(ms)) throw new Error(`--now must be a valid ISO date (got ${now})`);
  return ms;
}

/** Walk a directory tree; return total bytes + the newest mtime found anywhere in
 *  it (including the directory itself). Best-effort — an unreadable path is
 *  skipped, never thrown (mirrors ../clones.ts's dirSize). */
function walk(dir: string): { bytes: number; newestMs: number } {
  let bytes = 0;
  let newestMs = 0;
  const bump = (p: string): void => {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      return;
    }
    if (st.mtimeMs > newestMs) newestMs = st.mtimeMs;
    if (st.isDirectory()) {
      let names: string[];
      try {
        names = fs.readdirSync(p);
      } catch {
        return;
      }
      for (const name of names) bump(path.join(p, name));
    } else {
      bytes += st.size;
    }
  };
  bump(dir);
  return { bytes, newestMs };
}

function runsDirFor(repo: string): string {
  return path.join(repo, ".cw", "runs");
}

function candidatesFor(repo: string, knownDirs: Set<string>, nowMs: number): OrphanRunEntry[] {
  const runsDir = runsDirFor(repo);
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: OrphanRunEntry[] = [];
  for (const entry of dirents) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(runsDir, entry.name);
    if (knownDirs.has(path.resolve(dir))) continue;
    if (fs.existsSync(path.join(dir, "state.json"))) continue; // something was attempted — gc.ts's territory
    const { bytes, newestMs } = walk(dir);
    const ageMinutes = Math.max(0, Math.round((nowMs - newestMs) / 60000));
    out.push({ repo, runId: entry.name, path: dir, ageMinutes, bytes });
  }
  return out;
}

function scan(host: GcHost, scope: "repo" | "home", nowMs: number): { repos: string[]; entries: OrphanRunEntry[] } {
  const index = host.buildIndex(scope);
  const known = new Set(index.records.map((r) => path.resolve(r.runDir)));
  const entries: OrphanRunEntry[] = [];
  for (const repo of index.repos) entries.push(...candidatesFor(repo, known, nowMs));
  return { repos: index.repos, entries };
}

/** `gc orphans list` (read-only) — every run directory under `.cw/runs/` that the
 *  registry cannot see (no state.json), with its age and size. Frees nothing. */
export function listOrphanRuns(host: GcHost, options: { scope?: "repo" | "home"; now?: string } = {}): OrphanRunsListResult {
  const scope = options.scope || "home";
  const { repos, entries } = scan(host, scope, resolveNowMs(options.now));
  return {
    schemaVersion: 1,
    scope,
    repos,
    count: entries.length,
    totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0),
    entries
  };
}

/** `gc orphans gc [--min-age-minutes N] [--all]` — reclaim orphan run directories.
 *  Default keeps anything touched within the last 60 minutes (protects a run still
 *  mid-creation); `--all` removes every orphan candidate regardless of age. Deletes
 *  ONLY paths proven inside a scanned repo's runs dir (fail closed), and re-checks
 *  state.json is still absent at delete time (TOCTOU-safe). */
export function gcOrphanRuns(host: GcHost, options: { scope?: "repo" | "home"; minAgeMinutes?: number; all?: boolean; now?: string } = {}): OrphanRunsGcResult {
  const scope = options.scope || "home";
  const all = Boolean(options.all);
  let minAgeMinutes: number | null = null;
  if (!all) {
    minAgeMinutes = options.minAgeMinutes ?? DEFAULT_ORPHAN_MIN_AGE_MINUTES;
    if (!Number.isFinite(minAgeMinutes) || minAgeMinutes < 0) {
      throw new Error(`--min-age-minutes must be a non-negative number (got ${String(options.minAgeMinutes)})`);
    }
  }
  const nowMs = resolveNowMs(options.now);
  const { entries } = scan(host, scope, nowMs);

  const removed: OrphanRunsGcResult["removed"] = [];
  let freedBytes = 0;
  for (const entry of entries) {
    if (!all && entry.ageMinutes < (minAgeMinutes as number)) continue;
    const runsDirResolved = path.resolve(runsDirFor(entry.repo));
    const resolved = path.resolve(entry.path);
    if (!resolved.startsWith(runsDirResolved + path.sep)) continue; // containment, fail closed
    if (fs.existsSync(path.join(resolved, "state.json"))) continue; // re-check at delete time
    fs.rmSync(resolved, { recursive: true, force: true });
    removed.push({ repo: entry.repo, runId: entry.runId, path: entry.path, bytes: entry.bytes });
    freedBytes += entry.bytes;
  }
  return {
    schemaVersion: 1,
    scope,
    removed,
    freedBytes,
    keptCount: entries.length - removed.length,
    minAgeMinutes,
    all
  };
}
