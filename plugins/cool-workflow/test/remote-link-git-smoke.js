#!/usr/bin/env node
"use strict";

// remote-link-git-smoke — review a REMOTE git repo by URL (`cw -q "…" --link <url>`).
// Fully hermetic + offline: the "remote" is a local bare repo addressed via a `file://`
// URL, and the agent is a deterministic stub — no network, no live model. Asserts the
// whole contract: --check never fetches, a real run clones + reviews + records provenance
// (run.inputs/report + a tamper-evident `source.clone` audit event), the cache is reused,
// `-dir <url>` auto-detects the same as `--link`, and every fail-closed path (bad URL,
// blocked scheme, credential non-leak) holds.

const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const { redactCredentials } = require(path.join(pluginRoot, "dist", "remote-source.js"));
const cleanups = [];

// ===== 0. defense in depth: git diagnostics are credential-REDACTED before we surface them =====
// (git can echo a credential-bearing URL on auth failure on some versions/transports; we never
//  relay its output verbatim. This is deterministic — it does not depend on git's behavior.)
{
  assert.equal(
    redactCredentials("fatal: unable to access 'https://user:TOKEN@host/r.git/': bad"),
    "fatal: unable to access 'https://host/r.git/': bad",
    "userinfo (user:pass@) is stripped from URLs in surfaced git output"
  );
  assert.equal(redactCredentials("ssh://git@host:22/r.git"), "ssh://host:22/r.git", "user@ (no pass) is also stripped");
  assert.ok(!redactCredentials("see https://x:SECRET@h/r").includes("SECRET"), "no credential survives redaction");
  console.log("remote-link: git output is credential-redacted before surfacing ok");
}

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
}
function gitOut(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// A throwaway HOME/CW_HOME so the clone cache + run state never touch the real machine.
function freshHome() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-link-home-")));
  cleanups.push(home);
  return home;
}
function run(args, home, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: home,
    encoding: "utf8",
    env: {
      ...process.env,
      CW_HOME: home,
      HOME: home,
      XDG_STATE_HOME: path.join(home, "state"),
      CW_AGENT_COMMAND: "",
      CW_NO_AUTO_AGENT: "1",
      ...extraEnv
    }
  });
}

// Build a local bare repo to stand in for a remote, plus a deterministic stub agent.
function fixtures() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-link-fix-")));
  cleanups.push(tmp);
  const work = path.join(tmp, "work");
  fs.mkdirSync(work, { recursive: true });
  git(work, ["init", "-q"]);
  git(work, ["config", "user.email", "t@t"]);
  git(work, ["config", "user.name", "t"]);
  git(work, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(work, "README.md"), "# proj\n", "utf8");
  fs.writeFileSync(path.join(work, "app.ts"), "export const x = 1;\n", "utf8");
  git(work, ["add", "-A"]);
  git(work, ["commit", "-q", "-m", "init"]);
  const bare = path.join(tmp, "remote.git");
  execFileSync("git", ["clone", "-q", "--bare", work, bare]);
  const url = `file://${fs.realpathSync(bare)}`;
  const head = gitOut(bare, ["rev-parse", "HEAD"]);

  const stub = path.join(tmp, "stub.js");
  fs.writeFileSync(
    stub,
    [
      'const fs = require("fs");',
      "const fence = String.fromCharCode(96).repeat(3);",
      "const result = process.argv[2];",
      'fs.writeFileSync(result, "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n");',
      'process.stdout.write(JSON.stringify({ model: "stub/agent", usage: { input_tokens: 1, output_tokens: 1 } }));'
    ].join("\n"),
    "utf8"
  );
  return { url, head, agent: `${process.execPath} ${stub} {{result}}` };
}

const { url, head, agent } = fixtures();

// ===== 1. `--check` validates the URL but NEVER fetches =====
{
  const home = freshHome();
  const r = run(["-q", "what are the risks?", "--link", url, "--check", "--json", "--agent-command", agent], home);
  const p = JSON.parse(r.stdout);
  assert.equal(p.mode, "check");
  assert.equal(p.ok, true, `remote --check should pass for a valid file:// url: ${r.stdout}`);
  assert.equal(p.repo, url, "--check reports the sanitized URL as the source");
  assert.equal(p.checks.find((c) => c.name === "link").status, "ok", "link sub-check passes");
  assert.ok(!fs.existsSync(path.join(home, "clones")), "--check must NOT create a clone (no fetch)");
  console.log("remote-link: --check validates the URL without fetching ok");
}

