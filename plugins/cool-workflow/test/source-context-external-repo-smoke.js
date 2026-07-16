#!/usr/bin/env node
"use strict";

// source-context-external-repo-smoke: the crashes/corruptions that hit the
// exporter on real foreign repos, and their fixes.
//   B1: a binary in the include set (docs/**/*.png) is a recorded omission
//       (included:false, reason:"binary", bytes+sha256 kept, lines:null) in
//       manifest and export — never a die(), never a silent drop.
//   B2: any tricky filename exports. Enumeration is `ls-tree -r -z` and blobs are
//       read BY OBJECT ID, so no path — non-ASCII (CJK), backslash, or double
//       quote — can break the request stream or be lost to git's path quoting.
//   +  a git submodule (gitlink) is recorded (reason:"submodule"), not read as a
//      blob and not a die().
//   +  a non-UTF-8-but-non-NUL text file (latin-1/GBK/…) is a recorded omission
//      (reason:"non-utf8"): its lossy toString("utf8") is never emitted, so the
//      export content always hashes back to the record and the cache never poisons.
//   +  a binary caught by an EXCLUDE rule keeps reason "excluded:*", not "binary".

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const script = path.join(pluginRoot, "scripts", "source-context.js");
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-source-context-external-")));

function git(args) {
  const result = cp.spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function runRaw(args, opts = {}) {
  return cp.spawnSync(process.execPath, [script, ...args], {
    cwd: pluginRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 16, ...opts
  });
}

function run(args) {
  const result = runRaw(args);
  assert.equal(result.status, 0, `${args.join(" ")} must succeed on a tricky foreign repo\nSTDERR:\n${result.stderr}`);
  assert.equal(result.stderr, "", "source-context success must be silent on stderr");
  return result.stdout.trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
}

const NON_ASCII = "docs/中文-说明.md";        // CJK: git quotes it by default (B2)
const WEIRD = 'docs/we ird".md';             // space + double quote: the C-quote class -z closes
const TEXT = "Hello from the guide.\n";
const NON_ASCII_TEXT = "非 ASCII 文档正文\n";
const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00, 0xff]);  // NUL -> binary
const LATIN1 = Buffer.from("café \xff end\n", "latin1");                            // non-UTF-8, no NUL

