"use strict";
// shell/telemetry-cli.ts — CLI/MCP-reachable body for `cw telemetry
// verify`.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw telemetry verify`", "`cw
// telemetry verify` JSON".
Object.defineProperty(exports, "__esModule", { value: true });
exports.telemetryVerifyCli = telemetryVerifyCli;
const cli_args_1 = require("../core/util/cli-args");
const telemetry_attestation_1 = require("../core/trust/telemetry-attestation");
const run_store_1 = require("./run-store");
const telemetry_ledger_io_1 = require("./telemetry-ledger-io");
function optionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function telemetryVerifyCli(runId, args) {
    if (!runId)
        throw new Error("telemetry verify requires a run id (cw telemetry verify <run-id>)");
    const run = (0, run_store_1.loadRunFromCwd)(runId, (0, cli_args_1.cwdArg)(args));
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
