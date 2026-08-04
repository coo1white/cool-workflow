"use strict";
// verify-audit-cites-smoke — first regression net for project/docs/scripts/verify-audit-cites.js
// (the audit cite checker had NO tests as a shell script; the Node port gets one).
// Pins the full exit-code contract: 0 = all cites resolve and are in range,
// 1 = at least one failed, 2 = bad usage / missing root / no locators.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const script = path.join(repoRoot, "plugins", "cool-workflow", "project", "docs", "scripts", "verify-audit-cites.js");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cw-verify-audit-cites-"));
const root = path.join(sandbox, "src");
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, "alpha.ts"), "line1\nline2\nline3\nline4\nline5\n", "utf8");
fs.mkdirSync(path.join(sandbox, "other"), { recursive: true });
fs.writeFileSync(path.join(sandbox, "other", "beta.js"), "one\ntwo\n", "utf8");

function writeAudit(name, text) {
  const file = path.join(sandbox, name);
  fs.writeFileSync(file, text, "utf8");
  return file;
}

function run(args) {
  // cwd = sandbox so both resolution modes are exercised: root-relative
  // ("alpha.ts:2") and repo-relative ("other/beta.js:1").
  return cp.spawnSync(process.execPath, [script, ...args], { cwd: sandbox, encoding: "utf8" });
}

// 1. All cites valid (single line, range form, repo-relative form) -> exit 0.
const good = writeAudit("good.md", [
  "See `alpha.ts:2` and the range alpha.ts:1-5.",
  "Repo-relative: other/beta.js:1 also counts.",
].join("\n"));
let res = run([good, "src"]);
assert.equal(res.status, 0, `valid cites must pass\nSTDERR:\n${res.stderr}`);
assert.match(res.stdout, /All 3 file:line cite\(s\) resolved and are in range under src\./);
assert.match(res.stdout, /claim-correctness needs a human reviewer/);
assert.equal(res.stderr, "", "success keeps stderr clean");

// 2. Line out of range -> exit 1, named on stderr.
const outOfRange = writeAudit("range.md", "Claim at alpha.ts:99 is stale. alpha.ts:2 is fine.");
res = run([outOfRange, "src"]);
assert.equal(res.status, 1, "out-of-range cite must fail");
assert.match(res.stderr, /LINE OUT OF RANGE alpha\.ts:99 \(file has 6 lines\)/);
assert.match(res.stderr, /1 cite\(s\) resolved, 1 failed\./);

// 3. Reversed range (end < start) -> exit 1.
res = run([writeAudit("reversed.md", "bad range alpha.ts:4-2 here"), "src"]);
assert.equal(res.status, 1, "reversed range must fail");
assert.match(res.stderr, /LINE OUT OF RANGE alpha\.ts:4-2/);

// 4. Missing file -> exit 1, named on stderr.
res = run([writeAudit("missing.md", "phantom cite ghost.ts:10"), "src"]);
assert.equal(res.status, 1, "missing file must fail");
assert.match(res.stderr, /MISSING FILE {3}ghost\.ts:10/);

// 5. No locators at all -> exit 2 (an audit without cites is a usage error, not a pass).
res = run([writeAudit("none.md", "prose only, no cites"), "src"]);
assert.equal(res.status, 2, "no locators must exit 2");
assert.match(res.stderr, /no file:line locators found/);

// 6. Missing audit argument / nonexistent audit file -> exit 2 usage.
res = run([]);
assert.equal(res.status, 2, "missing args must exit 2");
assert.match(res.stderr, /usage: node plugins\/cool-workflow\/project\/docs\/scripts\/verify-audit-cites\.js/);
res = run([path.join(sandbox, "does-not-exist.md"), "src"]);
assert.equal(res.status, 2, "nonexistent audit must exit 2");

// 7. Missing search root -> exit 2, named.
res = run([good, "no-such-root"]);
assert.equal(res.status, 2, "missing root must exit 2");
assert.match(res.stderr, /search root not found: no-such-root/);

// 8. Duplicate locators are deduped (one failure listed once).
res = run([writeAudit("dup.md", "ghost.ts:10 then ghost.ts:10 again"), "src"]);
assert.equal(res.status, 1);
assert.equal((res.stderr.match(/MISSING FILE/g) || []).length, 1, "duplicate locators dedupe to one check");

fs.rmSync(sandbox, { recursive: true, force: true });
process.stdout.write("verify-audit-cites-smoke: ok\n");
