"use strict";
// shell/run-export.ts — portable run archive format: exportRun,
// importRun, inspectArchive, verifyImportedRun, verifyReportBundle.
//
// MILESTONE 8. Byte-exact port of the old build's src/run-export.ts.
// Impure (fs, tmpdir, os) by nature — the archive/bundle mechanism.
//
// Evidence: SPEC/ledger-trust.md "`cw report verify-bundle` JSON", "Files
// on disk" (bundle shape), invariants 16-17, rebuild risk 8.
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
exports.exportRun = exportRun;
exports.importRun = importRun;
exports.restoreRunAtomically = restoreRunAtomically;
exports.verifyImportedRun = verifyImportedRun;
exports.inspectArchive = inspectArchive;
exports.importManifestPath = importManifestPath;
exports.verifyReportBundle = verifyReportBundle;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const hash_1 = require("../core/hash");
const version_1 = require("../core/version");
const fs_atomic_1 = require("./fs-atomic");
const run_paths_1 = require("../core/state/run-paths");
const run_store_1 = require("./run-store");
const telemetry_ledger_io_1 = require("./telemetry-ledger-io");
const telemetry_attestation_1 = require("../core/trust/telemetry-attestation");
const trust_audit_1 = require("./trust-audit");
/** Export a run to a portable JSON archive with run-local bytes and
 *  digests. */
function exportRun(run, outputPath, options = {}) {
    const exportedAt = new Date().toISOString();
    const files = collectArchiveFiles(run);
    const manifestSha256 = digestManifest(files);
    const trustPublicKeyPem = (0, telemetry_attestation_1.resolveTrustPublicKey)(options.trustPublicKey);
    const exported = {
        schemaVersion: 1,
        exportedAt,
        sourceVersion: version_1.CURRENT_COOL_WORKFLOW_VERSION,
        run,
        files,
        integrity: { fileCount: files.length, manifestSha256 },
        ...(trustPublicKeyPem ? { trust: { publicKeyPem: trustPublicKeyPem, algorithm: "ed25519" } } : {}),
        artifacts: files
            .filter((file) => file.role === "artifact")
            .map((file) => ({ path: file.relativePath, contentBase64: file.contentBase64, sha256: file.sha256, sizeBytes: file.sizeBytes })),
        audit: files.filter((file) => file.role === "audit").map((file) => file.relativePath),
    };
    (0, fs_atomic_1.writeJson)(outputPath, exported);
    const archiveSha256 = (0, hash_1.sha256Bytes)(fs.readFileSync(outputPath));
    return {
        runId: run.id,
        exportedAt,
        path: outputPath,
        taskCount: run.tasks.length,
        commitCount: run.commits.length,
        fileCount: files.length,
        artifactCount: files.filter((file) => file.role === "artifact").length,
        auditFileCount: files.filter((file) => file.role === "audit").length,
        telemetryIncluded: files.some((file) => file.role === "telemetry"),
        trustKeyEmbedded: Boolean(trustPublicKeyPem),
        manifestSha256,
        archiveSha256,
    };
}
/** Import a run from a portable JSON file into a target directory. */
function importRun(exportPath, targetDir) {
    const limits = archiveIntakeLimits();
    const archiveBytes = readArchiveBytes(exportPath, limits);
    const raw = JSON.parse(archiveBytes.toString("utf8"));
    if (raw.schemaVersion !== 1)
        throw new Error(`Unsupported export schema version: ${raw.schemaVersion}`);
    const archiveSha256 = (0, hash_1.sha256Bytes)(archiveBytes);
    const files = normalizeArchiveFiles(raw);
    validateArchiveIntake(files, limits);
    verifyArchiveFileDigests(files, raw.integrity, limits);
    if (!raw.run || typeof raw.run !== "object") {
        throw new Error("Invalid run export: missing run object");
    }
    const runId = (0, fs_atomic_1.assertSafeRunId)(raw.run.id);
    const runsRoot = path.join(targetDir, ".cw", "runs");
    const runDir = path.join(runsRoot, runId);
    if (!(0, fs_atomic_1.isContainedPath)(runDir, runsRoot)) {
        throw new Error(`Run id escapes the runs directory: ${JSON.stringify(raw.run.id)}`);
    }
    // Validate the run shape BEFORE the deref and before any dir/file is written.
    // A truncated archive can be missing run.paths (or carry non-string
    // runDir/cwd); without this guard the deref throws a raw TypeError, or a
    // present-but-shapeless paths half-restores the run dir with a broken rebase.
    // Fail closed as an invalid archive instead.
    if (!raw.run.paths ||
        typeof raw.run.paths !== "object" ||
        typeof raw.run.paths.runDir !== "string" ||
        typeof raw.run.cwd !== "string") {
        throw new Error("Invalid run export: run.paths.runDir and run.cwd must be strings");
    }
    const oldRunDir = raw.run.paths.runDir;
    const oldCwd = raw.run.cwd;
    const paths = (0, run_paths_1.createRunPaths)(runDir);
    (0, run_store_1.ensureRunDirs)(paths);
    for (const file of files) {
        const destination = path.join(runDir, file.relativePath);
        if (!(0, fs_atomic_1.isContainedPath)(destination, runDir)) {
            throw new Error(`Archive file escapes restore directory: ${file.relativePath}`);
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, decodeBase64Strict(file.contentBase64, file.relativePath));
    }
    const externalPathMap = new Map();
    for (const file of files) {
        if (file.sourcePath)
            externalPathMap.set(file.sourcePath, path.join(runDir, file.relativePath));
    }
    const run = rebaseRun(raw.run, { oldRunDir, newRunDir: runDir, oldCwd, newCwd: targetDir, paths, externalPathMap });
    (0, run_store_1.saveCheckpoint)(run);
    const manifest = {
        schemaVersion: 1,
        runId: run.id,
        importedAt: new Date().toISOString(),
        sourceVersion: raw.sourceVersion,
        archiveSha256,
        manifestSha256: digestManifest(files),
        files: files.map(({ contentBase64: _contentBase64, ...file }) => file),
    };
    const manifestPath = importManifestPath(run);
    (0, fs_atomic_1.writeJson)(manifestPath, manifest, { durable: true });
    const verification = verifyImportedRun(run);
    return {
        run,
        runDir,
        statePath: paths.state,
        manifestPath,
        verifyCommand: `cw run verify-import ${run.id} --cwd ${targetDir} --json`,
        verification,
    };
}
/** Restore through a same-disk staging tree, then publish the checked run with
 *  one rename. Low-level import keeps its old report-only chain behavior. */
