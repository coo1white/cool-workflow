#!/usr/bin/env node
"use strict";

// release-doctor-smoke — pins `npm run release:doctor` (scripts/release-doctor.mjs)
// and the shared checks in scripts/release-preflight.mjs, which
// `npm run release -- X.Y.Z` (scripts/release-oneclick.mjs) now runs FIRST.
//
// Why: a real cut on an operator machine failed LATE, one problem at a time,
// after a 10-minute gate — a leftover release/vX.Y.Z-cut branch at an old
// commit (so the cut ran old code), a reviewer binary that did not exist
// (ENOENT only after the gate), and so on. Each failure mode below is now
// caught in seconds, before any gate, with the fix command on stderr.
//
// Every case builds a temp bare "origin" plus a clone. No network: origin is
// a local bare repo, `gh` is a stub on PATH, the reviewer is a stub that must
// never run, and the signing key is a dummy file the doctor must never read.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const DOCTOR = path.join(pluginRoot, "scripts", "release-doctor.mjs");
const PREFLIGHT = path.join(pluginRoot, "scripts", "release-preflight.mjs");
const ONECLICK = path.join(pluginRoot, "scripts", "release-oneclick.mjs");
assert.ok(fs.existsSync(DOCTOR), "release-doctor.mjs must exist");
assert.ok(fs.existsSync(PREFLIGHT), "release-preflight.mjs must exist");

const VERSION = "1.2.3";
const KEY_TEXT = "DUMMY-KEY-BYTES-THE-DOCTOR-MUST-NEVER-READ";

function sh(bin, args, cwd, env) {
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", env: env || process.env, shell: false });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")} failed in ${cwd}:\n${r.stderr}`);
  return (r.stdout || "").trim();
}

let caseId = 0;
const roots = [];
process.on("exit", () => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});
// A fresh world: bare origin (main), a seed clone that published one commit
// carrying the signing public key + a package.json at VERSION, and the
// operator's clone `work` at the origin/main tip with a GitHub noreply
// identity. Returns paths and a base env.
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cw-release-doctor-${caseId++}-`));
  roots.push(root);
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(home, ".gitconfig"), "");
  const gitEnv = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t"
  };
  const origin = path.join(root, "origin.git");
  sh("git", ["init", "-q", "--bare", "-b", "main", origin], root, gitEnv);
  const seed = path.join(root, "seed");
  sh("git", ["clone", "-q", origin, seed], root, gitEnv);
  sh("git", ["checkout", "-q", "-B", "main"], seed, gitEnv);
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(path.join(seed, ".cw-release"), { recursive: true });
  fs.writeFileSync(path.join(seed, ".cw-release", "verdict-signing.pub"), publicKey.export({ type: "spki", format: "pem" }));
  fs.writeFileSync(path.join(seed, ".gitignore"), ".cw/\n");
  fs.writeFileSync(path.join(seed, "README.md"), "x\n");
  // Enough of the package layout for release-oneclick.mjs to run from a copy
  // (its repoRoot is two levels above its plugin root) and for the doctor to
  // read the default version.
  const pkgDir = path.join(seed, "plugins", "cool-workflow");
  fs.mkdirSync(path.join(pkgDir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, "dist", "shell"), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "fixture", version: VERSION }, null, 2) + "\n");
  fs.copyFileSync(ONECLICK, path.join(pkgDir, "scripts", "release-oneclick.mjs"));
  fs.copyFileSync(PREFLIGHT, path.join(pkgDir, "scripts", "release-preflight.mjs"));
  // release-oneclick.mjs also requires the required-CI-checks reader (its cut
  // stage waits on those checks).
  fs.copyFileSync(path.join(pluginRoot, "scripts", "release-ci-checks.mjs"), path.join(pkgDir, "scripts", "release-ci-checks.mjs"));
  fs.writeFileSync(path.join(pkgDir, "dist", "shell", "agent-config.js"),
    "\"use strict\";\n" +
    "function resolveAgentConfig(flags, env) {\n" +
    "  const cmd = (env && env.CW_AGENT_COMMAND) || '';\n" +
    "  if (!cmd) return { source: 'none' };\n" +
    "  const parts = cmd.split(/\\s+/).filter(Boolean);\n" +
    "  return { source: 'env', command: parts[0], args: parts.slice(1) };\n" +
    "}\n" +
    "module.exports = { resolveAgentConfig };\n");
  sh("git", ["add", "-A"], seed, gitEnv);
  sh("git", ["commit", "-q", "-m", "seed"], seed, gitEnv);
  sh("git", ["push", "-q", "origin", "main"], seed, gitEnv);

  const work = path.join(root, "work");
  sh("git", ["clone", "-q", origin, work], root, gitEnv);
  sh("git", ["config", "user.email", "1+t@users.noreply.github.com"], work, gitEnv);
  sh("git", ["config", "user.name", "t"], work, gitEnv);

  // Stub gh (auth status ok unless GH_STUB_FAIL=1) and a stub reviewer that
  // records if it is ever run (the doctor must never run it).
  const ranMarker = path.join(root, "reviewer-ran");
  fs.writeFileSync(path.join(bin, "gh"), "#!/usr/bin/env node\nprocess.exit(process.env.GH_STUB_FAIL === '1' ? 1 : 0);\n", { mode: 0o755 });
  const reviewer = path.join(bin, "grok-review");
  fs.writeFileSync(reviewer, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(ranMarker)}, 'ran');\n`, { mode: 0o755 });
  const keyFile = path.join(root, "verdict-signing.key");
  fs.writeFileSync(keyFile, KEY_TEXT, { mode: 0o600 });

  const env = {
    ...gitEnv,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ""}`,
    CW_HOME: path.join(root, "cw-home"),
    XDG_STATE_HOME: path.join(root, "cw-home"),
    CW_NO_AUTO_AGENT: "1",
    CW_AGENT_COMMAND: `${reviewer} -p {{input}}`,
    CW_RELEASE_VERDICT_PRIVKEY: keyFile
  };
  delete env.CW_AGENT_ENDPOINT;
  delete env.GH_STUB_FAIL;
  return { root, seed, work, env, gitEnv, reviewer, keyFile, ranMarker };
}

