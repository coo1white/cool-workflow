// Run Export / Import — portable run archive format (Track B).
//
// BSD discipline: explicit state, portable format. Export serializes a run plus
// its run-local files (artifacts, audit overlays, telemetry ledger, reports,
// worker files, commit snapshots) to a single JSON archive. Import restores those
// bytes into a new .cw/runs/<id>/ tree, rebases paths, writes a restore manifest,
// and exposes a deterministic verification pass. No hidden database, no trust in
// paths from the archive without containment checks.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { RunExport, WorkflowRun } from "./types";
import { createRunPaths, ensureRunDirs, isContainedPath, readJson, saveCheckpoint, writeJson } from "./state";
import { CURRENT_COOL_WORKFLOW_VERSION } from "./version";
import { verifyTelemetryLedger } from "./telemetry-ledger";

type ArchiveFileRole = NonNullable<RunExport["files"]>[number]["role"];

interface ArchiveFileEntry {
  relativePath: string;
  role: ArchiveFileRole;
  contentBase64: string;
  sha256: string;
  sizeBytes: number;
  sourcePath?: string;
}

export interface ExportResult {
  runId: string;
  exportedAt: string;
  path: string;
  taskCount: number;
  commitCount: number;
  fileCount: number;
  artifactCount: number;
  auditFileCount: number;
  telemetryIncluded: boolean;
  manifestSha256: string;
  archiveSha256: string;
}

export interface ImportResult {
  run: WorkflowRun;
  runDir: string;
  statePath: string;
  manifestPath: string;
  verifyCommand: string;
  verification: RestoreVerificationResult;
}

export interface RestoreVerificationCheck {
  name: string;
  pass: boolean;
  code?: string;
  path?: string;
  expected?: string;
  actual?: string;
}

export interface RestoreVerificationResult {
  runId: string;
  ok: boolean;
  manifestPath: string;
  checkedFiles: number;
  checks: RestoreVerificationCheck[];
}

interface ImportManifest {
  schemaVersion: 1;
  runId: string;
  importedAt: string;
  sourceVersion: string;
  archiveSha256: string;
  manifestSha256: string;
  files: Array<Omit<ArchiveFileEntry, "contentBase64">>;
}

