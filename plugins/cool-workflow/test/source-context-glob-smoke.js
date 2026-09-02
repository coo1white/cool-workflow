#!/usr/bin/env node
"use strict";

// source-context-glob-smoke: the profile matcher must honour `**` (cross a
// directory separator) distinctly from `*` (a single segment). Before the fix
// every `*` compiled to `[^/]*`, so a standard gitignore-style `**/*.test.ts`
// silently matched only a test file one level deep (see the fixtures below)
// but not one three levels deep — a foreign-repo profile under-excluded without a word.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const sc = path.join(pluginRoot, "scripts", "source-context.js");
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-source-context-glob-")));

function git(args) {
  const r = cp.spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed\n${r.stderr || r.stdout}`);
}
function manifest(profile) {
  const p = path.join(repo, "p.json");
  fs.writeFileSync(p, JSON.stringify({ schemaVersion: 1, profiles: { g: profile } }), "utf8");
  const r = cp.spawnSync(process.execPath, [sc, "manifest", "--profile", "g", "--profile-file", p, "--repo-root", repo, "--ref", "HEAD"], { cwd: pluginRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
  assert.equal(r.status, 0, `manifest failed\n${r.stderr}`);
  return new Map(r.stdout.trim().split(/\n/).filter(Boolean).map((l) => JSON.parse(l)).map((x) => [x.path, x]));
}
const inc = (m, p) => m.get(p) && m.get(p).included === true;

// Nested tree with test files at 1, 2, and 3 levels deep, a root-level doc, and
// a couple of regular files.
const files = {
  "src/a.test.ts": "x\n",
  "src/deep/b.test.ts": "x\n",
  "src/deep/nested/c.test.ts": "x\n",
  "src/keep.ts": "x\n",
  "src/deep/keep2.ts": "x\n",
  "root.md": "x\n",
  "src/notes.md": "x\n"
};
for (const [rel, body] of Object.entries(files)) {
  fs.mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), body, "utf8");
}
git(["init"]);
git(["add", "-A"]);
git(["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "base"]);

// --- `**/*.test.ts` excludes test files at EVERY depth (the core fix) ---
{
  const m = manifest({ description: "g", maxLines: 100, include: ["src/**"], exclude: ["**/*.test.ts"] });
  assert.equal(inc(m, "src/a.test.ts"), false, "1-level test file excluded");
  assert.equal(inc(m, "src/deep/b.test.ts"), false, "2-level test file excluded (was leaking before the fix)");
  assert.equal(inc(m, "src/deep/nested/c.test.ts"), false, "3-level test file excluded (was leaking before the fix)");
  assert.equal(inc(m, "src/keep.ts"), true, "non-test source stays included");
  assert.equal(inc(m, "src/deep/keep2.ts"), true, "nested non-test source stays included");
}

// --- a leading `**/` matches the repo root too (gitignore semantics) ---
{
  const m = manifest({ description: "g", maxLines: 100, include: ["**/*.md"], exclude: [] });
  assert.equal(inc(m, "root.md"), true, "**/*.md matches a root-level file (zero dirs)");
  assert.equal(inc(m, "src/notes.md"), true, "**/*.md matches a nested file");
  assert.equal(inc(m, "src/keep.ts"), false, "**/*.md does not match non-.md files");
}

// --- a single `*` still does NOT cross a separator (POLA for single-star) ---
{
  const m = manifest({ description: "g", maxLines: 100, include: ["src/*.ts"], exclude: [] });
  assert.equal(inc(m, "src/keep.ts"), true, "src/*.ts matches a direct child");
  assert.equal(inc(m, "src/deep/keep2.ts"), false, "src/*.ts does NOT match a nested file (single * is one segment)");
}

// --- trailing `dir/**` still works exactly as before (regression guard) ---
{
  const m = manifest({ description: "g", maxLines: 100, include: ["src/deep/**"], exclude: [] });
  assert.equal(inc(m, "src/deep/b.test.ts"), true, "src/deep/** matches nested files");
  assert.equal(inc(m, "src/deep/nested/c.test.ts"), true, "src/deep/** matches deeply nested files");
  assert.equal(inc(m, "src/keep.ts"), false, "src/deep/** does not match a sibling outside the dir");
}

// --- a trailing `/**` with a WILDCARD in its prefix (`**/deep/**`) must match,
//     not silently no-op through the literal-prefix fast path ---
{
  const m = manifest({ description: "g", maxLines: 100, include: ["src/**"], exclude: ["**/deep/**"] });
  assert.equal(inc(m, "src/deep/b.test.ts"), false, "**/deep/** excludes files under a `deep` dir at any depth");
  assert.equal(inc(m, "src/deep/nested/c.test.ts"), false, "**/deep/** excludes deeply nested files under `deep`");
  assert.equal(inc(m, "src/keep.ts"), true, "**/deep/** leaves files outside `deep` alone");
}

// --- stacked globstars must not hang the matcher (ReDoS guard). A redundant
//     `**/**` over a deep non-matching path used to backtrack catastrophically. ---
{
  const t0 = Date.now();
  const m = manifest({ description: "g", maxLines: 100, include: ["src/**/**/**/*.ts"], exclude: [] });
  assert.ok(Date.now() - t0 < 4000, "stacked `**` patterns must not cause catastrophic backtracking");
  assert.equal(inc(m, "src/deep/nested/keepnested.ts") || inc(m, "src/deep/keep2.ts") || inc(m, "src/keep.ts"), true, "stacked `**` still matches .ts under src");
}

// --- regex metachars in a literal part are escaped (a raw `.` would over-match).
//     `a.test.ts` must be matched by `**/*.test.ts`; `axtestxts.ts` must NOT. ---
{
  fs.writeFileSync(path.join(repo, "src", "axtestxts.ts"), "x\n", "utf8");
  git(["add", "-A"]);
  git(["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "escaping fixture"]);
  const m = manifest({ description: "g", maxLines: 100, include: ["src/**"], exclude: ["**/*.test.ts"] });
  assert.equal(inc(m, "src/a.test.ts"), false, "the literal dots in *.test.ts match a real .test.ts");
  assert.equal(inc(m, "src/axtestxts.ts"), true, "the dots are escaped, so `axtestxts.ts` is NOT caught by *.test.ts");
}

fs.rmSync(repo, { recursive: true, force: true });
process.stdout.write("source-context-glob-smoke: ok\n");
