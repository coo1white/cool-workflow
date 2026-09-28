#!/usr/bin/env node
"use strict";

// no-unused-locals-smoke — dead code cannot land again. `tsconfig.json`
// turns on `noUnusedLocals` (project/docs/intent/2026-09-archive.md, the
// dead-code part), so `npm run build` refuses an import, a local or a
// function no line reads. This smoke proves the gate has teeth: a fixture
// compiled with the project's own setting fails with TS6133 when it holds an
// unused import, and compiles once that import is used. It also checks that
// src/ itself compiles clean under the setting.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const tscJs = path.join(pluginRoot, "node_modules", "typescript", "lib", "tsc.js");
assert.ok(fs.existsSync(tscJs), "repo typescript devDependency present");
const typesRoot = path.join(pluginRoot, "node_modules", "@types");

const config = JSON.parse(fs.readFileSync(path.join(pluginRoot, "tsconfig.json"), "utf8")).compilerOptions;
assert.equal(config.noUnusedLocals, true, "tsconfig.json turns on noUnusedLocals");

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-unused-locals-"));

// Compile one file with the project's own strictness and unused-locals
// setting (read from tsconfig.json, not hard-coded here).
function compile(name, source) {
  const file = path.join(fixtureDir, name);
  fs.writeFileSync(file, source, "utf8");
  const flags = ["--noEmit", "--target", "es2022", "--module", "nodenext", "--moduleResolution", "nodenext", "--ignoreConfig", "--skipLibCheck", "--typeRoots", typesRoot, "--types", "node"];
  if (config.strict) flags.push("--strict");
  if (config.noUnusedLocals) flags.push("--noUnusedLocals");
  const child = spawnSync(process.execPath, [tscJs, ...flags, file], { encoding: "utf8", timeout: 120000 });
  return { status: child.status, out: `${child.stdout || ""}${child.stderr || ""}` };
}

try {
  {
    const r = compile("unused-import.ts", 'import * as fs from "node:fs";\nexport const answer = 42;\n');
    assert.notEqual(r.status, 0, "an unused import does not compile");
    assert.match(r.out, /TS6133: 'fs' is declared but its value is never read/);
  }
  {
    const r = compile("unused-function.ts", "function neverCalled(): number {\n  return 1;\n}\nexport const answer = 42;\n");
    assert.notEqual(r.status, 0, "a function no one calls does not compile");
    assert.match(r.out, /TS6133: 'neverCalled' is declared but its value is never read/);
  }
  {
    const r = compile("used-import.ts", 'import * as fs from "node:fs";\nexport const exists = fs.existsSync(".");\n');
    assert.equal(r.status, 0, `a used import compiles: ${r.out}`);
  }
  {
    // Dropping a field next to a rest element stays allowed: TypeScript does
    // not count the dropped name as unused, so no `void x;` is needed.
    const r = compile("rest-omit.ts", "export function withoutId(o: { id: string; name: string }): { name: string } {\n  const { id, ...rest } = o;\n  return rest;\n}\n");
    assert.equal(r.status, 0, `a field dropped beside a rest element compiles: ${r.out}`);
  }
  {
    const child = spawnSync(process.execPath, [tscJs, "-p", path.join(pluginRoot, "tsconfig.json"), "--noEmit"], { cwd: pluginRoot, encoding: "utf8", timeout: 300000 });
    assert.equal(child.status, 0, `src/ compiles clean under noUnusedLocals: ${child.stdout}${child.stderr}`);
  }
  console.log("no-unused-locals-smoke: ok");
} finally {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
}
