// Tamper-evidence demo (the one-command proof) — make CW's central claim VISIBLE:
// an audit record proves its own integrity, and ANYONE can re-verify it offline
// with only the public key. No competitor's pipeline telemetry can do this.
//
// Fully hermetic + deterministic: generates an EPHEMERAL ed25519 keypair, builds
// a REAL telemetry ledger through the production append API (appendTelemetryAttestation
// + signTelemetry — byte-identical to what a live attested run writes), then
// demonstrates BOTH tamper-evidence layers catching a forgery:
//   A) LEDGER layer — flip a recorded verdict on disk (unattested -> attested, the
//      canonical "forge a green record" attack) -> verifyTelemetryLedger recomputes
//      every hash independently, so the edited record's hash mismatches AND every
//      record after it breaks the chain (cascade).
//   B) SIGNATURE layer — inflate the reported tokens but keep the original ed25519
//      signature -> verifyTelemetryAttestation rejects it ("signature does not match").
//
// No model, no network, no API key, no second repo — runs in a private tmpdir.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkflowRun } from "./types";
import { appendTelemetryAttestation, computeRecordHash, reportedUsageDigest, telemetryLedgerPath, verifyTelemetryLedger, TelemetryLedgerCheck } from "./telemetry-ledger";
import { signTelemetry, verifyTelemetryAttestation } from "./telemetry-attestation";
import { exportRun, verifyReportBundle } from "./run-export";
import { createRunPaths, ensureRunDirs, saveCheckpoint } from "./state";
import { sha256 } from "./execution-backend";

export interface TamperDemoLayer {
  layer: "ledger" | "signature";
  /** What was edited, in plain words. */
  tamper: string;
  before: { verified: boolean; detail: string };
  after: { verified: boolean; detail: string };
  /** The specific failing checks (ledger layer) or rejection reason (signature). */
  failures: string[];
}

export interface TamperDemoResult {
  schemaVersion: 1;
  runId: string;
  workers: number;
  trustKey: "ephemeral-ed25519";
  /** The clean baseline both layers start from. */
  baseline: { ledgerVerified: boolean; signaturesValid: number; records: number };
  layers: TamperDemoLayer[];
  /** True iff the clean state verified AND every tamper was detected. */
  proven: boolean;
}

export interface TelemetryVerifyResult {
  schemaVersion: 1;
  runId: string;
  present: boolean;
  verified: boolean;
  records: number;
  attested: number;
  unattested: number;
  absent: number;
  /** Whether a usable trust public key was supplied to re-verify ed25519
   *  signatures (opt-in via --pubkey / CW_AGENT_ATTEST_PUBKEY). When false and no
   *  key-resolution failure is reported, `verify` is the chain-integrity re-proof
   *  only — signatures were checked at record time. */
  signatureKeyProvided: boolean;
  /** Records the ledger marks `attested` that were examined for signature re-check. */
  signaturesChecked: number;
  /** Of those, how many re-verified against the supplied public key. */
  signaturesReverified: number;
  /** Of those, how many FAILED to re-verify (signature mismatch or un-joinable usage). */
  signaturesFailed: number;
  failedChecks: Array<{ name: string; code?: string }>;
}

/** Human-facing render of `telemetry verify <run>`. */
export function formatTelemetryVerify(r: TelemetryVerifyResult): string {
  const keyUnreadable = r.failedChecks.some((c) => c.code === "telemetry-pubkey-unreadable");
  if (!r.present && !keyUnreadable) return `telemetry: run ${r.runId} has no attestation ledger (nothing to verify)`;
  const head = r.verified
    ? `✓ VERIFIED — ${r.records} record(s), chain intact, every hash recomputed independently`
    : keyUnreadable
      ? `✗ VERIFICATION REFUSED — supplied public key was unreadable`
      : `✗ TAMPERING DETECTED — ${r.failedChecks.length} check(s) failed`;
  const tally = `   attested ${r.attested} · unattested ${r.unattested} · absent ${r.absent}`;
  const sig = keyUnreadable
    ? `\n   signatures: public key unreadable; ed25519 re-check refused`
    : r.signatureKeyProvided
    ? `\n   signatures: ${r.signaturesReverified}/${r.signaturesChecked} re-verified against the supplied public key${r.signaturesFailed ? ` · ${r.signaturesFailed} FAILED` : ""}`
    : r.signaturesChecked
      ? `\n   signatures: ${r.signaturesChecked} attested record(s) — chain-proven only; pass --pubkey to re-verify ed25519 offline`
      : "";
  const fails = r.failedChecks.length ? "\n" + r.failedChecks.map((c) => `   ✗ ${c.name}  ${c.code || ""}`).join("\n") : "";
  return `telemetry verify ${r.runId}\n${head}\n${tally}${sig}${fails}`;
}

