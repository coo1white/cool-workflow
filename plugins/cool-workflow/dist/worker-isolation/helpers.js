"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.structuredError = structuredError;
exports.isBoundaryViolation = isBoundaryViolation;
exports.isStateNodeError = isStateNodeError;
exports.mergeScopes = mergeScopes;
exports.unique = unique;
exports.compactMetadata = compactMetadata;
exports.countBy = countBy;
function structuredError(code, message, options = {}) {
    return {
        code,
        message,
        at: new Date().toISOString(),
        path: options.path,
        retryable: options.retryable,
        details: options.details
    };
}
function isBoundaryViolation(value) {
    return Boolean(value && typeof value === "object" && "allowedPaths" in value && "message" in value);
}
function isStateNodeError(value) {
    return Boolean(value && typeof value === "object" && "code" in value && "message" in value);
}
function mergeScopes(left, right) {
    const merged = [...left];
    for (const scope of right) {
        const index = merged.findIndex((candidate) => candidate.id === scope.id);
        if (index >= 0)
            merged[index] = scope;
        else
            merged.push(scope);
    }
    return merged;
}
function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
function compactMetadata(value) {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
}
function countBy(items, key) {
    const counts = {};
    for (const item of items) {
        const value = key(item);
        counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
}
