#!/usr/bin/env node
"use strict";

// lib — helpers for conformance cases.
//
// A case is a black-box test. It may only talk to the CLI under test
// (env CW_BIN) and to the files the CLI writes. It must never read the
// source of any implementation. This is what lets one suite judge two
// different builds: the old one is the spec, the new one must match.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CW_BIN = process.env.CW_BIN;
if (!CW_BIN) {
  process.stderr.write("lib: env CW_BIN is not set — run cases through run.js\n");
  process.exit(2);
}

// Every case gets a private work dir from the runner. Fall back to a
// fresh tmp dir when a case is run by hand.
const WORK = process.env.CW_CONF_WORK || fs.mkdtempSync(path.join(os.tmpdir(), "cw-conf-"));

// run(args, opts) — run the CLI under test once, piped (no TTY).
//   opts.cwd    — where to run it (default: a fresh dir under WORK)
//   opts.env    — extra env keys (on top of the isolated base env)
//   opts.input  — bytes for stdin
// Gives back { status, stdout, stderr }.
function run(args, opts) {
  opts = opts || {};
  const cwd = opts.cwd || freshDir("cwd");
  const base = {
    PATH: process.env.PATH,
    HOME: path.join(WORK, "home"),
    CW_HOME: path.join(WORK, "home", ".cw-home"),
    XDG_STATE_HOME: path.join(WORK, "home", ".state"),
    TMPDIR: path.join(WORK, "tmp"),
    NO_COLOR: "1",
    // Pinned, not merely absent: the suite's whole byte-identity story
    // depends on every run seeing the SAME collation, on any host. A case
    // that wants to prove locale-independence overrides these via opts.env
    // (see locale-independent-ordering.case.js).
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
  };
  for (const d of [base.HOME, base.CW_HOME, base.XDG_STATE_HOME, base.TMPDIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
  const r = spawnSync(process.execPath, [CW_BIN].concat(args), {
    cwd,
    env: Object.assign(base, opts.env || {}),
    input: opts.input,
    encoding: "utf8",
    timeout: Number(process.env.CW_CASE_TIMEOUT_MS) || 60000,
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, cwd };
}

// freshDir(name) — make a new empty dir under the case work dir.
let dirSeq = 0;
function freshDir(name) {
  const d = path.join(WORK, `${name}-${dirSeq++}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// gitRepo() — make a small true git repo to point CW at.
function gitRepo(files) {
  const d = freshDir("repo");
  const g = (a) => {
    const r = spawnSync("git", a, { cwd: d, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  };
  g(["init", "-q"]);
  g(["config", "user.email", "conf@test.local"]);
  g(["config", "user.name", "conf"]);
  for (const [name, text] of Object.entries(files || { "a.txt": "hello\n" })) {
    const p = path.join(d, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  g(["add", "-A"]);
  g(["commit", "-q", "-m", "seed"]);
  return d;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// stubAgentEnv(evidence) — env to wire the deterministic fake agent
// (fixtures/stub-agent.js) as CW_AGENT_COMMAND. `evidence` is a "path:line"
// that must exist in the target repo (lib.gitRepo()'s default seed file is
// a.txt, matching the stub's own default) — CW_REQUIRE_RESOLVABLE_EVIDENCE
// defaults on and rejects an evidence locator that doesn't resolve on disk.
const STUB_AGENT = path.join(__dirname, "cases", "fixtures", "stub-agent.js");
function stubAgentEnv(evidence) {
  const env = { CW_AGENT_COMMAND: `node ${STUB_AGENT} {{input}} {{result}}` };
  if (evidence) env.CW_STUB_EVIDENCE = evidence;
  return env;
}

// jsonLines(text) — parse stdout that is one JSON value per line.
function jsonLines(text) {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// caseMain(fn) — run the case body; print one ok line or fail loud.
function caseMain(fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      process.stdout.write(`${path.basename(process.argv[1])}: ok\n`);
    })
    .catch((err) => {
      process.stderr.write(`${path.basename(process.argv[1])}: FAIL\n`);
      process.stderr.write((err && err.stack ? err.stack : String(err)) + "\n");
      process.exit(1);
    });
}

module.exports = { run, freshDir, gitRepo, readJson, jsonLines, caseMain, assert, stubAgentEnv, WORK };