/** Human-facing render of `demo tamper` — the visible tamper-evidence proof. */
export function formatTamperDemo(r: TamperDemoResult): string {
  const lines: string[] = [];
  lines.push(`cw demo tamper — tamper-evidence proof (hermetic, ${r.trustKey} key)`);
  lines.push("");
  lines.push(`▶ Built an attested telemetry ledger: ${r.workers} hops, ${r.baseline.records} records`);
  lines.push(`  ${r.baseline.ledgerVerified ? "✓" : "✗"} ledger verifies   ${r.baseline.signaturesValid} signed hop(s) verify against the public key`);
  for (const l of r.layers) {
    lines.push("");
    lines.push(`▶ ${l.layer.toUpperCase()} tamper`);
    lines.push(`  edit:   ${l.tamper}`);
    lines.push(`  before: ${l.before.verified ? "✓ verified" : "✗"} — ${l.before.detail}`);
    lines.push(`  after:  ${l.after.verified ? "✓ (UNDETECTED!)" : "✗ DETECTED"} — ${l.after.detail}`);
  }
  lines.push("");
  lines.push(
    r.proven
      ? "VERDICT: tamper-evidence holds ✓ — every forgery was caught offline, with only the public key. No server was trusted."
      : "VERDICT: PROOF FAILED ✗ — a tamper went undetected. This is a regression in the integrity guarantee."
  );
  return lines.join("\n");
}

interface DemoHop {
  workerId: string;
  taskId: string;
  promptDigest: string;
  usage: Record<string, unknown>;
  attestation: "attested" | "unattested";
}

// Three hops with a deliberate mix: two signed/attested, one unattested — so the
// ledger-layer tamper can forge the unattested verdict into "attested" (the exact
// threat the ledger exists to catch).
const HOPS: DemoHop[] = [
  { workerId: "w-map", taskId: "map:server-api", promptDigest: sha256("map:server-api"), usage: { input_tokens: 2117, output_tokens: 1911 }, attestation: "attested" },
  { workerId: "w-assess", taskId: "assess:security", promptDigest: sha256("assess:security"), usage: { input_tokens: 1840, output_tokens: 1502 }, attestation: "unattested" },
  { workerId: "w-verdict", taskId: "verdict:synthesis", promptDigest: sha256("verdict:synthesis"), usage: { input_tokens: 980, output_tokens: 770 }, attestation: "attested" }
];

const DEMO_NOW = "2026-01-01T00:00:00.000Z";

