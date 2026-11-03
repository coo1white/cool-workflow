#!/usr/bin/env node
// receipt-io-code-state — shell/receipt-io.ts readCodeState fails closed: when
// git diff fails, or an untracked file cannot be read, the code state is
// unknown (treeDigest null), never a digest of a fixed word. Two trees that
// could not be read must not match, so a receipt tied to one is refused
// (project/docs/intent/2026-10-16-release-gate-ci.md, third review of 0.4.0).

import assert from "node:assert/strict";
import { readCodeState } from "../../dist/shell/receipt-io.js";

const HEAD = "a".repeat(40);
const REPO = "/repo";

/** A fake git: HEAD, a status with one changed and one untracked file, and a diff. */
function fakeGit({ diffFails = false } = {}) {
  return (_repo, args) => {
    if (args[0] === "rev-parse" && args.includes("HEAD")) return `${HEAD}\n`;
    if (args[0] === "rev-parse" && args.includes("--show-prefix")) return "\n";
    if (args[0] === "status") return " M a.txt\0?? new.txt\0";
    if (args[0] === "diff") return diffFails ? undefined : "diff --git a/a.txt b/a.txt\n+x\n";
    return undefined;
  };
}

// The good case: every read works, so a real sha256 digest comes back.
{
  const state = readCodeState(REPO, { git: fakeGit(), fileDigest: () => "c".repeat(64) });
  assert.equal(state.gitHead, HEAD);
  assert.equal(state.dirty, true);
  assert.match(state.treeDigest, /^sha256:[0-9a-f]{64}$/);
}

// git diff fails: the code state is unknown.
{
  const state = readCodeState(REPO, { git: fakeGit({ diffFails: true }), fileDigest: () => "c".repeat(64) });
  assert.equal(state.gitHead, HEAD);
  assert.equal(state.treeDigest, null, "a failed git diff must give treeDigest null");
}

// An untracked file cannot be read: the code state is unknown.
{
  const state = readCodeState(REPO, { git: fakeGit(), fileDigest: () => undefined });
  assert.equal(state.treeDigest, null, "an unreadable untracked file must give treeDigest null");
}

// git status fails: the code state is unknown.
{
  const git = (repo, args) => (args[0] === "status" ? undefined : fakeGit()(repo, args));
  const state = readCodeState(REPO, { git, fileDigest: () => "c".repeat(64) });
  assert.equal(state.treeDigest, null, "a failed git status must give treeDigest null");
}

// Outside git (no HEAD): no git head and no digest.
{
  const state = readCodeState(REPO, { git: () => undefined, fileDigest: () => undefined });
  assert.deepEqual(state, { gitHead: null, treeDigest: null, dirty: false });
}

console.log("receipt-io-code-state: ok");
