#!/usr/bin/env node
"use strict";

// Sandbox profile resolution fails closed, never a quiet fallback to
// "default": an unknown bundled id, a missing custom-profile file, and a
// custom profile whose id collides with a bundled name all refuse with
// the exact SandboxProfileError codes/messages the spec calls out as a
// rebuild risk.

const fs = require("node:fs");
const path = require("node:path");
const { run, freshDir, caseMain, assert } = require("../lib");

caseMain(() => {
  const cwd = freshDir("cwd");

  // 1) Unknown bundled id — never falls back to "default".
  const badId = run(["sandbox", "show", "nosuchprofile"], { cwd });
  assert.equal(badId.status, 1);
  assert.equal(badId.stdout, "");
  assert.equal(badId.stderr, "cw: Sandbox profile not found: nosuchprofile\n");

  // 2) A validate target that does not exist on disk.
  const missing = run(["sandbox", "validate", "nosuchfile.json"], { cwd });
  assert.equal(missing.status, 1);
  const missingPayload = JSON.parse(missing.stdout);
  assert.equal(missingPayload.valid, false);
  assert.equal(missingPayload.issues.length, 1);
  assert.equal(missingPayload.issues[0].code, "sandbox-profile-invalid");
  assert.match(missingPayload.issues[0].message, /^Profile file does not exist: /);

  // 3) A custom profile FILE whose id reuses a bundled name is invalid —
  // the reserved-name check, called out explicitly as a rebuild risk.
  const reservedProfilePath = path.join(cwd, "custom-profile.json");
  fs.writeFileSync(
    reservedProfilePath,
    JSON.stringify({
      schemaVersion: 1,
      id: "readonly",
      title: "x",
      readPaths: [],
      writePaths: [],
      execute: { mode: "none" },
      network: { mode: "none" },
      env: { inherit: false },
    })
  );
  const reserved = run(["sandbox", "validate", "custom-profile.json"], { cwd });
  assert.equal(reserved.status, 1);
  const reservedPayload = JSON.parse(reserved.stdout);
  assert.equal(reservedPayload.valid, false);
  assert.equal(reservedPayload.issues.length, 1);
  assert.equal(reservedPayload.issues[0].code, "sandbox-profile-invalid");
  assert.equal(
    reservedPayload.issues[0].message,
    'Custom sandbox profile id "readonly" is reserved (collides with a bundled profile); choose a different id'
  );

  // 4) A well-formed custom profile with its OWN id validates clean.
  const okProfilePath = path.join(cwd, "ok-profile.json");
  fs.writeFileSync(
    okProfilePath,
    JSON.stringify({
      schemaVersion: 1,
      id: "my-custom-profile",
      title: "My Custom Profile",
      readPaths: [],
      writePaths: [],
      execute: { mode: "none" },
      network: { mode: "none" },
      env: { inherit: false },
    })
  );
  const ok = run(["sandbox", "validate", "ok-profile.json"], { cwd });
  assert.equal(ok.status, 0);
  const okPayload = JSON.parse(ok.stdout);
  assert.equal(okPayload.valid, true);
  assert.deepEqual(okPayload.issues, []);
});
