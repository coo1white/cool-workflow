#!/usr/bin/env node
"use strict";

// coordinator-messages-jsonl-dirty-append-smoke — perf fix for
// persistBlackboardState (shell/coordinator-io.ts): before this fix, EVERY
// call re-sorted and re-serialized ALL of state.messages into
// messages.jsonl, even calls that never touched a message (7 of the 8
// call sites) and even when only ONE new message was added. Posting M
// messages cost O(M^2) total bytes written.
//
// The fix (persistBlackboardMessages / markBlackboardMessageDirty in
// coordinator-io.ts) adds dirty-id tracking for messages, parallel to the
// existing 5-kind dirty tracking for topics/contexts/artifacts/snapshots/
// decisions:
//   - a persist call that never pushed a message SKIPS messages.jsonl
//     entirely (no read, no sort, no write);
//   - a persist call that pushed messages APPENDS just the new lines
//     (durable, torn-tail-safe — the same durableAppendFileSync +
//     logEndsWithNewline mechanism PR #459 shipped for trust-audit's
//     events.jsonl), instead of resorting and rewriting the whole file;
//   - the ONE unsafe case (a caller-supplied custom id ties createdAt with
//     an earlier message and sorts BEFORE it) falls back to the exact old
//     full-resort-and-rewrite behavior, so the file is never left out of
//     order.
//
// This test proves all four shapes. (1) and (2) are the perf fix itself
// (fail before, pass after); (3) and (4) are correctness safety nets for
// the two ways an append-based fix could go wrong.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const coordinator = require(path.join(pluginRoot, "dist", "shell", "coordinator-io.js"));
const fsAtomic = require(path.join(pluginRoot, "dist", "shell", "fs-atomic.js"));
const { loadRunFromCwd } = require(path.join(pluginRoot, "dist", "shell", "run-store.js"));
const { plan: planApp } = require(path.join(pluginRoot, "dist", "shell", "pipeline.js"));
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist", "shell", "workflow-app-loader.js"));

// Records every fs-atomic write/append call made while `fn` runs, as
// { kind, file } pairs with resolved absolute paths. Same module-namespace-
// patch precedent as coordinator-topology-persist-dirty-tracking-smoke.js's
// countWrites (tsc-compiled CommonJS calls through the live require'd
// module object, so patching the property here intercepts coordinator-io.js's
// calls too).
function trackFsAtomicCalls(fn) {
  const calls = [];
  const originalWriteTextDurable = fsAtomic.writeTextDurable;
  const originalDurableAppend = fsAtomic.durableAppendFileSync;
  fsAtomic.writeTextDurable = function tracked(file, ...rest) {
    calls.push({ kind: "writeTextDurable", file: path.resolve(String(file)) });
    return originalWriteTextDurable.call(this, file, ...rest);
  };
  fsAtomic.durableAppendFileSync = function tracked(file, data) {
    calls.push({ kind: "durableAppendFileSync", file: path.resolve(String(file)), data });
    return originalDurableAppend.call(this, file, data);
  };
  try {
    fn();
  } finally {
    fsAtomic.writeTextDurable = originalWriteTextDurable;
    fsAtomic.durableAppendFileSync = originalDurableAppend;
  }
  return calls;
}

function messagesCalls(calls) {
  return calls.filter((call) => /[/\\]blackboard[/\\]messages\.jsonl$/.test(call.file));
}

// Sorted the same way cb.compareRecords sorts: (createdAt, id) byte compare.
function compareRecords(left, right) {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

function assertSortedNdjsonMatches(messagesFile) {
  const raw = fs.readFileSync(messagesFile, "utf8");
  if (raw === "") return raw;
  assert.ok(raw.endsWith("\n"), "messages.jsonl must end with a trailing newline");
  const lines = raw.slice(0, -1).split("\n");
  const parsed = lines.map((line) => JSON.parse(line));
  const resorted = [...parsed].sort(compareRecords).map((message) => JSON.stringify(message)).join("\n") + "\n";
  assert.equal(raw, resorted, "messages.jsonl bytes must be a correctly sorted resort+rewrite of its own content");
  return raw;
}

function freshRun(question) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-messages-dirty-append-"));
  const plan = planApp(loadWorkflowApp("architecture-review"), { repo: tmp, question });
  const runId = plan.id;
  const run = loadRunFromCwd(runId, tmp);
  const blackboardDir = path.join(tmp, ".cw", "runs", runId, "blackboard");
  return { tmp, run, blackboardDir, messagesFile: path.join(blackboardDir, "messages.jsonl") };
}

