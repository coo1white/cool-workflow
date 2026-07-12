#!/usr/bin/env node
"use strict";

// purity-gate-dynamic-import-smoke — pins the FIXED behavior of the
// core/shell purity ratchet's specifier scan (scripts/purity-gate.js).
//
// FINDING #23 (P3): extractSpecifiers matched static `import ... from "x"`
// and `require("x")`, but NOT a dynamic `import("x")` call. So an
// `await import("node:fs")` (or a bare `import("../shell/thing")`) inside
// src/core/** slipped past the gate — the very impure/cross-layer edge the
// ratchet exists to catch could be smuggled in through the one import form
// it did not see.
//
// This test asserts the CORRECT contract: extractSpecifiers must report the
// module named by a dynamic import(), the same as it already does for the
// static and require forms. It FAILS against the pre-fix scan (which returns
// nothing for a lone dynamic import) and PASSES once the dynamic-import
// regex is added. Per the task rule, the assertion is written to the fixed
// behavior and is not weakened to match the bug.
//
// Node-only, no framework, no new dependency — same constraint the rest of
// the repo's tooling holds to.

const assert = require("node:assert/strict");
const { extractSpecifiers } = require("../scripts/purity-gate");

function specsOf(code) {
  return extractSpecifiers(code);
}

// 1. The core fix: a dynamic import() names a module the scan must see.
{
  const specs = specsOf('const fs = await import("node:fs");');
  assert.ok(
    specs.includes("node:fs"),
    "dynamic import(\"node:fs\") must be reported by extractSpecifiers so the core-builtin ratchet can see it (finding #23)"
  );
}

// 2. Single quotes and inner whitespace variants must match too (the regex
//    tolerates whitespace inside the parens, mirroring the require() rule).
{
  const specs = specsOf("const m = await import( './shell/thing' );");
  assert.ok(
    specs.includes("./shell/thing"),
    "dynamic import() with single quotes and surrounding whitespace must be reported"
  );
}

// 3. A dynamic import of a cross-layer relative path is exactly the edge the
//    ratchet must catch: it has to surface as a specifier so layerOf can
//    judge it. (This proves the scan sees it; the layer verdict is the
//    gate's job downstream.)
{
  const specs = specsOf('function load() { return import("../shell/run-store"); }');
  assert.ok(
    specs.includes("../shell/run-store"),
    "a dynamic import() of a shell/ module from core/ must be reported so the layer check can flag it"
  );
}

// 4. Regression guard: the pre-existing static-import and require forms must
//    keep matching exactly as before. The fix adds a form, it does not
//    replace either of the two the gate already relied on.
{
  const staticSpecs = specsOf('import { readFileSync } from "node:fs";\nexport { x } from "./core/x";');
  assert.ok(staticSpecs.includes("node:fs"), "static import specifier still matched");
  assert.ok(staticSpecs.includes("./core/x"), "static export-from specifier still matched");

  const requireSpecs = specsOf('const p = require("node:path");');
  assert.ok(requireSpecs.includes("node:path"), "require() specifier still matched");
}

// 5. A single source blob mixing all three forms must yield all three
//    specifiers — the dynamic form is additive, never at the cost of the
//    others.
{
  const specs = specsOf(
    [
      'import { a } from "node:crypto";',
      'const b = require("node:path");',
      'const c = await import("node:fs");',
    ].join("\n")
  );
  for (const want of ["node:crypto", "node:path", "node:fs"]) {
    assert.ok(specs.includes(want), `mixed-form scan must report ${want}`);
  }
}

process.stdout.write("purity-gate-dynamic-import-smoke: ok\n");
