#!/usr/bin/env node
"use strict";

// Scaffold the per-tag boilerplate for a new feature so the agent spends tokens
// on novel logic, not on recreating the same file shapes every release.
//
//   node scripts/new-feature.js <slug> "<Title>" ["one-line summary"]
//   npm run new:feature -- team-x "Team X" "what it does"
//
// Generates the man-page doc, the smoke-test skeleton, and a CHANGELOG entry,
// then PRINTS the exact gate-file edits to make by hand (capability registry,
// version:sync assertions, release-check docs-presence, npm test chain) — those
// are intentionally not auto-edited so a scaffold can never break a gate file.

const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");

function fail(msg) {
  process.stderr.write(`new:feature error: ${msg}\n`);
  process.exit(1);
}

function writeNew(absPath, content) {
  if (fs.existsSync(absPath)) fail(`${path.relative(pluginRoot, absPath)} already exists`);
  fs.writeFileSync(absPath, content);
}

function main() {
  const slug = process.argv[2];
  const title = process.argv[3];
  const summary = process.argv[4] || `${title}: TODO one-line summary.`;
  if (!slug || !title) fail('usage: node scripts/new-feature.js <slug> "<Title>" ["summary"]');
  if (!/^[a-z][a-z0-9-]+$/.test(slug)) fail("slug must be kebab-case, e.g. team-collaboration");

  const version = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).version;
  const docRel = `docs/${slug}.7.md`;
  const testRel = `test/${slug}-smoke.js`;

  // 1. docs/<slug>.7.md — title + version line satisfy version:sync checkIncludes.
  writeNew(path.join(pluginRoot, docRel), `# ${title}

CW v${version} adds ${title}: TODO one-paragraph description of the feature, the
problem it solves, and what existed before it. Keep the base-system voice:
explicit data flow, no hidden state.

## Design Discipline

- TODO: mechanism vs policy — what is the kernel mechanism, what is configurable policy.
- TODO: fail-closed rule — what ambiguous/missing state surfaces as, never a guess.
- TODO: reuse — which existing records/types this builds on without forking.
- TODO: parity — the verbs are declared in capability-registry.ts so CLI === MCP.

## CLI

\`\`\`text
TODO node dist/cli.js <verb> ... [--json]
\`\`\`

## Compatibility

${title} is introduced in CW v${version}. Fields are additive and optional; older
run state loads unchanged.

## See Also

cli-mcp-parity(7), web-desktop-workbench(7), security-trust-hardening(7)
`);

  // 2. test/<slug>-smoke.js — runnable stub; the "<slug>-smoke" marker satisfies
  //    version:sync; replace the stub assertion with real coverage.
  writeNew(path.join(pluginRoot, testRel), `"use strict";
// ${slug}-smoke (v${version}). TODO prove, end to end:
//   1. the happy path produces the expected durable records;
//   2. the fail-closed rule actually refuses ambiguous/missing input;
//   3. cw <cmd> --json === cw_<cmd> (CLI <-> MCP parity).

const assert = require("node:assert/strict");

function main() {
  // TODO: build a run, exercise the feature, assert on durable state.
  assert.ok(true, "${slug}-smoke: replace this stub with real coverage");
  process.stdout.write("${slug}-smoke: ok (STUB — implement real assertions)\\n");
}

main();
`);

  // 3. CHANGELOG.md — ensure a section for this version, add a bullet.
  const changelogPath = path.join(pluginRoot, "..", "..", "CHANGELOG.md");
  let changelog = fs.readFileSync(changelogPath, "utf8");
  const bullet = `- Added ${title}: ${summary}\n`;
  if (changelog.includes(`## ${version}`)) {
    changelog = changelog.replace(`## ${version}\n`, `## ${version}\n\n${bullet}`);
  } else {
    changelog = changelog.replace(/^# Changelog\n/, `# Changelog\n\n## ${version}\n\n${bullet}`);
  }
  fs.writeFileSync(changelogPath, changelog);

  process.stdout.write(`new:feature "${title}" (v${version})\n`);
  process.stdout.write(`  created  ${docRel}\n`);
  process.stdout.write(`  created  ${testRel}\n`);
  process.stdout.write(`  updated  CHANGELOG.md\n\n`);

  // 4. Gate-file edits to make by hand (printed, never auto-applied).
  process.stdout.write(`Remaining wiring (edit by hand — kept manual so a scaffold can't break a gate):\n\n`);
  process.stdout.write(`  docs/index.md\n    add:  N. [${title}](${slug}.7.md) - ${summary}\n\n`);
  process.stdout.write(`  package.json  "test" chain\n    add:  && node ${testRel}\n\n`);
  process.stdout.write(`  scripts/release-check.js  "docs presence" list\n    add:  "${docRel}",\n\n`);
  process.stdout.write(`  scripts/version-sync-check.js  (assert the new surfaces carry the version)\n`);
  process.stdout.write(`    checkIncludes("plugins/cool-workflow/${docRel}", "${title}", checks);\n`);
  process.stdout.write(`    checkIncludes("plugins/cool-workflow/${docRel}", VERSION, checks);\n`);
  process.stdout.write(`    checkIncludes("plugins/cool-workflow/docs/index.md", "${slug}.7.md", checks);\n`);
  process.stdout.write(`    checkIncludes("plugins/cool-workflow/${testRel}", "${slug}-smoke", checks);\n\n`);
  process.stdout.write(`  src/capability-registry.ts  — declare the new verb(s) so CLI === MCP (parity gate).\n`);
  process.stdout.write(`  sibling docs/*.7.md  — append a "## ${title} (v${version})" forward-reference section\n`);
  process.stdout.write(`    to the docs version:sync checks for VERSION (that's the repo's per-release pattern).\n`);
}

main();
