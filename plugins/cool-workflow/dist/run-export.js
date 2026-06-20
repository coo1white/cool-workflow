"use strict";
// Run Export / Import — portable run archive format (Track B).
//
// BSD discipline: explicit state, portable format. Export serializes a run plus
// its run-local files (artifacts, audit overlays, telemetry ledger, reports,
// worker files, commit snapshots) to a single JSON archive. Import restores those
// bytes into a new .cw/runs/<id>/ tree, rebases paths, writes a restore manifest,
// and exposes a deterministic verification pass. No hidden database, no trust in
// paths from the archive without containment checks.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportRun = exportRun;
exports.importRun = importRun;
exports.verifyImportedRun = verifyImportedRun;
exports.inspectArchive = inspectArchive;
exports.importManifestPath = importManifestPath;
exports.verifyReportBundle = verifyReportBundle;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const state_1 = require("./state");
const version_1 = require("./version");
const telemetry_ledger_1 = require("./telemetry-ledger");
const telemetry_attestation_1 = require("./telemetry-attestation");
const trust_audit_1 = require("./trust-audit");
const execution_backend_1 = require("./execution-backend");
const compare_1 = require("./compare");
/** Export a run to a portable JSON archive with run-local bytes and digests. */
function exportRun(run, outputPath, options = {}) {
    const exportedAt = new Date().toISOString();
    const files = collectArchiveFiles(run);
    const manifestSha256 = digestManifest(files);
    // Embed ONLY a public key. resolveTrustPublicKey normalizes an inline PEM or a
    // file path down to inline PEM bytes so the archive is self-contained; a value
    // that resolves to nothing (bad path) yields no trust block rather than a throw.
    const trustPublicKeyPem = (0, telemetry_attestation_1.resolveTrustPublicKey)(options.trustPublicKey);
    const exported = {
        schemaVersion: 1,
        exportedAt,
        sourceVersion: version_1.CURRENT_COOL_WORKFLOW_VERSION,
        run,
        files,
        integrity: {
            fileCount: files.length,
            manifestSha256
        },
        ...(trustPublicKeyPem ? { trust: { publicKeyPem: trustPublicKeyPem, algorithm: "ed25519" } } : {}),
        // Legacy field retained so old readers still find an artifact-ish list.
        artifacts: files
            .filter((file) => file.role === "artifact")
            .map((file) => ({
            path: file.relativePath,
            contentBase64: file.contentBase64,
            sha256: file.sha256,
            sizeBytes: file.sizeBytes
        })),
        audit: files.filter((file) => file.role === "audit").map((file) => file.relativePath)
    };
    (0, state_1.writeJson)(outputPath, exported);
    const archiveSha256 = sha256Bytes(node_fs_1.default.readFileSync(outputPath));
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
        archiveSha256
    };
}
/** Import a run from a portable JSON file into a target directory.
 *  Rebuilds run paths relative to the target dir. */
