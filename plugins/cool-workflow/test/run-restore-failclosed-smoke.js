"use strict";
// run-restore-failclosed-smoke: `cw run restore <archive>` must do an ATOMIC,
// fail-closed restore — integrity-INSPECT the bundle first, IMPORT it, then
// VERIFY the imported run — and refuse (exit 1, no fabricated success) anything
// that does not verify. This closes the gap that `run import` skips verification,
// so a user could silently import a tampered run.
//
// Asserted:
//   (a) HAPPY: export a real run -> `run restore <archive> --target DIR` exits 0,
//       prints JSON with ok:true + inspect/verify true + the imported run, and the
//       run is now present in the target's repo registry (`run list --scope repo`).
//   (b) FAIL-CLOSED on tamper: corrupt the archive bytes -> `run restore` exits
//       NON-ZERO, refuses on integrity, and leaves the run NOT imported (no
//       fabricated success, nothing partial on disk).
//   (c) The existing `run import` STILL works unchanged (restore is additive).

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const cli = path.join(__dirname, "..", "dist", "cli.js");
const node = process.execPath;

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function freshDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cw-restore-${tag}-`));
}
// Each CLI spawn gets its OWN isolated CW_HOME + tmp so the test never touches the
// real home registry and runs leave no global trace (POLA: hermetic test).
function isolatedEnv() {
  const home = freshDir("home");
  const tmp = freshDir("tmp");
  return { ...process.env, CW_HOME: home, TMPDIR: tmp };
}

// Build one real run and export a canonical archive once; cases mutate a copy.
const src = freshDir("src");
const baseEnv = isolatedEnv();
const runId = JSON.parse(
  execFileSync(node, [cli, "plan", "architecture-review", "--repo", src, "--question", "restore fail-closed"], {
    cwd: src,
    encoding: "utf8",
    env: baseEnv
  })
).runId;
const exported = JSON.parse(
  execFileSync(node, [cli, "run", "export", runId, "--json"], { cwd: src, encoding: "utf8", env: baseEnv })
);
const goodArchive = exported.path || exported.archivePath;
const goodJson = fs.readFileSync(goodArchive, "utf8");

// Pick a NON-EMPTY file to tamper (flipping a zero-length buffer is a no-op).
const targetIdx = JSON.parse(goodJson).files.findIndex((f) => f.sizeBytes > 0);
assert.ok(targetIdx >= 0, "archive carries at least one non-empty file to tamper");

// --- (a) HAPPY: restore a clean archive end-to-end ------------------------------
{
  const target = freshDir("ok");
  const env = isolatedEnv();
  const r = spawnSync(node, [cli, "run", "restore", goodArchive, "--target", target, "--json"], {
    encoding: "utf8",
    env
  });
  assert.equal(r.status, 0, `happy: restore exits 0 (stderr: ${r.stderr})`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true, "happy: result.ok true");
  // Integrity inspect ran and passed BEFORE importing.
  assert.ok(out.inspect && out.inspect.ok === true, "happy: inspect.ok true (integrity proven)");
  // The run was imported into the target.
  assert.ok(out.imported && out.imported.run && out.imported.run.id === runId, "happy: imported run id matches");
  // Post-import verification ran and passed.
  assert.ok(out.verify && out.verify.ok === true, "happy: verify.ok true (imported run verified)");

  // The run is actually present in the target's repo registry now.
  const restored = path.join(target, ".cw", "runs", runId);
  assert.ok(fs.existsSync(restored), "happy: run dir restored under target");
  const list = JSON.parse(
    execFileSync(node, [cli, "run", "list", "--cwd", target, "--scope", "repo", "--json"], {
      encoding: "utf8",
      env
    })
  );
  const ids = (list.records || []).map((e) => e.runId || e.id);
  assert.ok(ids.includes(runId), `happy: target registry lists the restored run (saw ${JSON.stringify(ids)})`);
}

// --- (b) FAIL-CLOSED: a digest-tampered archive is refused ----------------------
{
  const a = JSON.parse(goodJson);
  const bytes = Buffer.from(a.files[targetIdx].contentBase64, "base64");
  bytes[0] = bytes[0] ^ 0xff; // same length -> size check passes, digest fails
  a.files[targetIdx].contentBase64 = bytes.toString("base64");
  const tamperedDir = freshDir("t-digest");
  const tampered = path.join(tamperedDir, "tampered.cwrun.json");
  fs.writeFileSync(tampered, JSON.stringify(a));

  const target = freshDir("bad");
  const env = isolatedEnv();
  const r = spawnSync(node, [cli, "run", "restore", tampered, "--target", target, "--json"], {
    encoding: "utf8",
    env
  });
  // Fail-closed: non-zero exit, NO fabricated success.
  assert.notEqual(r.status, 0, "tamper: restore exits non-zero (refused)");
  // The refusal is visible: either a JSON result with ok:false naming the integrity
  // failure, OR a cw: stderr diagnostic. Accept either, but require ok!=true.
  const combined = `${r.stdout}\n${r.stderr}`;
  assert.match(combined, /digest|integrity|inspect|refus/i, "tamper: output makes the integrity refusal clear");
  if (r.stdout.trim()) {
    const out = JSON.parse(r.stdout);
    assert.notEqual(out.ok, true, "tamper: result.ok is not true");
    assert.ok(!out.inspect || out.inspect.ok === false, "tamper: inspect reports failure");
  }
  // NO partial restore: the run must NOT be left imported in the target.
  const restored = path.join(target, ".cw", "runs", runId);
  assert.ok(
    !fs.existsSync(restored) || fs.readdirSync(restored).length === 0,
    "tamper: nothing partial left on disk (no fabricated success)"
  );
  // And the target's repo registry must not list it.
  const list = JSON.parse(
    execFileSync(node, [cli, "run", "list", "--cwd", target, "--scope", "repo", "--json"], {
      encoding: "utf8",
      env
    })
  );
  const ids = (list.records || []).map((e) => e.runId || e.id);
  assert.ok(!ids.includes(runId), "tamper: target registry does NOT list the refused run");
}

// --- (c) `run import` still works unchanged (restore is additive) ---------------
{
  const target = freshDir("import");
  const env = isolatedEnv();
  const r = spawnSync(node, [cli, "run", "import", goodArchive, "--target", target, "--json"], {
    encoding: "utf8",
    env
  });
  assert.equal(r.status, 0, `import-unchanged: clean import exits 0 (stderr: ${r.stderr})`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verification.ok, true, "import-unchanged: import verifies restored files");
  assert.ok(fs.existsSync(path.join(target, ".cw", "runs", runId)), "import-unchanged: run dir restored");
}

process.stdout.write("run-restore-failclosed-smoke: ok (happy restore verified, tamper refused fail-closed, import unchanged)\n");