function restoreRunAtomically(exportPath, targetDir) {
    const physicalTarget = path.resolve(targetDir);
    fs.mkdirSync(physicalTarget, { recursive: true });
    const stageRoot = fs.mkdtempSync(path.join(physicalTarget, ".cw-restore-"));
    let publishedRunDir;
    try {
        const staged = importRun(exportPath, stageRoot);
        const finalRunDir = path.join(targetDir, ".cw", "runs", staged.run.id);
        const physicalFinalRunDir = path.resolve(finalRunDir);
        const stagedVerification = rebaseVerificationPaths(staged.verification, staged.run.paths.runDir, finalRunDir);
        if (!staged.verification.ok)
            return { imported: null, verification: stagedVerification };
        if (fs.existsSync(physicalFinalRunDir)) {
            throw new Error(`Refusing to overwrite existing restored run: ${staged.run.id}`);
        }
        const finalPaths = (0, run_paths_1.createRunPaths)(finalRunDir);
        const finalRun = rebaseRun(staged.run, {
            oldRunDir: staged.run.paths.runDir,
            newRunDir: finalRunDir,
            oldCwd: stageRoot,
            newCwd: targetDir,
            paths: finalPaths,
        });
        (0, fs_atomic_1.writeJson)(staged.run.paths.state, finalRun, { durable: true });
        const stateCheck = (0, run_store_1.checkRunStateFile)(staged.run.paths.state);
        if (stateCheck.report.status === "unsupported") {
            throw new Error(`Restore state validation failed: ${stateCheck.report.errors.join("; ") || "unsupported run state"}`);
        }
        fs.mkdirSync(path.dirname(physicalFinalRunDir), { recursive: true });
        fs.renameSync(path.resolve(staged.run.paths.runDir), physicalFinalRunDir);
        publishedRunDir = physicalFinalRunDir;
        const verification = verifyImportedRun(finalRun);
        if (!verification.ok) {
            fs.rmSync(physicalFinalRunDir, { recursive: true, force: true });
            publishedRunDir = undefined;
            return { imported: null, verification };
        }
        return {
            imported: {
                run: finalRun,
                runDir: finalRunDir,
                statePath: finalPaths.state,
                manifestPath: importManifestPath(finalRun),
                verifyCommand: `cw run verify-import ${finalRun.id} --cwd ${targetDir} --json`,
                verification,
            },
            verification,
        };
    }
    catch (error) {
        if (publishedRunDir)
            fs.rmSync(publishedRunDir, { recursive: true, force: true });
        throw error;
    }
    finally {
        fs.rmSync(stageRoot, { recursive: true, force: true });
    }
}
/** Verify an imported run against its restore manifest and telemetry
 *  chain. */
