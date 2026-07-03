// shell/run-export.ts — portable run archive format: exportRun,
// importRun, inspectArchive, verifyImportedRun, verifyReportBundle.
//
// MILESTONE 8. Byte-exact port of the old build's src/run-export.ts.
// Impure (fs, tmpdir, os) by nature — the archive/bundle mechanism.
//
// Evidence: SPEC/ledger-trust.md "`cw report verify-bundle` JSON", "Files
// on disk" (bundle shape), invariants 16-17, rebuild risk 8;
// plugins/cool-workflow/src/run-export.ts:1-925 (byte-exact source).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sha256, sha256Bytes } from "../core/hash";
import { CURRENT_COOL_WORKFLOW_VERSION } from "../core/version";
import { WorkflowRun } from "../core/state/types";
import { assertSafeRunId, isContainedPath, readJson, writeJson } from "./fs-atomic";
import { createRunPaths, ensureRunDirs } from "../core/state/run-paths";
import { saveCheckpoint } from "./run-store";
import { verifyTelemetryLedger } from "./telemetry-ledger-io";
import { resolveTrustPublicKey, verifyTelemetrySignatures } from "../core/trust/telemetry-attestation";
import { verifyTrustAudit } from "./trust-audit";

export type ArchiveFileRole = "artifact" | "audit" | "telemetry" | "run-file";
export type TrustKeySource = "bundle" | "argument" | "environment" | "none";

interface ArchiveFileEntry {
  relativePath: string;
  role: ArchiveFileRole;
  contentBase64: string;
  sha256: string;
  sizeBytes: number;
  sourcePath?: string;
}

export interface RunExport {
  schemaVersion: 1;
  exportedAt: string;
  sourceVersion: string;
  run: WorkflowRun;
  files: ArchiveFileEntry[];
  integrity?: { fileCount: number; manifestSha256: string };
  trust?: { publicKeyPem: string; algorithm: "ed25519" };
  artifacts?: Array<{ path: string; contentBase64: string; sha256: string; sizeBytes: number }>;
  audit?: string[];
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
  trustKeyEmbedded: boolean;
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

export interface ArchiveInspectResult {
  schemaVersion: number;
  archivePath: string;
  ok: boolean;
  schemaSupported: boolean;
  runId: string | null;
  fileCount: number;
  manifestSha256: string | null;
  archiveSha256: string | null;
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

export interface ExportRunOptions {
  /** An ed25519 PUBLIC key (inline PEM or a path to a .pem file) to embed
   *  in the archive so a recipient can re-verify signed telemetry
   *  OFFLINE without being handed the key separately. */
  trustPublicKey?: string;
}

/** Export a run to a portable JSON archive with run-local bytes and
 *  digests. */
export function exportRun(run: WorkflowRun, outputPath: string, options: ExportRunOptions = {}): ExportResult {
  const exportedAt = new Date().toISOString();
  const files = collectArchiveFiles(run);
  const manifestSha256 = digestManifest(files);
  const trustPublicKeyPem = resolveTrustPublicKey(options.trustPublicKey);
  const exported: RunExport = {
    schemaVersion: 1,
    exportedAt,
    sourceVersion: CURRENT_COOL_WORKFLOW_VERSION,
    run,
    files,
    integrity: { fileCount: files.length, manifestSha256 },
    ...(trustPublicKeyPem ? { trust: { publicKeyPem: trustPublicKeyPem, algorithm: "ed25519" as const } } : {}),
    artifacts: files
      .filter((file) => file.role === "artifact")
      .map((file) => ({ path: file.relativePath, contentBase64: file.contentBase64, sha256: file.sha256, sizeBytes: file.sizeBytes })),
    audit: files.filter((file) => file.role === "audit").map((file) => file.relativePath),
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
    trustKeyEmbedded: Boolean(trustPublicKeyPem),
    manifestSha256,
    archiveSha256,
  };
}

/** Import a run from a portable JSON file into a target directory. */
export function importRun(exportPath: string, targetDir: string): ImportResult {
  const raw = readJson(exportPath) as RunExport;
  if (raw.schemaVersion !== 1) throw new Error(`Unsupported export schema version: ${raw.schemaVersion}`);
  const archiveSha256 = sha256Bytes(fs.readFileSync(exportPath));
  const files = normalizeArchiveFiles(raw);
  verifyArchiveFileDigests(files, raw.integrity);
  if (!raw.run || typeof raw.run !== "object") {
    throw new Error("Invalid run export: missing run object");
  }
  const runId = assertSafeRunId(raw.run.id);
  const runsRoot = path.join(targetDir, ".cw", "runs");
  const runDir = path.join(runsRoot, runId);
  if (!isContainedPath(runDir, runsRoot)) {
    throw new Error(`Run id escapes the runs directory: ${JSON.stringify(raw.run.id)}`);
  }
  const oldRunDir = raw.run.paths.runDir;
  const oldCwd = raw.run.cwd;
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);

