// shell/run-export.ts — the portable run bundle: `cw report bundle` writes
// it, `cw report verify-bundle` checks it offline and fail-closed. The check
// never trusts the bundle's own claims: it recomputes every file digest, the
// telemetry hash chain, the ed25519 signatures, and that report.md embeds
// each signed result byte for byte.
import * as fs from "node:fs";
import * as path from "node:path";
import { sha256, sha256Bytes } from "../core/hash.js";
import { CURRENT_COOL_WORKFLOW_VERSION } from "../core/version.js";
import { assertSafeRunId, isContainedPath, safeFileName, writeJson } from "./fs-atomic.js";
import { resolveTrustPublicKey, verifyTelemetrySignatures } from "../core/trust/telemetry-attestation.js";
import { verifyTelemetryLedgerRecords } from "../core/trust/telemetry-ledger.js";
import { receiptIntact } from "../core/trust/receipt.js";
export const BUNDLE_SCHEMA_VERSION = 2;
function walkFiles(root) {
    if (!fs.existsSync(root))
        return [];
    const found = [];
    for (const name of fs.readdirSync(root)) {
        const file = path.join(root, name);
        const stat = fs.lstatSync(file);
        if (stat.isDirectory())
            found.push(...walkFiles(file));
        else if (stat.isFile())
            found.push(file);
    }
    return found;
}
function roleOf(relativePath) {
    if (relativePath === "telemetry.json")
        return "telemetry";
    if (relativePath === "report.md" || relativePath === "report.html")
        return "report";
    if (relativePath.startsWith("receipts/"))
        return "receipt";
    if (relativePath.startsWith("results/"))
        return "result";
    return "run-file";
}
function digestManifest(files) {
    const rows = files.map((f) => ({ relativePath: f.relativePath, role: f.role, sha256: f.sha256, sizeBytes: f.sizeBytes }));
    rows.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
    return sha256Bytes(Buffer.from(JSON.stringify(rows), "utf8"));
}
/** Write the run folder (minus state.json and locks) as one JSON bundle. */
export function exportRun(run, outputPath, options = {}) {
    const files = walkFiles(run.paths.runDir)
        .map((file) => ({ file, relativePath: path.relative(run.paths.runDir, file).split(path.sep).join("/") }))
        .filter(({ relativePath }) => relativePath !== "state.json" && !relativePath.endsWith(".lock") && !relativePath.endsWith(".tmp"))
        .map(({ file, relativePath }) => {
        const bytes = fs.readFileSync(file);
        return { relativePath, role: roleOf(relativePath), contentBase64: bytes.toString("base64"), sha256: sha256Bytes(bytes), sizeBytes: bytes.length };
    })
        .sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1));
    const publicKeyPem = resolveTrustPublicKey(options.trustPublicKey);
    const bundle = {
        schemaVersion: BUNDLE_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        sourceVersion: CURRENT_COOL_WORKFLOW_VERSION,
        run: { id: run.id, workflowId: run.workflow.id, title: run.workflow.title, createdAt: run.createdAt },
        files,
        integrity: { fileCount: files.length, manifestSha256: digestManifest(files) },
        ...(publicKeyPem ? { trust: { publicKeyPem, algorithm: "ed25519" } } : {}),
    };
    writeJson(outputPath, bundle);
    return { path: outputPath, trustKeyEmbedded: Boolean(publicKeyPem) };
}
/** report.md embeds `expected` at the task's own section:
 *  `### <taskId>`, a `Result: <path>` line, then a body starting with it. */
function reportSectionEmbedsResult(reportMd, taskId, expected) {
    const needle = `### ${taskId}\n`;
    for (let from = reportMd.indexOf(needle); from >= 0; from = reportMd.indexOf(needle, from + 1)) {
        const after = reportMd.slice(from);
        const prefix = after.match(/^### [^\n]*\n\nResult: [^\n]*\n\n/);
        if (prefix && after.slice(prefix[0].length).startsWith(expected))
            return true;
    }
    return false;
}
function limitFromEnv(name) {
    const value = process.env[name];
    if (value === undefined)
        return undefined;
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new Error(`Invalid ${name}: expected a positive safe integer`);
    return Number(value);
}
function cleanRelativePath(value) {
    const portable = String(value).replace(/\\/g, "/");
    const cleaned = path.posix.normalize(portable);
    if (typeof value !== "string" || portable.startsWith("/") || /^[A-Za-z]:\//.test(portable) || /(^|\/)\.\.(\/|$)/.test(portable) || /[\u0000-\u001f\u007f]/.test(portable) || !cleaned || cleaned === ".") {
        throw new Error(`Invalid archive relative path: ${String(value)}`);
    }
    return cleaned;
}
function strictBase64(value) {
    if (typeof value !== "string")
        return undefined;
    const compact = value.replace(/\s+/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact))
        return undefined;
    const bytes = Buffer.from(compact, "base64");
    return bytes.toString("base64").replace(/=+$/, "") === compact.replace(/=+$/, "") ? bytes : undefined;
}
/** Read and check the bundle's file table: limits, shape, safe unique
 *  paths, base64, digests, sizes, count and manifest digest. */