fs.mkdirSync(path.join(repo, "docs", "images"), { recursive: true });
fs.writeFileSync(path.join(repo, "docs", "guide.md"), TEXT, "utf8");
fs.writeFileSync(path.join(repo, "docs", "images", "logo.png"), BINARY);
fs.writeFileSync(path.join(repo, "docs", "excluded.png"), BINARY);         // binary caught by an exclude rule
fs.writeFileSync(path.join(repo, "docs", "latin1.md"), LATIN1);
fs.writeFileSync(path.join(repo, NON_ASCII), NON_ASCII_TEXT, "utf8");
fs.writeFileSync(path.join(repo, WEIRD), "weird\n", "utf8");
git(["init"]);
git(["add", "-A"]);
git(["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "base"]);

// A gitlink (submodule) entry, created directly so the test is hermetic — points
// at this repo's own HEAD commit oid so ls-tree reports it as type "commit".
const headOid = git(["rev-parse", "HEAD"]);
git(["update-index", "--add", "--cacheinfo", `160000,${headOid},docs/vendor`]);
git(["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "add gitlink"]);

const profile = path.join(repo, "profiles.json");
fs.writeFileSync(profile, JSON.stringify({
  schemaVersion: 1,
  profiles: { ext: { description: "External repo smoke.", maxLines: 10000, include: ["docs/**"], exclude: ["docs/excluded.png"] } }
}, null, 2), "utf8");

const common = ["--profile", "ext", "--profile-file", profile, "--repo-root", repo, "--ref", "HEAD"];

// --- manifest: every class recorded honestly ---
const manifest = run(["manifest", ...common]);
const byPath = new Map(manifest.map((r) => [r.path, r]));

const png = byPath.get("docs/images/logo.png");
assert.ok(png, "the binary file must appear in the manifest");
assert.equal(png.included, false, "a binary in the include set is omitted");
assert.match(png.reason, /binary/, "the omission reason names 'binary'");
assert.equal(png.bytes, BINARY.length, "binary omission keeps byte size");
assert.equal(png.sha256, crypto.createHash("sha256").update(BINARY).digest("hex"), "binary omission keeps a digest");
assert.equal(png.lines, null, "binary line count is null");

assert.equal(byPath.get("docs/excluded.png").reason.startsWith("excluded:"), true, "a binary caught by an exclude rule keeps the excluded reason, not 'binary'");

const latin1 = byPath.get("docs/latin1.md");
assert.equal(latin1.included, false, "a non-UTF-8 text file is omitted");
assert.equal(latin1.reason, "non-utf8", "the omission reason names 'non-utf8'");
assert.equal(latin1.sha256, crypto.createHash("sha256").update(LATIN1).digest("hex"), "non-utf8 omission keeps the raw-blob digest");

const vendor = byPath.get("docs/vendor");
assert.ok(vendor, "the submodule gitlink must appear in the manifest");
assert.equal(vendor.included, false, "a submodule is omitted");
assert.equal(vendor.reason, "submodule", "the submodule omission reason is 'submodule'");

const md = byPath.get(NON_ASCII);
assert.ok(md && md.included === true, "the non-ASCII text file is included (B2)");
assert.equal(md.sha256, crypto.createHash("sha256").update(Buffer.from(NON_ASCII_TEXT, "utf8")).digest("hex"), "non-ASCII digest is correct");
assert.ok(byPath.get(WEIRD) && byPath.get(WEIRD).included === true, "a backslash/quote/space filename is included");

// --- export: carries only the packable text files, verbatim ---
const exported = run(["export", ...common]);
const exPaths = exported.map((r) => r.path).sort();
assert.deepEqual(exPaths, ["docs/guide.md", NON_ASCII, WEIRD].sort(), "export carries exactly the packable text files");
assert.ok(exported.every((r) => r.included === true), "export contains only included records");
assert.equal(exported.find((r) => r.path === NON_ASCII).content, NON_ASCII_TEXT, "non-ASCII content is exported verbatim");
assert.ok(!exported.some((r) => r.path.endsWith(".png")), "no binary is ever exported as content");
assert.ok(!exported.some((r) => r.path === "docs/latin1.md"), "no non-UTF-8 file is exported as content");

// Every exported record's content must hash back to its own raw-blob sha256 —
// proves no lossy content slips through (the non-UTF-8 integrity/cache trap).
for (const r of exported) {
  assert.equal(crypto.createHash("sha256").update(Buffer.from(r.content, "utf8")).digest("hex"), r.sha256,
    `exported content for ${r.path} must hash to its record digest`);
}

// --- cache round-trip: a non-UTF-8 file present must not poison the cache ---
const cacheDir = path.join(repo, ".cache");
const first = runRaw(["export", ...common, "--cache-dir", cacheDir]);
assert.equal(first.status, 0, `first cached export must succeed\n${first.stderr}`);
const second = runRaw(["export", ...common, "--cache-dir", cacheDir]);
assert.equal(second.status, 0, `second cached export (cache hit) must succeed — no poison\n${second.stderr}`);
assert.equal(first.stdout, second.stdout, "cache hit is byte-identical to the fresh export");

// --- large repo: `ls-tree -r -z` output must not overflow git()'s buffer.
// The full-format enumeration is ~3x the old --name-only output; with Node's
// default 1 MiB spawn buffer a mid-size repo would ENOBUFS and die. Build a repo
// whose ls-tree -z output exceeds 1 MiB and assert the export still succeeds.
{
  const big = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-source-context-big-")));
  const gitBig = (args) => assert.equal(cp.spawnSync("git", args, { cwd: big, encoding: "utf8" }).status, 0, `git ${args[0]} failed`);
  const DIRS = 50;
  for (let d = 0; d < DIRS; d++) fs.mkdirSync(path.join(big, "docs", `d${d}`), { recursive: true });
  for (let i = 0; i < 16000; i++) {
    fs.writeFileSync(path.join(big, "docs", `d${i % DIRS}`, `file${i}.md`), "x\n");
  }
  gitBig(["init"]);
  gitBig(["add", "-A"]);
  gitBig(["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "big"]);
  const bigProfile = path.join(big, "profiles.json");
  fs.writeFileSync(bigProfile, JSON.stringify({ schemaVersion: 1, profiles: { big: { description: "big", maxLines: 99999999, include: ["docs/**"], exclude: [] } } }), "utf8");
  const treeBytes = cp.spawnSync("git", ["ls-tree", "-r", "-z", "HEAD"], { cwd: big, encoding: "buffer", maxBuffer: 1024 * 1024 * 256 }).stdout.length;
  assert.ok(treeBytes > 1024 * 1024, `fixture must exceed the 1 MiB default (got ${treeBytes} bytes)`);
  const bigRun = runRaw(["export", "--profile", "big", "--profile-file", bigProfile, "--repo-root", big, "--ref", "HEAD"], { maxBuffer: 1024 * 1024 * 64 });
  assert.equal(bigRun.status, 0, `export of a >1 MiB-ls-tree repo must not overflow git()'s buffer\n${bigRun.stderr}`);
  assert.equal(bigRun.stdout.trim().split(/\n/).filter(Boolean).length, 16000, "every file in the large repo is exported");
  fs.rmSync(big, { recursive: true, force: true });
}

process.stdout.write("source-context-external-repo-smoke: ok\n");