function doctor(w, args = [], envPatch = {}) {
  const env = { ...w.env };
  for (const [k, v] of Object.entries(envPatch)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const r = spawnSync(process.execPath, [DOCTOR, ...args], { cwd: w.work, encoding: "utf8", env, shell: false });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function json(r) {
  return JSON.parse(r.out);
}
function byId(result, id) {
  const c = result.checks.find((x) => x.id === id);
  assert.ok(c, `check ${id} must be reported`);
  return c;
}
function noSecret(w, r) {
  assert.ok(!r.out.includes(KEY_TEXT) && !r.err.includes(KEY_TEXT), "the signing key bytes must never be printed");
  assert.ok(!fs.existsSync(w.ranMarker), "the doctor must never run the reviewer");
}

// ---- Case: a clean, current setup passes ------------------------------------
{
  const w = world();
  const r = doctor(w, [VERSION, "--json"]);
  assert.equal(r.code, 0, `a clean current setup must pass:\n${r.err}`);
  const res = json(r);
  assert.equal(res.ok, true);
  assert.equal(res.mode, "doctor");
  assert.equal(res.version, VERSION);
  assert.equal(res.failures, 0);
  assert.equal(res.warnings, 0, `no warnings expected on a clean setup:\n${r.err}`);
  for (const id of ["version", "fetch", "head-current", "clean-tree", "cw-dir", "cut-branch", "tag-local", "tag-remote", "signing-key", "reviewer", "git-identity", "gh", "tools"]) {
    assert.ok(["ok", "info"].includes(byId(res, id).status), `${id} must be ok on a clean setup`);
  }
  assert.match(byId(res, "tools").message, /node v\d+/, "the node version is reported");
  assert.match(r.err, /release:doctor: ready for v1\.2\.3/);
  noSecret(w, r);

  // Default output: diagnostics on stderr, NOTHING on stdout (Rule of Silence).
  const plain = doctor(w, []);
  assert.equal(plain.code, 0);
  assert.equal(plain.out, "", "without --json the doctor writes nothing to stdout");
  assert.match(plain.err, /ready for v1\.2\.3/, "the version defaults to plugins/cool-workflow/package.json");
}

// ---- Case: stale code on a leftover cut branch ------------------------------
// The incident: the operator sat on release/vX.Y.Z-cut at an old commit, so
// `git pull` changed nothing and the cut would release old code.
{
  const w = world();
  const oldSha = sh("git", ["rev-parse", "HEAD"], w.work, w.gitEnv);
  sh("git", ["checkout", "-q", "-b", `release/v${VERSION}-cut`], w.work, w.gitEnv);
  fs.writeFileSync(path.join(w.seed, "README.md"), "newer\n");
  sh("git", ["commit", "-q", "-am", "newer main"], w.seed, w.gitEnv);
  sh("git", ["push", "-q", "origin", "main"], w.seed, w.gitEnv);
  const newSha = sh("git", ["rev-parse", "HEAD"], w.seed, w.gitEnv);

  const r = doctor(w, [VERSION, "--json"]);
  assert.equal(r.code, 1, "a stale HEAD must fail the doctor");
  const res = json(r);
  const head = byId(res, "head-current");
  assert.equal(head.status, "fail");
  assert.ok(head.message.includes(oldSha) && head.message.includes(newSha), "both shas are named");
  assert.ok(head.message.includes(`release/v${VERSION}-cut`), "the current branch is named");
  assert.equal(head.fix, "git checkout main && git pull --ff-only origin main");
  const branch = byId(res, "cut-branch");
  assert.equal(branch.status, "fail", "a leftover cut branch at old code fails the doctor");
  assert.match(branch.fix, /git branch -D release\/v1\.2\.3-cut/, "the delete command is given");
  assert.match(r.err, /FAIL head-current/);
  assert.match(r.err, /fix:  git checkout main && git pull --ff-only origin main/);
  // The doctor never deletes anything itself.
  assert.ok(sh("git", ["branch", "--list", `release/v${VERSION}-cut`], w.work, w.gitEnv), "the doctor must not delete the branch");
  noSecret(w, r);

  // Back on an up-to-date main, the leftover branch alone still fails.
  sh("git", ["checkout", "-q", "main"], w.work, w.gitEnv);
  sh("git", ["pull", "-q", "--ff-only", "origin", "main"], w.work, w.gitEnv);
  const r2 = doctor(w, [VERSION, "--json"]);
  assert.equal(r2.code, 1);
  assert.equal(byId(json(r2), "head-current").status, "ok");
  assert.equal(byId(json(r2), "cut-branch").status, "fail");
}

// ---- Case: dirty tracked tree fails; .cw/ only warns -------------------------
{
  const w = world();
  fs.writeFileSync(path.join(w.work, "README.md"), "edited\n");
  const r = doctor(w, [VERSION, "--json"]);
  assert.equal(r.code, 1, "tracked modifications must fail");
  const c = byId(json(r), "clean-tree");
  assert.equal(c.status, "fail");
  assert.match(c.detail, /README\.md/, "the dirty file is named");

  sh("git", ["checkout", "--", "README.md"], w.work, w.gitEnv);
  fs.mkdirSync(path.join(w.work, ".cw", "runs"), { recursive: true });
  const r2 = doctor(w, [VERSION, "--json"]);
  assert.equal(r2.code, 0, "a gitignored .cw/ only warns");
  const cw = byId(json(r2), "cw-dir");
  assert.equal(cw.status, "warn");
  assert.match(cw.fix, /^rm -rf .*\.cw$/, "the rm -rf hint is given");
  assert.match(cw.message, /gitignored/);
}

// ---- Case: missing reviewer binary (the ENOENT-after-the-gate incident) -----
{
  const w = world();
  const r = doctor(w, [VERSION, "--json"], { CW_AGENT_COMMAND: path.join(w.root, "nope", "grok-review") + " -p {{input}}" });
  assert.equal(r.code, 1, "a reviewer binary that does not exist must fail");
  const c = byId(json(r), "reviewer");
  assert.equal(c.status, "fail");
  assert.match(c.message, /grok-review.*not an executable file/);
  assert.match(c.fix, /CW_AGENT_COMMAND=/);

  const notOnPath = doctor(w, [VERSION, "--json"], { CW_AGENT_COMMAND: "no-such-reviewer-cli-xyz -p {{input}}" });
  assert.equal(notOnPath.code, 1);
  assert.match(byId(json(notOnPath), "reviewer").message, /not an executable file on PATH/);

  fs.chmodSync(w.reviewer, 0o644);
  const notExec = doctor(w, [VERSION, "--json"]);
  assert.equal(notExec.code, 1, "a reviewer file without the exec bit must fail");
  assert.equal(byId(json(notExec), "reviewer").status, "fail");

  const none = doctor(w, [VERSION, "--json"], { CW_AGENT_COMMAND: undefined });
  assert.equal(none.code, 1, "no reviewer configured must fail");
  assert.match(byId(json(none), "reviewer").message, /no reviewer agent configured/);
}

// ---- Case: signing key file missing while the pubkey is committed ----------
{
  const w = world();
  const unset = doctor(w, [VERSION, "--json"], { CW_RELEASE_VERDICT_PRIVKEY: undefined });
  assert.equal(unset.code, 1, "pubkey committed + no key set must fail");
  assert.match(byId(json(unset), "signing-key").message, /requires a SIGNED verdict/);

  const missing = path.join(w.root, "gone.key");
  const r = doctor(w, [VERSION, "--json"], { CW_RELEASE_VERDICT_PRIVKEY: missing });
  assert.equal(r.code, 1, "a key path that does not exist must fail");
  const c = byId(json(r), "signing-key");
  assert.equal(c.status, "fail");
  assert.ok(!r.out.includes(missing) && !r.err.includes(missing), "the env value is never echoed");

  const dir = doctor(w, [VERSION, "--json"], { CW_RELEASE_VERDICT_PRIVKEY: w.root });
  assert.equal(dir.code, 1, "a directory is not a key file");
  assert.match(byId(json(dir), "signing-key").message, /not a regular file/);
}

// ---- Case: warnings only — identity, gh, an already-cut tag -----------------
{
  const w = world();
  sh("git", ["config", "user.email", "someone@example.com"], w.work, w.gitEnv);
  sh("git", ["tag", "-a", `v${VERSION}`, "-m", "cut"], w.seed, w.gitEnv);
  sh("git", ["push", "-q", "origin", `refs/tags/v${VERSION}`], w.seed, w.gitEnv);
  const r = doctor(w, [VERSION, "--json"], { GH_STUB_FAIL: "1" });
  assert.equal(r.code, 0, `warnings alone must not fail the doctor:\n${r.err}`);
  const res = json(r);
  const id = byId(res, "git-identity");
  assert.equal(id.status, "warn");
  assert.match(id.message, /GH007/);
  assert.equal(id.fix, 'git config user.email "<id>+<login>@users.noreply.github.com"');
  assert.equal(byId(res, "gh").status, "warn");
  const tag = byId(res, "tag-remote");
  assert.equal(tag.status, "warn", "an already-cut tag is a resume, not a failure, for the doctor");
  assert.match(tag.message, /resumes it at stage 3/);

  sh("git", ["config", "--unset", "user.email"], w.work, w.gitEnv);
  const noId = doctor(w, [VERSION, "--json"]);
  assert.equal(noId.code, 1, "an unset user.email must fail");
  assert.equal(byId(json(noId), "git-identity").status, "fail");
}

// ---- Case: every problem at once, not one at a time ------------------------
{
  const w = world();
  fs.writeFileSync(path.join(w.work, "README.md"), "edited\n");
  const r = doctor(w, [VERSION, "--json"], {
    CW_AGENT_COMMAND: "/nonexistent/grok-review -p {{input}}",
    CW_RELEASE_VERDICT_PRIVKEY: undefined
  });
  assert.equal(r.code, 1);
  const res = json(r);
  assert.equal(res.failures, 3, "dirty tree + reviewer + signing key reported in ONE run");
  for (const id of ["clean-tree", "reviewer", "signing-key"]) assert.equal(byId(res, id).status, "fail");
  assert.match(r.err, /NOT ready — 3 problems/);
}

// ---- Case: usage --------------------------------------------------------------
{
  const w = world();
  const r = doctor(w, ["--bogus"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /unknown flag --bogus/);
  const bad = doctor(w, ["1.2", "--json"]);
  assert.equal(bad.code, 1, "a malformed version must fail");
  assert.equal(byId(json(bad), "version").status, "fail");
}

// ---- Case: `npm run release` runs the same checks FIRST ---------------------
// A copy of release-oneclick.mjs sits in the fixture (its repoRoot is derived
// from its own path). With a dirty tree and a missing reviewer it must stop in
// stage 0 and name BOTH problems — before release-flow.mjs (absent from the
// fixture) or any bump/cut stage is reached.
{
  const w = world();
  fs.writeFileSync(path.join(w.work, "README.md"), "edited\n");
  const env = { ...w.env, CW_AGENT_COMMAND: "/nonexistent/grok-review -p {{input}}" };
  const r = spawnSync(process.execPath, [path.join(w.work, "plugins", "cool-workflow", "scripts", "release-oneclick.mjs"), VERSION], {
    cwd: w.work,
    encoding: "utf8",
    env,
    shell: false
  });
  assert.equal(r.status, 1, `oneclick must stop in stage 0:\n${r.stderr}`);
  assert.match(r.stdout, /\[0\/4\] preflight/);
  assert.doesNotMatch(r.stdout, /\[1\/4\]|\[2\/4\]|\[3\/4\]/, "no later stage may start");
  assert.match(r.stderr, /release-oneclick: FAIL clean-tree/);
  assert.match(r.stderr, /release-oneclick: FAIL reviewer/);
  assert.match(r.stderr, /preflight failed — 2 problem\(s\)/);
  assert.match(r.stderr, /npm run release:doctor -- 1\.2\.3/);
  assert.ok(!fs.existsSync(w.ranMarker), "the reviewer must never run");
}

process.stdout.write("release-doctor-smoke: ok (stale branch, dirty tree, reviewer binary, signing key file, identity/gh/tag warnings, all-at-once report, oneclick stage 0)\n");