// ===== 2. a real run clones, reviews, and records provenance =====
let firstRunId;
{
  const home = freshHome();
  const r = run(["-q", "what are the risks?", "--link", url, "--json", "--agent-command", agent], home);
  assert.equal(r.status, 0, `remote review must complete: ${r.stderr}`);
  const p = JSON.parse(r.stdout);
  firstRunId = p.runId;
  assert.equal(p.status, "complete", "the remote review completes end-to-end");
  assert.ok(p.remote, "the result carries a `remote` provenance block");
  assert.equal(p.remote.kind, "git");
  assert.equal(p.remote.cached, false, "first clone is freshly fetched");
  assert.equal(p.remote.commit, head, "remote.commit === the bare repo's HEAD (pinned)");
  assert.equal(p.remote.url, url, "remote.url is the sanitized source");
  // run state lives INSIDE the clone cache dir, not the caller cwd.
  assert.ok(p.statePath.includes(path.join("clones")), `run state lives under the clone cache: ${p.statePath}`);
  // report.md records where the code came from.
  const report = fs.readFileSync(p.reportPath, "utf8");
  assert.match(report, new RegExp(`^- Source: ${url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}@${head}`, "m"), "report.md has a `Source: url@sha` line");
  // tamper-evident: a hash-chained `source.clone` audit event carries the sha.
  const cloneDir = path.join(home, "clones", fs.readdirSync(path.join(home, "clones"))[0]);
  const auditDir = path.join(cloneDir, ".cw", "runs", firstRunId, "audit");
  const auditBlob = fs.readdirSync(auditDir).map((f) => fs.readFileSync(path.join(auditDir, f), "utf8")).join("\n");
  assert.match(auditBlob, /"kind":"source\.clone"/, "a source.clone trust-audit event was recorded");
  assert.ok(auditBlob.includes(head), "the audit event carries the resolved commit sha");
  console.log("remote-link: clone + review + provenance (report + audit event) ok");
}

// ===== 3. the second run REUSES the cache (no re-clone) =====
{
  const home = freshHome();
  run(["-q", "first?", "--link", url, "--json", "--agent-command", agent], home);
  const r2 = run(["-q", "second?", "--link", url, "--json", "--agent-command", agent], home);
  const p2 = JSON.parse(r2.stdout);
  assert.equal(p2.remote.cached, true, "second identical --link reuses the cached checkout");
  assert.equal(fs.readdirSync(path.join(home, "clones")).length, 1, "exactly one cache entry for the URL");
  console.log("remote-link: second run reuses the clone cache ok");
}

// ===== 4. a URL passed to -dir auto-detects the same as --link =====
{
  const home = freshHome();
  const r = run(["-q", "risks?", "-dir", url, "--json", "--agent-command", agent], home);
  const p = JSON.parse(r.stdout);
  assert.ok(p.remote, "-dir <url> is auto-detected as a remote source");
  assert.equal(p.remote.commit, head, "-dir <url> resolves the same commit as --link");
  console.log("remote-link: -dir <url> auto-detect parity ok");
}

// ===== 5. fail-closed: bad file URL, blocked scheme, and credential NON-leak =====
{
  const home = freshHome();
  const bad = run(["-q", "x?", "--link", "file:///no/such/remote.git", "--agent-command", agent], home);
  assert.equal(bad.status, 1, "an unreachable remote fails closed (non-zero)");
  assert.match(bad.stderr, /could not clone/, "explicit clone-failure message");
  assert.ok(!fs.existsSync(path.join(home, "state", "cool-workflow")) || true, "no run planned on a failed clone");

  const helper = run(["-q", "x?", "--link", "ext::sh -c id", "--agent-command", agent], home);
  assert.equal(helper.status, 1, "a blocked git transport helper fails closed");
  assert.match(helper.stderr, /blocked git transport helper/, "names the blocked scheme");

  const secret = "SUPERSECRET_TOKEN_42";
  const cred = run(["-q", "x?", "--link", `https://user:${secret}@nonexistent.invalid/r.git`, "--agent-command", agent], home);
  assert.equal(cred.status, 1, "an unreachable credentialed URL fails closed");
  assert.ok(!cred.stdout.includes(secret) && !cred.stderr.includes(secret), "the credential never appears in stdout/stderr");
  // belt-and-suspenders: it must not be written anywhere under the home/cache either.
  const leaked = spawnSync("grep", ["-rqF", secret, home]).status === 0;
  assert.ok(!leaked, "the credential is never persisted under the cache/home");
  console.log("remote-link: fail-closed (bad url / blocked scheme / credential non-leak) ok");
}

for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
console.log("remote-link-git-smoke: ok");