function failingChecks(checks: TelemetryLedgerCheck[]): string[] {
  return checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.code}`);
}

/** Run the full tamper-evidence demonstration in a private tmpdir (cleaned up
 *  unless `keepDir` is set). Pure of clock/network; the only nondeterminism is
 *  the ephemeral keypair, which never leaves this function. */
export function runTamperDemo(options: { dir?: string; keepDir?: boolean } = {}): TamperDemoResult {
  const runDir = options.dir || fs.mkdtempSync(path.join(os.tmpdir(), "cw-tamper-demo-"));
  fs.mkdirSync(runDir, { recursive: true });
  const runId = "demo-tamper-run";
  // Minimal run shape: the ledger API uses only id + paths.runDir.
  const run = { id: runId, paths: { runDir } } as unknown as WorkflowRun;

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  // 1. Build a REAL ledger through the production append API, signing each
  //    attested hop's usage with the ephemeral key.
  const signed: Array<{ hop: DemoHop; signature?: string }> = [];
  for (const hop of HOPS) {
    const ctx = { runId, taskId: hop.taskId, promptDigest: hop.promptDigest };
    const signature = hop.attestation === "attested" ? signTelemetry(hop.usage, privateKeyPem, ctx) : undefined;
    appendTelemetryAttestation(run, {
      workerId: hop.workerId,
      taskId: hop.taskId,
      promptDigest: hop.promptDigest,
      reportedUsage: hop.usage,
      usageSignature: signature,
      attestation: hop.attestation,
      now: DEMO_NOW
    });
    signed.push({ hop, signature });
  }

  // 2. Baseline: the clean ledger verifies, and every signed hop's signature is valid.
  const clean = verifyTelemetryLedger(run);
  const signaturesValid = signed.filter(
    (s) => s.signature && verifyTelemetryAttestation(s.hop.usage, s.signature, publicKeyPem, { runId, taskId: s.hop.taskId, promptDigest: s.hop.promptDigest }).status === "attested"
  ).length;
  const baseline = { ledgerVerified: clean.verified, signaturesValid, records: clean.records.length };

  const layers: TamperDemoLayer[] = [];

  // 3a. LEDGER layer — the SOPHISTICATED forgery: flip record[1]'s verdict
  //     "unattested" -> "attested" AND recompute its recordHash to cover the edit,
  //     so the per-record digest check passes. The chain still catches it: record[2]
  //     was linked to the ORIGINAL record[1] hash, so chain-link[2] now breaks. This
  //     is the point of the chain over a flat per-record hash — fixing one record's
  //     hash cannot be hidden without rewriting every record after it too.
  const ledgerFile = telemetryLedgerPath(run);
  const ledgerJson = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  ledgerJson.records[1].attestation = "attested";
  const { recordHash: _stale, ...rest1 } = ledgerJson.records[1];
  ledgerJson.records[1].recordHash = computeRecordHash(rest1); // attacker re-seals the local hash
  fs.writeFileSync(ledgerFile, JSON.stringify(ledgerJson, null, 2));
  const afterLedger = verifyTelemetryLedger(run);
  layers.push({
    layer: "ledger",
    tamper: `forged record[1] verdict "unattested" -> "attested" AND recomputed its recordHash to cover the edit`,
    before: { verified: clean.verified, detail: `${clean.records.length} records: chain intact, all hashes recompute` },
    after: { verified: afterLedger.verified, detail: `the hash chain caught it: ${failingChecks(afterLedger.checks).join(", ")}` },
    failures: failingChecks(afterLedger.checks)
  });

  // 3b. SIGNATURE layer — inflate hop-0's reported output tokens, keep the original
  //     signature. The ed25519 verify binds the exact usage bytes, so it rejects.
  const target = signed[0];
  const inflated = { ...target.hop.usage, output_tokens: (target.hop.usage.output_tokens as number) * 10 };
  const sigCheck = verifyTelemetryAttestation(inflated, target.signature, publicKeyPem, {
    runId,
    taskId: target.hop.taskId,
    promptDigest: target.hop.promptDigest
  });
  const sigCleanCheck = verifyTelemetryAttestation(target.hop.usage, target.signature, publicKeyPem, {
    runId,
    taskId: target.hop.taskId,
    promptDigest: target.hop.promptDigest
  });
  layers.push({
    layer: "signature",
    tamper: `inflated record[0] reported output_tokens ${target.hop.usage.output_tokens} -> ${inflated.output_tokens}, reused the original ed25519 signature`,
    before: { verified: sigCleanCheck.status === "attested", detail: `signature verifies against the reported usage (${sigCleanCheck.algorithm || "ed25519"})` },
    after: { verified: sigCheck.status === "attested", detail: sigCheck.reason || sigCheck.status },
    failures: sigCheck.status === "attested" ? [] : [`signature: ${sigCheck.reason}`]
  });

  if (!options.keepDir && !options.dir) fs.rmSync(runDir, { recursive: true, force: true });

  const proven =
    baseline.ledgerVerified &&
    baseline.signaturesValid === signed.filter((s) => s.signature).length &&
    layers.every((l) => l.before.verified && !l.after.verified && l.failures.length > 0);

  return { schemaVersion: 1, runId, workers: HOPS.length, trustKey: "ephemeral-ed25519", baseline, layers, proven };
}

// ---------------------------------------------------------------------------
// Bundle-verification demo — the portable-artifact counterpart to demo tamper.
// Proves the SHIPPABLE bundle (archive bytes + telemetry chain + trust-audit chain
// + embedded-key ed25519 signatures) re-verifies offline with ONLY the public key
// the bundle itself carries, and that forging it — at the chain layer OR the
// signature layer — is caught even when the archive's own file digests stay valid.
// Hermetic + deterministic: ephemeral key, real export, private tmpdir, no network.
// ---------------------------------------------------------------------------

export interface BundleDemoLayer {
  layer: "chain" | "signature";
  /** What was forged, in plain words. */
  tamper: string;
  before: { ok: boolean; detail: string };
  after: { ok: boolean; detail: string };
  /** The failed checks the bundle verifier reported after the forgery. */
  failures: string[];
}

export interface BundleDemoResult {
  schemaVersion: 1;
  runId: string;
  workers: number;
  trustKey: "ephemeral-ed25519";
  /** The clean baseline both forgeries start from. */
  baseline: { ok: boolean; telemetryVerified: boolean; signaturesReverified: number };
  layers: BundleDemoLayer[];
  /** True iff the clean bundle verified AND every forgery was caught. */
  proven: boolean;
}

export function runBundleDemo(options: { dir?: string; keepDir?: boolean } = {}): BundleDemoResult {
  const workdir = options.dir || fs.mkdtempSync(path.join(os.tmpdir(), "cw-bundle-demo-"));
  fs.mkdirSync(workdir, { recursive: true });
  const runId = "demo-bundle-run";
  const runDir = path.join(workdir, ".cw", "runs", runId);
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  // Build a real signed ledger + a cited report, the way an attested run would.
  const ledgerRun = { id: runId, paths } as unknown as WorkflowRun;
  for (const hop of HOPS) {
    const ctx = { runId, taskId: hop.taskId, promptDigest: hop.promptDigest };
    appendTelemetryAttestation(ledgerRun, {
      workerId: hop.workerId,
      taskId: hop.taskId,
      promptDigest: hop.promptDigest,
      reportedUsage: hop.usage,
      usageSignature: hop.attestation === "attested" ? signTelemetry(hop.usage, privateKeyPem, ctx) : undefined,
      attestation: hop.attestation,
      now: DEMO_NOW
    });
  }
  fs.writeFileSync(path.join(runDir, "report.md"), "# Architecture review\n\nRisk: src/server.js:18 — unauthenticated route.\n", "utf8");
  const attestedCount = HOPS.filter((h) => h.attestation === "attested").length;

  const fullRun = {
    schemaVersion: 1, id: runId, createdAt: DEMO_NOW, updatedAt: DEMO_NOW, cwd: workdir,
    workflow: { id: "demo", title: "Demo", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
    inputs: { question: "what are the risks?" }, loopStage: "interpret",
    phases: [], tasks: [], dispatches: [], commits: [], paths, nodes: [], contracts: []
  } as unknown as WorkflowRun;
  saveCheckpoint(fullRun);

  const ledgerFile = telemetryLedgerPath(ledgerRun);
  const cleanLedger = fs.readFileSync(ledgerFile, "utf8");
  const exportSealed = (out: string): void => { exportRun(fullRun, out, { trustPublicKey: publicKeyPem }); };

  // Baseline: a clean sealed bundle verifies offline; the embedded key reverifies
  // every signed hop.
  const cleanBundle = path.join(workdir, "clean.cwrun.json");
  exportSealed(cleanBundle);
  const clean = verifyReportBundle(cleanBundle);
  const baseline = { ok: clean.ok, telemetryVerified: clean.telemetryVerified, signaturesReverified: clean.signaturesReverified };

  const layers: BundleDemoLayer[] = [];

  // CHAIN forgery: flip record[1]'s verdict and reseal its recordHash; record[2]'s
  // prevHash still points at the original hash, so the chain breaks — even though
  // every archive file digest (computed at export over the tampered bytes) is valid.
  // This is exactly what inspect-archive alone cannot catch.
  {
    const j = JSON.parse(cleanLedger);
    j.records[1].attestation = "attested";
    const { recordHash: _drop, ...rest } = j.records[1];
    j.records[1].recordHash = computeRecordHash(rest);
    fs.writeFileSync(ledgerFile, JSON.stringify(j, null, 2));
    const forged = path.join(workdir, "forged-chain.cwrun.json");
    exportSealed(forged);
    const after = verifyReportBundle(forged);
    fs.writeFileSync(ledgerFile, cleanLedger);
    layers.push({
      layer: "chain",
      tamper: `forged record[1] verdict "unattested" -> "attested" and resealed its recordHash; the archive's own file digests stay valid`,
      before: { ok: clean.ok, detail: `${clean.signaturesReverified} signed hop(s) reverify; chain intact` },
      after: { ok: after.ok, detail: after.telemetryVerified ? "telemetry chain still verified (UNDETECTED!)" : "the embedded hash chain broke at the next record" },
      failures: after.ok ? [] : after.failedChecks.map((c) => `${c.name}: ${c.code}`)
    });
  }

  // SIGNATURE forgery: inflate the last attested hop's reported tokens and reseal its
  // usage digest + recordHash so the chain AND archive digests still verify; only the
  // ed25519 signature (over the original usage) no longer matches the inflated number.
  {
    const j = JSON.parse(cleanLedger);
    const idx = j.records.length - 1;
    j.records[idx].reportedUsage = { ...j.records[idx].reportedUsage, output_tokens: (j.records[idx].reportedUsage.output_tokens as number) * 10 };
    j.records[idx].reportedUsageDigest = reportedUsageDigest(j.records[idx].reportedUsage);
    const { recordHash: _drop, ...rest } = j.records[idx];
    j.records[idx].recordHash = computeRecordHash(rest);
    fs.writeFileSync(ledgerFile, JSON.stringify(j, null, 2));
    const forged = path.join(workdir, "forged-sig.cwrun.json");
    exportSealed(forged);
    const after = verifyReportBundle(forged);
    fs.writeFileSync(ledgerFile, cleanLedger);
    layers.push({
      layer: "signature",
      tamper: `inflated the last attested hop's output_tokens 10x and resealed its digest + recordHash; the chain stays valid`,
      before: { ok: clean.ok, detail: `the embedded public key reverifies the original signature` },
      after: { ok: after.ok, detail: after.signaturesFailed > 0 ? `${after.signaturesFailed} signature(s) failed ed25519 reverify` : "signature still verified (UNDETECTED!)" },
      failures: after.ok ? [] : after.failedChecks.map((c) => `${c.name}: ${c.code}`)
    });
  }

  if (!options.keepDir && !options.dir) fs.rmSync(workdir, { recursive: true, force: true });

  const proven =
    baseline.ok &&
    baseline.telemetryVerified &&
    baseline.signaturesReverified === attestedCount &&
    layers.every((l) => l.before.ok && !l.after.ok && l.failures.length > 0);

  return { schemaVersion: 1, runId, workers: HOPS.length, trustKey: "ephemeral-ed25519", baseline, layers, proven };
}

