// shell/telemetry-ledger-io.ts — telemetry ledger disk IO.
// An ABSENT telemetry.json is an empty chain; a PRESENT unparseable one is
// corrupt: reads report it and append throws, never re-starting the chain.
import * as fs from "node:fs";
import * as path from "node:path";
import { withFileLock, writeJson } from "./fs-atomic.js";
import { computeRecordHash, genesisPrevHash, recordId, reportedUsageDigest, TelemetryLedgerCorruptError, TELEMETRY_LEDGER_SCHEMA_VERSION, corruptTelemetryLedgerVerification, verifyTelemetryLedgerRecords, } from "../core/trust/telemetry-ledger.js";
export { TelemetryLedgerCorruptError, TELEMETRY_LEDGER_SCHEMA_VERSION, computeRecordHash, reportedUsageDigest };
export function telemetryLedgerPath(run) {
    return path.join(run.paths.runDir, "telemetry.json");
}
/** Read the ledger, telling absent from corrupt. */
function readTelemetryLedgerState(run) {
    const file = telemetryLedgerPath(run);
    if (!fs.existsSync(file))
        return { status: "absent", ledger: { schemaVersion: 1, runId: run.id, records: [] } };
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch {
        return { status: "corrupt", file };
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.records)) {
        return { status: "corrupt", file };
    }
    return { status: "ok", ledger: { schemaVersion: 1, runId: run.id, records: parsed.records } };
}
/** Load for append: absent gives an empty chain, corrupt throws. */
export function loadTelemetryLedger(run) {
    const state = readTelemetryLedgerState(run);
    if (state.status === "corrupt")
        throw new TelemetryLedgerCorruptError(state.file);
    return state.ledger;
}
/** Append one record, linked to the tail. Throws on a corrupt ledger.
 *  Load, append and write run under one file lock: without it two
 *  appenders read the same tail and the last rename silently drops the
 *  other's record, a loss the chain itself cannot show. */
export function appendTelemetryAttestation(run, input) {
    return withFileLock(telemetryLedgerPath(run), () => {
        const ledger = loadTelemetryLedger(run);
        const now = input.now || new Date().toISOString();
        const prevHash = ledger.records.length ? ledger.records[ledger.records.length - 1].recordHash : genesisPrevHash(run.id);
        const base = {
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
        const record = { ...base, recordHash: computeRecordHash(base) };
        ledger.records.push(record);
        writeJson(telemetryLedgerPath(run), ledger, { durable: true });
        return record;
    });
}
/** Re-prove a run's chain from disk; a corrupt file is reported, not thrown. */
export function verifyTelemetryLedger(run) {
    const state = readTelemetryLedgerState(run);
    if (state.status === "corrupt")
        return corruptTelemetryLedgerVerification();
    return verifyTelemetryLedgerRecords(run.id, state.ledger.records);
}
