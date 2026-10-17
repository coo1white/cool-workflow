"use strict";

// release-preflight.js — the ONE implementation of the release preflight
// checks. Consumers:
//   - scripts/release-doctor.js   (`npm run release:doctor`, every check, all
//                                  problems reported at once)
//   - scripts/release-oneclick.js (stage 0 of `npm run release -- X.Y.Z`
//                                  runs the same checks FIRST, mode "cut")
//   - scripts/release-flow.js     (its --cut preflight calls the shared
//                                  signing / tag / tree / origin checks and
//                                  stops at the first failure, as before)
//
// Every check answers "will the release die LATE over this?" in well under a
// second (a `git fetch`, an `ls-remote` and `gh auth status` are the only
// network steps, and `offline: true` skips them). No check runs the test
// suite, the reviewer, or a model.
//
// A check returns a finding:
//   { id, status: "ok" | "warn" | "fail" | "info", message, fix?, detail? }
// `fix` is the exact command (or env line) that clears it; `detail` is extra
// text (git output, a file list). The signing-key check NEVER prints the key
// or its env value; outside verifyMatch (release-flow's own cut) it never
// even reads the key file — it checks only that the file exists, is a
// regular file, and is readable.
//
// Zero dependencies: node + git (+ gh, only for the auth probe). Every spawn
// is argv-style, shell:false.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");

function finding(id, status, message, extra = {}) {
  const f = { id, status, message };
  if (extra.fix) f.fix = extra.fix;
  if (extra.detail) f.detail = extra.detail;
  return f;
}

function createContext({ repoRoot, env = process.env, gitBin = "git", ghBin = "gh", offline = false }) {
  const run = (bin, args) => {
    const r = spawnSync(bin, args, { cwd: repoRoot, encoding: "utf8", env, shell: false });
    return { code: r.error ? null : r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), error: r.error };
  };
  return {
    repoRoot,
    env,
    offline,
    git: (args) => run(gitBin, args),
    gh: (args) => run(ghBin, args),
    run
  };
}

// ---- version ---------------------------------------------------------------
function checkVersion(version) {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    return finding("version", "fail", "no release version — pass X.Y.Z", { fix: "npm run release:doctor -- X.Y.Z" });
  }
  return finding("version", "ok", `release version ${version}`);
}

