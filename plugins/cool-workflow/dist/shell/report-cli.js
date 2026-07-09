"use strict";
// shell/report-cli.ts — CLI/MCP-reachable bodies for `cw report bundle`
// and `cw report verify-bundle`.
//
// MILESTONE 8. Byte-exact port of the old build's capability-core.ts's
// `reportBundle`/`runVerifyReportBundle` argv shapes.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw report verify-bundle` and `cw
// report bundle`"; plugins/cool-workflow/src/capability-core.ts:396-433.
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
exports.reportBundleCli = reportBundleCli;
exports.reportVerifyBundleCli = reportVerifyBundleCli;
exports.formatReportVerifyBundle = formatReportVerifyBundle;
const path = __importStar(require("node:path"));
const run_export_1 = require("./run-export");
const run_store_1 = require("./run-store");
const term_1 = require("./term");
function optionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function invocationCwd(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}
const SYSTEM_DIRS = /^\/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var\/log|var\/run)\//;
function reportBundleCli(runId, args) {
    if (!runId)
        throw new Error("report bundle requires a run id (cw report bundle <run-id>)");
    const base = invocationCwd(args);
    const run = (0, run_store_1.loadRunFromCwd)(runId, base);
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
    const exported = (0, run_export_1.exportRun)(run, outputPath, { trustPublicKey: trustKeyArg });
    const extractReportTo = optionalString(args["extract-report"] || args.extractReport || args.extractReportTo);
    const verification = (0, run_export_1.verifyReportBundle)(exported.path, {
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
function reportVerifyBundleCli(args) {
    const base = invocationCwd(args);
    const archive = optionalString(args.archive || args.path || args.file || args.bundle);
    if (!archive)
        throw new Error("report verify-bundle requires a bundle path (positional, --archive, --path, --file, or --bundle)");
    const extractReportTo = optionalString(args["extract-report"] || args.extractReport || args.extractReportTo);
    return (0, run_export_1.verifyReportBundle)(path.resolve(base, archive), {
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
function formatReportVerifyBundle(r) {
    const lines = [(0, term_1.bold)(`cw report verify-bundle ${r.archivePath}`), ""];
    const checks = [
        [r.archiveOk, "archive intact — file digests match, no tamper"],
        [r.telemetryVerified, "telemetry hash chain verifies"],
        [r.trustAuditVerified, "trust-audit chain verifies"],
        [r.reportFindingsVerified, "report.md matches every signed result"],
    ];
    for (const [ok, label] of checks)
        lines.push(`  ${(0, term_1.doctorGlyph)(ok ? "ok" : "fail")} ${label}`);
    const sigDetail = r.signatureKeyProvided
        ? `${r.signaturesReverified}/${r.signaturesChecked} signature(s) reverified (key source: ${r.trustKeySource})`
        : "no public key available — signatures not checked";
    lines.push(`  trust: ${r.trustLevel} — ${sigDetail}`);
    if (r.reportExtractedTo)
        lines.push(`  report.md extracted to: ${r.reportExtractedTo}`);
    if (r.failedChecks.length > 0) {
        lines.push("");
        lines.push("  Failed checks");
        for (const c of r.failedChecks)
            lines.push(`    - ${c.name}${c.code ? ` [${c.code}]` : ""}`);
    }
    lines.push("");
    lines.push(`${(0, term_1.doctorGlyph)(r.ok ? "ok" : "fail")} ${r.ok ? "bundle verifies" : "bundle verification FAILED"}`);
    return lines.join("\n");
}
