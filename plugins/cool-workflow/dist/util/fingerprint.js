"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fingerprintStrings = fingerprintStrings;
exports.fingerprintRecords = fingerprintRecords;
// Deterministic content fingerprint — the single canonical implementation.
// Replaces duplicated copies in observability.ts and run-registry.ts (v0.1.95).
// Pure function of its arguments; never imports run state or high-level modules.
const node_crypto_1 = __importDefault(require("node:crypto"));
function fingerprintStrings(values) {
    const hash = node_crypto_1.default.createHash("sha256");
    hash.update(JSON.stringify([...values].sort()));
    return `sha256:${hash.digest("hex").slice(0, 32)}`;
}
function fingerprintRecords(records) {
    return fingerprintStrings(records.map((r) => `${r.id}:${r.status || ""}`).sort());
}
