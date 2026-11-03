#!/usr/bin/env node
// doctor-conformance-smoke — `cw doctor --conformance` (new in 0.3.3;
// docs/agent-delegation-drive.7.md, "The agent contract").
//
// It runs the configured agent once on a tiny fixed task, through the same
// path a real drive uses, and checks the cw-agent/1 contract. Stub agents
// (node scripts given {{input}} {{result}}) stand in for real ones:
//   (a) a good agent -> ok, names cw-agent/1 and the reported model
//   (b) no model on stdout -> warn, with how to report one
//   (c) exits 0 but writes no result.md -> fail
//   (d) exits 1 -> fail, with the agent's own reason
//   (e) writes a cw:result block CW cannot parse -> fail
//   (f) no agent configured -> warn, nothing run
//   (g) plain `cw doctor` (no flag) never runs the agent and shows no such row
//   (h) the agent ran in a temp dir that is gone afterwards; .cw/ untouched
//
// Included in `npm test`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const base = tmpDir("cw-doctor-conformance-");
const home = path.join(base, "home");
const cwd = path.join(base, "work");
const marks = path.join(base, "marks");
for (const d of [home, cwd, marks]) fs.mkdirSync(d, { recursive: true });

// argv: <input> <result> <mode>. Records where it ran and what it was given.
const agent = path.join(base, "agent.js");
fs.writeFileSync(
  agent,
  [
    'const fs = require("node:fs");',
    "const [input, result, mode] = process.argv.slice(2);",
    `fs.writeFileSync(${JSON.stringify(path.join(marks, "ran.json"))}, JSON.stringify({ cwd: process.cwd(), input: fs.readFileSync(input, "utf8"), result }));`,
    'const ok = "```cw:result\\n{\\"summary\\":\\"cw-conformance-ok\\",\\"findings\\":[],\\"evidence\\":[]}\\n```\\n";',
    'if (mode === "good") { fs.writeFileSync(result, ok); process.stdout.write(JSON.stringify({ model: "fake-model-1" }) + "\\n"); }',
    'if (mode === "nomodel") fs.writeFileSync(result, ok);',
    'if (mode === "noresult") process.stdout.write(JSON.stringify({ model: "fake-model-1" }) + "\\n");',
    'if (mode === "exit1") { process.stderr.write("fake agent: not logged in\\n"); process.exit(1); }',
    'if (mode === "badjson") { fs.writeFileSync(result, "```cw:result\\n{not json\\n```\\n"); process.stdout.write(JSON.stringify({ model: "fake-model-1" }) + "\\n"); }',
  ].join("\n"),
  "utf8"
);

function doctor(extraArgs, mode) {
  fs.rmSync(path.join(marks, "ran.json"), { force: true });
  const env = {
    PATH: path.dirname(process.execPath),
    HOME: home,
    CW_HOME: home,
    CW_NO_AUTO_AGENT: "1",
    ...(mode ? { CW_AGENT_COMMAND: `${process.execPath} ${agent} {{input}} {{result}} ${mode}` } : {}),
  };
  const r = spawnSync(process.execPath, [cli, "doctor", "--json", ...extraArgs], { cwd, env, encoding: "utf8", timeout: 60000 });
  const report = JSON.parse(r.stdout);
  const row = report.checks.find((c) => c.name === "agent-conformance");
  const ran = fs.existsSync(path.join(marks, "ran.json")) ? JSON.parse(fs.readFileSync(path.join(marks, "ran.json"), "utf8")) : undefined;
  return { report, row, ran };
}

try {
  // (a) + (h)
  {
    const { row, ran } = doctor(["--conformance"], "good");
    assert.ok(row, "the --conformance row is there");
    assert.equal(row.status, "ok", JSON.stringify(row));
    assert.match(row.detail, /^cw-agent\/1: ran in [\d.]+s, exit 0, result\.md read, model fake-model-1\.$/);
    assert.ok(ran, "the agent ran");
    assert.match(ran.input, /cw doctor --conformance/, "it was given the fixed task in {{input}}");
    assert.ok(ran.result.endsWith(path.join("worker", "result.md")), `{{result}} is a worker result.md: ${ran.result}`);
    assert.ok(!ran.cwd.startsWith(cwd), "it ran outside the user's folder");
    assert.equal(fs.existsSync(ran.cwd), false, "its temp folder is removed afterwards");
    assert.equal(fs.existsSync(path.join(cwd, ".cw")), false, "doctor still writes no .cw/");
  }
  // (b)
  {
    const { row } = doctor(["--conformance"], "nomodel");
    assert.equal(row.status, "warn", JSON.stringify(row));
    assert.match(row.detail, /no model reported/);
    assert.match(row.fix, /"model"/);
  }
  // (c)
  {
    const { report, row } = doctor(["--conformance"], "noresult");
    assert.equal(row.status, "fail", JSON.stringify(row));
    assert.match(row.detail, /wrote no result\.md at \{\{result\}\}/);
    assert.equal(report.ok, false, "a failed contract check makes doctor not ready");
  }
  // (d)
  {
    const { row } = doctor(["--conformance"], "exit1");
    assert.equal(row.status, "fail", JSON.stringify(row));
    assert.match(row.detail, /did not end cleanly .*; it said: fake agent: not logged in/);
  }
  // (e)
  {
    const { row } = doctor(["--conformance"], "badjson");
    assert.equal(row.status, "fail", JSON.stringify(row));
    assert.match(row.detail, /CW cannot read it: Invalid cw:result JSON/);
  }
  // (f)
  {
    const { row, ran } = doctor(["--conformance"], undefined);
    assert.equal(row.status, "warn", JSON.stringify(row));
    assert.match(row.detail, /no agent is configured/);
    assert.equal(ran, undefined);
  }
  // (g)
  {
    const { row, ran } = doctor([], "good");
    assert.equal(row, undefined, "plain doctor has no agent-conformance row");
    assert.equal(ran, undefined, "plain doctor never runs the agent");
  }
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

process.stdout.write("doctor-conformance-smoke: ok (good/no-model/no-result/exit-1/bad-json/unconfigured, opt-in only)\n");
