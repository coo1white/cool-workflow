#!/usr/bin/env node
"use strict";

// cli-format-smoke: the CLI render helpers extracted from command-surface.ts into
// src/cli/format.ts are pure string formatters. Pin their output so the
// god-object extraction stays behaviour-preserving.

const assert = require("node:assert/strict");
const { humanBytes, formatClonesList, formatClonesGc, formatWorkbenchView } = require("../dist/cli/format");

// humanBytes: byte → human scale.
assert.equal(humanBytes(0), "0B");
assert.equal(humanBytes(512), "512B");
assert.equal(humanBytes(1024), "1.0KiB");
assert.equal(humanBytes(1536), "1.5KiB");
assert.equal(humanBytes(1048576), "1.0MiB");
assert.equal(humanBytes(1073741824), "1.0GiB");

// formatClonesList: empty vs populated.
assert.match(formatClonesList({ count: 0, clonesDir: "/c", entries: [], totalBytes: 0 }), /^No cached remote checkouts in \/c\.$/);
const list = formatClonesList({
  count: 1,
  clonesDir: "/c",
  totalBytes: 2048,
  entries: [{ kind: "git", bytes: 2048, fetchedAt: "2026-06-22T12:00:00.000Z", url: "https://x/y", ref: "main" }]
});
assert.match(list, /1 cached checkout — 2\.0KiB in \/c/);
assert.match(list, /KIND {7}SIZE {2}FETCHED/);
assert.match(list, /git/);
assert.match(list, /https:\/\/x\/y@main/);

// formatClonesGc: nothing vs reclaimed.
assert.match(
  formatClonesGc({ all: false, olderThanDays: 30, removed: [], keptCount: 3, clonesDir: "/c", freedBytes: 0 }),
  /Nothing to reclaim \(entries older than 30 day\(s\)\); 3 kept in \/c\./
);
assert.match(
  formatClonesGc({ all: true, olderThanDays: 0, removed: [{ bytes: 1024, url: "https://x/y" }], keptCount: 0, clonesDir: "/c", freedBytes: 1024 }),
  /Reclaimed 1 checkout \(all entries\) — freed 1\.0KiB; 0 kept/
);

// formatWorkbenchView: resolved + a present/absent panel.
const view = formatWorkbenchView({
  runId: "run-1",
  resolved: true,
  error: undefined,
  panels: { GRAPH: { graph: { status: "present", capability: "operator.graph" }, missing: { status: "absent", error: "unreadable" } } }
});
assert.match(view, /Workbench view run-1 \(resolved\)/);
assert.match(view, /graph: present — operator\.graph/);
assert.match(view, /missing: absent — absent \(unreadable\)/);

process.stdout.write("cli-format-smoke: ok\n");
