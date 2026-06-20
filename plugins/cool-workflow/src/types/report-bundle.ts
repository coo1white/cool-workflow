// Verifiable report bundle — result shapes shared across the run-export verifier,
// the capability-core producer (reportBundle), and the quickstart auto-bundle field
// on QuickstartResult. Kept in types/ (a leaf) so types/drive.ts can reference
// ReportBundleResult without a types->core import cycle.

/** Where the public key used for signature re-verification came from. */
export type TrustKeySource = "bundle" | "argument" | "environment" | "none";

export interface ReportBundleVerification {
  schemaVersion: number;
  archivePath: string;
  runId: string | null;
  /** The single fail-closed verdict: archive bytes intact AND telemetry chain AND
   *  trust-audit chain verify AND no signature re-verification failed AND not a
   *  strict-signatures shortfall. */
  ok: boolean;
  archiveOk: boolean;
  telemetryVerified: boolean;
  trustAuditVerified: boolean;
  trustKeySource: TrustKeySource;
  signatureKeyProvided: boolean;
  signaturesChecked: number;
  signaturesReverified: number;
  signaturesFailed: number;
  /** "signed" when at least one attested signature re-verified and none failed;
   *  otherwise "unsigned" — the archive bytes and chains are intact, but no key
   *  attests the agent's usage/findings. Surfaced so a consumer can refuse an
   *  unsigned bundle with requireSignatures instead of mistaking intact for signed. */
  trustLevel: "signed" | "unsigned";
  /** True when report.md's embedded findings still match each restored result, so
   *  editing the report's findings — which then no longer match the result the agent
   *  signed — is detected. */
  reportFindingsVerified: boolean;
  reportExtractedTo?: string;
  failedChecks: Array<{ name: string; code?: string }>;
}

export interface ReportBundleResult {
  schemaVersion: number;
  runId: string;
  archivePath: string;
  trustKeyEmbedded: boolean;
  reportExtractedTo?: string;
  verification: ReportBundleVerification;
  /** The producer's go/no-go: the bundle was written AND it self-verifies the same
   *  way a recipient will. False means do not ship this artifact. */
  ok: boolean;
}
