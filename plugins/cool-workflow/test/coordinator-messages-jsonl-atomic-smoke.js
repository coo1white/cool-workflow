#!/usr/bin/env node
"use strict";

// coordinator-messages-jsonl-atomic-smoke — pins that blackboard/messages.jsonl
// is written the same atomic temp+rename way every sibling record file is
// (index.json + the per-record *.json all go through fs-atomic's writeJson).
//
// Finding #18 (P3): persistBlackboardState wrote messages.jsonl with a bare
// fs.writeFileSync (in-place truncate) while its siblings used the atomic
// writeJson/writeTextDurable helper. An in-place truncate lets a crash or a
// concurrent reader see a torn/partial file; the atomic path writes a temp
// file and rename(2)s it over the target, so a reader sees old-or-new, never
// a half-written line.
//
// How this test tells the two apart WITHOUT crashing mid-write: an atomic
// temp+rename replaces the target with a FRESH inode on every write, while a
// bare in-place writeFileSync keeps the SAME inode (O_TRUNC re-uses the file).
// So we post two messages and check messages.jsonl's inode rotates between
// the two persists. index.json — a known-atomic sibling written on the same
// persist — is the control that proves the inode-rotation technique detects
// atomic writes in this environment.

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
const messagesInode1 = fs.statSync(messagesFile).ino;
const indexInode1 = fs.statSync(indexFile).ino;

// Second message → second persist rewrites both files.
runJson(["blackboard", "message", plan.runId, "--topic", "topic-atomic", "--body", "Second message for atomic check."]);
const messagesInode2 = fs.statSync(messagesFile).ino;
const indexInode2 = fs.statSync(indexFile).ino;

// Control: index.json is a known-atomic sibling. Its inode MUST rotate between
// the two persists — this proves the inode-rotation test actually detects an
// atomic temp+rename in this environment.
assert.notEqual(
  indexInode2,
  indexInode1,
  "control failed: index.json (a known-atomic sibling) should get a fresh inode on each atomic write"
);

// The fix: messages.jsonl must be written the SAME atomic way, so its inode
// rotates too. A bare in-place fs.writeFileSync keeps the same inode and fails
// this assertion.
assert.notEqual(
  messagesInode2,
  messagesInode1,
  "messages.jsonl must be written atomically (temp+rename) like its siblings, so its inode rotates between persists"
);

// Byte-format guard: the file stays exactly one compact JSON object per line
// with a trailing newline (the atomic switch must not drift the bytes).
const raw = fs.readFileSync(messagesFile, "utf8");
assert.ok(raw.endsWith("\n"), "messages.jsonl must end with a trailing newline");
const lines = raw.slice(0, -1).split("\n");
assert.equal(lines.length, 2, "both posted messages must be present, one per line");
for (const line of lines) {
  const parsed = JSON.parse(line);
  assert.ok(parsed.id, "each messages.jsonl line must be a full message record");
}

process.stdout.write("coordinator-messages-jsonl-atomic-smoke: ok\n");
