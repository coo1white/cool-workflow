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
