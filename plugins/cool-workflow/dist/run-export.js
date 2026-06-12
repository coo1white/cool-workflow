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
exports.importManifestPath = importManifestPath;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const state_1 = require("./state");
const version_1 = require("./version");
const telemetry_ledger_1 = require("./telemetry-ledger");
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
    return {
        runId: run.id,
        ok: checks.every((check) => check.pass),
        manifestPath,
        checkedFiles: manifest.files.length,
        checks
    };
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
    return [...entries.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
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
function verifyArchiveFileDigests(files, integrity) {
    for (const file of files) {
        const bytes = Buffer.from(file.contentBase64, "base64");
        const actual = sha256Bytes(bytes);
        if (actual !== file.sha256)
            throw new Error(`Archive digest mismatch for ${file.relativePath}: expected ${file.sha256}, got ${actual}`);
        if (bytes.length !== file.sizeBytes)
            throw new Error(`Archive size mismatch for ${file.relativePath}: expected ${file.sizeBytes}, got ${bytes.length}`);
    }
    if (integrity) {
        const actualManifest = digestManifest(files);
        if (integrity.fileCount !== files.length)
            throw new Error(`Archive file count mismatch: expected ${integrity.fileCount}, got ${files.length}`);
        if (integrity.manifestSha256 !== actualManifest) {
            throw new Error(`Archive manifest digest mismatch: expected ${integrity.manifestSha256}, got ${actualManifest}`);
        }
    }
}
function digestManifest(files) {
    const manifest = files
        .map((file) => ({
        relativePath: file.relativePath,
        role: file.role,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        sourcePath: file.sourcePath
    }))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
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
