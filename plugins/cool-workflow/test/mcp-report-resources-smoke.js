#!/usr/bin/env node
"use strict";

// mcp-report-resources-smoke — MCP gets a run's answer in one call.
//   1. cw_report with no extra args is byte-identical to the CLI's
//      `cw report <id> --json` ({ path } only).
//   2. answer: true adds { taskId, summary, evidence } (the report's
//      "## Answer"); markdown: true adds the report.md text.
//   3. initialize declares resources; resources/list names each run's
//      report.md as cw://runs/<id>/report.md; resources/read gives its text.
//   4. Fail closed: a bad URI, an unsafe run id, and a run with no report
//      are errors; a policy that turns cw_report off turns resources off.
//
// Black box: a stub agent drives `cw -q --fast` to a complete run, then
// the MCP server runs over stdio in that repo.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cwBin = path.join(pluginRoot, "scripts", "cw.js");
const mcpBin = path.join(pluginRoot, "scripts", "mcp-server.js");
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-mcp-report-")));

const agent = path.join(work, "agent.js");
fs.writeFileSync(
  agent,
  [
    'const fs = require("fs");',
    "const fence = String.fromCharCode(96).repeat(3);",
    "const body = '# R\\n\\n' + fence + 'cw:result\\n' + JSON.stringify({ summary: 'stub answer', findings: [], evidence: ['README.md:1'] }) + '\\n' + fence + '\\n';",
    "fs.writeFileSync(process.argv[3], body);",
    "process.stdout.write(JSON.stringify({ model: 'stub-answer' }));",
  ].join("\n"),
  "utf8"
);

const env = { ...process.env, CW_AGENT_COMMAND: `node ${agent} {{input}} {{result}}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1" };
delete env.CW_AGENT_ENDPOINT;
delete env.CW_AGENT_STREAM;
delete env.CW_MCP_ENABLED_TOOLS;
delete env.CW_MCP_DISABLED_TOOLS;

function cw(args, cwd) {
  return spawnSync(process.execPath, [cwBin, ...args], { cwd, env, encoding: "utf8", timeout: 120000 });
}

function mcp(requests, cwd, extraEnv = {}) {
  const input = requests.map((r) => JSON.stringify({ jsonrpc: "2.0", ...r })).join("\n") + "\n";
  const r = spawnSync(process.execPath, [mcpBin], { cwd, env: { ...env, ...extraEnv }, input, encoding: "utf8", timeout: 60000 });
  const byId = new Map();
  for (const line of r.stdout.split("\n").filter(Boolean)) {
    const m = JSON.parse(line);
    byId.set(m.id, m);
  }
  return byId;
}

const call = (id, args) => ({ id, method: "tools/call", params: { name: "cw_report", arguments: args } });

try {
  const dir = path.join(work, "repo");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "README.md"), "# target\n", "utf8");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const run = cw(["-q", "q", "--fast", "--json"], dir);
  assert.equal(run.status, 0, `cw -q --fast exits 0 (stderr: ${run.stderr})`);
  const { runId, status } = JSON.parse(run.stdout);
  assert.equal(status, "complete");
  const cli = cw(["report", runId, "--json"], dir);
  assert.equal(cli.status, 0, cli.stderr);

  const r = mcp(
    [
      { id: 1, method: "initialize", params: {} },
      call(2, { runId }),
      call(3, { runId, answer: true }),
      call(4, { runId, markdown: true, answer: false }),
      { id: 5, method: "resources/list", params: {} },
      { id: 6, method: "resources/read", params: { uri: `cw://runs/${runId}/report.md` } },
      { id: 7, method: "resources/read", params: { uri: "file:///etc/passwd" } },
      { id: 8, method: "resources/read", params: { uri: "cw://runs/../report.md" } },
      { id: 9, method: "resources/read", params: { uri: "cw://runs/no-such-run/report.md" } },
      { id: 10, method: "tools/list", params: {} },
    ],
    dir
  );

  // 1. default: the CLI's --json bytes, nothing more
  assert.equal(r.get(1).result.capabilities.resources !== undefined, true, "initialize declares resources");
  assert.deepEqual(r.get(1).result.capabilities, { tools: {}, resources: {} });
  assert.equal(r.get(2).result.content[0].text.trim(), cli.stdout.trim(), "cw_report with no extras equals `cw report --json`");
  const reportPath = JSON.parse(cli.stdout).path;

  // 2. answer / markdown
  const withAnswer = JSON.parse(r.get(3).result.content[0].text);
  assert.deepEqual(withAnswer, { path: reportPath, answer: { taskId: "verdict:fast-synthesis", summary: "stub answer", evidence: ["README.md:1"] } });
  const withMarkdown = JSON.parse(r.get(4).result.content[0].text);
  assert.deepEqual(Object.keys(withMarkdown), ["path", "markdown"], "answer: false adds nothing");
  assert.equal(withMarkdown.markdown, fs.readFileSync(reportPath, "utf8"));
  assert.match(withMarkdown.markdown, /## Answer\n\nstub answer\n/);
  const schema = r.get(10).result.tools.find((t) => t.name === "cw_report").inputSchema;
  assert.equal(schema.properties.answer.type, "boolean");
  assert.equal(schema.properties.markdown.type, "boolean");

  // 3. resources
  assert.deepEqual(r.get(5).result, { resources: [{ uri: `cw://runs/${runId}/report.md`, name: `${runId} report`, mimeType: "text/markdown" }] });
  assert.deepEqual(r.get(6).result, { contents: [{ uri: `cw://runs/${runId}/report.md`, mimeType: "text/markdown", text: fs.readFileSync(reportPath, "utf8") }] });

  // 4. fail closed
  assert.equal(r.get(7).error.code, -32602, "a URI that is not cw://runs/<id>/report.md is refused");
  assert.equal(r.get(8).error.code, -32602, "'..' as a run id is refused");
  assert.equal(r.get(9).error.code, -32002, "a run with no report is not found");
  assert.match(r.get(9).error.message, /Try: cw_report/);

  const off = mcp([{ id: 1, method: "resources/list", params: {} }, { id: 2, method: "resources/read", params: { uri: `cw://runs/${runId}/report.md` } }], dir, { CW_MCP_DISABLED_TOOLS: "cw_report" });
  assert.equal(off.get(1).error.code, -32601, "cw_report off by policy turns resources/list off");
  assert.equal(off.get(2).error.code, -32601, "cw_report off by policy turns resources/read off");

  // a folder with no runs lists nothing
  const empty = mcp([{ id: 1, method: "resources/list", params: {} }], work);
  assert.deepEqual(empty.get(1).result, { resources: [] });

  console.log("mcp-report-resources-smoke: ok");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
