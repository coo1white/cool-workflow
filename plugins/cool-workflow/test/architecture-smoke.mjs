#!/usr/bin/env node
// architecture-smoke — the map from each structural rule to the thing that
// holds it, the way yokoten's AGENTS.md rule table has a "Check" column.
// Included in `npm test`. Read-only: it reads src/, docs/reference.md, scripts/ and one
// `git grep`, and loads no CW module, so no cw command gets slower.
//
// Why: CW has some fifty guards (smokes and `npm run *:check` scripts), each
// with its own "why" in its header, but from the rule side nothing said
// which guard holds which rule (structure plan 2026-11-03, plan A item 3).
// This smoke holds four things:
//   1. RULES (the floor table of the root AGENTS.md): every rule names its
//      why and its guard; every guard named is on disk; every `*:check`
//      script's file is in the table (or in CHECK_NOT_A_RULE), so a new
//      guard is put on the map in the same diff. A rule no file holds names
//      "reviewer", "branch protection" or "tsc".
//   2. SECURITY_PATHS: signing, release tooling, sandbox, receipts,
//      redaction, the never-forward env list are on disk and named in
//      docs/reference.md; the release key's env name is in no code but the
//      release scripts that read it (and the list that strips it from
//      children).
//   3. Commands -> docs: docs/reference.md shows every cw verb in the
//      command table (`cw <verb>`). The man pages were merged into that one
//      page on 2026-11-12, so there is no page per verb any more.
//   4. No barrel files (a file that only re-exports) in src/.
// The exempt lists can only get shorter: a ceiling stops growth, and a row
// that is no longer needed is a fault too.
//
// Part 1 runs the checks on the real tree; part 2 (teeth) plants one fault
// per rule and asserts the smoke names that exact fault.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const PLUGIN = "plugins/cool-workflow/";
const ME = "test/architecture-smoke.mjs";
const REFERENCE = "docs/reference.md";

// [rule, why (incident or risk), guards: plugin-relative files or a NON_FILE_GUARDS name]
// The rows mirror "The floor" table in the root AGENTS.md; change the two together.
const RULES = [
  ["never push to main; branch, PR, green CI, merge", "a push skips review and CI", ["branch protection"]],
  ["a fix comes with a test that fails before it", "a fix whose test stayed green when reverted (0.4.0 third review)", ["scripts/fails-before-check.mjs"]],
  ["zero runtime dependencies in the CLI", "a dependency is supply-chain risk on every install", ["reviewer"]],
  ["core decides, shell does I/O, wiring joins; imports point one way", "I/O hidden in core breaks replay", ["scripts/purity-gate.mjs"]],
  ["data crossing the executor boundary holds no callable", "a model client in state makes CW the engine", ["test/one-way-boundary-smoke.mjs"]],
  ["no shell: true in src/; children are spawned argv-style", "a stray character reaches /bin/sh", [ME]],
  ["private keys never live in src/ or reach a child process", "an agent holding a key forges verdicts or receipts", [ME]],
  ["committed dist/ is exactly the build of src/", "users run code no one reviewed", ["scripts/dist-drift-check.mjs"]],
  ["JS/TS only; another language is a named exception", "a second toolchain to keep and review", ["scripts/lang-policy-check.mjs"]],
  ["--json output, exit codes and flags do not change shape", "scripts that read cw output break silently", ["test/cli-command-surface-smoke.mjs"]],
  ["no unused locals; no barrel files in src/", "dead code hides the real surface; a barrel loads modules no caller needs", ["tsc", ME]],
  ["unit tests mirror src/; smokes stay flat in test/", "a smoke in a sub folder never runs", ["test/test-layout-smoke.mjs"]],
  ["src/ stays at 10,000 lines or fewer", "src/ grew to 31,802 lines around a small core path (cut in batch 5)", ["scripts/size-check.mjs"]],
];
// Guards that are not a file in this package.
const NON_FILE_GUARDS = new Set(["reviewer", "branch protection", "tsc"]);
// `*:check` npm scripts that hold no rule of their own: npm script -> why.
const CHECK_NOT_A_RULE = {
  "readme:check": "keeps the generated npm README in step with the root README",
  "release:check": "runs the gates above (and the tests) before a cut",
};

