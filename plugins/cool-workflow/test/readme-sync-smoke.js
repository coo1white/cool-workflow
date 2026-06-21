#!/usr/bin/env node
"use strict";

// readme-sync-smoke — the npm package README (plugins/cool-workflow/README.md) is
// GENERATED from the GitHub README (repo-root README.md) and may not drift, so the
// two pages stay identical by construction.
//
// Proves:
//   1. `sync-readme --check` PASSES against the committed npm README (in sync now).
//   2. the npm README carries NO repo-relative image/link refs — npm cannot resolve
//      a repo's relative `docs/assets/...` / `](LICENSE)` paths, so every one is an
//      absolute URL; the generated-file marker is present.
//   3. TEETH: a drifted npm README (edited, not re-synced) makes --check FAIL closed
//      (exit 1) — the gate can't rot into a no-op.
//   4. sync is idempotent (writing twice to a temp target yields identical bytes).
//
// Hermetic: spawns the script; no network, no live agent. The teeth/idempotence
// cases point the target at throwaway temp files via CW_README_PATH so the real
// tracked README is never mutated.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const script = path.join(pluginRoot, "scripts", "sync-readme.js");
const npmReadme = path.join(pluginRoot, "README.md");

const cleanups = [];
function tmpFile(tag) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `cw-readme-${tag}-`)), "README.md");
  cleanups.push(path.dirname(f));
  return f;
}
function run(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd: pluginRoot, encoding: "utf8", env: { ...process.env, ...env } });
}

try {
  // ---- 1. committed npm README is in sync with the GitHub README ----
  {
    const r = run(["--check"]);
    assert.equal(
      r.status,
      0,
      `--check must PASS on the committed npm README (run \`npm run sync:readme\` if this fails). exit=${r.status}\n${r.stderr}`
    );
  }

  // ---- 2. the npm README has NO repo-relative refs (npm needs absolute URLs) ----
  {
    const text = fs.readFileSync(npmReadme, "utf8");
    assert.ok(text.startsWith("<!-- AUTO-GENERATED"), "npm README carries the generated-file marker");
    assert.doesNotMatch(
      text,
      /\bsrc="(?!https?:|data:)[^"]+"/,
      "npm README has NO relative <img src> (npm can't resolve repo-relative image paths)"
    );
    assert.doesNotMatch(
      text,
      /\]\((?!https?:|#|mailto:)[^)]+\)/,
      "npm README has NO relative ](link) (npm can't resolve repo-relative links)"
    );
    assert.match(text, /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main\/docs\/assets\//, "images are absolute raw URLs");
    assert.match(text, /github\.com\/[^/]+\/[^/]+\/blob\/main\/LICENSE/, "the LICENSE link is an absolute blob URL");
  }

  // ---- 3. TEETH: a drifted npm README fails --check closed ----
  {
    const drifted = tmpFile("drift");
    fs.writeFileSync(drifted, `${fs.readFileSync(npmReadme, "utf8")}\n<!-- hand-edited drift -->\n`, "utf8");
    const r = run(["--check"], { CW_README_PATH: drifted });
    assert.equal(r.status, 1, "--check FAILS closed when the npm README has drifted from the source");
    assert.match(r.stderr, /stale|does not match/i, "the failure explains the drift");
  }

  // ---- 4. sync is idempotent (write twice → identical bytes) ----
  {
    const a = tmpFile("a");
    const b = tmpFile("b");
    assert.equal(run([], { CW_README_PATH: a }).status, 0, "first sync writes");
    assert.equal(run([], { CW_README_PATH: b }).status, 0, "second sync writes");
    assert.equal(fs.readFileSync(a, "utf8"), fs.readFileSync(b, "utf8"), "two syncs produce identical output");
  }

  process.stdout.write("readme-sync-smoke: ok (npm README mirrors GitHub; absolute URLs; drift fails closed; idempotent)\n");
} finally {
  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
}
