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
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const { createReporter } = require(path.join(pluginRoot, "dist", "reporter.js"));
const term = require(path.join(pluginRoot, "dist", "term.js"));
const { createRenderer, truncate: coreTruncate, toolLabel, summarizeToolResult } = require(path.join(pluginRoot, "scripts", "agents", "agent-adapter-core.js"));

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

  // The wrapper-core carries its OWN truncate copy (it's a plain-JS config, can't import the TS
  // build). They MUST behave identically — assert it directly so the "can't drift" invariant is
  // real, not aspirational. Covers the edge cases the two copies historically diverged on.
  const cases = [["abcdefghij", 5], ["abc", 10], ["xy", 1], ["anything", 0], ["x", 0], ["hello", 1],
    ["\x1b[32mhi\x1b[0m", 5], ["\x1b[32mhello world\x1b[0m", 4], ["exact", 5], ["", 3]];
  for (const [t, w] of cases) {
    assert.equal(coreTruncate(t, w), term.truncate(t, w),
      `core truncate(${JSON.stringify(t)},${w}) must equal term truncate (no drift)`);
  }

  // Claude-tree labels: file tools show the basename, patterns/commands stay (truncated).
  assert.equal(toolLabel("Read", "/home/dev/src/foo.ts"), "Read(foo.ts)", "file tool -> basename");
  assert.equal(toolLabel("Edit", "a/b/c.ts"), "Edit(c.ts)", "edit -> basename");
  assert.equal(toolLabel("Glob", "**/*.ts"), "Glob(**/*.ts)", "glob pattern is NOT basenamed");
  assert.equal(toolLabel("Grep", "spawnSync"), "Grep(spawnSync)", "grep pattern kept");
  assert.equal(toolLabel("Bash", "x".repeat(60)).length <= "Bash()".length + 40, true, "long command truncated");
  assert.equal(toolLabel("Read", ""), "Read", "no arg -> just the tool name");

  // ⎿ result summaries (tool-aware, line-count based).
  assert.equal(summarizeToolResult("Read", "a\nb\nc\n"), "3 lines", "Read -> N lines");
  assert.equal(summarizeToolResult("Read", "only one"), "1 line", "singular line");
  assert.equal(summarizeToolResult("Grep", "m1\nm2"), "2 matches", "Grep -> N matches");
  assert.equal(summarizeToolResult("Glob", "a.ts\nb.ts\nc.ts"), "3 files", "Glob -> N files");
  assert.equal(summarizeToolResult("Bash", "exit 0"), "exit 0", "Bash single line -> that line");
  assert.equal(summarizeToolResult("Bash", "x", true), "error", "is_error -> error");
  console.log("cli-render: truncate + visible-width + core/term parity + toolLabel + result-summary OK");
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
    assert.ok(/\x1b\[32m/.test(term.green("x", { isTTY: false })), "FORCE_COLOR forces color when piped (human surfaces)");
  });
  withEnv({ NO_COLOR: undefined, CW_NO_COLOR: undefined, FORCE_COLOR: undefined }, () => {
    assert.ok(!ANSI.test(term.green("x", { isTTY: false })), "default: no color when piped");
  });
  console.log("cli-render: color honors NO_COLOR / CW_NO_COLOR / FORCE_COLOR OK");
}

function testMachineChannelByteExactUnderForceColor() {
  // The CONTRACT that actually matters: FORCE_COLOR may color HUMAN output, but the MACHINE/data
  // surfaces (--json via printJson, and the cw:result fence) must stay byte-exact — never ANSI.
  // printJson uses no term styling today; this guard catches any future regression that styles it.
  const r = spawnSync(process.execPath, [cli, "list", "--json"], {
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "1", NO_COLOR: "", CW_NO_COLOR: "" }
  });
  assert.equal(r.status, 0, `list --json exits 0 under FORCE_COLOR (stderr: ${r.stderr})`);
  assert.ok(!ANSI.test(r.stdout), "the --json machine channel carries ZERO ANSI even when FORCE_COLOR is set");
  JSON.parse(r.stdout); // throws if any chrome leaked into the data channel
  console.log("cli-render: --json machine channel stays byte-exact under FORCE_COLOR OK");
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

