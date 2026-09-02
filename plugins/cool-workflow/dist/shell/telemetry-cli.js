"use strict";
// shell/telemetry-cli.ts — CLI/MCP-reachable body for `cw telemetry
// verify`.
//
// MILESTONE 8. Byte-exact port of the old build's capability-core module's
// `telemetryVerify` + cli maintenance-handler module's argv shape.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw telemetry verify`", "`cw
// telemetry verify` JSON"; the old build's capability-core module.
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
exports.telemetryVerifyCli = telemetryVerifyCli;
const path = __importStar(require("node:path"));
const telemetry_attestation_1 = require("../core/trust/telemetry-attestation");
const run_store_1 = require("./run-store");
const telemetry_ledger_io_1 = require("./telemetry-ledger-io");
function optionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function invocationCwd(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}
function telemetryVerifyCli(runId, args) {
    if (!runId)
        throw new Error("telemetry verify requires a run id (cw telemetry verify <run-id>)");
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const v = (0, telemetry_ledger_io_1.verifyTelemetryLedger)(run);
    // Opt-in independent signature re-verification: supplying the trust
    // public key (--pubkey / CW_AGENT_ATTEST_PUBKEY) additionally RE-RUNS
    // the ed25519 check over each `attested` record's stored raw usage
    // rather than trusting that verdict.
    const trustPublicKeyInput = optionalString(args.pubkey || args.pubKey || args.publicKey) || process.env.CW_AGENT_ATTEST_PUBKEY;
    const trustPublicKey = (0, telemetry_attestation_1.resolveTrustPublicKey)(trustPublicKeyInput);
    const keyChecks = trustPublicKeyInput && !trustPublicKey ? [{ name: "signature-key", pass: false, code: "telemetry-pubkey-unreadable" }] : [];
    const sig = (0, telemetry_attestation_1.verifyTelemetrySignatures)(v.records, trustPublicKey);
    const failedChecks = [...v.checks.filter((c) => !c.pass), ...keyChecks, ...sig.checks.filter((c) => !c.pass)];
    // Model-identity tally over the run's workers. The label comes only from
    // the worker's usage record; a worker without one is "absent" — the model
    // id is agent-self-reported, never checked by CW.
    const workers = run.workers || [];
    const modelSelfReported = workers.filter((w) => w.usage && w.usage.modelProvenance === "agent-self-reported").length;
    return {
        schemaVersion: 1,
        runId: run.id,
        present: v.present,
        verified: v.verified && keyChecks.length === 0 && sig.failed === 0,
        records: v.records.length,
        attested: v.attested,
        unattested: v.unattested,
        absent: v.absent,
        modelSelfReported,
        modelAbsent: workers.length - modelSelfReported,
        signatureKeyProvided: sig.keyProvided,
        signaturesChecked: sig.checked,
        signaturesReverified: sig.reverified,
        signaturesFailed: sig.failed,
        failedChecks: failedChecks.map((c) => ({ name: c.name, code: c.code })),
    };
}