// Seeds run.blackboard.messages with N records AND writes messagesFile to
// match, WITHOUT marking anything dirty -- this stands in for a fresh
// process that loaded a run checkpoint whose state.messages already holds
// N prior messages, all of which are already correctly reflected on disk
// from earlier processes' persists (see coordinator-io.ts's note: every CLI
// call is its own OS process, so the in-memory dirty-tracking WeakMap is
// always empty at the start of a process; state.messages loaded from the
// checkpoint already contains every prior message). Deliberately does NOT
// go through postBlackboardMessage/persistBlackboardState, so the dirty
// tracker never sees these N records as new.
function seedBacklog(run, messagesFile, n) {
  const base = new Date("2020-01-01T00:00:00.000Z").getTime();
  const records = [];
  for (let i = 0; i < n; i++) {
    const createdAt = new Date(base + i).toISOString();
    const record = {
      schemaVersion: 1,
      id: `seed-msg-${String(i).padStart(6, "0")}`,
      createdAt,
      updatedAt: createdAt,
      runId: run.id,
      blackboardId: "bb-dirty",
      topicId: "topic-1",
      body: `seed message ${i}`,
      visibility: "public",
      status: "active",
      author: { kind: "operator", id: "seed" },
      links: {},
      linkedEvidenceRefs: [],
      linkedArtifactRefIds: [],
      linkedAuditEventIds: [],
      parentIds: [],
      tags: [],
      metadata: {}
    };
    run.blackboard.messages.push(record);
    records.push(record);
  }
  fs.mkdirSync(path.dirname(messagesFile), { recursive: true });
  fs.writeFileSync(messagesFile, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

// ---------------------------------------------------------------------
// 1. Write-count proof: an unrelated persist-triggering call (one that
//    never pushes a message) must not touch messages.jsonl at all.
//    Before the fix, EVERY persistBlackboardState call unconditionally
//    resorted and rewrote the whole file.
// ---------------------------------------------------------------------
{
  const { run, messagesFile } = freshRun("Prove messages.jsonl write-count skip.");
  coordinator.resolveBlackboard(run, { id: "bb-dirty", title: "Dirty Append" });
  coordinator.createBlackboardTopic(run, { id: "topic-1", blackboardId: "bb-dirty", title: "Topic 1" });

  const SEED_N = 3000;
  seedBacklog(run, messagesFile, SEED_N);
  assert.ok(fs.existsSync(messagesFile), "seeded backlog must be on disk before the no-op check");
  const beforeBytes = fs.statSync(messagesFile).size;

  const unrelatedCalls = trackFsAtomicCalls(() => {
    coordinator.putBlackboardContext(run, { topicId: "topic-1", blackboardId: "bb-dirty", kind: "fact", key: "release", value: "v1" });
  });
  assert.equal(messagesCalls(unrelatedCalls).length, 0, "putBlackboardContext must not touch messages.jsonl at all (no writeTextDurable, no durableAppendFileSync)");
  assert.equal(fs.statSync(messagesFile).size, beforeBytes, "messages.jsonl bytes on disk are unchanged by the unrelated call");

  process.stdout.write("  ok: unrelated persist skips messages.jsonl entirely\n");
}

// ---------------------------------------------------------------------
// 2. Append-not-rewrite proof: posting ONE message against a large
//    backlog appends exactly that one line via durableAppendFileSync,
//    never a writeTextDurable full rewrite. Final bytes still match an
//    independently-computed full resort+rewrite.
// ---------------------------------------------------------------------
{
  const { run, messagesFile } = freshRun("Prove messages.jsonl append-not-rewrite.");
  coordinator.resolveBlackboard(run, { id: "bb-dirty", title: "Dirty Append" });
  coordinator.createBlackboardTopic(run, { id: "topic-1", blackboardId: "bb-dirty", title: "Topic 1" });

  const SEED_N = 3000;
  seedBacklog(run, messagesFile, SEED_N);

  let message;
  const postCalls = trackFsAtomicCalls(() => {
    message = coordinator.postBlackboardMessage(run, { topicId: "topic-1", blackboardId: "bb-dirty", body: "the new message" });
  });
  const msgCalls = messagesCalls(postCalls);
  assert.equal(msgCalls.length, 1, "postBlackboardMessage must touch messages.jsonl exactly once");
  assert.equal(msgCalls[0].kind, "durableAppendFileSync", "the single messages.jsonl write must be an APPEND, not a full rewrite");
  assert.ok(msgCalls[0].data.includes(message.id), "the appended bytes contain the new message");
  assert.equal((msgCalls[0].data.match(/\n/g) || []).length, 1, "the append adds exactly one new line's worth of bytes (plus at most a leading boundary newline, none needed here)");

  const raw = assertSortedNdjsonMatches(messagesFile);
  const lineCount = raw.slice(0, -1).split("\n").length;
  assert.equal(lineCount, SEED_N + 1, "messages.jsonl has the backlog plus exactly the one new message");

  process.stdout.write("  ok: posting one message against a backlog appends only that message\n");
}

// ---------------------------------------------------------------------
// 3. Fallback-correctness proof: two messages that TIE on createdAt (a
//    mocked clock) with custom ids chosen so push order and
//    compareRecords order DISAGREE. The safety check must detect this
//    and fall back to the exact full-resort algorithm, so the final file
//    stays correctly sorted.
// ---------------------------------------------------------------------
{
  const { run, messagesFile } = freshRun("Prove messages.jsonl fallback correctness on a createdAt tie.");
  coordinator.resolveBlackboard(run, { id: "bb-dirty", title: "Dirty Append" });
  coordinator.createBlackboardTopic(run, { id: "topic-1", blackboardId: "bb-dirty", title: "Topic 1" });

  const RealDate = Date;
  const FIXED_ISO = "2021-06-01T00:00:00.000Z";
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(FIXED_ISO);
      else super(...args);
    }
    static now() {
      return new RealDate(FIXED_ISO).getTime();
    }
  }
  global.Date = FrozenDate;
  let first;
  let second;
  let fallbackCalls;
  try {
    // Pushed FIRST (so it lands first in state.messages / on disk), but its
    // id sorts AFTER "msg-aaa-tie" alphabetically -- push order and
    // compareRecords order disagree once "msg-aaa-tie" is posted next.
    first = coordinator.postBlackboardMessage(run, { id: "msg-zzz-tie", topicId: "topic-1", blackboardId: "bb-dirty", body: "pushed first, sorts last" });
    fallbackCalls = trackFsAtomicCalls(() => {
      second = coordinator.postBlackboardMessage(run, { id: "msg-aaa-tie", topicId: "topic-1", blackboardId: "bb-dirty", body: "pushed second, sorts first" });
    });
  } finally {
    global.Date = RealDate;
  }
  assert.equal(first.createdAt, second.createdAt, "both messages share the same (mocked) createdAt -- the tie this case exists to test");

  const msgCalls = messagesCalls(fallbackCalls);
  assert.equal(msgCalls.length, 1, "the second post touches messages.jsonl exactly once");
  assert.equal(msgCalls[0].kind, "writeTextDurable", "a createdAt tie where push order disagrees with sort order must fall back to a full rewrite, not an append");

  const raw = assertSortedNdjsonMatches(messagesFile);
  const ids = raw.slice(0, -1).split("\n").map((line) => JSON.parse(line).id);
  assert.deepEqual(ids, ["msg-aaa-tie", "msg-zzz-tie"], "the file is sorted by id on the createdAt tie, NOT by push order");

  process.stdout.write("  ok: a createdAt tie with disagreeing push/sort order falls back to a full, correctly-sorted rewrite\n");
}

