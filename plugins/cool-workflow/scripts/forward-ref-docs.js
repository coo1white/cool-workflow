#!/usr/bin/env node
"use strict";

// Append a per-release forward-reference section to every doc that version:sync
// requires to carry the current version. The repo documents each release by
// appending a "## <Title> (vX)" section to the sibling .7.md docs; doing that by
// hand across ~12 docs is the dominant mechanical toil left after bump-version
// and new-feature. This automates it.
//
//   node scripts/forward-ref-docs.js "<Title>" "<one-line summary>"
//   npm run forward-ref -- "Release Tooling" "what it does"
//
// APPEND-ONLY: it never rewrites existing (historical) version labels — it only
// adds a new trailing section for the current package.json version. Idempotent:
// re-running for the same version is a no-op.

const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const docsDir = path.join(pluginRoot, "docs");

// SINGLE SOURCE OF TRUTH: derive the doc list from version-sync-check.js — every
// doc it asserts must carry the current VERSION receives the forward reference. A
// newly-added feature doc is auto-included the moment its
// `checkIncludes(..., VERSION)` assertion lands, so this list can never drift out
// of sync with the gate (the bug that silently dropped docs each release).
function versionCheckedDocs() {
  const src = fs.readFileSync(path.join(__dirname, "version-sync-check.js"), "utf8");
  return [...new Set([...src.matchAll(/docs\/([a-z0-9-]+\.7\.md)"\s*,\s*VERSION/g)].map((match) => match[1]))];
}

function main() {
  const title = process.argv[2];
  const summary = process.argv[3] || `${title}.`;
  if (!title) {
    process.stderr.write('usage: node scripts/forward-ref-docs.js "<Title>" "<summary>"\n');
    process.exit(1);
  }
  const version = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).version;
  const heading = `## ${title} (v${version})`;
  const section = `\n${heading}\n\n${summary}\n`;
  const VERSION_DOCS = versionCheckedDocs();

  const touched = [];
  for (const rel of VERSION_DOCS) {
    const abs = path.join(docsDir, rel);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, "utf8");
    // Skip if the doc already carries the current version — its OWN feature doc
    // (intro "CW vX adds ...") or a prior run of this command. This mirrors
    // version:sync's pass condition, so forward-ref does exactly the work the
    // gate requires: no self-referential section on the new doc, fully idempotent.
    if (text.includes(version)) continue;
    fs.writeFileSync(abs, `${text.replace(/\s*$/, "")}\n${section}`);
    touched.push(`docs/${rel}`);
  }

  // README carries the version via its lead line; append a short forward-ref so
  // version:sync's `v<version>` check passes without rewriting the intro prose.
  const readme = path.join(pluginRoot, "README.md");
  const readmeText = fs.readFileSync(readme, "utf8");
  if (!readmeText.includes(`v${version}`)) {
    fs.writeFileSync(readme, `${readmeText.replace(/\s*$/, "")}\n\n${heading}\n\n${summary}\n`);
    touched.push("README.md");
  }

  process.stdout.write(`forward-ref "${title}" (v${version}) -> ${touched.length} docs\n`);
  for (const rel of touched) process.stdout.write(`  appended ${rel}\n`);
  if (!touched.length) process.stdout.write("  (all docs already carry this section)\n");
}

main();
