"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTelemetryVerify = formatTelemetryVerify;
exports.formatTamperDemo = formatTamperDemo;
exports.runTamperDemo = runTamperDemo;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const telemetry_ledger_1 = require("./telemetry-ledger");
const telemetry_attestation_1 = require("./telemetry-attestation");
const execution_backend_1 = require("./execution-backend");
/** Human-facing render of `telemetry verify <run>`. */
function formatTelemetryVerify(r) {
    const keyUnreadable = r.failedChecks.some((c) => c.code === "telemetry-pubkey-unreadable");
    if (!r.present && !keyUnreadable)
        return `telemetry: run ${r.runId} has no attestation ledger (nothing to verify)`;
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
function formatTamperDemo(r) {
    const lines = [];
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
    lines.push(r.proven
        ? "VERDICT: tamper-evidence holds ✓ — every forgery was caught offline, with only the public key. No server was trusted."
        : "VERDICT: PROOF FAILED ✗ — a tamper went undetected. This is a regression in the integrity guarantee.");
    return lines.join("\n");
}
// Three hops with a deliberate mix: two signed/attested, one unattested — so the
// ledger-layer tamper can forge the unattested verdict into "attested" (the exact
// threat the ledger exists to catch).
const HOPS = [
    { workerId: "w-map", taskId: "map:server-api", promptDigest: (0, execution_backend_1.sha256)("map:server-api"), usage: { input_tokens: 2117, output_tokens: 1911 }, attestation: "attested" },
    { workerId: "w-assess", taskId: "assess:security", promptDigest: (0, execution_backend_1.sha256)("assess:security"), usage: { input_tokens: 1840, output_tokens: 1502 }, attestation: "unattested" },
    { workerId: "w-verdict", taskId: "verdict:synthesis", promptDigest: (0, execution_backend_1.sha256)("verdict:synthesis"), usage: { input_tokens: 980, output_tokens: 770 }, attestation: "attested" }
];
const DEMO_NOW = "2026-01-01T00:00:00.000Z";
function failingChecks(checks) {
    return checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.code}`);
}
/** Run the full tamper-evidence demonstration in a private tmpdir (cleaned up
 *  unless `keepDir` is set). Pure of clock/network; the only nondeterminism is
 *  the ephemeral keypair, which never leaves this function. */
function runTamperDemo(options = {}) {
    const runDir = options.dir || node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "cw-tamper-demo-"));
    node_fs_1.default.mkdirSync(runDir, { recursive: true });
    const runId = "demo-tamper-run";
    // Minimal run shape: the ledger API uses only id + paths.runDir.
    const run = { id: runId, paths: { runDir } };
    const { publicKey, privateKey } = node_crypto_1.default.generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    // 1. Build a REAL ledger through the production append API, signing each
    //    attested hop's usage with the ephemeral key.
    const signed = [];
    for (const hop of HOPS) {
        const ctx = { runId, taskId: hop.taskId, promptDigest: hop.promptDigest };
        const signature = hop.attestation === "attested" ? (0, telemetry_attestation_1.signTelemetry)(hop.usage, privateKeyPem, ctx) : undefined;
        (0, telemetry_ledger_1.appendTelemetryAttestation)(run, {
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
    const clean = (0, telemetry_ledger_1.verifyTelemetryLedger)(run);
    const signaturesValid = signed.filter((s) => s.signature && (0, telemetry_attestation_1.verifyTelemetryAttestation)(s.hop.usage, s.signature, publicKeyPem, { runId, taskId: s.hop.taskId, promptDigest: s.hop.promptDigest }).status === "attested").length;
    const baseline = { ledgerVerified: clean.verified, signaturesValid, records: clean.records.length };
    const layers = [];
    // 3a. LEDGER layer — the SOPHISTICATED forgery: flip record[1]'s verdict
    //     "unattested" -> "attested" AND recompute its recordHash to cover the edit,
    //     so the per-record digest check passes. The chain still catches it: record[2]
    //     was linked to the ORIGINAL record[1] hash, so chain-link[2] now breaks. This
    //     is the point of the chain over a flat per-record hash — fixing one record's
    //     hash cannot be hidden without rewriting every record after it too.
    const ledgerFile = (0, telemetry_ledger_1.telemetryLedgerPath)(run);
    const ledgerJson = JSON.parse(node_fs_1.default.readFileSync(ledgerFile, "utf8"));
    ledgerJson.records[1].attestation = "attested";
    const { recordHash: _stale, ...rest1 } = ledgerJson.records[1];
    ledgerJson.records[1].recordHash = (0, telemetry_ledger_1.computeRecordHash)(rest1); // attacker re-seals the local hash
    node_fs_1.default.writeFileSync(ledgerFile, JSON.stringify(ledgerJson, null, 2));
    const afterLedger = (0, telemetry_ledger_1.verifyTelemetryLedger)(run);
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
    const inflated = { ...target.hop.usage, output_tokens: target.hop.usage.output_tokens * 10 };
    const sigCheck = (0, telemetry_attestation_1.verifyTelemetryAttestation)(inflated, target.signature, publicKeyPem, {
        runId,
        taskId: target.hop.taskId,
        promptDigest: target.hop.promptDigest
    });
    const sigCleanCheck = (0, telemetry_attestation_1.verifyTelemetryAttestation)(target.hop.usage, target.signature, publicKeyPem, {
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
    if (!options.keepDir && !options.dir)
        node_fs_1.default.rmSync(runDir, { recursive: true, force: true });
    const proven = baseline.ledgerVerified &&
        baseline.signaturesValid === signed.filter((s) => s.signature).length &&
        layers.every((l) => l.before.verified && !l.after.verified && l.failures.length > 0);
    return { schemaVersion: 1, runId, workers: HOPS.length, trustKey: "ephemeral-ed25519", baseline, layers, proven };
}
