#!/usr/bin/env node
"use strict";

// cw-attest-keygen (Track 1) — generate the ed25519 keypair for telemetry
// attestation. The PRIVATE key stays with the executor/signing wrapper
// (CW_AGENT_ATTEST_PRIVKEY); the PUBLIC key is handed to CW to VERIFY with
// (CW_AGENT_ATTEST_PUBKEY / agent attestPublicKey). CW never holds the private
// half — it can verify attribution but never forge a signature.
//
// Usage:
//   node cw-attest-keygen.js [--out-dir DIR]   # writes cw-attest.key + cw-attest.pub
//   node cw-attest-keygen.js --print           # print both PEMs to stdout, write nothing

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

if (process.argv.includes("--print")) {
  process.stdout.write(`# PRIVATE (executor / wrapper — CW_AGENT_ATTEST_PRIVKEY)\n${privatePem}\n# PUBLIC (CW verify — CW_AGENT_ATTEST_PUBKEY)\n${publicPem}\n`);
  process.exit(0);
}

const outDir = path.resolve(arg("--out-dir", process.cwd()));
const keyPath = path.join(outDir, "cw-attest.key");
const pubPath = path.join(outDir, "cw-attest.pub");
fs.mkdirSync(outDir, { recursive: true });
// Private key: owner-only perms (0600). It is NEVER committed to .cw/ or config.
fs.writeFileSync(keyPath, privatePem, { mode: 0o600 });
fs.writeFileSync(pubPath, publicPem);

process.stdout.write(
  [
    `Wrote ed25519 keypair:`,
    `  private (executor):  ${keyPath}   (chmod 0600)`,
    `  public  (CW verify): ${pubPath}`,
    ``,
    `Executor / signing wrapper:`,
    `  export CW_AGENT_ATTEST_PRIVKEY="${keyPath}"`,
    ``,
    `CW (verify side):`,
    `  export CW_AGENT_ATTEST_PUBKEY="${pubPath}"`,
    ``,
    `Keep the PRIVATE key off any committed state. CW only needs the PUBLIC key.`,
    ``
  ].join("\n")
);
