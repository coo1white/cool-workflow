// core/trust/telemetry-ledger.ts — the hash-chained telemetry
// attestation ledger's PURE half: genesisPrevHash, computeRecordHash,
// reportedUsageDigest, verifyTelemetryLedger. Directory/file IO
// (telemetryLedgerPath, loadTelemetryLedger, appendTelemetryAttestation)
// lives in shell/telemetry-ledger-io.ts.
//
// MILESTONE 8. Byte-exact port of the old build's src/telemetry-ledger.ts
// verify-side logic. Uses core/hash.ts's `sha256`/`telemetryStableStringify`
// (see plugins/cool-workflow/project/docs/rebuild/PLAN.md byte-compat item 2's key-omission-vs-null rule).
//
// Evidence: SPEC/ledger-trust.md "Telemetry ledger record", byte-compat
// items 2 and 12; plugins/cool-workflow/src/telemetry-ledger.ts:1-224.

import { sha256, telemetryStableStringify } from "../hash";

export const TELEMETRY_LEDGER_SCHEMA_VERSION = 1;

export type TelemetryAttestationStatus = "attested" | "unattested" | "absent";

export interface TelemetryAttestationRecord {
  schemaVersion: 1;
  runId: string;
  recordId: string;
  recordedAt: string;
  workerId: string;
  taskId: string;
  promptDigest: string;
  reportedUsageDigest: string;
  reportedUsage?: Record<string, unknown>;
  usageSignature?: string;
  /** sha256 of the agent's result.md, when the signature covered it. */
  resultDigest?: string;
  attestation: TelemetryAttestationStatus;
  attestationReason?: string;
  prevHash: string;
  recordHash: string;
}

export interface TelemetryLedger {
  schemaVersion: 1;
  runId: string;
  records: TelemetryAttestationRecord[];
}

/** A telemetry ledger that EXISTS on disk but cannot be parsed (or whose
 *  shape is not a record array). This is exactly the corruption/
 *  truncation case the hash chain exists to catch — it must fail closed,
 *  never be silently treated as the "empty/absent" chain (which verifies
 *  as clean). */
export class TelemetryLedgerCorruptError extends Error {
  readonly file: string;
  constructor(file: string) {
    super(`Telemetry ledger exists but is corrupt (unparseable): ${file}`);
    this.name = "TelemetryLedgerCorruptError";
    this.file = file;
  }
}

/** genesis prevHash for a run's chain (no prior record). */
export function genesisPrevHash(runId: string): string {
  return sha256(`cw-telemetry-ledger:${runId}`);
}

/** The canonical bytes a recordHash binds — every field except
 *  recordHash itself. `reportedUsage`/`resultDigest` are OMITTED (not
 *  `null`) when absent, so a usage-only record's hash is byte-identical
 *  to a pre-result-coverage one (back-compat with old ledgers) — see
 *  plugins/cool-workflow/project/docs/rebuild/PLAN.md byte-compat item 2. */
function recordHashInput(record: Omit<TelemetryAttestationRecord, "recordHash">): string {
  return telemetryStableStringify({
    schemaVersion: record.schemaVersion,
    runId: record.runId,
    recordId: record.recordId,
    recordedAt: record.recordedAt,
    workerId: record.workerId,
    taskId: record.taskId,
    promptDigest: record.promptDigest,
    reportedUsageDigest: record.reportedUsageDigest,
    ...(record.reportedUsage !== undefined ? { reportedUsage: record.reportedUsage } : {}),
    usageSignature: record.usageSignature || null,
    ...(record.resultDigest !== undefined ? { resultDigest: record.resultDigest } : {}),
    attestation: record.attestation,
    attestationReason: record.attestationReason || null,
    prevHash: record.prevHash,
  });
}

export function computeRecordHash(record: Omit<TelemetryAttestationRecord, "recordHash">): string {
  return sha256(recordHashInput(record));
}

/** sha256 of the canonical reported usage (compact, chainable). Absent
 *  usage gets the digest of `null`, so "the agent reported nothing" is
 *  itself bound. */
export function reportedUsageDigest(usage: Record<string, unknown> | undefined): string {
  return sha256(telemetryStableStringify(usage ?? null));
}

/** Deterministic (chain POSITION, not a process-global counter or
 *  wall-clock stamp): `tel-` + chain position, zero-padded to 3. */
export function recordId(seq: number): string {
  return `tel-${String(seq).padStart(3, "0")}`;
}

export interface TelemetryLedgerCheck {
  name: string;
  pass: boolean;
  code?: string;
}

export interface TelemetryLedgerVerification {
  present: boolean;
  verified: boolean;
  records: TelemetryAttestationRecord[];
  checks: TelemetryLedgerCheck[];
  attested: number;
  unattested: number;
  absent: number;
}

/** Re-prove the whole telemetry chain for a run: prevHash linkage +
 *  per-record hash recompute. Recomputes every hash independently —
 *  never trusts the stored value. An empty ledger verifies as
 *  present:false (nothing to prove), NOT a failure. Pure: takes the
 *  already-loaded record array plus the run id, never touches disk. */
export function verifyTelemetryLedgerRecords(runId: string, records: TelemetryAttestationRecord[]): TelemetryLedgerVerification {
  const checks: TelemetryLedgerCheck[] = [];
  const tally = { attested: 0, unattested: 0, absent: 0 };
  for (const record of records) tally[record.attestation] += 1;
  if (!records.length) {
    return { present: false, verified: true, records, checks, ...tally };
  }
  // (a) chain linkage.
  let chainOk = true;
  for (let i = 0; i < records.length; i++) {
    const expectedPrev = i === 0 ? genesisPrevHash(runId) : records[i - 1].recordHash;
    const pass = records[i].prevHash === expectedPrev;
    if (!pass) chainOk = false;
    checks.push({ name: `chain-link[${i}]`, pass, code: pass ? undefined : "telemetry-chain-broken" });
  }
  // (b) per-record independent hash recompute (digest integrity).
  let digestsOk = true;
  for (let i = 0; i < records.length; i++) {
    const { recordHash, ...rest } = records[i];
    const recomputed = computeRecordHash(rest);
    const pass = recomputed === recordHash;
    if (!pass) digestsOk = false;
    checks.push({ name: `record-hash[${i}]`, pass, code: pass ? undefined : "telemetry-digest-mismatch" });
  }
  return { present: true, verified: chainOk && digestsOk, records, checks, ...tally };
}

/** The corrupt-ledger verification shape (present:true, verified:false,
 *  one `ledger-load`/`telemetry-ledger-corrupt` failed check). Shared
 *  constant so both the CLI-facing shell reader and any pure caller
 *  report the exact same shape for a corrupt file. */
export function corruptTelemetryLedgerVerification(): TelemetryLedgerVerification {
  return {
    present: true,
    verified: false,
    records: [],
    checks: [{ name: "ledger-load", pass: false, code: "telemetry-ledger-corrupt" }],
    attested: 0,
    unattested: 0,
    absent: 0,
  };
}
