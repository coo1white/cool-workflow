// shell/telemetry-cli.ts — CLI/MCP-reachable body for `cw telemetry
// verify`.
//
// MILESTONE 8. Byte-exact port of the old build's capability-core module's
// `telemetryVerify` + cli maintenance-handler module's argv shape.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw telemetry verify`", "`cw
// telemetry verify` JSON"; the old build's capability-core module.

import * as path from "node:path";
import { resolveTrustPublicKey, verifyTelemetrySignatures } from "../core/trust/telemetry-attestation";
import { loadRunFromCwd } from "./run-store";
import { verifyTelemetryLedger } from "./telemetry-ledger-io";
import { TelemetryVerifyResult } from "./telemetry-demo";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function invocationCwd(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}

export function telemetryVerifyCli(runId: string, args: Record<string, unknown>): TelemetryVerifyResult {
  if (!runId) throw new Error("telemetry verify requires a run id (cw telemetry verify <run-id>)");
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const v = verifyTelemetryLedger(run);
  // Opt-in independent signature re-verification: supplying the trust
  // public key (--pubkey / CW_AGENT_ATTEST_PUBKEY) additionally RE-RUNS
  // the ed25519 check over each `attested` record's stored raw usage
  // rather than trusting that verdict.
  const trustPublicKeyInput = optionalString(args.pubkey || args.pubKey || args.publicKey) || process.env.CW_AGENT_ATTEST_PUBKEY;
  const trustPublicKey = resolveTrustPublicKey(trustPublicKeyInput);
  const keyChecks = trustPublicKeyInput && !trustPublicKey ? [{ name: "signature-key", pass: false, code: "telemetry-pubkey-unreadable" }] : [];
  const sig = verifyTelemetrySignatures(v.records, trustPublicKey);
  const failedChecks = [...v.checks.filter((c) => !c.pass), ...keyChecks, ...sig.checks.filter((c) => !c.pass)];
  // Model-identity tally over the run's workers. The label comes only from
  // the worker's usage record; a worker without one is "absent" — the model
  // id is agent-self-reported, never checked by CW.
  const workers = (run.workers as Array<{ usage?: Record<string, unknown> }> | undefined) || [];
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
