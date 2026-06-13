// Telemetry attestation ledger (Track 1) — make the RECORDED attestation itself
// tamper-evident, not just the in-flight signature.
//
// The executor's signature (telemetry-attestation.ts) proves the agent SAID a
// given usage. This ledger proves CW RECORDED exactly that and nobody edited the
// record afterward: an append-only, hash-chained overlay (`telemetry.json`, a
// runDir peer of reclaimed.json), one entry per agent hop. Each entry chains to
// the prior via prevHash; recordHash = sha256(canonical entry sans recordHash).
// Flip a recorded verdict (`unattested`→`attested`), or edit a recorded usage
// digest, and the chain no longer recomputes — `verifyTelemetryLedger` catches it.
//
// Same discipline as reclamation.ts's tombstone chain: APPEND-ONLY (never rewrite
// a prior entry), DURABLE (temp→fsync→rename via writeJson), and verify recomputes
// every hash independently — it never trusts the stored value.

import fs from "node:fs";
import path from "node:path";
import type { TelemetryAttestationRecord, TelemetryAttestationStatus, TelemetryLedger, WorkflowRun } from "./types";
import { writeJson } from "./state";
import { sha256 } from "./execution-backend";
import { stableStringify } from "./telemetry-attestation";

export const TELEMETRY_LEDGER_SCHEMA_VERSION = 1;

export function telemetryLedgerPath(run: WorkflowRun): string {
  return path.join(run.paths.runDir, "telemetry.json");
}

/** A telemetry ledger that EXISTS on disk but cannot be parsed (or whose shape is
 *  not a record array). This is exactly the corruption/truncation case the hash
 *  chain exists to catch — it must fail closed, never be silently treated as the
 *  "empty/absent" chain (which verifies as clean). */
export class TelemetryLedgerCorruptError extends Error {
  readonly file: string;
  constructor(file: string) {
    super(`Telemetry ledger exists but is corrupt (unparseable): ${file}`);
    this.name = "TelemetryLedgerCorruptError";
    this.file = file;
  }
}

type TelemetryLedgerLoad =
  | { status: "absent" | "ok"; ledger: TelemetryLedger }
  | { status: "corrupt"; file: string };

/** Read the ledger, DISTINGUISHING absent (never written -> empty chain, fine)
 *  from corrupt (exists but unparseable/wrong shape -> fail closed). Conflating
 *  the two was the bug that let a corrupt overlay verify green and let an append
 *  silently re-genesis on top of it, discarding history. */
function readTelemetryLedgerState(run: WorkflowRun): TelemetryLedgerLoad {
  const file = telemetryLedgerPath(run);
  if (!fs.existsSync(file)) return { status: "absent", ledger: { schemaVersion: 1, runId: run.id, records: [] } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { status: "corrupt", file };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as TelemetryLedger).records)) {
    return { status: "corrupt", file };
  }
  return { status: "ok", ledger: { schemaVersion: 1, runId: run.id, records: (parsed as TelemetryLedger).records } };
}

/** Load the ledger for read/append. Absent -> empty chain. Corrupt -> THROWS, so
 *  an append can never silently re-genesis on a poisoned/edited file, and a read
 *  surfaces the corruption rather than swallowing it. */
export function loadTelemetryLedger(run: WorkflowRun): TelemetryLedger {
  const state = readTelemetryLedgerState(run);
  if (state.status === "corrupt") throw new TelemetryLedgerCorruptError(state.file);
  return state.ledger;
}

/** genesis prevHash for a run's chain (no prior record). */
export function genesisPrevHash(runId: string): string {
  return sha256(`cw-telemetry-ledger:${runId}`);
}

/** The canonical bytes a recordHash binds — every field except recordHash itself.
 *  Recomputed independently by verifyTelemetryLedger. */