function readBundle(archivePath, fail) {
    const contents = new Map();
    let bundle;
    try {
        const rawLimit = limitFromEnv("CW_MAX_RUN_ARCHIVE_BYTES");
        if (rawLimit !== undefined && fs.statSync(archivePath).size > rawLimit) {
            fail("archive-limit", "archive-limit-raw-bytes");
            return { contents, archiveOk: false, fatal: true };
        }
        bundle = JSON.parse(fs.readFileSync(archivePath, "utf8"));
    }
    catch (error) {
        fail("archive", error instanceof SyntaxError ? "archive-invalid-json" : "archive-unreadable");
        return { contents, archiveOk: false, fatal: true };
    }
    if (!bundle || bundle.schemaVersion !== BUNDLE_SCHEMA_VERSION || !Array.isArray(bundle.files) || !bundle.run || typeof bundle.run.id !== "string") {
        fail("archive-schema", "archive-schema-unsupported");
        return { contents, archiveOk: false, fatal: true };
    }
    try {
        assertSafeRunId(bundle.run.id);
    }
    catch {
        fail("archive-schema", "archive-run-id-unsafe");
        return { contents, archiveOk: false, fatal: true };
    }
    const fileLimit = limitFromEnv("CW_MAX_RUN_ARCHIVE_FILES");
    const contentLimit = limitFromEnv("CW_MAX_RUN_ARCHIVE_CONTENT_BYTES");
    if (fileLimit !== undefined && bundle.files.length > fileLimit) {
        fail("archive-limit", "archive-limit-file-count");
        return { bundle, contents, archiveOk: false, fatal: true };
    }
    let ok = true;
    let total = 0;
    for (const file of bundle.files) {
        let rel;
        try {
            rel = cleanRelativePath(file?.relativePath);
        }
        catch {
            fail("archive-file", "path-escape");
            ok = false;
            continue;
        }
        if (contents.has(rel) || rel === "state.json" || rel.endsWith(".lock")) {
            fail("archive-file", "archive-reserved-or-duplicate-path");
            ok = false;
            continue;
        }
        const bytes = strictBase64(file.contentBase64);
        if (!bytes) {
            fail("archive-file", "archive-bad-base64");
            ok = false;
            continue;
        }
        total += bytes.length;
        if (contentLimit !== undefined && total > contentLimit) {
            fail("archive-limit", "archive-limit-content-bytes");
            return { bundle, contents, archiveOk: false, fatal: true };
        }
        if (sha256Bytes(bytes) !== file.sha256) {
            fail("archive-file", "digest-mismatch");
            ok = false;
        }
        if (bytes.length !== file.sizeBytes) {
            fail("archive-file", "size-mismatch");
            ok = false;
        }
        contents.set(rel, bytes);
    }
    if (!bundle.integrity || bundle.integrity.fileCount !== bundle.files.length) {
        fail("archive-file-count", "file-count-mismatch");
        ok = false;
    }
    if (!bundle.integrity || bundle.integrity.manifestSha256 !== digestManifest(bundle.files)) {
        fail("archive-manifest", "manifest-digest-mismatch");
        ok = false;
    }
    return { bundle, contents, archiveOk: ok, fatal: false };
}
/** Verify a bundle offline. Never throws: each failure is a failed check
 *  and a false `ok`. Key precedence: argument > bundle > environment; an
 *  argument key that differs from the bundle's own fails closed. */
