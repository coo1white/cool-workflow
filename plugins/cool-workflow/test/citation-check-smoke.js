"use strict";
// citation-check-smoke — proves live docs cannot silently point at files
// that are not in the tree.
//
// The gate is scripts/citation-check.js (`npm run citation:check`). A 2026-08
// sweep found 30+ dead source-path citations in the man pages; this smoke
// keeps the gate itself from rotting into a no-op:
//   1. positive — the check PASSES on the real committed docs.
//   2. teeth    — the check FAILS closed (exit 1) on a doc naming a file
//                 that does not exist.
//   3. clean    — the check PASSES on a doc whose citations all resolve.
// The teeth/clean cases point the check at throwaway fixtures via
// CW_CITATION_DOCS + CW_CITATION_ROOT, so the real tracked docs are never
// touched. Case 5 covers rule (e): a stale cut-over audit marker anywhere
// in src/scripts/test, case-insensitive.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const script = path.join(pluginRoot, "scripts", "citation-check.js");

function run(env) {
  return cp.spawnSync(process.execPath, [script], {
    cwd: pluginRoot,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

// 1. positive: the committed docs must be clean. If this fails, a doc in the
//    tree names a file that is not there — fix the doc, not this smoke.
{
  const r = run({});
  assert.equal(
    r.status,
    0,
    `citation:check must PASS on the committed docs. exit=${r.status}\n${r.stderr}`
  );
  assert.ok(/all resolve/.test(r.stdout), `pass output must say so, got: ${r.stdout}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-citation-"));
try {
  fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "src", "real.ts"), "export {};\n");

  // 2. teeth: a doc naming a missing file must FAIL closed, and the failure
  //    must name the doc line and the dead token.
  {
    const doc = path.join(tmp, "dead.md");
    fs.writeFileSync(doc, "See `src/not-there.ts` for the mechanism.\n");
    const r = run({ CW_CITATION_DOCS: doc, CW_CITATION_ROOT: tmp });
    assert.equal(r.status, 1, `must FAIL on a dead citation. exit=${r.status}\n${r.stdout}`);
    assert.ok(/not-there\.ts/.test(r.stderr), `failure must name the token, got: ${r.stderr}`);
    assert.ok(/dead\.md:1/.test(r.stderr), `failure must name doc:line, got: ${r.stderr}`);
  }

  // 3. clean: a doc whose citation resolves must PASS.
  {
    const doc = path.join(tmp, "good.md");
    fs.writeFileSync(doc, "See `src/real.ts` for the mechanism.\n");
    const r = run({ CW_CITATION_DOCS: doc, CW_CITATION_ROOT: tmp });
    assert.equal(r.status, 0, `must PASS on a live citation. exit=${r.status}\n${r.stderr}`);
  }

  // 4. rules (a)-(d), hermetic via CW_CITATION_ROOT's fake src/scripts/test
  //    tree: a bare doc name with no matching file, a dead src token, a
  //    resolving token with a `:line` suffix, and a dead test-comment token
  //    all fail; a fake path inside a test STRING (not a `//` line) does not.
  {
    fs.mkdirSync(path.join(tmp, "scripts"));
    fs.mkdirSync(path.join(tmp, "test"));
    fs.writeFileSync(path.join(tmp, "scripts", "r.js"), "x\n");
    fs.writeFileSync(path.join(tmp, "src", "bad.ts"), "// scripts/gone.js scripts/r.js:9\n");
    fs.writeFileSync(path.join(tmp, "test", "s.js"), '// scripts/gone.js\nconst x = "test/fake.js";\n');
    const doc = path.join(tmp, "bare.md");
    fs.writeFileSync(doc, "`real.ts` `gone.ts`\n");
    const r = run({ CW_CITATION_DOCS: doc, CW_CITATION_ROOT: tmp });
    assert.equal(r.status, 1, `must FAIL on (a)-(d) misses. exit=${r.status}\n${r.stdout}`);
    const err = r.stderr;
    assert.ok(/gone\.ts/.test(err), `rule (a) bare-name miss, got: ${err}`);
    assert.ok(/bad\.ts:1/.test(err), `rule (b) dead src token, got: ${err}`);
    assert.ok(/r\.js:9/.test(err), `rule (d) :line suffix, got: ${err}`);
    assert.ok(/s\.js:1/.test(err), `rule (c) comment-line miss, got: ${err}`);
    assert.ok(!/fake\.js/.test(err), `rule (c) must not flag a string, got: ${err}`);
  }

  // 5. rule (e): a stale marker fails closed anywhere in src/scripts/test,
  //    matched case-insensitively (a different case than the canonical
  //    spelling must still be caught), and an unrelated everyday phrase
  //    that merely starts the same way must not false-match. Built from
  //    joined parts so this smoke's own source never carries the literal
  //    marker text (it would trip this very rule on itself).
  {
    const markerOne = ["Cutover", "Note"].join(" ");
    const markerTwo = ["leave", "it", "red"].join(" ");
    const lookalike = ["phase", "boundary"].join("-");
    fs.writeFileSync(path.join(tmp, "src", "clean.ts"), `// a normal ${lookalike} comment\n`);
    fs.writeFileSync(path.join(tmp, "src", "marked.ts"), `// ${markerOne}: old behavior\n`);
    fs.writeFileSync(path.join(tmp, "test", "marked.js"), `// ${markerTwo} for now\n`);
    const doc = path.join(tmp, "clean-doc.md");
    fs.writeFileSync(doc, "See `real.ts` for the mechanism.\n");
    const r = run({ CW_CITATION_DOCS: doc, CW_CITATION_ROOT: tmp });
    assert.equal(r.status, 1, `must FAIL on a stale marker. exit=${r.status}\n${r.stdout}`);
    const err = r.stderr;
    assert.ok(/marked\.ts:1/.test(err), `rule (e) catches a differently-cased marker in src, got: ${err}`);
    assert.ok(/marked\.js:1/.test(err), `rule (e) catches a differently-cased marker in test, got: ${err}`);
    assert.ok(!/clean\.ts/.test(err), `rule (e) must not flag a hyphenated lookalike, got: ${err}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("citation-check-smoke: PASS\n");
