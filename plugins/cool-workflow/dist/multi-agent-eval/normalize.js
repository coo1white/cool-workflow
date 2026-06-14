"use strict";
// Pure, stateless normalization helpers for the multi-agent eval replay layer —
// timestamp/path scrubbing, recursive value normalization, and stable
// stringification. Carved out of multi-agent-eval.ts (FreeBSD-audit god-module
// split) so the eval router no longer bundles the deterministic-normalization
// primitives. Nothing here touches state; everything is a pure function of its
// arguments. Re-exported verbatim from multi-agent-eval.ts so every importer
// (including node-snapshot.ts and reclamation.ts) stays byte-unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeValue = normalizeValue;
exports.lines = lines;
exports.replayStableStringify = replayStableStringify;
function normalizeValue(value) {
    if (Array.isArray(value))
        return value.map(normalizeValue);
    if (!value || typeof value !== "object") {
        if (typeof value === "string")
            return normalizeString(value);
        return value;
    }
    const record = value;
    const normalized = {};
    for (const key of Object.keys(record).sort()) {
        if (["createdAt", "updatedAt", "recordedAt", "selectedAt", "replayedAt", "generatedAt"].includes(key))
            continue;
        if (key.endsWith("Path") || key === "path" || key === "cwd" || key === "runDir" || key.endsWith("Dir")) {
            normalized[key] = normalizeString(String(record[key]));
        }
        else {
            normalized[key] = normalizeValue(record[key]);
        }
    }
    return normalized;
}
function normalizeString(value) {
    return value
        .replace(/[0-9]{8}T[0-9]{6}Z/g, "<timestamp>")
        .replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/g, "<timestamp>")
        .replace(/\/[^"\s]+\/\.cw\/runs\/[^"\s/]+/g, "<run-dir>")
        .replace(/\/[^"\s]+\/\.cw\/evals\/[^"\s/]+/g, "<eval-dir>")
        .replace(/\/var\/folders\/[^"\s]+|\/tmp\/[^"\s]+|\/private\/tmp\/[^"\s]+/g, "<tmp>");
}
function lines(value) {
    const normalized = normalizeValue(value);
    if (Array.isArray(normalized))
        return normalized.map((entry) => replayStableStringify(entry)).sort();
    return [replayStableStringify(normalized)].sort();
}
function replayStableStringify(value) {
    return JSON.stringify(normalizeValue(value));
}
