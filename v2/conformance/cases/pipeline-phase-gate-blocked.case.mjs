#!/usr/bin/env node

// Phase gate on architecture-review: Map -> Assess (overlaps Map) -> Verify
// -> Verdict. When one Map task parks and the rest complete, the Map phase
// never reaches "completed", so Verify and Verdict are never delegated —
// the phase gate stops the run, not just the one task.

import fs from "node:fs";
import path from "node:path";
import { run, gitRepo, readJson, caseMain, assert } from "../lib.mjs";

// A selector agent: fails only for the task whose worker input path
// contains "map:server-api"; every other task succeeds with a minimal valid
// cw:result envelope.
const SELECTOR_SRC = `
import fs from "node:fs";
const inputPath = process.argv[2];
const resultPath = process.argv[3];
if (/map[:_]server-api/.test(inputPath)) { process.exit(1); }
const body = "Stub finding.\\n\\n\`\`\`cw:result\\n" + JSON.stringify({ summary: "s", findings: [], evidence: ["a.txt:1"] }) + "\\n\`\`\`\\n";
fs.writeFileSync(resultPath, body, "utf8");
process.stdout.write(JSON.stringify({ model: "selector-agent" }) + "\\n");
`;

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const selectorPath = path.join(path.dirname(repo), "selector-agent.mjs");
  fs.writeFileSync(selectorPath, SELECTOR_SRC, "utf8");
  const env = { CW_AGENT_COMMAND: `node ${selectorPath} {{input}} {{result}}` };

  const r = run(["-q", "prove it", "--repo", repo, "--json"], { env });
  assert.equal(r.status, 2);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "parked");
  assert.equal(payload.plannedWorkers, 14);
  assert.equal(payload.parkedWorkers, 1, "the failing map task parked");
  assert.equal(payload.commitId, undefined);

  const state = readJson(payload.statePath);
  const byId = Object.fromEntries(state.tasks.map((t) => [t.id, t.status]));
  assert.equal(byId["map:server-api"], "failed");
  assert.equal(byId["verify:p0-p2-risks"], "pending");
  assert.equal(byId["verdict:synthesis"], "pending");
  assert.notEqual(state.phases.find((p) => p.name === "Map").status, "completed");
  assert.equal(state.phases.find((p) => p.name === "Verdict").status, "pending");

  // On disk: no Verify or Verdict worker was ever made.
  const workerDirs = fs.readdirSync(path.join(path.dirname(payload.statePath), "workers"));
  assert.ok(workerDirs.every((w) => w.startsWith(`worker-map:`) || w.startsWith(`worker-assess:`)), workerDirs.join(","));
});