// [plugin-relative path, why it is sensitive, text docs/reference.md must hold]
const SECURITY_PATHS = [
  ["../../.cw-release/verdict-signing.pub", "CI checks release verdicts against it", "verdict-signing.pub"],
  ["scripts/release-flow.mjs", "the one writer of a signed verdict", "release-flow.mjs"],
  ["scripts/release-gate.mjs", "the gate a release must pass", "release-gate.mjs"],
  ["scripts/release-oneclick.mjs", "the operator's cut: tag push, publish wait", "release-oneclick.mjs"],
  ["scripts/release-preflight.mjs", "checks the signing key before a cut", "release-preflight.mjs"],
  ["scripts/release-ci-checks.mjs", "the required CI checks a cut trusts", "release-ci-checks.mjs"],
  ["scripts/release-auto-patch.mjs", "tags and starts the publish of a patch with no human command", "release-auto-patch.mjs"],
  ["scripts/verify-release-verdict.mjs", "CI's verdict check on a tag", "verify-release-verdict.mjs"],
  ["scripts/verify-verdict-signature.mjs", "CI's ed25519 signature check", "verify-verdict-signature.mjs"],
  ["scripts/verdict-keygen.mjs", "makes the verdict key pair", "verdict-keygen.mjs"],
  ["scripts/block-unapproved-tag.mjs", "local hook refusing an unsigned tag", "block-unapproved-tag.mjs"],
  ["src/core/trust/receipt.ts", "done-receipt digest and signature", "CW_CHECK_PRIVKEY"],
  ["src/shell/receipt-io.ts", "runs the checked command, signs the receipt", "CW_CHECK_PRIVKEY"],
  ["src/shell/execution-backend/local.ts", "CW_NEVER_FORWARD_ENV: keys no child gets", "CW never hands that key to an agent"],
  ["src/core/trust/telemetry-attestation.ts", "signed agent usage records", "CW_AGENT_ATTEST_PUBKEY"],
  ["src/shell/telemetry-ledger-io.ts", "the one hash chain: the telemetry ledger", "telemetry.json"],
  ["src/shell/run-export.ts", "seals and verifies a run bundle offline", "verify-bundle"],
  ["src/shell/fs-atomic.ts", "atomic writes and locks for state", "atomic"],
];
// Sensitive paths the reference does not name yet. Empty since the release
// runbook moved from AGENTS.md into the docs (2026-11-03).
const SECURITY_UNCITED = {};
const SECURITY_UNCITED_CEILING = 0;

const RELEASE_KEY = "CW_RELEASE_VERDICT_PRIVKEY";
// The only code files (not docs, not tests) that may name the release key.
// fails-before-check.mjs names it only in STRIP_ENV, to keep it from the
// tests it runs at the PR base.
const RELEASE_KEY_CODE = [
  "dist/shell/execution-backend/local.js",
  "scripts/fails-before-check.mjs",
  "scripts/block-unapproved-tag.mjs",
  "scripts/release-flow.mjs",
  "scripts/release-oneclick.mjs",
  "scripts/release-preflight.mjs",
  "scripts/verdict-keygen.mjs",
  "src/shell/execution-backend/local.ts",
];
const NEVER_FORWARD_MUST_HOLD = [RELEASE_KEY, "CW_CHECK_PRIVKEY"];

// src-relative barrel -> why it stays
const BARREL_ALLOW = {};
const BARREL_CEILING = 0;

const fault = (what, why, fix) => `${what} — why: ${why} — fix: ${fix}`;
const heads = (findings) => findings.map((f) => f.split(" — ")[0]);
const mentions = (text, verb) => new RegExp(`(?:\\bcw|cli\\.js) ${verb}(?![\\w-])`).test(text);

