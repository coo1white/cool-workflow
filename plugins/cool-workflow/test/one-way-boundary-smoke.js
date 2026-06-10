#!/usr/bin/env node
"use strict";

// one-way-boundary-smoke (Track 3) — the red line is welded into the TYPE layer,
// not just asserted over source text. Proves, by actually invoking the repo's own
// tsc on fixtures:
//   1. NEGATIVE: a type carrying a callable (a model client, a callback) does NOT
//      satisfy the boundary (AssertTrue<IsOneWayData<...>> fails to compile) —
//      sneaking a callable across the executor boundary has no entry point;
//   2. NEGATIVE (realistic): the REAL ExecutionResultEnvelope intersected with a
//      live-client field fails the same way — the violation is caught even when
//      smuggled inside the canonical envelope type;
//   3. POSITIVE control: a conforming plain-data shape compiles clean with the
//      SAME harness (so the negative failures are the constraint, not a broken
//      fixture setup);
//   4. The welds exist in source: boundary.ts asserts ExecutionResultEnvelope,
//      ResultEnvelope and UsageRecord, and the barrel exports the module — so
//      deleting the welds (which tsc cannot notice) is caught here.
//
// Portable: node + the repo's own typescript devDependency. No new dependency.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const tscJs = path.join(pluginRoot, "node_modules", "typescript", "lib", "tsc.js");
assert.ok(fs.existsSync(tscJs), "repo typescript devDependency present");

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-boundary-fixture-"));
// The fixture imports boundary.ts by ABSOLUTE path so it can live in a tmpdir
// (no repo-tree pollution, no cwd assumption).
const boundaryImport = path.join(pluginRoot, "src", "types", "boundary").split(path.sep).join("/");
const envelopeImport = path.join(pluginRoot, "src", "types", "execution-backend").split(path.sep).join("/");

function compile(name, source) {
  const file = path.join(fixtureDir, name);
  fs.writeFileSync(file, source, "utf8");
  const child = spawnSync(
    process.execPath,
    [tscJs, "--noEmit", "--strict", "--target", "es2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", file],
    { encoding: "utf8", timeout: 120000 }
  );
  return { status: child.status, out: `${child.stdout || ""}${child.stderr || ""}` };
}

function main() {
  // ---- 1. a bare callable does not cross ------------------------------------
  {
    const r = compile(
      "violating-callable.ts",
      `import type { AssertTrue, IsOneWayData } from "${boundaryImport}";\n` +
        `type SneakedClient = { schemaVersion: 1; complete: (prompt: string) => Promise<string> };\n` +
        `export type Refused = AssertTrue<IsOneWayData<SneakedClient>>;\n`
    );
    assert.notEqual(r.status, 0, "a callable-bearing type must NOT compile across the boundary");
    assert.match(r.out, /does not satisfy the constraint/, "failure is the boundary constraint, not an unrelated error");
    console.log("one-way-boundary: bare callable refused at compile time ok");
  }

  // ---- 2. the REAL envelope smuggling a live client fails too ---------------
  {
    const r = compile(
      "violating-envelope.ts",
      `import type { AssertTrue, IsOneWayData } from "${boundaryImport}";\n` +
        `import type { ExecutionResultEnvelope } from "${envelopeImport}";\n` +
        `type Smuggled = ExecutionResultEnvelope & { modelClient: { send: (m: string) => unknown } };\n` +
        `export type Refused = AssertTrue<IsOneWayData<Smuggled>>;\n`
    );
    assert.notEqual(r.status, 0, "the canonical envelope + a smuggled client must NOT compile");
    assert.match(r.out, /does not satisfy the constraint/, "failure is the boundary constraint");
    console.log("one-way-boundary: smuggled client inside the real envelope refused ok");
  }

  // ---- 3. positive control: plain data compiles with the SAME harness -------
  {
    const r = compile(
      "conforming.ts",
      `import type { AssertTrue, IsOneWayData } from "${boundaryImport}";\n` +
        `import type { ExecutionResultEnvelope } from "${envelopeImport}";\n` +
        `type PlainData = { schemaVersion: 1; summary: string; counts: number[]; nested: { ok: boolean; meta?: Record<string, unknown> } };\n` +
        `export type Accepted = AssertTrue<IsOneWayData<PlainData>>;\n` +
        `export type EnvelopeStillData = AssertTrue<IsOneWayData<ExecutionResultEnvelope>>;\n`
    );
    assert.equal(r.status, 0, `conforming fixture must compile clean; got:\n${r.out}`);
    console.log("one-way-boundary: conforming data + real envelope compile clean ok");
  }

  // ---- 4. the welds stay present in source ----------------------------------
  {
    const boundarySrc = fs.readFileSync(path.join(pluginRoot, "src", "types", "boundary.ts"), "utf8");
    for (const weld of [
      "AssertTrue<IsOneWayData<ExecutionResultEnvelope>>",
      "AssertTrue<IsOneWayData<ResultEnvelope>>",
      "AssertTrue<IsOneWayData<UsageRecord>>"
    ]) {
      assert.ok(boundarySrc.includes(weld), `boundary weld present: ${weld}`);
    }
    const barrel = fs.readFileSync(path.join(pluginRoot, "src", "types.ts"), "utf8");
    assert.ok(barrel.includes('export * from "./types/boundary"'), "barrel exports the boundary module");
    console.log("one-way-boundary: welds present in source ok");
  }

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log("one-way-boundary-smoke: ok (callables refused at compile time; plain data passes; welds present)");
}

main();
