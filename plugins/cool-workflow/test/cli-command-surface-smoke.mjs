#!/usr/bin/env node
// cli-command-surface-smoke — the CLI's command surface, held in one place.
//
// AGENTS.md: "--json output, exit codes and flags do not change shape."
// This smoke pins, through the built CLI as a black box:
//   - the verbs the command table has, and that removed verbs are unknown
//     (exit 1, "Unknown command");
//   - the top-level keys of each kept verb's --json output;
//   - the exit codes: 0 ok, 1 refused or failed, 2 a run that stopped short.
// Human text may change; these may not without a breaking-change note in
// docs/release-and-migration.7.md.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cw as runCw } from "./helpers/cw.mjs";
import { writeStubAgent } from "./helpers/stub-agent.mjs";
import { tmpWorkspace } from "./helpers/workspace.mjs";
import { COMMANDS, ASK } from "../dist/wiring/commands.js";

const keys = (o) => Object.keys(o).join(",");

// The command table: these paths and no others.
assert.deepEqual(
  COMMANDS.map((r) => r.path.join(" ")).sort(),
  ["check", "check list", "check show", "demo", "demo tamper", "doctor", "fix", "report", "report bundle", "report verify-bundle", "version"]
);
assert.deepEqual(ASK.path, ["-q"]);

const work = tmpWorkspace("cw-surface-");
const home = path.join(work, ".home");
fs.mkdirSync(home);
spawnSync("git", ["init", "-q"], { cwd: work });
const agent = writeStubAgent(path.join(work, ".agent.cjs"), { model: "stub-surface" });
const env = { ...process.env, HOME: home, CW_AGENT_COMMAND: `node ${agent} {{result}}`, CW_NO_AUTO_AGENT: "1", CW_NO_OPEN: "1" };
for (const v of ["CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND", "CW_AGENT_STREAM"]) delete env[v];
const cw = (args, extra = {}) => runCw(args, { cwd: work, env: { ...env, ...extra } });
const json = (r, label) => {
  try { return JSON.parse(r.stdout); } catch { assert.fail(`${label}: stdout is not JSON:\n${r.stdout}\n${r.stderr}`); }
};

// Removed verbs and flags are unknown.
for (const verb of ["run", "status", "list", "quickstart", "audit-run", "app", "sandbox", "backend", "worker", "feedback", "audit", "registry", "metrics", "operator", "telemetry", "migration", "ledger", "graph", "man", "completion", "step", "mcp"]) {
  const r = cw([verb]);
  assert.equal(r.status, 1, `${verb}: exit 1`);
  assert.match(r.stderr, /Unknown command/, `${verb}: unknown`);
}

// version: plain text, also with --json.
for (const args of [["version"], ["version", "--json"], ["--version"]]) {
  const r = cw(args);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^\d+\.\d+\.\d+\n$/, args.join(" "));
}

// help: exit 0, names the kept verbs.
{
  const r = cw(["help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /-q "question"/);
  assert.match(r.stdout, /report\|check\|demo/);
}

// -q: a full run.
const ask = cw(["-q", "what does this do", "--json"]);
assert.equal(ask.status, 0, ask.stderr);
const run = json(ask, "-q");
assert.equal(keys(run), "appId,schemaVersion,runId,workflowId,status,steps,plannedWorkers,completedWorkers,parkedWorkers,commitId,reportPath,statePath,agentConfigured");
assert.equal(run.status, "complete");
assert.equal(run.completedWorkers, run.plannedWorkers);
const accept = run.steps.find((s) => s.action === "accept");
assert.equal(keys(accept), "schemaVersion,action,status,runId,taskId,phase,backendId,handleKind,reportedModel");
assert.equal(accept.handleKind, "process");
const last = run.steps[run.steps.length - 1];
assert.equal(keys(last), "schemaVersion,action,status,runId,reason");
assert.equal(last.action, "commit");
assert.equal(last.status, "complete");

// --resume needs --run.
assert.equal(cw(["--resume", "--json"]).status, 1);

// report
{
  const r = cw(["report", "--json"]);
  assert.equal(r.status, 0);
  assert.equal(keys(json(r, "report")), "path");
}
const bundleRun = cw(["report", "bundle", run.runId, "--json"]);
assert.equal(bundleRun.status, 0, bundleRun.stderr);
const bundle = json(bundleRun, "report bundle");
assert.equal(keys(bundle), "schemaVersion,runId,archivePath,trustKeyEmbedded,verification,ok");
const VERIFY_KEYS = "schemaVersion,archivePath,runId,ok,archiveOk,telemetryVerified,trustKeySource,signatureKeyProvided,signaturesChecked,signaturesReverified,signaturesFailed,trustLevel,reportFindingsVerified,failedChecks";
assert.equal(keys(bundle.verification), VERIFY_KEYS);
{
  const r = cw(["report", "verify-bundle", bundle.archivePath, "--json"]);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(keys(json(r, "verify-bundle")), VERIFY_KEYS);
  // One changed byte inside the archive: exit 1.
  const tampered = path.join(work, "tampered.cwrun.json");
  const archive = JSON.parse(fs.readFileSync(bundle.archivePath, "utf8"));
  const file = archive.files.find((f) => /report\.md$/.test(f.relativePath));
  assert.ok(file, "the bundle carries report.md");
  file.contentBase64 = Buffer.from(Buffer.from(file.contentBase64, "base64").toString("utf8") + "x").toString("base64");
  fs.writeFileSync(tampered, JSON.stringify(archive));
  const bad = cw(["report", "verify-bundle", tampered, "--json"]);
  assert.equal(bad.status, 1);
  assert.equal(json(bad, "tampered").ok, false);
}

// check
{
  const ok = cw(["check", "--json", "--", process.execPath, "-e", "0"]);
  assert.equal(ok.status, 0, ok.stderr);
  const receipt = json(ok, "check");
  assert.equal(keys(receipt), "schemaVersion,ok,id,cite,path,argv,exitCode,signal,gitHead,dirty,signed,usable,code,reason,next");
  const fail = cw(["check", "--json", "--", process.execPath, "-e", "process.exit(3)"]);
  assert.equal(fail.status, 1);
  assert.equal(json(fail, "check fail").exitCode, 3);
  const list = json(cw(["check", "list", "--json"]), "check list");
  assert.ok(Array.isArray(list) && list.length === 2);
  assert.equal(keys(list[0]), "id,argv,exitCode,gitHead,startedAt,usable,code,reason,next");
  // show exits 0 for a usable receipt and 1 otherwise (here: the tree is
  // not committed, so the receipt is not usable).
  const show = cw(["check", "show", receipt.id, "--json"]);
  const shown = json(show, "check show");
  assert.equal(keys(shown), "id,cite,usable,code,reason,next,receipt");
  assert.equal(show.status, shown.usable ? 0 : 1);
}

// doctor, demo tamper
{
  const d = cw(["doctor", "--json"]);
  assert.equal(keys(json(d, "doctor")), "schemaVersion,ok,checks,summary");
  const t = cw(["demo", "tamper", "--json"]);
  assert.equal(t.status, 0, t.stderr);
  assert.equal(keys(json(t, "demo tamper")), "schemaVersion,runId,workers,trustKey,baseline,layers,proven");
}

console.log("cli-command-surface-smoke: ok");