  for (const file of files) {
    const destination = path.join(runDir, file.relativePath);
    if (!isContainedPath(destination, runDir)) {
      throw new Error(`Archive file escapes restore directory: ${file.relativePath}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, decodeBase64Strict(file.contentBase64, file.relativePath));
  }

  const externalPathMap = new Map<string, string>();
  for (const file of files) {
    if (file.sourcePath) externalPathMap.set(file.sourcePath, path.join(runDir, file.relativePath));
  }

  const run = rebaseRun(raw.run, { oldRunDir, newRunDir: runDir, oldCwd, newCwd: targetDir, paths, externalPathMap });
  saveCheckpoint(run);
  const manifest: ImportManifest = {
    schemaVersion: 1,
    runId: run.id,
    importedAt: new Date().toISOString(),
    sourceVersion: raw.sourceVersion,
    archiveSha256,
    manifestSha256: digestManifest(files),
    files: files.map(({ contentBase64: _contentBase64, ...file }) => file),
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
    verification,
  };
}

/** Verify an imported run against its restore manifest and telemetry
 *  chain. */
export function verifyImportedRun(run: WorkflowRun): RestoreVerificationResult {
  const manifestPath = importManifestPath(run);
  const checks: RestoreVerificationCheck[] = [];
  if (!fs.existsSync(manifestPath)) {
    return {
      runId: run.id,
      ok: false,
      manifestPath,
      checkedFiles: 0,
      checks: [{ name: "import-manifest", pass: false, code: "missing-import-manifest", path: manifestPath }],
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
    checks.push({ name: "archive-file", pass, code: pass ? undefined : "digest-mismatch", path: file.relativePath, expected: file.sha256, actual });
  }
  checks.push({ name: "archive-files", pass: filesOk, code: filesOk ? undefined : "archive-files-invalid" });

  const telemetry = verifyTelemetryLedger(run);
  checks.push({ name: "telemetry-ledger", pass: telemetry.verified, code: telemetry.verified ? undefined : "telemetry-ledger-invalid" });

  const audit = verifyTrustAudit(run);
  checks.push({ name: "trust-audit", pass: audit.verified, code: audit.verified ? undefined : "trust-audit-invalid" });

  return { runId: run.id, ok: checks.every((check) => check.pass), manifestPath, checkedFiles: manifest.files.length, checks };
}

/** Read-only integrity inspection of a portable archive WITHOUT
 *  importing it. Never throws. */
export function inspectArchive(archivePath: string): ArchiveInspectResult {
  const base: ArchiveInspectResult = {
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
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(archivePath);
  } catch (error) {
    return { ...base, checks: [{ name: "archive", pass: false, code: "archive-unreadable", path: archivePath, actual: messageOf(error) }] };
  }
  base.archiveSha256 = sha256Bytes(bytes);
  let raw: RunExport;
  try {
    raw = JSON.parse(bytes.toString("utf8")) as RunExport;
  } catch (error) {
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
    const { checks } = collectArchiveDigestChecks(files, raw.integrity);
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
  } catch (error) {
    return { ...base, schemaSupported: true, checks: [{ name: "archive", pass: false, code: "archive-malformed", path: archivePath, actual: messageOf(error) }] };
  }
}

export function importManifestPath(run: WorkflowRun): string {
  return path.join(run.paths.runDir, "import-manifest.json");
}

export interface VerifyReportBundleOptions {
  cwd?: string;
  pubkey?: string;
  extractReportTo?: string;
  strictSignatures?: boolean;
  requireSignatures?: boolean;
}

export interface ReportBundleVerification {
  schemaVersion: 1;
  archivePath: string;
  runId: string | null;
  ok: boolean;
  archiveOk: boolean;
  telemetryVerified: boolean;
  trustAuditVerified: boolean;
  trustKeySource: TrustKeySource;
  signatureKeyProvided: boolean;
  signaturesChecked: number;
  signaturesReverified: number;
  signaturesFailed: number;
  trustLevel: "signed" | "unsigned";
  reportFindingsVerified: boolean;
  reportExtractedTo?: string;
  failedChecks: Array<{ name: string; code?: string }>;
}

/** True when report.md embeds `expected` (the trimmed result) at the
 *  task's OWN section: a `### <taskId>` heading, a `Result: <path>`
 *  line, then the result body — and the body STARTS WITH `expected`. */
function reportSectionEmbedsResult(reportMd: string, taskId: string, expected: string): boolean {
  const needle = `### ${taskId}\n`;
  for (let from = reportMd.indexOf(needle); from >= 0; from = reportMd.indexOf(needle, from + 1)) {
    const after = reportMd.slice(from);
    const prefix = after.match(/^### [^\n]*\n\nResult: [^\n]*\n\n/);
    if (prefix && after.slice(prefix[0].length).startsWith(expected)) return true;
  }
  return false;
}

/** Verify a portable run bundle OFFLINE and SELF-CONTAINED: prove the
 *  archive bytes, the telemetry hash chain, the trust-audit chain, and
 *  (with the bundle's embedded public key) the ed25519 signatures.
 *  Never throws — every failure is a structured check and a false `ok`.
 *
 *  Key precedence is bundle > argument > environment. */
export function verifyReportBundle(archivePath: string, options: VerifyReportBundleOptions = {}): ReportBundleVerification {
  const inspect = inspectArchive(archivePath);
  const failedChecks: Array<{ name: string; code?: string }> = inspect.checks.filter((check) => !check.pass).map((check) => ({ name: check.name, code: check.code }));

  const base: ReportBundleVerification = {
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

  if (!inspect.schemaSupported) return base;

  let bundleKey: string | undefined;
  let reportContent: string | undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(archivePath, "utf8")) as RunExport;
    bundleKey = raw.trust?.publicKeyPem;
    if (options.extractReportTo) {
      const reportFile = (raw.files || []).find((file) => file.relativePath === "report.md");
      if (reportFile) {
        const decoded = decodeBase64StrictResult(reportFile.contentBase64, reportFile.relativePath);
        if (decoded.ok) reportContent = decoded.bytes.toString("utf8");
      }
    }
  } catch {
    /* inspect already recorded the parse failure; treat key as absent */
  }

  const trustKeySource: TrustKeySource = bundleKey ? "bundle" : options.pubkey ? "argument" : process.env.CW_AGENT_ATTEST_PUBKEY ? "environment" : "none";
  const trustKey = resolveTrustPublicKey(bundleKey || options.pubkey || process.env.CW_AGENT_ATTEST_PUBKEY);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-verify-bundle-"));
  let telemetryVerified = false;
  let trustAuditVerified = false;
  let signaturesChecked = 0;
  let signaturesReverified = 0;
  let signaturesFailed = 0;
  let signaturesResultBound = 0;
  let reportFindingsOk = true;
  let reportExtractedTo: string | undefined;
  try {
    const imported = importRun(archivePath, tmpDir);
    for (const check of imported.verification.checks) {
      if (check.name === "telemetry-ledger") telemetryVerified = check.pass;
      if (check.name === "trust-audit") trustAuditVerified = check.pass;
      if (!check.pass) failedChecks.push({ name: check.name, code: check.code });
    }
    const ledger = verifyTelemetryLedger(imported.run);
    const sig = verifyTelemetrySignatures(ledger.records, trustKey);
    signaturesChecked = sig.checked;
    signaturesReverified = sig.reverified;
    signaturesFailed = sig.failed;
    signaturesResultBound = sig.resultBound.length;
    for (const check of sig.checks) if (!check.pass) failedChecks.push({ name: check.name, code: check.code });

    // Report ⇄ result ⇄ signature cross-check — driven by sig.resultBound
    // (records whose signature actually COVERED the result), NEVER
    // run.tasks (unbound data an attacker can edit).
    const reportPath = imported.run.paths.report;
    const reportMd = reportPath && fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
    const completedById = new Map(imported.run.tasks.filter((task) => task.status === "completed").map((task) => [task.id, task]));
    for (const bound of sig.resultBound) {
      const failBound = (code: string): void => {
        reportFindingsOk = false;
        failedChecks.push({ name: "report-findings", code: `${code}:${bound.taskId}` });
      };
      const task = completedById.get(bound.taskId);
      if (!task || !task.resultPath || !fs.existsSync(task.resultPath)) {
        failBound("result-missing");
        continue;
      }
      const resultRaw = fs.readFileSync(task.resultPath, "utf8");
      if (sha256(resultRaw) !== bound.resultDigest) {
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
        if (!isContainedPath(reportExtractedTo, baseCwd)) {
          failedChecks.push({ name: "extract-report", code: "path-outside-working-directory" });
          reportExtractedTo = undefined;
        }
      }
      if (reportExtractedTo) fs.writeFileSync(reportExtractedTo, reportContent);
    }
  } catch (error) {
    failedChecks.push({ name: "restore", code: messageOf(error) });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const strictShortfall = Boolean(options.strictSignatures) && signaturesChecked > 0 && !trustKey;
  if (strictShortfall) failedChecks.push({ name: "signatures", code: "signature-key-required" });

  const trustLevel: "signed" | "unsigned" = signaturesResultBound > 0 && signaturesFailed === 0 && reportFindingsOk ? "signed" : "unsigned";
  const unsignedShortfall = Boolean(options.requireSignatures) && trustLevel === "unsigned";
  if (unsignedShortfall) failedChecks.push({ name: "signatures", code: "signatures-required" });

  const extractShortfall = Boolean(options.extractReportTo) && !reportExtractedTo;
  if (extractShortfall) failedChecks.push({ name: "extract-report", code: "report-md-unavailable" });

  return {
    schemaVersion: 1,
    archivePath,
    runId: inspect.runId,
    ok: inspect.ok && telemetryVerified && trustAuditVerified && signaturesFailed === 0 && reportFindingsOk && !strictShortfall && !extractShortfall && !unsignedShortfall,
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

function collectArchiveFiles(run: WorkflowRun): ArchiveFileEntry[] {
  const entries = new Map<string, ArchiveFileEntry>();
  for (const file of walkFiles(run.paths.runDir)) {
    const relativePath = toArchivePath(path.relative(run.paths.runDir, file));
    if (!relativePath || relativePath === "state.json" || relativePath === "import-manifest.json" || relativePath.endsWith(".lock")) continue;
    addFile(entries, file, roleForRelativePath(relativePath), run.paths.runDir);
  }
  for (const artifactPath of collectReferencedArtifactPaths(run)) {
    if (!artifactPath || !fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) continue;
    if (isContainedPath(artifactPath, run.paths.runDir)) {
      addFile(entries, artifactPath, "artifact", run.paths.runDir);
      continue;
    }
    if (isContainedPath(artifactPath, run.cwd)) addExternalArtifactFile(entries, artifactPath);
  }
  return [...entries.values()].sort((left, right) => (left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0));
}

function addFile(entries: Map<string, ArchiveFileEntry>, file: string, role: ArchiveFileRole, runDir: string): void {
  const relativePath = toArchivePath(path.relative(runDir, file));
  if (relativePath === "state.json" || relativePath === "import-manifest.json") return;
  if (!relativePath || relativePath.startsWith("../")) return;
  const bytes = fs.readFileSync(file);
  entries.set(relativePath, { relativePath, role, contentBase64: bytes.toString("base64"), sha256: sha256Bytes(bytes), sizeBytes: bytes.length });
}

function addExternalArtifactFile(entries: Map<string, ArchiveFileEntry>, file: string): void {
  const sourcePath = path.resolve(file);
  const bytes = fs.readFileSync(sourcePath);
  const relativePath = `external-artifacts/${sha256Bytes(Buffer.from(sourcePath, "utf8")).slice(0, 16)}-${safeArchiveBasename(path.basename(sourcePath))}`;
  entries.set(relativePath, { relativePath, role: "artifact", contentBase64: bytes.toString("base64"), sha256: sha256Bytes(bytes), sizeBytes: bytes.length, sourcePath });
}

function collectReferencedArtifactPaths(run: WorkflowRun): string[] {
  const paths = new Set<string>();
  for (const node of run.nodes || []) {
    for (const artifact of node.artifacts || []) addArtifactPath(paths, run, artifact.path);
  }
  const candidates = (run.candidates || []) as Array<{ artifacts?: Array<{ path?: string }> }>;
  for (const candidate of candidates) {
    for (const artifact of candidate.artifacts || []) addArtifactPath(paths, run, artifact.path);
  }
  const selections = (run.candidateSelections || []) as Array<{ artifacts?: Array<{ path?: string }> }>;
  for (const selection of selections) {
    for (const artifact of selection.artifacts || []) addArtifactPath(paths, run, artifact.path);
  }
  const bbArtifacts = (run.blackboard?.artifacts || []) as Array<{ path?: string }>;
  for (const artifact of bbArtifacts) addArtifactPath(paths, run, artifact.path);
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
      sourcePath: file.sourcePath,
    }));
  }
  return (raw.artifacts || []).map((artifact) => {
    const contentBase64 = artifact.contentBase64 || Buffer.from("", "utf8").toString("base64");
    const bytes = Buffer.from(contentBase64, "base64");
    return {
      relativePath: cleanArchiveRelativePath(artifact.path),
      role: "artifact" as ArchiveFileRole,
      contentBase64,
      sha256: artifact.sha256 || sha256Bytes(bytes),
      sizeBytes: artifact.sizeBytes ?? bytes.length,
    };
  });
}

function decodeBase64StrictResult(value: unknown, relativePath: string): { ok: true; bytes: Buffer } | { ok: false; check: RestoreVerificationCheck } {
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

function decodeBase64Strict(value: unknown, relativePath: string): Buffer {
  const decoded = decodeBase64StrictResult(value, relativePath);
  if (!decoded.ok) throw new Error(archiveCheckMessage(decoded.check));
  return decoded.bytes;
}

function collectArchiveDigestChecks(files: ArchiveFileEntry[], integrity?: RunExport["integrity"]): { checks: RestoreVerificationCheck[]; ok: boolean } {
  const checks: RestoreVerificationCheck[] = [];
  for (const file of files) {
    const decoded = decodeBase64StrictResult(file.contentBase64, file.relativePath);
    if (!decoded.ok) {
      checks.push(decoded.check);
      continue;
    }
    const bytes = decoded.bytes;
    const actual = sha256Bytes(bytes);
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

function archiveCheckMessage(check: RestoreVerificationCheck): string {
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

function verifyArchiveFileDigests(files: ArchiveFileEntry[], integrity?: RunExport["integrity"]): void {
  if (!integrity && /^(1|true|yes|on)$/i.test(process.env.CW_REQUIRE_ARCHIVE_INTEGRITY || "")) {
    throw new Error("Archive integrity block required but absent (CW_REQUIRE_ARCHIVE_INTEGRITY=1)");
  }
  const failed = collectArchiveDigestChecks(files, integrity).checks.find((c) => !c.pass);
  if (failed) throw new Error(archiveCheckMessage(failed));
}

function digestManifest(files: Array<Omit<ArchiveFileEntry, "contentBase64"> | ArchiveFileEntry>): string {
  const manifest = files
    .map((file) => ({ relativePath: file.relativePath, role: file.role, sha256: file.sha256, sizeBytes: file.sizeBytes }))
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
        indexPath: path.join(context.paths.auditDir || path.join(context.paths.runDir, "audit"), "index.json"),
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
