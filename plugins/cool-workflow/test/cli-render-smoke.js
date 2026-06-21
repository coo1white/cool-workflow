#!/usr/bin/env node
"use strict";

// cli-render-smoke -- the calm terminal presentation layer (v0.1.91): the cw-side Reporter
// (src/reporter.ts) and the zero-dep term primitives (truncate / findings table / color-env).
//
// Asserts the Step-3 constraints directly, deterministically, with NO live model:
//   * Reporter renders on a TTY (findings table + report path + status + transcript + next hint),
//     and is SILENT on a non-TTY (the human summary never pollutes piped/--json stdout).
//   * progress() is a thin write — the line is emitted verbatim (already styled by the caller).
//   * --full appends the report inline; a blocked no-agent run points at `cw doctor`.
//   * truncate is width-aware; color honors NO_COLOR / CW_NO_COLOR / FORCE_COLOR (the --no-color
//     flag sets CW_NO_COLOR), independent of isTTY.

const assert = require("node:assert/strict");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { createReporter } = require(path.join(pluginRoot, "dist", "reporter.js"));
const term = require(path.join(pluginRoot, "dist", "term.js"));
const { createRenderer } = require(path.join(pluginRoot, "scripts", "agents", "agent-adapter-core.js"));

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

const ANSI = /\x1b\[[0-9;]*m/g;
const plain = (s) => s.replace(ANSI, "");

/** A fake write stream that records everything written, with a settable isTTY. */
function fakeStream(isTTY) {
  const chunks = [];
  return {
    isTTY,
    write(s) { chunks.push(String(s)); return true; },
    get text() { return chunks.join(""); }
  };
}

/** Run fn with process.env patched, then restore EXACTLY (delete keys that were absent). */
function withEnv(patch, fn) {
  const saved = {};
  for (const k of Object.keys(patch)) saved[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined;
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

function testTruncateAndWidth() {
  assert.equal(term.truncate("abcdefghij", 5), "abcd…", "truncate cuts to maxWidth-1 + ellipsis");
  assert.equal(term.truncate("abc", 10), "abc", "truncate leaves short strings untouched");
  assert.equal(term.truncate("xy", 1), "…", "truncate to width 1 is just the ellipsis");
  assert.equal(term.truncate("anything", 0), "", "truncate to width 0 is empty");
  assert.equal(term.visibleWidth("\x1b[2mhi\x1b[0m"), 2, "visibleWidth ignores ANSI");
  assert.ok(!ANSI.test(term.stripAnsi("\x1b[32mok\x1b[0m")), "stripAnsi removes escapes");
  console.log("cli-render: truncate + visible-width OK");
}

function testColorEnv() {
  // NO_COLOR / CW_NO_COLOR disable color even on a TTY; FORCE_COLOR forces it even when piped.
  withEnv({ NO_COLOR: "1", CW_NO_COLOR: undefined, FORCE_COLOR: undefined }, () => {
    assert.equal(term.green("x", { isTTY: true }), "x", "NO_COLOR disables color on a TTY");
  });
  withEnv({ NO_COLOR: undefined, CW_NO_COLOR: "1", FORCE_COLOR: undefined }, () => {
    assert.equal(term.green("x", { isTTY: true }), "x", "CW_NO_COLOR (the --no-color flag) disables color");
  });
  withEnv({ NO_COLOR: undefined, CW_NO_COLOR: undefined, FORCE_COLOR: "1" }, () => {
    assert.ok(/\x1b\[32m/.test(term.green("x", { isTTY: false })), "FORCE_COLOR forces color when piped");
  });
  withEnv({ NO_COLOR: undefined, CW_NO_COLOR: undefined, FORCE_COLOR: undefined }, () => {
    assert.ok(!ANSI.test(term.green("x", { isTTY: false })), "default: no color when piped");
  });
  console.log("cli-render: color honors NO_COLOR / CW_NO_COLOR / FORCE_COLOR OK");
}

function testFindingsTable() {
  assert.equal(term.formatFindingsSummary([]), "", "no findings -> empty (caller prints nothing)");
  const rows = [
    { id: "F1", severity: "P1", classification: "real" },
    { id: "F2", severity: "P1", classification: "real" },
    { id: "F3", severity: "P2", classification: "conditional" }
  ];
  const out = plain(term.formatFindingsSummary(rows, { isTTY: false }));
  assert.match(out, /Findings:\s*3/, "headline counts total findings");
  assert.match(out, /2×P1/, "headline aggregates by severity");
  assert.match(out, /1×P2/, "headline aggregates the second severity");
  for (const r of rows) assert.ok(out.includes(r.id), `table lists ${r.id}`);
  assert.ok(!ANSI.test(term.formatFindingsSummary(rows, { isTTY: false })), "piped findings table carries no ANSI");
  console.log("cli-render: findings table OK");
}

function testReporterTty() {
  const findings = [{ id: "F1", severity: "P1", classification: "real" }, { id: "F2", severity: "P2", classification: "conditional" }];
  const s = fakeStream(true);
  createReporter(s).runSummary({
    runId: "RUN1",
    reportPath: "/tmp/run/report.md",
    status: "complete",
    completedWorkers: 2,
    plannedWorkers: 2,
    findings,
    runDir: "/tmp/run/.cw/runs/RUN1"
  });
  const out = plain(s.text);
  assert.match(out, /Report:\s*\/tmp\/run\/report\.md/, "prints the report path");
  assert.match(out, /Status:\s*complete/, "prints status");
  assert.match(out, /2\/2/, "prints worker counts");
  assert.match(out, /Findings:\s*2/, "prints the compact findings headline");
  assert.ok(out.includes("F1") && out.includes("F2"), "lists each finding id");
  assert.match(out, /Transcript:.*\/tmp\/run\/\.cw\/runs\/RUN1/, "points at the run dir (per-worker transcripts)");
  assert.match(out, /cw report RUN1 --show/, "offers the next command");
  console.log("cli-render: reporter TTY summary OK");
}

function testReporterNonTtySilent() {
  const s = fakeStream(false);
  createReporter(s).runSummary({
    runId: "RUN1",
    reportPath: "/tmp/run/report.md",
    status: "complete",
    completedWorkers: 1,
    plannedWorkers: 1,
    findings: [{ id: "F1", severity: "P1", classification: "real" }]
  });
  assert.equal(s.text, "", "the human summary is SILENT on a non-TTY (never pollutes piped/--json stdout)");
  console.log("cli-render: reporter non-TTY silence OK");
}

function testProgressThinWrite() {
  for (const isTTY of [true, false]) {
    const s = fakeStream(isTTY);
    createReporter(s).progress("[drive] ==> Map ✓ (6/6)");
    assert.equal(s.text, "[drive] ==> Map ✓ (6/6)\n", "progress writes the (already-styled) line verbatim + newline");
  }
  console.log("cli-render: progress thin-write OK");
}

function testFullAndBlocked() {
  const full = fakeStream(true);
  createReporter(full).runSummary({
    runId: "RUN2",
    reportPath: "/tmp/run/report.md",
    status: "complete",
    completedWorkers: 1,
    plannedWorkers: 1,
    findings: [],
    fullReport: "# Report\n\nFULL PROSE BODY"
  });
  const fullOut = plain(full.text);
  assert.match(fullOut, /full report/, "--full prints an inline-report divider");
  assert.ok(fullOut.includes("FULL PROSE BODY"), "--full prints the report body inline");

  const blocked = fakeStream(true);
  createReporter(blocked).runSummary({
    runId: "RUN3",
    reportPath: "/tmp/run/report.md",
    status: "blocked",
    agentConfigured: false,
    findings: []
  });
  const blockedOut = plain(blocked.text);
  assert.match(blockedOut, /Status:\s*blocked/, "surfaces the blocked status");
  assert.match(blockedOut, /cw doctor/, "no-agent blocked run points at the one recovery command");
  console.log("cli-render: --full inline + blocked-no-agent recovery OK");
}

function testCursorHygiene() {
  // The live AGENT renderer (agent-adapter-core) on an interactive (TTY) stream: hide the cursor
  // when the spinner starts, ALWAYS restore it when the live region stops. finishLive() routes
  // through the SAME stop() the SIGINT/SIGTERM handlers call — so Ctrl-C leaves a clean terminal.
  const s = fakeStream(true);
  s.columns = 80;
  const render = createRenderer({ env: {}, stderr: s });
  try {
    render.action("reading the repo…");
    assert.ok(s.text.includes(HIDE_CURSOR), "spinner start hides the cursor");
  } finally {
    render.finishLive(); // also clears the spinner interval so the test process can exit
  }
  assert.ok(s.text.includes(SHOW_CURSOR), "stopping the live region restores the cursor");
  // The restore must come AFTER a hide (no spurious show-without-hide), and the LAST cursor op
  // is a restore (the terminal is left visible).
  assert.ok(s.text.lastIndexOf(SHOW_CURSOR) > s.text.indexOf(HIDE_CURSOR), "cursor is restored after being hidden");
  console.log("cli-render: live-renderer cursor hygiene (hide on spinner, restore on stop) OK");
}

function main() {
  testTruncateAndWidth();
  testColorEnv();
  testFindingsTable();
  testReporterTty();
  testReporterNonTtySilent();
  testProgressThinWrite();
  testFullAndBlocked();
  testCursorHygiene();
  console.log("cli-render-smoke: ok");
}

main();
