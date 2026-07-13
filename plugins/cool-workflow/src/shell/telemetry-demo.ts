// shell/telemetry-demo.ts — `cw demo tamper|bundle`: the hermetic,
// offline trust proofs. Impure (fs, ephemeral keypair generation,
// tmpdir), so this lives in shell/ not core/.
//
// MILESTONE 8. Byte-exact port of the old build's src/telemetry-demo.ts.
// Fully hermetic + deterministic: an EPHEMERAL ed25519 keypair, fixed
// hops/usages, a pinned `now`, no network, no model. Only the keypair
// itself varies per run and never leaves this module.
//
// Evidence: SPEC/ledger-trust.md "`cw demo tamper`", "`cw demo bundle`";
// plugins/cool-workflow/src/telemetry-demo.ts:1-424 (byte-exact source).

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sha256 } from "../core/hash";
import { signTelemetry, verifyTelemetryAttestation } from "../core/trust/telemetry-attestation";
import { TelemetryLedgerCheck } from "../core/trust/telemetry-ledger";
import { appendTelemetryAttestation, computeRecordHash, reportedUsageDigest, telemetryLedgerPath, verifyTelemetryLedger } from "./telemetry-ledger-io";
import { createRunPaths } from "../core/state/run-paths";
import { ensureRunDirs, saveCheckpoint } from "./run-store";
import { exportRun, verifyReportBundle } from "./run-export";
import { WorkflowRun } from "../core/state/types";

export interface TamperDemoLayer {
  layer: "ledger" | "signature" | "result";
  tamper: string;
  before: { verified: boolean; detail: string };
  after: { verified: boolean; detail: string };
  failures: string[];
}

export interface TamperDemoResult {
  schemaVersion: 1;
  runId: string;
  workers: number;
  trustKey: "ephemeral-ed25519";
  baseline: { ledgerVerified: boolean; signaturesValid: number; records: number };
  layers: TamperDemoLayer[];
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
  signatureKeyProvided: boolean;
  signaturesChecked: number;
  signaturesReverified: number;
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

/** Human-facing render of `demo tamper`. */
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

// Three hops with a deliberate mix: two signed/attested, one unattested —
// so the ledger-layer tamper can forge the unattested verdict into
// "attested" (the exact threat the ledger exists to catch).
const HOPS: DemoHop[] = [
  { workerId: "w-map", taskId: "map:server-api", promptDigest: sha256("map:server-api"), usage: { input_tokens: 2117, output_tokens: 1911 }, attestation: "attested" },
  { workerId: "w-assess", taskId: "assess:security", promptDigest: sha256("assess:security"), usage: { input_tokens: 1840, output_tokens: 1502 }, attestation: "unattested" },
  { workerId: "w-verdict", taskId: "verdict:synthesis", promptDigest: sha256("verdict:synthesis"), usage: { input_tokens: 980, output_tokens: 770 }, attestation: "attested" },
];

const DEMO_NOW = "2026-01-01T00:00:00.000Z";

function failingChecks(checks: TelemetryLedgerCheck[]): string[] {
  return checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.code}`);
}

/** Run the full tamper-evidence demonstration in a private tmpdir
 *  (cleaned up unless `keepDir` is set). Deterministic except for the
 *  ephemeral keypair, which never leaves this function. */
export function runTamperDemo(options: { dir?: string; keepDir?: boolean } = {}): TamperDemoResult {
  const runDir = options.dir || fs.mkdtempSync(path.join(os.tmpdir(), "cw-tamper-demo-"));
  fs.mkdirSync(runDir, { recursive: true });
  const runId = "demo-tamper-run";
  // Minimal run shape: the ledger API uses only id + paths.runDir.
  const run = { id: runId, paths: { runDir } } as unknown as WorkflowRun;

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  // 1. Build a REAL ledger through the production append API, signing
  //    each attested hop's usage with the ephemeral key.
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
      now: DEMO_NOW,
    });
    signed.push({ hop, signature });
  }

  // 2. Baseline: the clean ledger verifies, and every signed hop's
  //    signature is valid.
  const clean = verifyTelemetryLedger(run);
  const signaturesValid = signed.filter(
    (s) =>
      s.signature &&
      verifyTelemetryAttestation(s.hop.usage, s.signature, publicKeyPem, { runId, taskId: s.hop.taskId, promptDigest: s.hop.promptDigest }).status === "attested"
  ).length;
  const baseline = { ledgerVerified: clean.verified, signaturesValid, records: clean.records.length };

  const layers: TamperDemoLayer[] = [];

  // 3a. LEDGER layer — flip record[1]'s verdict "unattested" -> "attested"
  //     AND recompute its recordHash to cover the edit, so the per-record
  //     digest check passes. The chain still catches it: record[2] was
  //     linked to the ORIGINAL record[1] hash, so chain-link[2] breaks.
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
    failures: failingChecks(afterLedger.checks),
  });

  // 3b. SIGNATURE layer — inflate hop-0's reported output tokens, keep
  //     the original signature.
  const target = signed[0];
  const inflated = { ...target.hop.usage, output_tokens: (target.hop.usage.output_tokens as number) * 10 };
  const sigCheck = verifyTelemetryAttestation(inflated, target.signature, publicKeyPem, {
    runId,
    taskId: target.hop.taskId,
    promptDigest: target.hop.promptDigest,
  });
  const sigCleanCheck = verifyTelemetryAttestation(target.hop.usage, target.signature, publicKeyPem, {
    runId,
    taskId: target.hop.taskId,
    promptDigest: target.hop.promptDigest,
  });
  layers.push({
    layer: "signature",
    tamper: `inflated record[0] reported output_tokens ${target.hop.usage.output_tokens} -> ${inflated.output_tokens}, reused the original ed25519 signature`,
    before: { verified: sigCleanCheck.status === "attested", detail: `signature verifies against the reported usage (${sigCleanCheck.algorithm || "ed25519"})` },
    after: { verified: sigCheck.status === "attested", detail: sigCheck.reason || sigCheck.status },
    failures: sigCheck.status === "attested" ? [] : [`signature: ${sigCheck.reason}`],
  });

  // 3c. RESULT layer — the agent's signed FINDING is edited after
  //     signing. CW re-derives the digest from the result text at verify
  //     time, so the edited finding no longer joins the signature.
  const findingSigned = "Finding: auth bypass in login() — severity HIGH";
  const findingEdited = findingSigned.replace("HIGH", "LOW");
  const resultCtx = { runId, taskId: target.hop.taskId, promptDigest: target.hop.promptDigest };
  const resultSignature = signTelemetry(target.hop.usage, privateKeyPem, { ...resultCtx, resultDigest: sha256(findingSigned) });
  const resultClean = verifyTelemetryAttestation(target.hop.usage, resultSignature, publicKeyPem, { ...resultCtx, resultDigest: sha256(findingSigned) });
  const resultCheck = verifyTelemetryAttestation(target.hop.usage, resultSignature, publicKeyPem, { ...resultCtx, resultDigest: sha256(findingEdited) });
  layers.push({
    layer: "result",
    tamper: `edited the agent's signed finding "severity HIGH" -> "severity LOW" after it was signed`,
    before: {
      verified: resultClean.status === "attested" && resultClean.coversResult === true,
      detail: `the signed finding verifies — ed25519 binds usage + sha256(result), result-covering`,
    },
    after: { verified: resultCheck.status === "attested", detail: resultCheck.reason || resultCheck.status },
    failures: resultCheck.status === "attested" ? [] : [`result: ${resultCheck.reason}`],
  });

  if (!options.keepDir && !options.dir) fs.rmSync(runDir, { recursive: true, force: true });

  const proven =
    baseline.ledgerVerified &&
    baseline.signaturesValid === signed.filter((s) => s.signature).length &&
    layers.every((l) => l.before.verified && !l.after.verified && l.failures.length > 0);

  return { schemaVersion: 1, runId, workers: HOPS.length, trustKey: "ephemeral-ed25519", baseline, layers, proven };
}

