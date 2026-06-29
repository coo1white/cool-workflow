// Run Export / Import — portable run archive format (Track B).
//
// BSD discipline: explicit state, portable format. Export serializes a run plus
// its run-local files (artifacts, audit overlays, telemetry ledger, reports,
// worker files, commit snapshots) to a single JSON archive. Import restores those
// bytes into a new .cw/runs/<id>/ tree, rebases paths, writes a restore manifest,
// and exposes a deterministic verification pass. No hidden database, no trust in
// paths from the archive without containment checks.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ReportBundleVerification, RunExport, TrustKeySource, WorkflowRun } from "./types";
import { assertSafeRunId, createRunPaths, ensureRunDirs, isContainedPath, readJson, saveCheckpoint, writeJson } from "./state";
import { CURRENT_COOL_WORKFLOW_VERSION } from "./version";
import { verifyTelemetryLedger } from "./telemetry-ledger";
import { resolveTrustPublicKey, verifyTelemetrySignatures } from "./telemetry-attestation";
import { verifyTrustAudit } from "./trust-audit";
import { sha256 } from "./execution-backend";
import { compareBytes } from "./compare";

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

/** Read-only inspection of a portable archive WITHOUT restoring it: re-proves every
 *  embedded file digest/size, the integrity file-count + manifest digest, and the
 *  whole-archive sha256. Never throws — every failure is a structured check. */
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
  /** An ed25519 PUBLIC key (inline PEM or a path to a .pem file) to embed in the
   *  archive so a recipient can re-verify signed telemetry OFFLINE without being
   *  handed the key separately. Resolved with the same loader the verify gate uses
   *  (resolveTrustPublicKey). Absent ⇒ no trust block (backward compatible). */
  trustPublicKey?: string;
}

/** Export a run to a portable JSON archive with run-local bytes and digests. */
export function exportRun(run: WorkflowRun, outputPath: string, options: ExportRunOptions = {}): ExportResult {
  const exportedAt = new Date().toISOString();
  const files = collectArchiveFiles(run);
  const manifestSha256 = digestManifest(files);
  // Embed ONLY a public key. resolveTrustPublicKey normalizes an inline PEM or a
  // file path down to inline PEM bytes so the archive is self-contained; a value
  // that resolves to nothing (bad path) yields no trust block rather than a throw.
  const trustPublicKeyPem = resolveTrustPublicKey(options.trustPublicKey);
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
    ...(trustPublicKeyPem ? { trust: { publicKeyPem: trustPublicKeyPem, algorithm: "ed25519" as const } } : {}),
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
    trustKeyEmbedded: Boolean(trustPublicKeyPem),
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
  if (!raw.run || typeof raw.run !== "object") {
    throw new Error("Invalid run export: missing run object");
  }
  // The run id from the archive becomes a directory name under the target's
  // runs root; a crafted id like "../../etc" would otherwise escape it. Refuse
  // any id that is not a single safe path segment, then assert containment as
  // defense-in-depth (catches a symlinked runs root too) before any write.
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

  // Re-prove the trust-audit hash chain on restore too. Telemetry was already
  // re-proven above, but the decisions/sandbox/commit-gate audit chain — also
  // exported under audit/ — was not, an asymmetry a tampered restore could slip
  // through. An absent chain is verified:true (nothing to prove), so archives
  // predating audit export append a PASSING check — no false-red.
  const audit = verifyTrustAudit(run);
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
    checks: []
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
  } catch (error) {
    return { ...base, schemaSupported: true, checks: [{ name: "archive", pass: false, code: "archive-malformed", path: archivePath, actual: messageOf(error) }] };
  }
}

export function importManifestPath(run: WorkflowRun): string {
  return path.join(run.paths.runDir, "import-manifest.json");
}

