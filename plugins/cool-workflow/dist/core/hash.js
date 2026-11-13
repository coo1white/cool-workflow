// core/hash.ts — the one hash/stringify module. Pure.
//
// Stored hashes depend on these exact bytes, so each spelling and each
// stringify behavior keeps its own name; never fold them into one flagged
// helper. Spec: SPEC/ledger-trust.md "Hash form".
import { createHash } from "node:crypto";
/** `sha256:` + 64 hex. Hash chains and every digest field. */
export function sha256(value) {
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
/** Bare hex, no prefix: archive file digests only (run-export.ts). */
export function sha256Bytes(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}
/** `sha256:` + the first 32 hex, over a sorted copy of `values`. */
export function fingerprintStrings(values) {
    const hash = createHash("sha256");
    hash.update(JSON.stringify([...values].sort()));
    return `sha256:${hash.digest("hex").slice(0, 32)}`;
}
/** `sha256:` + 64 hex, over key-sorted JSON. */
export function stableHash(value) {
    return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}
/** JSON with recursively sorted keys. A top-level `undefined` gives
 *  `undefined`, as plain JSON.stringify does. */
export function stableStringify(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    const keys = Object.keys(value).sort();
    const body = keys
        .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
        .join(",");
    return `{${body}}`;
}
/** The handoff ledger's form: same bytes as `stableStringify`, kept
 *  separately named because it is separately tested. */
export function ledgerStableStringify(value) {
    return stableStringify(value);
}
/** The telemetry form: like `stableStringify`, but `undefined` becomes
 *  the string "null". */
export function telemetryStableStringify(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "null";
    }
    if (Array.isArray(value)) {
        return `[${value.map(telemetryStableStringify).join(",")}]`;
    }
    const entries = Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${telemetryStableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
}
/** The trust-audit event form: a JSON round trip first drops keys whose
 *  value is `undefined`, so a hash taken in memory equals one taken after a
 *  reload from disk. The caller strips `eventHash` itself. */
export function eventHashInput(value) {
    const roundTripped = JSON.parse(JSON.stringify(value));
    return stableStringify(roundTripped);
}
