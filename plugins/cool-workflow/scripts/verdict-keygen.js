#!/usr/bin/env node
"use strict";

// verdict-keygen.js — generate the ed25519 keypair for release-verdict
// signing. Same pattern as scripts/agents/cw-attest-keygen.js (that keypair
// signs AGENT USAGE telemetry; this one signs the RELEASE VERDICT — kept as
// two separate trust domains with two separate keypairs, never shared).
//
// The PRIVATE key stays with whoever runs `release-flow.js --cut`/`--check`
// (CW_RELEASE_VERDICT_PRIVKEY) and NEVER gets committed. The PUBLIC key is
// committed to the repo at .cw-release/verdict-signing.pub so CI's
// release-gate.yml, npm-publish.yml, and the local block-unapproved-tag.sh
// hook can all verify a committed verdict without holding any secret.
//
// Verification is opt-in and backward compatible: as long as
// .cw-release/verdict-signing.pub is absent, every verifier falls back to the
// original `grep -q '^APPROVED'` check. Once the public key is committed,
// every verifier starts requiring a valid signature too.
//
// Usage:
//   node verdict-keygen.js [--out-dir DIR]   # writes verdict-signing.key + .pub
//   node verdict-keygen.js --print           # print both PEMs to stdout, write nothing

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

// .cw-release/ lives at the REPO ROOT, not necessarily at process.cwd() —
// this script is documented to be run from plugins/cool-workflow (RELEASE.md's
// checklist cwd), where a bare ".cw-release/verdict-signing.pub" would
// silently resolve under plugins/cool-workflow/.cw-release/ instead, a path no
// verifier ever looks at. Resolve the real root so the printed command is
// correct regardless of where this script was invoked from.
function repoRootPubkeyPath() {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const root = r.status === 0 ? r.stdout.trim() : undefined;
  return root ? path.join(root, ".cw-release", "verdict-signing.pub") : ".cw-release/verdict-signing.pub";
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

if (process.argv.includes("--print")) {
  process.stdout.write(`# PRIVATE (release operator — CW_RELEASE_VERDICT_PRIVKEY, never commit)\n${privatePem}\n# PUBLIC (commit as .cw-release/verdict-signing.pub)\n${publicPem}\n`);
  process.exit(0);
}

const outDir = path.resolve(arg("--out-dir", process.cwd()));
const keyPath = path.join(outDir, "verdict-signing.key");
const pubPath = path.join(outDir, "verdict-signing.pub");
fs.mkdirSync(outDir, { recursive: true });
// Private key: owner-only perms (0600). NEVER commit this file.
fs.writeFileSync(keyPath, privatePem, { mode: 0o600 });
fs.writeFileSync(pubPath, publicPem);

process.stdout.write(
  [
    `Wrote ed25519 keypair:`,
    `  private (operator, keep off the repo): ${keyPath}   (chmod 0600)`,
    `  public  (commit to the repo):          ${pubPath}`,
    ``,
    `Release operator (local machine, never committed):`,
    `  export CW_RELEASE_VERDICT_PRIVKEY="${keyPath}"`,
    ``,
    `Repo (commit this so CI/hook can verify — path is repo-root-anchored,`,
    `correct no matter which directory you run this from):`,
    `  cp "${pubPath}" "${repoRootPubkeyPath()}"`,
    `  git -C "$(git rev-parse --show-toplevel)" add .cw-release/verdict-signing.pub`,
    `  git -C "$(git rev-parse --show-toplevel)" commit -m "chore: add release-verdict signing public key"`,
    ``,
    `Once .cw-release/verdict-signing.pub is committed, release-gate.yml, npm-publish.yml,`,
    `and block-unapproved-tag.sh all start REQUIRING a valid signature on top of the`,
    `existing APPROVED text check — an unsigned or hand-written verdict fails closed.`,
    ``
  ].join("\n")
);
