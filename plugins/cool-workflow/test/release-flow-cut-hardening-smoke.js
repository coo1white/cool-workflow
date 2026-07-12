#!/usr/bin/env node
"use strict";

// release-flow-cut-hardening-smoke — pins two hardening fixes in
// scripts/release-flow.js:
//
//   Finding #13 (P2): reviewerPromptBody() returned "" when
//     agents/release-reviewer.md was missing, so the flow shipped the reviewer
//     an EMPTY review prompt (the reviewer gets only the candidate context and
//     no instructions). It must fail closed instead.
//
//   Finding #21 (P3): cut() ran three `git add` calls and ignored every exit
//     code, so a git-add failure (a read-only object store, a locked index)
//     was swallowed and only surfaced later as a confusing "verdict commit
//     failed". Each add must check its own exit code and die on failure.
//
// Both are exercised against a COPY of release-flow.js dropped into a throwaway
// git fixture, so the real repo (which always ships agents/release-reviewer.md)
// is never touched and no real cut mutates anything. The copied script resolves
// its own pluginRoot from __dirname, so a fixture with no agents/ spec, or a
// fixture whose `git` is a PATH shim that fails only the verdict `git add --`,
// reproduces each failure exactly. The shim is used instead of a read-only
// object store because git can defer the blob write to commit time, so a
// read-only store failed the add only ~9 times in 10 — the shim fails it every
// run, so this case exercises the per-add exit-code check deterministically.
//
// Portable: node + git only, isolated tmpdir. No real model, gh, or network.
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REAL_FLOW = path.resolve(__dirname, "..", "scripts", "release-flow.js");
assert.ok(fs.existsSync(REAL_FLOW), "release-flow.js must exist");