function recordHashInput(record: Omit<TelemetryAttestationRecord, "recordHash">): string {
  return stableStringify({
    schemaVersion: record.schemaVersion,
    runId: record.runId,
    recordId: record.recordId,
    recordedAt: record.recordedAt,
    workerId: record.workerId,
    taskId: record.taskId,
    promptDigest: record.promptDigest,
    reportedUsageDigest: record.reportedUsageDigest,
    usageSignature: record.usageSignature || null,
    attestation: record.attestation,
    attestationReason: record.attestationReason || null,
    prevHash: record.prevHash
  });
}

export function computeRecordHash(record: Omit<TelemetryAttestationRecord, "recordHash">): string {
  return sha256(recordHashInput(record));
}

/** sha256 of the canonical reported usage (compact, chainable). Absent usage gets
 *  the digest of `null`, so "the agent reported nothing" is itself bound. */
export function reportedUsageDigest(usage: Record<string, unknown> | undefined): string {
  return sha256(stableStringify(usage ?? null));
}

let recordCounter = 0;
function recordId(now: string): string {
  recordCounter += 1;
  const stamp = now.replace(/[-:.TZ]/g, "").slice(0, 14);
  return `tel-${stamp}-${String(recordCounter).padStart(3, "0")}`;
}

export interface AppendTelemetryAttestationInput {
  workerId: string;
  taskId: string;
  promptDigest: string;
  reportedUsage?: Record<string, unknown>;
  usageSignature?: string;
  attestation: TelemetryAttestationStatus;
  attestationReason?: string;
  now?: string;
}

/** Append one attestation record DURABLY to the append-only chain, linking it to
 *  the prior record (or genesis). Returns the committed record. */
export function appendTelemetryAttestation(run: WorkflowRun, input: AppendTelemetryAttestationInput): TelemetryAttestationRecord {
  const ledger = loadTelemetryLedger(run);
  const now = input.now || new Date().toISOString();
  const prevHash = ledger.records.length ? ledger.records[ledger.records.length - 1].recordHash : genesisPrevHash(run.id);
  const base: Omit<TelemetryAttestationRecord, "recordHash"> = {
    schemaVersion: 1,
    runId: run.id,
    recordId: recordId(now),
    recordedAt: now,
    workerId: input.workerId,
    taskId: input.taskId,
    promptDigest: input.promptDigest,
    reportedUsageDigest: reportedUsageDigest(input.reportedUsage),
    usageSignature: input.usageSignature,
    attestation: input.attestation,
    attestationReason: input.attestationReason,
    prevHash
  };
  const record: TelemetryAttestationRecord = { ...base, recordHash: computeRecordHash(base) };
  ledger.records.push(record);
  writeJson(telemetryLedgerPath(run), ledger, { durable: true });
  return record;
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
  /** Convenience tallies for the report surface. */
  attested: number;
  unattested: number;
  absent: number;
}

/** Re-prove the whole telemetry chain for a run: prevHash linkage + per-record
 *  hash recompute. Recomputes every hash independently — never trusts the stored
 *  value — so an edited record/verdict is detected. An empty ledger verifies as
 *  present:false (nothing to prove), NOT a failure. */
export function verifyTelemetryLedger(run: WorkflowRun): TelemetryLedgerVerification {
  const state = readTelemetryLedgerState(run);
  if (state.status === "corrupt") {
    // Fail closed: a ledger that exists but cannot be parsed is indistinguishable
    // from a truncated/forged one — report it, never green it.
    return {
      present: true,
      verified: false,
      records: [],
      checks: [{ name: "ledger-load", pass: false, code: "telemetry-ledger-corrupt" }],
      attested: 0,
      unattested: 0,
      absent: 0
    };
  }
  const records = state.ledger.records;
  const checks: TelemetryLedgerCheck[] = [];
  const tally = { attested: 0, unattested: 0, absent: 0 };
  for (const record of records) tally[record.attestation] += 1;
  if (!records.length) {
    return { present: false, verified: true, records, checks, ...tally };
  }
  // (a) chain linkage: genesis = sha256("cw-telemetry-ledger:"+runId).
  let chainOk = true;
  for (let i = 0; i < records.length; i++) {
    const expectedPrev = i === 0 ? genesisPrevHash(run.id) : records[i - 1].recordHash;
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