export interface VerifyReportBundleOptions {
  /** Base directory for extractReportTo containment. Defaults to process.cwd(). */
  cwd?: string;
  /** Public key override (inline PEM or path). Used only when the bundle carries
   *  no embedded trust block; the bundle's own key always wins so the artifact is
   *  self-describing. */
  pubkey?: string;
  /** Write the bundle's human-readable report.md to this path on a successful read. */
  extractReportTo?: string;
  /** Fail (ok:false) when the bundle claims attested telemetry but no key is
   *  available to re-verify it — for callers who refuse to trust an unverifiable
   *  attestation. Default: degrade (report signatureKeyProvided:false, chain still
   *  decides ok). */
  strictSignatures?: boolean;
  /** Fail (ok:false) when the bundle carries NO re-verified signature at all
   *  (trustLevel "unsigned") — for callers who require a signed bundle and refuse
   *  one whose integrity holds but whose agent usage/findings nothing attests.
   *  Default: an unsigned bundle still passes on integrity, with trustLevel
   *  surfaced. Closes the prior fail-open (ok:true with zero signatures). */
  requireSignatures?: boolean;
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
function reportSectionEmbedsResult(reportMd: string, taskId: string, expected: string): boolean {
  const needle = `### ${taskId}\n`;
  // Walk EVERY `### <taskId>` occurrence — not just the first — so a stray heading
  // inside an earlier task's result body (which is not followed by the `Result:`
  // structure) is skipped rather than mis-anchoring the check (a false positive on a
  // legitimate, fully-signed bundle whose findings contain markdown headings).
  for (let from = reportMd.indexOf(needle); from >= 0; from = reportMd.indexOf(needle, from + 1)) {
    const after = reportMd.slice(from);
    const prefix = after.match(/^### [^\n]*\n\nResult: [^\n]*\n\n/);
    if (prefix && after.slice(prefix[0].length).startsWith(expected)) return true;
  }
  return false;
}

export function verifyReportBundle(archivePath: string, options: VerifyReportBundleOptions = {}): ReportBundleVerification {
  const inspect = inspectArchive(archivePath);
  const failedChecks: Array<{ name: string; code?: string }> = inspect.checks
    .filter((check) => !check.pass)
    .map((check) => ({ name: check.name, code: check.code }));

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
    failedChecks
  };

  // A bundle that is not even a supported archive cannot be restored — report the
  // inspection failure and stop (fail-closed, no tmpdir, nothing written).
  if (!inspect.schemaSupported) return base;

  // Read the embedded trust key (and, if requested, the report bytes) straight from
  // the archive JSON. inspectArchive already proved the bytes parse + digest-match.
  let bundleKey: string | undefined;
  let reportContent: string | undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(archivePath, "utf8")) as RunExport;
    bundleKey = raw.trust?.publicKeyPem;
    if (options.extractReportTo) {
      const reportFile = (raw.files || []).find((file) => file.relativePath === "report.md");
      if (reportFile) reportContent = Buffer.from(reportFile.contentBase64, "base64").toString("utf8");
    }
  } catch {
    /* inspect already recorded the parse failure; treat key as absent */
  }

  const trustKeySource: TrustKeySource = bundleKey
    ? "bundle"
    : options.pubkey
      ? "argument"
      : process.env.CW_AGENT_ATTEST_PUBKEY
        ? "environment"
        : "none";
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
    // Restore into the throwaway tree. importRun digest-checks every file and throws
    // on the first mismatch (or on a stripped integrity block under
    // CW_REQUIRE_ARCHIVE_INTEGRITY=1) — caught below as a failed "restore" check.
    const imported = importRun(archivePath, tmpDir);
    for (const check of imported.verification.checks) {
      if (check.name === "telemetry-ledger") telemetryVerified = check.pass;
      if (check.name === "trust-audit") trustAuditVerified = check.pass;
      if (!check.pass) failedChecks.push({ name: check.name, code: check.code });
    }
    // Independent ed25519 re-verification over the restored ledger using the bundle's
    // own key (or override/env). With no key, attested records degrade to
    // informational (signaturesFailed stays 0); the chain check above still gates ok.
    const ledger = verifyTelemetryLedger(imported.run);
    const sig = verifyTelemetrySignatures(ledger.records, trustKey);
    signaturesChecked = sig.checked;
    signaturesReverified = sig.reverified;
    signaturesFailed = sig.failed;
    signaturesResultBound = sig.resultBound.length;
    for (const check of sig.checks) if (!check.pass) failedChecks.push({ name: check.name, code: check.code });
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
      if (reportExtractedTo) {
        fs.writeFileSync(reportExtractedTo, reportContent);
      }
    }
  } catch (error) {
    failedChecks.push({ name: "restore", code: messageOf(error) });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Strict mode: a bundle that claims attested telemetry but offers no key to check
  // it is unverifiable — refuse rather than green it.
  const strictShortfall = Boolean(options.strictSignatures) && signaturesChecked > 0 && !trustKey;
  if (strictShortfall) failedChecks.push({ name: "signatures", code: "signature-key-required" });

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
  const trustLevel: "signed" | "unsigned" =
    signaturesResultBound > 0 && signaturesFailed === 0 && reportFindingsOk ? "signed" : "unsigned";
  const unsignedShortfall = Boolean(options.requireSignatures) && trustLevel === "unsigned";
  if (unsignedShortfall) failedChecks.push({ name: "signatures", code: "signatures-required" });

  // Extraction was requested but could not be fulfilled (no report.md in the bundle,
  // or the write failed): fail closed rather than silently green a missing artifact —
  // otherwise `report bundle <run> --extract-report r.md && send r.md` would ship
  // nothing (or a stale file) with exit 0. A requested-but-absent output is a failure,
  // not a no-op (distinct from extraction never being requested).
  const extractShortfall = Boolean(options.extractReportTo) && !reportExtractedTo;
  if (extractShortfall) failedChecks.push({ name: "extract-report", code: "report-md-unavailable" });

  return {
    schemaVersion: 1,
    archivePath,
    runId: inspect.runId,
    ok:
      inspect.ok &&
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
  return [...entries.values()].sort((left, right) => compareBytes(left.relativePath, right.relativePath));
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

/** NON-throwing digest/size/count/manifest verification: one structured check per
 *  file (in import order), then the integrity file-count + manifest checks. Shared
 *  by the throwing import path (verifyArchiveFileDigests) and the read-only
 *  inspectArchive, so a single offender list has one source of truth. */
function collectArchiveDigestChecks(
  files: ArchiveFileEntry[],
  integrity?: RunExport["integrity"]
): { checks: RestoreVerificationCheck[]; ok: boolean } {
  const checks: RestoreVerificationCheck[] = [];
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
function archiveCheckMessage(check: RestoreVerificationCheck): string {
  switch (check.code) {
    case "digest-mismatch": return `Archive digest mismatch for ${check.path}: expected ${check.expected}, got ${check.actual}`;
    case "size-mismatch": return `Archive size mismatch for ${check.path}: expected ${check.expected}, got ${check.actual}`;
    case "file-count-mismatch": return `Archive file count mismatch: expected ${check.expected}, got ${check.actual}`;
    case "manifest-digest-mismatch": return `Archive manifest digest mismatch: expected ${check.expected}, got ${check.actual}`;
    default: return `Archive verification failed: ${check.name}`;
  }
}

function verifyArchiveFileDigests(files: ArchiveFileEntry[], integrity?: RunExport["integrity"]): void {
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
  if (failed) throw new Error(archiveCheckMessage(failed));
}

function digestManifest(files: Array<Omit<ArchiveFileEntry, "contentBase64"> | ArchiveFileEntry>): string {
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
