"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProtectedStatus = isProtectedStatus;
exports.dominantStatus = dominantStatus;
exports.parentMap = parentMap;
exports.fingerprintRecords = fingerprintRecords;
exports.fingerprintStrings = fingerprintStrings;
exports.stableLine = stableLine;
exports.sortKeys = sortKeys;
exports.stripRunId = stripRunId;
exports.unique = unique;
exports.byId = byId;
exports.truncate = truncate;
exports.slug = slug;
// Pure, stateless helpers for the state-explosion derived-index layer —
// status priority, fingerprinting, deterministic key-sorting, id/string
// utilities. Carved out of state-explosion.ts (FreeBSD-audit god-module carve)
// so the report/graph/digest builders no longer bundle the primitive helper
// layer. Nothing here touches run state beyond its arguments; every function is
// pure (`fingerprintStrings` is re-exported from state-explosion.ts to keep the
// public surface byte-identical for importers).
const node_crypto_1 = __importDefault(require("node:crypto"));
function isProtectedStatus(status) {
    return ["failed", "blocked", "rejected", "conflicting"].includes(status);
}
function dominantStatus(statuses) {
    for (const priority of ["failed", "blocked", "rejected", "conflicting", "running", "pending"]) {
        if (statuses.includes(priority))
            return priority;
    }
    return statuses[0] || "completed";
}
function parentMap(edges) {
    const parents = new Map();
    for (const edge of edges) {
        if (!parents.has(edge.to))
            parents.set(edge.to, edge.from);
    }
    return parents;
}
function fingerprintRecords(records) {
    return fingerprintStrings(records.map((r) => `${r.id}:${r.status || ""}`).sort());
}
function fingerprintStrings(values) {
    const hash = node_crypto_1.default.createHash("sha256");
    hash.update(JSON.stringify([...values].sort()));
    return `sha256:${hash.digest("hex").slice(0, 32)}`;
}
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
function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort();
}
function byId(a, b) {
    return a.id.localeCompare(b.id);
}
function truncate(value) {
    const single = value.replace(/\s+/g, " ").trim();
    return single.length > 80 ? `${single.slice(0, 77)}...` : single;
}
function slug(value) {
    return value.replace(/[^a-zA-Z0-9._:-]/g, "-");
}
