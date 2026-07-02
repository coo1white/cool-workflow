"use strict";
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
//
// NOT covered by "that's gc.ts's territory": a run stuck running/queued/blocked
// with a valid but stale state.json (its process died without reaching a
// terminal state) is reclaimed by NEITHER module — gc.ts's reclaimEligibility
// fail-closes on non-terminal with no age override, and it is not an orphan here
// since state.json exists. As of this writing that class of run has no
// reclamation path anywhere in cw; it stays retained indefinitely.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ORPHAN_MIN_AGE_MINUTES = void 0;
exports.listOrphanRuns = listOrphanRuns;
exports.gcOrphanRuns = gcOrphanRuns;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("../state");
exports.DEFAULT_ORPHAN_MIN_AGE_MINUTES = 60;
function resolveNowMs(now) {
    if (now === undefined)
        return Date.now();
    const ms = new Date(now).getTime();
    if (!Number.isFinite(ms))
        throw new Error(`--now must be a valid ISO date (got ${now})`);
    return ms;
}
/** Walk a directory tree; return total bytes + the newest mtime found anywhere in
 *  it (including the directory itself). Best-effort — an unreadable path is
 *  skipped, never thrown (mirrors ../clones.ts's dirSize). */
function walk(dir) {
    let bytes = 0;
    let newestMs = 0;
    const bump = (p) => {
        let st;
        try {
            st = node_fs_1.default.lstatSync(p);
        }
        catch {
            return;
        }
        if (st.mtimeMs > newestMs)
            newestMs = st.mtimeMs;
        if (st.isDirectory()) {
            let names;
            try {
                names = node_fs_1.default.readdirSync(p);
            }
            catch {
                return;
            }
            for (const name of names)
                bump(node_path_1.default.join(p, name));
        }
        else {
            bytes += st.size;
        }
    };
    bump(dir);
    return { bytes, newestMs };
}
function runsDirFor(repo) {
    return node_path_1.default.join(repo, ".cw", "runs");
}
function candidatesFor(repo, knownDirs, nowMs) {
    const runsDir = runsDirFor(repo);
    let dirents;
    try {
        dirents = node_fs_1.default.readdirSync(runsDir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const out = [];
    for (const entry of dirents) {
        if (!entry.isDirectory())
            continue;
        const dir = node_path_1.default.join(runsDir, entry.name);
        if (knownDirs.has(node_path_1.default.resolve(dir)))
            continue;
        if (node_fs_1.default.existsSync(node_path_1.default.join(dir, "state.json")))
            continue; // something was attempted — gc.ts's territory
        const { bytes, newestMs } = walk(dir);
        const ageMinutes = Math.max(0, Math.round((nowMs - newestMs) / 60000));
        out.push({ repo, runId: entry.name, path: dir, ageMinutes, bytes });
    }
    return out;
}
function scan(host, scope, nowMs) {
    const index = host.buildIndex(scope);
    const known = new Set(index.records.map((r) => node_path_1.default.resolve(r.runDir)));
    const entries = [];
    for (const repo of index.repos)
        entries.push(...candidatesFor(repo, known, nowMs));
    return { repos: index.repos, entries };
}
/** `gc orphans list` (read-only) — every run directory under `.cw/runs/` that the
 *  registry cannot see (no state.json), with its age and size. Frees nothing. */
function listOrphanRuns(host, options = {}) {
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
 *  ONLY paths proven inside a scanned repo's runs dir (fail closed). The re-check
 *  (state.json still absent) and the delete run inside the SAME `state.json.lock`
 *  held by `saveCheckpoint` (../state.ts) — a plain existsSync-then-rmSync would
 *  leave a real gap where a concurrent first checkpoint could finish its rename
 *  between the check and the delete, so the two are made mutually exclusive with
 *  the exact lock a live writer already takes. */
function gcOrphanRuns(host, options = {}) {
    const scope = options.scope || "home";
    const all = Boolean(options.all);
    let minAgeMinutes = null;
    if (!all) {
        minAgeMinutes = options.minAgeMinutes ?? exports.DEFAULT_ORPHAN_MIN_AGE_MINUTES;
        if (!Number.isFinite(minAgeMinutes) || minAgeMinutes < 0) {
            throw new Error(`--min-age-minutes must be a non-negative number (got ${String(options.minAgeMinutes)})`);
        }
    }
    const nowMs = resolveNowMs(options.now);
    const { entries } = scan(host, scope, nowMs);
    const removed = [];
    let freedBytes = 0;
    for (const entry of entries) {
        if (!all && entry.ageMinutes < minAgeMinutes)
            continue;
        const runsDirResolved = node_path_1.default.resolve(runsDirFor(entry.repo));
        const resolved = node_path_1.default.resolve(entry.path);
        if (!resolved.startsWith(runsDirResolved + node_path_1.default.sep))
            continue; // containment, fail closed
        const statePath = node_path_1.default.join(resolved, "state.json");
        const deleted = (0, state_1.withFileLock)(statePath, () => {
            if (node_fs_1.default.existsSync(statePath))
                return false; // a checkpoint landed between scan and here
            node_fs_1.default.rmSync(resolved, { recursive: true, force: true });
            return true;
        });
        if (!deleted)
            continue;
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
