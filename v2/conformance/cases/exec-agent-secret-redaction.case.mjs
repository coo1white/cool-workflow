#!/usr/bin/env node

// A raw --api-key value given on the agent command must NEVER land in any
// file CW writes under .cw/ (state, worker manifests, telemetry, report),
// even though the run completes normally and the agent process itself did
// receive the real value on its own argv.

import fs from "node:fs";
import path from "node:path";
import { run, gitRepo, caseMain, assert, stubAgentEnv } from "../lib.mjs";

const RAW_SECRET = "sk-THISISASECRETVALUE1234567890";

function filesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const stub = stubAgentEnv("a.txt:1");
  // Put the flag AFTER {{input}} {{result}} so the stub agent's own
  // argv[2]/argv[3] positions (its input/result paths) are untouched.
  stub.CW_AGENT_COMMAND = `${stub.CW_AGENT_COMMAND} --api-key ${RAW_SECRET}`;

  const r = run(["-q", "Prove it works", "--json"], { cwd: repo, env: stub });
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "complete");
  assert.ok(!r.stdout.includes(RAW_SECRET) && !r.stderr.includes(RAW_SECRET), "never printed");

  const files = filesUnder(path.join(repo, ".cw"));
  assert.ok(files.length > 10, "the run wrote its files");
  for (const file of files) {
    assert.ok(!fs.readFileSync(file, "utf8").includes(RAW_SECRET), `the raw secret must never be written: ${file}`);
  }
});