function checkRules(rules, scripts, exists, notARule = {}) {
  const findings = [];
  const named = new Set(rules.flatMap(([, , guards]) => guards));
  for (const [rule, why, guards] of rules) {
    if (!why || guards.length === 0) findings.push(fault(`rule "${rule}" has no why or no guard`, "a rule with no why is not kept, one with no guard is not held", `give it a why and a guard, or "reviewer"`));
    for (const g of guards) {
      if (!NON_FILE_GUARDS.has(g) && !exists(g)) findings.push(fault(`rule "${rule}": guard ${g} is not on disk`, "a map to a missing guard holds nothing", "fix the name, or name the guard that now holds it"));
    }
  }
  for (const [name, cmd] of Object.entries(scripts)) {
    const file = /:check$/.test(name) && /^node (\S+)/.exec(cmd)?.[1];
    if (file && !named.has(file) && !Object.hasOwn(notARule, name)) findings.push(fault(`npm run ${name} (${file}) is not in RULES`, "every guard is on the rule map", `add a RULES row in ${ME} for the rule it holds`));
  }
  for (const name of Object.keys(notARule)) {
    if (!scripts[name]) findings.push(fault(`CHECK_NOT_A_RULE names npm run ${name}, which is gone`, "exempt lists only shrink", "drop the row"));
  }
  return findings;
}

function checkSecurity({ paths, uncited, ceiling, doc, exists, keyHits, neverForward }) {
  const findings = [];
  const why = "security-sensitive code is documented and kept where reviewers look";
  for (const [p, , cite] of paths) {
    if (!exists(p)) findings.push(fault(`${p} is not on disk`, why, "fix SECURITY_PATHS to the new path"));
    if (!doc.includes(cite)) findings.push(fault(`${p}: ${REFERENCE} does not hold "${cite}"`, why, "say what it does in the reference, or fix the row"));
  }
  for (const p of Object.keys(uncited)) {
    if (!exists(p)) findings.push(fault(`${p} is not on disk`, why, "drop it from SECURITY_UNCITED"));
    if (doc.includes(path.basename(p))) findings.push(fault(`${p} is now named in ${REFERENCE}`, "exempt lists only shrink", "move it to SECURITY_PATHS"));
  }
  if (Object.keys(uncited).length > ceiling) findings.push(fault(`SECURITY_UNCITED has ${Object.keys(uncited).length} rows, ceiling ${ceiling}`, "exempt lists only shrink", "name the path in the reference instead"));
  const keyWhy = "an agent holding the key could sign a release verdict";
  for (const [file, text] of keyHits) {
    if (file.endsWith(".md") || file.startsWith("test/")) continue;
    if (!RELEASE_KEY_CODE.includes(file)) findings.push(fault(`${file} names ${RELEASE_KEY}`, keyWhy, "only the release scripts read it; take it out"));
    else if (file.startsWith("src/") && text.split(RELEASE_KEY).length - 1 !== neverForward.filter((n) => n === RELEASE_KEY).length) {
      findings.push(fault(`${file} names ${RELEASE_KEY} outside CW_NEVER_FORWARD_ENV`, keyWhy, "src/ may only list it to strip it from children"));
    }
  }
  for (const file of RELEASE_KEY_CODE) {
    if (!keyHits.some(([f]) => f === file)) findings.push(fault(`${file} no longer names ${RELEASE_KEY}`, "exempt lists only shrink", "drop it from RELEASE_KEY_CODE"));
  }
  for (const name of NEVER_FORWARD_MUST_HOLD) {
    if (!neverForward.includes(name)) findings.push(fault(`CW_NEVER_FORWARD_ENV lacks ${name}`, "a signing key in an agent's env lets it forge", "add it back in src/shell/execution-backend/local.ts"));
  }
  return findings;
}