// ---------------------------------------------------------------------
// 4. Torn-tail safety proof, mirroring trust-audit-torn-tail-append-smoke:
//    a crash-torn last line (missing trailing "\n") must not merge with
//    the next appended message.
// ---------------------------------------------------------------------
{
  const { run, messagesFile } = freshRun("Prove messages.jsonl torn-tail append safety.");
  coordinator.resolveBlackboard(run, { id: "bb-dirty", title: "Dirty Append" });
  coordinator.createBlackboardTopic(run, { id: "topic-1", blackboardId: "bb-dirty", title: "Topic 1" });

  const a = coordinator.postBlackboardMessage(run, { topicId: "topic-1", blackboardId: "bb-dirty", body: "first message" });

  const withNewline = fs.readFileSync(messagesFile, "utf8");
  assert.ok(withNewline.endsWith("\n"), "a completed append leaves messages.jsonl ending in a newline");
  fs.writeFileSync(messagesFile, withNewline.slice(0, -1)); // simulate a torn write
  assert.ok(!fs.readFileSync(messagesFile, "utf8").endsWith("\n"), "messages.jsonl now ends WITHOUT a newline (torn)");

  const b = coordinator.postBlackboardMessage(run, { topicId: "topic-1", blackboardId: "bb-dirty", body: "second message, after the torn tail" });

  const raw = fs.readFileSync(messagesFile, "utf8");
  const lines = raw.slice(0, -1).split("\n");
  assert.equal(lines.length, 2, "both messages must be parseable -- the torn tail must NOT have merged with the new message");
  const parsed = lines.map((line) => JSON.parse(line));
  assert.equal(parsed[0].id, a.id, "the first (torn-then-recovered) message is still its own parseable line");
  assert.equal(parsed[1].id, b.id, "the newly appended message is its own parseable line");

  process.stdout.write("  ok: a torn tail does not merge with the next appended message\n");
}

process.stdout.write("coordinator-messages-jsonl-dirty-append-smoke: ok\n");