function importRun(exportPath, targetDir) {
    const raw = (0, state_1.readJson)(exportPath);
    if (raw.schemaVersion !== 1)
        throw new Error(`Unsupported export schema version: ${raw.schemaVersion}`);
    const archiveSha256 = sha256Bytes(node_fs_1.default.readFileSync(exportPath));
    const files = normalizeArchiveFiles(raw);
    verifyArchiveFileDigests(files, raw.integrity);
    if (!raw.run || typeof raw.run !== "object") {
        throw new Error("Invalid run export: missing run object");
    }
    // The run id from the archive becomes a directory name under the target's
    // runs root; a crafted id like "../../etc" would otherwise escape it. Refuse
    // any id that is not a single safe path segment, then assert containment as
    // defense-in-depth (catches a symlinked runs root too) before any write.
    const runId = (0, state_1.assertSafeRunId)(raw.run.id);
    const runsRoot = node_path_1.default.join(targetDir, ".cw", "runs");
    const runDir = node_path_1.default.join(runsRoot, runId);
    if (!(0, state_1.isContainedPath)(runDir, runsRoot)) {
        throw new Error(`Run id escapes the runs directory: ${JSON.stringify(raw.run.id)}`);
    }
    const oldRunDir = raw.run.paths.runDir;
    const oldCwd = raw.run.cwd;
    const paths = (0, state_1.createRunPaths)(runDir);
    (0, state_1.ensureRunDirs)(paths);
    for (const file of files) {
        const destination = node_path_1.default.join(runDir, file.relativePath);
        if (!(0, state_1.isContainedPath)(destination, runDir)) {
            throw new Error(`Archive file escapes restore directory: ${file.relativePath}`);
        }
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(destination), { recursive: true });
        node_fs_1.default.writeFileSync(destination, Buffer.from(file.contentBase64, "base64"));
    }
    const externalPathMap = new Map();
    for (const file of files) {
        if (file.sourcePath)
            externalPathMap.set(file.sourcePath, node_path_1.default.join(runDir, file.relativePath));
    }
    const run = rebaseRun(raw.run, {
        oldRunDir,
        newRunDir: runDir,
        oldCwd,
        newCwd: targetDir,
        paths,
        externalPathMap
    });
    (0, state_1.saveCheckpoint)(run);
    const manifest = {
        schemaVersion: 1,
        runId: run.id,
        importedAt: new Date().toISOString(),
        sourceVersion: raw.sourceVersion,
        archiveSha256,
        manifestSha256: digestManifest(files),
        files: files.map(({ contentBase64: _contentBase64, ...file }) => file)
    };
    const manifestPath = importManifestPath(run);
    (0, state_1.writeJson)(manifestPath, manifest, { durable: true });
    const verification = verifyImportedRun(run);
    return {
        run,
        runDir,
        statePath: paths.state,
        manifestPath,
        verifyCommand: `cw run verify-import ${run.id} --cwd ${targetDir} --json`,
        verification
    };
}
/** Verify an imported run against its restore manifest and telemetry chain. */
function verifyImportedRun(run) {
    const manifestPath = importManifestPath(run);
    const checks = [];
    if (!node_fs_1.default.existsSync(manifestPath)) {
        return {
            runId: run.id,
            ok: false,
            manifestPath,
            checkedFiles: 0,
            checks: [{ name: "import-manifest", pass: false, code: "missing-import-manifest", path: manifestPath }]
        };
    }
    let manifest;
    try {
        manifest = (0, state_1.readJson)(manifestPath);
    }
    catch (error) {
        return {
            runId: run.id,
            ok: false,
            manifestPath,
            checkedFiles: 0,
            checks: [{ name: "import-manifest", pass: false, code: "invalid-import-manifest", path: manifestPath, actual: messageOf(error) }]
        };
    }
    const currentManifestDigest = digestManifest(manifest.files.map((file) => ({ ...file, contentBase64: "" })));
    checks.push({
        name: "import-manifest",
        pass: manifest.runId === run.id && manifest.manifestSha256 === currentManifestDigest,
        code: manifest.runId !== run.id ? "run-id-mismatch" : manifest.manifestSha256 === currentManifestDigest ? undefined : "manifest-digest-mismatch",
        expected: manifest.manifestSha256,
        actual: currentManifestDigest
    });
    let filesOk = true;
    for (const file of manifest.files) {
        const restoredPath = node_path_1.default.join(run.paths.runDir, file.relativePath);
        if (!(0, state_1.isContainedPath)(restoredPath, run.paths.runDir)) {
            filesOk = false;
            checks.push({ name: "archive-file", pass: false, code: "path-escape", path: file.relativePath });
            continue;
        }
        if (!node_fs_1.default.existsSync(restoredPath)) {
            filesOk = false;
            checks.push({ name: "archive-file", pass: false, code: "missing-file", path: file.relativePath, expected: file.sha256 });
            continue;
        }
        const actual = sha256Bytes(node_fs_1.default.readFileSync(restoredPath));
        const pass = actual === file.sha256;
        if (!pass)
            filesOk = false;
        checks.push({
            name: "archive-file",
            pass,
            code: pass ? undefined : "digest-mismatch",
            path: file.relativePath,
            expected: file.sha256,
            actual
        });
    }
    checks.push({ name: "archive-files", pass: filesOk, code: filesOk ? undefined : "archive-files-invalid" });
    const telemetry = (0, telemetry_ledger_1.verifyTelemetryLedger)(run);
    checks.push({
        name: "telemetry-ledger",
        pass: telemetry.verified,
        code: telemetry.verified ? undefined : "telemetry-ledger-invalid"
    });
    // Re-prove the trust-audit hash chain on restore too. Telemetry was already
    // re-proven above, but the decisions/sandbox/commit-gate audit chain — also
    // exported under audit/ — was not, an asymmetry a tampered restore could slip
    // through. An absent chain is verified:true (nothing to prove), so archives
    // predating audit export append a PASSING check — no false-red.
    const audit = (0, trust_audit_1.verifyTrustAudit)(run);
    checks.push({
        name: "trust-audit",
        pass: audit.verified,
        code: audit.verified ? undefined : "trust-audit-invalid"
    });
    return {
        runId: run.id,
        ok: checks.every((check) => check.pass),
        manifestPath,
        checkedFiles: manifest.files.length,
        checks
    };
}
/** Read-only integrity inspection of a portable archive WITHOUT importing it. Never
 *  throws — a read error, bad JSON, unsupported schema, or any digest/size/count/
 *  manifest mismatch is reported as a structured check with ok:false. Writes nothing. */
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
        checks: []
    };
    let bytes;
    try {
        bytes = node_fs_1.default.readFileSync(archivePath);
    }
    catch (error) {
        return { ...base, checks: [{ name: "archive", pass: false, code: "archive-unreadable", path: archivePath, actual: messageOf(error) }] };
    }
    base.archiveSha256 = sha256Bytes(bytes);
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
            checks: [{ name: "schema", pass: false, code: "unsupported-schema", expected: "1", actual: String(raw.schemaVersion) }]
        };
    }
    try {
        const files = normalizeArchiveFiles(raw);
        const { checks } = collectArchiveDigestChecks(files, raw.integrity);
        // Faithful preview of what `run import` would do under the same env: with
        // CW_REQUIRE_ARCHIVE_INTEGRITY=1 a stripped-integrity archive is refused by
        // import, so inspect must also report it as failing (ok:false / exit 1) rather
        // than green — otherwise inspect-before-import is misleading in that policy.
        // Default (env unset) is unchanged: inspection only reports the digest checks.
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
            checks
        };
    }
    catch (error) {
        return { ...base, schemaSupported: true, checks: [{ name: "archive", pass: false, code: "archive-malformed", path: archivePath, actual: messageOf(error) }] };
    }
}
function importManifestPath(run) {
    return node_path_1.default.join(run.paths.runDir, "import-manifest.json");
}
/** Verify a portable run bundle OFFLINE and SELF-CONTAINED: prove the archive bytes,
 *  the telemetry hash chain, the trust-audit chain, and (with the bundle's embedded
 *  public key) the ed25519 signatures — WITHOUT a source repo, a pre-existing .cw
 *  tree, or an out-of-band key. Reuses the existing import + restore-verify path: it
 *  restores into an auto-cleaned tmpdir so a stranger's machine is left untouched.
 *  Never throws — every failure is a structured check and a false `ok` (exit-1 worthy).
 *
 *  Key precedence is bundle > argument > environment, so the artifact verifies the
 *  same on any machine; only when the bundle omits a key do the override/env apply. */
