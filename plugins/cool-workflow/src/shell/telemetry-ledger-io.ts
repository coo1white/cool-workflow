// shell/telemetry-ledger-io.ts — telemetry ledger disk IO.
// An ABSENT telemetry.json is an empty chain; a PRESENT unparseable one is
// corrupt: reads report it and append throws, never re-starting the chain.

import * as fs from "node:fs";
import * as path from "node:path";
import { withFileLock, writeJson } from "./fs-atomic.js";
import { WorkflowRun } from "../core/state/types.js";
import {
  computeRecordHash,
  genesisPrevHash,
  recordId,
  reportedUsageDigest,
  TelemetryAttestationRecord,
  TelemetryAttestationStatus,
  TelemetryLedger,
  TelemetryLedgerCorruptError,
  TELEMETRY_LEDGER_SCHEMA_VERSION,
  TelemetryLedgerVerification,
  corruptTelemetryLedgerVerification,
  verifyTelemetryLedgerRecords,
} from "../core/trust/telemetry-ledger.js";

export { TelemetryLedgerCorruptError, TELEMETRY_LEDGER_SCHEMA_VERSION, computeRecordHash, reportedUsageDigest };
export type { TelemetryLedger, TelemetryAttestationRecord };

export function telemetryLedgerPath(run: WorkflowRun): string {
  return path.join(run.paths.runDir, "telemetry.json");
}

type TelemetryLedgerLoad =
  | { status: "absent" | "ok"; ledger: TelemetryLedger }
  | { status: "corrupt"; file: string };

/** Read the ledger, telling absent from corrupt. */
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

/** Load for append: absent gives an empty chain, corrupt throws. */
export function loadTelemetryLedger(run: WorkflowRun): TelemetryLedger {
  const state = readTelemetryLedgerState(run);
  if (state.status === "corrupt") throw new TelemetryLedgerCorruptError(state.file);
  return state.ledger;
}

export interface AppendTelemetryAttestationInput {
  workerId: string;
  taskId: string;
  promptDigest: string;
  reportedUsage?: Record<string, unknown>;
  usageSignature?: string;
  resultDigest?: string;
  attestation: TelemetryAttestationStatus;
  attestationReason?: string;
  now?: string;
}

/** Append one record, linked to the tail. Throws on a corrupt ledger.
 *  Load, append and write run under one file lock: without it two
 *  appenders read the same tail and the last rename silently drops the
 *  other's record, a loss the chain itself cannot show. */
export function appendTelemetryAttestation(run: WorkflowRun, input: AppendTelemetryAttestationInput): TelemetryAttestationRecord {
  return withFileLock(telemetryLedgerPath(run), () => {
    const ledger = loadTelemetryLedger(run);
    const now = input.now || new Date().toISOString();
    const prevHash = ledger.records.length ? ledger.records[ledger.records.length - 1].recordHash : genesisPrevHash(run.id);
    const base: Omit<TelemetryAttestationRecord, "recordHash"> = {
      schemaVersion: 1,
      runId: run.id,
      recordId: recordId(ledger.records.length + 1),
      recordedAt: now,
      workerId: input.workerId,
      taskId: input.taskId,
      promptDigest: input.promptDigest,
      reportedUsageDigest: reportedUsageDigest(input.reportedUsage),
      ...(input.reportedUsage ? { reportedUsage: input.reportedUsage } : {}),
      usageSignature: input.usageSignature,
      ...(input.resultDigest ? { resultDigest: input.resultDigest } : {}),
      attestation: input.attestation,
      attestationReason: input.attestationReason,
      prevHash,
    };
    const record: TelemetryAttestationRecord = { ...base, recordHash: computeRecordHash(base) };
    ledger.records.push(record);
    writeJson(telemetryLedgerPath(run), ledger, { durable: true });
    return record;
  });
}

/** Re-prove a run's chain from disk; a corrupt file is reported, not thrown. */
export function verifyTelemetryLedger(run: WorkflowRun): TelemetryLedgerVerification {
  const state = readTelemetryLedgerState(run);
  if (state.status === "corrupt") return corruptTelemetryLedgerVerification();
  return verifyTelemetryLedgerRecords(run.id, state.ledger.records);
}
