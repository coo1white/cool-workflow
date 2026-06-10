#!/usr/bin/env node
"use strict";

// release-flow.js — portable, vendor-neutral release orchestrator.
//
// One script that runs the SAME gated release flow under any harness
// (Claude / Codex / Gemini / OpenCode) or a plain shell. It does NOT depend on
// any one host's agent-orchestration primitive — it is just node + git + the
// existing CW scripts. The only LLM step (the independent reviewer) is
// DELEGATED through CW's agent backend config (CW_AGENT_COMMAND / CW_AGENT_ENDPOINT),
// so whichever model you configure does the review. CW spawns the agent
// argv-style (shell:false), inherits the agent's own env/key, and imports no
// model SDK — the same red line as src/execution-backend.ts.
//
// Modes:
//   node release-flow.js [--check]                 gate + review, no mutation (default)
//   node release-flow.js --cut --version x.y.z [--push]
//                                                  also bump:version, commit verdict, tag, (push)
// Flags also accepted: --prev-tag <t>, --agent-command "...", --agent-model m, --dry-run
//
// Test seam: CW_RELEASE_FLOW_GATE_CMD overrides the deterministic gate command
// (default: `bash <thisdir>/release-gate.sh`) so the smoke can exercise the
// orchestration layer without re-running the full build/test suite.
//
// Zero dependency: node + git only.

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const { spawnSync } = require("node:child_process");

const scriptsDir = __dirname;
const pluginRoot = path.resolve(scriptsDir, "..");

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const MODE_CUT = has("--cut");
const DRY_RUN = has("--dry-run");
const PUSH = has("--push");
const cutVersion = val("--version");
const prevTagArg = val("--prev-tag");

function die(msg, extra) {
  process.stderr.write(`release-flow: ${msg}\n`);
  if (extra) process.stderr.write(`${extra}\n`);
  process.exit(1);
}
function say(msg) {
  process.stdout.write(`${msg}\n`);
}
function git(args, opts = {}) {
  const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", ...opts });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

// ---- repo + revision context ----------------------------------------------
const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
if (top.status !== 0) die("not inside a git work tree");
const repoRoot = top.stdout.trim();

const HEAD = git(["rev-parse", "HEAD"]).out;
// Previous tag, excluding any tag that already points at HEAD (so this works
// whether run before tagging or re-run on a freshly tagged commit — same fix
// as release-gate.sh).
function resolvePrevTag() {
  if (prevTagArg) return prevTagArg;
  const headTags = git(["tag", "--points-at", "HEAD"]).out.split("\n").filter(Boolean);
  let prev = git(["describe", "--tags", "--abbrev=0"]).out;
  if (prev && headTags.includes(prev)) prev = git(["describe", "--tags", "--abbrev=0", "HEAD^"]).out;
  return prev || "";
}
const PREV_TAG = resolvePrevTag();

// ---- 1. deterministic gate -------------------------------------------------
function runGate() {
  const override = (process.env.CW_RELEASE_FLOW_GATE_CMD || "").trim();
  say("[1/3] deterministic gate");
  let r;
  if (override) {
    // Test/override seam — run via the shell intentionally; this path is for
    // the smoke and operator overrides only, never the delegated agent.
    r = spawnSync(override, { cwd: repoRoot, encoding: "utf8", shell: true, stdio: "inherit" });
  } else {
    r = spawnSync("bash", [path.join(scriptsDir, "release-gate.sh")], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "inherit"
    });
  }
  if (r.status !== 0) die("deterministic gate FAILED — fix findings in normal cycles, do not retry the release here.");
}

// ---- 2. independent reviewer, delegated to the configured agent -------------
function reviewerPromptBody() {
  // Reuse the committed reviewer spec as the prompt; strip YAML frontmatter.
  const specPath = path.join(pluginRoot, "agents", "release-reviewer.md");
  let body = fs.existsSync(specPath) ? fs.readFileSync(specPath, "utf8") : "";
  body = body.replace(/^---[\s\S]*?---\n/, "");
  return body.trim();
}

