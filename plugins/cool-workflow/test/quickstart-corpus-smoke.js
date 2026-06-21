#!/usr/bin/env node
"use strict";

// quickstart-corpus-smoke — point CW at a local NON-GIT folder (a corpus) and
// get a cited report through the research-synthesis app, NOT only a git repo.
//
// This proves the Path 2 capability for a new audience (a researcher, analyst,
// or anyone with a folder of docs/notes/papers). It drives the EXACT advertised
// command through the real CLI, from a DIFFERENT working directory, so the test
// covers the same arg path a user types — not an in-process shortcut:
//
//   cw quickstart research-synthesis --repo <folder> --question "..."
//
// Proven here: the run roots at the corpus folder (NOT the caller's cwd, so the
// `--repo` routing is real), the Investigate step is told to read the local
// files in the working directory, the run commits with grounded evidence, and
// the report cites a local corpus file.
//
// Hermetic: a STUB agent (a tiny node child) stands in for `claude -p` /
// `codex exec`. No live agent binary, no network, no model SDK.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");

const cleanups = [];
function tmpdir(tag) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cw-corpus-${tag}-`)));
  cleanups.push(d);
  return d;
}

// A stub agent: argv[2]=resultPath. It cites a LOCAL corpus file, so the
// evidence gate passes on a file-path locator (no code, no git needed).
function writeStub(file) {
  const lines = [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const rp = process.argv[2];",
    'const body = "# R\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub synthesis", findings: [], evidence: [process.cwd() + "/notes.md:1"] }) + "\\n" + fence + "\\n";',
    "fs.writeFileSync(rp, body);",
    'process.stdout.write(JSON.stringify({ model: "stub-corpus-model" }));'
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

try {
  // A small NON-GIT corpus: a couple of plain files, no `.git` directory.
  const corpus = tmpdir("repo");
  fs.writeFileSync(path.join(corpus, "notes.md"), "# Field notes\n\nThe bridge was repainted in 1991.\n", "utf8");
  fs.writeFileSync(path.join(corpus, "sources.txt"), "Primary log: paint batch #42, 1991.\n", "utf8");

  // Run from a DIFFERENT directory than the corpus, so the test proves `--repo`
  // routes the run to the corpus regardless of the caller's cwd — the bug a
  // `repo:`-in-process call plus a chdir would both hide.
  const elsewhere = tmpdir("elsewhere");
  const stub = writeStub(path.join(elsewhere, "stub.js"));

  const env = {
    ...process.env,
    CW_HOME: elsewhere,
    XDG_STATE_HOME: elsewhere,
    HOME: elsewhere,
    TMPDIR: elsewhere,
    CW_AGENT_COMMAND: `${process.execPath} ${stub} {{result}}`
  };

  // The EXACT command CW advertises for a corpus run (doctor onramp + the
  // canonical-workflow-apps man page). If those surfaces drift to a flag that
  // does not route the folder, this fails closed.
  const run = spawnSync(
    process.execPath,
    [cli, "quickstart", "research-synthesis", "--repo", corpus, "--question", "When was the bridge repainted, per the notes?", "--json"],
    { cwd: elsewhere, env, encoding: "utf8" }
  );

  assert.equal(run.status, 0, `advertised corpus command exits 0\n${run.stderr}`);
  const payload = JSON.parse(run.stdout.trim());

  // ---- 1. completes as research-synthesis over the NON-GIT corpus + commits ---
  assert.equal(payload.status, "complete", "corpus run drives to completion");
  assert.equal(payload.appId, "research-synthesis", "the research-synthesis app ran");
  assert.ok(payload.commitId, "the corpus run committed with grounded file-path evidence");
  assert.ok(!fs.existsSync(path.join(corpus, ".git")), "the corpus folder is NOT a git repo");

  // ---- 2. the run roots at the CORPUS, not the caller's cwd (--repo routing) --
  const stateUnderCorpus = path.join(corpus, ".cw", "runs", payload.runId, "state.json");
  assert.ok(fs.existsSync(stateUnderCorpus), "run state is rooted under the corpus folder");
  assert.ok(
    !fs.existsSync(path.join(elsewhere, ".cw", "runs", payload.runId, "state.json")),
    "run is NOT rooted under the caller's cwd"
  );

  const state = JSON.parse(fs.readFileSync(stateUnderCorpus, "utf8"));
  assert.equal(path.resolve(state.cwd), path.resolve(corpus), "run.cwd is the corpus folder");
  assert.ok(state.tasks.every((t) => t.status === "completed"), "every planned worker completed");

  // ---- 3. the load-bearing change: Investigate reads the local working dir ----
  //         (this assertion FAILS before the workflow.js prompt edit).
  const investigate = state.tasks.find((t) => t.id === "investigate:primary-sources");
  assert.ok(investigate, "research-synthesis has an investigate:primary-sources task");
  assert.match(
    investigate.prompt,
    /working directory/i,
    "Investigate prompt tells the agent to read local files in the working directory"
  );

  // ---- 4. the report cites a LOCAL corpus file path (the locator is real) -----
  const report = fs.readFileSync(payload.reportPath, "utf8");
  assert.match(report, /notes\.md/, "the report cites the local corpus file (notes.md)");

  process.stdout.write("quickstart-corpus-smoke: ok (advertised CLI command reads a non-git local corpus + commits a cited report)\n");
} finally {
  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
}
