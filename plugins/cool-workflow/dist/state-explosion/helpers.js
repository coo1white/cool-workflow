"use strict";
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
const fingerprint_1 = require("../util/fingerprint");
Object.defineProperty(exports, "fingerprintRecords", { enumerable: true, get: function () { return fingerprint_1.fingerprintRecords; } });
Object.defineProperty(exports, "fingerprintStrings", { enumerable: true, get: function () { return fingerprint_1.fingerprintStrings; } });
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
