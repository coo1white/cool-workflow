#!/usr/bin/env node
"use strict";

// run-link-smoke (run <-> PR linkage) — proves `cw run link`:
//   1. Adding a link records it on the run record; `--kind` defaults to
//      "pr"; the actor falls back to "cw" when not given.
//   2. `run show` and `report.md` render a "## Links" section only when a
//      run has one or more links; an empty run's report has no such
//      section at all (not even an empty one).
//   3. `run export` carries links for free (they live in the run record).
//   4. The same url added twice is an idempotent no-op: one entry stays.
//   5. A bad run id fails closed (non-zero exit, no stdout, no write).
//   6. The MCP tool (cw_run_link, called in-process) gives the same shape
//      as the CLI path.

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const { callTool } = require(path.join(pluginRoot, "dist", "mcp", "dispatch"));

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds an anchored, whole-line regex matching the exact shape `renderLinks`
// (src/shell/report.ts) writes for one link record, so a match proves the
// link is rendered as its own well-formed line — not just that the url
// string appears somewhere in the file.
function linkLineRegex(link) {
  const note = link.note ? ` — ${escapeRegExp(link.note)}` : "";
  const pattern = `^- \\[${escapeRegExp(link.kind)}\\] ${escapeRegExp(link.url)}${note} \\(added ${escapeRegExp(link.addedAt)} by ${escapeRegExp(link.actor)}\\)$`;
  return new RegExp(pattern, "m");
}

function freshRepo(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cw-run-link-${label}-`)));
}

function plan(repo, question) {
  const stdout = execFileSync(node, [cli, "plan", "architecture-review", "--repo", repo, "--question", question], { cwd: repo, encoding: "utf8" });
  return JSON.parse(stdout).runId;
}

function cw(repo, args) {
  return spawnSync(node, [cli, ...args, "--cwd", repo, "--json"], { encoding: "utf8" });
}

function cwOk(repo, args) {
  const result = cw(repo, args);
  assert.equal(result.status, 0, `cw ${args.join(" ")} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function main() {
  const repo = freshRepo("main");
  const runId = plan(repo, "prove run <-> PR linkage");

  // ---- 1. add a link; kind/actor default ---------------------------------
  const first = cwOk(repo, ["run", "link", runId, "--url", "https://forge.example/pr/42"]);
  assert.equal(first.added, true, "a new url is added");
  assert.equal(first.link.url, "https://forge.example/pr/42");
  assert.equal(first.link.kind, "pr", "kind defaults to pr");
  assert.equal(first.link.actor, "cw", "actor falls back to cw when not given");
  assert.match(first.link.addedAt, ISO_RE, "addedAt is a real timestamp");
  assert.equal(first.links.length, 1);

  // ---- 4. the same url again is an idempotent no-op -----------------------
  const repeat = cwOk(repo, ["run", "link", runId, "--url", "https://forge.example/pr/42", "--note", "ignored"]);
  assert.equal(repeat.added, false, "the same url a second time is a no-op");
  assert.equal(repeat.links.length, 1, "still one entry");
  assert.equal(repeat.link.actor, "cw", "the FIRST entry is kept, not overwritten");

  // ---- a second, different link, with kind/note/actor set -----------------
  const second = cwOk(repo, ["run", "link", runId, "--url", "https://tracker.example/ISSUE-9", "--kind", "issue", "--note", "root cause", "--actor", "alice"]);
  assert.equal(second.added, true);
  assert.equal(second.link.kind, "issue");
  assert.equal(second.link.note, "root cause");
  assert.equal(second.link.actor, "alice");
  assert.equal(second.links.length, 2);

  // ---- 2a. run show renders the links only when present --------------------
  const shown = cwOk(repo, ["run", "show", runId]);
  assert.equal(shown.record.links.length, 2, "run show carries both links");
  const shownText = execFileSync(node, [cli, "run", "show", runId, "--cwd", repo], { encoding: "utf8" });
  assert.match(shownText, /links: pr:https:\/\/forge\.example\/pr\/42, issue:https:\/\/tracker\.example\/ISSUE-9/, "human run show prints both links");

  // ---- 2b. report.md renders "## Links" only when links exist -------------
  const reported = cwOk(repo, ["report", runId]);
  const reportBody = fs.readFileSync(reported.path, "utf8");
  assert.ok(reportBody.includes("## Links"), "report.md has a Links section");
  assert.match(reportBody, linkLineRegex(first.link), "report.md renders the first link as its own well-formed line");
  assert.match(reportBody, linkLineRegex(second.link), "report.md renders the second link as its own well-formed line");

  const bareRepo = freshRepo("bare");
  const bareRunId = plan(bareRepo, "no links here");
  const bareReported = cwOk(bareRepo, ["report", bareRunId]);
  const bareReportBody = fs.readFileSync(bareReported.path, "utf8");
  assert.ok(!bareReportBody.includes("## Links"), "a run with no links renders no Links section at all");

  // ---- 3. run export carries links for free --------------------------------
  const exported = cwOk(repo, ["run", "export", runId]);
  const archive = JSON.parse(fs.readFileSync(exported.path, "utf8"));
  assert.deepEqual(
    archive.run.links.map((l) => l.url).sort(),
    ["https://forge.example/pr/42", "https://tracker.example/ISSUE-9"].sort(),
    "the exported run record carries both links"
  );

  // ---- 5. a bad run id fails closed -----------------------------------------
  const badId = cw(repo, ["run", "link", "no-such-run", "--url", "https://forge.example/pr/1"]);
  assert.notEqual(badId.status, 0, "a run id that will not load fails closed");
  assert.equal(badId.stdout, "", "no JSON is printed on a fail-closed error");

  const badUrl = cw(repo, ["run", "link", runId, "--url", "not-a-url"]);
  assert.notEqual(badUrl.status, 0, "a url that does not parse as http(s) fails closed");

  // ---- 6. the MCP tool (in-process) gives the same shape -------------------
  const mcpResult = callTool("cw_run_link", { runId, cwd: repo, url: "https://forge.example/pr/42" });
  assert.equal(mcpResult.added, false, "MCP path sees the same already-recorded link (idempotent)");
  assert.equal(mcpResult.links.length, 2, "MCP path reads the same two links the CLI path wrote");

  process.stdout.write("run-link-smoke: ok (link -> show -> report -> export round trip; idempotent re-link; fail-closed bad id/url; MCP parity)\n");
}

main();
