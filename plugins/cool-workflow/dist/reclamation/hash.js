"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256OfString = sha256OfString;
exports.sha256OfFile = sha256OfFile;
exports.dirBytes = dirBytes;
exports.contentDigest = contentDigest;
// Content addressing + byte measurement for run reclamation (NO `du` — in-process
// only). Carved out of reclamation.ts (FreeBSD-audit god-module carve) so the pure
// content-addressing leaf no longer sits inside the write-ahead reclamation
// transaction. These are pure functions of their path/string inputs — no run
// state, no module-level mutable state.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. reclamation.ts
// re-exports the public symbols (sha256OfString/sha256OfFile/dirBytes) so the
// module's surface stays byte-identical.
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const compare_1 = require("../compare");
function sha256Hex(value) {
    return node_crypto_1.default.createHash("sha256").update(value).digest("hex");
}
function sha256OfString(value) {
    return `sha256:${sha256Hex(value)}`;
}
function sha256OfFile(file) {
    return `sha256:${sha256Hex(node_fs_1.default.readFileSync(file))}`;
}
/** Walk a path and sum file sizes IN-PROCESS (no `du`). Returns 0 if absent. A
 *  file returns its own size; a dir returns the recursive sum. */
function dirBytes(p) {
    let total = 0;
    let stat;
    try {
        stat = node_fs_1.default.statSync(p);
    }
    catch {
        return 0;
    }
    if (stat.isFile())
        return stat.size;
    if (!stat.isDirectory())
        return 0;
    for (const entry of node_fs_1.default.readdirSync(p, { withFileTypes: true })) {
        total += dirBytes(node_path_1.default.join(p, entry.name));
    }
    return total;
}
/** Stable content digest of a path (file = its bytes; dir = digest over each
 *  member's relative path + bytes, sorted). Lets the freed-manifest record a
 *  single sha per freed dir. */
function contentDigest(p) {
    const stat = node_fs_1.default.statSync(p);
    if (stat.isFile())
        return sha256OfFile(p);
    const parts = [];
    const walk = (dir, rel) => {
        for (const entry of node_fs_1.default.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (0, compare_1.compareBytes)(a.name, b.name))) {
            const abs = node_path_1.default.join(dir, entry.name);
            const r = node_path_1.default.join(rel, entry.name);
            if (entry.isDirectory())
                walk(abs, r);
            else
                parts.push(`${r}:${sha256OfFile(abs)}`);
        }
    };
    walk(p, "");
    return sha256OfString(parts.join("\n"));
}
