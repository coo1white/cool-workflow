#!/usr/bin/env node
"use strict";
// release-gate.js — deterministic release checks for cool-workflow.
// Pass = writes .cw-release/gate-<HEAD-sha>.ok
// This script encodes everything that does NOT need LLM judgment.
// (Node port of the former release-gate.sh; behavior kept line for line —
// same six steps, same messages, same exit map: 0 = PASSED, 1 = REJECTED.)

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolvePrevReleaseTag } = require("./release-tags.js");

const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
if (top.status !== 0) {
  process.stderr.write("release-gate: not inside a git work tree\n");
  process.exit(1);
}
const REPO_ROOT = top.stdout.trim();

function gitOut(args) {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return r.status === 0 ? (r.stdout || "").trim() : "";
}

const SHA = gitOut(["rev-parse", "HEAD"]);
let FAIL = 0;
function say(msg) {
  process.stdout.write(`${msg}\n`);
}
function fail(msg) {
  say(`GATE FAIL: ${msg}`);
  FAIL = 1;
}

// Resolve the PREVIOUS release tag by SEMVER ORDER, not ancestry — shared
// with release-flow.js via release-tags.js (see that file's header for the
// full story: `git describe --tags` walks ancestry and silently SKIPS the
// true previous release tag under the tag-only-push design, making the
// substance/test-evidence/cadence checks below compare against the wrong
// baseline and pass permanently; ITERATION_LOG cycles 35/36).
const PREV_TAG = resolvePrevReleaseTag(gitOut);

// An empty PREV_TAG is ambiguous: (a) the genuine first release, so skipping
// substance/evidence/cadence is right, or (b) tags DO exist but this clone can
// not see them — a shallow clone hides them in history, and a `git clone
// --no-tags` / `fetch-tags: false` clone of a long-tagged repo shows 0 local
// tags too. (a) and (b) look IDENTICAL from local state (both give an empty
// describe and 0 tags), so we can NOT auto-tell them apart. Fail CLOSED: skip
// the checks ONLY when the operator positively declares a first release with
// CW_FIRST_RELEASE=1 (explicit + logged, the same shape the cadence HOTFIX
// override uses). Otherwise REJECT — a mis-fetched clone must never look like a
// first release and silently pass. Found by a 2026-07-12 security check; the
// shallow signal alone closed only half the hole (the `--no-tags` full clone
// still slipped through).
if (!PREV_TAG) {
  const shallow = spawnSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: REPO_ROOT, encoding: "utf8" });
  const IS_SHALLOW = shallow.status === 0 ? shallow.stdout.trim() : "false";
  if (IS_SHALLOW === "true") {
    fail("cannot resolve the previous release tag: this is a shallow git clone (git rev-parse --is-shallow-repository = true), so an older tag may be hidden and substance/test-evidence/cadence cannot be trusted. Fetch full history (actions/checkout with fetch-depth: 0) before running this gate.");
  } else if (process.env.CW_FIRST_RELEASE === "1") {
    say("no previous tag; genuine first release declared (CW_FIRST_RELEASE=1) — substance/evidence/cadence will be skipped");
  } else {
    fail("cannot resolve the previous release tag on a full (non-shallow) clone. Either tags were not fetched (git clone --no-tags, or actions/checkout fetch-tags: false — fetch tags and re-run), or this is the genuine first release (set CW_FIRST_RELEASE=1 to declare that explicitly). Refusing to silently skip substance/test-evidence/cadence.");
  }
}
const MARKER_DIR = path.join(REPO_ROOT, ".cw-release");
fs.mkdirSync(MARKER_DIR, { recursive: true });

const MAX_CHILD_DIAGNOSTIC_BYTES = 16 * 1024;

function boundedDiagnostic(text) {
  const value = String(text || "").trim();
  if (value.length <= MAX_CHILD_DIAGNOSTIC_BYTES) return value;
  return `…${value.slice(-MAX_CHILD_DIAGNOSTIC_BYTES)}`;
}

function reportNpmFailure(label, result) {
  // Failure facts are local diagnostics, never stdout data and never a saved
  // release record. Keep the tail so a large smoke run cannot flood a terminal.
  const out = boundedDiagnostic(result.stdout);
  const err = boundedDiagnostic(result.stderr);
  process.stderr.write(`release-gate: ${label} failed (exit ${result.status ?? "unknown"})\n`);
  if (err) process.stderr.write(`[stderr]\n${err}\n`);
  if (out) process.stderr.write(`[stdout]\n${out}\n`);
}

