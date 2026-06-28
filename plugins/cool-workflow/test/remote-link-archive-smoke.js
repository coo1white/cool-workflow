#!/usr/bin/env node
"use strict";

// @cw-smoke: tags slow
// remote-link-archive-smoke — review a remote repo delivered as a downloadable ARCHIVE
// (.tar.gz / .zip), e.g. a GitHub "Download ZIP"/codeload tarball. Fully hermetic + offline:
// archives are built locally and addressed via `file://` URLs, the agent is a stub. Asserts:
// a tarball and a zip both download → extract → git-init snapshot → review, with content-sha
// provenance (a `source.download` audit event); the cache is reused; and a malicious archive
// whose entry escapes the extraction dir (`../evil`) is rejected (zip-slip/tar-slip guard).

const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const cleanups = [];
const has = (bin) => spawnSync(bin, ["--version"], { encoding: "utf8" }).status === 0 ||
  spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).status === 0;

function freshHome() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-arch-home-")));
  cleanups.push(home);
  return home;
}
function run(args, home) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: home,
    encoding: "utf8",
    env: { ...process.env, CW_HOME: home, HOME: home, XDG_STATE_HOME: path.join(home, "state"), CW_AGENT_COMMAND: "", CW_NO_AUTO_AGENT: "1" }
  });
}

// A minimal ustar tar writer — lets us forge an entry name byte-for-byte (e.g. `../evil.txt`)
// without depending on a tool that would refuse to create it. Portable, zero-dep.
function tarHeader(name, size, typeflag, linkname) {
  const b = Buffer.alloc(512, 0);
  b.write(name.slice(0, 100), 0, "utf8");
  b.write("0000644\0", 100);
  b.write("0000000\0", 108);
  b.write("0000000\0", 116);
  b.write(size.toString(8).padStart(11, "0") + "\0", 124);
  b.write("00000000000\0", 136); // mtime
  b.write("        ", 148); // checksum placeholder (8 spaces)
  b.write(typeflag || "0", 156); // typeflag: '0' regular, '2' symlink
  if (linkname) b.write(linkname.slice(0, 100), 157, "utf8"); // linkname field (symlink target)
  b.write("ustar\0", 257);
  b.write("00", 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += b[i];
  b.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return b;
}
function makeTar(entries) {
  const parts = [];
  for (const e of entries) {
    const content = Buffer.from(e.content || "", "utf8");
    parts.push(tarHeader(e.name, content.length, e.typeflag, e.linkname));
    if (content.length) {
      const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512, 0);
      content.copy(padded);
      parts.push(padded);
    }
  }
  parts.push(Buffer.alloc(1024, 0)); // end-of-archive
  return Buffer.concat(parts);
}

// Build a project tree wrapped in a single top-level dir (GitHub archive style).
const fix = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-arch-fix-")));
cleanups.push(fix);
const proj = path.join(fix, "proj-main");
fs.mkdirSync(path.join(proj, "src"), { recursive: true });
fs.writeFileSync(path.join(proj, "README.md"), "# proj\n");
fs.writeFileSync(path.join(proj, "src", "app.ts"), "export const x = 1;\n");
execFileSync("tar", ["-czf", path.join(fix, "src.tar.gz"), "-C", fix, "proj-main"]);
const tgzUrl = `file://${path.join(fix, "src.tar.gz")}`;
const tgzSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(fix, "src.tar.gz"))).digest("hex");

const stub = path.join(fix, "stub.js");
fs.writeFileSync(stub, [
  'const fs = require("fs");',
  "const fence = String.fromCharCode(96).repeat(3);",
  'fs.writeFileSync(process.argv[2], "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n");',
  'process.stdout.write(JSON.stringify({ model: "stub/agent", usage: { input_tokens: 1, output_tokens: 1 } }));'
].join("\n"));
const agent = `${process.execPath} ${stub} {{result}}`;

