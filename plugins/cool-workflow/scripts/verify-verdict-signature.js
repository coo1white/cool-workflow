#!/usr/bin/env node
"use strict";

// verify-verdict-signature.js — verify an ed25519 signature over a committed
// release verdict file, against the committed public key
// (.cw-release/verdict-signing.pub). Portable (node + node:crypto only) so
// CI (release-gate.yml, npm-publish.yml) and the local block-unapproved-tag.sh
// hook can all shell out to the SAME check instead of three drifting copies.
//
// Exit 0: signature verifies. Exit 1: missing file, unreadable key, or a
// signature that does not match (tampered verdict, wrong key, hand-written
// verdict with no real signature). Never throws uncaught — callers rely on
// the exit code alone, not stderr text.
//
// Usage: node verify-verdict-signature.js <verdict-file> <sig-file> <pubkey-file>

const fs = require("node:fs");
const crypto = require("node:crypto");

function fail(message) {
  process.stderr.write(`verify-verdict-signature: ${message}\n`);
  process.exit(1);
}

const [, , verdictPath, sigPath, pubkeyPath] = process.argv;
if (!verdictPath || !sigPath || !pubkeyPath) {
  process.stderr.write("usage: verify-verdict-signature.js <verdict-file> <sig-file> <pubkey-file>\n");
  process.exit(2);
}

let message;
try {
  message = fs.readFileSync(verdictPath);
} catch (error) {
  fail(`cannot read verdict file ${verdictPath}: ${error.message}`);
}

let signature;
try {
  signature = Buffer.from(fs.readFileSync(sigPath, "utf8").trim(), "base64");
  if (signature.length === 0) fail(`signature file ${sigPath} is empty`);
} catch (error) {
  fail(`cannot read signature file ${sigPath}: ${error.message}`);
}

let publicKey;
try {
  publicKey = crypto.createPublicKey(fs.readFileSync(pubkeyPath, "utf8"));
} catch (error) {
  fail(`cannot read public key ${pubkeyPath}: ${error.message}`);
}

let ok = false;
try {
  ok = crypto.verify(null, message, publicKey, signature);
} catch (error) {
  fail(`verification error: ${error.message}`);
}

if (!ok) fail(`signature does not match ${verdictPath} (tampered, wrong key, or not a real signature)`);
process.exit(0);
