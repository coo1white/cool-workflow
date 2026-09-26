#!/usr/bin/env node
// advise-no-run — the fixed "no run selected" advice lives in
// core/format/recovery-hint.ts (a module every command loads), so
// `cw status` with no id no longer pulls in the run-reading modules
// (perf-ratchets PR 4). The payload is the same one every path gives.

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { adviseNoRun } = require("../../../dist/core/format/recovery-hint");
const operatorUx = require("../../../dist/shell/operator-ux");
const { statusCli } = require("../../../dist/shell/report-view-cli");
const { statusPayload } = require("../../../dist/wiring/capability-table/registry-core");

const expected = [
  {
    command: "cw plan <workflow-id> --repo <path>",
    reason: "No run id is available yet; create a workflow run before dispatching or recording evidence.",
    priority: "high",
  },
];
assert.deepEqual(adviseNoRun(), expected);
assert.equal(operatorUx.adviseNoRun, adviseNoRun, "operator-ux re-exports the one copy");
assert.deepEqual(statusCli(undefined, {}), { runId: null, nextActions: expected });
assert.deepEqual(statusPayload(undefined), { runId: null, nextActions: expected });

// The CLI path: same JSON bytes, and the run-reading modules stay unloaded.
const cli = path.resolve(__dirname, "..", "..", "..", "dist", "cli.js");
const probe = `
  process.argv = [process.argv[0], ${JSON.stringify(cli)}, "status", "--json"];
  require(${JSON.stringify(cli)});
  process.on("exit", () => {
    const loaded = Object.keys(require.cache).filter((f) => /[\\\\/]dist[\\\\/]shell[\\\\/](report-view-cli|operator-ux|run-store)\\.js$/.test(f));
    process.stderr.write("LOADED=" + JSON.stringify(loaded));
  });
`;
const r = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(JSON.parse(r.stdout), { runId: null, nextActions: expected });
assert.deepEqual(JSON.parse(r.stderr.split("LOADED=")[1]), [], "no run-reading module loads for a no-run status");

process.stdout.write("advise-no-run: ok\n");
