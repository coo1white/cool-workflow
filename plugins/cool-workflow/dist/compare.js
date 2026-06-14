"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareBytes = compareBytes;
// Locale-INDEPENDENT total order for strings (FreeBSD-audit L12 determinism).
//
// `String.localeCompare` is host/locale-sensitive: two hosts can order the same
// byte-identical strings differently. That is fine for human-facing display, but
// FATAL when the sorted order feeds a sha256 digest, a tombstone/hash chain, or a
// stable-persisted projection (index.json, messages.jsonl, an export manifest):
// the same content would then serialize/hash differently across hosts, breaking
// CW's cross-host reproducibility and replay-determinism guarantees.
//
// Use compareBytes() for any ordering that flows into a hash, an export, a
// persisted projection, or a commit/replay-bearing decision. Pure display sorts
// may keep localeCompare.
function compareBytes(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
