#!/usr/bin/env node
// term-check-glyph — the ✓ / ✗ beside each `report verify-bundle` check is
// drawn by checkGlyph. It was doctorGlyph, named for `cw doctor`, which is
// gone (#929); the old name must not come back.

import assert from "node:assert/strict";
import * as term from "../../dist/shell/term.js";

assert.equal(typeof term.checkGlyph, "function", "term exports checkGlyph");
assert.equal("doctorGlyph" in term, false, "the doctor-named export is gone");
const plain = { isTTY: false };
assert.equal(term.checkGlyph("ok", plain), "✓");
assert.equal(term.checkGlyph("warn", plain), "!");
assert.equal(term.checkGlyph("fail", plain), "✗");
console.log("term-check-glyph: ok");
