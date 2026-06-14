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
//                                                  also bump:version, commit verdict, tag,
//                                                  (push), and — when --push — create the
//                                                  GitHub Release for the tag (idempotent;
//                                                  opt out with --no-release)
//   node release-flow.js --release --version x.y.z create-or-skip the GitHub Release for an
//                                                  already-pushed tag (backfill); no gate/cut.
//                                                  Fails closed if gh can't create it; add
//                                                  --soft for best-effort (skip-not-fail).
// Flags also accepted: --prev-tag <t>, --agent-command "...", --agent-model m, --dry-run
//
// Test seams (smoke/operator only, never the delegated agent):
//   CW_RELEASE_FLOW_GATE_CMD  overrides the deterministic gate command
//     (default: `bash <thisdir>/release-gate.sh`) so the smoke can exercise the
//     orchestration layer without re-running the full build/test suite.
//   CW_RELEASE_FLOW_GH_CMD    overrides the `gh` binary (single executable token,
//     spawned shell:false) so the smoke can stub GitHub Release calls offline.
//
// Zero dependency for the gated flow: node + git only. The GitHub Release step
// additionally uses `gh` WHEN PRESENT; it lives ONLY in the human --cut --push /
// --release paths (never a gate/CI path) and SKIPS — never fails the cut — when gh
// is absent. A Release is distribution upside layered on the already-pushed tag and
// the provenance-attested npm publish, not a correctness gate.

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
const MODE_RELEASE = has("--release");
const DRY_RUN = has("--dry-run");
const PUSH = has("--push");
const NO_RELEASE = has("--no-release");
const SOFT = has("--soft");
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
  const lines = text.split(/\r?\n/);
  const firstLine = lines[0] || "";
  if (firstLine !== `APPROVED ${HEAD}`) {
    die(`verdict first line must be exactly "APPROVED ${HEAD}" — release blocked.`, text.trim());
  }
  const cap = (lines[1] || "").trim();
  return cap;
}

// ---- GitHub Release (optional, presentation/distribution) ------------------
// NOT a correctness gate: the load-bearing artifacts (the tag + the
// provenance-attested npm publish) already exist when this runs. So `gh` is NOT
// part of the node/git portability floor — it runs ONLY in the human --cut --push
// / --release paths (never a gate/CI path), and an absent/erroring gh SKIPS with a
// stderr note rather than failing the cut. Test seam: CW_RELEASE_FLOW_GH_CMD swaps
// the `gh` binary for a stub (single executable token; always spawned shell:false).
const GH_BIN = (process.env.CW_RELEASE_FLOW_GH_CMD || "gh").trim();

function gh(args, opts = {}) {
  // shell:false is AFTER the spread so no caller can override the red line.
  return spawnSync(GH_BIN, args, { cwd: repoRoot, encoding: "utf8", ...opts, shell: false });
}

// gh present AND authenticated. Absent/unauth → false (caller skips, not fails).
function ghReady() {
  const v = gh(["--version"]);
  if (v.error || v.status !== 0) return false;
  const auth = gh(["auth", "status"]);
  return !auth.error && auth.status === 0;
}

