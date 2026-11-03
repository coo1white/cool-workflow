#!/usr/bin/env node
// layer-direction — src/core/ imports only src/core/ (and node: built-ins).
// Until the whole-tree refactor's phase 1c (2026-11-03) core held a
// re-export of the wiring layer's capability table, so core depended on
// wiring, and through it on shell. purity-gate.mjs checks every layer
// against a baseline; this test holds the core rule with no baseline at
// all, so the edge cannot come back as a baseline entry.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const coreDir = path.resolve(import.meta.dirname, "..", "..", "src", "core");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));

const outside = [];
for (const file of walk(coreDir)) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)) {
    const spec = m[1];
    if (spec.startsWith("node:")) continue;
    const target = path.resolve(path.dirname(file), spec);
    if (!spec.startsWith(".") || !(target === coreDir || target.startsWith(coreDir + path.sep))) {
      outside.push(`${path.relative(coreDir, file)} -> ${spec}`);
    }
  }
}
assert.deepEqual(outside, [], `src/core/ must import only src/core/:\n  ${outside.join("\n  ")}`);
console.log("layer-direction: ok");
