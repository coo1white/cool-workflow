#!/usr/bin/env node
// migrate-owned-input — migrateRunState's `owned` option (perf-ratchets
// PR 2). Without it the caller's object is never touched (the migration
// works on a deep copy); with it the migration works on the object in place
// and skips the copy. Either way the migrated run and the report are the
// same. loadRunStateFile hands over its fresh parse as owned.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migrateRunState } = require("../../../dist/core/state/migrations");
const { loadRunStateFile } = require("../../../dist/shell/run-store");

const fixturesDir = path.resolve(__dirname, "..", "..", "fixtures", "runs");
const fixtures = fs.readdirSync(fixturesDir).filter((name) => fs.existsSync(path.join(fixturesDir, name, "state.json")));
assert.ok(fixtures.length >= 3, "enough fixture run states to compare");

let sawChanges = false;
for (const name of fixtures) {
  const text = fs.readFileSync(path.join(fixturesDir, name, "state.json"), "utf8");

  const kept = JSON.parse(text);
  const copied = migrateRunState(kept, { dryRun: true });
  assert.deepEqual(kept, JSON.parse(text), `${name}: without owned, the caller's object is untouched`);
  assert.notEqual(copied.run, kept, `${name}: without owned, the run is a copy`);

  const given = JSON.parse(text);
  const inPlace = migrateRunState(given, { dryRun: true, owned: true });
  assert.equal(inPlace.run, given, `${name}: with owned, the run is the object handed over`);

  assert.deepEqual(inPlace.run, copied.run, `${name}: the migrated run is the same either way`);
  assert.deepEqual(inPlace.report, copied.report, `${name}: the report is the same either way`);
  if (copied.report.changes.length > 0) sawChanges = true;
}
assert.ok(sawChanges, "at least one fixture needs a migration or normalization, so the in-place path really mutates");

// An unsupported state takes the same path: the run handed back is the input
// itself when owned, a copy when not, with the same report.
{
  const future = () => ({ schemaVersion: 999, workflow: {}, paths: {} });
  const a = future();
  const b = future();
  const copied = migrateRunState(a);
  const inPlace = migrateRunState(b, { owned: true });
  assert.equal(copied.report.status, "unsupported");
  assert.notEqual(copied.run, a);
  assert.equal(inPlace.run, b);
  assert.deepEqual(inPlace.report, copied.report);
}

// loadRunStateFile: the same result as migrating a parse of the same bytes.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-migrate-owned-"));
  try {
    for (const name of fixtures) {
      const file = path.join(tmp, `${name}.json`);
      const text = fs.readFileSync(path.join(fixturesDir, name, "state.json"), "utf8");
      fs.writeFileSync(file, text);
      const loaded = loadRunStateFile(file);
      const expected = migrateRunState(JSON.parse(text), { statePath: file, dryRun: true });
      assert.deepEqual(loaded.run, expected.run, `${name}: loadRunStateFile run`);
      assert.deepEqual(loaded.report, expected.report, `${name}: loadRunStateFile report`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

process.stdout.write("migrate-owned-input: ok\n");
