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

// The overstated claims are gone: the signature never covered the whole report, and
// the report is not claimed exhaustively tamper-proof.
assert.doesNotMatch(flat, /signature no longer matches/i, "must not claim a signature covers the whole report");
assert.doesNotMatch(flat, /Every agent step is recorded, signed/i, "must not claim every step's content is signed");
assert.doesNotMatch(flat, /the report (can ?not|can't) be (tampered|altered|forged|changed)/i, "must not overclaim the report is wholesale tamper-proof");

// The now-true FORWARD claim is present: findings are signed and verified unaltered.
assert.match(flat, /signs its findings/i, "states the agent signs its findings");
assert.match(flat, /verify-bundle/i, "names the verify-bundle check");
assert.match(flat, /unaltered/i, "claims the signed findings are present unaltered");
assert.match(flat, /no private key/i, "states CW holds no private key");
// And the honest forward-scope caveat is present (not that the report holds nothing else).
assert.match(flat, /not that the report holds nothing else|check the findings .* against the signed results/i, "keeps the honest forward-scope caveat");
assert.match(section, /\[Trust Model\]\(plugins\/cool-workflow\/docs\/trust-model\.md\)/, "links to the Trust Model doc");

// And that linked doc exists.
assert.ok(
  fs.existsSync(path.join(repoRoot, "plugins", "cool-workflow", "docs", "trust-model.md")),
  "the linked Trust Model doc exists"
);

process.stdout.write("readme-trust-claim-smoke: ok\n");