// ---------------------------------------------------------------------------
// Bundle-verification demo — the portable-artifact counterpart to demo
// tamper.
// ---------------------------------------------------------------------------

export interface BundleDemoLayer {
  layer: "chain" | "signature";
  tamper: string;
  before: { ok: boolean; detail: string };
  after: { ok: boolean; detail: string };
  failures: string[];
}

export interface BundleDemoResult {
  schemaVersion: 1;
  runId: string;
  workers: number;
  trustKey: "ephemeral-ed25519";
  baseline: { ok: boolean; telemetryVerified: boolean; signaturesReverified: number };
  layers: BundleDemoLayer[];
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

  // Build a real signed ledger + a cited report, the way an attested run
  // would.
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
      now: DEMO_NOW,
    });
  }
  fs.writeFileSync(path.join(runDir, "report.md"), "# Architecture review\n\nRisk: src/server.js:18 — unauthenticated route.\n", "utf8");
  const attestedCount = HOPS.filter((h) => h.attestation === "attested").length;

  const fullRun = {
    schemaVersion: 1,
    id: runId,
    createdAt: DEMO_NOW,
    updatedAt: DEMO_NOW,
    cwd: workdir,
    workflow: { id: "demo", title: "Demo", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
    inputs: { question: "what are the risks?" },
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: [],
  } as unknown as WorkflowRun;
  saveCheckpoint(fullRun);

  const ledgerFile = telemetryLedgerPath(ledgerRun);
  const cleanLedger = fs.readFileSync(ledgerFile, "utf8");
  const exportSealed = (out: string): void => {
    exportRun(fullRun, out, { trustPublicKey: publicKeyPem });
  };

  // Baseline: a clean sealed bundle verifies offline; the embedded key
  // reverifies every signed hop.
  const cleanBundle = path.join(workdir, "clean.cwrun.json");
  exportSealed(cleanBundle);
  const clean = verifyReportBundle(cleanBundle);
  const baseline = { ok: clean.ok, telemetryVerified: clean.telemetryVerified, signaturesReverified: clean.signaturesReverified };

  const layers: BundleDemoLayer[] = [];

  // CHAIN forgery: flip record[1]'s verdict and reseal its recordHash;
  // record[2]'s prevHash still points at the original hash, so the chain
  // breaks — even though every archive file digest is valid.
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
      failures: after.ok ? [] : after.failedChecks.map((c) => `${c.name}: ${c.code}`),
    });
  }

  // SIGNATURE forgery: inflate the last attested hop's reported tokens
  // and reseal its usage digest + recordHash so the chain AND archive
  // digests still verify; only the ed25519 signature no longer matches.
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
      failures: after.ok ? [] : after.failedChecks.map((c) => `${c.name}: ${c.code}`),
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
