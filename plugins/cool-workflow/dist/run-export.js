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
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const state_1 = require("./state");
const version_1 = require("./version");
const telemetry_ledger_1 = require("./telemetry-ledger");
const trust_audit_1 = require("./trust-audit");
const compare_1 = require("./compare");
/** Export a run to a portable JSON archive with run-local bytes and digests. */
function exportRun(run, outputPath) {
    const exportedAt = new Date().toISOString();
    const files = collectArchiveFiles(run);
    const manifestSha256 = digestManifest(files);
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
    const oldRunDir = raw.run.paths.runDir;
    const oldCwd = raw.run.cwd;
    const runDir = node_path_1.default.join(targetDir, ".cw", "runs", raw.run.id);
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