let caseId = 0;
function run(bin, args, cwd, env) {
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", env: env || process.env });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

// Absolute path to the real git binary, so the PATH shim below (a file named
// `git`, first on PATH) can delegate to it without recursing into itself.
function resolveRealGit() {
  const w = spawnSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" });
  const p = (w.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  assert.ok(p, "must resolve the real git binary");
  return p;
}

// A git fixture whose scripts/release-flow.js is a COPY of the real one, so its
// pluginRoot resolves to the fixture (not the real checkout).
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cw-cut-hard-${caseId++}-`));
  run("git", ["init", "-q", "-b", "work"], dir);
  run("git", ["config", "user.email", "t@t"], dir);
  run("git", ["config", "user.name", "t"], dir);
  run("git", ["config", "commit.gpgsign", "false"], dir);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.copyFileSync(REAL_FLOW, path.join(dir, "scripts", "release-flow.js"));
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "init"], dir);
  return dir;
}
function flowPath(dir) {
  return path.join(dir, "scripts", "release-flow.js");
}
function baseEnv(dir, extra = {}) {
  const home = path.join(dir, ".cw-home");
  const env = {
    ...process.env,
    CW_RELEASE_FLOW_GATE_CMD: "true", // stub the deterministic gate
    CW_NO_AUTO_AGENT: "1",
    CW_HOME: home,
    XDG_STATE_HOME: home
  };
  delete env.CW_RELEASE_VERDICT_PRIVKEY;
  delete env.CW_AGENT_COMMAND;
  delete env.CW_AGENT_ENDPOINT;
  return { ...env, ...extra };
}

// ---- Finding #13: a missing reviewer prompt file fails closed ---------------
// The fixture has NO agents/release-reviewer.md. reviewerPromptBody() runs in
// buildReviewerInput, BEFORE the reviewer is delegated, so this dies before any
// agent (or the dist agent-config loader) is reached. The unfixed code returned
// "" here and marched on into delegateReview, shipping an empty review prompt.
{
  const dir = fixture();
  const r = run("node", [flowPath(dir), "--check"], dir, baseEnv(dir));
  assert.equal(r.code, 1, "a missing reviewer prompt file must fail closed");
  assert.match(r.err, /reviewer prompt file (is missing|not found)/i,
    "must name the missing reviewer prompt file");
  assert.match(r.err, /release-reviewer\.md/, "must point at agents/release-reviewer.md");
  // Fail-first witness: the unfixed code instead reached delegateReview and
  // died at the dist agent-config load. The fix stops earlier, so that message
  // must NOT be what killed the run.
  assert.doesNotMatch(r.err, /cannot load dist\/shell\/agent-config\.js/,
    "the fix must stop at the empty-prompt check, before the reviewer is delegated");
}

// ---- Finding #13b: a present-but-empty reviewer prompt file also fails -------
// A file that is only YAML frontmatter (empty after the strip) is just as
// useless as a missing one; both must fail closed.
{
  const dir = fixture();
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(dir, "agents", "release-reviewer.md"), "---\nname: x\n---\n\n   \n");
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "empty reviewer spec"], dir);
  const r = run("node", [flowPath(dir), "--check"], dir, baseEnv(dir));
  assert.equal(r.code, 1, "an empty reviewer prompt file must fail closed");
  assert.match(r.err, /reviewer prompt file .*(empty|is missing|not found)/i,
    "must explain the empty review prompt");
}

// ---- Finding #21: cut()'s git add failures are surfaced, not swallowed ------
// A real cut stages the tracked bump surfaces (`git add -u`), then the verdict
// (`git add -- <verdict>`), then (when signed) the .sig. We drive the fixture's
// git through a PATH shim: a `git` first on PATH that fails ONLY the verdict
// stage (`git add -- ...`) and delegates every other command to the real git.
// So `git add -u` still succeeds and only the verdict add fails — every run.
// (A read-only object store was flaky here: git can defer the blob write to
// commit time, so the add sometimes succeeded and the failure surfaced later.)
// The unfixed cut ignored that exit code and only tripped later at "verdict
// commit failed"; the fix dies right at the failed add.
{
  const dir = fixture();
  // A non-empty reviewer prompt so #13 does not fire.
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(dir, "agents", "release-reviewer.md"),
    "---\nname: release-reviewer\n---\n\nReview the release candidate with zero trust.\n");
  // No-op bump/sync so cut() reaches the git add calls without a real bump.
  fs.writeFileSync(path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", scripts: { "bump:version": "true", "sync:project-index": "true" } }, null, 2) + "\n");
  // A minimal dist agent-config so delegateReview resolves the stub agent.
  fs.mkdirSync(path.join(dir, "dist", "shell"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dist", "shell", "agent-config.js"),
    "\"use strict\";\n" +
    "function resolveAgentConfig(flags, env) {\n" +
    "  const cmd = (flags && flags['agent-command']) || (env && env.CW_AGENT_COMMAND) || '';\n" +
    "  if (!cmd) return { source: 'none', command: '', endpoint: '', model: '' };\n" +
    "  return { source: 'env', command: cmd, endpoint: '', model: '' };\n" +
    "}\n" +
    "module.exports = { resolveAgentConfig };\n");
  // A stub reviewer agent that writes an APPROVED verdict for THIS HEAD.
  const agent = path.join(dir, "stub-agent.js");
  fs.writeFileSync(agent,
    "const fs = require('node:fs');\n" +
    "fs.writeFileSync(process.argv[2], 'APPROVED ' + process.env.STUB_SHA + '\\nstub: capability.\\n');\n" +
    "process.exit(0);\n");
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "cut fixture"], dir);
  const sha = run("git", ["rev-parse", "HEAD"], dir).out.trim();

  // The PATH shim: a `git` that fails ONLY `git add -- <path>` (the verdict/sig
  // stage) and passes everything else — including `git add -u` — to the real
  // git. This trips the failed verdict-add on EVERY run.
  const realGit = resolveRealGit();
  const shimDir = path.join(dir, "shim-bin");
  fs.mkdirSync(shimDir, { recursive: true });
  const shim = path.join(shimDir, "git");
  fs.writeFileSync(shim,
    "#!/usr/bin/env node\n" +
    "\"use strict\";\n" +
    "const { spawnSync } = require(\"node:child_process\");\n" +
    "const a = process.argv.slice(2);\n" +
    "// Fail ONLY the verdict/sig stage; `git add -u` and all other commands are real.\n" +
    "if (a[0] === \"add\" && a[1] === \"--\") {\n" +
    "  process.stderr.write(\"git-shim: refusing the verdict git add (simulated failed object write)\\n\");\n" +
    "  process.exit(1);\n" +
    "}\n" +
    "const r = spawnSync(process.env.CW_REAL_GIT, a, { stdio: \"inherit\" });\n" +
    "process.exit(r.status === null ? 1 : r.status);\n");
  fs.chmodSync(shim, 0o755);

  const env = baseEnv(dir, {
    CW_SKIP_VENDOR_PREFLIGHT: "1", // --cut runs the live vendor preflight otherwise
    STUB_SHA: sha,
    CW_AGENT_COMMAND: `node ${agent} {{result}}`,
    CW_REAL_GIT: realGit,
    PATH: `${shimDir}${path.delimiter}${process.env.PATH}`
  });
  const r = run("node", [flowPath(dir), "--cut", "--version", "99.99.99"], dir, env);
  assert.equal(r.code, 1, "a failed git add during the cut must fail the cut");
  assert.match(r.err, /git add of the verdict file failed/i,
    "the failed verdict `git add` must be surfaced by name, not swallowed");
  // Fail-first witness: the unfixed cut swallowed the add and only tripped
  // at the later commit — that must NOT be the message we die with now.
  assert.doesNotMatch(r.err, /verdict commit failed/i,
    "the fix must die at the failed add, before the commit step");
}

process.stdout.write("release-flow-cut-hardening-smoke: ok (missing/empty reviewer prompt fails closed; cut() surfaces a failed git add)\n");
