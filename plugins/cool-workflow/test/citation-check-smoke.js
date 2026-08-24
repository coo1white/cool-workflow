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
// touched.

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
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("citation-check-smoke: PASS\n");
