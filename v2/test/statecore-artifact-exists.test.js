#!/usr/bin/env node
// statecore-artifact-exists (milestone 3) — pins artifactExists:
// Boolean(artifact.path && exists(artifact.path)), with the existence
// check itself supplied by the caller (pure, no fs import in core/).
// SPEC/state-core.md "artifactExists(artifact) — Boolean(artifact.path &&
// fs.existsSync(artifact.path))".

const assert = require("node:assert/strict");
const { artifactExists } = require("../dist/core/state/state-node");

// A path that "exists" (per the injected checker) returns true.
{
  const artifact = { id: "a1", kind: "file", path: "/real/path.json" };
  assert.equal(artifactExists(artifact, () => true), true);
}

// A path that does not exist (per the injected checker) returns false.
{
  const artifact = { id: "a1", kind: "file", path: "/missing/path.json" };
  assert.equal(artifactExists(artifact, () => false), false);
}

// An artifact with an EMPTY path short-circuits to false WITHOUT calling
// the exists checker at all (Boolean(artifact.path && ...) short circuit).
{
  const artifact = { id: "a1", kind: "file", path: "" };
  let called = false;
  const result = artifactExists(artifact, () => {
    called = true;
    return true;
  });
  assert.equal(result, false, "an empty path must short-circuit to false");
  assert.equal(called, false, "the exists checker must NOT be called for an empty path");
}

// An artifact with an undefined path also short-circuits to false.
{
  const artifact = { id: "a1", kind: "file" };
  assert.equal(artifactExists(artifact, () => true), false);
}

// The checker receives the exact path string.
{
  const artifact = { id: "a1", kind: "file", path: "/exact/path/here.json" };
  let received;
  artifactExists(artifact, (p) => {
    received = p;
    return true;
  });
  assert.equal(received, "/exact/path/here.json");
}

// Result is always a strict boolean (Boolean() coercion), never a truthy
// non-boolean value.
{
  const artifact = { id: "a1", kind: "file", path: "/x" };
  const result = artifactExists(artifact, () => "truthy-string-not-boolean");
  assert.equal(result, true);
  assert.equal(typeof result, "boolean");
}

process.stdout.write("statecore-artifact-exists: ok\n");
