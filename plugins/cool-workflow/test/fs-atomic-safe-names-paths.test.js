#!/usr/bin/env node
// fs-atomic-safe-names-paths — pins the small shell/fs-atomic helpers that
// had no unit cover: safeFileName, assertSafeRunId (the untrusted-id gate),
// realResolve/isContainedPath (symlink-safe path checks), logEndsWithNewline
// (torn-tail probe), and writeTextDurable's exact-bytes contract.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  safeFileName,
  assertSafeRunId,
  realResolve,
  isContainedPath,
  logEndsWithNewline,
  writeTextDurable,
} = require("../dist/shell/fs-atomic");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-fs-safe-"));

// --- safeFileName: every run of chars outside [a-zA-Z0-9_.:-] becomes ONE "_".
{
  assert.equal(safeFileName("a b/c"), "a_b_c");
  assert.equal(safeFileName("a  //  b"), "a_b", "a run of bad chars becomes one _, not many");
  assert.equal(safeFileName("keep_.:-09AZaz"), "keep_.:-09AZaz", "safe chars go through unchanged");
  assert.equal(safeFileName(42), "42", "a non-string input goes through String() first");
  assert.equal(safeFileName(""), "", "an empty string stays empty");
}

// --- assertSafeRunId: one safe path segment or a hard stop. This is the
// gate that keeps an id from an imported archive inside the runs directory.
{
  assert.equal(assertSafeRunId("run-1"), "run-1", "a good id is given back");
  assert.equal(assertSafeRunId("v1..2"), "v1..2", "an EMBEDDED .. is a safe name and is let through");
  assert.equal(assertSafeRunId("a.b:c_d-e"), "a.b:c_d-e");

  assert.throws(() => assertSafeRunId(""), /Invalid run id: expected a non-empty string/);
  assert.throws(() => assertSafeRunId(undefined), /Invalid run id: expected a non-empty string/);
  assert.throws(() => assertSafeRunId(42), /Invalid run id: expected a non-empty string/, "a number is not a string id");
  assert.throws(() => assertSafeRunId("a/b"), /Unsafe run id/, "a path separator is refused");
  assert.throws(() => assertSafeRunId("a\\b"), /Unsafe run id/, "a backslash is refused");
  assert.throws(() => assertSafeRunId("."), /Unsafe run id/, "the exact component . is refused");
  assert.throws(() => assertSafeRunId(".."), /Unsafe run id/, "the exact component .. is refused");
  assert.throws(
    () => assertSafeRunId("a/b", "archive id"),
    /Unsafe archive id/,
    "the context name is used in the error text"
  );
}

// --- realResolve: the deepest EXISTING parent is realpath'd (symlinks
// followed), then the not-yet-made tail is joined back on.
{
  const realDir = path.join(tmp, "real-dir");
  fs.mkdirSync(realDir);
  const link = path.join(tmp, "link-dir");
  fs.symlinkSync(realDir, link);
  const realOfDir = fs.realpathSync(realDir);

  assert.equal(realResolve(link), realOfDir, "a symlink resolves to its true directory");
  assert.equal(
    realResolve(path.join(link, "sub", "not-yet.json")),
    path.join(realOfDir, "sub", "not-yet.json"),
    "the tail that does not exist yet is joined onto the true parent"
  );
  const nowhere = path.join(tmp, "no-such", "deep", "file.json");
  assert.equal(
    realResolve(nowhere),
    path.join(fs.realpathSync(tmp), "no-such", "deep", "file.json"),
    "only the existing part is realpath'd; the rest is joined back"
  );
}

// --- isContainedPath: equal or under-with-separator, on REAL paths. The
// name-prefix trap (/tmp/foobar under /tmp/foo) must say false.
{
  const parent = path.join(tmp, "contain");
  fs.mkdirSync(path.join(parent, "child"), { recursive: true });
  assert.equal(isContainedPath(parent, parent), true, "a path contains itself");
  assert.equal(isContainedPath(path.join(parent, "child"), parent), true);
  assert.equal(isContainedPath(path.join(parent, "child", "x.json"), parent), true, "a not-yet-made file under it counts");
  assert.equal(isContainedPath(path.join(tmp, "containZZZ"), parent), false, "a name that only STARTS the same is outside");
  assert.equal(isContainedPath(tmp, parent), false, "the parent of the allowed root is outside");

  // A symlink into the allowed root is inside once realpath'd.
  const alias = path.join(tmp, "contain-alias");
  fs.symlinkSync(parent, alias);
  assert.equal(isContainedPath(path.join(alias, "child"), parent), true, "a symlinked way in is still inside");
}

// --- logEndsWithNewline: O(1) last-byte probe for a torn NDJSON tail.
{
  const good = path.join(tmp, "good.jsonl");
  fs.writeFileSync(good, '{"a":1}\n');
  assert.equal(logEndsWithNewline(good, fs.statSync(good).size), true, "a complete append ends in \\n");

  const torn = path.join(tmp, "torn.jsonl");
  fs.writeFileSync(torn, '{"a":1}\n{"a":2');
  assert.equal(logEndsWithNewline(torn, fs.statSync(torn).size), false, "a torn tail is seen");

  assert.equal(logEndsWithNewline(good, 0), false, "size 0 is not newline-ended");
  assert.equal(logEndsWithNewline(good, -1), false, "a negative size is not newline-ended");
  assert.equal(
    logEndsWithNewline(path.join(tmp, "no-such-log.jsonl"), 5),
    false,
    "a read error answers false (the safe side)"
  );
}

// --- writeTextDurable: the EXACT given bytes land (no added newline), the
// parent directory is made, and a rewrite fully replaces the old bytes.
{
  const file = path.join(tmp, "made", "here", "events.jsonl");
  writeTextDurable(file, "line-1\nline-2", { durable: true });
  assert.equal(fs.readFileSync(file, "utf8"), "line-1\nline-2", "exact bytes, nothing added");
  writeTextDurable(file, "only-this\n");
  assert.equal(fs.readFileSync(file, "utf8"), "only-this\n", "a rewrite replaces the whole file");
  const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.includes(".tmp."));
  assert.equal(leftovers.length, 0, "no temp file is left after a clean write");
}

process.stdout.write("fs-atomic-safe-names-paths: ok\n");
