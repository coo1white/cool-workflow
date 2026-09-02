"use strict";
// shell/telemetry-ledger-io.ts — telemetry ledger disk IO: path
// resolution, absent-vs-corrupt load, durable append. The pure verify
// math lives in core/trust/telemetry-ledger.ts.
//
// MILESTONE 8. Byte-exact port of the old build's src/telemetry-ledger.ts
// IO-touching half. CRITICAL invariant (plugins/cool-workflow/project/docs/rebuild/PLAN.md byte-compat item 12):
// an ABSENT telemetry.json is an empty, clean-verifying chain
// (`present:false`); a PRESENT but unparseable one is CORRUPT — reads
// report `telemetry-ledger-corrupt`, and append THROWS
// `TelemetryLedgerCorruptError`. It must never re-genesis over a
// poisoned file.
//
// Evidence: SPEC/ledger-trust.md "Absent vs corrupt telemetry ledger",
// invariant 3.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportedUsageDigest = exports.computeRecordHash = exports.TELEMETRY_LEDGER_SCHEMA_VERSION = exports.TelemetryLedgerCorruptError = void 0;
exports.telemetryLedgerPath = telemetryLedgerPath;
exports.loadTelemetryLedger = loadTelemetryLedger;
exports.appendTelemetryAttestation = appendTelemetryAttestation;
exports.verifyTelemetryLedger = verifyTelemetryLedger;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const telemetry_ledger_1 = require("../core/trust/telemetry-ledger");
Object.defineProperty(exports, "computeRecordHash", { enumerable: true, get: function () { return telemetry_ledger_1.computeRecordHash; } });
Object.defineProperty(exports, "reportedUsageDigest", { enumerable: true, get: function () { return telemetry_ledger_1.reportedUsageDigest; } });
Object.defineProperty(exports, "TelemetryLedgerCorruptError", { enumerable: true, get: function () { return telemetry_ledger_1.TelemetryLedgerCorruptError; } });
Object.defineProperty(exports, "TELEMETRY_LEDGER_SCHEMA_VERSION", { enumerable: true, get: function () { return telemetry_ledger_1.TELEMETRY_LEDGER_SCHEMA_VERSION; } });
function telemetryLedgerPath(run) {
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
function loadTelemetryLedger(run) {
    const state = readTelemetryLedgerState(run);
    if (state.status === "corrupt")
        throw new telemetry_ledger_1.TelemetryLedgerCorruptError(state.file);
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
function appendTelemetryAttestation(run, input) {
    return (0, fs_atomic_1.withFileLock)(telemetryLedgerPath(run), () => {
        const ledger = loadTelemetryLedger(run);
        const now = input.now || new Date().toISOString();
        const prevHash = ledger.records.length ? ledger.records[ledger.records.length - 1].recordHash : (0, telemetry_ledger_1.genesisPrevHash)(run.id);
        const base = {
            schemaVersion: 1,
            runId: run.id,
            recordId: (0, telemetry_ledger_1.recordId)(ledger.records.length + 1),
            recordedAt: now,
            workerId: input.workerId,
            taskId: input.taskId,
            promptDigest: input.promptDigest,
            reportedUsageDigest: (0, telemetry_ledger_1.reportedUsageDigest)(input.reportedUsage),
            ...(input.reportedUsage ? { reportedUsage: input.reportedUsage } : {}),
            usageSignature: input.usageSignature,
            ...(input.resultDigest ? { resultDigest: input.resultDigest } : {}),
            attestation: input.attestation,
            attestationReason: input.attestationReason,
            prevHash,
        };
        const record = { ...base, recordHash: (0, telemetry_ledger_1.computeRecordHash)(base) };
        ledger.records.push(record);
        (0, fs_atomic_1.writeJson)(telemetryLedgerPath(run), ledger, { durable: true });
        return record;
    });
}
/** Re-prove the whole telemetry chain for a run, reading from disk.
 *  Absent -> present:false/verified:true (nothing to prove). Corrupt ->
 *  present:true/verified:false with the `telemetry-ledger-corrupt`
 *  check, never thrown. */
function verifyTelemetryLedger(run) {
    const state = readTelemetryLedgerState(run);
    if (state.status === "corrupt")
        return (0, telemetry_ledger_1.corruptTelemetryLedgerVerification)();
    return (0, telemetry_ledger_1.verifyTelemetryLedgerRecords)(run.id, state.ledger.records);
}
