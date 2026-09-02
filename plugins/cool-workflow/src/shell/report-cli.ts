// shell/report-cli.ts — CLI/MCP-reachable bodies for `cw report bundle`
// and `cw report verify-bundle`.
//
// MILESTONE 8. Byte-exact port of the old build's capability-core module's
// `reportBundle`/`runVerifyReportBundle` argv shapes.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw report verify-bundle` and `cw
// report bundle`".

import * as path from "node:path";
import { exportRun, verifyReportBundle, ReportBundleVerification } from "./run-export";
import { loadRunFromCwd } from "./run-store";
import { bold, doctorGlyph } from "./term";

export interface ReportBundleResult {
  schemaVersion: 1;
  runId: string;
  archivePath: string;
  trustKeyEmbedded: boolean;
  reportExtractedTo?: string;
  verification: ReportBundleVerification;
  ok: boolean;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function invocationCwd(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}

const SYSTEM_DIRS = /^\/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var\/log|var\/run)\//;

export function reportBundleCli(runId: string, args: Record<string, unknown>): ReportBundleResult {
  if (!runId) throw new Error("report bundle requires a run id (cw report bundle <run-id>)");
  const base = invocationCwd(args);
  const run = loadRunFromCwd(runId, base);
  const output = optionalString(args.output || args.path || args.archive) || `${runId}.cwrun.json`;
  const outputPath = path.resolve(base, output);
  if (SYSTEM_DIRS.test(outputPath)) {
    throw new Error(`Refusing to write archive to a system directory: ${output}`);
  }
  // Optionally seal in the operator's PUBLIC trust key so the bundle
  // re-verifies offline. Default falls back to the same env the verify
  // gate reads, so a single configured key both attests at record-time
  // and travels with the export.
  const trustKeyArg = optionalString(args["with-trust-key"] || args.withTrustKey || args.trustKey || args.pubkey) || process.env.CW_AGENT_ATTEST_PUBKEY;
  const exported = exportRun(run, outputPath, { trustPublicKey: trustKeyArg });
  const extractReportTo = optionalString(args["extract-report"] || args.extractReport || args.extractReportTo);
  const verification = verifyReportBundle(exported.path, {
    pubkey: optionalString(args.pubkey || args.pubKey || args.publicKey),
    extractReportTo: extractReportTo ? path.resolve(base, extractReportTo) : undefined,
    strictSignatures: Boolean(args["strict-signatures"] || args.strictSignatures || args.strictSigs),
    requireSignatures: Boolean(args["require-signatures"] || args.requireSignatures || args.requireSigs),
  });
  return {
    schemaVersion: 1,
    runId,
    archivePath: exported.path,
    trustKeyEmbedded: exported.trustKeyEmbedded,
    reportExtractedTo: verification.reportExtractedTo,
    verification,
    ok: verification.ok,
  };
}

export function reportVerifyBundleCli(args: Record<string, unknown>): ReportBundleVerification {
  const base = invocationCwd(args);
  const archive = optionalString(args.archive || args.path || args.file || args.bundle);
  if (!archive) throw new Error("report verify-bundle requires a bundle path (positional, --archive, --path, --file, or --bundle)");
  const extractReportTo = optionalString(args["extract-report"] || args.extractReport || args.extractReportTo);
  return verifyReportBundle(path.resolve(base, archive), {
    pubkey: optionalString(args.pubkey || args.pubKey || args.publicKey),
    extractReportTo: extractReportTo ? path.resolve(base, extractReportTo) : undefined,
    strictSignatures: Boolean(args["strict-signatures"] || args.strictSignatures || args.strictSigs),
    requireSignatures: Boolean(args["require-signatures"] || args.requireSignatures || args.requireSigs),
  });
}

/** `cw report verify-bundle`'s human render (default; `--json` prints
 *  `ReportBundleVerification` verbatim instead). Mirrors `doctor`'s
 *  checks-list-then-verdict shape (`shell/doctor.ts`'s
 *  `formatDoctorReport`) rather than `demo bundle`'s narrative one
 *  (`shell/telemetry-demo.ts`'s `formatBundleDemo`) — verify-bundle is a
 *  flat set of pass/fail checks on one already-sealed archive, not a
 *  multi-step forge-and-catch demonstration. */
export function formatReportVerifyBundle(r: ReportBundleVerification): string {
  const lines: string[] = [bold(`cw report verify-bundle ${r.archivePath}`), ""];
  const checks: Array<[boolean, string]> = [
    [r.archiveOk, "archive intact — file digests match, no tamper"],
    [r.telemetryVerified, "telemetry hash chain verifies"],
    [r.trustAuditVerified, "trust-audit chain verifies"],
    [r.reportFindingsVerified, "report.md matches every signed result"],
  ];
  for (const [ok, label] of checks) lines.push(`  ${doctorGlyph(ok ? "ok" : "fail")} ${label}`);
  const sigDetail = r.signatureKeyProvided
    ? `${r.signaturesReverified}/${r.signaturesChecked} signature(s) reverified (key source: ${r.trustKeySource})`
    : "no public key available — signatures not checked";
  lines.push(`  trust: ${r.trustLevel} — ${sigDetail}`);
  if (r.reportExtractedTo) lines.push(`  report.md extracted to: ${r.reportExtractedTo}`);
  if (r.failedChecks.length > 0) {
    lines.push("");
    lines.push("  Failed checks");
    for (const c of r.failedChecks) {
      // Most check sites in run-export.ts's verifyReportBundle set `code`
      // to a short slug (e.g. "digest-mismatch"); the top-level restore
      // catch-all sets it to the caught error's full message instead
      // (run-export.ts's "restore" failedChecks.push) — too long/sentence-
      // shaped to cram into "name [code]" without reading as a run-on.
      // Give it its own indented line instead.
      const isSlug = c.code !== undefined && c.code.length <= 40 && !c.code.includes(" ");
      lines.push(`    - ${c.name}${isSlug ? ` [${c.code}]` : ""}`);
      if (c.code !== undefined && !isSlug) lines.push(`      ${c.code}`);
    }
  }
  lines.push("");
  lines.push(`${doctorGlyph(r.ok ? "ok" : "fail")} ${r.ok ? "bundle verifies" : "bundle verification FAILED"}`);
  return lines.join("\n");
}