function checkVerbs(verbs, doc) {
  const why = "a user finds how a command works by its name";
  return verbs.filter((verb) => !mentions(doc, verb)).map((verb) => fault(`cw ${verb}: ${REFERENCE} does not show "cw ${verb}"`, why, "document it in the reference"));
}

function isBarrel(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const stmts = code.split(";").map((s) => s.trim()).filter(Boolean);
  return stmts.length > 0 && stmts.every((s) => /^export\s+(type\s+)?(\*|\{[^}]*\})\s+from\s+["'][^"']+["']$/.test(s));
}

function checkSource(files, allow, ceiling) {
  const findings = [];
  for (const [rel, text] of files) {
    if (isBarrel(text) && !allow[rel]) findings.push(fault(`src/${rel} only re-exports`, "a barrel loads modules no caller needs; the perf ratchet counts only a few commands", "import from the real module and delete the barrel"));
    if (/\bshell\s*:\s*true\b/.test(text)) findings.push(fault(`src/${rel} spawns with shell: true`, "a stray character reaches /bin/sh", "spawn argv-style with shell: false"));
  }
  const byRel = new Map(files);
  for (const rel of Object.keys(allow)) {
    if (!byRel.has(rel) || !isBarrel(byRel.get(rel))) findings.push(fault(`BARREL_ALLOW names src/${rel}, no longer a barrel`, "exempt lists only shrink", "drop the row"));
  }
  if (Object.keys(allow).length > ceiling) findings.push(fault(`BARREL_ALLOW has ${Object.keys(allow).length} rows, ceiling ${ceiling}`, "exempt lists only shrink", "remove a barrel instead"));
  return findings;
}

function readTree(dir, ext, rel = "") {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return readTree(dir, ext, r);
    return e.name.endsWith(ext) ? [[r, fs.readFileSync(path.join(dir, r), "utf8")]] : [];
  });
}

