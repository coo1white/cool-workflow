#!/usr/bin/env node
// commit-git-head — readGitHead gives exactly what `git rev-parse HEAD` gives, and
// readHeadFromFiles answers from the files only on the plain layout (a
// `.git` dir, HEAD a sha or a loose ref), handing every other layout to git
// (perf-ratchets PR 3).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { readGitHead, readHeadFromFiles } = require("../../dist/shell/commit");

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
};
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitHead = (cwd) => {
  try {
    return git(cwd, "rev-parse", "HEAD");
  } catch {
    return undefined;
  }
};
const commit = (repo, text) => {
  fs.writeFileSync(path.join(repo, "f.txt"), text);
  git(repo, "add", "-A");
  git(repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", text);
};

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-git-head-")));
try {
  // No repository at all: undefined, same as git.
  const bare = path.join(tmp, "not-a-repo");
  fs.mkdirSync(bare);
  if (gitHead(bare) === undefined) assert.equal(readGitHead(bare), undefined);

  // A plain repo with no commit yet: git fails, so undefined.
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q");
  assert.equal(readHeadFromFiles(repo), undefined, "no loose ref yet: ask git");
  assert.equal(readGitHead(repo), undefined);

  // Plain repo: files answer, and match git, from the top and a sub folder.
  commit(repo, "one");
  const sub = path.join(repo, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  for (const cwd of [repo, sub]) {
    assert.equal(readHeadFromFiles(cwd), gitHead(cwd), `files answer on the plain layout (${path.relative(tmp, cwd)})`);
    assert.equal(readGitHead(cwd), gitHead(cwd));
  }

  // A new commit between two reads: the second read sees it (nothing cached).
  const first = readGitHead(repo);
  commit(repo, "two");
  assert.notEqual(readGitHead(repo), first);
  assert.equal(readGitHead(repo), gitHead(repo));

  // Detached HEAD: HEAD holds the sha itself.
  git(repo, "checkout", "-q", "--detach", first);
  assert.equal(readHeadFromFiles(repo), first);
  assert.equal(readGitHead(repo), gitHead(repo));
  git(repo, "checkout", "-q", "-");

  // Packed ref only: files cannot answer, git does.
  git(repo, "pack-refs", "--all", "--prune");
  const branch = git(repo, "symbolic-ref", "--short", "HEAD");
  assert.equal(fs.existsSync(path.join(repo, ".git", "refs", "heads", branch)), false, "the loose ref is gone");
  assert.equal(readHeadFromFiles(repo), undefined, "packed ref: ask git");
  assert.equal(readGitHead(repo), gitHead(repo));

  // A linked worktree: `.git` is a file, so git answers.
  const worktree = path.join(tmp, "wt");
  git(repo, "worktree", "add", "-q", "--detach", worktree, first);
  assert.equal(readHeadFromFiles(worktree), undefined, "worktree .git file: ask git");
  assert.equal(readGitHead(worktree), first);

  // A GIT_* discovery variable changes what git would find: ask git.
  process.env.GIT_DIR = path.join(repo, ".git");
  try {
    assert.equal(readHeadFromFiles(repo), undefined);
  } finally {
    delete process.env.GIT_DIR;
  }

  // A symref chain in the loose ref file is not a sha: ask git.
  commit(repo, "three");
  const refFile = path.join(repo, ".git", "refs", "heads", branch);
  const tip = fs.readFileSync(refFile, "utf8").trim();
  fs.mkdirSync(path.join(repo, ".git", "refs", "heads", "x"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git", "refs", "heads", "x", "y"), `${tip}\n`);
  fs.writeFileSync(refFile, "ref: refs/heads/x/y\n");
  assert.equal(readHeadFromFiles(repo), undefined, "a ref that is not a sha: ask git");
  assert.equal(readGitHead(repo), gitHead(repo));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("commit-git-head: ok\n");