/** Export a run to a portable JSON archive with run-local bytes and digests. */
export function exportRun(run: WorkflowRun, outputPath: string): ExportResult {
  const exportedAt = new Date().toISOString();
  const files = collectArchiveFiles(run);
  const manifestSha256 = digestManifest(files);
  const exported: RunExport = {
    schemaVersion: 1,
    exportedAt,
    sourceVersion: CURRENT_COOL_WORKFLOW_VERSION,
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
  writeJson(outputPath, exported);
  const archiveSha256 = sha256Bytes(fs.readFileSync(outputPath));
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
export function importRun(exportPath: string, targetDir: string): ImportResult {
  const raw = readJson(exportPath) as RunExport;
  if (raw.schemaVersion !== 1) throw new Error(`Unsupported export schema version: ${raw.schemaVersion}`);
  const archiveSha256 = sha256Bytes(fs.readFileSync(exportPath));
  const files = normalizeArchiveFiles(raw);
  verifyArchiveFileDigests(files, raw.integrity);
  const oldRunDir = raw.run.paths.runDir;
  const oldCwd = raw.run.cwd;
  const runDir = path.join(targetDir, ".cw", "runs", raw.run.id);
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);

  for (const file of files) {
    const destination = path.join(runDir, file.relativePath);
    if (!isContainedPath(destination, runDir)) {
      throw new Error(`Archive file escapes restore directory: ${file.relativePath}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, Buffer.from(file.contentBase64, "base64"));
  }

  const externalPathMap = new Map<string, string>();
  for (const file of files) {
    if (file.sourcePath) externalPathMap.set(file.sourcePath, path.join(runDir, file.relativePath));
  }

  const run = rebaseRun(raw.run, {
    oldRunDir,
    newRunDir: runDir,
    oldCwd,
    newCwd: targetDir,
    paths,
    externalPathMap
  });
  saveCheckpoint(run);
  const manifest: ImportManifest = {
    schemaVersion: 1,
    runId: run.id,
    importedAt: new Date().toISOString(),
    sourceVersion: raw.sourceVersion,
    archiveSha256,
    manifestSha256: digestManifest(files),
    files: files.map(({ contentBase64: _contentBase64, ...file }) => file)
  };
  const manifestPath = importManifestPath(run);
  writeJson(manifestPath, manifest, { durable: true });
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
export function verifyImportedRun(run: WorkflowRun): RestoreVerificationResult {
  const manifestPath = importManifestPath(run);
  const checks: RestoreVerificationCheck[] = [];
  if (!fs.existsSync(manifestPath)) {
    return {
      runId: run.id,
      ok: false,
      manifestPath,
      checkedFiles: 0,
      checks: [{ name: "import-manifest", pass: false, code: "missing-import-manifest", path: manifestPath }]
    };
  }
  let manifest: ImportManifest;
  try {
    manifest = readJson(manifestPath) as ImportManifest;
  } catch (error) {
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
    const restoredPath = path.join(run.paths.runDir, file.relativePath);
    if (!isContainedPath(restoredPath, run.paths.runDir)) {
      filesOk = false;
      checks.push({ name: "archive-file", pass: false, code: "path-escape", path: file.relativePath });
      continue;
    }
    if (!fs.existsSync(restoredPath)) {
      filesOk = false;
      checks.push({ name: "archive-file", pass: false, code: "missing-file", path: file.relativePath, expected: file.sha256 });
      continue;
    }
    const actual = sha256Bytes(fs.readFileSync(restoredPath));
    const pass = actual === file.sha256;
    if (!pass) filesOk = false;
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

  const telemetry = verifyTelemetryLedger(run);
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

export function importManifestPath(run: WorkflowRun): string {
  return path.join(run.paths.runDir, "import-manifest.json");
}

function collectArchiveFiles(run: WorkflowRun): ArchiveFileEntry[] {
  const entries = new Map<string, ArchiveFileEntry>();
  for (const file of walkFiles(run.paths.runDir)) {
    const relativePath = toArchivePath(path.relative(run.paths.runDir, file));
    if (!relativePath || relativePath === "state.json" || relativePath === "import-manifest.json" || relativePath.endsWith(".lock")) continue;
    addFile(entries, run, file, roleForRelativePath(relativePath));
  }
  for (const artifactPath of collectReferencedArtifactPaths(run)) {
    if (!artifactPath || !fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) continue;
    if (isContainedPath(artifactPath, run.paths.runDir)) {
      addFile(entries, run, artifactPath, "artifact");
      continue;
    }
    if (isContainedPath(artifactPath, run.cwd)) addExternalArtifactFile(entries, run, artifactPath);
  }
  return [...entries.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function addFile(entries: Map<string, ArchiveFileEntry>, run: WorkflowRun, file: string, role: ArchiveFileRole): void {
  const relativePath = toArchivePath(path.relative(run.paths.runDir, file));
  if (relativePath === "state.json" || relativePath === "import-manifest.json") return;
  if (!relativePath || relativePath.startsWith("../")) return;
  const bytes = fs.readFileSync(file);
  entries.set(relativePath, {
    relativePath,
    role,
    contentBase64: bytes.toString("base64"),
    sha256: sha256Bytes(bytes),
    sizeBytes: bytes.length
  });
}

function addExternalArtifactFile(entries: Map<string, ArchiveFileEntry>, run: WorkflowRun, file: string): void {
  const sourcePath = path.resolve(file);
  const bytes = fs.readFileSync(sourcePath);
  const relativePath = `external-artifacts/${sha256Bytes(Buffer.from(sourcePath, "utf8")).slice(0, 16)}-${safeArchiveBasename(path.basename(sourcePath))}`;
  entries.set(relativePath, {
    relativePath,
    role: "artifact",
    contentBase64: bytes.toString("base64"),
    sha256: sha256Bytes(bytes),
    sizeBytes: bytes.length,
    sourcePath
  });
}

function collectReferencedArtifactPaths(run: WorkflowRun): string[] {
  const paths = new Set<string>();
  for (const node of run.nodes || []) {
    for (const artifact of node.artifacts || []) addArtifactPath(paths, run, artifact.path);
  }
  for (const candidate of run.candidates || []) {
    for (const artifact of candidate.artifacts || []) addArtifactPath(paths, run, artifact.path);
  }
  for (const selection of run.candidateSelections || []) {
    for (const artifact of selection.artifacts || []) addArtifactPath(paths, run, artifact.path);
  }
  for (const artifact of run.blackboard?.artifacts || []) addArtifactPath(paths, run, artifact.path);
  return [...paths].sort();
}

function addArtifactPath(paths: Set<string>, run: WorkflowRun, value?: string): void {
  if (!value) return;
  paths.add(path.isAbsolute(value) ? value : path.resolve(run.cwd, value));
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  for (const name of fs.readdirSync(root)) {
    const file = path.join(root, name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) found.push(...walkFiles(file));
    else if (stat.isFile()) found.push(file);
  }
  return found;
}

function roleForRelativePath(relativePath: string): ArchiveFileRole {
  if (relativePath === "telemetry.json") return "telemetry";
  if (relativePath === "audit" || relativePath.startsWith("audit/")) return "audit";
  if (relativePath === "artifacts" || relativePath.startsWith("artifacts/")) return "artifact";
  return "run-file";
}

function normalizeArchiveFiles(raw: RunExport): ArchiveFileEntry[] {
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

function verifyArchiveFileDigests(files: ArchiveFileEntry[], integrity?: RunExport["integrity"]): void {
  for (const file of files) {
    const bytes = Buffer.from(file.contentBase64, "base64");
    const actual = sha256Bytes(bytes);
    if (actual !== file.sha256) throw new Error(`Archive digest mismatch for ${file.relativePath}: expected ${file.sha256}, got ${actual}`);
    if (bytes.length !== file.sizeBytes) throw new Error(`Archive size mismatch for ${file.relativePath}: expected ${file.sizeBytes}, got ${bytes.length}`);
  }
  if (integrity) {
    const actualManifest = digestManifest(files);
    if (integrity.fileCount !== files.length) throw new Error(`Archive file count mismatch: expected ${integrity.fileCount}, got ${files.length}`);
    if (integrity.manifestSha256 !== actualManifest) {
      throw new Error(`Archive manifest digest mismatch: expected ${integrity.manifestSha256}, got ${actualManifest}`);
    }
  }
}

function digestManifest(files: Array<Omit<ArchiveFileEntry, "contentBase64"> | ArchiveFileEntry>): string {
  const manifest = files
    .map((file) => ({
      relativePath: file.relativePath,
      role: file.role,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      sourcePath: file.sourcePath
    }))
    // Codepoint order, NOT localeCompare: this manifest feeds a sha256 integrity
    // digest. Locale-sensitive collation would order identical bytes differently
    // across hosts/locales, making the digest non-reproducible cross-host.
    .sort((left, right) => (left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0));
  return sha256Bytes(Buffer.from(JSON.stringify(manifest), "utf8"));
}

function rebaseRun(
  source: WorkflowRun,
  context: { oldRunDir: string; newRunDir: string; oldCwd: string; newCwd: string; paths: WorkflowRun["paths"]; externalPathMap?: Map<string, string> }
): WorkflowRun {
  const cloned = deepRebase(JSON.parse(JSON.stringify(source)), context) as WorkflowRun;
  cloned.cwd = context.newCwd;
  cloned.paths = context.paths;
  cloned.updatedAt = new Date().toISOString();
  cloned.audit = cloned.audit
    ? {
        schemaVersion: 1,
        eventLogPath: path.join(context.paths.auditDir || path.join(context.paths.runDir, "audit"), "events.jsonl"),
        summaryPath: path.join(context.paths.auditDir || path.join(context.paths.runDir, "audit"), "summary.json"),
        indexPath: path.join(context.paths.auditDir || path.join(context.paths.runDir, "audit"), "index.json")
      }
    : cloned.audit;
  return cloned;
}

function deepRebase(value: unknown, context: { oldRunDir: string; newRunDir: string; oldCwd: string; newCwd: string; externalPathMap?: Map<string, string> }): unknown {
  if (typeof value === "string") return rebaseString(value, context);
  if (Array.isArray(value)) return value.map((entry) => deepRebase(entry, context));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = deepRebase(entry, context);
    return out;
  }
  return value;
}

function rebaseString(value: string, context: { oldRunDir: string; newRunDir: string; oldCwd: string; newCwd: string; externalPathMap?: Map<string, string> }): string {
  const archivedExternal = context.externalPathMap?.get(value);
  if (archivedExternal) return archivedExternal;
  if (value === context.oldRunDir || value.startsWith(context.oldRunDir + path.sep)) {
    return context.newRunDir + value.slice(context.oldRunDir.length);
  }
  if (value === context.oldCwd || value.startsWith(context.oldCwd + path.sep)) {
    return context.newCwd + value.slice(context.oldCwd.length);
  }
  return value;
}

function cleanArchiveRelativePath(value: string): string {
  const cleaned = toArchivePath(value).replace(/^\/+/, "");
  if (!cleaned || cleaned === "." || cleaned.startsWith("../") || cleaned.includes("/../")) {
    throw new Error(`Invalid archive relative path: ${value}`);
  }
  return cleaned;
}

function toArchivePath(value: string): string {
  return value.split(path.sep).join("/");
}

function safeArchiveBasename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_") || "artifact";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256Bytes(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
