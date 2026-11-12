#!/usr/bin/env node

// CW_AGENT_COMMAND {{token}} substitution — every {{manifest}} {{input}}
// {{result}} {{workerDir}} {{model}} {{prompt}} {{phase}} {{taskId}}
// {{workerId}} token is checked as a real, discrete argv element (never
// shell-joined: an unknown {{unknown}} token must stay literal, never
// substituted or dropped). The echo agent writes its argv next to each
// worker's result.md; this case reads the verdict worker's copy.

import fs from "node:fs";
import path from "node:path";
import { run, gitRepo, readJson, caseMain, assert } from "../lib.mjs";

const ECHO_AGENT = path.join(import.meta.dirname, "fixtures", "echo-argv-agent.mjs");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const r = run(["-q", "Prove it works", "--json"], {
    cwd: repo,
    env: {
      CW_AGENT_COMMAND: `node ${ECHO_AGENT} {{manifest}} {{input}} {{result}} {{workerDir}} {{model}} {{prompt}} {{phase}} {{taskId}} {{workerId}} {{unknown}}`,
      CW_AGENT_MODEL: "my-test-model",
    },
  });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "complete");
  assert.equal(payload.completedWorkers, payload.plannedWorkers);

  const workersDir = path.join(path.dirname(payload.statePath), "workers");
  const verdictDir = fs.readdirSync(workersDir).find((d) => d.startsWith("worker-verdict:"));
  assert.ok(verdictDir, "a verdict worker folder must exist");
  const argv = readJson(path.join(workersDir, verdictDir, "argv.json"));
  assert.equal(argv.length, 10, "10 substituted/literal argv elements");
  const [manifestArg, inputArg, resultArg, workerDirArg, modelArg, promptArg, phaseArg, taskIdArg, workerIdArg, unknownArg] = argv;

  // {{manifest}}, {{input}}, {{result}} — real files.
  assert.ok(fs.existsSync(manifestArg), `{{manifest}} must be a real file: ${manifestArg}`);
  assert.match(manifestArg, /manifest\.json$/);
  assert.ok(fs.existsSync(inputArg), `{{input}} must be a real file: ${inputArg}`);
  assert.match(inputArg, /input\.md$/);
  assert.ok(fs.existsSync(resultArg), `{{result}} must be a real file (the agent wrote it): ${resultArg}`);
  assert.match(resultArg, /result\.md$/);

  // {{workerDir}} — the real directory that holds the three files above.
  assert.ok(fs.existsSync(workerDirArg) && fs.statSync(workerDirArg).isDirectory());
  assert.equal(path.dirname(manifestArg), workerDirArg);
  assert.equal(path.dirname(inputArg), workerDirArg);
  assert.equal(path.dirname(resultArg), workerDirArg);
  assert.equal(path.basename(workerDirArg), verdictDir);

  // {{model}} — the CW_AGENT_MODEL policy value, substituted verbatim.
  assert.equal(modelArg, "my-test-model");

  // {{prompt}} — non-empty task prompt text, found in input.md.
  assert.ok(promptArg.length > 0);
  assert.ok(fs.readFileSync(inputArg, "utf8").includes(promptArg), "{{prompt}} must be the task text in input.md");

  // {{phase}}, {{taskId}}, {{workerId}}.
  assert.equal(phaseArg, "Verdict");
  assert.match(taskIdArg, /^verdict:/);
  assert.equal(workerIdArg, verdictDir);

  // {{unknown}} is not a known key: it stays LITERAL.
  assert.equal(unknownArg, "{{unknown}}");
});
