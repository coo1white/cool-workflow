#!/usr/bin/env node
"use strict";

// cw-attest-wrap (Track 1) — EXECUTOR-SIDE telemetry signing wrapper.
//
// This is operator CONFIG, NOT a CW dependency. CW spawns it out-of-process; the
// model runs in the INNER agent's process, never in CW. The wrapper's only job is
// to SIGN the agent's self-reported usage so CW can verify it `attested` instead
// of recording an unverifiable claim. CW holds only the PUBLIC key and verifies;
// this wrapper holds the PRIVATE key (CW_AGENT_ATTEST_PRIVKEY) and signs. It does
// NOT call a model and imports no model SDK — it execs whatever agent you name.
//
// It signs the EXACT same canonical payload CW verifies — {usage, runId, taskId,
// promptDigest} — sharing the canonicalization with the verifier via
// dist/telemetry-attestation.js, so signer and verifier can never drift.
//
// Usage (wrap any agent that prints a {model, usage} JSON report on stdout):
//   node cw-attest-wrap.js --manifest {{manifest}} -- <agent-cmd> [agent-args...]
//
// Point CW at it (from plugins/cool-workflow/), keeping your inner agent intact:
//   CW_AGENT_ATTEST_PRIVKEY=$PWD/cw-attest.key \
//   CW_AGENT_COMMAND="node $PWD/scripts/agents/cw-attest-wrap.js --manifest {{manifest}} -- \
//     bash $PWD/scripts/agents/claude-p-agent.sh {{input}} {{result}}"
// and configure CW's verify side: CW_AGENT_ATTEST_PUBKEY=$PWD/cw-attest.pub
//
// Honest posture: if no private key is set, or the agent reports no usage, the
// wrapper passes the report through UNSIGNED — CW then records it `unattested`,
// never a fabricated attestation.

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ta = require(path.resolve(__dirname, "..", "..", "dist", "telemetry-attestation.js"));

function fail(message) {
  process.stderr.write(`cw-attest-wrap: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  let manifestPath;
  const inner = [];
  let afterSep = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (afterSep) {
      inner.push(arg);
      continue;
    }
    if (arg === "--") afterSep = true;
    else if (arg === "--manifest") manifestPath = argv[++i];
    else fail(`unexpected arg before "--": ${arg}`);
  }
  if (!inner.length) fail('no inner agent command after "--"');
  return { manifestPath, inner };
}

// Tolerant parse of the inner agent's JSON report — whole stdout, else the last
// {..} line. Mirrors CW's parseAgentReport so the wrapper sees the same usage.
function parseReport(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return undefined;
  const tryObj = (value) => {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  };
  let obj = tryObj(text);
  if (!obj) {
    const line = text
      .split(/\r?\n/)
      .reverse()
      .find((entry) => entry.trim().startsWith("{") && entry.trim().endsWith("}"));
    if (line) obj = tryObj(line.trim());
  }
  return obj;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function resolveKey(value) {
  if (!value) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("BEGIN") && trimmed.includes("KEY")) return trimmed;
  try {
    if (fs.existsSync(trimmed)) return fs.readFileSync(trimmed, "utf8");
  } catch {
    /* fall through */
  }
  return undefined;
}

function main() {
  const { manifestPath, inner } = parseArgs(process.argv.slice(2));

  // Run the inner agent: stderr passes through live; stdout is captured to sign.
  const child = spawnSync(inner[0], inner.slice(1), {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024
  });
  const exitCode = typeof child.status === "number" ? child.status : 1;
  const stdout = String(child.stdout || "");

  // Best-effort signing. Any failure ⇒ pass the report through UNSIGNED (CW will
  // record it `unattested`), never block the hop or fabricate a signature.
  let out = stdout;
  try {
    const report = parseReport(stdout);
    const privateKey = resolveKey(process.env.CW_AGENT_ATTEST_PRIVKEY);
    const manifest = manifestPath && fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : undefined;
    if (report && report.usage && privateKey && manifest) {
      const inputPath = manifest.inputPath;
      const promptDigest = inputPath && fs.existsSync(inputPath) ? sha256(fs.readFileSync(inputPath, "utf8")) : sha256(manifest.prompt || "");
      // Bind the agent's RESULT into the signature too, so editing the findings —
      // not just the usage — is detected. The inner agent ran synchronously, so
      // result.md is on disk now; CW digests the SAME bytes at intake (raw file,
      // shared sha256). Absent/unreadable ⇒ sign without it (a 4-field signature
      // CW still verifies — back-compat).
      const resultPath = manifest.resultPath;
      const resultDigest = resultPath && fs.existsSync(resultPath) ? sha256(fs.readFileSync(resultPath, "utf8")) : undefined;
      const signature = ta.signTelemetry(report.usage, privateKey, {
        runId: manifest.runId,
        taskId: manifest.taskId,
        promptDigest,
        ...(resultDigest ? { resultDigest } : {})
      });
      out = JSON.stringify({ ...report, usageSignature: signature });
    } else if (report) {
      // Re-emit a clean single JSON object so CW's parse is unambiguous.
      out = JSON.stringify(report);
      if (report.usage && !privateKey) process.stderr.write("cw-attest-wrap: no CW_AGENT_ATTEST_PRIVKEY — emitting UNSIGNED (CW will record unattested)\n");
    }
  } catch (error) {
    process.stderr.write(`cw-attest-wrap: signing skipped (${error && error.message ? error.message : error}) — emitting UNSIGNED\n`);
    out = stdout;
  }

  process.stdout.write(out);
  process.exit(exitCode);
}

main();