function buildReviewerInput(resultPath) {
  const action = MODE_CUT ? `tag v${cutVersion || "<next>"}` : "check (no tag)";
  return [
    reviewerPromptBody(),
    "",
    "---",
    "## Release candidate context (derive/verify everything yourself)",
    `- HEAD: ${HEAD}`,
    `- Previous tag: ${PREV_TAG || "(none)"}`,
    `- Diff range: ${PREV_TAG ? `${PREV_TAG}..HEAD` : "(no previous tag)"}`,
    `- Proposed action: ${action}`,
    `- Repo root (run git here): ${repoRoot}`,
    "",
    "## Required output — write ONLY this file, nothing else",
    `Write your verdict to this exact path:`,
    `  ${resultPath}`,
    "First line MUST be exactly one of:",
    `  APPROVED ${HEAD}`,
    "  <one concrete sentence: the user-visible capability this ships>",
    "or:",
    "  REJECTED",
    "  <numbered gate failures with file:line references>",
    ""
  ].join("\n");
}

function substitute(arg, map) {
  return arg.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? String(map[k]) : m));
}

function delegateReview(resultPath, inputPath) {
  // Reuse the canonical agent-config resolver (flags > env > file).
  let resolveAgentConfig;
  try {
    ({ resolveAgentConfig } = require(path.join(pluginRoot, "dist", "agent-config.js")));
  } catch (e) {
    die("cannot load dist/agent-config.js — run `npm run build` first", String(e));
  }
  const cfg = resolveAgentConfig(
    { "agent-command": val("--agent-command"), "agent-model": val("--agent-model") },
    process.env
  );
  if (cfg.source === "none" || (!cfg.command && !cfg.endpoint)) {
    die(
      "no reviewer agent configured. Set one of:\n" +
      '  CW_AGENT_COMMAND="claude -p {{input}}"   (or codex exec / gemini -p / opencode run)\n' +
      "  CW_AGENT_ENDPOINT=https://...            (HTTP agent, e.g. DeepSeek)\n" +
      "  or pass --agent-command. CW delegates the review; it never runs a model itself."
    );
  }

  const subMap = {
    input: inputPath,
    manifest: inputPath,
    result: resultPath,
    workerDir: repoRoot,
    model: cfg.model || "",
    prompt: fs.readFileSync(inputPath, "utf8")
  };

  if (cfg.command) {
    const args = (cfg.args || []).map((a) => substitute(a, subMap));
    say(`[2/3] reviewer — delegating to: ${cfg.command} ${(cfg.args || []).join(" ")} (model: ${cfg.model || "unreported"})`);
    // RED LINE: argv-style, shell:false. The agent runs the model in its own
    // process and inherits its own credentials; CW holds none.
    const r = spawnSync(cfg.command, args, {
      cwd: repoRoot,
      env: { ...process.env },
      encoding: "utf8",
      timeout: cfg.timeoutMs || 600000,
      shell: false,
      stdio: "inherit"
    });
    if (r.status !== 0) die(`reviewer agent exited ${r.status === null ? "(timeout/no-exit)" : r.status} — no verdict trusted.`);
    return;
  }

  // Endpoint mode (e.g. DeepSeek HTTP): POST the prompt, write the response as
  // the verdict. The remote agent cannot write our local file, so we persist
  // its returned text ourselves.
  say(`[2/3] reviewer — POSTing to endpoint ${cfg.endpoint} (model: ${cfg.model || "unreported"})`);
  const body = JSON.stringify({ prompt: subMap.prompt, model: cfg.model, sha: HEAD });
  const lib = cfg.endpoint.startsWith("https:") ? https : http;
  const text = postSync(lib, cfg.endpoint, body, cfg.timeoutMs || 600000);
  if (text === null) die("reviewer endpoint call failed — no verdict trusted.");
  fs.writeFileSync(resultPath, text.endsWith("\n") ? text : `${text}\n`);
}

