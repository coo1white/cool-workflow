#!/usr/bin/env node
"use strict";

// `cw migration prove` against a real, current run-state file: the four
// proofs all pass, and sourceHash/resultHash/fingerprint are all the
// 64-hex-after-"sha256:" content-digest family (NOT the 32-hex fingerprint
// family used by node snapshots). Also pins the proof-file side effect:
// one JSON file per prove call under <targetDir>/migration/<16-hex>.json.

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

const SHA256_64 = /^sha256:[0-9a-f]{64}$/;

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const r = run(["-q", "What are the risks?"], { cwd: repo, env: stubAgentEnv("a.txt:1") });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  const runDir = path.dirname(payload.statePath);

  const prove = run(["migration", "prove", payload.statePath], { cwd: repo });
  assert.equal(prove.status, 0);
  const proof = JSON.parse(prove.stdout);

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.contract, "run-state");
  assert.equal(proof.validatesAtCurrent, true);
  assert.equal(proof.appendOnly, true);
  assert.equal(proof.idempotent, true);
  assert.equal(proof.sourceImmutable, true);
  assert.equal(proof.pass, true);
  assert.deepEqual(proof.errors, []);
  assert.equal(proof.verdict.status, "current");

  // the 64-hex content-digest family, all three fields
  assert.match(proof.sourceHash, SHA256_64, "sourceHash must be sha256: + 64 hex");
  assert.match(proof.resultHash, SHA256_64, "resultHash must be sha256: + 64 hex");
  assert.match(proof.fingerprint, SHA256_64, "fingerprint must be sha256: + 64 hex");

  // source file is untouched by proving (byte-identical before/after)
  const beforeBytes = fs.readFileSync(payload.statePath, "utf8");
  const prove2 = run(["migration", "prove", payload.statePath], { cwd: repo });
  const afterBytes = fs.readFileSync(payload.statePath, "utf8");
  assert.equal(beforeBytes, afterBytes, "migration prove must never touch the source file");

  // idempotent: proving twice gives the identical hashes
  const proof2 = JSON.parse(prove2.stdout);
  assert.equal(proof2.sourceHash, proof.sourceHash);
  assert.equal(proof2.resultHash, proof.resultHash);
  assert.equal(proof2.fingerprint, proof.fingerprint);

  // the proof file(s) landed under <runDir>/migration/<first-16-hex>.json
  const migrationDir = path.join(runDir, "migration");
  assert.ok(fs.existsSync(migrationDir), "migration/ dir must exist after prove");
  const files = fs.readdirSync(migrationDir);
  assert.ok(files.length >= 1, "at least one proof file");
  for (const f of files) {
    assert.match(f, /^[0-9a-f]{16}\.json$/, `${f} must be named <16 hex>.json`);
    const raw = fs.readFileSync(path.join(migrationDir, f), "utf8");
    assert.ok(raw.endsWith("\n"), `${f} must end with a trailing newline`);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.schemaVersion, 1);
  }
  // the fingerprint's first 16 hex chars (after "sha256:") name the file
  const fpHex = proof.fingerprint.slice("sha256:".length, "sha256:".length + 16);
  assert.ok(files.includes(`${fpHex}.json`), "proof file name must match fingerprint prefix");
});