function verifyImportedRun(run) {
    const manifestPath = importManifestPath(run);
    const checks = [];
    if (!fs.existsSync(manifestPath)) {
        return {
            runId: run.id,
            ok: false,
            manifestPath,
            checkedFiles: 0,
            checks: [{ name: "import-manifest", pass: false, code: "missing-import-manifest", path: manifestPath }],
        };
    }
    let manifest;
    try {
        manifest = (0, fs_atomic_1.readJson)(manifestPath);
    }
    catch (error) {
        return {
            runId: run.id,
            ok: false,
            manifestPath,
            checkedFiles: 0,
            checks: [{ name: "import-manifest", pass: false, code: "invalid-import-manifest", path: manifestPath, actual: messageOf(error) }],
        };
    }
    const currentManifestDigest = digestManifest(manifest.files.map((file) => ({ ...file, contentBase64: "" })));
    checks.push({
        name: "import-manifest",
        pass: manifest.runId === run.id && manifest.manifestSha256 === currentManifestDigest,
        code: manifest.runId !== run.id ? "run-id-mismatch" : manifest.manifestSha256 === currentManifestDigest ? undefined : "manifest-digest-mismatch",
        expected: manifest.manifestSha256,
        actual: currentManifestDigest,
    });
    let filesOk = true;
    for (const file of manifest.files) {
        const restoredPath = path.join(run.paths.runDir, file.relativePath);
        if (!(0, fs_atomic_1.isContainedPath)(restoredPath, run.paths.runDir)) {
            filesOk = false;
            checks.push({ name: "archive-file", pass: false, code: "path-escape", path: file.relativePath });
            continue;
        }
        if (!fs.existsSync(restoredPath)) {
            filesOk = false;
            checks.push({ name: "archive-file", pass: false, code: "missing-file", path: file.relativePath, expected: file.sha256 });
            continue;
        }
        const actual = (0, hash_1.sha256Bytes)(fs.readFileSync(restoredPath));
        const pass = actual === file.sha256;
        if (!pass)
            filesOk = false;
        checks.push({ name: "archive-file", pass, code: pass ? undefined : "digest-mismatch", path: file.relativePath, expected: file.sha256, actual });
    }
    checks.push({ name: "archive-files", pass: filesOk, code: filesOk ? undefined : "archive-files-invalid" });
    const telemetry = (0, telemetry_ledger_io_1.verifyTelemetryLedger)(run);
    checks.push({ name: "telemetry-ledger", pass: telemetry.verified, code: telemetry.verified ? undefined : "telemetry-ledger-invalid" });
    const audit = (0, trust_audit_1.verifyTrustAudit)(run);
    checks.push({ name: "trust-audit", pass: audit.verified, code: audit.verified ? undefined : "trust-audit-invalid" });
    return { runId: run.id, ok: checks.every((check) => check.pass), manifestPath, checkedFiles: manifest.files.length, checks };
}
/** Read-only integrity inspection of a portable archive WITHOUT
 *  importing it. Never throws. */
function inspectArchive(archivePath) {
    const base = {
        schemaVersion: 1,
        archivePath,
        ok: false,
        schemaSupported: false,
        runId: null,
        fileCount: 0,
        manifestSha256: null,
        archiveSha256: null,
        checks: [],
    };
    let limits;
    try {
        limits = archiveIntakeLimits();
    }
    catch (error) {
        return { ...base, checks: [{ name: "archive-limit", pass: false, code: "archive-limit-invalid", actual: messageOf(error) }] };
    }
    let bytes;
    try {
        bytes = readArchiveBytes(archivePath, limits);
    }
    catch (error) {
        const message = messageOf(error);
        const limited = message.startsWith("Archive raw byte limit exceeded:");
        return { ...base, checks: [{ name: limited ? "archive-limit" : "archive", pass: false, code: limited ? "archive-limit-raw-bytes" : "archive-unreadable", path: archivePath, actual: message }] };
    }
    base.archiveSha256 = (0, hash_1.sha256Bytes)(bytes);
    let raw;
    try {
        raw = JSON.parse(bytes.toString("utf8"));
    }
    catch (error) {
        return { ...base, checks: [{ name: "archive", pass: false, code: "archive-invalid-json", path: archivePath, actual: messageOf(error) }] };
    }
    if (raw.schemaVersion !== 1) {
        return {
            ...base,
            schemaVersion: typeof raw.schemaVersion === "number" ? raw.schemaVersion : base.schemaVersion,
            checks: [{ name: "schema", pass: false, code: "unsupported-schema", expected: "1", actual: String(raw.schemaVersion) }],
        };
    }
    try {
        const files = normalizeArchiveFiles(raw);
        try {
            validateArchiveIntake(files, limits);
        }
        catch (error) {
            return {
                schemaVersion: 1,
                archivePath,
                ok: false,
                schemaSupported: true,
                runId: raw.run && raw.run.id ? raw.run.id : null,
                fileCount: files.length,
                manifestSha256: raw.integrity ? digestManifest(files) : null,
                archiveSha256: base.archiveSha256,
                checks: [archiveLimitCheck(error)],
            };
        }
        const checks = collectArchiveDigestChecks(files, raw.integrity, limits).checks;
        if (!raw.integrity && /^(1|true|yes|on)$/i.test(process.env.CW_REQUIRE_ARCHIVE_INTEGRITY || "")) {
            checks.push({ name: "archive-integrity", pass: false, code: "archive-integrity-required" });
        }
        return {
            schemaVersion: 1,
            archivePath,
            ok: checks.every((c) => c.pass),
            schemaSupported: true,
            runId: raw.run && raw.run.id ? raw.run.id : null,
            fileCount: files.length,
            manifestSha256: raw.integrity ? digestManifest(files) : null,
            archiveSha256: base.archiveSha256,
            checks,
        };
    }
    catch (error) {
        return { ...base, schemaSupported: true, checks: [{ name: "archive", pass: false, code: "archive-malformed", path: archivePath, actual: messageOf(error) }] };
    }
}
function importManifestPath(run) {
    return path.join(run.paths.runDir, "import-manifest.json");
}
/** True when report.md embeds `expected` (the trimmed result) at the
 *  task's OWN section: a `### <taskId>` heading, a `Result: <path>`
 *  line, then the result body — and the body STARTS WITH `expected`. */
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
/** Verify a portable run bundle OFFLINE and SELF-CONTAINED: prove the
 *  archive bytes, the telemetry hash chain, the trust-audit chain, and
 *  (with the bundle's embedded public key) the ed25519 signatures.
 *  Never throws — every failure is a structured check and a false `ok`.
 *
 *  Key precedence is argument > bundle > environment. */
