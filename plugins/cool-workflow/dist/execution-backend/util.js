"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = sha256;
exports.hasExecutable = hasExecutable;
exports.firstString = firstString;
exports.messageOf = messageOf;
// Leaf helpers for the execution-backend driver layer. Carved out of
// execution-backend.ts (FreeBSD-audit god-module carve) so the driver layer no
// longer bundles its pure utilities; the parent re-exports `sha256` to keep the
// public surface byte-identical, and imports the rest internally.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Each function is a
// pure leaf (no dependency on the rest of the module), matching the existing
// router pattern (run-registry/derive.ts + format.ts, orchestrator/*-operations.ts).
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function sha256(value) {
    return `sha256:${node_crypto_1.default.createHash("sha256").update(value, "utf8").digest("hex")}`;
}
function hasExecutable(name) {
    const dirs = (process.env.PATH || "").split(node_path_1.default.delimiter).filter(Boolean);
    for (const dir of dirs) {
        const candidate = node_path_1.default.join(dir, name);
        try {
            if (node_fs_1.default.existsSync(candidate) && node_fs_1.default.statSync(candidate).isFile())
                return true;
        }
        catch {
            // ignore unreadable PATH entries
        }
    }
    return false;
}
function firstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return undefined;
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
