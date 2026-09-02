// core/hash.ts — THE one hash/stringify module.
//
// Pure. No fs, no child_process, no net, no process.env, no Date.now(), no
// Math.random(). Every input the old build fed these functions (a run id, a
// content object, a list of strings) still comes in as a plain function
// argument here.
//
// Per project/docs/rebuild/PLAN.md's byte-compat section ("Hash dedup — three shapes, not one
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

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// 1. Hash spellings
// ---------------------------------------------------------------------------

/** Prefixed `sha256:` + all 64 hex chars. Used by both hash chains,
 *  promptDigest, resultDigest, reportedUsageDigest, the ledger digest. */
export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/** BARE hex, no prefix. Archive file digests only (run-export.ts). Never mix
 *  with the other three hash spellings in this file. */
export function sha256Bytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Prefixed `sha256:` + only the FIRST 32 hex chars, over SORTED JSON-array
 *  input. Sorts a COPY (`[...values].sort()`) with the JS default sort
 *  (UTF-16 code-unit order) — never mutates the caller's array. Used by
 *  snapshot ids, state-explosion fingerprints, evidence-reasoning
 *  fingerprints. */
export function fingerprintStrings(values: string[]): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify([...values].sort()));
  return `sha256:${hash.digest("hex").slice(0, 32)}`;
}

/** Maps each record to `"<id>:<status or empty>"`, sorts, then fingerprints.
 *  `updatedAt` is accepted in the record shape but NEVER used. */
export function fingerprintRecords(
  records: Array<{ id: string; status?: string; updatedAt?: string }>
): string {
  return fingerprintStrings(records.map((r) => `${r.id}:${r.status || ""}`).sort());
}

/** Prefixed `sha256:` + all 64 hex chars, over recursively KEY-SORTED JSON
 *  (not normalized — used to prove a source snapshot was not mutated). Used
 *  by the contract-migration prover. */
export function stableHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
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
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) as string;
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",");
  return `{${body}}`;
}

/** `ledger module`'s `stableStringify` — sorts keys recursively, NO special-
 *  casing of a top-level `undefined`. A top-level `undefined` is not a real
 *  call site here in practice, but this must not be assumed to behave like
 *  `telemetryStableStringify` below. Byte-identical to `stableStringify`;
 *  kept as its own named export because the old build kept a private copy
 *  in ledger.ts with this exact (non-)behavior, and the plan requires each
 *  divergent behavior to stay separately named and separately tested. */
export function ledgerStableStringify(value: unknown): string {
  return stableStringify(value);
}

/** `telemetry-attestation module`'s `stableStringify` — sorts keys
 *  recursively, AND maps a top-level `undefined` input to the literal
 *  string `"null"` (via `JSON.stringify(value) ?? "null"`). Divergent from
 *  `ledgerStableStringify` exactly at the top-level-undefined edge. */
export function telemetryStableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return (JSON.stringify(value) as string | undefined) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(telemetryStableStringify).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${telemetryStableStringify((value as Record<string, unknown>)[key])}`
    );
  return `{${entries.join(",")}}`;
}

/** `trust-audit module`'s `eventHash` input builder: JSON-round-trips the
 *  value FIRST (`JSON.parse(JSON.stringify(value))`), which DROPS every key
 *  (nested or top-level) whose value is `undefined`, and ONLY THEN runs the
 *  sort-and-stringify step. This is a pre-pass that changes the shape being
 *  hashed, not just a formatting rule on top of the same shape — so record-
 *  time hashes (over an in-memory event that may carry nested `undefined`)
 *  equal verify-time hashes (over the parsed-from-disk event, which never
 *  had those keys to begin with). Caller is responsible for stripping the
 *  `eventHash` field itself before calling this (this function hashes
 *  exactly what it is given). */
export function eventHashInput(value: unknown): string {
  const roundTripped = JSON.parse(JSON.stringify(value));
  return stableStringify(roundTripped);
}