export function verifyReportBundle(archivePath, options = {}) {
    const failedChecks = [];
    const fail = (name, code) => {
        failedChecks.push({ name, code });
    };
    const { bundle, contents, archiveOk, fatal } = readBundle(archivePath, fail);
    const result = {
        schemaVersion: 1,
        archivePath,
        runId: bundle?.run?.id ?? null,
        ok: false,
        archiveOk,
        telemetryVerified: false,
        trustKeySource: "none",
        signatureKeyProvided: false,
        signaturesChecked: 0,
        signaturesReverified: 0,
        signaturesFailed: 0,
        trustLevel: "unsigned",
        reportFindingsVerified: false,
        failedChecks,
    };
    if (fatal || !bundle)
        return result;
    const runId = bundle.run.id;
    const pem = (k) => (k || "").replace(/\s+/g, "");
    const bundleKey = resolveTrustPublicKey(bundle.trust?.publicKeyPem);
    let trustKey;
    if (options.pubkey) {
        trustKey = resolveTrustPublicKey(options.pubkey);
        result.trustKeySource = "argument";
        if (trustKey && bundleKey && pem(trustKey) !== pem(bundleKey))
            fail("trust-key", "trust-key-mismatch");
    }
    else if (bundle.trust?.publicKeyPem) {
        trustKey = bundleKey;
        result.trustKeySource = "bundle";
    }
    else if (process.env.CW_AGENT_ATTEST_PUBKEY) {
        trustKey = resolveTrustPublicKey(process.env.CW_AGENT_ATTEST_PUBKEY);
        result.trustKeySource = "environment";
    }
    result.signatureKeyProvided = Boolean(trustKey);
    // Telemetry chain: absent verifies clean; present but unreadable fails.
    let records = [];
    const telemetry = contents.get("telemetry.json");
    if (telemetry) {
        try {
            const parsed = JSON.parse(telemetry.toString("utf8"));
            if (!Array.isArray(parsed?.records))
                throw new Error("no records");
            records = parsed.records;
            const chain = verifyTelemetryLedgerRecords(runId, records);
            result.telemetryVerified = chain.verified;
            for (const check of chain.checks)
                if (!check.pass)
                    fail("telemetry-ledger", check.code || check.name);
        }
        catch {
            fail("telemetry-ledger", "telemetry-ledger-corrupt");
        }
    }
    else {
        result.telemetryVerified = true;
    }
    const sig = verifyTelemetrySignatures(records, trustKey);
    result.signaturesChecked = sig.checked;
    result.signaturesReverified = sig.reverified;
    result.signaturesFailed = sig.failed;
    for (const check of sig.checks)
        if (!check.pass)
            fail(check.name, check.code || "signature-failed");
    // report.md ⇄ result ⇄ signature: driven only by records whose signature
    // covered the result, never by unsigned data in the bundle.
    let findingsOk = true;
    const reportMd = contents.get("report.md")?.toString("utf8") ?? "";
    for (const bound of sig.resultBound) {
        // A bundle made on either OS verifies on both: look up both spellings.
        const raw = contents.get(`results/${safeFileName(bound.taskId)}.md`)?.toString("utf8");
        const code = raw === undefined ? "result-missing" : sha256(raw) !== bound.resultDigest ? "result-digest-mismatch" : !reportSectionEmbedsResult(reportMd, bound.taskId, raw.trim()) ? "report-result-mismatch" : undefined;
        if (code) {
            findingsOk = false;
            fail("report-findings", `${code}:${bound.taskId}`);
        }
    }
    for (const [rel, bytes] of contents) {
        const m = rel.match(/^receipts\/(.+)\.json$/);
        if (!m)
            continue;
        let raw;
        try {
            raw = JSON.parse(bytes.toString("utf8"));
        }
        catch {
            raw = undefined;
        }
        const code = !receiptIntact(raw) || raw.id !== m[1] ? `receipt-tampered:${m[1]}` : raw.exitCode !== 0 ? `receipt-failed:${m[1]}` : undefined;
        if (code) {
            findingsOk = false;
            fail("receipt", code);
        }
    }
    result.reportFindingsVerified = findingsOk;
    if (options.strictSignatures && sig.checked > 0 && !trustKey)
        fail("signatures", "signature-key-required");
    result.trustLevel = sig.resultBound.length > 0 && sig.failed === 0 && findingsOk ? "signed" : "unsigned";
    if (options.requireSignatures && result.trustLevel === "unsigned")
        fail("signatures", "signatures-required");
    if (options.extractReportTo) {
        const target = path.resolve(options.extractReportTo);
        const report = contents.get("report.md");
        if (options.cwd && !isContainedPath(target, path.resolve(options.cwd)))
            fail("extract-report", "path-outside-working-directory");
        else if (!report)
            fail("extract-report", "report-md-unavailable");
        else {
            fs.writeFileSync(target, report);
            result.reportExtractedTo = target;
        }
    }
    result.ok = archiveOk && failedChecks.length === 0;
    return result;
}
