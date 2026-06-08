#!/usr/bin/env node
"use strict";

// verify-container-selfref — the v0.1.34 self-referential acceptance check.
//
// Runs CW's own `node dist/cli.js list` through the `node` backend AND the
// `container` backend, and asserts result + evidence are byte-IDENTICAL after
// provenance is excluded (backendId/handle/attestation differ by design). This is
// the bar that proves a delegated run is backend-agnostic.
//
// Requires a RUNNING container daemon and a pullable node image. Not part of
// release:check (CI has no daemon); run it manually before tagging v0.1.34.
//
//   node scripts/verify-container-selfref.js
//   CW_CONTAINER_IMAGE=node:22-slim node scripts/verify-container-selfref.js
//
// Exit: 0 PASS · 1 FAIL (evidence differs) · 2 node backend did not complete ·
//       3 SKIP (container refused — daemon down / image not pullable).

const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { runBackend } = require(path.join(pluginRoot, "dist/execution-backend.js"));
const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/sandbox-profile.js"));

const image = (process.env.CW_CONTAINER_IMAGE || "node:lts-slim").trim();
const cli = path.join(pluginRoot, "dist", "cli.js");
const ctx = sandboxContextForValidation(pluginRoot);
const policy = showBundledSandboxProfile("default", ctx);

const common = { schemaVersion: 1, command: "node", args: [cli, "list"], cwd: pluginRoot, sandboxPolicy: policy, label: "cw-self-verify" };
const nodeEnv = runBackend({ ...common, backendId: "node" });
const containerEnv = runBackend({ ...common, backendId: "container", delegation: { image } });

const line = (label, e) => `  ${label.padEnd(9)} status=${e.status} backend=${e.provenance.backendId} evidence=${JSON.stringify(e.evidence)}`;
process.stdout.write(`verify-container-selfref (image: ${image})\n${line("node", nodeEnv)}\n${line("container", containerEnv)}\n`);

if (nodeEnv.status !== "completed") {
  process.stderr.write(`\n✗ node backend did not complete (${nodeEnv.status}) — cannot compare.\n`);
  process.exit(2);
}
if (containerEnv.status === "refused") {
  process.stderr.write(
    `\n⚠ SKIP — container refused (${containerEnv.evidence[0]}).\n` +
      `  ${containerEnv.result.summary}\n` +
      `  Start the container daemon and ensure the image is pullable (e.g. \`docker pull ${image}\`), then re-run.\n`
  );
  process.exit(3);
}

const sameResult = JSON.stringify(nodeEnv.result) === JSON.stringify(containerEnv.result);
const sameEvidence = JSON.stringify(nodeEnv.evidence) === JSON.stringify(containerEnv.evidence);
if (containerEnv.status === "completed" && sameResult && sameEvidence) {
  process.stdout.write("\n✓ PASS — container result + evidence are byte-identical to node (provenance differs, as designed).\n");
  process.exit(0);
}

process.stderr.write(
  `\n✗ FAIL — container output differs from node (status=${containerEnv.status}):\n` +
    `  node      evidence: ${JSON.stringify(nodeEnv.evidence)}\n` +
    `  container evidence: ${JSON.stringify(containerEnv.evidence)}\n` +
    `  (a node-version difference in the image can change stdout; pin CW_CONTAINER_IMAGE to a matching node.)\n`
);
process.exit(1);
