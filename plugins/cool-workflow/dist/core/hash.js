"use strict";
// core/hash.ts — THE one hash/stringify module.
//
// Pure. No fs, no child_process, no net, no process.env, no Date.now(), no
// Math.random(). Every input the old build fed these functions (a run id, a
// content object, a list of strings) still comes in as a plain function
// argument here.
//
// Per v2/PLAN.md's byte-compat section ("Hash dedup — three shapes, not one
// edge case"), this file must keep THREE things separate, each with its own
// name, never collapsed into a single flagged helper:
//
//   1. Three hash SPELLINGS: `sha256` (prefixed, 64 hex), `fingerprintStrings`
//      (prefixed, 32 hex, SORTS its input), `stableHash` (prefixed, 64 hex,
//      key-sorted JSON), plus `sha256Bytes` (bare hex, archive-only — never
//      mix with the other three).
//   2. Three DIVERGENT stringify-before-hash behaviors: `ledgerStableStringify`
//      (no undefined special-casing), `telemetryStableStringify` (top-level
//      undefined -> the string "null"), `eventHashInput` (JSON round-trip
//      FIRST, to drop undefined-valued keys, THEN sort-and-stringify).
//   3. One shared recursive key-sort primitive, `stableStringify`, that the
//      three wrappers above are each built from explicitly — not a single
//      function with a flag.
//
// Evidence: SPEC/ledger-trust.md "Hash form", "Handoff ledger entry",
// "Telemetry ledger record", "Trust-audit chain"; SPEC/types-util.md
// "Fingerprint / hash formats"; SPEC/state-core.md "Fingerprint / hash
// formats", "Contract-migration prover invariants".
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = sha256;
exports.sha256Bytes = sha256Bytes;
exports.fingerprintStrings = fingerprintStrings;
exports.fingerprintRecords = fingerprintRecords;
exports.stableHash = stableHash;
exports.stableStringify = stableStringify;
exports.ledgerStableStringify = ledgerStableStringify;
exports.telemetryStableStringify = telemetryStableStringify;
exports.eventHashInput = eventHashInput;
const node_crypto_1 = require("node:crypto");
// ---------------------------------------------------------------------------
// 1. Hash spellings
// ---------------------------------------------------------------------------
/** Prefixed `sha256:` + all 64 hex chars. Used by both hash chains,
 *  promptDigest, resultDigest, reportedUsageDigest, the ledger digest.
 *  (src/execution-backend/util.ts:13-15 in the old build.) */
function sha256(value) {
    return `sha256:${(0, node_crypto_1.createHash)("sha256").update(value, "utf8").digest("hex")}`;
}
/** BARE hex, no prefix. Archive file digests only (run-export.ts). Never mix
 *  with the other three hash spellings in this file. */
function sha256Bytes(bytes) {
    return (0, node_crypto_1.createHash)("sha256").update(bytes).digest("hex");
}
/** Prefixed `sha256:` + only the FIRST 32 hex chars, over SORTED JSON-array
 *  input. Sorts a COPY (`[...values].sort()`) with the JS default sort
 *  (UTF-16 code-unit order) — never mutates the caller's array. Used by
 *  snapshot ids, state-explosion fingerprints, evidence-reasoning
 *  fingerprints. (src/util/fingerprint.ts:6-10.) */
function fingerprintStrings(values) {
    const hash = (0, node_crypto_1.createHash)("sha256");
    hash.update(JSON.stringify([...values].sort()));
    return `sha256:${hash.digest("hex").slice(0, 32)}`;
}
/** Maps each record to `"<id>:<status or empty>"`, sorts, then fingerprints.
 *  `updatedAt` is accepted in the record shape but NEVER used.
 *  (src/util/fingerprint.ts:12-14.) */
function fingerprintRecords(records) {
    return fingerprintStrings(records.map((r) => `${r.id}:${r.status || ""}`).sort());
}
/** Prefixed `sha256:` + all 64 hex chars, over recursively KEY-SORTED JSON
 *  (not normalized — used to prove a source snapshot was not mutated). Used
 *  by the contract-migration prover. (src/contract-migration.ts:90-103.) */
function stableHash(value) {
    return `sha256:${(0, node_crypto_1.createHash)("sha256").update(stableStringify(value)).digest("hex")}`;
}
// ---------------------------------------------------------------------------
// 2/3. The one shared sort-and-stringify primitive, plus the three named,
// independently-divergent wrapper behaviors.
// ---------------------------------------------------------------------------
/** Deterministic JSON with recursively sorted object keys. Never special-
 *  cases a top-level `undefined` — `JSON.stringify(undefined)` returns
 *  `undefined` (not a string), matching plain `JSON.stringify` behavior at
 *  the top level. This IS the canonical primitive every wrapper below calls;
 *  it is not itself one of the three named divergent behaviors. */
function stableStringify(value) {
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
/** `src/ledger.ts`'s `stableStringify` — sorts keys recursively, NO special-
 *  casing of a top-level `undefined`. A top-level `undefined` is not a real
 *  call site here in practice, but this must not be assumed to behave like
 *  `telemetryStableStringify` below. Byte-identical to `stableStringify`;
 *  kept as its own named export because the old build kept a private copy
 *  in ledger.ts with this exact (non-)behavior, and the plan requires each
 *  divergent behavior to stay separately named and separately tested. */
function ledgerStableStringify(value) {
    return stableStringify(value);
}
/** `src/telemetry-attestation.ts`'s `stableStringify` — sorts keys
 *  recursively, AND maps a top-level `undefined` input to the literal
 *  string `"null"` (via `JSON.stringify(value) ?? "null"`). Divergent from
 *  `ledgerStableStringify` exactly at the top-level-undefined edge. */
function telemetryStableStringify(value) {
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
/** `src/trust-audit.ts`'s `eventHash` input builder: JSON-round-trips the
 *  value FIRST (`JSON.parse(JSON.stringify(value))`), which DROPS every key
 *  (nested or top-level) whose value is `undefined`, and ONLY THEN runs the
 *  sort-and-stringify step. This is a pre-pass that changes the shape being
 *  hashed, not just a formatting rule on top of the same shape — so record-
 *  time hashes (over an in-memory event that may carry nested `undefined`)
 *  equal verify-time hashes (over the parsed-from-disk event, which never
 *  had those keys to begin with). Caller is responsible for stripping the
 *  `eventHash` field itself before calling this (this function hashes
 *  exactly what it is given). */
function eventHashInput(value) {
    const roundTripped = JSON.parse(JSON.stringify(value));
    return stableStringify(roundTripped);
}