// ---- signing key -------------------------------------------------------------
// Once .cw-release/verdict-signing.pub is committed, CI's release gate
// REQUIRES a signed verdict, so a cut without the private key dies only in
// CI. With verifyMatch (release-flow's --cut) the key is also parsed and
// proven to be the committed key's pair; without it the key file is never
// opened for reading.
function checkSigningKey(ctx, { verifyMatch = false } = {}) {
  const pubPath = path.join(ctx.repoRoot, ".cw-release", "verdict-signing.pub");
  if (!fs.existsSync(pubPath)) {
    return finding("signing-key", "ok", "no .cw-release/verdict-signing.pub committed — verdict signing is not required");
  }
  const fix = "export CW_RELEASE_VERDICT_PRIVKEY=~/.cw-keys/verdict-signing.key";
  const raw = ctx.env.CW_RELEASE_VERDICT_PRIVKEY;
  if (!raw || !raw.trim()) {
    return finding("signing-key", "fail", "verdict-signing.pub is committed, so CI requires a SIGNED verdict — set the private key first", {
      detail: `fix:  ${fix}`,
      fix
    });
  }
  const trimmed = raw.trim();
  const inline = trimmed.includes("BEGIN") && trimmed.includes("KEY");
  if (!inline) {
    // NEVER echo the value: it may be inline key material that missed the
    // BEGIN/KEY markers. Describe it by length only.
    let st;
    try {
      st = fs.statSync(trimmed);
    } catch {
      st = undefined;
    }
    if (!st) {
      return finding("signing-key", "fail", `CW_RELEASE_VERDICT_PRIVKEY (length ${trimmed.length}) is neither a readable key file path nor an inline PEM (must contain BEGIN and KEY).`, { fix });
    }
    if (!st.isFile()) {
      return finding("signing-key", "fail", `CW_RELEASE_VERDICT_PRIVKEY (length ${trimmed.length}) names a path that is not a regular file.`, { fix });
    }
    try {
      fs.accessSync(trimmed, fs.constants.R_OK);
    } catch {
      return finding("signing-key", "fail", `CW_RELEASE_VERDICT_PRIVKEY (length ${trimmed.length}) names a file this user cannot read.`, {
        fix: "chmod 600 <key file> (owned by you), or point CW_RELEASE_VERDICT_PRIVKEY at a readable copy"
      });
    }
  }
  if (!verifyMatch) {
    return finding("signing-key", "ok", inline
      ? "CW_RELEASE_VERDICT_PRIVKEY is set (inline PEM)"
      : "CW_RELEASE_VERDICT_PRIVKEY names a readable regular file (contents not read)");
  }
  const pem = inline ? trimmed : fs.readFileSync(trimmed, "utf8");
  let key;
  try {
    key = crypto.createPrivateKey(pem);
  } catch (error) {
    return finding("signing-key", "fail", `CW_RELEASE_VERDICT_PRIVKEY is not a readable private key: ${error.message}`);
  }
  if (key.asymmetricKeyType !== "ed25519") {
    return finding("signing-key", "fail", `CW_RELEASE_VERDICT_PRIVKEY is a ${key.asymmetricKeyType || "unknown"} key, not ed25519 — generate one with scripts/verdict-keygen.js`);
  }
  const derivedPub = crypto.createPublicKey(key).export({ type: "spki", format: "pem" }).toString().trim();
  const committedPub = fs.readFileSync(pubPath, "utf8").trim();
  if (derivedPub !== committedPub) {
    return finding("signing-key", "fail", "CW_RELEASE_VERDICT_PRIVKEY does not match the committed .cw-release/verdict-signing.pub — wrong key; CI would reject its signature");
  }
  return finding("signing-key", "ok", "CW_RELEASE_VERDICT_PRIVKEY matches the committed verdict-signing.pub");
}

// ---- tags --------------------------------------------------------------------
function checkLocalTag(ctx, version) {
  if (ctx.git(["tag", "-l", `v${version}`]).out) {
    return finding("tag-local", "fail", `tag v${version} already exists locally — delete it first (git tag -d v${version}) or pick the next version`, {
      fix: `git tag -d v${version}`
    });
  }
  return finding("tag-local", "ok", `no local tag v${version}`);
}

function hasOrigin(ctx) {
  return ctx.git(["remote"]).out.split("\n").includes("origin");
}

function checkRemoteTag(ctx, version) {
  const r = ctx.git(["ls-remote", "origin", `refs/tags/v${version}`]);
  // Fail CLOSED on a failed ls-remote: a non-zero exit (network blip, auth
  // error) is NOT evidence the tag is absent.
  if (r.code !== 0) {
    return finding("tag-remote", "fail", `could not check origin for tag v${version} (git ls-remote failed) — refusing to cut blind`, { detail: r.err });
  }
  if (r.out) {
    return finding("tag-remote", "fail", `tag v${version} already exists on origin — this version is already published; pick the next version`);
  }
  return finding("tag-remote", "ok", `no tag v${version} on origin`);
}

// ---- working tree ------------------------------------------------------------
// Tracked files only: the cut stages with `git add -u`, so an untracked file
// can never ride into the tag.
function checkCleanTree(ctx) {
  const dirty = ctx.git(["status", "--porcelain", "-uno"]).out;
  if (dirty) {
    return finding("clean-tree", "fail", "working tree has tracked modifications — commit or stash them before a cut", {
      detail: dirty,
      fix: "git stash push -m pre-release   (or commit the changes on a branch)"
    });
  }
  return finding("clean-tree", "ok", "no tracked modifications");
}

