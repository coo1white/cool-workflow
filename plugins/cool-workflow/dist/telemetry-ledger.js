"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TELEMETRY_LEDGER_SCHEMA_VERSION = void 0;
exports.telemetryLedgerPath = telemetryLedgerPath;
exports.loadTelemetryLedger = loadTelemetryLedger;
exports.genesisPrevHash = genesisPrevHash;
exports.computeRecordHash = computeRecordHash;
exports.reportedUsageDigest = reportedUsageDigest;
exports.appendTelemetryAttestation = appendTelemetryAttestation;
exports.verifyTelemetryLedger = verifyTelemetryLedger;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
const execution_backend_1 = require("./execution-backend");
const telemetry_attestation_1 = require("./telemetry-attestation");
exports.TELEMETRY_LEDGER_SCHEMA_VERSION = 1;
function telemetryLedgerPath(run) {
    return node_path_1.default.join(run.paths.runDir, "telemetry.json");
}
/** Load the ledger; fail closed to an empty chain on a malformed overlay (a
 *  corrupt file must never brick the run — and an empty chain verifies as such). */
function loadTelemetryLedger(run) {
    const file = telemetryLedgerPath(run);
    if (!node_fs_1.default.existsSync(file))
        return { schemaVersion: 1, runId: run.id, records: [] };
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
        return { schemaVersion: 1, runId: run.id, records: Array.isArray(parsed.records) ? parsed.records : [] };
    }
    catch {
        return { schemaVersion: 1, runId: run.id, records: [] };
    }
}
/** genesis prevHash for a run's chain (no prior record). */
function genesisPrevHash(runId) {
    return (0, execution_backend_1.sha256)(`cw-telemetry-ledger:${runId}`);
}
/** The canonical bytes a recordHash binds — every field except recordHash itself.
 *  Recomputed independently by verifyTelemetryLedger. */
function recordHashInput(record) {
    return (0, telemetry_attestation_1.stableStringify)({
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
function computeRecordHash(record) {
    return (0, execution_backend_1.sha256)(recordHashInput(record));
}
/** sha256 of the canonical reported usage (compact, chainable). Absent usage gets
 *  the digest of `null`, so "the agent reported nothing" is itself bound. */
function reportedUsageDigest(usage) {
    return (0, execution_backend_1.sha256)((0, telemetry_attestation_1.stableStringify)(usage ?? null));
}
let recordCounter = 0;
function recordId(now) {
    recordCounter += 1;
    const stamp = now.replace(/[-:.TZ]/g, "").slice(0, 14);
    return `tel-${stamp}-${String(recordCounter).padStart(3, "0")}`;
}
/** Append one attestation record DURABLY to the append-only chain, linking it to
 *  the prior record (or genesis). Returns the committed record. */
function appendTelemetryAttestation(run, input) {
    const ledger = loadTelemetryLedger(run);
    const now = input.now || new Date().toISOString();
    const prevHash = ledger.records.length ? ledger.records[ledger.records.length - 1].recordHash : genesisPrevHash(run.id);
    const base = {
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
    const record = { ...base, recordHash: computeRecordHash(base) };
    ledger.records.push(record);
    (0, state_1.writeJson)(telemetryLedgerPath(run), ledger, { durable: true });
    return record;
}
/** Re-prove the whole telemetry chain for a run: prevHash linkage + per-record
 *  hash recompute. Recomputes every hash independently — never trusts the stored
 *  value — so an edited record/verdict is detected. An empty ledger verifies as
 *  present:false (nothing to prove), NOT a failure. */
function verifyTelemetryLedger(run) {
    const records = loadTelemetryLedger(run).records;
    const checks = [];
    const tally = { attested: 0, unattested: 0, absent: 0 };
    for (const record of records)
        tally[record.attestation] += 1;
    if (!records.length) {
        return { present: false, verified: true, records, checks, ...tally };
    }
    // (a) chain linkage: genesis = sha256("cw-telemetry-ledger:"+runId).
    let chainOk = true;
    for (let i = 0; i < records.length; i++) {
        const expectedPrev = i === 0 ? genesisPrevHash(run.id) : records[i - 1].recordHash;
        const pass = records[i].prevHash === expectedPrev;
        if (!pass)
            chainOk = false;
        checks.push({ name: `chain-link[${i}]`, pass, code: pass ? undefined : "telemetry-chain-broken" });
    }
    // (b) per-record independent hash recompute (digest integrity).
    let digestsOk = true;
    for (let i = 0; i < records.length; i++) {
        const { recordHash, ...rest } = records[i];
        const recomputed = computeRecordHash(rest);
        const pass = recomputed === recordHash;
        if (!pass)
            digestsOk = false;
        checks.push({ name: `record-hash[${i}]`, pass, code: pass ? undefined : "telemetry-digest-mismatch" });
    }
    return { present: true, verified: chainOk && digestsOk, records, checks, ...tally };
}
