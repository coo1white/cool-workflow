"use strict";
// runregistryio-queue-entries-shape — queue.json with good JSON but a bad
// SHAPE must fail closed, like bad bytes do.
//
// queue.json is durable state under the fail-closed rule (conformance:
// sched-corrupt-fail-closed.case.js). Bad bytes already threw, but a file
// whose `entries` was not an array read as an EMPTY queue — and the next
// queueAdd, under the lock, wrote a fresh file over the broken one. This
// pins the fix: every bad shape throws, and the broken bytes stay put.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { RunRegistry } = require(path.join(pluginRoot, "dist/shell/run-registry-io.js"));

function freshRegistry(work) {
  const home = path.join(work, "home");
  fs.mkdirSync(path.join(home, "registry"), { recursive: true });
  const registry = new RunRegistry(work, undefined, { CW_HOME: home });
  return { registry, queuePath: path.join(home, "registry", "queue.json") };
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-queue-shape-"));
try {
  // Absent file still reads as an empty queue (absent is not corrupt).
  {
    const { registry } = freshRegistry(path.join(work, "absent"));
    assert.deepEqual(registry.loadQueueEntries(), [], "absent queue.json is an empty queue");
  }

  // Every bad shape throws and names the file; the bytes stay untouched.
  const badShapes = [
    ["object entries", '{"schemaVersion":1,"entries":{}}', /expected "entries" to be an array, got object/],
    ["null entries", '{"schemaVersion":1,"entries":null}', /expected "entries" to be an array, got null/],
    ["missing entries", '{"schemaVersion":1}', /expected "entries" to be an array, got undefined/],
    ["string entries", '{"schemaVersion":1,"entries":"x"}', /expected "entries" to be an array, got string/],
    ["top-level array", "[]", /expected a JSON object, got array/],
    ["top-level null", "null", /expected a JSON object, got null/],
    ["top-level string", '"queue"', /expected a JSON object, got string/],
  ];
  let n = 0;
  for (const [name, bytes, re] of badShapes) {
    const { registry, queuePath } = freshRegistry(path.join(work, `bad-${n++}`));
    fs.writeFileSync(queuePath, bytes, "utf8");
    assert.throws(
      () => registry.loadQueueEntries(),
      (e) => /Corrupt queue /.test(e.message) && re.test(e.message) && e.message.includes(queuePath),
      `${name} must fail closed and name the file`
    );
    // The write path goes through the same loader — queueAdd must refuse
    // too, and must NOT write over the broken bytes.
    assert.throws(() => registry.queueAdd({ appId: "demo" }), /Corrupt queue /, `${name}: queueAdd must refuse`);
    assert.equal(fs.readFileSync(queuePath, "utf8"), bytes, `${name}: broken bytes stay put`);
  }

  // A well-shaped file still round-trips.
  {
    const { registry } = freshRegistry(path.join(work, "good"));
    const added = registry.queueAdd({ appId: "demo" });
    const listed = registry.loadQueueEntries();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, added.id);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

process.stdout.write("runregistryio-queue-entries-shape: PASS\n");
