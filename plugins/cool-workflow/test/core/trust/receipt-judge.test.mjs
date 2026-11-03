#!/usr/bin/env node
// receipt-judge — core/trust/receipt.ts: the digest/id seal, the signature,
// and judgeReceipt's fail-closed order (found, intact, signed when a key is
// set, passed, tied to git, current), each refusal with a plain reason and
// one next command (project/docs/intent/2026-11-03-done-receipt.md).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  checkCommandLine,
  computeReceiptDigest,
  judgeReceipt,
  receiptIntact,
  receiptOutcome,
  receiptSignatureValid,
  RECEIPT_ID_RE,
  sealReceipt,
  shellWord,
  signReceipt,
} from "../../../dist/core/trust/receipt.js";

const HEAD = "a".repeat(40);
const TREE = `sha256:${"b".repeat(64)}`;
const CODE = { gitHead: HEAD, treeDigest: TREE };

function body(over = {}) {
  return {
    kind: "check-receipt",
    schemaVersion: 1,
    argv: ["npm", "test"],
    cwd: "/repo",
    gitHead: HEAD,
    dirty: false,
    treeDigest: TREE,
    exitCode: 0,
    signal: null,
    startedAt: "2026-11-03T00:00:00.000Z",
    endedAt: "2026-11-03T00:00:01.000Z",
    stdout: { sha256: "sha256:x", bytes: 1, tail: "ok" },
    stderr: { sha256: "sha256:y", bytes: 0, tail: "" },
    cwVersion: "0.4.0",
    ...over,
  };
}

// Seal: content-addressed id, digest over the body only, stable.
{
  const r = sealReceipt(body());
  assert.match(r.id, RECEIPT_ID_RE);
  assert.equal(r.id, `rc-${r.digest.slice("sha256:".length, "sha256:".length + 16)}`);
  assert.equal(computeReceiptDigest(r), r.digest, "id/digest/signature are not part of the digest");
  assert.equal(sealReceipt(body()).id, r.id, "same body, same id");
  assert.notEqual(sealReceipt(body({ exitCode: 1 })).id, r.id);
  assert.equal(receiptIntact(r), true);
}

// Accepted: exit 0, intact, same HEAD and tree.
{
  const r = sealReceipt(body());
  const v = judgeReceipt(r.id, r, CODE);
  assert.equal(v.ok, true);
  assert.equal(v.reason, `verified by receipt ${r.id} (exit 0 at aaaaaaa)`);
}

// Each refusal, in order, with its code, reason and next step.
{
  const id = "rc-0123456789abcdef";
  const missing = judgeReceipt(id, undefined, CODE);
  assert.deepEqual([missing.ok, missing.code, missing.next], [false, "receipt-not-found", "cw check list"]);
  assert.match(missing.reason, /was not found in \.cw\/receipts/);

  const r = sealReceipt(body({ exitCode: 1 }));
  const forged = { ...r, exitCode: 0 };
  const t = judgeReceipt(r.id, forged, CODE);
  assert.equal(t.code, "receipt-tampered", "editing exitCode breaks the digest");
  assert.equal(t.next, "cw check list");
  assert.equal(judgeReceipt("rc-ffffffffffffffff", sealReceipt(body()), CODE).code, "receipt-tampered", "a file under another id is not that receipt");

  const failed = judgeReceipt(r.id, r, CODE);
  assert.equal(failed.code, "receipt-failed");
  assert.equal(failed.reason, `receipt ${r.id} shows the check failed (exit 1 at aaaaaaa)`);
  assert.equal(failed.next, "cw check -- npm test");

  const killed = sealReceipt(body({ exitCode: null, signal: "SIGTERM" }));
  assert.equal(judgeReceipt(killed.id, killed, CODE).code, "receipt-failed", "a killed command never passes");

  const nogit = sealReceipt(body({ gitHead: null, treeDigest: null }));
  const ng = judgeReceipt(nogit.id, nogit, { gitHead: null, treeDigest: null });
  assert.equal(ng.code, "receipt-no-git", "no git is refused even when the run has no git either");
  assert.match(ng.next, /^git add -A && git commit -m "save work" && cw check -- npm test$/);

  const ok = sealReceipt(body());
  const moved = judgeReceipt(ok.id, ok, { gitHead: "c".repeat(40), treeDigest: TREE });
  assert.equal(moved.code, "receipt-stale");
  assert.match(moved.reason, /the code changed since receipt .* \(it ran at aaaaaaa, now ccccccc\)/);
  const edited = judgeReceipt(ok.id, ok, { gitHead: HEAD, treeDigest: `sha256:${"d".repeat(64)}` });
  assert.equal(edited.code, "receipt-stale", "uncommitted edits make it stale too");
  assert.match(edited.reason, /files changed since/);
}

// Signature: signed when a key is given; with a public key set, an unsigned
// or wrongly-signed receipt is refused.
{
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const priv = privateKey.export({ type: "pkcs8", format: "pem" });
  const pub = publicKey.export({ type: "spki", format: "pem" });
  const other = crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
  const plain = sealReceipt(body());
  const signed = signReceipt(plain, priv);
  assert.equal(signed.id, plain.id, "the signature is not part of the id");
  assert.equal(receiptSignatureValid(signed, pub), true);
  assert.equal(receiptSignatureValid(signed, other), false);
  assert.equal(judgeReceipt(signed.id, signed, CODE, pub).ok, true);
  assert.equal(judgeReceipt(plain.id, plain, CODE, pub).code, "receipt-unsigned");
  assert.equal(judgeReceipt(signed.id, signed, CODE, other).code, "receipt-unsigned");
  assert.equal(judgeReceipt(plain.id, plain, CODE).ok, true, "no key set: unsigned is fine");
}

// The next command can be pasted into a POSIX shell.
{
  assert.equal(shellWord("npm"), "npm");
  assert.equal(shellWord("a b"), "'a b'");
  assert.equal(shellWord("it's"), `'it'\\''s'`);
  assert.equal(checkCommandLine(["node", "-e", "process.exit(1)"]), "cw check -- node -e 'process.exit(1)'");
  assert.equal(receiptOutcome(sealReceipt(body({ dirty: true }))), "exit 0 at aaaaaaa + changes");
}

console.log("receipt-judge: ok");
