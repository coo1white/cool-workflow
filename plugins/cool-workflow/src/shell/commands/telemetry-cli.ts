// shell/commands/telemetry-cli.ts — CLI/MCP-reachable body for `cw telemetry
// verify`.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw telemetry verify`", "`cw
// telemetry verify` JSON".

import { cwdArg, optionalArg } from "../../core/util/cli-args.js";
import { resolveTrustPublicKey, verifyTelemetrySignatures } from "../../core/trust/telemetry-attestation.js";
import { loadRunFromCwd } from "../run-store.js";
import { verifyTelemetryLedger } from "../telemetry-ledger-io.js";

export interface TelemetryVerifyResult {
  schemaVersion: 1;
  runId: string;
  present: boolean;
  verified: boolean;
  records: number;
  attested: number;
  unattested: number;
  absent: number;
  /** Workers whose usage record says the agent named its own model. */
  modelSelfReported: number;
  /** Workers with no self-reported model identity at all. */
  modelAbsent: number;
  signatureKeyProvided: boolean;
  signaturesChecked: number;
  signaturesReverified: number;
  signaturesFailed: number;
  failedChecks: Array<{ name: string; code?: string }>;
}

/** Human-facing render of `telemetry verify <run>`. */
export function formatTelemetryVerify(r: TelemetryVerifyResult): string {
  const keyUnreadable = r.failedChecks.some((c) => c.code === "telemetry-pubkey-unreadable");
  if (!r.present && !keyUnreadable) return `telemetry: run ${r.runId} has no attestation ledger (nothing to verify)`;
  const head = r.verified
    ? `✓ VERIFIED — ${r.records} record(s), chain intact, every hash recomputed independently`
    : keyUnreadable
      ? `✗ VERIFICATION REFUSED — supplied public key was unreadable`
      : `✗ TAMPERING DETECTED — ${r.failedChecks.length} check(s) failed`;
  const tally = `   attested ${r.attested} · unattested ${r.unattested} · absent ${r.absent}`;
  const model = `\n   model: agent-self-reported ${r.modelSelfReported} · absent ${r.modelAbsent}`;
  const sig = keyUnreadable
    ? `\n   signatures: public key unreadable; ed25519 re-check refused`
    : r.signatureKeyProvided
      ? `\n   signatures: ${r.signaturesReverified}/${r.signaturesChecked} re-verified against the supplied public key${r.signaturesFailed ? ` · ${r.signaturesFailed} FAILED` : ""}`
      : r.signaturesChecked
        ? `\n   signatures: ${r.signaturesChecked} attested record(s) — chain-proven only; pass --pubkey to re-verify ed25519 offline`
        : "";
  const fails = r.failedChecks.length ? "\n" + r.failedChecks.map((c) => `   ✗ ${c.name}  ${c.code || ""}`).join("\n") : "";
  return `telemetry verify ${r.runId}\n${head}\n${tally}${model}${sig}${fails}`;
}

export function telemetryVerifyCli(runId: string, args: Record<string, unknown>): TelemetryVerifyResult {
  if (!runId) throw new Error("telemetry verify requires a run id (cw telemetry verify <run-id>)");
  const run = loadRunFromCwd(runId, cwdArg(args));
  const v = verifyTelemetryLedger(run);
  // Opt-in independent signature re-verification: supplying the trust
  // public key (--pubkey / CW_AGENT_ATTEST_PUBKEY) additionally RE-RUNS
  // the ed25519 check over each `attested` record's stored raw usage
  // rather than trusting that verdict.
  const trustPublicKeyInput = optionalArg(args.pubkey || args.pubKey || args.publicKey) || process.env.CW_AGENT_ATTEST_PUBKEY;
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
