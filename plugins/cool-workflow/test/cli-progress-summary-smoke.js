#!/usr/bin/env node
"use strict";

// cli-progress-summary-smoke — the golden-path "feel" gate (Part 3). Asserts the two
// Homebrew-grade UX surfaces added in 0.1.90, and — critically — that they NEVER leak
// into the data channel:
//
//   1. term.ts house style (unit): printSuccessSummary writes a clean Report:/Status:/
//      Next: block on a TTY, a `Try: cw doctor` recovery line when no agent is configured,
//      and is SILENT on a non-TTY stream (so piped/--json stdout can never be polluted).
//      phaseProgressLine renders `==> Map ✓ (6/6)` / `==> Assess ⇉ (3/6)`.
//   2. live phase progress (integration): a real drive with a deterministic STUB agent
//      emits `==> <Phase>` boundary lines on stderr, while `--json` stdout stays byte-clean
//      (parses; zero `==>` / `Report:` / ANSI-escape leakage).
//
// Vendor-agnostic: the worker is a local stub script, never a live model — the progress
// describes CW's OWN phases, so it reads identically for any agent backend.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const term = require(path.join(pluginRoot, "dist", "term.js"));
const cleanups = [];

// A stream stand-in: captures writes; `isTTY` decides whether helpers style/emit at all.
function fakeStream(isTTY) {
  const buf = [];
  return { isTTY, write: (s) => (buf.push(String(s)), true), text: () => buf.join("") };
}
// On a TTY the labels are ANSI-styled; strip codes so assertions match the human text.
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ===== 1a. printSuccessSummary on a TTY: clean Report:/Status:/Next: for a complete run =====
{
  const s = fakeStream(true);
  term.printSuccessSummary(
    { runId: "r-123", reportPath: "/tmp/p/report.md", status: "complete", completedWorkers: 14, plannedWorkers: 14 },
    s
  );
  const out = strip(s.text());
  assert.match(out, /Report: \/tmp\/p\/report\.md/, "complete run shows the report path");
  assert.match(out, /Status:.*complete.*14\/14/, "complete run shows status + N/N worker counts");
  assert.match(out, /Next: cw report r-123 --show/, "complete run points at the report verb");
  console.log("summary: complete run renders Report/Status/Next ok");
}

// ===== 1b. printSuccessSummary: a no-agent blocked run gets the `Try: cw doctor` recovery =====
{
  const s = fakeStream(true);
  term.printSuccessSummary(
    { runId: "r-9", reportPath: "/tmp/p/report.md", status: "blocked", completedWorkers: 0, plannedWorkers: 14, agentConfigured: false },
    s
  );
  const out = strip(s.text());
  assert.match(out, /Status:.*blocked.*0\/14/, "blocked run shows the blocked status + counts");
  assert.match(out, /Try: cw doctor/, "no agent configured => brew-style `Try: cw doctor` recovery");
  console.log("summary: no-agent blocked run renders `Try: cw doctor` ok");
}

// ===== 1c. printSuccessSummary is SILENT on a non-TTY stream (pipe/--json safety) =====
{
  const s = fakeStream(false);
  term.printSuccessSummary({ runId: "r-1", reportPath: "/tmp/p/report.md", status: "complete", completedWorkers: 1, plannedWorkers: 1 }, s);
  assert.equal(s.text(), "", "summary writes NOTHING when the stream is not a TTY (never pollutes a pipe)");
  console.log("summary: silent on a non-TTY stream ok");
}

// ===== 1d. phaseProgressLine renders the brew-style boundary line =====
{
  const plain = fakeStream(false); // non-TTY => no ANSI, easy to assert
  assert.equal(term.phaseProgressLine("Map", 6, 6, "parallel", plain), "==> Map ✓ (6/6)", "finished phase => ✓ + N/N");
  assert.equal(term.phaseProgressLine("Assess", 3, 6, "parallel", plain), "==> Assess ⇉ (3/6)", "active parallel phase => ⇉");
  assert.equal(term.phaseProgressLine("Verdict", 0, 1, "sequential", plain), "==> Verdict … (0/1)", "active sequential phase => …");
  console.log("summary: phaseProgressLine renders ==> Phase glyph (done/total) ok");
}

// ===== 2. integration: a real drive emits `==>` phase lines on stderr; --json stdout is clean =====
{
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-progress-")));
  cleanups.push(work);
  const repo = path.join(work, "repo");
  fs.mkdirSync(repo, { recursive: true });
  for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["commit.gpgsign", "false"]]) {
    spawnSync("git", ["-C", repo, "config", k, v], { encoding: "utf8" });
  }
  spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" });
  fs.writeFileSync(path.join(repo, "README.md"), "# proj\n", "utf8");
  fs.writeFileSync(path.join(repo, "app.ts"), "export const x = 1;\n", "utf8");
  spawnSync("git", ["-C", repo, "add", "-A"], { encoding: "utf8" });
  spawnSync("git", ["-C", repo, "commit", "-q", "-m", "init"], { encoding: "utf8" });

  // Deterministic stub agent: writes a cw:result fenced block, prints a usage line. No model.
  const stub = path.join(work, "stub.js");
  fs.writeFileSync(
    stub,
    [
      'const fs = require("fs");',
      "const fence = String.fromCharCode(96).repeat(3);",
      "const result = process.argv[2];",
      'fs.writeFileSync(result, "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + fence + "\\n");',
      'process.stdout.write(JSON.stringify({ model: "stub/agent", usage: { input_tokens: 1, output_tokens: 1 } }));'
    ].join("\n"),
    "utf8"
  );

  const agentCommand = `${process.execPath} ${stub} {{result}}`;
  const r = spawnSync(
    process.execPath,
    [cli, "-q", "what are the risks?", "-dir", repo, "--agent-command", agentCommand, "--json"],
    { cwd: work, encoding: "utf8", env: { ...process.env, CW_DRIVE_PROGRESS: "1", CW_NO_AUTO_AGENT: "1" } }
  );
  assert.equal(r.status, 0, `drive must complete: ${r.stderr}`);

  // stderr carries the phase-boundary progress (forced on via CW_DRIVE_PROGRESS=1).
  assert.match(r.stderr, /==> Map/, "stderr shows the Map phase boundary");
  assert.match(r.stderr, /==> Map ✓ \(\d+\/\d+\)/, "Map announces completion with N/N");
  assert.match(r.stderr, /==> Verdict ✓/, "stderr shows the terminal Verdict phase completing");

  // stdout is the DATA channel: valid JSON, and free of any human chrome / escapes.
  const parsed = JSON.parse(r.stdout); // throws if chrome leaked into stdout
  assert.equal(parsed.status, "complete", "the drive completed");
  assert.equal(parsed.completedWorkers, parsed.plannedWorkers, "all planned workers completed");
  assert.doesNotMatch(r.stdout, /==>/, "stdout has NO `==>` phase chrome");
  assert.doesNotMatch(r.stdout, /\bReport:/, "stdout has NO `Report:` summary chrome");
  assert.doesNotMatch(r.stdout, /\x1b\[/, "stdout has NO ANSI escape codes");
  console.log("summary: live `==>` progress on stderr + byte-clean --json stdout ok");
}

for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
console.log("cli-progress-summary-smoke: ok");