// ===== 1. a tarball downloads, extracts, snapshots, and reviews — with content-sha provenance =====
{
  const home = freshHome();
  const r = run(["-q", "what are the risks?", "--link", tgzUrl, "--json", "--agent-command", agent], home);
  assert.equal(r.status, 0, `tarball review must complete: ${r.stderr}`);
  const p = JSON.parse(r.stdout);
  assert.equal(p.status, "complete");
  assert.equal(p.remote.kind, "archive", "an archive URL is materialized as kind=archive");
  assert.equal(p.remote.commit, tgzSha, "remote.commit === sha256 of the downloaded archive bytes (content address)");
  assert.equal(p.remote.cached, false);
  const report = fs.readFileSync(p.reportPath, "utf8");
  assert.match(report, new RegExp(`^- Source: .*src\\.tar\\.gz@${tgzSha}`, "m"), "report.md records Source: url@<contentSha>");
  // the extraction descended into the single top-level dir, and is a real git repo (snapshot).
  const cloneDir = path.join(home, "clones", fs.readdirSync(path.join(home, "clones")).find((e) => !e.startsWith(".")));
  assert.ok(fs.existsSync(path.join(cloneDir, "README.md")), "extraction descended into the project root (not the wrapper dir)");
  assert.ok(fs.existsSync(path.join(cloneDir, ".git")), "the extracted tree was snapshotted into a local git repo");
  const auditDir = path.join(cloneDir, ".cw", "runs", p.runId, "audit");
  const auditBlob = fs.readdirSync(auditDir).map((f) => fs.readFileSync(path.join(auditDir, f), "utf8")).join("\n");
  assert.match(auditBlob, /"kind":"source\.download"/, "a source.download trust-audit event was recorded");
  console.log("remote-link-archive: tarball download+extract+snapshot+review+provenance ok");

  // second identical run reuses the cache.
  const r2 = run(["-q", "again?", "--link", tgzUrl, "--json", "--agent-command", agent], home);
  assert.equal(JSON.parse(r2.stdout).remote.cached, true, "second archive run reuses the cached snapshot");
  console.log("remote-link-archive: cache reuse ok");
}

// ===== 2. a .zip is supported too (when zip/unzip are present) =====
if (has("zip") && has("unzip")) {
  const home = freshHome();
  execFileSync("zip", ["-qr", path.join(fix, "src.zip"), "proj-main"], { cwd: fix });
  const r = run(["-q", "risks?", "--link", `file://${path.join(fix, "src.zip")}`, "--json", "--agent-command", agent], home);
  assert.equal(r.status, 0, `zip review must complete: ${r.stderr}`);
  const p = JSON.parse(r.stdout);
  assert.equal(p.status, "complete");
  assert.equal(p.remote.kind, "archive");
  console.log("remote-link-archive: .zip download+extract+review ok");
} else {
  console.log("remote-link-archive: .zip case SKIPPED (zip/unzip not on PATH)");
}

// ===== 3. zip-slip / tar-slip: an entry that escapes the extraction dir is REJECTED =====
{
  const home = freshHome();
  const evil = path.join(fix, "evil.tar");
  fs.writeFileSync(evil, makeTar([{ name: "../evil-escaped.txt", content: "pwned" }]));
  const escapeTarget = path.join(path.dirname(path.join(home, "clones", "x")), "evil-escaped.txt"); // clones/../evil-escaped.txt
  const r = run(["-q", "x?", "--link", `file://${evil}`, "--agent-command", agent], home);
  assert.equal(r.status, 1, "a traversal archive fails closed (non-zero)");
  assert.match(r.stderr, /unsafe path|escapes the extraction dir/, "names the traversal rejection");
  assert.ok(!fs.existsSync(escapeTarget), "nothing was written outside the extraction dir");
  assert.ok(!fs.existsSync(path.join(fix, "evil-escaped.txt")), "the `..` target was never created");
  console.log("remote-link-archive: zip-slip/tar-slip traversal guard ok");
}