// Old run state at the repo root. It is gitignored, so it can never ride into
// the cut, but a dogfood/gate run reads .cw/ and stale state there is noise.
function checkCwDir(ctx) {
  const dir = path.join(ctx.repoRoot, ".cw");
  if (!fs.existsSync(dir)) return finding("cw-dir", "ok", "no .cw/ at the repo root");
  const ignored = ctx.git(["check-ignore", "-q", ".cw/"]).code === 0;
  return finding("cw-dir", "warn", `untracked .cw/ at the repo root (${ignored ? "gitignored, so it cannot ride into the cut" : "NOT gitignored"}) — old run state; remove it unless you still need it`, {
    fix: `rm -rf ${dir}`
  });
}

// ---- origin/main -------------------------------------------------------------
function fetchMain(ctx) {
  if (ctx.offline) return finding("fetch", "info", "offline — skipped git fetch origin main (comparing to the local origin/main ref)");
  const r = ctx.git(["fetch", "origin", "main", "--quiet"]);
  if (r.code !== 0) {
    return finding("fetch", "fail", "git fetch origin main failed — a --push cut needs the network anyway; fix connectivity first", { detail: r.err });
  }
  return finding("fetch", "ok", "fetched origin/main");
}

function currentBranch(ctx) {
  const b = ctx.git(["branch", "--show-current"]).out;
  return b || "(detached HEAD)";
}

// HEAD must be the current origin/main tip — cutting a stale HEAD publishes
// old code (nearly happened on the v0.2.2 cut; a leftover release/vX-cut
// branch did it again).
function checkHeadCurrent(ctx) {
  const head = ctx.git(["rev-parse", "HEAD"]).out;
  const tip = ctx.git(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]);
  if (tip.code !== 0 || !tip.out) {
    return finding("head-current", "fail", "there is no origin/main ref to compare HEAD with", { fix: "git fetch origin main" });
  }
  if (tip.out !== head) {
    return finding("head-current", "fail",
      `HEAD (${head}) on branch ${currentBranch(ctx)} is not the origin/main tip (${tip.out}) — a cut must release exactly what main has`, {
        detail: "fix:  git checkout main && git pull --ff-only origin main   (release-flow.js alone: --allow-stale-head if this is deliberate)",
        fix: "git checkout main && git pull --ff-only origin main"
      });
  }
  return finding("head-current", "ok", `HEAD is the origin/main tip (${head.slice(0, 12)}, branch ${currentBranch(ctx)})`);
}

// A leftover local release/vX.Y.Z-cut branch from an earlier, failed cut.
// The cut stage itself always rebuilds it from origin/main (git checkout -B),
// so for the cut it is only a warning; the doctor reports it as a failure so
// the operator never mistakes it for current code.
function checkCutBranch(ctx, version, { mode = "doctor" } = {}) {
  const branch = `release/v${version}-cut`;
  const r = ctx.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (r.code !== 0 || !r.out) return finding("cut-branch", "ok", `no leftover ${branch} branch`);
  const tip = ctx.git(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]).out;
  if (tip && r.out === tip) return finding("cut-branch", "ok", `${branch} exists and points at origin/main`);
  const onIt = ctx.git(["branch", "--show-current"]).out === branch;
  const fix = `${onIt ? "git checkout main && " : ""}git branch -D ${branch}`;
  if (mode === "cut") {
    return finding("cut-branch", "warn", `leftover branch ${branch} points at ${r.out}, not origin/main (${tip || "unknown"}) — the cut stage rebuilds it from origin/main`, { fix });
  }
  return finding("cut-branch", "fail", `leftover branch ${branch} points at ${r.out}, not origin/main (${tip || "unknown"}) — it holds old code`, { fix });
}

// ---- reviewer ----------------------------------------------------------------
function isExecutableFile(p) {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveOnPath(bin, env) {
  const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      if (isExecutableFile(p)) return p;
    }
  }
  return undefined;
}

