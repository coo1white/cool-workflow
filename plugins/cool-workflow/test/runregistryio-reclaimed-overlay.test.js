#!/usr/bin/env node
// runregistryio-reclaimed-overlay — pins loadReclaimedFromDir's read of a
// run dir's reclaimed.json: absent reads as "never reclaimed" (no corrupted
// mark), a good file goes through, and EVERY bad shape sets corrupted=true
// with an empty tombstone list — the mark reclaimEligibility checks FIRST
// so a broken log can never let a destructive re-reclaim through (the
// fail-closed contract of fix feeb1b15).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadReclaimedFromDir } = require("../dist/shell/run-registry-io");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-reclaimed-lite-"));

function dirWith(name, contents) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  if (contents !== undefined) fs.writeFileSync(path.join(dir, "reclaimed.json"), contents, "utf8");
  return dir;
}

// --- Absent file: never reclaimed. NOT corrupted.
{
  const overlay = loadReclaimedFromDir(dirWith("absent"));
  assert.deepEqual(overlay, { schemaVersion: 1, runId: "", tombstones: [] });
  assert.ok(!("corrupted" in overlay), "an absent file must not carry the corrupted mark");
}

// --- Good file: runId and tombstones go through as-is.
{
  const tombstones = [
    { reclaimedAt: "2026-01-01T00:00:00.000Z", bytesFreed: 10, tombstoneHash: "sha256:aa", capability: "re-runnable", capabilityReason: "scratch-only-reclaimed" },
  ];
  const overlay = loadReclaimedFromDir(
    dirWith("good", JSON.stringify({ schemaVersion: 1, runId: "run-1", tombstones }))
  );
  assert.equal(overlay.corrupted, undefined);
  assert.equal(overlay.runId, "run-1");
  assert.deepEqual(overlay.tombstones, tombstones);
}

// --- Every bad shape: corrupted=true, tombstones []. A truncated write, a
// wrong schemaVersion, a non-list tombstones field, a JSON array, and null
// must all read the same fail-closed way.
{
  const badCases = {
    truncated: '{"schemaVersion":1,"runId":"run-1","tombstones":[{"reclai',
    "not-json": "not json at all",
    "wrong-schema": JSON.stringify({ schemaVersion: 2, runId: "run-1", tombstones: [] }),
    "tombstones-not-a-list": JSON.stringify({ schemaVersion: 1, runId: "run-1", tombstones: {} }),
    "top-level-array": "[]",
    "top-level-null": "null",
    empty: "",
  };
  for (const [name, contents] of Object.entries(badCases)) {
    const overlay = loadReclaimedFromDir(dirWith(`bad-${name}`, contents));
    assert.equal(overlay.corrupted, true, `${name}: must be marked corrupted`);
    assert.deepEqual(overlay.tombstones, [], `${name}: must never invent tombstones`);
    assert.equal(overlay.schemaVersion, 1);
  }
}

process.stdout.write("runregistryio-reclaimed-overlay: ok\n");