/** True when report.md embeds `expected` (the trimmed result) at the task's OWN
 *  section, exactly as orchestrator/report.ts renderResults emits it: a
 *  `### <taskId>` heading, a `Result: <path>` line, then the result body — and the
 *  body STARTS WITH `expected`. Anchoring to the section (not a whole-file substring)
 *  means a decoy copy buried elsewhere does not satisfy it; matching from the heading
 *  forward (rather than to the next heading) means a result body that itself contains
 *  `###` cannot break the bound. The `Result:` path is matched loosely since it is
 *  host-specific (rebased on import). */
function reportSectionEmbedsResult(reportMd, taskId, expected) {
    const needle = `### ${taskId}\n`;
    // Walk EVERY `### <taskId>` occurrence — not just the first — so a stray heading
    // inside an earlier task's result body (which is not followed by the `Result:`
    // structure) is skipped rather than mis-anchoring the check (a false positive on a
    // legitimate, fully-signed bundle whose findings contain markdown headings).
    for (let from = reportMd.indexOf(needle); from >= 0; from = reportMd.indexOf(needle, from + 1)) {
        const after = reportMd.slice(from);
        const prefix = after.match(/^### [^\n]*\n\nResult: [^\n]*\n\n/);
        if (prefix && after.slice(prefix[0].length).startsWith(expected))
            return true;
    }
    return false;
}
function verifyReportBundle(archivePath, options = {}) {
    const inspect = inspectArchive(archivePath);
    const failedChecks = inspect.checks
        .filter((check) => !check.pass)
        .map((check) => ({ name: check.name, code: check.code }));
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
        failedChecks
    };
    // A bundle that is not even a supported archive cannot be restored — report the
    // inspection failure and stop (fail-closed, no tmpdir, nothing written).
    if (!inspect.schemaSupported)
        return base;
    // Read the embedded trust key (and, if requested, the report bytes) straight from
    // the archive JSON. inspectArchive already proved the bytes parse + digest-match.
    let bundleKey;
    let reportContent;
    try {
        const raw = JSON.parse(node_fs_1.default.readFileSync(archivePath, "utf8"));
        bundleKey = raw.trust?.publicKeyPem;
        if (options.extractReportTo) {
            const reportFile = (raw.files || []).find((file) => file.relativePath === "report.md");
            if (reportFile)
                reportContent = Buffer.from(reportFile.contentBase64, "base64").toString("utf8");
        }
    }
    catch {
        /* inspect already recorded the parse failure; treat key as absent */
    }
    const trustKeySource = bundleKey
        ? "bundle"
        : options.pubkey
            ? "argument"
            : process.env.CW_AGENT_ATTEST_PUBKEY
                ? "environment"
                : "none";
    const trustKey = (0, telemetry_attestation_1.resolveTrustPublicKey)(bundleKey || options.pubkey || process.env.CW_AGENT_ATTEST_PUBKEY);
    const tmpDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "cw-verify-bundle-"));
    let telemetryVerified = false;
    let trustAuditVerified = false;
    let signaturesChecked = 0;
    let signaturesReverified = 0;
    let signaturesFailed = 0;
    let signaturesResultBound = 0;
    let reportFindingsOk = true;
    let reportExtractedTo;
    try {
        // Restore into the throwaway tree. importRun digest-checks every file and throws
        // on the first mismatch (or on a stripped integrity block under
        // CW_REQUIRE_ARCHIVE_INTEGRITY=1) — caught below as a failed "restore" check.
        const imported = importRun(archivePath, tmpDir);
        for (const check of imported.verification.checks) {
            if (check.name === "telemetry-ledger")
                telemetryVerified = check.pass;
            if (check.name === "trust-audit")
                trustAuditVerified = check.pass;
            if (!check.pass)
                failedChecks.push({ name: check.name, code: check.code });
        }
        // Independent ed25519 re-verification over the restored ledger using the bundle's
        // own key (or override/env). With no key, attested records degrade to
        // informational (signaturesFailed stays 0); the chain check above still gates ok.
        const ledger = (0, telemetry_ledger_1.verifyTelemetryLedger)(imported.run);
        const sig = (0, telemetry_attestation_1.verifyTelemetrySignatures)(ledger.records, trustKey);
        signaturesChecked = sig.checked;
        signaturesReverified = sig.reverified;
        signaturesFailed = sig.failed;
        signaturesResultBound = sig.resultBound.length;
        for (const check of sig.checks)
            if (!check.pass)
                failedChecks.push({ name: check.name, code: check.code });
        // Report ⇄ result ⇄ signature cross-check — three links so the agent's findings
        // cannot be altered undetected on a signed bundle. CRUCIALLY this is driven by
        // sig.resultBound (the records whose signature actually COVERED the result
        // digest), NOT the run.tasks list — run.tasks is in the archive but bound by
        // nothing (not the manifest digest, the chain, or the signature), so iterating it
        // would let an attacker silence the check by dropping/un-completing a task. The
        // obligation comes from the chained+signed ledger record instead:
        //   1. each bound record's resultDigest is anchored by the executor signature
        //      (coversResult re-verified above) — a 4-field signature is excluded, so an
        //      injected resultDigest is never trusted;
        //   2. the matching completed task's RESTORED result file must hash to that signed
        //      digest (a missing/un-completed task or edited/empty result is a forgery);
        //   3. report.md must embed that result at the task's own `### <taskId>` section.
        // Editing the report breaks link 3; editing the result breaks link 2; editing both
        // to one consistent lie still breaks link 2 (the signed digest does not move);
        // dropping the task fails link 2 (the signed obligation remains).
        const reportPath = imported.run.paths.report;
        const reportMd = reportPath && node_fs_1.default.existsSync(reportPath) ? node_fs_1.default.readFileSync(reportPath, "utf8") : "";
        const completedById = new Map(imported.run.tasks.filter((task) => task.status === "completed").map((task) => [task.id, task]));
        for (const bound of sig.resultBound) {
            const failBound = (code) => {
                reportFindingsOk = false;
                failedChecks.push({ name: "report-findings", code: `${code}:${bound.taskId}` });
            };
            const task = completedById.get(bound.taskId);
            if (!task || !task.resultPath || !node_fs_1.default.existsSync(task.resultPath)) {
                failBound("result-missing");
                continue;
            }
            const resultRaw = node_fs_1.default.readFileSync(task.resultPath, "utf8");
            if ((0, execution_backend_1.sha256)(resultRaw) !== bound.resultDigest) {
                failBound("result-digest-mismatch");
                continue;
            }
            if (!reportSectionEmbedsResult(reportMd, bound.taskId, resultRaw.trim())) {
                failBound("report-result-mismatch");
            }
        }
        if (options.extractReportTo && reportContent !== undefined) {
            reportExtractedTo = node_path_1.default.resolve(options.extractReportTo);
            node_fs_1.default.writeFileSync(reportExtractedTo, reportContent);
        }
    }
    catch (error) {
        failedChecks.push({ name: "restore", code: messageOf(error) });
    }
    finally {
        node_fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    }
    // Strict mode: a bundle that claims attested telemetry but offers no key to check
    // it is unverifiable — refuse rather than green it.
    const strictShortfall = Boolean(options.strictSignatures) && signaturesChecked > 0 && !trustKey;
    if (strictShortfall)
        failedChecks.push({ name: "signatures", code: "signature-key-required" });
    // Trust level + requireSignatures — closes the prior fail-open. "signed" means the
    // agent's SIGNED findings are present and unaltered: at least one result-COVERING
    // signature re-verified against a key, none failed, and each signed result is
    // faithfully embedded in report.md (the forward cross-check held). A usage-only
    // (4-field) signature, an unverifiable one (no key), or a tampered signed finding
    // all yield "unsigned". requireSignatures refuses "unsigned".
    //
    // SCOPE (honest): "signed" attests the SIGNED findings, NOT that the report is
    // exhaustively signed. CW holds no key to sign the rendered report and the ledger
    // chain is self-recomputable, so the report MAY carry additional unsigned content
    // (prose, or extra sections), and a determined re-chainer can OMIT a signed
    // finding. Verify findings against the signed results; full report-completeness
    // needs an external anchor. See report-verifiable-bundle.7.md / trust-model.md.
    const trustLevel = signaturesResultBound > 0 && signaturesFailed === 0 && reportFindingsOk ? "signed" : "unsigned";
    const unsignedShortfall = Boolean(options.requireSignatures) && trustLevel === "unsigned";
    if (unsignedShortfall)
        failedChecks.push({ name: "signatures", code: "signatures-required" });
    // Extraction was requested but could not be fulfilled (no report.md in the bundle,
    // or the write failed): fail closed rather than silently green a missing artifact —
    // otherwise `report bundle <run> --extract-report r.md && send r.md` would ship
    // nothing (or a stale file) with exit 0. A requested-but-absent output is a failure,
    // not a no-op (distinct from extraction never being requested).
    const extractShortfall = Boolean(options.extractReportTo) && !reportExtractedTo;
    if (extractShortfall)
        failedChecks.push({ name: "extract-report", code: "report-md-unavailable" });
    return {
        schemaVersion: 1,
        archivePath,
        runId: inspect.runId,
        ok: inspect.ok &&
            telemetryVerified &&
            trustAuditVerified &&
            signaturesFailed === 0 &&
            reportFindingsOk &&
            !strictShortfall &&
            !extractShortfall &&
            !unsignedShortfall,
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
        failedChecks
    };
}
function collectArchiveFiles(run) {
    const entries = new Map();
    for (const file of walkFiles(run.paths.runDir)) {
        const relativePath = toArchivePath(node_path_1.default.relative(run.paths.runDir, file));
        if (!relativePath || relativePath === "state.json" || relativePath === "import-manifest.json" || relativePath.endsWith(".lock"))
            continue;
        addFile(entries, run, file, roleForRelativePath(relativePath));
    }
    for (const artifactPath of collectReferencedArtifactPaths(run)) {
        if (!artifactPath || !node_fs_1.default.existsSync(artifactPath) || !node_fs_1.default.statSync(artifactPath).isFile())
            continue;
        if ((0, state_1.isContainedPath)(artifactPath, run.paths.runDir)) {
            addFile(entries, run, artifactPath, "artifact");
            continue;
        }
        if ((0, state_1.isContainedPath)(artifactPath, run.cwd))
            addExternalArtifactFile(entries, run, artifactPath);
    }
    return [...entries.values()].sort((left, right) => (0, compare_1.compareBytes)(left.relativePath, right.relativePath));
}
function addFile(entries, run, file, role) {
    const relativePath = toArchivePath(node_path_1.default.relative(run.paths.runDir, file));
    if (relativePath === "state.json" || relativePath === "import-manifest.json")
        return;
    if (!relativePath || relativePath.startsWith("../"))
        return;
    const bytes = node_fs_1.default.readFileSync(file);
    entries.set(relativePath, {
        relativePath,
        role,
        contentBase64: bytes.toString("base64"),
        sha256: sha256Bytes(bytes),
        sizeBytes: bytes.length
    });
}
function addExternalArtifactFile(entries, run, file) {
    const sourcePath = node_path_1.default.resolve(file);
    const bytes = node_fs_1.default.readFileSync(sourcePath);
    const relativePath = `external-artifacts/${sha256Bytes(Buffer.from(sourcePath, "utf8")).slice(0, 16)}-${safeArchiveBasename(node_path_1.default.basename(sourcePath))}`;
    entries.set(relativePath, {
        relativePath,
        role: "artifact",
        contentBase64: bytes.toString("base64"),
        sha256: sha256Bytes(bytes),
        sizeBytes: bytes.length,
        sourcePath
    });
}
function collectReferencedArtifactPaths(run) {
    const paths = new Set();
    for (const node of run.nodes || []) {
        for (const artifact of node.artifacts || [])
            addArtifactPath(paths, run, artifact.path);
    }
    for (const candidate of run.candidates || []) {
        for (const artifact of candidate.artifacts || [])
            addArtifactPath(paths, run, artifact.path);
    }
    for (const selection of run.candidateSelections || []) {
        for (const artifact of selection.artifacts || [])
            addArtifactPath(paths, run, artifact.path);
    }
    for (const artifact of run.blackboard?.artifacts || [])
        addArtifactPath(paths, run, artifact.path);
    return [...paths].sort();
}
function addArtifactPath(paths, run, value) {
    if (!value)
        return;
    paths.add(node_path_1.default.isAbsolute(value) ? value : node_path_1.default.resolve(run.cwd, value));
}
function walkFiles(root) {
    if (!node_fs_1.default.existsSync(root))
        return [];
    const found = [];
    for (const name of node_fs_1.default.readdirSync(root)) {
        const file = node_path_1.default.join(root, name);
        const stat = node_fs_1.default.lstatSync(file);
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
    const modern = raw.files || [];
    if (modern.length) {
        return modern.map((file) => ({
            relativePath: cleanArchiveRelativePath(file.relativePath),
            role: file.role,
            contentBase64: file.contentBase64,
            sha256: file.sha256,
            sizeBytes: file.sizeBytes,
            sourcePath: file.sourcePath
        }));
    }
    return (raw.artifacts || []).map((artifact) => {
        const contentBase64 = artifact.contentBase64 || Buffer.from(artifact.content || "", "utf8").toString("base64");
        const bytes = Buffer.from(contentBase64, "base64");
        return {
            relativePath: cleanArchiveRelativePath(artifact.path),
            role: "artifact",
            contentBase64,
            sha256: artifact.sha256 || sha256Bytes(bytes),
            sizeBytes: artifact.sizeBytes ?? bytes.length
        };
    });
}
/** NON-throwing digest/size/count/manifest verification: one structured check per
 *  file (in import order), then the integrity file-count + manifest checks. Shared
 *  by the throwing import path (verifyArchiveFileDigests) and the read-only
 *  inspectArchive, so a single offender list has one source of truth. */
function collectArchiveDigestChecks(files, integrity) {
    const checks = [];
    for (const file of files) {
        const bytes = Buffer.from(file.contentBase64, "base64");
        const actual = sha256Bytes(bytes);
        const digestOk = actual === file.sha256;
        checks.push(digestOk
            ? { name: "archive-file", pass: true, path: file.relativePath }
            : { name: "archive-file", pass: false, code: "digest-mismatch", path: file.relativePath, expected: file.sha256, actual });
        const sizeOk = bytes.length === file.sizeBytes;
        checks.push(sizeOk
            ? { name: "archive-file", pass: true, path: file.relativePath }
            : { name: "archive-file", pass: false, code: "size-mismatch", path: file.relativePath, expected: String(file.sizeBytes), actual: String(bytes.length) });
    }
    if (integrity) {
        const countOk = integrity.fileCount === files.length;
        checks.push(countOk
            ? { name: "archive-file-count", pass: true }
            : { name: "archive-file-count", pass: false, code: "file-count-mismatch", expected: String(integrity.fileCount), actual: String(files.length) });
        const actualManifest = digestManifest(files);
        const manifestOk = integrity.manifestSha256 === actualManifest;
        checks.push(manifestOk
            ? { name: "archive-manifest", pass: true }
            : { name: "archive-manifest", pass: false, code: "manifest-digest-mismatch", expected: integrity.manifestSha256, actual: actualManifest });
    }
    return { checks, ok: checks.every((c) => c.pass) };
}
/** Reconstruct the legacy throw message for a failing check, so the throwing import
 *  path stays BYTE-IDENTICAL after the collector refactor. */
function archiveCheckMessage(check) {
    switch (check.code) {
        case "digest-mismatch": return `Archive digest mismatch for ${check.path}: expected ${check.expected}, got ${check.actual}`;
        case "size-mismatch": return `Archive size mismatch for ${check.path}: expected ${check.expected}, got ${check.actual}`;
        case "file-count-mismatch": return `Archive file count mismatch: expected ${check.expected}, got ${check.actual}`;
        case "manifest-digest-mismatch": return `Archive manifest digest mismatch: expected ${check.expected}, got ${check.actual}`;
        default: return `Archive verification failed: ${check.name}`;
    }
}
function verifyArchiveFileDigests(files, integrity) {
    // Opt-in hardening (CW_REQUIRE_ARCHIVE_INTEGRITY=1): refuse an archive whose
    // top-level integrity block (manifest digest + file count) is absent, closing the
    // legacy fail-open seam where a stripped-integrity archive imported unverified.
    // Same env-boolish convention as CW_REQUIRE_RESOLVABLE_EVIDENCE (evidence-grounding.ts:57).
    // Default (unset) keeps legacy integrity-less archives byte-identical.
    if (!integrity && /^(1|true|yes|on)$/i.test(process.env.CW_REQUIRE_ARCHIVE_INTEGRITY || "")) {
        throw new Error("Archive integrity block required but absent (CW_REQUIRE_ARCHIVE_INTEGRITY=1)");
    }
    // Throw-before-write preserved: throw on the FIRST failing check, in the same
    // order (per-file digest then size, then file-count, then manifest) and with the
    // same message the inline checks produced.
    const failed = collectArchiveDigestChecks(files, integrity).checks.find((c) => !c.pass);
    if (failed)
        throw new Error(archiveCheckMessage(failed));
}
function digestManifest(files) {
    const manifest = files
        // sourcePath is deliberately EXCLUDED: it is a host-absolute bookkeeping path
        // (for externalPathMap), not integrity-bearing content — the file's bytes are
        // already bound by sha256 + sizeBytes. Including it would make the digest
        // differ across hosts for byte-identical content, defeating cross-host repro.
        .map((file) => ({
        relativePath: file.relativePath,
        role: file.role,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes
    }))
        // Codepoint order, NOT localeCompare: this manifest feeds a sha256 integrity
        // digest. Locale-sensitive collation would order identical bytes differently
        // across hosts/locales, making the digest non-reproducible cross-host.
        .sort((left, right) => (left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0));
    return sha256Bytes(Buffer.from(JSON.stringify(manifest), "utf8"));
}
function rebaseRun(source, context) {
    const cloned = deepRebase(JSON.parse(JSON.stringify(source)), context);
    cloned.cwd = context.newCwd;
    cloned.paths = context.paths;
    cloned.updatedAt = new Date().toISOString();
    cloned.audit = cloned.audit
        ? {
            schemaVersion: 1,
            eventLogPath: node_path_1.default.join(context.paths.auditDir || node_path_1.default.join(context.paths.runDir, "audit"), "events.jsonl"),
            summaryPath: node_path_1.default.join(context.paths.auditDir || node_path_1.default.join(context.paths.runDir, "audit"), "summary.json"),
            indexPath: node_path_1.default.join(context.paths.auditDir || node_path_1.default.join(context.paths.runDir, "audit"), "index.json")
        }
        : cloned.audit;
    return cloned;
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
    if (value === context.oldRunDir || value.startsWith(context.oldRunDir + node_path_1.default.sep)) {
        return context.newRunDir + value.slice(context.oldRunDir.length);
    }
    if (value === context.oldCwd || value.startsWith(context.oldCwd + node_path_1.default.sep)) {
        return context.newCwd + value.slice(context.oldCwd.length);
    }
    return value;
}
function cleanArchiveRelativePath(value) {
    const cleaned = toArchivePath(value).replace(/^\/+/, "");
    if (!cleaned || cleaned === "." || cleaned.startsWith("../") || cleaned.includes("/../")) {
        throw new Error(`Invalid archive relative path: ${value}`);
    }
    return cleaned;
}
function toArchivePath(value) {
    return value.split(node_path_1.default.sep).join("/");
}
function safeArchiveBasename(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, "_") || "artifact";
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
function sha256Bytes(bytes) {
    return node_crypto_1.default.createHash("sha256").update(bytes).digest("hex");
}