function verifyReportBundle(archivePath, options = {}) {
    const inspect = inspectArchive(archivePath);
    const failedChecks = inspect.checks.filter((check) => !check.pass).map((check) => ({ name: check.name, code: check.code }));
    const base = {
        schemaVersion: 1,
        archivePath,
        runId: inspect.runId,
        ok: false,
        archiveOk: inspect.ok,
        telemetryVerified: false,
        trustAuditVerified: false,
        trustKeySource: "none",
        signatureKeyProvided: false,
        signaturesChecked: 0,
        signaturesReverified: 0,
        signaturesFailed: 0,
        trustLevel: "unsigned",
        reportFindingsVerified: false,
        failedChecks,
    };
    if (!inspect.schemaSupported || inspect.checks.some((check) => check.code?.startsWith("archive-limit-")))
        return base;
    let bundleKey;
    let reportContent;
    try {
        const raw = JSON.parse(readArchiveBytes(archivePath, archiveIntakeLimits()).toString("utf8"));
        bundleKey = raw.trust?.publicKeyPem;
        if (options.extractReportTo) {
            const reportFile = (raw.files || []).find((file) => file.relativePath === "report.md");
            if (reportFile) {
                const decoded = decodeBase64StrictResult(reportFile.contentBase64, reportFile.relativePath);
                if (decoded.ok)
                    reportContent = decoded.bytes.toString("utf8");
            }
        }
    }
    catch {
        /* inspect already recorded the parse failure; treat key as absent */
    }
    // Key precedence: an explicit operator --pubkey/options.pubkey WINS over a
    // bundle-embedded key. A bundle carries its own key so it verifies OFFLINE,
    // but that key must never OVERRIDE a key the operator pinned by hand — else a
    // bundle re-signed with an attacker's OWN key (and embedding that key) would
    // verify green against itself. When the operator pins a key AND the bundle
    // embeds a DIFFERENT one, fail closed with a clear trust-key-mismatch rather
    // than silently trusting the bundle's own key.
    const resolvedArg = (0, telemetry_attestation_1.resolveTrustPublicKey)(options.pubkey);
    const resolvedBundle = (0, telemetry_attestation_1.resolveTrustPublicKey)(bundleKey);
    const resolvedEnv = (0, telemetry_attestation_1.resolveTrustPublicKey)(process.env.CW_AGENT_ATTEST_PUBKEY);
    let trustKey;
    let trustKeySource;
    let trustKeyConflict = false;
    if (options.pubkey) {
        trustKey = resolvedArg;
        trustKeySource = "argument";
        if (resolvedArg && resolvedBundle && normalizePem(resolvedArg) !== normalizePem(resolvedBundle)) {
            trustKeyConflict = true;
            failedChecks.push({ name: "trust-key", code: "trust-key-mismatch" });
        }
    }
    else if (bundleKey) {
        trustKey = resolvedBundle;
        trustKeySource = "bundle";
    }
    else if (process.env.CW_AGENT_ATTEST_PUBKEY) {
        trustKey = resolvedEnv;
        trustKeySource = "environment";
    }
    else {
        trustKey = undefined;
        trustKeySource = "none";
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-verify-bundle-"));
    let telemetryVerified = false;
    let trustAuditVerified = false;
    let signaturesChecked = 0;
    let signaturesReverified = 0;
    let signaturesFailed = 0;
    let signaturesResultBound = 0;
    let reportFindingsOk = true;
    let reportExtractedTo;
    try {
        const imported = importRun(archivePath, tmpDir);
        for (const check of imported.verification.checks) {
            if (check.name === "telemetry-ledger")
                telemetryVerified = check.pass;
            if (check.name === "trust-audit")
                trustAuditVerified = check.pass;
            if (!check.pass)
                failedChecks.push({ name: check.name, code: check.code });
        }
        const ledger = (0, telemetry_ledger_io_1.verifyTelemetryLedger)(imported.run);
        const sig = (0, telemetry_attestation_1.verifyTelemetrySignatures)(ledger.records, trustKey);
        signaturesChecked = sig.checked;
        signaturesReverified = sig.reverified;
        signaturesFailed = sig.failed;
        signaturesResultBound = sig.resultBound.length;
        for (const check of sig.checks)
            if (!check.pass)
                failedChecks.push({ name: check.name, code: check.code });
        // Report ⇄ result ⇄ signature cross-check — driven by sig.resultBound
        // (records whose signature actually COVERED the result), NEVER
        // run.tasks (unbound data an attacker can edit).
        const reportPath = imported.run.paths.report;
        const reportMd = reportPath && fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
        const completedById = new Map(imported.run.tasks.filter((task) => task.status === "completed").map((task) => [task.id, task]));
        for (const bound of sig.resultBound) {
            const failBound = (code) => {
                reportFindingsOk = false;
                failedChecks.push({ name: "report-findings", code: `${code}:${bound.taskId}` });
            };
            const task = completedById.get(bound.taskId);
            if (!task || !task.resultPath || !fs.existsSync(task.resultPath)) {
                failBound("result-missing");
                continue;
            }
            const resultRaw = fs.readFileSync(task.resultPath, "utf8");
            if ((0, hash_1.sha256)(resultRaw) !== bound.resultDigest) {
                failBound("result-digest-mismatch");
                continue;
            }
            if (!reportSectionEmbedsResult(reportMd, bound.taskId, resultRaw.trim())) {
                failBound("report-result-mismatch");
            }
        }
        if (options.extractReportTo && reportContent !== undefined) {
            reportExtractedTo = path.resolve(options.extractReportTo);
            if (options.cwd) {
                const baseCwd = path.resolve(options.cwd);
                if (!(0, fs_atomic_1.isContainedPath)(reportExtractedTo, baseCwd)) {
                    failedChecks.push({ name: "extract-report", code: "path-outside-working-directory" });
                    reportExtractedTo = undefined;
                }
            }
            if (reportExtractedTo)
                fs.writeFileSync(reportExtractedTo, reportContent);
        }
    }
    catch (error) {
        failedChecks.push({ name: "restore", code: messageOf(error) });
    }
    finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    const strictShortfall = Boolean(options.strictSignatures) && signaturesChecked > 0 && !trustKey;
    if (strictShortfall)
        failedChecks.push({ name: "signatures", code: "signature-key-required" });
    const trustLevel = signaturesResultBound > 0 && signaturesFailed === 0 && reportFindingsOk ? "signed" : "unsigned";
    const unsignedShortfall = Boolean(options.requireSignatures) && trustLevel === "unsigned";
    if (unsignedShortfall)
        failedChecks.push({ name: "signatures", code: "signatures-required" });
    const extractShortfall = Boolean(options.extractReportTo) && !reportExtractedTo;
    if (extractShortfall)
        failedChecks.push({ name: "extract-report", code: "report-md-unavailable" });
    return {
        schemaVersion: 1,
        archivePath,
        runId: inspect.runId,
        ok: inspect.ok && telemetryVerified && trustAuditVerified && signaturesFailed === 0 && reportFindingsOk && !strictShortfall && !extractShortfall && !unsignedShortfall && !trustKeyConflict,
        archiveOk: inspect.ok,
        telemetryVerified,
        trustAuditVerified,
        trustKeySource,
        signatureKeyProvided: Boolean(trustKey),
        signaturesChecked,
        signaturesReverified,
        signaturesFailed,
        trustLevel,
        reportFindingsVerified: reportFindingsOk,
        reportExtractedTo,
        failedChecks,
    };
}
function collectArchiveFiles(run) {
    const entries = new Map();
    for (const file of walkFiles(run.paths.runDir)) {
        const relativePath = toArchivePath(path.relative(run.paths.runDir, file));
        if (!relativePath || relativePath === "state.json" || relativePath === "import-manifest.json" || relativePath.endsWith(".lock"))
            continue;
        addFile(entries, file, roleForRelativePath(relativePath), run.paths.runDir);
    }
    for (const artifactPath of collectReferencedArtifactPaths(run)) {
        if (!artifactPath || !fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile())
            continue;
        if ((0, fs_atomic_1.isContainedPath)(artifactPath, run.paths.runDir)) {
            addFile(entries, artifactPath, "artifact", run.paths.runDir);
            continue;
        }
        if ((0, fs_atomic_1.isContainedPath)(artifactPath, run.cwd))
            addExternalArtifactFile(entries, artifactPath);
    }
    return [...entries.values()].sort((left, right) => (left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0));
}
function addFile(entries, file, role, runDir) {
    const relativePath = toArchivePath(path.relative(runDir, file));
    if (relativePath === "state.json" || relativePath === "import-manifest.json")
        return;
    if (!relativePath || relativePath.startsWith("../"))
        return;
    const bytes = fs.readFileSync(file);
    entries.set(relativePath, { relativePath, role, contentBase64: bytes.toString("base64"), sha256: (0, hash_1.sha256Bytes)(bytes), sizeBytes: bytes.length });
}
function addExternalArtifactFile(entries, file) {
    const sourcePath = path.resolve(file);
    const bytes = fs.readFileSync(sourcePath);
    const relativePath = `external-artifacts/${(0, hash_1.sha256Bytes)(Buffer.from(sourcePath, "utf8")).slice(0, 16)}-${safeArchiveBasename(path.basename(sourcePath))}`;
    entries.set(relativePath, { relativePath, role: "artifact", contentBase64: bytes.toString("base64"), sha256: (0, hash_1.sha256Bytes)(bytes), sizeBytes: bytes.length, sourcePath });
}
function collectReferencedArtifactPaths(run) {
    const paths = new Set();
    for (const node of run.nodes || []) {
        for (const artifact of node.artifacts || [])
            addArtifactPath(paths, run, artifact.path);
    }
    const candidates = (run.candidates || []);
    for (const candidate of candidates) {
        for (const artifact of candidate.artifacts || [])
            addArtifactPath(paths, run, artifact.path);
    }
    const selections = (run.candidateSelections || []);
    for (const selection of selections) {
        for (const artifact of selection.artifacts || [])
            addArtifactPath(paths, run, artifact.path);
    }
    const bbArtifacts = (run.blackboard?.artifacts || []);
    for (const artifact of bbArtifacts)
        addArtifactPath(paths, run, artifact.path);
    return [...paths].sort();
}
function addArtifactPath(paths, run, value) {
    if (!value)
        return;
    paths.add(path.isAbsolute(value) ? value : path.resolve(run.cwd, value));
}
function walkFiles(root) {
    if (!fs.existsSync(root))
        return [];
    const found = [];
    for (const name of fs.readdirSync(root)) {
        const file = path.join(root, name);
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink())
            continue;
        if (stat.isDirectory())
            found.push(...walkFiles(file));
        else if (stat.isFile())
            found.push(file);
    }
    return found;
}
function roleForRelativePath(relativePath) {
    if (relativePath === "telemetry.json")
        return "telemetry";
    if (relativePath === "audit" || relativePath.startsWith("audit/"))
        return "audit";
    if (relativePath === "artifacts" || relativePath.startsWith("artifacts/"))
        return "artifact";
    return "run-file";
}
function normalizeArchiveFiles(raw) {
    const modernValue = raw.files;
    if (modernValue !== undefined && !Array.isArray(modernValue)) {
        throw new Error("Invalid run export: files must be an array");
    }
    const modern = (modernValue || []);
    if (modern.length) {
        return validateArchiveFileTable(modern.map(normalizeModernArchiveFile));
    }
    const legacyValue = raw.artifacts;
    if (legacyValue !== undefined && !Array.isArray(legacyValue)) {
        throw new Error("Invalid run export: artifacts must be an array");
    }
    const legacy = (legacyValue || []).map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("Invalid run export: every artifact must be an object");
        }
        const artifact = value;
        if (typeof artifact.path !== "string")
            throw new Error("Invalid run export: artifact path must be a string");
        const contentBase64 = artifact.contentBase64 || Buffer.from("", "utf8").toString("base64");
        if (typeof contentBase64 !== "string")
            throw new Error(`Invalid run export: contentBase64 must be a string for ${artifact.path}`);
        const bytes = Buffer.from(contentBase64, "base64");
        return {
            relativePath: cleanArchiveRelativePath(artifact.path),
            role: "artifact",
            contentBase64,
            sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : (0, hash_1.sha256Bytes)(bytes),
            sizeBytes: artifact.sizeBytes === undefined ? bytes.length : artifact.sizeBytes,
        };
    });
    return validateArchiveFileTable(legacy);
}
function archiveIntakeLimits() {
    return {
        rawBytes: archiveLimitFromEnvironment("CW_MAX_RUN_ARCHIVE_BYTES"),
        fileCount: archiveLimitFromEnvironment("CW_MAX_RUN_ARCHIVE_FILES"),
        contentBytes: archiveLimitFromEnvironment("CW_MAX_RUN_ARCHIVE_CONTENT_BYTES"),
    };
}
function archiveLimitFromEnvironment(name) {
    const value = process.env[name];
    if (value === undefined)
        return undefined;
    if (!/^[1-9][0-9]*$/.test(value))
        throw new Error(`Invalid ${name}: expected a positive safe integer`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed))
        throw new Error(`Invalid ${name}: expected a positive safe integer`);
    return parsed;
}
/** Read the archive only after its operator-set raw-byte limit has passed. */
function readArchiveBytes(archivePath, limits) {
    if (limits.rawBytes !== undefined) {
        const size = fs.statSync(archivePath).size;
        if (size > limits.rawBytes)
            throw new Error(`Archive raw byte limit exceeded: max ${limits.rawBytes}, got ${size}`);
    }
    return fs.readFileSync(archivePath);
}
function validateArchiveIntake(files, limits) {
    if (limits.fileCount !== undefined && files.length > limits.fileCount) {
        throw new Error(`Archive file count limit exceeded: max ${limits.fileCount}, got ${files.length}`);
    }
    if (limits.contentBytes === undefined)
        return;
    let total = 0;
    for (const file of files) {
        if (file.sizeBytes > limits.contentBytes - total) {
            throw new Error(`Archive content byte limit exceeded: max ${limits.contentBytes}, got more than ${limits.contentBytes}`);
        }
        total += file.sizeBytes;
    }
}
function archiveLimitCheck(error) {
    const actual = messageOf(error);
    const code = actual.startsWith("Archive file count limit exceeded:")
        ? "archive-limit-file-count"
        : actual.startsWith("Archive content byte limit exceeded:")
            ? "archive-limit-content-bytes"
            : "archive-limit-invalid";
    return { name: "archive-limit", pass: false, code, actual };
}
function normalizeModernArchiveFile(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Invalid run export: every file entry must be an object");
    }
    const file = value;
    if (typeof file.relativePath !== "string")
        throw new Error("Invalid run export: file relativePath must be a string");
    if (typeof file.contentBase64 !== "string")
        throw new Error(`Invalid run export: contentBase64 must be a string for ${file.relativePath}`);
    if (typeof file.sha256 !== "string")
        throw new Error(`Invalid run export: sha256 must be a string for ${file.relativePath}`);
    if (file.sourcePath !== undefined && typeof file.sourcePath !== "string") {
        throw new Error(`Invalid run export: sourcePath must be a string for ${file.relativePath}`);
    }
    return {
        relativePath: cleanArchiveRelativePath(file.relativePath),
        role: file.role,
        contentBase64: file.contentBase64,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        sourcePath: file.sourcePath,
    };
}
/** Make one canonical, unique archive file table before any caller writes.
 *  Digest and base64 checks run next, but shape and path faults stop here. */