function runNpm(args, extraEnv) {
  const r = spawnSync("npm", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  return r;
}

// --- 1. Build & tests (run, don't trust pasted output) -----------------
say("[1/6] build");
const build = runNpm(["run", "--prefix", "plugins/cool-workflow", "build"]);
if (build.error || build.status !== 0) {
  fail("build failed");
  reportNpmFailure("build", build);
}

say("[2/6] tests");
const tests = runNpm(["run", "test:gate", "--prefix", "plugins/cool-workflow"], { CW_TEST_CONCURRENCY: "1" });
if (tests.error || tests.status !== 0) {
  fail("tests failed");
  reportNpmFailure("tests", tests);
}

if (PREV_TAG) {
  const RANGE = `${PREV_TAG}..HEAD`;
  const changedFiles = gitOut(["diff", "--name-only", RANGE]).split("\n").filter(Boolean);

  // --- 2. Substance: changes must exist outside src/types/ and dist/ ---
  // The spec (AGENTS.md / reviewer-agent.md Gate 1) is "at least one changed
  // file outside src/types/ and dist/" — ANY such file (src, scripts, docs,
  // workflows, tests). Count every changed path that is not under those two
  // generated/declaration-only trees; declared-but-unread spec accretion is the
  // reviewer agent's deeper judgment call, not this deterministic floor.
  say("[3/6] substance (diff outside src/types/ and dist/)");
  const SUBSTANCE = changedFiles.filter((f) => !/^plugins\/cool-workflow\/(src\/types\/|dist\/)/.test(f)).length;
  if (!(SUBSTANCE > 0)) fail(`only types/dist changed since ${PREV_TAG} (spec accretion)`);

  // --- 3. Test evidence: test files must have changed ------------------
  say("[4/6] test evidence");
  const TESTS_CHANGED = changedFiles.filter((f) => /\.(test|spec)\.|\/tests?\//.test(f)).length;
  if (!(TESTS_CHANGED > 0)) fail(`zero test changes since ${PREV_TAG}`);

  // --- 4. Cadence: >=4 cycles logged OR >=24h since previous tag, or a recorded HOTFIX ---
  say("[5/6] cadence");
  let CYCLES = 0;
  const logDiff = fs.existsSync(path.join(REPO_ROOT, "ITERATION_LOG.md"))
    ? gitOut(["diff", RANGE, "--", "ITERATION_LOG.md"]).split("\n")
    : [];
  CYCLES = logDiff.filter((line) => /^\+.*\|/.test(line)).length;
  const PREV_TS = Number(gitOut(["log", "-1", "--format=%ct", PREV_TAG]));
  const NOW_TS = Math.floor(Date.now() / 1000);
  const HOURS = Math.floor((NOW_TS - PREV_TS) / 3600);
  // Hotfix path: an urgent fix may ship inside the cadence window, but ONLY via an
  // EXPLICIT, RECORDED declaration — a "HOTFIX:" line added to ITERATION_LOG.md in this
  // release range, carrying a reason. It is committed (auditable in the tag's history)
  // and echoed here, so the bypass is never silent and a reviewer sees the reason.
  const hotfixLine = logDiff.find((line) => /^\+.*HOTFIX:/.test(line));
  const HOTFIX = hotfixLine ? hotfixLine.replace(/^\+\s*/, "") : "";
  if (CYCLES < 4 && HOURS < 24) {
    if (HOTFIX) {
      say(`  cadence bypassed by recorded HOTFIX (${HOURS}h, ${CYCLES} cycle-lines): ${HOTFIX}`);
    } else {
      fail(`cadence: only ${CYCLES} cycles logged and ${HOURS}h since ${PREV_TAG} (need >=4 cycles, >=24h, or a recorded 'HOTFIX:' line in ITERATION_LOG.md)`);
    }
  }
} else {
  say("[3-5/6] no previous tag; substance/evidence/cadence checks skipped");
}

// --- 5. Branch naming: forbid version-number branches -------------------
say("[6/6] branch naming");
// On a normal checkout `git rev-parse --abbrev-ref HEAD` is the branch name. On
// a DETACHED HEAD it prints the literal string "HEAD" — and the tag-push CI
// (release-gate.yml) ALWAYS checks out the tag, so HEAD is detached there. A
// literal "HEAD" can never match the version-branch regex below, so this check
// would silently pass exactly where it is meant to be the backstop. Handle the
// detached case explicitly: gather the real candidate ref name(s) — the
// CI-provided source branch (GITHUB_HEAD_REF for a PR, else GITHUB_REF_NAME),
// plus every local/remote branch whose tip contains this commit — and judge
// each one. A truly detached checkout with no resolvable branch (a bare
// `git checkout <sha>`) has no branch to name, so there is nothing to forbid;
// that is now an explicit, understood pass, not an accidental regex miss.
const BRANCH = gitOut(["rev-parse", "--abbrev-ref", "HEAD"]) || "HEAD";
let candidateBranches = [BRANCH];
if (BRANCH === "HEAD") {
  candidateBranches = [];
  // The CI source branch: a PR run exposes it as GITHUB_HEAD_REF; a plain push
  // exposes the pushed ref as GITHUB_REF_NAME (a tag on a tag push, which simply
  // will not match the feat/ regex — harmless to include).
  for (const envRef of [process.env.GITHUB_HEAD_REF || "", process.env.GITHUB_REF_NAME || ""]) {
    if (envRef) candidateBranches.push(envRef);
  }
  // Every local branch whose tip contains this commit, plus every remote-tracking
  // branch (with its "<remote>/" prefix stripped so the regex still anchors on
  // "feat/"). --format avoids the "* " current-branch marker git branch prints.
  const localC = gitOut(["branch", "--contains", "HEAD", "--format=%(refname:short)"]);
  const remoteC = gitOut(["branch", "-r", "--contains", "HEAD", "--format=%(refname:short)"])
    .split("\n")
    .map((b) => b.replace(/^[^/]+\//, ""))
    .join("\n");
  for (const chunk of [localC, remoteC]) {
    if (chunk) candidateBranches.push(...chunk.split("\n"));
  }
}
for (const B of candidateBranches) {
  if (!B || B === "HEAD") continue;
  if (/^feat\/(batch-)?v?[0-9]+/.test(B)) {
    fail(`branch '${B}' is version-number-driven; name the capability instead`);
  }
}

// --- Verdict ------------------------------------------------------------
if (FAIL !== 0) {
  fs.rmSync(path.join(MARKER_DIR, `gate-${SHA}.ok`), { force: true });
  say(`RELEASE GATE: REJECTED (${SHA})`);
  process.exit(1);
}

fs.writeFileSync(path.join(MARKER_DIR, `gate-${SHA}.ok`), `${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}\n`);
say(`RELEASE GATE: PASSED (${SHA}) — next step: release-reviewer agent must record APPROVED`);