const parseVerbs = (texts) => [...new Set(texts.flatMap((t) => [...t.matchAll(/\bpath:\s*\["([a-z][a-z-]*)"/g)].map((m) => m[1])))].sort();
const parseNeverForward = (text) => [.../CW_NEVER_FORWARD_ENV[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(text)?.[1].matchAll(/"([A-Z_]+)"/g) ?? []].map((m) => m[1]);

// 1. The real tree.
const exists = (p) => fs.existsSync(path.join(pluginRoot, p));
const doc = fs.readFileSync(path.join(pluginRoot, REFERENCE), "utf8");
const scripts = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).scripts;
const keyHits = execFileSync("git", ["-C", repoRoot, "grep", "-l", "-F", RELEASE_KEY], { encoding: "utf8" }).split("\n").filter(Boolean)
  .map((f) => [f.startsWith(PLUGIN) ? f.slice(PLUGIN.length) : `../../${f}`, fs.readFileSync(path.join(repoRoot, f), "utf8")]);
const localTs = fs.readFileSync(path.join(pluginRoot, "src/shell/execution-backend/local.ts"), "utf8");
const verbs = parseVerbs(readTree(path.join(pluginRoot, "src/wiring"), ".ts").map(([, t]) => t));
const real = [
  ...checkRules(RULES, scripts, exists, CHECK_NOT_A_RULE),
  ...checkSecurity({ paths: SECURITY_PATHS, uncited: SECURITY_UNCITED, ceiling: SECURITY_UNCITED_CEILING, doc, exists, keyHits, neverForward: parseNeverForward(localTs) }),
  ...checkVerbs(verbs, doc),
  ...checkSource(readTree(path.join(pluginRoot, "src"), ".ts"), BARREL_ALLOW, BARREL_CEILING),
];
assert.equal(real.length, 0, `the real tree breaks ${real.length} architecture rule(s):\n  ${real.join("\n  ")}`);
assert.deepEqual(verbs, ["check", "demo", "doctor", "fix", "report", "version"], "the path: [...] parse finds the command table's verbs");

// 2. Teeth: one planted fault per rule, each named exactly.
assert.deepEqual(heads(checkRules(
  [["a", "", ["test/x-smoke.mjs"]], ["b", "why", ["test/gone-smoke.mjs"]], ["c", "why", ["reviewer", "branch protection", "tsc"]]],
  { "new:check": "node scripts/new-gate.mjs", "x:check": "node test/x-smoke.mjs", "y:check": "node scripts/y.mjs", build: "node scripts/build.mjs" },
  (p) => p === "test/x-smoke.mjs",
  { "y:check": "", "old:check": "" },
)), ['rule "a" has no why or no guard', 'rule "b": guard test/gone-smoke.mjs is not on disk', "npm run new:check (scripts/new-gate.mjs) is not in RULES", "CHECK_NOT_A_RULE names npm run old:check, which is gone"]);

const plantedLocal = `x = "${RELEASE_KEY}";\nexport const CW_NEVER_FORWARD_ENV = new Set([\n  "${RELEASE_KEY}",\n]);\n`;
assert.deepEqual(heads(checkSecurity({
  paths: [["src/gone.ts", "", "x"], ["src/here.ts", "", "missing text"]],
  uncited: { "scripts/a.mjs": "", "scripts/b.mjs": "" }, ceiling: 1,
  doc: "run b.mjs", exists: (p) => p !== "src/gone.ts",
  keyHits: [["src/shell/new.ts", RELEASE_KEY], ["src/shell/execution-backend/local.ts", plantedLocal], ["docs/reference.md", ""], ["test/y-smoke.mjs", ""]],
  neverForward: parseNeverForward(plantedLocal),
})), [
  "src/gone.ts is not on disk", 'src/gone.ts: docs/reference.md does not hold "x"', 'src/here.ts: docs/reference.md does not hold "missing text"',
  "scripts/b.mjs is now named in docs/reference.md", "SECURITY_UNCITED has 2 rows, ceiling 1",
  `src/shell/new.ts names ${RELEASE_KEY}`, `src/shell/execution-backend/local.ts names ${RELEASE_KEY} outside CW_NEVER_FORWARD_ENV`,
  ...RELEASE_KEY_CODE.filter((f) => f !== "src/shell/execution-backend/local.ts").map((f) => `${f} no longer names ${RELEASE_KEY}`),
  "CW_NEVER_FORWARD_ENV lacks CW_CHECK_PRIVKEY",
]);

assert.deepEqual(heads(checkVerbs(["fix", "list", "newverb"], "Run `cw fix`, or cw list-all.")), [
  'cw list: docs/reference.md does not show "cw list"', 'cw newverb: docs/reference.md does not show "cw newverb"',
]);

const tmp = tmpDir("cw-architecture-");
fs.mkdirSync(path.join(tmp, "a"));
fs.writeFileSync(path.join(tmp, "a/index.ts"), '// front door\nexport * from "./x.js";\nexport { y } from "./y.js";\n');
fs.writeFileSync(path.join(tmp, "a/kept.ts"), 'export * from "./x.js";\nexport const z = 1;\n');
fs.writeFileSync(path.join(tmp, "run.ts"), 'spawnSync("ls", [], { shell: true });\n');
assert.deepEqual(heads(checkSource(readTree(tmp, ".ts"), { "a/kept.ts": "", "b.ts": "" }, 1)), [
  "src/a/index.ts only re-exports", "src/run.ts spawns with shell: true",
  "BARREL_ALLOW names src/a/kept.ts, no longer a barrel", "BARREL_ALLOW names src/b.ts, no longer a barrel", "BARREL_ALLOW has 2 rows, ceiling 1",
]);
assert.ok(checkSource(readTree(tmp, ".ts"), {}, 0).every((f) => f.includes(" — why: ") && f.includes(" — fix: ")), "every finding says why and how to fix");

process.stdout.write("architecture-smoke: ok\n");