// ===== 4. symlink entries are REJECTED (the symlink-traversal class, version-independent) =====
// A name-only guard misses a safe-NAMED symlink whose target escapes; we walk the extracted
// tree and fail closed on ANY symlink. Covers both a plain symlink entry and the single-top-
// level-symlink-to-dir case (the contentRoot-descent bypass) — both must be rejected.
{
  for (const entry of [
    { name: "safe-link", typeflag: "2", linkname: "/etc/passwd" },        // symlink to a system file
    { name: "wrapper", typeflag: "2", linkname: "/tmp" }                  // single top-level symlink to a dir
  ]) {
    const home = freshHome();
    const evil = path.join(fix, `sym-${entry.name}.tar`);
    fs.writeFileSync(evil, makeTar([entry]));
    const r = run(["-q", "x?", "--link", `file://${evil}`, "--agent-command", agent], home);
    assert.equal(r.status, 1, `a symlink archive (${entry.name}) fails closed`);
    assert.match(r.stderr, /symlink|non-regular/, "names the symlink rejection");
    // nothing escaped: the symlink target must not have been written through.
    assert.ok(!fs.existsSync(path.join(home, "clones", "etc")) && !fs.existsSync(path.join(fix, "passwd")), "no write-through escape");
  }
  console.log("remote-link-archive: symlink entries rejected (no extraction escape) ok");
}

// ===== 5. decompression bomb is REJECTED before extraction (declared uncompressed size) =====
{
  const home = freshHome();
  // a valid small .tar.gz whose gzip ISIZE trailer is forged to claim a huge uncompressed size.
  const bomb = path.join(fix, "bomb.tar.gz");
  const bytes = Buffer.from(fs.readFileSync(path.join(fix, "src.tar.gz")));
  bytes.writeUInt32LE(0xffffffff, bytes.length - 4); // ISIZE ≈ 4 GiB > the 1 GiB cap
  fs.writeFileSync(bomb, bytes);
  const r = run(["-q", "x?", "--link", `file://${bomb}`, "--agent-command", agent], home);
  assert.equal(r.status, 1, "a declared-huge archive fails closed before extraction");
  assert.match(r.stderr, /decompression bomb|uncompressed size/, "names the bomb rejection");
  console.log("remote-link-archive: decompression-bomb guard (pre-extraction) ok");
}

// ===== 6. SSRF: a redirect to a private/internal host is BLOCKED before connecting =====
// Async: an in-process loopback server can only serve the spawned CLI if the main event loop
// is free, so this stage (and the final cleanup) run in an async tail using spawn, not spawnSync.
function runAsync(args, home) {
  const { spawn } = require("node:child_process");
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [cli, ...args], {
      cwd: home,
      env: { ...process.env, CW_HOME: home, HOME: home, XDG_STATE_HOME: path.join(home, "state"), CW_AGENT_COMMAND: "", CW_NO_AUTO_AGENT: "1" }
    });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve({ status: code, stdout: out, stderr: err }));
  });
}

(async () => {
  const http = require("node:http");
  const home = freshHome();
  // The server's only job is to 302-redirect to a PRIVATE target. The original host is loopback
  // too (the operator's own choice — allowed); the REDIRECT target is what must be blocked.
  const server = http.createServer((req, res) => {
    res.writeHead(302, { Location: "http://127.0.0.1:9/internal-secret.tar.gz" }); // private; must never be reached
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const r = await runAsync(["-q", "x?", "--link", `http://127.0.0.1:${port}/x.tar.gz`, "--agent-command", agent], home);
  server.close();
  assert.equal(r.status, 1, "a redirect to a private host fails closed");
  assert.match(r.stderr, /private\/internal host|disallowed scheme/, "names the SSRF redirect block");
  console.log("remote-link-archive: SSRF redirect-to-private guard ok");

  for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
  console.log("remote-link-archive-smoke: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
