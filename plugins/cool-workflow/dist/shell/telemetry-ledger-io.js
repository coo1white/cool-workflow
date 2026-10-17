// shell/telemetry-ledger-io.ts — telemetry ledger disk IO: path
// resolution, absent-vs-corrupt load, durable append. The pure verify
// math lives in core/trust/telemetry-ledger.ts.
//
// CRITICAL invariant (project/docs/rebuild/PLAN.md byte-compat item 12):
// an ABSENT telemetry.json is an empty, clean-verifying chain
// (`present:false`); a PRESENT but unparseable one is CORRUPT — reads
// report `telemetry-ledger-corrupt`, and append THROWS
// `TelemetryLedgerCorruptError`. It must never re-genesis over a
// poisoned file.
//
// Evidence: SPEC/ledger-trust.md "Absent vs corrupt telemetry ledger",
// invariant 3.
import * as fs from "node:fs";
import * as path from "node:path";
import { withFileLock, writeJson } from "./fs-atomic.js";
import { computeRecordHash, genesisPrevHash, recordId, reportedUsageDigest, TelemetryLedgerCorruptError, TELEMETRY_LEDGER_SCHEMA_VERSION, corruptTelemetryLedgerVerification, verifyTelemetryLedgerRecords, } from "../core/trust/telemetry-ledger.js";
export { TelemetryLedgerCorruptError, TELEMETRY_LEDGER_SCHEMA_VERSION, computeRecordHash, reportedUsageDigest };
export function telemetryLedgerPath(run) {
    return path.join(run.paths.runDir, "telemetry.json");
}
/** Read the ledger, DISTINGUISHING absent (never written -> empty chain,
 *  fine) from corrupt (exists but unparseable/wrong shape -> fail
 *  closed). */
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
/** Load the ledger for read/append. Absent -> empty chain. Corrupt ->
 *  THROWS, so an append can never silently re-genesis on a poisoned/
 *  edited file. */
export function loadTelemetryLedger(run) {
    const state = readTelemetryLedgerState(run);
    if (state.status === "corrupt")
        throw new TelemetryLedgerCorruptError(state.file);
    return state.ledger;
}
/** Append one attestation record DURABLY to the append-only chain,
 *  linking it to the prior record (or genesis). Returns the committed
 *  record. Throws `TelemetryLedgerCorruptError` if the file on disk is
 *  present but unparseable — never silently re-genesis.
 *
 *  The whole load->append->write is held under `withFileLock` (like every
 *  other read-modify-write in this codebase — see `recordTrustAuditEvent`).
 *  `writeJson` REPLACES the file, so without the lock two processes
 *  appending for the same run at once both read the same N-record ledger,
 *  both compute a record at chain position N+1, and the last atomic rename
 *  WINS — silently dropping the loser's record. The surviving chain still
 *  links correctly, so the loss is invisible to `verifyTelemetryLedger`.
 *  The `prevHash` and chain position MUST be read from the ledger loaded
 *  INSIDE the lock so the record links to the true current tail. */
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
/** Re-prove the whole telemetry chain for a run, reading from disk.
 *  Absent -> present:false/verified:true (nothing to prove). Corrupt ->
 *  present:true/verified:false with the `telemetry-ledger-corrupt`
 *  check, never thrown. */
export function verifyTelemetryLedger(run) {
    const state = readTelemetryLedgerState(run);
    if (state.status === "corrupt")
        return corruptTelemetryLedgerVerification();
    return verifyTelemetryLedgerRecords(run.id, state.ledger.records);
}
