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
exports.TelemetryLedgerCorruptError = exports.TELEMETRY_LEDGER_SCHEMA_VERSION = void 0;
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
/** A telemetry ledger that EXISTS on disk but cannot be parsed (or whose shape is
 *  not a record array). This is exactly the corruption/truncation case the hash
 *  chain exists to catch — it must fail closed, never be silently treated as the
 *  "empty/absent" chain (which verifies as clean). */
class TelemetryLedgerCorruptError extends Error {
    file;
    constructor(file) {
        super(`Telemetry ledger exists but is corrupt (unparseable): ${file}`);
        this.name = "TelemetryLedgerCorruptError";
        this.file = file;
    }
}
exports.TelemetryLedgerCorruptError = TelemetryLedgerCorruptError;
/** Read the ledger, DISTINGUISHING absent (never written -> empty chain, fine)
 *  from corrupt (exists but unparseable/wrong shape -> fail closed). Conflating
 *  the two was the bug that let a corrupt overlay verify green and let an append
 *  silently re-genesis on top of it, discarding history. */
function readTelemetryLedgerState(run) {
    const file = telemetryLedgerPath(run);
    if (!node_fs_1.default.existsSync(file))
        return { status: "absent", ledger: { schemaVersion: 1, runId: run.id, records: [] } };
    let parsed;
    try {
        parsed = JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
    }
    catch {
        return { status: "corrupt", file };
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.records)) {
        return { status: "corrupt", file };
    }
    return { status: "ok", ledger: { schemaVersion: 1, runId: run.id, records: parsed.records } };
}
/** Load the ledger for read/append. Absent -> empty chain. Corrupt -> THROWS, so
 *  an append can never silently re-genesis on a poisoned/edited file, and a read
 *  surfaces the corruption rather than swallowing it. */
function loadTelemetryLedger(run) {
    const state = readTelemetryLedgerState(run);
    if (state.status === "corrupt")
        throw new TelemetryLedgerCorruptError(state.file);
    return state.ledger;
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
        ...(record.reportedUsage !== undefined ? { reportedUsage: record.reportedUsage } : {}),
        usageSignature: record.usageSignature || null,
        // Chain-bind resultDigest only when present, so a usage-only record's hash is
        // byte-identical to a pre-result-coverage one (back-compat with old ledgers).
        ...(record.resultDigest !== undefined ? { resultDigest: record.resultDigest } : {}),
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
function recordId(seq) {
    // Deterministic (FreeBSD-audit L13): the chain POSITION, not a process-global
    // counter or wall-clock stamp — recordId is bound into the recordHash chain.
    return `tel-${String(seq).padStart(3, "0")}`;
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
        recordId: recordId(ledger.records.length + 1),
        recordedAt: now,
        workerId: input.workerId,
        taskId: input.taskId,
        promptDigest: input.promptDigest,
        reportedUsageDigest: reportedUsageDigest(input.reportedUsage),
        // Store the raw usage verbatim, digest-bound, and hash-chained so the
        // signature can be independently re-verified offline at `telemetry verify`.
        ...(input.reportedUsage ? { reportedUsage: input.reportedUsage } : {}),
        usageSignature: input.usageSignature,
        // Present only for a result-bound signature, so usage-only records are
        // byte-identical (and their recordHash unchanged) — back-compat.
        ...(input.resultDigest ? { resultDigest: input.resultDigest } : {}),
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
