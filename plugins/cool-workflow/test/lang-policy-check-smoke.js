"use strict";
// lang-policy-check-smoke — exercises scripts/lang-policy-check.js (the
// gate for the "JS/TS only" project rule) against throwaway git fixtures,
// plus one real-repo sanity check.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const pluginRoot = path.resolve(__dirname, "..");
const SCRIPT = path.join(pluginRoot, "scripts", "lang-policy-check.js");
assert.ok(fs.existsSync(SCRIPT), "lang-policy-check.js must exist");

function git(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
function freshRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-lang-policy-"));
  git(dir, ["init", "-q", "-b", "work"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}
function runCheck(dir) {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

// ---- 1. The real repo passes (sanity: the rule actually holds today) ----
{
  const r = runCheck(repoRoot);
  assert.equal(r.code, 0, `the real repo must pass its own language policy:\n${r.err}`);
  assert.match(r.out, /tracked files, all JS\/TS/);
}

// ---- 2. Only JS/TS + docs/config -> PASS ----
{
  const dir = freshRepo();
  write(dir, "src/index.ts", "export const x = 1;\n");
  write(dir, "scripts/run.js", "console.log(1);\n");
  write(dir, "README.md", "# hi\n");
  write(dir, "package.json", "{}\n");
  write(dir, ".gitignore", "node_modules\n");
  write(dir, "LICENSE", "MIT\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  const r = runCheck(dir);
  assert.equal(r.code, 0, `JS/TS + docs/config only must pass:\n${r.err}`);
}

// ---- 3. A stray .py file -> REJECT, named ----
{
  const dir = freshRepo();
  write(dir, "src/index.ts", "export const x = 1;\n");
  write(dir, "scripts/helper.py", "print('hi')\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  const r = runCheck(dir);
  assert.equal(r.code, 1, "a stray .py file must be rejected");
  assert.match(r.err, /scripts\/helper\.py \(\.py\)/, "should name the offending file and extension");
}

// ---- 4. A stray shell script -> REJECT (the exact class of file this rule
// was written to close off after the 2026-07-13 shell-to-node conversion) ----
{
  const dir = freshRepo();
  write(dir, "src/index.ts", "export const x = 1;\n");
  write(dir, "scripts/deploy.sh", "#!/usr/bin/env bash\necho hi\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  const r = runCheck(dir);
  assert.equal(r.code, 1, "a stray .sh file must be rejected");
  assert.match(r.err, /scripts\/deploy\.sh \(\.sh\)/);
}

// ---- 5. Exceptions are scoped to an EXACT path, not a whole directory or
// a bare extension -- the SAME extension at a DIFFERENT path must still
// reject, proving no accidental blanket allow. ----
{
  const dir = freshRepo();
  write(dir, "Formula/cool-workflow.rb", "class Foo < Formula\nend\n");
  write(dir, "scripts/other.rb", "puts 1\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  const r = runCheck(dir);
  assert.equal(r.code, 1, "a .rb file OUTSIDE the exact exception path must still be rejected");
  assert.match(r.err, /scripts\/other\.rb \(\.rb\)/);
  assert.doesNotMatch(r.err, /Formula\/cool-workflow\.rb/, "the exact exception path itself must not be flagged");
}

// ---- 6. An unrecognized extensionless file -> REJECT ----
{
  const dir = freshRepo();
  write(dir, "src/index.ts", "export const x = 1;\n");
  write(dir, "Makefile", "all:\n\techo hi\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  const r = runCheck(dir);
  assert.equal(r.code, 1, "an unrecognized extensionless file must be rejected");
  assert.match(r.err, /Makefile \(no extension\)/);
}

process.stdout.write("lang-policy-check-smoke: ok\n");
