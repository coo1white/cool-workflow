#!/usr/bin/env node
"use strict";

// CW_AGENT_COMMAND {{token}} substitution — the single-worker golden-path
// app gives one deterministic worker, so every {{manifest}} {{input}}
// {{result}} {{workerDir}} {{model}} {{prompt}} token can be checked as a
// real, existing, discrete argv element (never shell-joined: an unknown
// {{unknown}} token must stay literal, never substituted or dropped).

const fs = require("node:fs");
const path = require("node:path");
const { run, gitRepo, readJson, caseMain, assert } = require("../lib");

const ECHO_AGENT = path.join(__dirname, "fixtures", "echo-argv-agent.js");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const argvOut = path.join(path.dirname(repo), "argv-out.json");

  const r = run(["quickstart", "--app", "end-to-end-golden-path", "--question", "Prove it works"], {
    cwd: repo,
    env: {
      CW_AGENT_COMMAND: `node ${ECHO_AGENT} {{manifest}} {{input}} {{result}} {{workerDir}} {{model}} {{prompt}} {{unknown}}`,
      CW_AGENT_MODEL: "my-test-model",
      CW_ECHO_ARGV_OUT: argvOut,
    },
  });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "complete");
  assert.equal(payload.plannedWorkers, 1);
  assert.equal(payload.completedWorkers, 1);

  assert.ok(fs.existsSync(argvOut), "the agent must have run and recorded its argv");
  const argv = readJson(argvOut);
  assert.equal(argv.length, 7, "7 substituted/literal argv elements");
  const [manifestArg, inputArg, resultArg, workerDirArg, modelArg, promptArg, unknownArg] = argv;

  // {{manifest}}, {{input}}, {{result}} — real files the CLI itself wrote.
  assert.ok(fs.existsSync(manifestArg), `{{manifest}} must be a real file: ${manifestArg}`);
  assert.match(manifestArg, /manifest\.json$/);
  assert.ok(fs.existsSync(inputArg), `{{input}} must be a real file: ${inputArg}`);
  assert.match(inputArg, /input\.md$/);
  assert.ok(fs.existsSync(resultArg), `{{result}} must be a real file (the agent wrote it): ${resultArg}`);
  assert.match(resultArg, /result\.md$/);

  // {{workerDir}} — a real directory that is the parent of the three files above.
  assert.ok(fs.existsSync(workerDirArg) && fs.statSync(workerDirArg).isDirectory());
  assert.equal(path.dirname(manifestArg), workerDirArg);
  assert.equal(path.dirname(inputArg), workerDirArg);
  assert.equal(path.dirname(resultArg), workerDirArg);

  // {{model}} — the CW_AGENT_MODEL policy value, substituted verbatim.
  assert.equal(modelArg, "my-test-model");

  // {{prompt}} — non-empty task prompt text, matches input.md's own "## Task" body.
  assert.ok(promptArg.length > 0);
  const inputText = fs.readFileSync(inputArg, "utf8");
  assert.ok(inputText.includes(promptArg), "the substituted {{prompt}} must equal the task text embedded in input.md");

  // {{unknown}} is not a known substitution key — it must stay LITERAL, never
  // dropped and never throwing.
  assert.equal(unknownArg, "{{unknown}}");

  // manifest.json itself must be valid JSON that agrees with the paths above.
  const manifest = readJson(manifestArg);
  assert.equal(manifest.inputPath, inputArg);
  assert.equal(manifest.resultPath, resultArg);
  assert.equal(manifest.workerDir, workerDirArg);
});