function validateArchiveFileTable(files) {
    const roles = new Set(["artifact", "audit", "telemetry", "run-file"]);
    const seen = new Set();
    for (const file of files) {
        if (!roles.has(file.role))
            throw new Error(`Invalid archive file role for ${file.relativePath}: ${String(file.role)}`);
        if (!/^[a-f0-9]{64}$/.test(file.sha256))
            throw new Error(`Invalid archive sha256 for ${file.relativePath}`);
        if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
            throw new Error(`Invalid archive size for ${file.relativePath}: ${String(file.sizeBytes)}`);
        }
        if (file.relativePath === "state.json" || file.relativePath === "import-manifest.json" || file.relativePath.endsWith(".lock")) {
            throw new Error(`Reserved archive relative path: ${file.relativePath}`);
        }
        if (seen.has(file.relativePath))
            throw new Error(`Duplicate archive relative path: ${file.relativePath}`);
        seen.add(file.relativePath);
    }
    return files;
}
function decodeBase64StrictResult(value, relativePath) {
    if (typeof value !== "string") {
        return { ok: false, check: { name: "archive-file", pass: false, code: "archive-bad-base64", path: relativePath, actual: "contentBase64 is not a string" } };
    }
    const compact = value.replace(/\s+/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
        return { ok: false, check: { name: "archive-file", pass: false, code: "archive-bad-base64", path: relativePath, actual: "invalid base64 encoding" } };
    }
    const bytes = Buffer.from(compact, "base64");
    const expected = compact.replace(/=+$/, "");
    const actual = bytes.toString("base64").replace(/=+$/, "");
    if (actual !== expected) {
        return { ok: false, check: { name: "archive-file", pass: false, code: "archive-bad-base64", path: relativePath, actual: "non-canonical base64 encoding" } };
    }
    return { ok: true, bytes };
}
function decodeBase64Strict(value, relativePath) {
    const decoded = decodeBase64StrictResult(value, relativePath);
    if (!decoded.ok)
        throw new Error(archiveCheckMessage(decoded.check));
    return decoded.bytes;
}
function collectArchiveDigestChecks(files, integrity, limits = {}) {
    const checks = [];
    let decodedTotal = 0;
    for (const file of files) {
        const decoded = decodeBase64StrictResult(file.contentBase64, file.relativePath);
        if (!decoded.ok) {
            checks.push(decoded.check);
            continue;
        }
        const bytes = decoded.bytes;
        if (limits.contentBytes !== undefined && bytes.length > limits.contentBytes - decodedTotal) {
            checks.push({ name: "archive-limit", pass: false, code: "archive-limit-content-bytes", path: file.relativePath, expected: String(limits.contentBytes), actual: `more than ${limits.contentBytes}` });
        }
        else {
            decodedTotal += bytes.length;
        }
        const actual = (0, hash_1.sha256Bytes)(bytes);
        const digestOk = actual === file.sha256;
        checks.push(digestOk ? { name: "archive-file", pass: true, path: file.relativePath } : { name: "archive-file", pass: false, code: "digest-mismatch", path: file.relativePath, expected: file.sha256, actual });
        const sizeOk = bytes.length === file.sizeBytes;
        checks.push(sizeOk ? { name: "archive-file", pass: true, path: file.relativePath } : { name: "archive-file", pass: false, code: "size-mismatch", path: file.relativePath, expected: String(file.sizeBytes), actual: String(bytes.length) });
    }
    if (integrity) {
        const countOk = integrity.fileCount === files.length;
        checks.push(countOk ? { name: "archive-file-count", pass: true } : { name: "archive-file-count", pass: false, code: "file-count-mismatch", expected: String(integrity.fileCount), actual: String(files.length) });
        const actualManifest = digestManifest(files);
        const manifestOk = integrity.manifestSha256 === actualManifest;
        checks.push(manifestOk ? { name: "archive-manifest", pass: true } : { name: "archive-manifest", pass: false, code: "manifest-digest-mismatch", expected: integrity.manifestSha256, actual: actualManifest });
    }
    return { checks, ok: checks.every((c) => c.pass) };
}
function archiveCheckMessage(check) {
    switch (check.code) {
        case "digest-mismatch":
            return `Archive digest mismatch for ${check.path}: expected ${check.expected}, got ${check.actual}`;
        case "size-mismatch":
            return `Archive size mismatch for ${check.path}: expected ${check.expected}, got ${check.actual}`;
        case "file-count-mismatch":
            return `Archive file count mismatch: expected ${check.expected}, got ${check.actual}`;
        case "manifest-digest-mismatch":
            return `Archive manifest digest mismatch: expected ${check.expected}, got ${check.actual}`;
        case "archive-bad-base64":
            return `Archive base64 invalid for ${check.path}: ${check.actual}`;
        default:
            return `Archive verification failed: ${check.name}`;
    }
}
function verifyArchiveFileDigests(files, integrity, limits = {}) {
    if (!integrity && /^(1|true|yes|on)$/i.test(process.env.CW_REQUIRE_ARCHIVE_INTEGRITY || "")) {
        throw new Error("Archive integrity block required but absent (CW_REQUIRE_ARCHIVE_INTEGRITY=1)");
    }
    const failed = collectArchiveDigestChecks(files, integrity, limits).checks.find((c) => !c.pass);
    if (failed)
        throw new Error(archiveCheckMessage(failed));
}
function digestManifest(files) {
    const manifest = files
        .map((file) => ({ relativePath: file.relativePath, role: file.role, sha256: file.sha256, sizeBytes: file.sizeBytes }))
        .sort((left, right) => (left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0));
    return (0, hash_1.sha256Bytes)(Buffer.from(JSON.stringify(manifest), "utf8"));
}
function rebaseRun(source, context) {
    const cloned = deepRebase(JSON.parse(JSON.stringify(source)), context);
    cloned.cwd = context.newCwd;
    cloned.paths = context.paths;
    cloned.updatedAt = new Date().toISOString();
    cloned.audit = cloned.audit
        ? {
            schemaVersion: 1,
            eventLogPath: path.join(context.paths.auditDir || path.join(context.paths.runDir, "audit"), "events.jsonl"),
            summaryPath: path.join(context.paths.auditDir || path.join(context.paths.runDir, "audit"), "summary.json"),
            indexPath: path.join(context.paths.auditDir || path.join(context.paths.runDir, "audit"), "index.json"),
        }
        : cloned.audit;
    return cloned;
}
function rebaseVerificationPaths(result, oldRunDir, newRunDir) {
    const replace = (value) => value === oldRunDir || value.startsWith(oldRunDir + path.sep)
        ? newRunDir + value.slice(oldRunDir.length)
        : value;
    return {
        ...result,
        manifestPath: replace(result.manifestPath),
        checks: result.checks.map((check) => ({ ...check, ...(check.path ? { path: replace(check.path) } : {}) })),
    };
}
function deepRebase(value, context) {
    if (typeof value === "string")
        return rebaseString(value, context);
    if (Array.isArray(value))
        return value.map((entry) => deepRebase(entry, context));
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, entry] of Object.entries(value))
            out[key] = deepRebase(entry, context);
        return out;
    }
    return value;
}
function rebaseString(value, context) {
    const archivedExternal = context.externalPathMap?.get(value);
    if (archivedExternal)
        return archivedExternal;
    if (value === context.oldRunDir || value.startsWith(context.oldRunDir + path.sep)) {
        return context.newRunDir + value.slice(context.oldRunDir.length);
    }
    if (value === context.oldCwd || value.startsWith(context.oldCwd + path.sep)) {
        return context.newCwd + value.slice(context.oldCwd.length);
    }
    return value;
}
function cleanArchiveRelativePath(value) {
    const portable = value.replace(/\\/g, "/");
    if (portable.startsWith("/") || /^[A-Za-z]:\//.test(portable) || /(^|\/)\.\.(\/|$)/.test(portable) || /[\u0000-\u001f\u007f]/.test(portable)) {
        throw new Error(`Invalid archive relative path: ${value}`);
    }
    const cleaned = path.posix.normalize(portable);
    if (!cleaned || cleaned === "." || cleaned.startsWith("../") || cleaned.includes("/../"))
        throw new Error(`Invalid archive relative path: ${value}`);
    return cleaned;
}
function toArchivePath(value) {
    return value.split(path.sep).join("/");
}
function safeArchiveBasename(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, "_") || "artifact";
}
/** Compare two PEM public keys byte-for-byte after dropping whitespace, so a
 *  benign line-wrap or trailing-newline difference does not read as a key
 *  change, but a truly different key (different base64 body) does. */
function normalizePem(pem) {
    return (pem || "").replace(/\s+/g, "");
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
