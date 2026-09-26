#!/usr/bin/env node
// run-state-serializer — state-parts program, PR 1
// (project/docs/intent/2026-09-26-state-parts.md). saveCheckpoint writes state.json
// from parts, reusing each array element's JSON text while the element is
// provably unchanged. The bytes must equal `JSON.stringify(run, null, 2)`
// plus a newline after ANY edit, in place or not, and a short writev must
// never lose or reorder a byte.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { serializeRunState, saveCheckpoint, createRun } = require("../../dist/shell/run-store");
const { writePartsDurable } = require("../../dist/shell/fs-atomic");

function same(run, label) {
  const got = serializeRunState(run);
  const want = JSON.stringify(run, null, 2);
  if (got !== want) {
    let i = 0;
    while (got[i] === want[i]) i++;
    assert.fail(`${label}: differs at ${i}: ${JSON.stringify(got.slice(i - 30, i + 30))} vs ${JSON.stringify(want.slice(i - 30, i + 30))}`);
  }
}

// 1. Every fixture run state, saved twice, then after each kind of edit to an
//    element that was already serialized (so its text is kept).
const fixturesDir = path.resolve(__dirname, "..", "fixtures", "runs");
let fixtures = 0;
for (const name of fs.readdirSync(fixturesDir)) {
  const file = path.join(fixturesDir, name, "state.json");
  if (!fs.existsSync(file)) continue;
  fixtures++;
  const run = JSON.parse(fs.readFileSync(file, "utf8"));
  same(run, `${name} first`);
  same(run, `${name} again`);
  for (const key of Object.keys(run)) {
    const items = run[key];
    if (!Array.isArray(items) || !items.length || typeof items[0] !== "object") continue;
    const el = items[0];
    const at = `${name} ${key}`;
    el.__x = { deep: { v: 1 } };
    same(run, `${at} key added`);
    el.__x.deep.v = 2;
    same(run, `${at} nested value edited in place`);
    el.__x.deep.list = [1, 2];
    el.__x.deep.list.push(3);
    same(run, `${at} nested array grown in place`);
    delete el.__x;
    same(run, `${at} key deleted`);
    el.__u = undefined;
    same(run, `${at} undefined value`);
    el.__d = new Date(0);
    same(run, `${at} Date`);
    el.__d.setTime(5);
    same(run, `${at} Date changed in place`);
    delete el.__d;
    delete el.__u;
    el.__n = NaN;
    same(run, `${at} NaN`);
    delete el.__n;
    items.push(el);
    same(run, `${at} same object twice`);
    el.__s = "shared";
    same(run, `${at} shared object edited`);
    items.pop();
    delete el.__s;
    items.push(JSON.parse(JSON.stringify(el)));
    same(run, `${at} array grown`);
    items.pop();
    same(run, `${at} array shrunk`);
    const keys = Object.keys(el);
    if (keys.length > 1) {
      const first = el[keys[0]];
      delete el[keys[0]];
      el[keys[0]] = first;
      same(run, `${at} key order changed`);
    }
  }
  run.__top = [undefined, null, 1, "s", () => 1, [], {}];
  same(run, `${name} odd top-level array`);
  run.__top = [];
  same(run, `${name} empty top-level array`);
  run.__top = undefined;
  same(run, `${name} undefined top-level value`);
  delete run.__top;
}
assert.ok(fixtures >= 3, "enough fixture run states");
same({}, "empty run");
same({ a: [[1, [2]], { b: [] }] }, "nested arrays");

// 2. saveCheckpoint's file is exactly JSON.stringify + "\n", save after save.
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-state-serializer-"));
  try {
    const run = createRun(path.join(work, ".cw", "runs", "ser-run"), "ser-run", "ser-probe", work);
    for (let i = 0; i < 4; i++) {
      run.nodes.push({ id: `n${i}`, metadata: { step: i, list: [i] } });
      if (i > 1) run.nodes[0].metadata.list.push(i);
      saveCheckpoint(run);
      assert.equal(fs.readFileSync(run.paths.state, "utf8"), `${JSON.stringify(run, null, 2)}\n`, `save ${i} writes the same bytes as JSON.stringify`);
    }

    // 3. The verify switch has teeth: a JSON.stringify that disagrees makes
    //    the save throw.
    const stringify = JSON.stringify;
    process.env.CW_STATE_WRITE_VERIFY = "1";
    JSON.stringify = function (value, ...rest) {
      const text = stringify.call(JSON, value, ...rest);
      return value === run ? `${text} ` : text;
    };
    try {
      assert.throws(() => saveCheckpoint(run), /state serialization differs from JSON\.stringify/);
    } finally {
      JSON.stringify = stringify;
      delete process.env.CW_STATE_WRITE_VERIFY;
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// 4. A short writev (7 bytes at a time) still writes every byte, in order.
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-write-parts-"));
  const writev = fs.writevSync;
  try {
    const parts = ["{\n", "  \"a\": [\n    ", "\"é\"", ",\n    ", "", "12345678901234567890", "\n  ]\n}\n"].map((s) => Buffer.from(s, "utf8"));
    fs.writevSync = function (fd, buffers) {
      const first = Buffer.concat(buffers).subarray(0, 7);
      return writev.call(fs, fd, [first]);
    };
    const file = path.join(work, "state.json");
    writePartsDurable(file, parts, { durable: true });
    fs.writevSync = writev;
    assert.deepEqual(fs.readFileSync(file), Buffer.concat(parts), "every byte written, in order");
  } finally {
    fs.writevSync = writev;
    fs.rmSync(work, { recursive: true, force: true });
  }
}

process.stdout.write("run-state-serializer: ok\n");
