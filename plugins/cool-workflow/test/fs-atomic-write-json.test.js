#!/usr/bin/env node
// fs-atomic-write-json (milestone 0) — pins writeJson's exact byte format
// (JSON.stringify(value, null, 2) + "\n"), its atomic temp-then-rename
// behavior, and torn-write safety. Per project/docs/rebuild/PLAN.md byte-compat item 1.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { writeJson, readJson, durableAppendFileSync } = require("../dist/shell/fs-atomic");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-v2-fs-atomic-"));

// --- Exact byte format: 2-space indent, ONE trailing newline, no exceptions.
{
  const file = path.join(tmp, "bytes.json");
  const value = { schemaVersion: 1, id: "demo-run", nested: { a: 1, b: [1, 2, 3] } };
  writeJson(file, value);
  const bytes = fs.readFileSync(file, "utf8");
  const expected = `${JSON.stringify(value, null, 2)}\n`;
  assert.equal(bytes, expected, "writeJson must produce JSON.stringify(value, null, 2) + exactly one trailing newline");
  assert.ok(bytes.endsWith("}\n"), "file must end with a closing brace then exactly one newline");
  assert.ok(!bytes.endsWith("}\n\n"), "file must not have two trailing newlines");
}

// --- Round-trips through readJson.
{
  const file = path.join(tmp, "roundtrip.json");
  const value = { schemaVersion: 1, value: "first" };
  writeJson(file, value, { durable: true });
  assert.deepEqual(readJson(file), value, "durable write round-trips through readJson");
}

// --- Creates missing parent directories.
{
  const file = path.join(tmp, "nested", "deep", "state.json");
  writeJson(file, { ok: true });
  assert.ok(fs.existsSync(file), "writeJson must mkdir -p the parent directory");
}

// --- Atomicity: many sequential overwrites are always complete, valid JSON;
// no leftover temp files after a clean write.
{
  const file = path.join(tmp, "rewrites.json");
  for (let i = 0; i < 25; i++) {
    writeJson(file, { schemaVersion: 1, value: i });
    assert.equal(readJson(file).value, i, `rewrite ${i} is complete and valid`);
  }
  const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.includes(".tmp."));
  assert.equal(leftovers.length, 0, "no temp files leak after a clean write");
}

// --- Per-process write counter: two writes to the same file in one process
// never share a temp name (each call bumps the counter).
{
  const file = path.join(tmp, "counter-check.json");
  writeJson(file, { n: 1 });
  writeJson(file, { n: 2 });
  assert.equal(readJson(file).n, 2, "sequential writes to the same file both succeed with distinct temp names");
}

// --- readJson error strings, byte-exact.
{
  const missing = path.join(tmp, "does-not-exist.json");
  assert.throws(
    () => readJson(missing),
    (err) => err.message === `File not found: ${missing}`,
    "readJson must throw the exact 'File not found: <file>' message"
  );

  const badJson = path.join(tmp, "bad.json");
  fs.writeFileSync(badJson, "{ not json", "utf8");
  assert.throws(
    () => readJson(badJson),
    (err) => err.message.startsWith(`Invalid JSON in ${badJson}: `),
    "readJson must throw the exact 'Invalid JSON in <file>: <msg>' prefix"
  );
}

// --- Torn write leaves the PRIOR bytes intact: force the rename to fail by
// making the rename target a directory.
{
  const file = path.join(tmp, "torn.json");
  writeJson(file, { keep: "original" });
  fs.rmSync(file);
  fs.mkdirSync(file); // renaming a temp file over a directory fails
  let threw = false;
  try {
    writeJson(file, { keep: "torn-attempt" });
  } catch {
    threw = true;
  }
  assert.ok(threw, "a write that cannot atomically replace the target must throw");
  const siblings = fs.readdirSync(tmp).filter((f) => f.startsWith("torn.json.tmp."));
  assert.equal(siblings.length, 0, "a failed write must clean up its temp file (no torn artifact left behind)");
}

// --- durableAppendFileSync: appends bytes, creates the parent dir, fsyncs.
{
  const file = path.join(tmp, "audit", "events.jsonl");
  durableAppendFileSync(file, '{"a":1}\n');
  durableAppendFileSync(file, '{"a":2}\n');
  const contents = fs.readFileSync(file, "utf8");
  assert.equal(contents, '{"a":1}\n{"a":2}\n', "durableAppendFileSync must append, never rewrite prior lines");
}

process.stdout.write("fs-atomic-write-json: ok\n");
