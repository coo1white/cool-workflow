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
//
// The weld module is src/core/types/boundary.ts: OneWayData<T>,
// IsOneWayData<T>, AssertTrue<T extends true>, and the three welds over
// ExecutionResultEnvelope, ResultEnvelope, and UsageRecord
// (src/shell/execution-backend/types.ts).

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
// v2 restored the weld module at src/core/types/boundary.ts (the exact path
// below). Its type imports transitively reach the shell modules that own the
// three target types, and those modules `import "node:crypto"` etc., so the
// fixture must compile WITH node types available. The fixture lives in a
// tmpdir, so tsc cannot walk up to the repo's node_modules/@types on its own —
// point --typeRoots + --types at the repo's @types/node explicitly so a clean
// CI checkout resolves node builtins exactly like the real `npm run build`.
const typesRoot = path.join(pluginRoot, "node_modules", "@types");
const boundaryImport = path.join(pluginRoot, "src", "core", "types", "boundary").split(path.sep).join("/");
// ExecutionResultEnvelope survived the rebuild; repointed to its real v2 home.
// The real declaration lives at core/types/execution-backend.ts now (moved
// out of shell/, since it is plain data with no dependency of its own);
// shell/execution-backend/types.ts is a thin `export type *` re-export, so
// this old import path must keep resolving exactly as before.
const envelopeImport = path.join(pluginRoot, "src", "shell", "execution-backend", "types").split(path.sep).join("/");
const envelopeCoreImport = path.join(pluginRoot, "src", "core", "types", "execution-backend").split(path.sep).join("/");

function compile(name, source) {
  const file = path.join(fixtureDir, name);
  fs.writeFileSync(file, source, "utf8");
  const child = spawnSync(
    process.execPath,
    // TS 7: node10 resolution is gone (use nodenext, same as tsconfig.json),
    // and --ignoreConfig is needed when files are given on the command line
    // with a tsconfig.json present in the cwd (TS5112).
    [tscJs, "--noEmit", "--strict", "--target", "es2022", "--module", "nodenext", "--moduleResolution", "nodenext", "--ignoreConfig", "--skipLibCheck", "--typeRoots", typesRoot, "--types", "node", file],
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

  // ---- 3b. the core/ import path resolves the SAME real type -----------------
  // core/types/boundary.ts itself now imports ExecutionResultEnvelope from
  // this path (not the shell/ one) -- prove a fixture can too, so the move
  // is a genuine equivalence, not just a re-export that happens to work.
  {
    const r = compile(
      "conforming-core-path.ts",
      `import type { AssertTrue, IsOneWayData } from "${boundaryImport}";\n` +
        `import type { ExecutionResultEnvelope } from "${envelopeCoreImport}";\n` +
        `export type EnvelopeStillDataViaCore = AssertTrue<IsOneWayData<ExecutionResultEnvelope>>;\n`
    );
    assert.equal(r.status, 0, `conforming fixture via the core/ import path must compile clean; got:\n${r.out}`);
    console.log("one-way-boundary: core/types/execution-backend import path compiles clean ok");
  }

  // ---- 3c. the shell/ path is now a thin re-export shim -----------------------
  // ExecutionResultEnvelope/ResultEnvelope/UsageRecord's real declarations
  // moved to core/ (plain data, no dependency of their own); shell/ keeps
  // the old import paths working via `export type *` / `export type { X }`
  // so this is invisible to every existing importer.
  {
    const shellEnvelopeSrc = fs.readFileSync(path.join(pluginRoot, "src", "shell", "execution-backend", "types.ts"), "utf8");
    assert.ok(shellEnvelopeSrc.includes('export type * from "../../core/types/execution-backend"'), "shell/execution-backend/types.ts must be a type-only re-export of the core/ module");
    assert.ok(!shellEnvelopeSrc.includes("export interface ResultEnvelope"), "the real declaration must not still live in shell/");

    const coreEnvelopeSrc = fs.readFileSync(path.join(pluginRoot, "src", "core", "types", "execution-backend.ts"), "utf8");
    assert.ok(coreEnvelopeSrc.includes("export interface ExecutionResultEnvelope"), "the real ExecutionResultEnvelope declaration must live in core/");
    assert.ok(coreEnvelopeSrc.includes("export interface ResultEnvelope"), "the real ResultEnvelope declaration must live in core/");

    const coreObservabilitySrc = fs.readFileSync(path.join(pluginRoot, "src", "core", "types", "observability.ts"), "utf8");
    assert.ok(coreObservabilitySrc.includes("export interface UsageRecord"), "the real UsageRecord declaration must live in core/");

    const shellObservabilitySrc = fs.readFileSync(path.join(pluginRoot, "src", "shell", "observability.ts"), "utf8");
    assert.ok(!shellObservabilitySrc.includes("export interface UsageRecord"), "the real UsageRecord declaration must not still live in shell/observability.ts");
    console.log("one-way-boundary: shell/ paths are thin re-export shims, real declarations live in core/ ok");
  }

  // ---- 4. the welds stay present in source ----------------------------------
  // v2 has no boundary weld module and no top-level types barrel, so
  // both reads below fail (ENOENT) — that IS the NO-EQUIVALENT gap. Kept as the
  // real v2 paths so a Phase-B fix (re-adding the weld) turns this green.
  {
    const boundarySrc = fs.readFileSync(path.join(pluginRoot, "src", "core", "types", "boundary.ts"), "utf8");
    for (const weld of [
      "AssertTrue<IsOneWayData<ExecutionResultEnvelope>>",
      "AssertTrue<IsOneWayData<ResultEnvelope>>",
      "AssertTrue<IsOneWayData<UsageRecord>>"
    ]) {
      assert.ok(boundarySrc.includes(weld), `boundary weld present: ${weld}`);
    }
    const barrel = fs.readFileSync(path.join(pluginRoot, "src", "core", "types.ts"), "utf8");
    assert.ok(barrel.includes('export * from "./types/boundary"'), "barrel exports the boundary module");
    console.log("one-way-boundary: welds present in source ok");
  }

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log("one-way-boundary-smoke: ok (callables refused at compile time; plain data passes; welds present)");
}

main();
