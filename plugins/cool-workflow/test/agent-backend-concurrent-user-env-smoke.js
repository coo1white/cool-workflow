"use strict";
// agent-backend-concurrent-user-env-smoke -- USER reaches a REAL spawned
// agent child through the CONCURRENT batch dispatch path (shell/drive.ts),
// not only through the single-request path (execution-backend/agent.ts).
//
// Found live: cw -q "..." -claude against an external repo still parked
// every Map-phase worker AFTER agent-backend-user-env-smoke.js (covering
// runAgentProcess's single-request path) was fixed and merged, still with
// "Not logged in". Root cause: architecture-review's Map/Assess phases are
// `parallel(...)`, so their 6 workers dispatch through shell/drive.ts's OWN
// separate "concurrent round" env-construction -- a byte-for-byte DUPLICATE
// of the same CW_/ANTHROPIC_/etc. allowlist loop that never forwarded USER
// either, and was never touched by the first fix. Both call sites now share
// one buildAgentChildEnv() (execution-backend/agent.ts) so this cannot
// silently drift into a THIRD copy. This smoke drives the real
// architecture-review app's Map phase (the exact parallel/concurrent shape
// that broke) with a stub agent that reports back what it saw.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { drive } = require(path.join(pluginRoot, "dist/shell/drive.js"));
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader.js"));
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline.js"));
const { loadRunFromCwd } = require(path.join(pluginRoot, "dist/shell/run-store.js"));

for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) delete process.env[v];
process.env.CW_NO_AUTO_AGENT = "1";

function tmpWorkspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-concurrent-user-env-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  return work;
}

function main() {
  const work = tmpWorkspace();
  const stub = path.join(work, "stub-agent.js");
  // Reports what the REAL spawned child saw as part of the worker's own
  // result content (not just stdout provenance JSON), so a driven run's
  // task result is enough to prove the point -- no extra plumbing needed.
  fs.writeFileSync(
    stub,
    [
      'const fs = require("fs");',
      "const fence = String.fromCharCode(96).repeat(3);",
      "const rp = process.argv[2];",
      "const hasUser = typeof process.env.USER === 'string';",
      "const body = '# R\\n\\n' + fence + 'cw:result\\n' + JSON.stringify({ summary: 'hasUser:' + hasUser, findings: [], evidence: [process.cwd() + '/README.md:1'] }) + '\\n' + fence + '\\n';",
      "fs.writeFileSync(rp, body);",
      "process.stdout.write(JSON.stringify({ model: 'stub-concurrent-model', usage: { input_tokens: 1, output_tokens: 1 } }));"
    ].join("\n"),
    "utf8"
  );

  const priorUser = process.env.USER;
  process.env.USER = "cw-concurrent-smoke-user";
  const cwd0 = process.cwd();
  try {
    process.chdir(work);
    const run = plan(loadWorkflowApp("architecture-review"), { repo: work, question: "Sound?" });
    drive(run.id, work, {
      now: "2026-06-09T00:00:00.000Z",
      agentConfig: { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], model: "op", source: "flag" }
    });

    const final = loadRunFromCwd(run.id, work);
    const mapTasks = final.tasks.filter((t) => /^map[:/]/i.test(t.id));
    assert.ok(mapTasks.length >= 1, "the architecture-review Map phase (the parallel/concurrent shape that broke) has tasks");
    for (const task of mapTasks) {
      assert.equal(task.status, "completed", `Map task ${task.id} completed through the concurrent batch dispatch path`);
      const node = final.nodes.find((n) => n.id === task.resultNodeId);
      assert.ok(node, `Map task ${task.id} has a result node`);
      const nodeText = JSON.stringify(node);
      assert.ok(
        nodeText.includes("hasUser:true"),
        `Map task ${task.id}'s REAL spawned child (concurrent batch path) saw USER -- got: ${nodeText.slice(0, 200)}`
      );
    }
  } finally {
    process.chdir(cwd0);
    if (priorUser === undefined) delete process.env.USER;
    else process.env.USER = priorUser;
    fs.rmSync(work, { recursive: true, force: true });
  }

  process.stdout.write("agent-backend-concurrent-user-env-smoke: ok (USER reaches a REAL spawned child through the CONCURRENT batch dispatch path)\n");
}

main();