// The reviewer is spawned argv-style by release-flow.js after the full gate;
// a missing binary is an instant ENOENT there. Resolve the SAME config
// release-flow resolves (dist/shell/agent-config.js: flags > env > file >
// auto-detect) and prove its first argv token is an executable file. The
// reviewer is never run.
function checkReviewer(ctx) {
  const fixExample = 'export CW_AGENT_COMMAND="claude -p --permission-mode acceptEdits {{input}}"   (or codex exec / gemini -p / opencode run)';
  let resolveAgentConfig, agentCommandArgv;
  try {
    ({ resolveAgentConfig } = require(path.join(pluginRoot, "dist", "shell", "agent-config.js")));
    ({ agentCommandArgv } = require(path.join(pluginRoot, "dist", "core", "util", "cli-args.js")));
  } catch (error) {
    return finding("reviewer", "fail", "cannot load dist/shell/agent-config.js to resolve the reviewer — run `npm run build` first", { detail: String(error && error.message), fix: "npm run build" });
  }
  let cfg;
  try {
    cfg = resolveAgentConfig({}, ctx.env);
  } catch (error) {
    return finding("reviewer", "fail", `reviewer config does not resolve: ${error.message}`, { fix: fixExample });
  }
  if (cfg.source === "none" || (!cfg.command && !cfg.endpoint)) {
    return finding("reviewer", "fail", "no reviewer agent configured (CW_AGENT_COMMAND / CW_AGENT_ENDPOINT / agent-config.json)", { fix: fixExample });
  }
  const from = { env: "CW_AGENT_COMMAND", file: "agent-config.json", flag: "--agent-command", auto: "auto-detect on PATH" }[cfg.source] || cfg.source;
  if (!cfg.command) {
    let ok = false;
    try {
      ok = ["http:", "https:"].includes(new URL(cfg.endpoint).protocol);
    } catch {
      ok = false;
    }
    if (!ok) return finding("reviewer", "fail", "CW_AGENT_ENDPOINT is not an http(s) URL", { fix: "export CW_AGENT_ENDPOINT=https://<agent host>/..." });
    return finding("reviewer", "ok", "reviewer is an HTTP endpoint (not contacted by the doctor)");
  }
  const { binary: bin, args: rest } = agentCommandArgv(String(cfg.command), cfg.args);
  let resolved;
  if (bin.includes("/") || bin.includes(path.sep)) {
    const abs = path.resolve(ctx.repoRoot, bin);
    resolved = isExecutableFile(abs) ? abs : undefined;
  } else {
    resolved = resolveOnPath(bin, ctx.env);
  }
  if (!resolved) {
    return finding("reviewer", "fail", `reviewer command "${bin}" (from ${from}) is not an executable file${bin.includes("/") ? "" : " on PATH"} — the cut would die with ENOENT after the full gate`, {
      fix: `install it, or ${fixExample}`
    });
  }
  // A builtin wrapper ("node /abs/claude-p-agent.js {{input}} {{result}}"):
  // the script must exist too.
  const wrapper = /^node(\.exe)?$/.test(path.basename(bin)) && rest[0] && path.isAbsolute(rest[0]) ? rest[0] : undefined;
  if (wrapper && !fs.existsSync(wrapper)) {
    return finding("reviewer", "fail", `reviewer wrapper script ${wrapper} (from ${from}) does not exist`, { fix: fixExample });
  }
  return finding("reviewer", "ok", `reviewer binary ${resolved}${wrapper ? ` ${path.basename(wrapper)}` : ""} (from ${from}; not run)`);
}

// ---- git identity --------------------------------------------------------------
function checkGitIdentity(ctx) {
  const email = ctx.git(["config", "user.email"]).out;
  const shape = 'git config user.email "<id>+<login>@users.noreply.github.com"';
  if (!email) {
    return finding("git-identity", "fail", "git user.email is not set — the verdict commit cannot be made", { fix: shape });
  }
  if (!/@users\.noreply\.github\.com$/i.test(email)) {
    return finding("git-identity", "warn", "git user.email is not a GitHub noreply address — if the account keeps its email private, GitHub rejects the tag push (GH007)", { fix: shape });
  }
  return finding("git-identity", "ok", "git user.email is a GitHub noreply address");
}

