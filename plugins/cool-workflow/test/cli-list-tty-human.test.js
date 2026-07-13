#!/usr/bin/env node
"use strict";

// cli-list-tty-human.test — `cw list` printed a raw JSON array even for a
// person at a real interactive terminal. This pins the additive fix: a
// `jsonMode: "default"` row may declare a `humanRender` (the `list` row
// does), and cli/dispatch.ts renders it ONLY on a TTY stdout with no
// --json/--format json — every piped call keeps the exact JSON bytes
// (v2/conformance/cases/cli-json-mode.case.js pins those bytes end-to-end).
//
// Uses the same fakeStream({isTTY}) shape as
// test/workbench-serve-tty-hint.test.js: no real terminal, no spawned CLI.

const assert = require("node:assert/strict");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { formatWorkflowList } = require(path.join(pluginRoot, "dist", "core", "format", "help.js"));
const { shouldRenderHuman } = require(path.join(pluginRoot, "dist", "cli", "dispatch.js"));
const { REGISTRY } = require(path.join(pluginRoot, "dist", "core", "capability-table.js"));

function fakeStream(isTTY) {
  return { isTTY };
}

// ===== 1. formatWorkflowList is a pure function: exact text for a fixed payload =====
{
  const payload = [
    { id: "architecture-review", title: "Architecture Review", summary: "s1", file: "f1" },
    { id: "bug-hunt", title: "Bug Hunt", summary: "s2", file: "f2" },
  ];
  assert.equal(
    formatWorkflowList(payload),
    "architecture-review — Architecture Review\nbug-hunt — Bug Hunt\n\nUse cw info <id> for full details.",
    "formatWorkflowList renders one '<id> — <title>' line per workflow plus the footer"
  );
  console.log("cli-list-tty-human: formatWorkflowList renders the exact text ok");
}

// ===== 2. shouldRenderHuman is true ONLY for (default, no json flag, humanRender, TTY) =====
{
  assert.equal(shouldRenderHuman("default", {}, true, fakeStream(true)), true, "the one human combination");

  // Every other combination stays JSON/text (false):
  assert.equal(shouldRenderHuman("default", {}, true, fakeStream(false)), false, "non-TTY (piped) stays JSON");
  assert.equal(shouldRenderHuman("default", {}, true, fakeStream(undefined)), false, "isTTY undefined stays JSON");
  assert.equal(shouldRenderHuman("default", { json: true }, true, fakeStream(true)), false, "--json stays JSON even on a TTY");
  assert.equal(shouldRenderHuman("default", { format: "json" }, true, fakeStream(true)), false, "--format json stays JSON even on a TTY");
  assert.equal(shouldRenderHuman("default", {}, false, fakeStream(true)), false, "a row with no humanRender stays JSON");
  assert.equal(shouldRenderHuman("flag", {}, true, fakeStream(true)), false, "a flag-mode row never uses this path");
  assert.equal(shouldRenderHuman("human", {}, true, fakeStream(true)), false, "a human-mode row never uses this path");

  // Color envs must play no part in the decision: same answer either way
  // (cli-color-env.case.js pipes with FORCE_COLOR=1 and must stay JSON).
  const before = { FORCE_COLOR: process.env.FORCE_COLOR, NO_COLOR: process.env.NO_COLOR };
  process.env.FORCE_COLOR = "1";
  delete process.env.NO_COLOR;
  assert.equal(shouldRenderHuman("default", {}, true, fakeStream(false)), false, "FORCE_COLOR=1 never turns a pipe human");
  assert.equal(shouldRenderHuman("default", {}, true, fakeStream(true)), true, "FORCE_COLOR=1 never blocks a real TTY either");
  process.env.NO_COLOR = "1";
  assert.equal(shouldRenderHuman("default", {}, true, fakeStream(true)), true, "NO_COLOR=1 does not block the human rendering (it only strips style)");
  if (before.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = before.FORCE_COLOR;
  if (before.NO_COLOR === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before.NO_COLOR;
  console.log("cli-list-tty-human: shouldRenderHuman gates on exactly (default, no json, humanRender, TTY) ok");
}

// ===== 3. the list row actually declares the humanRender wired to formatWorkflowList =====
{
  const listRow = REGISTRY.find((row) => row.capability === "list");
  assert.ok(listRow && listRow.cli, "the list row must exist with a cli binding");
  assert.equal(typeof listRow.cli.humanRender, "function", "the list row declares a humanRender");
  const payload = [{ id: "a", title: "A" }];
  assert.equal(listRow.cli.humanRender(payload), formatWorkflowList(payload), "the list row's humanRender IS formatWorkflowList");
  console.log("cli-list-tty-human: the list row declares formatWorkflowList as its humanRender ok");
}

console.log("cli-list-tty-human.test: ok");
