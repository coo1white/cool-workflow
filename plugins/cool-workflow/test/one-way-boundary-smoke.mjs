#!/usr/bin/env node
// one-way-boundary-smoke (Track 3) — the red line is welded into the TYPE layer,
// not just asserted over source text. Proves, by actually invoking the repo's own
// tsc on fixtures:
//   1. NEGATIVE: a type carrying a callable (a model client, a callback) does NOT
//      satisfy the boundary (AssertTrue<IsOneWayData<...>> fails to compile) —
//      sneaking a callable across the executor boundary has no entry point;
//   2. NEGATIVE (realistic): the REAL AgentOutcome intersected with a
//      live-client field fails the same way — the violation is caught even when
//      smuggled inside a real boundary type;
//   3. POSITIVE control: a conforming plain-data shape, and the real
//      AgentOutcome, AgentReport and ResultEnvelope, compile clean with the
//      SAME harness (so the negative failures are the constraint, not a broken
//      fixture setup);
//   4. The welds exist in source next to the types they guard — so deleting
//      a weld (which tsc cannot notice) is caught here.
//
// Portable: node + the repo's own typescript devDependency. No new dependency.
// The weld module is src/core/types/boundary.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const tscJs = path.join(pluginRoot, "node_modules", "typescript", "lib", "tsc.js");
assert.ok(fs.existsSync(tscJs), "repo typescript devDependency present");

const fixtureDir = tmpDir("cw-boundary-fixture-");
// The fixture imports by ABSOLUTE path so it can live in a tmpdir. The agent
// module imports node builtins, so point --typeRoots + --types at the repo's
// @types/node: tsc cannot walk up to it from a tmpdir.
const typesRoot = path.join(pluginRoot, "node_modules", "@types");
const srcImport = (...parts) => path.join(pluginRoot, "src", ...parts).split(path.sep).join("/");
const boundaryImport = srcImport("core", "types", "boundary");
const agentImport = srcImport("shell", "execution-backend", "agent");
const resultImport = srcImport("core", "pipeline", "result-normalize");

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

  // ---- 2. the REAL agent outcome smuggling a live client fails too -----------
  {
    const r = compile(
      "violating-outcome.ts",
      `import type { AssertTrue, IsOneWayData } from "${boundaryImport}";\n` +
        `import type { AgentOutcome } from "${agentImport}";\n` +
        `type Smuggled = AgentOutcome & { modelClient: { send: (m: string) => unknown } };\n` +
        `export type Refused = AssertTrue<IsOneWayData<Smuggled>>;\n`
    );
    assert.notEqual(r.status, 0, "the real agent outcome + a smuggled client must NOT compile");
    assert.match(r.out, /does not satisfy the constraint/, "failure is the boundary constraint");
    console.log("one-way-boundary: smuggled client inside the real agent outcome refused ok");
  }

  // ---- 3. positive control: plain data compiles with the SAME harness -------
  {
    const r = compile(
      "conforming.ts",
      `import type { AssertTrue, IsOneWayData } from "${boundaryImport}";\n` +
        `import type { AgentOutcome, AgentReport } from "${agentImport}";\n` +
        `import type { ResultEnvelope } from "${resultImport}";\n` +
        `type PlainData = { schemaVersion: 1; summary: string; counts: number[]; nested: { ok: boolean; meta?: Record<string, unknown> } };\n` +
        `export type Accepted = AssertTrue<IsOneWayData<PlainData>>;\n` +
        `export type OutcomeStillData = AssertTrue<IsOneWayData<AgentOutcome>>;\n` +
        `export type ReportStillData = AssertTrue<IsOneWayData<AgentReport>>;\n` +
        `export type ResultStillData = AssertTrue<IsOneWayData<ResultEnvelope>>;\n`
    );
    assert.equal(r.status, 0, `conforming fixture must compile clean; got:\n${r.out}`);
    console.log("one-way-boundary: conforming data + real boundary types compile clean ok");
  }

  // ---- 4. the welds stay present in source ----------------------------------
  {
    const welds = [
      ["shell/execution-backend/agent.ts", "AssertTrue<IsOneWayData<AgentOutcome>>"],
      ["shell/execution-backend/agent.ts", "AssertTrue<IsOneWayData<AgentReport>>"],
      ["core/pipeline/result-normalize.ts", "AssertTrue<IsOneWayData<ResultEnvelope>>"],
    ];
    for (const [file, weld] of welds) {
      const text = fs.readFileSync(path.join(pluginRoot, "src", ...file.split("/")), "utf8");
      assert.ok(text.includes(weld), `boundary weld present in ${file}: ${weld}`);
    }
    console.log("one-way-boundary: welds present in source ok");
  }

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log("one-way-boundary-smoke: ok (callables refused at compile time; plain data passes; welds present)");
}

main();
