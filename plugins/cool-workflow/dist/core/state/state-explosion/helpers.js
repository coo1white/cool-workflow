"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.fingerprintStrings = exports.fingerprintRecords = void 0;
exports.isProtectedStatus = isProtectedStatus;
exports.dominantStatus = dominantStatus;
exports.parentMap = parentMap;
exports.stableLine = stableLine;
exports.sortKeys = sortKeys;
exports.stripRunId = stripRunId;
exports.unique = unique;
exports.byId = byId;
exports.truncate = truncate;
exports.slug = slug;
const hash_1 = require("../../hash");
Object.defineProperty(exports, "fingerprintRecords", { enumerable: true, get: function () { return hash_1.fingerprintRecords; } });
Object.defineProperty(exports, "fingerprintStrings", { enumerable: true, get: function () { return hash_1.fingerprintStrings; } });
const collate_1 = require("../../util/collate");
/** True for `failed`, `blocked`, `rejected`, `conflicting` — the never-
 *  collapse status set (docs/rebuild/PLAN.md byte-compat item 9). */
function isProtectedStatus(status) {
    return ["failed", "blocked", "rejected", "conflicting"].includes(status);
}
/** Priority order `failed, blocked, rejected, conflicting, running,
 *  pending`; else the first status; else `"completed"`. */
function dominantStatus(statuses) {
    for (const priority of ["failed", "blocked", "rejected", "conflicting", "running", "pending"]) {
        if (statuses.includes(priority))
            return priority;
    }
    return statuses[0] || "completed";
}
/** First edge in wins — `Map<childId, parentId>` built by iterating edges
 *  in order and only setting an id the first time it is seen as a `to`. */
function parentMap(edges) {
    const parents = new Map();
    for (const edge of edges) {
        if (!parents.has(edge.to))
            parents.set(edge.to, edge.from);
    }
    return parents;
}
/** Key-sorted `JSON.stringify` — used for deterministic eval lines. */
function stableLine(value) {
    return JSON.stringify(sortKeys(value));
}
function sortKeys(value) {
    if (Array.isArray(value))
        return value.map(sortKeys);
    if (value && typeof value === "object") {
        const record = value;
        const result = {};
        for (const key of Object.keys(record).sort())
            result[key] = sortKeys(record[key]);
        return result;
    }
    return value;
}
function stripRunId(run, id) {
    return id.startsWith(`${run.id}:`) ? id.slice(run.id.length + 1) : id;
}
/** DROPS falsy values, then sorts (default string sort). This is the
 *  kernel-side SORTING `unique` — see the file header's byte-compat note;
 *  never merge with an unsorted dedup-only sibling. */
function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort();
}
function byId(a, b) {
    return (0, collate_1.stableCompare)(a.id, b.id);
}
/** Whitespace-collapsed; over 80 chars becomes the first 77 chars + `...`. */
function truncate(value) {
    const single = value.replace(/\s+/g, " ").trim();
    return single.length > 80 ? `${single.slice(0, 77)}...` : single;
}
/** Chars outside `[a-zA-Z0-9._:-]` become `-`. */
function slug(value) {
    return value.replace(/[^a-zA-Z0-9._:-]/g, "-");
}