export function formatBundleDemo(r: BundleDemoResult): string {
  const lines: string[] = [];
  lines.push(`cw demo bundle — portable-bundle verification proof (hermetic, ${r.trustKey} key)`);
  lines.push("");
  lines.push(`▶ Exported a sealed report bundle: ${r.workers} hops, public key embedded`);
  lines.push(`  ${r.baseline.ok ? "✓" : "✗"} bundle verifies offline   ${r.baseline.signaturesReverified} signed hop(s) reverify with only the embedded public key`);
  for (const l of r.layers) {
    lines.push("");
    lines.push(`▶ ${l.layer.toUpperCase()} forgery`);
    lines.push(`  edit:   ${l.tamper}`);
    lines.push(`  before: ${l.before.ok ? "✓ verifies" : "✗"} — ${l.before.detail}`);
    lines.push(`  after:  ${l.after.ok ? "✓ (UNDETECTED!)" : "✗ DETECTED"} — ${l.after.detail}`);
  }
  lines.push("");
  lines.push(
    r.proven
      ? "VERDICT: bundle verification holds ✓ — every forgery caught offline with only the bundle's embedded public key. No repo, no server, no key handed over."
      : "VERDICT: PROOF FAILED ✗ — a forged bundle verified. This is a regression in the bundle guarantee."
  );
  return lines.join("\n");
}
