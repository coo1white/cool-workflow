#!/usr/bin/env node
"use strict";

// coordinator-messages-jsonl-atomic-smoke — pins two things about
// blackboard/messages.jsonl: (1) index.json is still written atomically
// (temp+rename) on every persist, and (2) messages.jsonl always ends up
// with the CORRECT, fully-sorted bytes, whichever of the two write paths
// (fast append or full-rewrite fallback — see persistBlackboardMessages in
// coordinator-io.ts) a given persist call takes.
//
// Finding #18 (P3, original scope): persistBlackboardState wrote
// messages.jsonl with a bare fs.writeFileSync (in-place truncate) while its
// siblings used the atomic writeJson/writeTextDurable helper. Fixed by
// routing messages.jsonl through the same atomic helper.
//
// A later perf fix (O(M^2) bytes written across M posts) changed the COMMON
// case from a full temp+rename rewrite every post to an append (durable,
// torn-tail-safe — see fs-atomic's durableAppendFileSync/
// logEndsWithNewline) that only touches the new message's own bytes. An
// append does NOT rotate the file's inode, so this test no longer uses
// inode-rotation to check messages.jsonl itself (it still uses it for
// index.json, which IS still a full atomic rewrite every call — that stays
// the control proving the inode-rotation technique works in this
// environment). Instead it proves messages.jsonl's bytes after the fast
// (append) path are IDENTICAL to what an independent full resort+rewrite
// of the same two message bodies would produce — i.e. the fast path never
// diverges from the correct sorted NDJSON bytes.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const node = process.execPath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-messages-jsonl-atomic-"));

function runJson(args) {
  return JSON.parse(
    execFileSync(node, [cli, ...args], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  );
}

const plan = runJson(["plan", "end-to-end-golden-path", "--repo", tmp, "--question", "Prove messages.jsonl atomic write."]);
runJson(["blackboard", "resolve", plan.runId, "--id", "bb-atomic", "--title", "Atomic messages smoke"]);
runJson(["blackboard", "topic", plan.runId, "--id", "topic-atomic", "--title", "Atomic", "--description", "Atomic write topic"]);

const blackboardDir = path.join(tmp, ".cw", "runs", plan.runId, "blackboard");
const messagesFile = path.join(blackboardDir, "messages.jsonl");
const indexFile = path.join(blackboardDir, "index.json");

// First message → first persist of messages.jsonl.
runJson(["blackboard", "message", plan.runId, "--topic", "topic-atomic", "--body", "First message for atomic check."]);
assert.ok(fs.existsSync(messagesFile), "messages.jsonl must exist after the first post");
const indexInode1 = fs.statSync(indexFile).ino;

// Second message → second persist rewrites index.json again (messages.jsonl
// takes the fast append path — see the header comment, no inode check for it).
runJson(["blackboard", "message", plan.runId, "--topic", "topic-atomic", "--body", "Second message for atomic check."]);
const indexInode2 = fs.statSync(indexFile).ino;

// Control: index.json is a known-atomic sibling. Its inode MUST rotate between
// the two persists — this proves the inode-rotation test actually detects an
// atomic temp+rename in this environment.
assert.notEqual(
  indexInode2,
  indexInode1,
  "control failed: index.json (a known-atomic sibling) should get a fresh inode on each atomic write"
);

// Byte-format guard: the file stays exactly one compact JSON object per line
// with a trailing newline.
const raw = fs.readFileSync(messagesFile, "utf8");
assert.ok(raw.endsWith("\n"), "messages.jsonl must end with a trailing newline");
const lines = raw.slice(0, -1).split("\n");
assert.equal(lines.length, 2, "both posted messages must be present, one per line");
const parsedMessages = lines.map((line) => {
  const parsed = JSON.parse(line);
  assert.ok(parsed.id, "each messages.jsonl line must be a full message record");
  return parsed;
});

// Correctness guard for the fast (append) path: the bytes on disk must be
// IDENTICAL to what an independent full resort+rewrite of the same message
// bodies would produce. If the append path ever diverged from the sorted
// order the old full-rewrite path always produced, this would catch it.
const independentlyResorted = [...parsedMessages]
  .sort((left, right) => (left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  .map((message) => JSON.stringify(message))
  .join("\n") + "\n";
assert.equal(raw, independentlyResorted, "messages.jsonl bytes must match an independently-computed full resort+rewrite");

process.stdout.write("coordinator-messages-jsonl-atomic-smoke: ok\n");
