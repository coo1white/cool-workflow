#!/usr/bin/env node
"use strict";
// readme-trust-claim-smoke — the root README "Can I Trust the Report?" section must
// state the tamper-evidence guarantee HONESTLY. Before this, it overstated the
// guarantee: "Every agent step is recorded, signed ... Change the report later?
// The chain breaks and the signature no longer matches." The ed25519 signature
// only ever covered the agent's reported USAGE, never the CW-rendered report — so
// that sentence was false. The honest claim: usage is signed; the record is
// hash-chained / tamper-evident; the report text itself is NOT signed; CW holds no
// private key. (A later cycle adds real result/report coverage and strengthens the
// wording to match.)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// test/ -> plugins/cool-workflow -> plugins -> repo root
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");

const start = readme.indexOf("## Can I Trust the Report?");
assert.ok(start >= 0, "README has a 'Can I Trust the Report?' section");
// Bound the section at the NEXT H2 (robust to the following heading being renamed).
const rest = readme.slice(start + 1);
const nextH2 = rest.indexOf("\n## ");
const section = nextH2 >= 0 ? readme.slice(start, start + 1 + nextH2) : readme.slice(start);
// Markdown wraps prose across lines, so match phrases against a whitespace-flat
// view (the link assertion keeps the raw section).
const flat = section.replace(/\s+/g, " ");

// The overstated claims are gone: the signature never covered the report, and not
// every step's content is signed.
assert.doesNotMatch(flat, /signature no longer matches/i, "must not claim a signature covers the report");
assert.doesNotMatch(flat, /Every agent step is recorded, signed/i, "must not claim every step's content is signed");

// The honest scoping is present.
assert.match(flat, /token usage/i, "scopes the signature to the agent's reported token usage");
assert.match(flat, /report text itself is not signed/i, "states the report text is not signed");
assert.match(flat, /no private key/i, "states CW holds no private key");
assert.match(section, /\[Trust Model\]\(plugins\/cool-workflow\/docs\/trust-model\.md\)/, "links to the Trust Model doc");

// And that linked doc exists.
assert.ok(
  fs.existsSync(path.join(repoRoot, "plugins", "cool-workflow", "docs", "trust-model.md")),
  "the linked Trust Model doc exists"
);

process.stdout.write("readme-trust-claim-smoke: ok\n");