function testRollingWindowFold() {
  // The fix for the 0.1.91 "wall": completed tools do NOT each leave a permanent line — they fold
  // into a rolling window (current spinner + the last WINDOW=4 dimmed) that is REDRAWN in place, and
  // the worker collapses to ONE summary line at the end. Drive 6 tools through a fake TTY stream.
  const s = fakeStream(true);
  s.columns = 80;
  const render = createRenderer({ env: {}, stderr: s, label: "claude" });
  try {
    for (const t of ["Read(a.ts)", "Read(b.ts)", "Read(c.ts)", "Read(d.ts)", "Read(e.ts)", "Read(f.ts)"]) render.action(t);
    // In-place redraw (NOT append-only): the block is erased (clear-to-end + cursor-up) each frame.
    assert.ok(s.text.includes("\x1b[0J"), "the live block is erased + redrawn in place (clear-to-end)");
    assert.ok(/\x1b\[\d+A/.test(s.text), "cursor moves up to redraw the rolling block (not a growing wall)");
    // Claude-tree style: completed rows use ● bullets, the live row a ✶ sparkle — NOT the old ✓.
    assert.ok(s.text.includes("●"), "completed tools use the ● action bullet (Claude-tree)");
    assert.ok(/[✶✸✹✺]/.test(s.text), "the live row shows a sparkle 'thinking' glyph");
    assert.ok(!plain(s.text).includes("✓"), "no generic ✓ spinner-list glyph remains");
    // The FINAL rendered block = everything after the last erase. WINDOW=4, so the oldest folded away.
    const lastBlock = s.text.split("\x1b[0J").pop();
    assert.ok(!lastBlock.includes("a.ts"), "the oldest tool has folded OUT of the window");
    for (const t of ["c.ts", "d.ts", "e.ts", "f.ts"]) {
      assert.ok(lastBlock.includes(t), `the rolling window keeps the recent tool ${t}`);
    }
    assert.ok(lastBlock.split("\n").length <= 6, "the live region stays a compact few rows, never a wall");
  } finally {
    render.finishLive();
  }
  assert.match(plain(s.text), /● claude · 6 steps · /, "the worker collapses to a single ● summary line at the end");
  console.log("cli-render: rolling-window fold + Claude-tree glyphs + collapse-to-summary OK");
}

function testResultTreeLines() {
  // ⎿ tree lines: a tool's result folds in UNDER its ● bullet once the next action commits it.
  const s = fakeStream(true);
  s.columns = 80;
  const render = createRenderer({ env: {}, stderr: s, label: "claude" });
  try {
    render.action("Read(AGENTS.md)");
    render.result("245 lines");
    render.action("Grep(spawnSync)"); // commits the Read -> its ⎿ now renders in the block
    render.result("17 matches");
    const block = s.text.split("\x1b[0J").pop();
    assert.ok(block.includes("⎿"), "a ⎿ tree connector renders under a completed tool");
    assert.ok(block.includes("245 lines"), "the result summary renders in the block");
  } finally {
    render.finishLive();
  }
  console.log("cli-render: ⎿ tool-result tree lines OK");
}

const stripAllEsc = (x) => x.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

function testLiveWidthInvariant() {
  // Every emitted row MUST stay within the terminal width — a wrapped row would make blockRows
  // under-count the physical cursor movement and the in-place erase would corrupt/creep the block
  // (the P1 the adversarial review caught: the elapsed string grows past the live-line budget at >1min).
  const W = 40;
  const s = fakeStream(true);
  s.columns = W;
  const render = createRenderer({ env: {}, stderr: s, label: "claude" });
  try {
    render.action("Read(" + "a".repeat(120) + ".ts)");
    render.result("y".repeat(120));
    render.action("Bash(" + "x".repeat(200) + ")"); // long phrase fills the live-line budget
    const block = s.text.split("\x1b[0J").pop();
    for (const line of block.split("\n")) {
      const vis = [...stripAllEsc(line)].length;
      assert.ok(vis <= W, `every live row stays within the ${W}-col terminal (got ${vis}): ${JSON.stringify(stripAllEsc(line))}`);
    }
  } finally {
    render.finishLive();
  }
  console.log("cli-render: live rows never exceed terminal width (no wrap → no erase desync) OK");
}

function testBatchedResults() {
  // A turn that dispatches several tools before their results arrive: each result must attach to ITS
  // tool by id, so an earlier tool that already folded into the window keeps its ⎿ (the P2 fix).
  const s = fakeStream(true);
  s.columns = 80;
  const render = createRenderer({ env: {}, stderr: s, label: "claude" });
  try {
    render.action("Read(a.ts)", "id-a");
    render.action("Read(b.ts)", "id-b"); // commits A (id-a) into the window BEFORE its result arrives
    render.result("11 lines", false, "id-a"); // must still attach to the now-folded A, not to B
    const block = s.text.split("\x1b[0J").pop();
    assert.ok(block.includes("11 lines"), "a batched tool keeps its ⎿ result even after it folded in (keyed by id)");
  } finally {
    render.finishLive();
  }
  console.log("cli-render: batched tool_results keep each tool's ⎿ (keyed by tool_use_id) OK");
}

function main() {
  testTruncateAndWidth();
  testColorEnv();
  testMachineChannelByteExactUnderForceColor();
  testFindingsTable();
  testReporterTty();
  testReporterNonTtySilent();
  testProgressThinWrite();
  testFullAndBlocked();
  testCursorHygiene();
  testRollingWindowFold();
  testResultTreeLines();
  testLiveWidthInvariant();
  testBatchedResults();
  console.log("cli-render-smoke: ok");
}

main();
