// shell/commands/report-cli.ts — CLI/MCP-reachable bodies for `cw report bundle`
// and `cw report verify-bundle`.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw report verify-bundle` and `cw
// report bundle`".
import * as path from "node:path";
import { cwdArg, optionalArg } from "../../core/util/cli-args.js";
import { exportRun, verifyReportBundle } from "../run-export.js";
import { loadRunFromCwd } from "../run-store.js";
import { bold, doctorGlyph } from "../term.js";
const SYSTEM_DIRS = /^\/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var\/log|var\/run)\//;
export function reportBundleCli(runId, args) {
    if (!runId)
        throw new Error("report bundle requires a run id (cw report bundle <run-id>)");
    const base = cwdArg(args);
    const run = loadRunFromCwd(runId, base);
    const output = optionalArg(args.output || args.path || args.archive) || `${runId}.cwrun.json`;
    const outputPath = path.resolve(base, output);
    if (SYSTEM_DIRS.test(outputPath)) {
        throw new Error(`Refusing to write archive to a system directory: ${output}`);
    }
    // Optionally seal in the operator's PUBLIC trust key so the bundle
    // re-verifies offline. Default falls back to the same env the verify
    // gate reads, so a single configured key both attests at record-time
    // and travels with the export.
    const trustKeyArg = optionalArg(args["with-trust-key"] || args.withTrustKey || args.trustKey || args.pubkey) || process.env.CW_AGENT_ATTEST_PUBKEY;
    const exported = exportRun(run, outputPath, { trustPublicKey: trustKeyArg });
    const extractReportTo = optionalArg(args["extract-report"] || args.extractReport || args.extractReportTo);
    const verification = verifyReportBundle(exported.path, {
        pubkey: optionalArg(args.pubkey || args.pubKey || args.publicKey),
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
export function reportVerifyBundleCli(args) {
    const base = cwdArg(args);
    const archive = optionalArg(args.archive || args.path || args.file || args.bundle);
    if (!archive)
        throw new Error("report verify-bundle requires a bundle path (positional, --archive, --path, --file, or --bundle)");
    const extractReportTo = optionalArg(args["extract-report"] || args.extractReport || args.extractReportTo);
    return verifyReportBundle(path.resolve(base, archive), {
        pubkey: optionalArg(args.pubkey || args.pubKey || args.publicKey),
        extractReportTo: extractReportTo ? path.resolve(base, extractReportTo) : undefined,
        strictSignatures: Boolean(args["strict-signatures"] || args.strictSignatures || args.strictSigs),
        requireSignatures: Boolean(args["require-signatures"] || args.requireSignatures || args.requireSigs),
    });
}
/** `cw report verify-bundle`'s human render (default; `--json` prints
 *  `ReportBundleVerification` verbatim instead). Mirrors `doctor`'s
 *  checks-list-then-verdict shape (`shell/doctor.ts`'s
 *  `formatDoctorReport`) — verify-bundle is a flat set of pass/fail
 *  checks on one already-sealed archive. */
export function formatReportVerifyBundle(r) {
    const lines = [bold(`cw report verify-bundle ${r.archivePath}`), ""];
    const checks = [
        [r.archiveOk, "archive intact — file digests match, no tamper"],
        [r.telemetryVerified, "telemetry hash chain verifies"],
        [r.trustAuditVerified, "trust-audit chain verifies"],
        [r.reportFindingsVerified, "report.md matches every signed result"],
    ];
    for (const [ok, label] of checks)
        lines.push(`  ${doctorGlyph(ok ? "ok" : "fail")} ${label}`);
    const sigDetail = r.signatureKeyProvided
        ? `${r.signaturesReverified}/${r.signaturesChecked} signature(s) reverified (key source: ${r.trustKeySource})`
        : "no public key available — signatures not checked";
    lines.push(`  trust: ${r.trustLevel} — ${sigDetail}`);
    if (r.reportExtractedTo)
        lines.push(`  report.md extracted to: ${r.reportExtractedTo}`);
    if (r.failedChecks.length > 0) {
        lines.push("");
        lines.push("  Failed checks");
        for (const c of r.failedChecks) {
            // A short slug code goes in "[code]"; a whole error message (the
            // restore catch-all) gets its own indented line.
            const isSlug = c.code !== undefined && c.code.length <= 40 && !c.code.includes(" ");
            lines.push(`    - ${c.name}${isSlug ? ` [${c.code}]` : ""}`);
            if (c.code !== undefined && !isSlug)
                lines.push(`      ${c.code}`);
        }
    }
    lines.push("");
    lines.push(`${doctorGlyph(r.ok ? "ok" : "fail")} ${r.ok ? "bundle verifies" : "bundle verification FAILED"}`);
    return lines.join("\n");
}
/** `cw report bundle` on a TTY: the check, then where the file went and how
 *  to put it elsewhere. A pipe keeps the JSON (cli/dispatch.ts). */
export function formatReportBundle(json) {
    const r = json;
    const rel = path.relative(process.cwd(), r.archivePath);
    const shown = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : r.archivePath;
    return [
        formatReportVerifyBundle(r.verification),
        "",
        `Bundle saved to: ${shown}`,
        `  To save it somewhere else: cw report bundle ${r.runId} --output <file>`,
        r.ok ? `  Next: send the file; anyone can check it with: cw report verify-bundle ${path.basename(r.archivePath)}` : "  Do not send it: it did not pass the checks above.",
    ].join("\n");
}