// Minimal synchronous-ish POST using a child node process would overcomplicate;
// use a blocking wait via Atomics on a SharedArrayBuffer-free approach: do a
// simple promise + deasync-free busy loop is not available, so use execFileSync
// with curl ONLY if present; otherwise instruct the operator to use command mode.
function postSync(lib, endpoint, body, timeoutMs) {
  const curl = spawnSync("curl", [
    "-sS", "--max-time", String(Math.ceil(timeoutMs / 1000)),
    "-X", "POST", "-H", "Content-Type: application/json",
    "--data-binary", body, endpoint
  ], { encoding: "utf8" });
  if (curl.error || curl.status !== 0) {
    process.stderr.write(curl.stderr || String(curl.error || "curl failed") + "\n");
    return null;
  }
  return curl.stdout || "";
}

function verifyVerdict(resultPath) {
  say("[3/3] verify verdict");
  if (!fs.existsSync(resultPath)) die(`no verdict written to ${path.relative(repoRoot, resultPath)} — fail closed.`);
  const text = fs.readFileSync(resultPath, "utf8");
  if (!/^APPROVED\b/m.test(text)) {
    die("verdict is not APPROVED — release blocked.", text.trim());
  }
  const cap = (text.split("\n")[1] || "").trim();
  return cap;
}

// ---- 3. optional cut (bump + commit verdict + tag + push) ------------------
function cut(resultPath, capability) {
  if (!cutVersion || !/^\d+\.\d+\.\d+$/.test(cutVersion)) die("--cut requires --version x.y.z");
  if (DRY_RUN) { say(`[dry-run] would: bump:version ${cutVersion}, commit verdict, tag v${cutVersion}${PUSH ? ", push" : ""}`); return; }
  const bump = spawnSync("npm", ["run", "bump:version", "--", cutVersion], { cwd: pluginRoot, encoding: "utf8", stdio: "inherit" });
  if (bump.status !== 0) die("bump:version failed");
  // Regenerate the gated project index after the version bump (PR #87 gate).
  spawnSync("npm", ["run", "sync:project-index", "--", "--repo-only"], { cwd: pluginRoot, stdio: "inherit" });
  git(["add", "-A"]);
  const commit = git(["commit", "-m", `chore(release): record APPROVED reviewer verdict for v${cutVersion}`]);
  if (commit.code !== 0) die("verdict commit failed", commit.err);
  const tag = git(["tag", "-a", `v${cutVersion}`, "-m", `v${cutVersion}: ${capability || "release"}`]);
  if (tag.code !== 0) die("git tag failed", tag.err);
  if (PUSH) {
    git(["push", "origin", "HEAD"]);
    git(["push", "origin", `v${cutVersion}`]);
  }
  say(`tagged v${cutVersion}${PUSH ? " and pushed" : " (local only; push when ready)"}`);
}

// ---- main ------------------------------------------------------------------
function main() {
  if (!HEAD) die("could not resolve HEAD");
  const markerDir = path.join(repoRoot, ".cw-release");
  fs.mkdirSync(markerDir, { recursive: true });
  const resultPath = path.join(markerDir, `review-${HEAD}.verdict`);
  const inputPath = path.join(markerDir, `review-input-${HEAD}.md`);

  runGate();
  fs.writeFileSync(inputPath, buildReviewerInput(resultPath));
  delegateReview(resultPath, inputPath);
  const capability = verifyVerdict(resultPath);

  if (MODE_CUT) cut(resultPath, capability);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: MODE_CUT ? "cut" : "check",
    head: HEAD,
    prevTag: PREV_TAG || null,
    verdict: "APPROVED",
    capability,
    tagged: MODE_CUT && !DRY_RUN ? `v${cutVersion}` : null
  }, null, 2)}\n`);
}

main();