// ---- gh --------------------------------------------------------------------------
function checkGh(ctx) {
  if (ctx.offline) return finding("gh", "info", "offline — skipped gh auth status");
  const r = ctx.gh(["auth", "status"]);
  if (r.code !== 0) {
    return finding("gh", "warn", r.error
      ? "gh CLI not found — the GitHub Release falls back to CI's auto-generated notes (and release-oneclick needs gh for its PRs)"
      : "gh is not authenticated — the GitHub Release falls back to CI's auto-generated notes (and release-oneclick needs gh for its PRs)", {
      fix: "gh auth login"
    });
  }
  return finding("gh", "ok", "gh is authenticated");
}

// ---- tool versions (informational) -------------------------------------------
function toolVersions(ctx) {
  const npm = ctx.run(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"]);
  return finding("tools", "info", `node ${process.version}, npm ${npm.code === 0 && npm.out ? npm.out : "unknown"}`);
}

// ---- the whole set ------------------------------------------------------------
// mode "doctor": an existing vX.Y.Z tag is a warning (re-running
//   `npm run release -- X.Y.Z` resumes at stage 3); a stale cut branch fails.
// mode "cut": release-oneclick's stage 0, which runs only when the tag does
//   NOT exist (a resume skips stage 0), so an existing tag fails; a stale cut
//   branch warns (the cut stage rebuilds it).
function runChecks({ repoRoot, version, env = process.env, gitBin = "git", ghBin = "gh", offline = false, mode = "doctor" }) {
  const ctx = createContext({ repoRoot, env, gitBin, ghBin, offline });
  const checks = [];
  const v = checkVersion(version);
  checks.push(v);
  const versionOk = v.status === "ok";
  const origin = hasOrigin(ctx);

  if (!origin) {
    checks.push(finding("origin", "fail", "no `origin` remote — the cut pushes its tag there", { fix: "git remote add origin <url>" }));
  } else {
    checks.push(fetchMain(ctx));
    checks.push(checkHeadCurrent(ctx));
  }
  checks.push(checkCleanTree(ctx));
  checks.push(checkCwDir(ctx));
  if (versionOk) {
    if (origin) checks.push(checkCutBranch(ctx, version, { mode }));
    const local = checkLocalTag(ctx, version);
    let remote;
    if (origin && !offline) remote = checkRemoteTag(ctx, version);
    else remote = finding("tag-remote", "info", origin ? "offline — skipped the origin tag check" : "no origin — skipped the origin tag check");
    for (const t of [local, remote]) {
      if (mode === "doctor" && t.status === "fail" && /already exists/.test(t.message)) {
        t.status = "warn";
        t.message += ` (if this is a cut that is mid-flight, \`npm run release -- ${version}\` resumes it at stage 3)`;
      }
      checks.push(t);
    }
  }
  checks.push(checkSigningKey(ctx));
  checks.push(checkReviewer(ctx));
  checks.push(checkGitIdentity(ctx));
  checks.push(checkGh(ctx));
  checks.push(toolVersions(ctx));

  const failures = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  return { ok: failures === 0, mode, version: versionOk ? version : null, failures, warnings, checks };
}

// Human lines for stderr. `onlyProblems` keeps the oneclick stage-0 output to
// what needs the operator's eye.
function formatFindings(result, { prefix = "release:doctor", onlyProblems = false } = {}) {
  const tag = { ok: "ok  ", info: "info", warn: "WARN", fail: "FAIL" };
  const lines = [];
  for (const c of result.checks) {
    if (onlyProblems && (c.status === "ok" || c.status === "info")) continue;
    lines.push(`${prefix}: ${tag[c.status]} ${c.id}: ${c.message}`);
    if (c.detail && !c.detail.startsWith("fix:")) {
      for (const l of c.detail.split("\n")) lines.push(`${prefix}:        ${l}`);
    }
    if (c.fix && c.status !== "ok" && c.status !== "info") lines.push(`${prefix}:        fix:  ${c.fix}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

module.exports = {
  createContext,
  checkVersion,
  checkSigningKey,
  checkLocalTag,
  checkRemoteTag,
  checkCleanTree,
  checkCwDir,
  fetchMain,
  checkHeadCurrent,
  checkCutBranch,
  checkReviewer,
  checkGitIdentity,
  checkGh,
  toolVersions,
  hasOrigin,
  runChecks,
  formatFindings
};
