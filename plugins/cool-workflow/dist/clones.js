"use strict";
// src/clones.ts — manage the remote-source clone cache that `--link`/URL reviews populate.
//
// The cache lives under resolveCwHome()/clones/<hash>/ (one content-addressed checkout per
// URL+ref). `cw clones list` inspects it; `cw clones gc` reclaims it (a TTL sweep, or --all).
// Pure filesystem work — no network, no git. Fail closed: gc only ever deletes a path it has
// proven is INSIDE the clones root (the hash dir names are hex, so this always holds; the
// assertion guards against a future change).
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listClones = listClones;
exports.gcClones = gcClones;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const run_registry_1 = require("./run-registry");
function isTrue(value) {
    return value === true || value === "true" || value === "1" || value === 1;
}
function optionalNumber(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}
function clonesRoot(args) {
    // resolveCwHome reads CW_HOME/XDG_STATE_HOME from the environment — the same root the
    // materialize step writes to, so list/gc see exactly what `--link` created.
    void args;
    return node_path_1.default.join((0, run_registry_1.resolveCwHome)(), "clones");
}
/** Total bytes of a directory tree, NOT following symlinks (lstat). Missing/unreadable
 *  entries are skipped — sizing is best-effort and must never throw. */
function dirSize(dir) {
    let total = 0;
    const walk = (d) => {
        let names;
        try {
            names = node_fs_1.default.readdirSync(d);
        }
        catch {
            return;
        }
        for (const name of names) {
            const p = node_path_1.default.join(d, name);
            let st;
            try {
                st = node_fs_1.default.lstatSync(p);
            }
            catch {
                continue;
            }
            if (st.isDirectory())
                walk(p);
            else
                total += st.size;
        }
    };
    walk(dir);
    return total;
}
function readEntries(root) {
    let names = [];
    try {
        names = node_fs_1.default.readdirSync(root);
    }
    catch {
        return []; // no cache yet
    }
    const entries = [];
    for (const hash of names) {
        if (hash.startsWith("."))
            continue; // skip in-progress .stage-* temp dirs
        const dir = node_path_1.default.join(root, hash);
        let st;
        try {
            st = node_fs_1.default.statSync(dir);
        }
        catch {
            continue;
        }
        if (!st.isDirectory())
            continue;
        let meta = {};
        try {
            meta = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(dir, ".cw-clone-meta.json"), "utf8"));
        }
        catch {
            /* legacy/partial entry without meta — still listable/reclaimable */
        }
        entries.push({
            hash,
            url: typeof meta.url === "string" ? meta.url : "(unknown)",
            kind: typeof meta.kind === "string" ? meta.kind : "git",
            ref: typeof meta.ref === "string" ? meta.ref : null,
            fetchedAt: typeof meta.fetchedAt === "string" ? meta.fetchedAt : null,
            commit: typeof meta.commit === "string" ? meta.commit : null,
            bytes: dirSize(dir)
        });
    }
    entries.sort((a, b) => (a.fetchedAt || "").localeCompare(b.fetchedAt || ""));
    return entries;
}
/** `cw clones list` — every cached remote checkout with its origin, commit, age, and size. */
function listClones(args) {
    const root = clonesRoot(args);
    const entries = readEntries(root);
    return {
        schemaVersion: 1,
        clonesDir: root,
        count: entries.length,
        totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0),
        entries
    };
}
/** `cw clones gc [--older-than-days N] [--all]` — reclaim cached checkouts. Default keeps
 *  entries fetched within the last 30 days; `--all` removes every entry. Deletes ONLY paths
 *  proven inside the clones root (fail closed). `--now` (ISO) is injectable for deterministic
 *  tests; an entry with no fetchedAt is treated as old (eligible). */
function gcClones(args) {
    const root = clonesRoot(args);
    const all = isTrue(args.all);
    let olderThanDays = null;
    if (!all) {
        const raw = args.olderThanDays ?? args["older-than-days"];
        olderThanDays = optionalNumber(raw) ?? 30;
        if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
            throw new Error(`--older-than-days must be a non-negative number (got ${String(raw)})`);
        }
    }
    let now = Date.now();
    if (args.now !== undefined) {
        now = new Date(String(args.now)).getTime();
        if (!Number.isFinite(now))
            throw new Error(`--now must be a valid ISO date (got ${String(args.now)})`);
    }
    const cutoff = olderThanDays != null ? now - olderThanDays * 24 * 60 * 60 * 1000 : Infinity;
    const rootResolved = node_path_1.default.resolve(root);
    const removed = [];
    let freedBytes = 0;
    const entries = readEntries(root);
    for (const entry of entries) {
        if (!all) {
            // Fail-SAFE: a TTL sweep reclaims only entries we can PROVE are old enough. An entry with
            // no (or an unparseable) fetchedAt is a partial/legacy materialize that never wrote meta —
            // we cannot date it, so we KEEP it (never delete what you can't age). `--all` clears them.
            if (!entry.fetchedAt)
                continue;
            const age = new Date(entry.fetchedAt).getTime();
            if (!Number.isFinite(age) || age > cutoff)
                continue;
        }
        const dir = node_path_1.default.join(root, entry.hash);
        if (!node_path_1.default.resolve(dir).startsWith(rootResolved + node_path_1.default.sep))
            continue; // containment, fail closed
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
        removed.push({ hash: entry.hash, url: entry.url, bytes: entry.bytes });
        freedBytes += entry.bytes;
    }
    return { schemaVersion: 1, clonesDir: root, removed, freedBytes, keptCount: entries.length - removed.length, olderThanDays, all };
}