function repoSlug() {
  const url = git(["remote", "get-url", "origin"]).out;
  const m = url.match(/github\.com[:/]+([^/]+?)\/(.+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// The previous release tag relative to a SPECIFIC tag (not HEAD) — for the
// compare link in the notes.
function prevTagOf(version) {
  return git(["describe", "--tags", "--abbrev=0", `v${version}^`]).out || "";
}

// Extract the `## <version>` section body from the CHANGELOG AS SHIPPED AT THE
// TAG (git show), so the notes reflect what that tag actually carried.
function changelogSection(version) {
  const show = git(["show", `v${version}:CHANGELOG.md`]);
  if (show.code !== 0 || !show.out) return "";
  const lines = show.out.split(/\r?\n/);
  const esc = version.replace(/\./g, "\\.");
  const startRe = new RegExp(`^## \\[?${esc}\\b`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (startRe.test(lines[i])) { start = i; break; }
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
  return lines.slice(start + 1, end).join("\n").trim();
}

// Resolve the reviewed content commit + capability from the COMMITTED verdict at
// the tag, mirroring release-gate.yml's HEAD-or-HEAD~1 tolerance: the verdict is
// named for the reviewed content commit, which is the tag commit or its parent.
function verdictForTag(version) {
  const tagCommit = git(["rev-list", "-n1", `v${version}`]).out;
  const parent = git(["rev-parse", `v${version}^`]).out;
  for (const sha of [tagCommit, parent].filter(Boolean)) {
    const rel = `.cw-release/review-${sha}.verdict`;
    const show = git(["show", `v${version}:${rel}`]);
    if (show.code === 0 && /^APPROVED /.test(show.out)) {
      const cap = (show.out.split(/\r?\n/)[1] || "").trim();
      return { contentSha: sha, capability: cap, verdictRel: rel };
    }
  }
  return { contentSha: "", capability: "", verdictRel: "" };
}

// Pure: assemble the release-notes markdown from already-gathered inputs. No I/O,
// so the smoke can assert the rendered notes (capability headline, CHANGELOG body,
// provenance footer links) without touching git or the network.
function buildReleaseNotes({ version, capability, changelog, slug, contentSha, verdictRel, prevTag }) {
  const base = slug ? `https://github.com/${slug.owner}/${slug.repo}` : "";
  const out = [];
  if (capability) out.push(`> ${capability}`, "");
  if (changelog) out.push(changelog, "");
  out.push("---", "", "### Provenance & audit", "");
  if (base && contentSha) out.push(`- **Reviewed commit:** [\`${contentSha.slice(0, 12)}\`](${base}/commit/${contentSha})`);
  if (base && verdictRel) out.push(`- **Independent reviewer verdict (committed):** [\`${verdictRel}\`](${base}/blob/v${version}/${verdictRel})`);
  if (base && prevTag) out.push(`- **Full diff:** [\`${prevTag}...v${version}\`](${base}/compare/${prevTag}...v${version})`);
  out.push(`- **npm (provenance-attested):** [\`cool-workflow@${version}\`](https://www.npmjs.com/package/cool-workflow/v/${version})`);
  // The gated-flow claim is made ONLY when a committed reviewer verdict actually
  // backs it — otherwise the notes would assert a review that is not there
  // (a false-green CW exists to prevent). Backfilled/ungated tags get an honest
  // caveat instead.
  if (verdictRel) {
    out.push("", "_Released through the gated flow: deterministic gate → independent release-reviewer (verdict above) → provenance-attested npm publish._");
  } else {
    out.push("", "_Backfilled Release: no committed reviewer verdict was found at this tag, so these notes make no gated-review claim — integrity rests on the provenance-attested npm publish above._");
  }
  return `${out.join("\n").trim()}\n`;
}

// Create-or-skip the GitHub Release for an already-pushed tag. `required` (the
// standalone --release mode) → an absent/failed gh is an ERROR; otherwise (the
// cut finishing step) → skip-with-note and DO NOT fail the cut.
function releaseGitHub(version, { required = false } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version || "")) die("release requires a x.y.z version");
  const tag = `v${version}`;
  if (git(["rev-parse", "-q", "--verify", `refs/tags/${tag}`]).code !== 0) {
    const msg = `tag ${tag} not found locally — push the tag before creating its Release.`;
    if (required) die(msg);
    process.stderr.write(`release-flow: note: ${msg} skipping Release.\n`);
    return false;
  }
  if (!ghReady()) {
    const msg = `gh CLI not available/authenticated — cannot create GitHub Release ${tag}. Create it later: gh release create ${tag} --notes-file <notes> --verify-tag`;
    if (required) die(msg);
    process.stderr.write(`release-flow: note: ${msg}\n`);
    return false;
  }
  if (gh(["release", "view", tag]).status === 0) {
    say(`GitHub Release ${tag} already exists — skipping (idempotent).`);
    return true;
  }
  const { contentSha, capability, verdictRel } = verdictForTag(version);
  if (!verdictRel) {
    process.stderr.write(`release-flow: note: no committed APPROVED verdict found at ${tag} — the Release notes will make NO gated-review claim (backfilling an ungated tag).\n`);
  }
  const notes = buildReleaseNotes({
    version,
    capability,
    changelog: changelogSection(version),
    slug: repoSlug(),
    contentSha,
    verdictRel,
    prevTag: prevTagOf(version)
  });
  const notesPath = path.join(repoRoot, ".cw-release", `release-notes-${version}.md`);
  fs.mkdirSync(path.dirname(notesPath), { recursive: true });
  fs.writeFileSync(notesPath, notes);
  if (DRY_RUN) { say(`[dry-run] would: gh release create ${tag} --notes-file ${notesPath} --verify-tag`); return true; }
  const r = gh(["release", "create", tag, "--title", tag, "--notes-file", notesPath, "--verify-tag"], { stdio: "inherit" });
  if (r.status !== 0) {
    const msg = `gh release create failed for ${tag} — notes saved at ${notesPath}; the tag and npm publish are unaffected.`;
    if (required) die(msg);
    process.stderr.write(`release-flow: note: ${msg}\n`);
    return false;
  }
  say(`created GitHub Release ${tag}.`);
  return true;
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
  // Finishing step: create the GitHub Release for the just-pushed tag. Only when
  // pushed (the remote tag must exist) and not opted out; never fails the cut.
  if (PUSH && !NO_RELEASE) releaseGitHub(cutVersion, { required: false });
}

// ---- main ------------------------------------------------------------------
function main() {
  if (!HEAD) die("could not resolve HEAD");

  // Standalone backfill: create-or-skip the GitHub Release for an already-pushed
  // tag. No gate, no review, no mutation of tracked files — just GitHub.
  if (MODE_RELEASE) {
    const version = cutVersion;
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) die("--release requires --version x.y.z");
    // Default: fail closed if gh can't create the Release (the operator asked for
    // it directly). --soft downgrades to best-effort (skip-not-fail), the same
    // semantics the --cut --push finishing step uses.
    const created = releaseGitHub(version, { required: !SOFT });
    process.stdout.write(`${JSON.stringify({ ok: true, mode: "release", version, soft: SOFT, created }, null, 2)}\n`);
    return;
  }

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
